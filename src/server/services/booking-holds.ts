import "server-only";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, isExclusionViolation } from "../errors";
import { msgf } from "@/i18n/msg";
import { readerT } from "./rooms";
import { getSettingsTx } from "../settings";
import type { HotelSettings, Prisma } from "@/generated/prisma/client";
import { findAvailableRooms, lockRoomTypes } from "./availability";
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
 *
 * BOOK NOW, PAY LATER (owner, 2026-10-05) — a guest who books online (the website, the Hotel QR) and chooses to pay
 * later gets a real booking that reception sees, but NO room is held for it (status INQUIRY): the room stays free for
 * everyone, and whoever pays first gets it. When that guest pays, the room is checked again first — the same room if it
 * is still free, otherwise another free room of the same type, otherwise "sorry, it was just taken" — and it is held
 * while the payment is made (the same 30 minutes as Pay now); nTZS confirms the money → CONFIRMED. Not paid in time →
 * back to pay later (never cancelled). Such a booking carries the mark `externalData.payLater`.
 */

const SYSTEM: Actor = { userId: null, label: "System (hold expired)" };

/** A booking made and paid online keeps its room this long while the guest pays — the payment confirms it. */
export const ONLINE_BOOKING_HOLD_MINUTES = 30;

/** The mark of a booking that holds its room only while it is being paid (book now, pay later). */
export const PAY_LATER_KEY = "payLater";
/** The mark of a desk enquiry that was sent a payment request: it holds its room only while it is paid, and stays an enquiry otherwise. */
const PAYING_HOLD_KEY = "payingHold";
const marked = (data: unknown, key: string) => !!data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>)[key] === true;
export const isPayLater = (data: unknown) => marked(data, PAY_LATER_KEY);
/** A booking that holds a room only while it is being paid (pay later, or a desk enquiry being paid): not paid → not held. */
const holdsOnlyWhilePaying = (data: unknown) => isPayLater(data) || marked(data, PAYING_HOLD_KEY);
export const PAY_LATER_WHERE = { externalData: { path: [PAY_LATER_KEY], equals: true } } satisfies Prisma.ReservationWhereInput;
/** The booking's own data with a mark added (what the public page kept stays). */
const withMark = (data: unknown, key: string): Prisma.InputJsonObject => ({ ...(data && typeof data === "object" && !Array.isArray(data) ? (data as Prisma.InputJsonObject) : {}), [key]: true });
/** The paying-hold mark taken off once that payment is over (paid, or not) — the data to write, or nothing to change. */
function withoutPayingHold(data: unknown): { externalData: Prisma.InputJsonObject } | Record<string, never> {
  if (!marked(data, PAYING_HOLD_KEY)) return {};
  return { externalData: Object.fromEntries(Object.entries(data as Prisma.InputJsonObject).filter(([k]) => k !== PAYING_HOLD_KEY)) as Prisma.InputJsonObject };
}

/** When an unpaid booking made now stops holding its room (null = no automatic expiry). */
export function holdDeadline(settings: Pick<HotelSettings, "unpaidHoldHours">, now = new Date()): Date | null {
  return settings.unpaidHoldHours > 0 ? new Date(now.getTime() + settings.unpaidHoldHours * 3_600_000) : null;
}

export type RoomMove = { from: string; to: string; type: string };

/**
 * The rooms of a booking that holds none yet (INQUIRY), checked again now under the room-type lock: each keeps its room
 * when that is still free — otherwise the first free room of the same type takes its place (its nights priced again by
 * the pricing engine for that room) — otherwise nobody can have it: "just taken". Returns the moves. The caller then
 * makes the rooms RESERVED / CONFIRMED / CHECKED_IN in the same transaction (the exclusion constraint guards that write).
 */
