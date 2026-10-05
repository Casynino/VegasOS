import "server-only";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, isExclusionViolation } from "../errors";
import { getSettingsTx, stayConfig } from "../settings";
import { businessDateOf, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { shortTimeRate } from "@/lib/short-time";
import { CHECK_IN_READY } from "@/lib/room-status";
import { HOTEL_MOVE_REASONS, moveReasonLabel, type DowngradeChoice, type MoveSource } from "@/lib/room-change";
import { findAvailableRooms, lockRoomTypes } from "./availability";
import { channelFor, quoteStay } from "./pricing";
import { recalculateReservation, syncRoomNights } from "./reservation-financials";
import { recordPaymentTx } from "./payments";
import { setRoomStatusTx } from "./rooms";
import type { Actor } from "./reservations";
import { notifyReservationGuestSoon } from "./guest-comms";

/**
 * Room changes — the same reservation, the same guest, the same payments; only
 * the room changes, and the move is recorded (from → to, why, the price the guest
 * was paying, what the new room normally costs, what was charged, who, when).
 *
 *  Before check-in (anyone at the desk, only availability matters):
 *   - dearer room → the stay is priced as the new room (discount rules applied); a paid
 *     booking pays the difference in the same step;
 *   - cheaper room → the price already agreed stays the same (no refund, no credit);
 *   - hotel moves the booking (room problem) → same price, no charge.
 *  After check-in: a guest cannot change room on request (check out and book again).
 *  The only move is for a problem in the room — free, anyone at the desk can do it:
 *   - nights already slept stay in the old room at their price (history untouched);
 *   - the remaining nights move to the new room, same price; the value of a better
 *     room is recorded as hotel compensation;
 *   - old room → maintenance for a fault (or cleaning / ready, as staff choose);
 *     new room → occupied.
 */

export interface RoomChangeQuote {
  inHouse: boolean;
  from: { roomId: string; number: string; type: string };
  to: { roomId: string; number: string; type: string; status: string };
  /** Nights that move to the new room (from `effectiveDate`). */
  dates: BusinessDate[];
  effectiveDate: BusinessDate;
  /** What the guest pays for those nights now, and the new room's applicable price for them (discount rules applied). */
  oldPrice: number;
  newPrice: number;
  difference: number;
  paid: number;
  /** Must the guest pay the difference now (paid booking or in the hotel, guest pays)? */
  payNow: boolean;
}

async function load(tx: Tx | typeof db, reservationRoomId: string) {
  const rr = await tx.reservationRoom.findUnique({
    where: { id: reservationRoomId },
    include: { room: true, roomType: true, nightsLedger: true, reservation: { include: { source: true, guest: true } } },
  });
  if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
  if (!["RESERVED", "CONFIRMED", "CHECKED_IN"].includes(rr.status)) throw new AppError("Only bookings waiting to arrive or in the hotel can change room.");
  return rr;
}

async function quoteTx(tx: Tx | typeof db, reservationRoomId: string, toRoomId: string, now: Date): Promise<RoomChangeQuote> {
  const rr = await load(tx, reservationRoomId);
  const to = await tx.room.findUnique({ where: { id: toRoomId }, include: { roomType: true } });
  if (!to || !to.isActive) throw new AppError("Room not found.", "NOT_FOUND");
  if (to.id === rr.roomId) throw new AppError("The guest is already in this room.");
  const settings = await (tx as Tx).hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  const today = businessDateOf(now, stayConfig(settings));
  const inHouse = rr.status === "CHECKED_IN";
  const all = rr.isDayUse ? [fromDbDate(rr.arrivalDate)] : eachDate(fromDbDate(rr.arrivalDate), fromDbDate(rr.departureDate));
  // After check-in only tonight and later nights move; before, the whole stay.
  const dates = inHouse && !rr.isDayUse ? all.filter((d) => d >= today) : all;
  const effectiveDate = dates[0] ?? today;
  const nightNet = new Map(rr.nightsLedger.map((n) => [fromDbDate(n.businessDate), n.netAmount]));
  const oldPrice = dates.reduce((s, d) => s + (nightNet.get(d) ?? 0), 0);
  let newPrice = 0;
  if (rr.isDayUse) newPrice = shortTimeRate(to.roomType.baseRate);
  else if (dates.length) {
    const q = await quoteStay(tx, { dates, base: to.roomType.baseRate, roomTypeId: to.roomTypeId, roomId: to.id, channel: channelFor(rr.reservation.source.code), manual: rr.discountPerNight });
    newPrice = q.net;
  }
  const r = rr.reservation;
  return {
    inHouse,
    from: { roomId: rr.roomId, number: rr.room.number, type: rr.roomType.name },
    to: { roomId: to.id, number: to.number, type: to.roomType.name, status: to.status },
    dates, effectiveDate, oldPrice, newPrice, difference: newPrice - oldPrice, paid: r.paidAmount,
    payNow: r.billTo === "GUEST" && (inHouse || r.paidAmount > 0),
  };
}

/** Price and availability of a move, before doing it (for the Change room screen). */
export async function quoteRoomChange(reservationRoomId: string, toRoomId: string, now = new Date()) {
  return quoteTx(db, reservationRoomId, toRoomId, now);
}

/** Rooms free for the rest of this stay, each with its price difference (for the Change room screen). */
export async function roomChangeOptions(reservationRoomId: string, now = new Date()) {
  const rr = await load(db, reservationRoomId);
  const inHouse = rr.status === "CHECKED_IN";
  const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  const window = moveWindow(rr, now, businessDateOf(now, stayConfig(settings)));
  const free = (await findAvailableRooms({ stay: window, excludeReservationRoomId: rr.id }))
    .filter((f) => f.id !== rr.roomId);
  const options = await Promise.all(free.map(async (f) => {
    const q = await quoteTx(db, rr.id, f.id, now);
    return {
      id: f.id, number: f.number, type: q.to.type, status: f.status, ready: CHECK_IN_READY.includes(f.status),
      nights: q.dates.length, newPrice: q.newPrice, difference: q.difference, perNight: q.dates.length ? Math.round(q.difference / q.dates.length) : q.difference,
    };
  }));
  // In the hotel: the guest walks in now, so the room must be clean and ready.
  return { inHouse, room: rr.room.number, type: rr.roomType.name, options: options.filter((o) => !inHouse || o.ready).sort((a, b) => a.difference - b.difference || a.number.localeCompare(b.number, undefined, { numeric: true })) };
}

function moveWindow(rr: { status: string; startAt: Date; endAt: Date; arrivalDate: Date; departureDate: Date; isDayUse: boolean }, now: Date, today: BusinessDate) {
  const inHouse = rr.status === "CHECKED_IN";
  return {
    startAt: inHouse ? now : rr.startAt,
    endAt: rr.endAt < now ? new Date(now.getTime() + 60_000) : rr.endAt,
    arrivalDate: inHouse ? today : fromDbDate(rr.arrivalDate),
    departureDate: fromDbDate(rr.departureDate),
    isDayUse: rr.isDayUse,
  };
}

export interface RoomChangeInput {
  reservationRoomId: string;
  toRoomId: string;
  source: MoveSource;
  /** Hotel moves: why (AC problem, plumbing…); OTHER needs a note. */
  reasonCode?: string | null;
  note?: string | null;
  /** Ignored: a cheaper room always keeps the price already agreed. */
  downgrade?: DowngradeChoice | null;
  /** Guest-requested upgrade: the difference, paid now ("pay difference & change room"). */
  payment?: { accountId?: string | null; methodId?: string | null; reference?: string | null } | null;
  /** Not used any more — the guest pays the extra to change room. */
  addToBill?: boolean;
  /** In the hotel: what the old room needs now (default: cleaning; maintenance for a room fault). */
  oldRoomStatus?: "DIRTY" | "MAINTENANCE" | "READY" | null;
}

export async function changeRoom(input: RoomChangeInput, actor: Actor, now = new Date()) {
  try {
    const res = await db.$transaction((tx) => changeRoomTx(tx, input, actor, now), { timeout: 20_000, maxWait: 10_000 });
    // The guest hears about the new room on WhatsApp (only with a provider; never blocks the move).
    notifyReservationGuestSoon(res.reservationId, "ROOM_CHANGED", { from: res.from, to: res.to });
    return res;
  } catch (e) {
    if (isExclusionViolation(e)) throw new AppError("This room is no longer available. Choose another room.", "UNAVAILABLE");
    throw e;
  }
}

export async function changeRoomTx(tx: Tx, input: RoomChangeInput, actor: Actor, now: Date) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  const settings = await getSettingsTx(tx);
  const today = businessDateOf(now, stayConfig(settings));
  const pre = await load(tx, input.reservationRoomId);
  await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${pre.reservationId} FOR UPDATE`;
  const toRoom = await tx.room.findUnique({ where: { id: input.toRoomId }, include: { roomType: true } });
  if (!toRoom || !toRoom.isActive) throw new AppError("Room not found.", "NOT_FOUND");
  await lockRoomTypes(tx, [pre.roomTypeId, toRoom.roomTypeId]);
  const rr = await load(tx, input.reservationRoomId);

  // Why.
  const hotel = input.source === "HOTEL";
  const reason = hotel ? HOTEL_MOVE_REASONS.find((r) => r.code === input.reasonCode) : null;
  if (hotel && !reason) throw new AppError("Choose why the hotel is moving the guest.", "VALIDATION", { reasonCode: "Required" });
  if (hotel && reason!.code === "OTHER" && !input.note?.trim()) throw new AppError("Describe the problem (e.g. AC stopped working and cannot be repaired today).", "VALIDATION", { note: "Required" });
  const reasonText = hotel ? `Hotel-initiated — ${reason!.label}${input.note?.trim() ? `: ${input.note.trim()}` : ""}` : `Customer requested${input.note?.trim() ? ` — ${input.note.trim()}` : ""}`;

  // Is the new room really free (and ready, when the guest walks in now)?
  const inHouse = rr.status === "CHECKED_IN";
  if (inHouse && !hotel) {
    throw new AppError("A checked-in guest cannot change room on request. They check out and make a new booking. Only a problem in the room allows a (free) move.", "FORBIDDEN");
  }
  const free = await findAvailableRooms({ stay: moveWindow(rr, now, today), roomIds: [toRoom.id], excludeReservationRoomId: rr.id }, tx);
  if (free.length === 0) throw new AppError(`Room ${toRoom.number} is no longer available for this stay. Choose another room.`, "UNAVAILABLE");
  if (inHouse && !CHECK_IN_READY.includes(toRoom.status)) throw new AppError(`Room ${toRoom.number} is not ready (${toRoom.status.toLowerCase().replace("_", " ")}) — the guest cannot move in yet.`);

  // Money: the system works it out.
  const q = await quoteTx(tx, rr.id, toRoom.id, now);
  const upgrade = !hotel && q.difference > 0;
  const downgrade = !hotel && q.difference < 0;
  // A cheaper room never lowers the price already agreed.
  const keepPrice = downgrade;
  const charged = upgrade ? q.difference : 0; // extra paid for a dearer room
  const compensation = hotel && q.difference > 0 ? q.difference : 0;
  if (upgrade && q.payNow) {
    // The guest pays the extra to change room.
    if (!input.payment) throw new AppError(`The guest must pay the difference of TZS ${q.difference.toLocaleString("en-TZ")} to change room.`, "VALIDATION", { payment: "Required" });
  }

  // Move the room.
  const reprice = !inHouse && upgrade;
  await tx.reservationRoom.update({
    where: { id: rr.id },
    data: { roomId: toRoom.id, roomTypeId: toRoom.roomTypeId, ...(reprice && { ratePerNight: rr.isDayUse ? shortTimeRate(toRoom.roomType.baseRate) : toRoom.roomType.baseRate }) },
  });
  if (reprice) {
    // Not arrived yet: the nights are only a price, so they are priced again as the new room.
    await tx.roomNight.deleteMany({ where: { reservationRoomId: rr.id } });
    await syncRoomNights(tx, rr.id);
  } else {
    // Nights keep their price; the nights that move now belong to the new room (slept nights stay in the old room).
    await tx.roomNight.updateMany({
      where: { reservationRoomId: rr.id, businessDate: { gte: toDbDate(q.effectiveDate) } },
      data: { roomId: toRoom.id, roomTypeId: toRoom.roomTypeId },
    });
    await syncRoomNights(tx, rr.id);
    if (charged !== 0) {
      await tx.reservationCharge.create({
        data: {
          reservationId: rr.reservationId, amount: charged, kind: "OTHER",
          category: charged > 0 ? "ROOM_UPGRADE" : "ROOM_CHANGE_CREDIT",
          description: charged > 0
            ? `Room upgrade ${rr.room.number} → ${toRoom.number} (${toRoom.roomType.name}), ${q.dates.length} night${q.dates.length === 1 ? "" : "s"}`
            : `Credit: moved to cheaper room ${rr.room.number} → ${toRoom.number}, ${q.dates.length} night${q.dates.length === 1 ? "" : "s"}`,
          businessDate: toDbDate(today), createdById: actor.userId,
        },
      });
    }
  }

  // Housekeeping: nobody may be put in the old room before it is checked; the new room is occupied.
  let oldStatus: string | null = null;
  const oldRoom = await tx.room.findUniqueOrThrow({ where: { id: rr.roomId } });
  if (inHouse) {
    oldStatus = input.oldRoomStatus ?? (reason?.maintenance ? "MAINTENANCE" : "DIRTY");
    await setRoomStatusTx(tx, rr.roomId, oldStatus === "READY" ? "READY" : oldStatus === "MAINTENANCE" ? "MAINTENANCE" : "DIRTY", actor,
      oldStatus === "MAINTENANCE" ? `${reason?.label ?? "Maintenance"}: guest moved to ${toRoom.number}` : `Guest moved to ${toRoom.number}`);
    await setRoomStatusTx(tx, toRoom.id, "OCCUPIED", actor, `Guest moved from ${rr.room.number}`);
  } else if (reason?.maintenance && oldRoom.status !== "OCCUPIED" && input.oldRoomStatus !== "READY") {
    oldStatus = "MAINTENANCE";
    await setRoomStatusTx(tx, rr.roomId, "MAINTENANCE", actor, `${reason.label}: booking ${rr.reservation.reference} moved to ${toRoom.number}`);
  }

  const move = await tx.roomAssignment.create({
    data: {
      reservationRoomId: rr.id, fromRoomId: rr.roomId, toRoomId: toRoom.id, reason: reasonText, source: input.source,
      reasonCode: reason?.code ?? null, effectiveDate: toDbDate(q.effectiveDate), nights: q.dates.length,
      fromTypeName: rr.roomType.name, toTypeName: toRoom.roomType.name, oldPrice: q.oldPrice, newStandardPrice: q.newPrice,
      charged, priceDifference: charged > 0 ? charged : null, compensation, oldRoomStatus: oldStatus, changedById: actor.userId, changedAt: now,
    },
  });
  await recalculateReservation(tx, rr.reservationId);

  // Pay the difference in the same step.
  if (upgrade && input.payment) {
    const after = await tx.reservation.findUniqueOrThrow({ where: { id: rr.reservationId } });
    const due = Math.min(q.difference, Math.max(0, after.balanceAmount));
    if (due > 0) await recordPaymentTx(tx, { reservationId: rr.reservationId, amount: due, accountId: input.payment.accountId, methodId: input.payment.methodId, reference: input.payment.reference ?? null, notes: `Room change ${rr.room.number} → ${toRoom.number}` }, actor);
  }

  // A free hotel move is flagged to management.
  if (hotel) {
    await tx.shiftHandoverNote.create({
      data: {
        businessDate: toDbDate(today), kind: "MANAGER", isImportant: true, authorId: actor.userId,
        body: `Room move ${rr.room.number} → ${toRoom.number} for ${rr.reservation.guest.fullName} (${rr.reservation.reference}): ${moveReasonLabel(reason!.code)}${input.note?.trim() ? ` — ${input.note.trim()}` : ""}. Free for the guest${compensation ? ` (value TZS ${compensation.toLocaleString("en-TZ")})` : ""}.${oldStatus === "MAINTENANCE" ? ` Room ${rr.room.number} set to maintenance.` : ""}`,
      },
    });
  }

  await audit(tx, actor, {
    action: "reservation.room_changed", entityType: "Reservation", entityId: rr.reservationId,
    before: { room: rr.room.number, type: rr.roomType.name, price: q.oldPrice },
    after: {
      room: toRoom.number, type: toRoom.roomType.name, standardPrice: q.newPrice, difference: q.difference, charged, compensation,
      source: hotel ? "Hotel-initiated" : "Customer requested", nights: q.dates.length, from: q.effectiveDate,
      discountPerNight: rr.discountPerNight, oldRoomStatus: oldStatus, reason: reasonText,
      ...(keepPrice && { downgrade: "Cheaper room — price stays the same" }),
    },
  });
  return { id: move.id, reservationId: rr.reservationId, from: rr.room.number, to: toRoom.number, charged, compensation, difference: q.difference };
}
