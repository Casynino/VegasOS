import "server-only";
import { type Tx } from "../db";
import { AppError } from "../errors";
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
      `Pricing conflict: “${clash[0].name}” (${when(clash[0])}) has the same priority (${c.priority}) and covers the same rooms on some of the same nights. Give one a higher priority, or change the dates or rooms.`,
      "CONFLICT", { priority: "Conflict" },
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
      `Pricing conflict: date price “${clash[0].name}” (${when(clash[0])}) has the same priority (${c.priority}) for the same rooms and nights. Give one a higher priority, or change the dates or rooms.`,
      "CONFLICT", { priority: "Conflict" },
    );
  }
}
