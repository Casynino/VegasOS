"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { toDbDate } from "@/lib/time/business-date";
import { assertNoPriceRuleConflict, assertNoPromotionConflict } from "@/server/services/pricing-admin";

/**
 * Room pricing — Admin only ("pricing.manage"). Changing a price or a
 * promotion affects new nights only: every booked night keeps the price it
 * was sold at. Every change is written to the audit log (who, what, when).
 */

function refresh() {
  revalidatePath("/staff/settings/pricing");
  revalidatePath("/staff/reservations/new");
  revalidatePath("/", "layout");
}

async function adminActor() {
  const user = await authorize("pricing.manage");
  const { ipAddress } = await requestMeta();
  return { user, actor: { userId: user.id, label: user.fullName, ipAddress } };
}

const PriceSchema = z.object({
  roomTypeId: z.string().min(1),
  baseRate: z.coerce.number().int("Whole shillings only.").min(1000, "The price looks too low.").max(10_000_000),
});

export async function updateRoomPriceAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { actor } = await adminActor();
    const input = parseInput(PriceSchema, formData);
    await db.$transaction(async (tx) => {
      const before = await tx.roomType.findUnique({ where: { id: input.roomTypeId } });
      if (!before) throw new AppError("Room type not found.", "NOT_FOUND");
      if (before.baseRate === input.baseRate) return;
      await tx.roomType.update({ where: { id: before.id }, data: { baseRate: input.baseRate } });
      await audit(tx, actor, {
        action: "pricing.rate_changed", entityType: "RoomType", entityId: before.id,
        before: { name: before.name, baseRate: before.baseRate }, after: { name: before.name, baseRate: input.baseRate },
      });
    });
    refresh();
    return null;
  }, "Price saved. New bookings use it; existing bookings keep their price.");
}

