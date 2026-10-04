import "server-only";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, isExclusionViolation } from "../errors";
import { getSettingsTx } from "../settings";
import type { HotelSettings } from "@/generated/prisma/client";
import { recalculateReservation, syncRoomNights } from "./reservation-financials";
import type { Actor } from "./reservations";
import { markNoShowTx } from "./reservations";
import { addDays, businessDateOf, fromDbDate, toDbDate, zonedInstant, type BusinessDate } from "@/lib/time/business-date";

/**
 * Booking holds — payment is what secures a room.
 *
 *  PENDING (status RESERVED): accepted but not paid. The room is held only
 *    until `holdUntil`; then the booking lapses and the room is free again.
 *  CONFIRMED: paid (any amount), billed to a company, or confirmed by a
 *    manager without payment. The room is reserved for the guest's dates.
 *
 * A payment turns a pending booking into a confirmed one straight away. If the
 * only payment is later reversed or refunded, the booking is pending again.
 */

const SYSTEM: Actor = { userId: null, label: "System (hold expired)" };

/** When an unpaid booking made now stops holding its room (null = no automatic expiry). */
export function holdDeadline(settings: Pick<HotelSettings, "unpaidHoldHours">, now = new Date()): Date | null {
  return settings.unpaidHoldHours > 0 ? new Date(now.getTime() + settings.unpaidHoldHours * 3_600_000) : null;
}

/** After a payment: a pending (or enquiry) booking becomes confirmed and stops expiring. */
export async function secureByPaymentTx(tx: Tx, reservationId: string, actor: Actor) {
  const r = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { rooms: { include: { room: true } } } });
  if (r.paidAmount <= 0) return false;
  const waiting = r.rooms.filter((x) => x.status === "RESERVED" || x.status === "INQUIRY");
  if (waiting.length === 0 && !r.holdUntil) return false;
  try {
    for (const rr of waiting) {
      await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "CONFIRMED" } });
      await syncRoomNights(tx, rr.id);
    }
  } catch (e) {
    if (isExclusionViolation(e)) throw new AppError("This enquiry's room now has another booking — choose another room before receiving payment.", "UNAVAILABLE");
    throw e;
  }
  await tx.reservation.update({ where: { id: r.id }, data: { holdUntil: null, confirmedAt: r.confirmedAt ?? new Date() } });
  await recalculateReservation(tx, r.id);
  if (waiting.length) {
    await audit(tx, actor, {
      action: "reservation.confirmed_by_payment", entityType: "Reservation", entityId: r.id,
      before: { status: r.status, holdUntil: r.holdUntil }, after: { status: "CONFIRMED", paid: r.paidAmount, rooms: waiting.map((x) => x.room.number) },
    });
  }
  return true;
}

/** After a reversal / refund: if nothing is paid any more, a guest-paid booking that has not arrived is pending again. */
export async function reopenHoldTx(tx: Tx, reservationId: string, actor: Actor) {
  const r = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { rooms: true } });
  if (r.paidAmount > 0 || r.billTo !== "GUEST") return false;
  const confirmed = r.rooms.filter((x) => x.status === "CONFIRMED");
  if (confirmed.length === 0) return false;
  const settings = await getSettingsTx(tx);
  for (const rr of confirmed) await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "RESERVED" } });
  const holdUntil = holdDeadline(settings);
  await tx.reservation.update({ where: { id: r.id }, data: { holdUntil } });
  await recalculateReservation(tx, r.id);
  await audit(tx, actor, {
    action: "reservation.back_to_pending", entityType: "Reservation", entityId: r.id,
    before: { status: "CONFIRMED" }, after: { status: "RESERVED", holdUntil, reason: "No payment left on the booking" },
  });
  return true;
}

/**
 * Release rooms held by unpaid bookings whose hold time has passed. Cheap and
 * safe to call often (booking screens, availability checks, the nightly job).
 */
