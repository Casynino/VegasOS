import { ntzsEnabled } from "@/server/services/ntzs";
import { discountLimit } from "@/lib/discounts";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { accountOptions } from "@/server/services/payment-accounts";
import { businessToday, getSettings } from "@/server/settings";
import { addDays } from "@/lib/time/business-date";
import { PageHeader } from "@/components/staff/page-header";
import { bookingCompanies } from "@/server/services/company-billing";
import { billMenu } from "@/server/services/restaurant";
import { BookingForm } from "./booking-form";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("New booking") };
}

export default async function NewReservationPage({ searchParams }: PageProps<"/staff/reservations/new">) {
  const user = await requirePagePermission("reservations.create");
  const t = await getT();
  const sp = await searchParams;
  const [today, sources, companies, methods] = await Promise.all([
    businessToday(),
    db.bookingSource.findMany({ where: { isActive: true, code: { not: "HOTEL_QR" } }, orderBy: { sortOrder: "asc" } }),
    businessToday().then(bookingCompanies),
    accountOptions("payments"),
  ]);
  const guestId = typeof sp.guest === "string" ? sp.guest : null;
  const g = guestId
    ? await db.guest.findUnique({
        where: { id: guestId },
        include: {
          _count: { select: { reservations: { where: { status: "CHECKED_OUT" } } } },
          reservations: { where: { status: "CHECKED_OUT" }, orderBy: { departureDate: "desc" }, take: 1, select: { departureDate: true } },
        },
      })
    : null;
  const roomId = typeof sp.room === "string" ? sp.room : null;
  const room = roomId ? await db.room.findUnique({ where: { id: roomId }, select: { id: true, number: true, isActive: true, roomType: { select: { id: true, name: true, category: true } } } }) : null;
  const from = typeof sp.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) && sp.from >= today ? sp.from : null;
  // A meeting room is always booked by time.
  // Most guests walk in: that is the default. Reserve-for-later opens when asked for, or when a later date is given.
  const canWalkIn = can(user, "reservations.check_in");
  const mode = sp.mode === "meeting" || room?.roomType.category === "MEETING_ROOM" ? "meeting" : sp.mode === "group" ? "group"
    : sp.mode === "dayuse" ? "dayUse" : sp.mode === "reserve" || from || !canWalkIn ? "overnight" : "walkIn";
  return (
    <div className="w-full">
      <PageHeader title={t("New booking")} description={t("Check in a guest at the desk, reserve a room for later, give a room for a short time, book the meeting room, or book several rooms for a group. Prices and free rooms are live.")} />
      <BookingForm
        initialMode={mode}
        today={today}
        tomorrow={addDays(today, 1)}
        sources={sources.map((s) => ({ code: s.code, name: s.name }))}
        corporates={companies}
        preselectCompany={typeof sp.company === "string" ? sp.company : null}
        canApproveCredit={can(user, "corporate.manage")}
        canConfirmUnpaid={can(user, "reservations.confirm_unpaid")}
        holdHours={(await getSettings()).unpaidHoldHours}
        invoiceTerms={(await getSettings()).invoiceDefaultDueDays}
        discountMax={discountLimit(user.permissions, await getSettings())}
        canCheckIn={can(user, "reservations.check_in")}
        methods={can(user, "payments.record") ? methods : []}
        mobilePay={ntzsEnabled() && can(user, "payments.record")}
        initialRoom={room?.isActive ? { id: room.id, number: room.number, typeId: room.roomType.id, typeName: room.roomType.name } : null}
        initialArrival={from}
        menu={await billMenu()}
        initialGuest={g && {
          id: g.id, fullName: g.fullName, phone: g.phone ?? "", email: g.email ?? "", idType: g.idType ?? "", idNumber: g.idNumber ?? "",
          nationality: g.nationality ?? "", address: g.address ?? "", stays: g._count.reservations, lastStay: g.reservations[0]?.departureDate.toISOString().slice(0, 10) ?? null,
        }}
      />
    </div>
  );
}
