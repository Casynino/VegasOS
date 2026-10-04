import "server-only";
import { db } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { businessToday } from "../settings";
import { formatBusinessDate } from "@/lib/format";
import { fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { Actor } from "./reservations";

/**
 * A manager's (or the MD's) say over when a room can be sold: close it for dates ahead (painting,
 * a big repair) or cancel such a closure. Closing a room now is a status change (maintenance /
 * out of service, see rooms.ts); this plans it. Bookings in those dates must be moved first —
 * the closure never silently overlaps a guest.
 */

const canClose = (a: Actor) => !!a.permissions?.has("rooms.block");

export async function planRoomClosure(input: { roomId: string; from: BusinessDate; to: BusinessDate; type: "MAINTENANCE" | "OUT_OF_SERVICE"; reason: string }, actor: Actor) {
  if (!actor.userId || !canClose(actor)) throw new AppError("Only a manager or the MD closes rooms.", "FORBIDDEN");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AppError("Say why the room is closed (e.g. painting, new AC).", "VALIDATION", { reason: "Required" });
  const today = await businessToday();
  if (input.from < today) throw new AppError("The closure cannot start in the past.", "VALIDATION", { from: "Past" });
  if (input.to <= input.from) throw new AppError("The room opens again after the closure starts — choose a later date.", "VALIDATION", { to: "Too early" });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "rooms" WHERE "id" = ${input.roomId} FOR UPDATE`;
    const room = await tx.room.findUnique({ where: { id: input.roomId } });
    if (!room || !room.isActive) throw new AppError("Room not found.", "NOT_FOUND");
    // Guests booked in those dates come first: move them, then close.
    const clash = await tx.reservationRoom.findMany({
      where: { roomId: room.id, status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] }, arrivalDate: { lt: toDbDate(input.to) }, departureDate: { gt: toDbDate(input.from) } },
      select: { reservation: { select: { reference: true, companyName: true, guest: { select: { fullName: true } } } }, arrivalDate: true },
    });
    if (clash.length) {
      throw new AppError(`Room ${room.number} is booked in those dates: ${clash.map((c) => `${c.reservation.companyName ?? c.reservation.guest.fullName} (${c.reservation.reference}, ${formatBusinessDate(fromDbDate(c.arrivalDate))})`).join(", ")}. Move ${clash.length === 1 ? "that booking" : "those bookings"} to another room first.`, "CONFLICT");
    }
    const overlap = await tx.roomBlock.count({ where: { roomId: room.id, startDate: { lt: toDbDate(input.to) }, OR: [{ endDate: null }, { endDate: { gt: toDbDate(input.from) } }] } });
    if (overlap) throw new AppError(`Room ${room.number} is already closed for part of those dates.`, "CONFLICT");
    const block = await tx.roomBlock.create({
      data: { roomId: room.id, type: input.type, startDate: toDbDate(input.from), endDate: toDbDate(input.to), reason, createdById: actor.userId },
    });
    await audit(tx, actor, {
      action: "room.closure_planned", entityType: "Room", entityId: room.id,
      after: { number: room.number, from: input.from, until: input.to, type: input.type, reason },
    });
    return { id: block.id, number: room.number };
  });
}

/** Cancel a planned closure (or cut a running one short) — the room can be sold again from today. */
export async function cancelRoomClosure(blockId: string, reason: string, actor: Actor, now = new Date()) {
  if (!actor.userId || !canClose(actor)) throw new AppError("Only a manager or the MD opens rooms.", "FORBIDDEN");
  const today = await businessToday(now);
  return db.$transaction(async (tx) => {
    const b = await tx.roomBlock.findUnique({ where: { id: blockId }, include: { room: { select: { number: true, status: true } } } });
    if (!b) throw new AppError("Closure not found.", "NOT_FOUND");
    if (b.endDate && fromDbDate(b.endDate) <= today) throw new AppError("This closure is already over.");
    if (b.endDate === null) throw new AppError(`Room ${b.room.number} is closed now — use "Fixed" on the room to open it.`);
    const start = fromDbDate(b.startDate);
    const end = start > today ? start : today; // not started: nothing left; running: ends today
    await tx.roomBlock.update({ where: { id: b.id }, data: { endDate: toDbDate(end), closedAt: now } });
    await audit(tx, actor, {
      action: "room.closure_cancelled", entityType: "Room", entityId: b.roomId,
      before: { number: b.room.number, from: start, until: fromDbDate(b.endDate) }, after: { until: end, reason: reason.trim() || null },
    });
    return { number: b.room.number };
  });
}