const WEBSITE_STANDARD = "promo_website_standard";
const defaultPriority = (scope: string) => (scope === "ROOMS" ? 30 : scope === "ROOM_TYPES" ? 20 : 10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null));
const PromotionSchema = z.object({
  id: z.string().optional().nullable(),
  name: z.string().trim().min(2, "Give the promotion a name.").max(80),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.coerce.number().int().positive("Enter the discount."),
  scope: z.enum(["ALL", "ROOM_TYPES", "ROOMS"]),
  roomTypeIds: z.array(z.string()).default([]),
  roomIds: z.array(z.string()).default([]),
  channel: z.enum(["ALL", "WEBSITE", "STAFF"]).default("ALL"),
  startDate: date,
  endDate: date,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  priority: z.coerce.number().int().min(1, "Priority is 1–100.").max(100, "Priority is 1–100.").optional(),
  isActive: z.boolean().default(true),
}).superRefine((p, ctx) => {
  if (p.type === "PERCENT" && p.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage can't be more than 100." });
  // No unlimited promotions: every promotion has a first and a last night (the built-in website price is the only exception).
  if (p.id !== WEBSITE_STANDARD && !p.startDate) ctx.addIssue({ code: "custom", path: ["startDate"], message: "Choose the first night of the promotion." });
  if (p.id !== WEBSITE_STANDARD && !p.endDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Choose the last night — a promotion cannot run forever." });
  if (p.scope === "ROOM_TYPES" && !p.roomTypeIds.length) ctx.addIssue({ code: "custom", path: ["roomTypeIds"], message: "Choose at least one room type." });
  if (p.scope === "ROOMS" && !p.roomIds.length) ctx.addIssue({ code: "custom", path: ["roomIds"], message: "Choose at least one room." });
  if (p.startDate && p.endDate && p.endDate < p.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date is before the start date." });
});

export async function savePromotionAction(input: z.input<typeof PromotionSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { user, actor } = await adminActor();
    const p = parseInput(PromotionSchema, input);
    const data = {
      name: p.name, type: p.type, value: p.value, scope: p.scope,
      roomTypeIds: p.scope === "ROOM_TYPES" ? p.roomTypeIds : [],
      roomIds: p.scope === "ROOMS" ? p.roomIds : [],
      channel: p.channel,
      startDate: p.startDate ? toDbDate(p.startDate) : null,
      endDate: p.endDate ? toDbDate(p.endDate) : null,
      daysOfWeek: [...new Set(p.daysOfWeek)].sort(),
      priority: p.priority ?? defaultPriority(p.scope),
      isActive: p.isActive,
      updatedById: user.id,
    };
    const summary = { name: p.name, type: p.type, value: p.value, scope: p.scope, channel: p.channel, start: p.startDate ?? null, end: p.endDate ?? null, days: data.daysOfWeek, priority: data.priority, active: p.isActive };
    const id = await db.$transaction(async (tx) => {
      if (p.isActive) {
        await assertNoPromotionConflict(tx, {
          id: p.id ?? "new", name: p.name, scope: p.scope, roomTypeIds: data.roomTypeIds, roomIds: data.roomIds, channel: p.channel,
          startDate: p.startDate ?? null, endDate: p.endDate ?? null, daysOfWeek: data.daysOfWeek, priority: data.priority,
        });
      }
      if (p.id) {
        const before = await tx.promotion.findUnique({ where: { id: p.id } });
        if (!before) throw new AppError("Promotion not found.", "NOT_FOUND");
        await tx.promotion.update({ where: { id: p.id }, data });
        await audit(tx, actor, {
          action: "pricing.promotion_updated", entityType: "Promotion", entityId: p.id,
          before: { name: before.name, type: before.type, value: before.value, scope: before.scope, active: before.isActive }, after: summary,
        });
        return p.id;
      }
      const created = await tx.promotion.create({ data: { ...data, createdById: user.id } });
      await audit(tx, actor, { action: "pricing.promotion_created", entityType: "Promotion", entityId: created.id, after: summary });
      return created.id;
    });
    refresh();
    return { id };
  }, "Promotion saved.");
}

export async function setPromotionActiveAction(input: { id: string; isActive: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, actor } = await adminActor();
    await db.$transaction(async (tx) => {
      const p = await tx.promotion.findUnique({ where: { id: input.id } });
      if (!p) throw new AppError("Promotion not found.", "NOT_FOUND");
      if (input.isActive) {
        await assertNoPromotionConflict(tx, {
          id: p.id, name: p.name, scope: p.scope, roomTypeIds: p.roomTypeIds, roomIds: p.roomIds, channel: p.channel,
          startDate: p.startDate ? p.startDate.toISOString().slice(0, 10) : null, endDate: p.endDate ? p.endDate.toISOString().slice(0, 10) : null,
          daysOfWeek: p.daysOfWeek, priority: p.priority,
        });
      }
      await tx.promotion.update({ where: { id: p.id }, data: { isActive: input.isActive, updatedById: user.id } });
      await audit(tx, actor, {
        action: input.isActive ? "pricing.promotion_activated" : "pricing.promotion_deactivated", entityType: "Promotion", entityId: p.id,
        before: { name: p.name, active: p.isActive }, after: { name: p.name, active: input.isActive },
      });
    });
    refresh();
    return null;
  }, input.isActive ? "Promotion switched on." : "Promotion switched off.");
}

const RulesSchema = z.object({
  manualDiscountMax: z.coerce.number().int().min(0).max(10_000_000),
  receptionCanDiscount: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  managerCanDiscount: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export async function saveDiscountRulesAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, actor } = await adminActor();
    const input = parseInput(RulesSchema, {
      manualDiscountMax: formData.get("manualDiscountMax"),
      receptionCanDiscount: formData.get("receptionCanDiscount") ?? false,
      managerCanDiscount: formData.get("managerCanDiscount") ?? false,
    });
    await db.$transaction(async (tx) => {
      const before = await tx.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
      await tx.hotelSettings.update({ where: { id: 1 }, data: { ...input, updatedById: user.id } });
      await audit(tx, actor, {
        action: "pricing.discount_rules", entityType: "HotelSettings", entityId: "1",
        before: { manualDiscountMax: before.manualDiscountMax, receptionCanDiscount: before.receptionCanDiscount, managerCanDiscount: before.managerCanDiscount },
        after: input,
      });
    });
    revalidatePath("/staff", "layout");
    return null;
  }, "Discount rules saved.");
}

// ───────────────────────── Date prices (weekend, holiday, season) ─────────────────────────

