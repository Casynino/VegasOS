import "server-only";
import { db } from "../db";
import { getSettings } from "../settings";
import { fromDbDate, type BusinessDate } from "@/lib/time/business-date";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import { englishT } from "@/i18n/translate";

/**
 * The room control page: one physical room's situation right now — its type and price
 * (from the database), live status, the stay in it (or arriving today), the stay's full
 * bill (room, restaurant, bar, room service, services, discounts, payments, balance), the
 * orders, and a timeline of everything that happened in the room — read from the existing
 * bookings, charges, payments, orders, room status history and audit log (nothing copied).
 */

const AUDIT_WORDS: Record<string, string> = {
  "reservation.extended": msg("Stay extended"),
  "reservation.dates_changed": msg("Dates changed"),
  "reservation.discount_changed": msg("Discount changed"),
  "reservation.billing_changed": msg("Who pays changed"),
  "reservation.room_changed": msg("Room changed"),
  "reservation.late_checkout": msg("Late checkout agreed"),
  "reservation.checkin_not_ready_override": msg("Checked in before the room was ready (override)"),
  "reservation.occupant_added": msg("Guest added to the room"),
  "reservation.occupant_removed": msg("Guest removed from the room"),
  "payment.reversed": msg("Payment reversed"),
  "payment.method_corrected": msg("Payment account corrected"),
  "reservation.charge_voided": msg("Charge removed"),
};

export type RoomEvent = {
  at: string; kind: "in" | "out" | "status" | "move" | "charge" | "order" | "payment" | "change";
  title: string; detail?: string | null; by?: string | null; amount?: number | null; href?: string | null;
};