export async function secureRoomsTx(tx: Tx, reservationId: string, actor: Actor): Promise<RoomMove[]> {
  const rooms = await tx.reservationRoom.findMany({
    where: { reservationId, status: "INQUIRY" }, orderBy: { createdAt: "asc" },
    include: { room: { select: { number: true } }, roomType: { select: { name: true, category: true } } },
  });
  if (!rooms.length) return [];
  await lockRoomTypes(tx, rooms.map((r) => r.roomTypeId));
  const taken = new Set<string>();
  const moves: RoomMove[] = [];
  for (const rr of rooms) {
    const stay = { startAt: rr.startAt, endAt: rr.endAt, arrivalDate: fromDbDate(rr.arrivalDate), departureDate: fromDbDate(rr.departureDate), isDayUse: rr.isDayUse };
    if (!taken.has(rr.roomId) && (await findAvailableRooms({ stay, roomIds: [rr.roomId] }, tx)).length) {
      taken.add(rr.roomId);
      continue;
    }
    const other = (await findAvailableRooms({ stay, roomTypeId: rr.roomTypeId, category: rr.roomType.category }, tx)).find((f) => !taken.has(f.id));
    if (!other) {
      const t = await readerT();
      throw new AppError(msgf("Sorry — Room {room} was just taken for these dates, and no other {type} is free. Please choose again.", { room: rr.room.number, type: t(rr.roomType.name) }), "UNAVAILABLE");
    }
    taken.add(other.id);
    await tx.reservationRoom.update({ where: { id: rr.id }, data: { roomId: other.id } });
    // The new room's own price for the stay (a date price may be for some rooms only).
    await tx.roomNight.deleteMany({ where: { reservationRoomId: rr.id } });
    await syncRoomNights(tx, rr.id);
    // On the booking's room moves, like any other change of room.
    await tx.roomAssignment.create({
      data: {
        reservationRoomId: rr.id, fromRoomId: rr.roomId, toRoomId: other.id, reason: "Not held — taken by a guest who paid first; another room of the same type",
        source: "PAYMENT", changedById: actor.userId ?? null, fromTypeName: rr.roomType.name, toTypeName: rr.roomType.name,
      },
    });
    moves.push({ from: rr.room.number, to: other.number, type: rr.roomType.name });
  }
  if (moves.length) {
    await recalculateReservation(tx, reservationId);
    await audit(tx, actor, {
      action: "reservation.room_assigned", entityType: "Reservation", entityId: reservationId,
      before: { rooms: moves.map((m) => m.from) }, after: { rooms: moves.map((m) => m.to), reason: "Not held and taken before payment — another room of the same type" },
    });
  }
  return moves;
}

/** After a payment: a pending (or not held) booking becomes confirmed and stops expiring. */
export async function secureByPaymentTx(tx: Tx, reservationId: string, actor: Actor) {
  const r = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { rooms: true } });
  if (r.paidAmount <= 0) return false;
  if (!r.rooms.some((x) => x.status === "RESERVED" || x.status === "INQUIRY") && !r.holdUntil) return false;
  // A booking that held no room (pay later): its room is checked again first — the same one, another of its type, or refused.
  await secureRoomsTx(tx, r.id, actor);
  const waiting = await tx.reservationRoom.findMany({ where: { reservationId, status: { in: ["RESERVED", "INQUIRY"] } }, include: { room: { select: { number: true } } } });
  try {
    for (const rr of waiting) {
      await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "CONFIRMED" } });
      await syncRoomNights(tx, rr.id);
    }
  } catch (e) {
    if (isExclusionViolation(e)) throw new AppError("This booking's room now has another booking — choose another room before receiving payment.", "UNAVAILABLE");
    throw e;
  }
  await tx.reservation.update({ where: { id: r.id }, data: { holdUntil: null, confirmedAt: r.confirmedAt ?? new Date(), ...withoutPayingHold(r.externalData) } });
  await recalculateReservation(tx, r.id);
  if (waiting.length) {
    await audit(tx, actor, {
      action: "reservation.confirmed_by_payment", entityType: "Reservation", entityId: r.id,
      before: { status: r.status, holdUntil: r.holdUntil }, after: { status: "CONFIRMED", paid: r.paidAmount, rooms: waiting.map((x) => x.room.number) },
    });
  }
  return true;
}

/** A pay-later booking stops holding its room (the paying hold ran out, the payment did not start, the money went back). */
async function backToPayLaterTx(tx: Tx, reservationId: string, actor: Actor, reason: string) {
  const held = await tx.reservationRoom.findMany({ where: { reservationId, status: { in: ["RESERVED", "CONFIRMED"] } }, include: { room: { select: { number: true } } } });
  for (const rr of held) {
    await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "INQUIRY" } });
    await syncRoomNights(tx, rr.id);
  }
  const before = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, select: { status: true, holdUntil: true, externalData: true } });
  await tx.reservation.update({ where: { id: reservationId }, data: { holdUntil: null, ...withoutPayingHold(before.externalData) } });
  await recalculateReservation(tx, reservationId);
  await audit(tx, actor, {
    action: "reservation.back_to_pay_later", entityType: "Reservation", entityId: reservationId,
    before: { status: before.status, holdUntil: before.holdUntil }, after: { status: "INQUIRY", reason, rooms: held.map((x) => x.room.number) },
  });
}

