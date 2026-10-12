import "server-only";
import { type Tx } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { msg, msgf } from "@/i18n/msg";
import { fromDbDate } from "@/lib/time/business-date";
import { findConflicts, WEEKDAYS } from "@/lib/pricing";

/**
 * Pricing safety for Admin: two promotions (or two date prices) with the same
 * priority may not cover the same room on the same night — the system refuses
 * to save instead of guessing which one wins.
 */

type Candidate = {
  id: string; name: string; scope: "ALL" | "ROOM_TYPES" | "ROOMS"; roomTypeIds: string[]; roomIds: string[];
  startDate: string | null; endDate: string | null; daysOfWeek: number[]; priority: number; channel?: "ALL" | "WEBSITE" | "STAFF";
};

async function roomTypeOf(tx: Tx) {
  const rooms = await tx.room.findMany({ select: { id: true, roomTypeId: true } });
  const map = new Map(rooms.map((r) => [r.id, r.roomTypeId]));
  return (id: string) => map.get(id);
}

const when = (c: { startDate: string | null; endDate: string | null; daysOfWeek: number[] }) =>
  `${c.startDate ?? "…"} → ${c.endDate ?? "…"}${c.daysOfWeek.length ? ` (${c.daysOfWeek.map((d) => WEEKDAYS[d]).join(", ")})` : ""}`;

export async function assertNoPromotionConflict(tx: Tx, c: Candidate) {
  const others = (await tx.promotion.findMany({ where: { isActive: true } })).map((p) => ({
    id: p.id, name: p.name, scope: p.scope, roomTypeIds: p.roomTypeIds, roomIds: p.roomIds, channel: p.channel,
    startDate: p.startDate ? fromDbDate(p.startDate) : null, endDate: p.endDate ? fromDbDate(p.endDate) : null, daysOfWeek: p.daysOfWeek, priority: p.priority,
  }));
  const clash = findConflicts(c, others, await roomTypeOf(tx));
  if (clash.length) {
    throw new AppError(
      msgf("Pricing conflict: “{name}” ({when}) has the same priority ({priority}) and covers the same rooms on some of the same nights. Give one a higher priority, or change the dates or rooms.", { name: clash[0].name, when: when(clash[0]), priority: c.priority }),
      "CONFLICT", { priority: msg("Conflict") },
    );
  }
}

export async function assertNoPriceRuleConflict(tx: Tx, c: Candidate) {
  const others = (await tx.priceRule.findMany({ where: { isActive: true } })).map((r) => ({
    id: r.id, name: r.name, scope: r.scope, roomTypeIds: r.roomTypeIds, roomIds: r.roomIds,
    startDate: fromDbDate(r.startDate), endDate: fromDbDate(r.endDate), daysOfWeek: r.daysOfWeek, priority: r.priority,
  }));
  const clash = findConflicts(c, others, await roomTypeOf(tx));
  if (clash.length) {
    throw new AppError(
      msgf("Pricing conflict: date price “{name}” ({when}) has the same priority ({priority}) for the same rooms and nights. Give one a higher priority, or change the dates or rooms.", { name: clash[0].name, when: when(clash[0]), priority: c.priority }),
      "CONFLICT", { priority: msg("Conflict") },
    );
  }
}

/**
 * A room type's own staff discount limit per night (null = it follows the hotel's limit). It decides the most
 * staff may take off a night from now on; a discount a booking already has is not touched. Written to the audit log.
 */
export async function setRoomTypeDiscountLimit(tx: Tx, roomTypeId: string, limit: number | null, actor: AuditActor): Promise<{ changed: boolean }> {
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new AppError("Enter a valid amount.");
  const before = await tx.roomType.findUnique({ where: { id: roomTypeId }, select: { id: true, name: true, manualDiscountMax: true } });
  if (!before) throw new AppError("Room type not found.", "NOT_FOUND");
  if (before.manualDiscountMax === limit) return { changed: false };
  await tx.roomType.update({ where: { id: before.id }, data: { manualDiscountMax: limit } });
  await audit(tx, actor, {
    action: "pricing.room_discount_limit", entityType: "RoomType", entityId: before.id,
    before: { name: before.name, manualDiscountMax: before.manualDiscountMax }, after: { name: before.name, manualDiscountMax: limit },
  });
  return { changed: true };
}
