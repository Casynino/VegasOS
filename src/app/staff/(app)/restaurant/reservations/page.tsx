import type { Metadata } from "next";
import { stayingGuests } from "@/server/services/guests";
import { requirePagePermission } from "@/server/auth";
import { isDeskUser } from "@/server/desk";
import { getSettings } from "@/server/settings";
import { addDays, isBusinessDate, localCalendarDate } from "@/lib/time/business-date";
import { orderLocations } from "@/server/services/restaurant-locations";
import { listTableReservations, reservationClock } from "@/server/services/table-reservations";
import { ReservationsBoard } from "./reservations-board";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Table reservations") };
}
export const dynamic = "force-dynamic";

/**
 * TABLE RESERVATIONS — who is coming when, at which table: by day or the week ahead, or found
 * by name, phone or reference. Book, change, confirm, move to another table, cancel, no-show —
 * and seat them when they come (their reservation becomes their table's session).
 */
export default async function TableReservationsPage({ searchParams }: PageProps<"/staff/restaurant/reservations">) {
  const user = await requirePagePermission("restaurant.orders", "restaurant.serve");
  // Reception books tables for the hotel's guests only (owner, 2026-10-04): it picks a staying guest, and sees their bookings.
  const desk = isDeskUser(user);
  const [s, sp, places] = await Promise.all([getSettings(), searchParams, orderLocations()]);
  const hotelGuests = desk ? await stayingGuests() : null;
  // Reservations go by the calendar date (a booking made at 1 am is for "today", not the hotel's night before).
  const today = localCalendarDate(new Date(), s.timezone);
  const day = typeof sp.day === "string" && isBusinessDate(sp.day) ? sp.day : today;
  const week = sp.view === "week";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const all = await listTableReservations({ from: day, to: week ? addDays(day, 6) : day, q: q || null });
  const rows = hotelGuests ? all.filter((r) => hotelGuests.some((g) => g.id === r.customer.id)) : all;
  const tables = places.filter((l) => l.kind === "TABLE").map((l) => ({ id: l.id, name: l.name, area: l.area, number: l.number }));
  return (
    <ReservationsBoard day={day} today={today} week={week} q={q} tables={tables} hotelGuests={hotelGuests}
      rows={rows.map((r) => ({ ...r, clock: reservationClock(new Date(r.at), s.timezone) }))} />
  );
}