/** After a reversal / refund: if nothing is paid any more, a guest-paid booking that has not arrived is pending again. */
export async function reopenHoldTx(tx: Tx, reservationId: string, actor: Actor) {
  const r = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, include: { rooms: true } });
  if (r.paidAmount > 0 || r.billTo !== "GUEST") return false;
  const confirmed = r.rooms.filter((x) => x.status === "CONFIRMED");
  if (confirmed.length === 0) return false;
  // Booked to pay later (or an enquiry paid since): without its payment it holds no room again (whoever pays first gets it).
  if (holdsOnlyWhilePaying(r.externalData)) {
    await backToPayLaterTx(tx, r.id, actor, "No payment left on the booking — the room is not held");
    return true;
  }
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

export type PayingHold = {
  /** The booking held no room and now holds one while it is paid. */
  held: boolean;
  /** Rooms it had to change (its room was taken; another of the same type). */
  moves: RoomMove[];
  /** The booking's total before and after (a new room can have another price). */
  before: number; after: number;
  holdUntil: Date | null;
};

/**
 * About to be paid online (the guest's Pay now, a payment request reception sends): a booking that holds no room yet is
 * checked again — its room, else another free room of the same type, else "just taken" — and holds it while the payment
 * is made (ONLINE_BOOKING_HOLD_MINUTES; a live payment request keeps it longer). Paid → confirmed by the payment; not
 * paid in time → back to not holding its room. Any other booking is left as it is.
 */
export async function holdForPayment(reservationId: string, actor: Actor, now = new Date()): Promise<PayingHold> {
  const was = await db.reservation.findUnique({ where: { id: reservationId }, select: { status: true, netAmount: true } });
  if (!was || was.status !== "INQUIRY") return { held: false, moves: [], before: was?.netAmount ?? 0, after: was?.netAmount ?? 0, holdUntil: null };
  // Holds whose time ran out are let go first — a lapsed hold never makes this guest's room look "just taken".
  await expireUnpaidHolds(now);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
      const r = await tx.reservation.findUnique({ where: { id: reservationId }, select: { status: true, netAmount: true, externalData: true } });
      if (!r || r.status !== "INQUIRY") return { held: false, moves: [], before: r?.netAmount ?? 0, after: r?.netAmount ?? 0, holdUntil: null };
      const moves = await secureRoomsTx(tx, reservationId, actor);
      const rooms = await tx.reservationRoom.findMany({ where: { reservationId, status: "INQUIRY" }, include: { room: { select: { number: true } } } });
      for (const rr of rooms) {
        await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "RESERVED" } });
        await syncRoomNights(tx, rr.id);
      }
      const holdUntil = new Date(now.getTime() + ONLINE_BOOKING_HOLD_MINUTES * 60_000);
      // Not paid in time → it stops holding the room again: a pay-later booking stays pay later, a desk enquiry an enquiry.
      await tx.reservation.update({ where: { id: reservationId }, data: { holdUntil, ...(!holdsOnlyWhilePaying(r.externalData) && { externalData: withMark(r.externalData, PAYING_HOLD_KEY) }) } });
      await recalculateReservation(tx, reservationId);
      const after = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId }, select: { netAmount: true } });
      await audit(tx, actor, {
        action: "reservation.paying_hold", entityType: "Reservation", entityId: reservationId,
        before: { status: "INQUIRY", net: r.netAmount },
        after: { status: "RESERVED", holdUntil, rooms: rooms.map((x) => x.room.number), net: after.netAmount, ...(moves.length && { moved: moves.map((m) => `${m.from} → ${m.to} (${m.type})`) }) },
      });
      return { held: true, moves, before: r.netAmount, after: after.netAmount, holdUntil };
    }, { timeout: 20_000, maxWait: 10_000 });
  } catch (e) {
    if (isExclusionViolation(e)) throw new AppError("Sorry — that room was just taken for these dates. Please choose again.", "UNAVAILABLE");
    throw e;
  }
}

