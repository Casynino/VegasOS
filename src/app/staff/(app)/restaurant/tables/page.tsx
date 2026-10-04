import type { Metadata } from "next";
import QRCode from "qrcode";
import { can, requirePagePermission } from "@/server/auth";
import { stayingGuests } from "@/server/services/guests";
import { businessToday, getSettings } from "@/server/settings";
import { localCalendarDate } from "@/lib/time/business-date";
import { isRestaurantDevice, worksWaiterShift } from "@/lib/permissions";
import { siteOrigin } from "@/server/site-origin";
import { accountOptions } from "@/server/services/payment-accounts";
import { tableFloor, withoutMoney, type SessionView } from "@/server/services/dining-sessions";
import { tablesSwitchedOff } from "@/server/services/restaurant-locations";
import { TablesBoard, type TablePlace } from "./tables-board";

export const metadata: Metadata = { title: "Tables" };
export const dynamic = "force-dynamic";

const svg = (url: string) => QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "H", color: { dark: "#0b1026", light: "#00000000" } });

/** The Mpishi's view of a table: who ordered what — no money, phones or rooms (which room a bill went on). */
function forKitchen(s: SessionView): SessionView {
  const k = withoutMoney(s);
  return { ...k, orders: k.orders.map((o) => ({ ...o, onRoom: null })), timeline: k.timeline.filter((t) => t.kind !== "CHARGED_TO_ROOM" && t.kind !== "OFF_ROOM") };
}

/**
 * THE RESTAURANT FLOOR — Table 1–6 inside, Table 1–6 outside, the counter and the main restaurant
 * QR: who is at each table (their session: every order, the bill, paid or not), reservations, and
 * each place's QR card. Waiters, reception and managers seat, move, take payments (or put the
 * bill on the customer's own room) and close tables; the Mpishi sees the orders only.
 */
export default async function RestaurantTablesPage({ searchParams }: PageProps<"/staff/restaurant/tables">) {
  const user = await requirePagePermission("restaurant.orders", "restaurant.serve", "kitchen.orders", "restaurant.menu");
  const today = await businessToday();
  // Managers, the owner and the MD watch the floor and step in (move, reserve, clear, take off with a reason,
  // discount) — waiters and reception take the orders and the money.
  const watches = can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");
  const pay = !watches && can(user, "revenue.record");
  const [floor, s, origin, sp, accounts] = await Promise.all([tableFloor({ today }), getSettings(), siteOrigin(), searchParams, pay ? accountOptions("payments") : Promise.resolve([])]);
  const money = can(user, "restaurant.orders") || can(user, "restaurant.menu");
  const places: TablePlace[] = await Promise.all(floor.map(async ({ qrToken, ...p }) => {
    const url = `${origin}/t/${qrToken}`;
    return {
      ...p, url, qr: await svg(url),
      session: p.session && !money ? forKitchen(p.session) : p.session,
      loose: money ? p.loose : p.loose.map((o) => ({ ...o, total: 0, paid: 0, due: 0, phone: null, onRoom: null, items: o.items.map((i) => ({ ...i, price: 0, total: 0 })) })),
      next: p.next && !money ? { ...p.next, phone: null } : p.next,
    };
  }));
  // Reception handles the HOTEL's guests only (owner, 2026-10-04): the tables where someone staying here sits, or with
  // an order on a room — nobody else's table, and it never seats a walk-in (they go to the restaurant directly).
  const desk = can(user, "dashboard.front_desk") && !watches;
  // …and reserves a table only for a guest staying here.
  const hotelGuests = desk ? await stayingGuests() : null;
  const shown = desk ? places.filter((p) => (p.session?.stays.length ?? 0) > 0 || p.loose.some((o) => !!o.onRoom)) : places;
  const print = typeof sp.print === "string" && places.some((c) => c.id === sp.print) ? sp.print : null;
  const open = typeof sp.table === "string" && places.some((c) => c.id === sp.table) ? sp.table : null;
  const seat = !watches && !desk && (can(user, "restaurant.orders") || can(user, "restaurant.serve"));
  // Managers and the MD run the floor: add tables, take them out of use, block / reopen them.
  const setUp = watches || can(user, "restaurant.menu") || can(user, "settings.manage");
  // Reception, managers and the MD check who is staying: a bill on another guest's room, and who pays an order (with the reason).
  const checkStays = can(user, "reservations.view") && can(user, "restaurant.orders");
  // Who serves each table: a waiter takes charge of one nobody has and hands their own to a colleague; the shared
  // screen does both with the waiter's PIN; managers hand any table to anyone. The Mpishi only sees who it is.
  const device = isRestaurantDevice(user.permissions);
  const serves = can(user, "restaurant.serve") && (device || worksWaiterShift(user.permissions));
  return (
    <TablesBoard places={shown} hotelGuests={hotelGuests} hotel={s.hotelName} phone={s.phone} canManage={can(user, "restaurant.menu") || can(user, "settings.manage")} accounts={accounts}
      canSetUp={setUp} switchedOff={setUp ? await tablesSwitchedOff() : []} today={localCalendarDate(new Date(), s.timezone)} autoPrint={print} autoOpen={open}
      meId={user.id} device={device}
      can={watches ? { take: false, add: can(user, "restaurant.serve"), remove: can(user, "restaurant.orders") || can(user, "restaurant.menu"), void: can(user, "revenue.void"), seat: true, pay: false, decide: true, stays: checkStays, hand: "any" }
        : { take: can(user, "restaurant.orders") || can(user, "kitchen.orders"), add: can(user, "restaurant.serve"), remove: can(user, "restaurant.orders"), void: can(user, "revenue.void"), seat, pay, room: can(user, "restaurant.orders"), stays: checkStays && !desk,
          charge: serves, hand: serves ? (device ? "any" : "own") : undefined }} />
  );
}