export async function roomControl(roomId: string, today: BusinessDate, now = new Date()) {
  // The timeline's titles are put together here — in the reader's language (names, numbers and notes as written).
  const [s, t] = await Promise.all([getSettings(), getT().catch(() => englishT)]);
  const room = await db.room.findUnique({
    where: { id: roomId },
    select: {
      id: true, number: true, floor: true, status: true, statusNote: true, statusChangedAt: true, isActive: true,
      roomType: { select: { name: true, baseRate: true, category: true, maxAdults: true, maxChildren: true, bedType: true } },
    },
  });
  if (!room) return null;

  // The stay in the room now — or, if none, the booking arriving today.
  const pick = (where: object) => db.reservationRoom.findFirst({
    where: { roomId, ...where }, orderBy: { startAt: "asc" },
    select: {
      id: true, status: true, startAt: true, endAt: true, arrivalDate: true, departureDate: true, nights: true, isDayUse: true,
      ratePerNight: true, discountPerNight: true, grossAmount: true, discountAmount: true, netAmount: true, adults: true, children: true,
      checkedInAt: true, checkedInBy: { select: { fullName: true } }, lateCheckoutUntil: true,
      reservation: {
        select: {
          id: true, reference: true, status: true, kind: true, adults: true, children: true, billTo: true, companyName: true, guestToken: true,
          grossAmount: true, discountAmount: true, chargesAmount: true, netAmount: true, paidAmount: true, balanceAmount: true,
          specialRequests: true, internalNotes: true,
          guest: { select: { id: true, fullName: true, phone: true, email: true, vip: true } },
          corporateCustomer: { select: { companyName: true } },
          group: { select: { id: true, name: true } },
          charges: { where: { isVoided: false }, orderBy: { createdAt: "asc" }, select: { id: true, description: true, amount: true, kind: true, category: true, createdAt: true, createdById: true } },
          payments: { orderBy: { receivedAt: "asc" }, select: { id: true, amount: true, kind: true, status: true, receivedAt: true, method: { select: { name: true } }, account: { select: { name: true } }, recordedBy: { select: { fullName: true } } } },
          restaurantOrders: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, type: true, total: true, createdAt: true, source: true, settlement: true, items: { select: { name: true, quantity: true } } } },
        },
      },
    },
  });
  const focusRR = (await pick({ status: "CHECKED_IN" })) ?? (await pick({ status: { in: ["RESERVED", "CONFIRMED"] }, arrivalDate: new Date(`${today}T00:00:00Z`) }));
  const r = focusRR?.reservation ?? null;
  const staff = r ? new Map((await db.user.findMany({ where: { id: { in: r.charges.map((c) => c.createdById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName])) : new Map();

  // The bill, grouped the way the guest reads it.
  // Words shown on the room page (it translates them): kept in English here, compared by name below.
  const group = (k: string) => (k === "RESTAURANT" ? msg("Restaurant") : k === "BAR" ? msg("Bar") : k === "ROOM_SERVICE" ? msg("Room service") : msg("Services & extras"));
  const bill = r ? {
    accommodation: { nights: focusRR!.isDayUse ? 0 : focusRR!.nights, rate: focusRR!.ratePerNight, gross: r.grossAmount, dayUse: focusRR!.isDayUse },
    sections: [msg("Restaurant"), msg("Bar"), msg("Room service"), msg("Services & extras")].map((name) => ({
      name, lines: r.charges.filter((c) => group(c.kind) === name).map((c) => ({ id: c.id, description: c.description, amount: c.amount, at: c.createdAt.toISOString(), by: c.createdById ? staff.get(c.createdById) ?? null : null })),
    })).map((sec) => ({ ...sec, total: sec.lines.reduce((t, l) => t + l.amount, 0) })).filter((sec) => sec.lines.length),
    discount: r.discountAmount,
    total: r.netAmount,
    payments: r.payments.map((p) => ({ id: p.id, amount: p.amount, refund: p.kind === "REFUND", reversed: p.status === "REVERSED", at: p.receivedAt.toISOString(), how: `${p.method.name} · ${p.account.name}`, by: p.recordedBy.fullName })),
    paid: r.paidAmount, balance: r.balanceAmount,
    payer: r.billTo === "GROUP" ? r.group?.name ?? msg("the group") : r.billTo !== "GUEST" ? r.corporateCustomer?.companyName ?? r.companyName ?? msg("the company") : null,
  } : null;

  // What happened in this room, newest first.
  const [statuses, stays, moves, audits] = await Promise.all([
    db.roomStatusHistory.findMany({ where: { roomId }, orderBy: { changedAt: "desc" }, take: 25, include: { changedBy: { select: { fullName: true } } } }),
    db.reservationRoom.findMany({
      where: { roomId, OR: [{ checkedInAt: { not: null } }, { checkedOutAt: { not: null } }] }, orderBy: { startAt: "desc" }, take: 12,
      select: { checkedInAt: true, checkedOutAt: true, checkedInBy: { select: { fullName: true } }, checkedOutBy: { select: { fullName: true } }, reservation: { select: { id: true, reference: true, guest: { select: { fullName: true } } } } },
    }),
    db.roomAssignment.findMany({
      where: { OR: [{ fromRoomId: roomId }, { toRoomId: roomId }] }, orderBy: { changedAt: "desc" }, take: 12,
      include: { fromRoom: { select: { number: true } }, toRoom: { select: { number: true } }, changedBy: { select: { fullName: true } } },
    }),
    r ? db.auditLog.findMany({ where: { entityType: "Reservation", entityId: r.id, action: { in: Object.keys(AUDIT_WORDS) } }, orderBy: { createdAt: "desc" }, take: 20, include: { user: { select: { fullName: true } } } }) : Promise.resolve([]),
  ]);
  const ev: RoomEvent[] = [];
  const status = (x: string) => ({ AVAILABLE: msg("Available"), READY: msg("Clean & ready"), RESERVED: msg("Reserved"), OCCUPIED: msg("Occupied"), DIRTY: msg("Needs cleaning"), CLEANING: msg("Cleaning"), MAINTENANCE: msg("Maintenance"), OUT_OF_SERVICE: msg("Out of service") } as Record<string, string>)[x] ?? x;
  for (const h of statuses) ev.push({ at: h.changedAt.toISOString(), kind: "status", title: `${t(status(h.fromStatus))} → ${t(status(h.toStatus))}`, detail: h.note, by: h.changedBy?.fullName ?? t("System") });
  for (const st of stays) {
    const who = st.reservation.guest.fullName, href = `/staff/reservations/${st.reservation.id}`;
    if (st.checkedInAt) ev.push({ at: st.checkedInAt.toISOString(), kind: "in", title: t("{name} checked in", { name: who }), detail: st.reservation.reference, by: st.checkedInBy?.fullName, href });
    if (st.checkedOutAt) ev.push({ at: st.checkedOutAt.toISOString(), kind: "out", title: t("{name} checked out", { name: who }), detail: st.reservation.reference, by: st.checkedOutBy?.fullName, href });
  }
  for (const m of moves) ev.push({ at: m.changedAt.toISOString(), kind: "move", title: t("Guest moved {from} → {to}", { from: m.fromRoom.number, to: m.toRoom.number }), detail: m.reason, by: m.changedBy?.fullName, amount: m.charged || null });
  if (r) {
    for (const c of r.charges) ev.push({ at: c.createdAt.toISOString(), kind: "charge", title: `${t(group(c.kind))} · ${c.description}`, by: c.createdById ? staff.get(c.createdById) : t("Guest (online)"), amount: c.amount });
    for (const p of r.payments) ev.push({ at: p.receivedAt.toISOString(), kind: "payment", title: t(p.kind === "REFUND" ? msg("Refund given") : p.status === "REVERSED" ? msg("Payment (reversed)") : msg("Payment received")), detail: `${p.method.name} · ${p.account.name}`, by: p.recordedBy.fullName, amount: p.kind === "REFUND" ? -p.amount : p.amount });
    for (const o of r.restaurantOrders) ev.push({ at: o.createdAt.toISOString(), kind: "order", title: t("Order {number}", { number: o.number }), detail: o.items.map((i) => `${i.quantity} × ${i.name}`).join(", "), amount: o.total });
    for (const a of audits) ev.push({ at: a.createdAt.toISOString(), kind: "change", title: AUDIT_WORDS[a.action] ? t(AUDIT_WORDS[a.action]) : a.action, by: a.user?.fullName ?? a.actorLabel });
  }

  // The live status staff read at a glance.
  const inRepair = room.status === "MAINTENANCE" || room.status === "OUT_OF_SERVICE";
  const occupied = focusRR?.status === "CHECKED_IN";
  const overdue = occupied && now > (focusRR!.lateCheckoutUntil ?? focusRR!.endAt);
  const dueToday = occupied && fromDbDate(focusRR!.departureDate) === today;
  const live = inRepair ? room.status
    : occupied ? (overdue ? "OVERDUE" : dueToday ? "DUE_OUT" : "OCCUPIED")
    : focusRR ? "ARRIVING"
    : room.status === "DIRTY" || room.status === "CLEANING" || room.status === "READY" ? room.status : "AVAILABLE";

  return {
    room: { ...room, statusChangedAt: room.statusChangedAt.toISOString() },
    live, overdue, meeting: room.roomType.category === "MEETING_ROOM",
    stay: focusRR && r ? {
      reservationId: r.id, reference: r.reference, status: focusRR.status, inHouse: occupied,
      guest: r.guest, company: r.companyName, groupName: r.group?.name ?? null, guestToken: r.guestToken,
      adults: focusRR.adults, children: focusRR.children,
      checkIn: (focusRR.checkedInAt ?? focusRR.startAt).toISOString(), checkedInBy: focusRR.checkedInBy?.fullName ?? null, checkedIn: !!focusRR.checkedInAt,
      checkOut: (focusRR.lateCheckoutUntil ?? focusRR.endAt).toISOString(), arrival: fromDbDate(focusRR.arrivalDate), departure: fromDbDate(focusRR.departureDate),
      nights: focusRR.isDayUse ? 0 : focusRR.nights, rate: focusRR.ratePerNight, discountPerNight: focusRR.discountPerNight,
      roomGross: focusRR.grossAmount, roomDiscount: focusRR.discountAmount, roomNet: focusRR.netAmount,
      requests: r.specialRequests, notes: r.internalNotes,
      startAt: focusRR.startAt.toISOString(), endAt: focusRR.endAt.toISOString(),
      // How far through the stay we are (0–1), for the progress bar.
      progress: occupied ? Math.min(1, Math.max(0.02, (now.getTime() - (focusRR.checkedInAt ?? focusRR.startAt).getTime()) / Math.max(1, (focusRR.lateCheckoutUntil ?? focusRR.endAt).getTime() - (focusRR.checkedInAt ?? focusRR.startAt).getTime()))) : null,
    } : null,
    bill,
    orders: r ? r.restaurantOrders.map((o) => ({ ...o, createdAt: o.createdAt.toISOString(), items: o.items.map((i) => `${i.quantity} × ${i.name}`) })) : [],
    timeline: ev.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60),
    timezone: s.timezone,
  };
}
export type RoomControl = NonNullable<Awaited<ReturnType<typeof roomControl>>>;