/**
 * The payment ended without money (refused, a wrong number, stopped by the guest, declined on the phone): a booking that
 * holds its room only while it is paid stops holding it at once — no live request, no payment. `payNow`: a booking made
 * with Pay now whose request never reached the phone is let go the same way (kept as a booking to pay later — Pay now
 * again checks the room again), so a number that cannot pay never keeps a room for the 30 minutes.
 */
export async function releasePayingHold(reservationId: string, actor: Actor = SYSTEM, now = new Date(), opts: { payNow?: boolean; reason?: string } = {}) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
    const r = await tx.reservation.findUnique({ where: { id: reservationId }, select: { status: true, paidAmount: true, billTo: true, externalData: true } });
    if (!r || r.status !== "RESERVED" || r.paidAmount > 0 || r.billTo !== "GUEST") return;
    if (!holdsOnlyWhilePaying(r.externalData) && !opts.payNow) return;
    if (await tx.mobilePayment.count({ where: { reservationId, status: "PENDING", completedAt: null, expiresAt: { gt: now } } })) return;
    if (!holdsOnlyWhilePaying(r.externalData)) await tx.reservation.update({ where: { id: reservationId }, data: { externalData: withMark(r.externalData, PAY_LATER_KEY) } });
    await backToPayLaterTx(tx, reservationId, actor, opts.reason ?? "The payment did not start — the room is not held");
  });
}

/**
 * Release rooms held by unpaid bookings whose hold time has passed. Cheap and
 * safe to call often (booking screens, availability checks, the nightly job).
 * A pay-later booking goes back to not holding its room; any other is cancelled.
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
      if (holdsOnlyWhilePaying(r.externalData)) {
        await backToPayLaterTx(tx, id, SYSTEM, "Not paid in time — back to pay later, the room is not held");
        expired++;
        return;
      }
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
 * for one more day's cut-off. A pay-later booking (no room held, nothing paid) that
 * nobody arrived for is closed instead.
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
  return marked + (await closeUnpaidPayLater(now, settings, today));
}

const SYSTEM_NOSHOW: Actor = { userId: null, label: "System (no-show cut-off)", permissions: new Set(["reservations.cancel"]) };

/** Pay-later bookings nobody paid for or arrived for, past the arrival day's cut-off: closed (no room was held). */
async function closeUnpaidPayLater(now: Date, settings: HotelSettings, today: BusinessDate) {
  const candidates = await db.reservation.findMany({
    where: { status: "INQUIRY", paidAmount: { lte: 0 }, arrivalDate: { lte: toDbDate(today) }, ...PAY_LATER_WHERE },
    select: { id: true, arrivalDate: true, lateArrivalNotedAt: true },
    take: 200,
  });
  let closed = 0;
  for (const c of candidates) {
    const arrival = fromDbDate(c.arrivalDate);
    if (now < noShowCutoff(c.lateArrivalNotedAt ? addDays(arrival, 1) : arrival, settings)) continue;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${c.id} FOR UPDATE`;
      const r = await tx.reservation.findUniqueOrThrow({ where: { id: c.id }, include: { rooms: { include: { room: { select: { number: true } } } } } });
      if (r.status !== "INQUIRY" || r.paidAmount > 0) return;
      const open = r.rooms.filter((x) => x.status === "INQUIRY");
      for (const rr of open) {
        await tx.reservationRoom.update({ where: { id: rr.id }, data: { status: "CANCELLED" } });
        await syncRoomNights(tx, rr.id);
      }
      const reason = "Not paid and did not arrive — closed at the no-show cut-off";
      await tx.reservation.update({ where: { id: r.id }, data: { cancelledAt: now, cancelReason: reason } });
      await recalculateReservation(tx, r.id);
      await audit(tx, SYSTEM_NOSHOW, {
        action: "reservation.pay_later_closed", entityType: "Reservation", entityId: r.id,
        before: { status: "INQUIRY" }, after: { status: "CANCELLED", reason, rooms: open.map((x) => x.room.number) },
      });
      closed++;
    });
  }
  return closed;
}

/** Keep every booking's state current: lapse unpaid holds, apply the no-show cut-off. */
export async function refreshBookingStates(now = new Date()) {
  await expireUnpaidHolds(now);
  await processNoShows(now);
}