const PriceRuleSchema = z.object({
  id: z.string().optional().nullable(),
  name: z.string().trim().min(2, "Give the date price a name (e.g. Weekend, Christmas).").max(80),
  scope: z.enum(["ALL", "ROOM_TYPES", "ROOMS"]),
  roomTypeIds: z.array(z.string()).default([]),
  roomIds: z.array(z.string()).default([]),
  price: z.coerce.number().int("Whole shillings only.").min(1000, "The price looks too low.").max(10_000_000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the first night."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last night."),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  priority: z.coerce.number().int().min(1).max(100).optional(),
  isActive: z.boolean().default(true),
}).superRefine((p, ctx) => {
  if (p.scope === "ROOM_TYPES" && !p.roomTypeIds.length) ctx.addIssue({ code: "custom", path: ["roomTypeIds"], message: "Choose at least one room type." });
  if (p.scope === "ROOMS" && !p.roomIds.length) ctx.addIssue({ code: "custom", path: ["roomIds"], message: "Choose at least one room." });
  if (p.endDate < p.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The end date is before the start date." });
});

/** A date price replaces the normal room price on the nights it covers. Booked nights keep their price. */
export async function savePriceRuleAction(input: z.input<typeof PriceRuleSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { user, actor } = await adminActor();
    const p = parseInput(PriceRuleSchema, input);
    const data = {
      name: p.name, scope: p.scope, price: p.price,
      roomTypeIds: p.scope === "ROOM_TYPES" ? p.roomTypeIds : [], roomIds: p.scope === "ROOMS" ? p.roomIds : [],
      startDate: toDbDate(p.startDate), endDate: toDbDate(p.endDate), daysOfWeek: [...new Set(p.daysOfWeek)].sort(),
      priority: p.priority ?? (p.scope === "ROOMS" ? 20 : 10), isActive: p.isActive, updatedById: user.id,
    };
    const summary = { name: p.name, price: p.price, scope: p.scope, start: p.startDate, end: p.endDate, days: data.daysOfWeek, priority: data.priority, active: p.isActive };
    const id = await db.$transaction(async (tx) => {
      if (p.isActive) {
        await assertNoPriceRuleConflict(tx, { id: p.id ?? "new", name: p.name, scope: p.scope, roomTypeIds: data.roomTypeIds, roomIds: data.roomIds, startDate: p.startDate, endDate: p.endDate, daysOfWeek: data.daysOfWeek, priority: data.priority });
      }
      if (p.id) {
        const before = await tx.priceRule.findUnique({ where: { id: p.id } });
        if (!before) throw new AppError("Date price not found.", "NOT_FOUND");
        await tx.priceRule.update({ where: { id: p.id }, data });
        await audit(tx, actor, { action: "pricing.date_price_updated", entityType: "PriceRule", entityId: p.id, before: { name: before.name, price: before.price, active: before.isActive }, after: summary });
        return p.id;
      }
      const created = await tx.priceRule.create({ data: { ...data, createdById: user.id } });
      await audit(tx, actor, { action: "pricing.date_price_created", entityType: "PriceRule", entityId: created.id, after: summary });
      return created.id;
    });
    refresh();
    return { id };
  }, "Date price saved. New bookings use it; booked nights keep their price.");
}

export async function setPriceRuleActiveAction(input: { id: string; isActive: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, actor } = await adminActor();
    await db.$transaction(async (tx) => {
      const r = await tx.priceRule.findUnique({ where: { id: input.id } });
      if (!r) throw new AppError("Date price not found.", "NOT_FOUND");
      if (input.isActive) {
        await assertNoPriceRuleConflict(tx, {
          id: r.id, name: r.name, scope: r.scope, roomTypeIds: r.roomTypeIds, roomIds: r.roomIds,
          startDate: r.startDate.toISOString().slice(0, 10), endDate: r.endDate.toISOString().slice(0, 10), daysOfWeek: r.daysOfWeek, priority: r.priority,
        });
      }
      await tx.priceRule.update({ where: { id: r.id }, data: { isActive: input.isActive, updatedById: user.id } });
      await audit(tx, actor, { action: input.isActive ? "pricing.date_price_on" : "pricing.date_price_off", entityType: "PriceRule", entityId: r.id, before: { name: r.name, active: r.isActive }, after: { name: r.name, active: input.isActive } });
    });
    refresh();
    return null;
  }, input.isActive ? "Date price switched on." : "Date price switched off.");
}