export async function expireUnpaidHolds(now = new Date()) {
  // (A booking whose guest is paying online right now keeps its room until that payment ends.)
  const paying = { mobilePayments: { none: { status: "PENDING" as const, completedAt: null, expiresAt: { gt: now } } } };
  const due = await db.reservation.findMany({
    where: { status: "RESERVED", holdUntil: { lt: now }, paidAmount: { lte: 0 }, ...paying },
    select: { id: true },
    take: 200,
  });
  let expired = 0;
  for (const { id } of due) {
    // Paid online but not recorded yet (a confirmation that went astray)? Ask nTZS first — a booking that is paid is
    // never released. (Outside the booking's lock; loaded here to avoid an import cycle.)
    const unrecorded = await db.mobilePayment.findMany({
      where: { reservationId: id, completedAt: null, depositId: { not: null }, status: { in: ["PENDING", "EXPIRED", "FAILED", "CANCELLED"] } },
      select: { id: true }, orderBy: { createdAt: "desc" }, take: 3,
    });
    if (unrecorded.length) {
      const { checkMobilePayment } = await import("./mobile-payments");
      for (const m of unrecorded) await checkMobilePayment(m.id, "sweep", now).catch(() => null);
    }
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${id} FOR UPDATE`;
      const r = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { rooms: { include: { room: true } } } });
      if (r.status !== "RESERVED" || !r.holdUntil || r.holdUntil >= now || r.paidAmount > 0) return;
      if (await tx.mobilePayment.count({ where: { reservationId: id, status: "PENDING", completedAt: null, expiresAt: { gt: now } } })) return;
      const held = r.rooms.filter((x) => x.status === "RESERVED" || x.status === "INQUIRY");
      for (const rr of held) {
        await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "CANCELLED" } });
        await syncRoomNights(tx, rr.id);
      }
      const reason = "Not paid in time — the room hold expired";
      await tx.reservation.update({ where: { id }, data: { cancelledAt: now, cancelReason: reason } });
      await recalculateReservation(tx, id);
      await audit(tx, SYSTEM, {
        action: "reservation.hold_expired", entityType: "Reservation", entityId: id,
        before: { status: r.status, holdUntil: r.holdUntil }, after: { status: "CANCELLED", reason, rooms: held.map((x) => x.room.number) },
      });
      expired++;
    });
  }
  return expired;
}

/**
 * The no-show cut-off for an arrival day. A time before the business-day start
 * (e.g. 01:00 when the hotel day starts at 04:00) means the night after arrival.
 */
export function noShowCutoff(arrival: BusinessDate, settings: Pick<HotelSettings, "noShowCutoffMinutes" | "businessDayStartMinutes" | "timezone">): Date {
  const m = settings.noShowCutoffMinutes;
  return zonedInstant(m < settings.businessDayStartMinutes ? addDays(arrival, 1) : arrival, m, settings.timezone);
}

/**
 * At the cut-off, bookings nobody arrived for become NO SHOW (the room stays held
 * until released, see markNoShowTx). A late-arrival notice keeps the booking active
 * for one more day's cut-off.
 */
export async function processNoShows(now = new Date()) {
  const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  const today = businessDateOf(now, { timezone: settings.timezone, businessDayStartMinutes: settings.businessDayStartMinutes });
  const candidates = await db.reservation.findMany({
    where: { status: { in: ["RESERVED", "CONFIRMED"] }, arrivalDate: { lte: toDbDate(today) } },
    select: { id: true, arrivalDate: true, lateArrivalNotedAt: true, rooms: { select: { status: true, arrivalDate: true } } },
    take: 200,
  });
  let marked = 0;
  for (const c of candidates) {
    const waiting = c.rooms.filter((x) => x.status === "RESERVED" || x.status === "CONFIRMED");
    if (waiting.length === 0) continue;
    const arrival = waiting.map((x) => fromDbDate(x.arrivalDate)).sort().at(-1)!;
    const late = !!c.lateArrivalNotedAt;
    const cutoff = noShowCutoff(late ? addDays(arrival, 1) : arrival, settings);
    if (now < cutoff) continue;
    try {
      await db.$transaction((tx) => markNoShowTx(tx, c.id, SYSTEM_NOSHOW, now, { auto: true }), { timeout: 20_000, maxWait: 10_000 });
      marked++;
    } catch (e) {
      if (!(e instanceof AppError)) throw e; // e.g. just checked in by someone else
    }
  }
  return marked;
}

const SYSTEM_NOSHOW: Actor = { userId: null, label: "System (no-show cut-off)", permissions: new Set(["reservations.cancel"]) };

/** Keep every booking's state current: lapse unpaid holds, apply the no-show cut-off. */
export async function refreshBookingStates(now = new Date()) {
  await expireUnpaidHolds(now);
  await processNoShows(now);
}
