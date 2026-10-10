import "server-only";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { addDays, businessDateOf, businessRangeBounds, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { businessDayConfig, getSettings } from "../settings";
import {
  ADJUST_REASON, ASSET_CONDITIONS, ASSET_STATUSES, COUNT_REASONS, EXPIRY_WARN_DAYS, PURCHASE_REASON, RECEIVE_REASON, SALE_REASON, USE_REASONS, WASTE_REASONS,
  compatibleUnits, convertQty, formatQty, round3, stockLevel, unitOf, type StockLevel,
} from "@/lib/inventory";
import type { Actor } from "./reservations";
import { msg, msgf } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import { englishT, type T } from "@/i18n/translate";

/**
 * Hotel-wide inventory — consumable stock kept by department (Kitchen, Bar, Housekeeping…),
 * each item in its own unit. Stock only changes through movements, never by editing a number:
 *  - received (from a supplier, with cost and an expiry date where tracked);
 *  - used (by a department, with a reason) or sold (a dish's recipe, when it is ready);
 *  - wasted (staff report it, a manager approves it — only then it leaves the books);
 *  - transferred (Kitchen → Restaurant: out of one, into the same item in the other);
 *  - counted (the physical count replaces the system figure, with a reason for the difference).
 * Every movement keeps the stock before and after, who, when and why; setup changes are audited
 * with old → new values. Assets (furniture, equipment) are kept apart — see the end of this file.
 */

const has = (a: Actor, p: string) => !!a.permissions?.has(p);
function need(a: Actor, perms: string[], message: string) {
  if (!a.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  if (!perms.some((p) => has(a, p))) throw new AppError(message, "FORBIDDEN");
}
const clean = (s: string | null | undefined) => s?.trim() || null;
/** The quantity — or, with `item`, the amount of that item (a recipe line). */
const positive = (q: number, item?: string) => {
  if (!Number.isFinite(q) || q <= 0) throw new AppError(item ? msgf("Enter the amount of {item}.", { item }) : msg("Enter the quantity."), "VALIDATION", { quantity: msg("Required") });
  if (q > 10_000_000) throw new AppError(item ? msgf("That amount of {item} is too large.", { item }) : msg("That quantity is too large."), "VALIDATION", { quantity: msg("Too large") });
  return round3(q);
};
/** The translator of whoever is asking — for the words inside a message (units, departments). English outside a request. */
const readerT = () => getT().catch(() => englishT);
/** "g or kg" in the reader's words. */
const either = (t: T, words: string[]) => (words.length ? words.reduce((a, b) => t("{a} or {b}", { a, b })) : "");

async function lockItem(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "inventory_items" WHERE "id" = ${id} FOR UPDATE`;
  const it = await tx.inventoryItem.findUnique({ where: { id }, include: { department: true } });
  if (!it) throw new AppError("Stock item not found.", "NOT_FOUND");
  return it;
}

type Post = {
  kind: string; reason: string; note?: string | null; unitCost?: number | null; totalCost?: number | null; supplierId?: string | null;
  reference?: string | null; expiresOn?: Date | null; departmentId?: string | null; orderId?: string | null; approvedById?: string | null; approvedAt?: Date | null;
};
/** Apply a change to a (locked) item and record it. */
async function postTx(tx: Tx, item: { id: string; quantity: number; unit: string; costPerUnit: number }, change: number, p: Post, actor: Actor, now: Date, extra: { costPerUnit?: number } = {}) {
  const before = round3(item.quantity);
  const after = round3(before + change);
  await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: after, ...extra } });
  return tx.inventoryMovement.create({
    data: {
      itemId: item.id, change: round3(change), before, after, unit: item.unit, status: "POSTED",
      recordedById: actor.userId ?? null, recordedAt: now,
      totalCost: p.totalCost ?? Math.round(Math.abs(change) * (p.unitCost ?? item.costPerUnit)),
      ...p,
    },
  });
}

// ─────────────────────────────── Reading ───────────────────────────────

export type InventoryRow = {
  id: string; name: string; sku: string | null; unit: string; quantity: number; minStock: number | null; reorderLevel: number | null; maxStock: number | null;
  costPerUnit: number; value: number; level: StockLevel; location: string | null; notes: string | null; tracksExpiry: boolean; isActive: boolean;
  category: { id: string; name: string }; department: { id: string; code: string; name: string }; supplier: { id: string; name: string } | null;
};

/** Everything the inventory screens start from: departments, categories, suppliers, items with their level. */
export async function inventorySetup() {
  const [departments, categories, suppliers, items] = await Promise.all([
    db.inventoryDepartment.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.inventoryCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    db.inventoryItem.findMany({
      orderBy: [{ name: "asc" }],
      include: { category: { select: { id: true, name: true } }, department: { select: { id: true, code: true, name: true } }, supplier: { select: { id: true, name: true } } },
    }),
  ]);
  const rows: InventoryRow[] = items.map((i) => ({
    id: i.id, name: i.name, sku: i.sku, unit: i.unit, quantity: i.quantity, minStock: i.minStock, reorderLevel: i.reorderLevel, maxStock: i.maxStock,
    costPerUnit: i.costPerUnit, value: Math.max(0, Math.round(i.quantity * i.costPerUnit)), level: stockLevel(i), location: i.location, notes: i.notes,
    tracksExpiry: i.tracksExpiry, isActive: i.isActive, category: i.category, department: i.department, supplier: i.supplier,
  }));
  const locations = [...new Set(items.map((i) => i.location).filter(Boolean) as string[])].sort();
  return { departments, categories, suppliers, items: rows, locations };
}

/** Deliveries close to (or past) their expiry date, still on the shelf. */
export async function expiringStock(today: BusinessDate) {
  const rows = await db.inventoryMovement.findMany({
    where: { kind: "RECEIVE", status: "POSTED", expiryCleared: false, expiresOn: { not: null, lte: toDbDate(addDays(today, EXPIRY_WARN_DAYS)) }, item: { quantity: { gt: 0 }, isActive: true } },
    orderBy: { expiresOn: "asc" }, take: 50,
    include: { item: { select: { id: true, name: true, unit: true, quantity: true, department: { select: { name: true } } } } },
  });
  return rows.map((m) => ({
    id: m.id, item: m.item, received: m.change, expiresOn: m.expiresOn!.toISOString().slice(0, 10),
    expired: m.expiresOn!.toISOString().slice(0, 10) < today,
  }));
}

/** The day's money and movement in the stores, for the overview and the daily report. */
export async function inventoryDay(from: BusinessDate, to: BusinessDate, departmentId?: string | null) {
  const s = await getSettings();
  const { start, end } = businessRangeBounds(from, to, businessDayConfig(s));
  const moves = await db.inventoryMovement.findMany({
    where: { status: "POSTED", recordedAt: { gte: start, lt: end }, ...(departmentId && { item: { departmentId } }) },
    select: { kind: true, change: true, totalCost: true, itemId: true, departmentId: true, item: { select: { name: true, unit: true, departmentId: true } } },
  });
  const sum = (k: string[]) => moves.filter((m) => k.includes(m.kind));
  const cost = (xs: typeof moves) => xs.reduce((t, m) => t + (m.totalCost ?? 0), 0);
  const received = sum(["RECEIVE"]), used = sum(["USE", "SALE"]), waste = sum(["WASTE"]), counted = sum(["COUNT", "ADJUST"]);
  // Top items used, by value.
  const byItem = new Map<string, { name: string; unit: string; qty: number; value: number }>();
  for (const m of used) {
    const x = byItem.get(m.itemId) ?? { name: m.item.name, unit: m.item.unit, qty: 0, value: 0 };
    x.qty = round3(x.qty - m.change); x.value += m.totalCost ?? 0; byItem.set(m.itemId, x);
  }
  return {
    receivedValue: cost(received), receivedLines: received.length,
    usedValue: cost(used), usedLines: used.length, usedItems: new Set(used.map((m) => m.itemId)).size,
    soldValue: cost(sum(["SALE"])),
    wasteValue: cost(waste), wasteLines: waste.length,
    countDifferenceValue: counted.reduce((t, m) => t + Math.sign(m.change) * (m.totalCost ?? 0), 0), countLines: counted.length,
    topUsed: [...byItem.values()].sort((a, b) => b.value - a.value).slice(0, 8),
  };
}

/** The alerts managers and the MD see: out, low, reorder, overstock, expiring, waste waiting. */
export async function inventoryAlerts(today: BusinessDate) {
  const [items, expiring, pendingWaste] = await Promise.all([
    db.inventoryItem.findMany({ where: { isActive: true }, select: { id: true, name: true, unit: true, quantity: true, minStock: true, reorderLevel: true, maxStock: true, department: { select: { name: true } } } }),
    expiringStock(today),
    db.inventoryMovement.count({ where: { status: "PENDING" } }),
  ]);
  const withLevel = items.map((i) => ({ ...i, level: stockLevel(i) }));
  const pick = (l: StockLevel) => withLevel.filter((i) => i.level === l).sort((a, b) => a.name.localeCompare(b.name));
  return { out: pick("OUT"), low: pick("LOW"), reorder: pick("REORDER"), over: pick("OVER"), expiring, pendingWaste };
}

/** `money: false` (staff who use stock but do not buy it): no prices, totals or suppliers on the movements. */
export async function recentMovements(opts: { take?: number; itemId?: string; departmentId?: string | null; kind?: string | null; from?: Date; to?: Date; status?: string; money?: boolean } = {}) {
  const money = opts.money ?? true;
  const rows = await db.inventoryMovement.findMany({
    where: {
      ...(opts.itemId && { itemId: opts.itemId }),
      ...(opts.kind && { kind: opts.kind }),
      ...(opts.status ? { status: opts.status } : { status: { not: "REJECTED" } }),
      ...(opts.departmentId && { OR: [{ departmentId: opts.departmentId }, { item: { departmentId: opts.departmentId } }] }),
      ...((opts.from || opts.to) && { recordedAt: { ...(opts.from && { gte: opts.from }), ...(opts.to && { lt: opts.to }) } }),
    },
    orderBy: { recordedAt: "desc" }, take: opts.take ?? 60,
    include: {
      item: { select: { id: true, name: true, unit: true, department: { select: { name: true } } } },
      department: { select: { name: true } }, supplier: { select: { name: true } },
      recordedBy: { select: { fullName: true, role: { select: { name: true } } } }, approvedBy: { select: { fullName: true } },
    },
  });
  return rows.map((m) => ({
    id: m.id, kind: m.kind, reason: m.reason, note: m.note, change: m.change, before: m.before, after: m.after, unit: m.unit, status: m.status,
    totalCost: money ? m.totalCost : null, unitCost: money ? m.unitCost : null, reference: m.reference, expiresOn: m.expiresOn?.toISOString().slice(0, 10) ?? null,
    item: m.item, where: m.department?.name ?? m.item.department.name, supplier: money ? m.supplier?.name ?? null : null,
    by: m.recordedBy?.fullName ?? msg("System"), byRole: m.recordedBy?.role?.name ?? null, approvedBy: m.approvedBy?.fullName ?? null,
    at: m.recordedAt.toISOString(), approvedAt: m.approvedAt?.toISOString() ?? null, decisionNote: m.decisionNote,
  }));
}
export type MovementRow = Awaited<ReturnType<typeof recentMovements>>[number];

export async function itemDetail(id: string, opts: { money?: boolean } = {}) {
  const it = await db.inventoryItem.findUnique({
    where: { id },
    include: { recipeLines: { include: { menuItem: { select: { name: true } } } }, category: { select: { name: true } }, department: { select: { name: true } }, supplier: { select: { name: true } } },
  });
  if (!it) throw new AppError("Stock item not found.", "NOT_FOUND");
  const moves = await recentMovements({ itemId: id, take: 40, status: undefined, money: opts.money });
  const t = await readerT();
  return {
    id: it.id, name: it.name, unit: it.unit, quantity: it.quantity,
    recipes: it.recipeLines.map((r) => ({ dish: r.menuItem.name, qty: formatQty(r.quantity, r.unit, t) })),
    moves,
  };
}

// ─────────────────────────────── Setup (the MD) ───────────────────────────────

const MANAGE = ["inventory.manage"];

export interface ItemInput {
  id?: string | null; name: string; sku?: string | null; categoryId: string; departmentId: string; unit: string;
  minStock?: number | null; reorderLevel?: number | null; maxStock?: number | null; costPerUnit?: number | null;
  supplierId?: string | null; location?: string | null; tracksExpiry?: boolean; isActive?: boolean; notes?: string | null;
  /** New items: what is on the shelf today (recorded as the opening count). */
  openingQuantity?: number | null;
}

export async function saveInventoryItem(input: ItemInput, actor: Actor, now = new Date()) {
  need(actor, MANAGE, msg("Only the MD sets up stock items."));
  const name = input.name.trim();
  if (!name) throw new AppError("Give the item a name.", "VALIDATION", { name: msg("Required") });
  if (!unitOf(input.unit) || !input.unit) throw new AppError("Choose a unit.", "VALIDATION", { unit: msg("Required") });
  const lv = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : round3(Math.max(0, v)));
  const data = {
    name, sku: clean(input.sku), categoryId: input.categoryId, departmentId: input.departmentId, unit: input.unit,
    minStock: lv(input.minStock), reorderLevel: lv(input.reorderLevel), maxStock: lv(input.maxStock), costPerUnit: Math.max(0, Math.round(input.costPerUnit ?? 0)),
    supplierId: input.supplierId || null, location: clean(input.location), tracksExpiry: !!input.tracksExpiry, isActive: input.isActive ?? true, notes: clean(input.notes),
  };
  if (data.minStock != null && data.maxStock != null && data.maxStock > 0 && data.maxStock < data.minStock) throw new AppError("The maximum cannot be below the minimum.", "VALIDATION", { maxStock: msg("Too low") });
  try {
    return await db.$transaction(async (tx) => {
      if (input.id) {
        const before = await lockItem(tx, input.id);
        if (before.unit !== data.unit && (await tx.inventoryMovement.count({ where: { itemId: before.id } })) > 0) {
          throw new AppError(msgf("{item} already has stock history in {unit} — the unit cannot change. Make a new item instead.", { item: before.name, unit: (await readerT())(unitOf(before.unit).plural) }), "VALIDATION", { unit: msg("Locked") });
        }
        const after = await tx.inventoryItem.update({ where: { id: input.id }, data });
        const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => String(before[k] ?? "") !== String(after[k] ?? ""));
        if (changed.length) {
          await audit(tx, actor, {
            action: "inventory.item_updated", entityType: "InventoryItem", entityId: after.id,
            before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
          });
        }
        return after;
      }
      const created = await tx.inventoryItem.create({ data });
      await audit(tx, actor, { action: "inventory.item_created", entityType: "InventoryItem", entityId: created.id, after: { ...data } });
      const open = input.openingQuantity ? round3(input.openingQuantity) : 0;
      if (open > 0) {
        const locked = await lockItem(tx, created.id);
        await postTx(tx, locked, open, { kind: "ADJUST", reason: ADJUST_REASON, note: "Opening stock", approvedById: actor.userId ?? null, approvedAt: now }, actor, now);
      }
      return created;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AppError("An item with this name (or reference) already exists in that department.", "CONFLICT");
    throw e;
  }
}

export async function saveInventoryDepartment(input: { id?: string | null; name: string; isActive?: boolean }, actor: Actor) {
  need(actor, MANAGE, msg("Only the MD sets up departments."));
  const name = input.name.trim();
  if (!name) throw new AppError("Give the department a name.", "VALIDATION", { name: msg("Required") });
  const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "DEPT";
  try {
    return await db.$transaction(async (tx) => {
      const before = input.id ? await tx.inventoryDepartment.findUnique({ where: { id: input.id } }) : null;
      const row = input.id
        ? await tx.inventoryDepartment.update({ where: { id: input.id }, data: { name, isActive: input.isActive ?? true } })
        : await tx.inventoryDepartment.create({ data: { name, code, sortOrder: (await tx.inventoryDepartment.count()) + 1 } });
      await audit(tx, actor, { action: input.id ? "inventory.department_updated" : "inventory.department_created", entityType: "InventoryDepartment", entityId: row.id, before: before ? { name: before.name, isActive: before.isActive } : undefined, after: { name: row.name, isActive: row.isActive } });
      return row;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AppError("There is already a department with this name.", "CONFLICT");
    throw e;
  }
}

export async function saveInventoryCategory(input: { id?: string | null; name: string; departmentId?: string | null; isActive?: boolean }, actor: Actor) {
  need(actor, MANAGE, msg("Only the MD sets up categories."));
  const name = input.name.trim();
  if (!name) throw new AppError("Give the category a name.", "VALIDATION", { name: msg("Required") });
  try {
    return await db.$transaction(async (tx) => {
      const before = input.id ? await tx.inventoryCategory.findUnique({ where: { id: input.id } }) : null;
      const data = { name, departmentId: input.departmentId || null, isActive: input.isActive ?? true };
      const row = input.id ? await tx.inventoryCategory.update({ where: { id: input.id }, data }) : await tx.inventoryCategory.create({ data: { ...data, sortOrder: (await tx.inventoryCategory.count()) + 1 } });
      await audit(tx, actor, { action: input.id ? "inventory.category_updated" : "inventory.category_created", entityType: "InventoryCategory", entityId: row.id, before: before ? { name: before.name, departmentId: before.departmentId, isActive: before.isActive } : undefined, after: data });
      return row;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AppError("There is already a category with this name.", "CONFLICT");
    throw e;
  }
}

export async function saveSupplier(input: { id?: string | null; name: string; contactName?: string | null; phone?: string | null; email?: string | null; notes?: string | null; isActive?: boolean }, actor: Actor) {
  need(actor, MANAGE, msg("Only the MD sets up suppliers."));
  const name = input.name.trim();
  if (!name) throw new AppError("Give the supplier a name.", "VALIDATION", { name: msg("Required") });
  const data = { name, contactName: clean(input.contactName), phone: clean(input.phone), email: clean(input.email), notes: clean(input.notes), isActive: input.isActive ?? true };
  try {
    return await db.$transaction(async (tx) => {
      const before = input.id ? await tx.supplier.findUnique({ where: { id: input.id } }) : null;
      const row = input.id ? await tx.supplier.update({ where: { id: input.id }, data }) : await tx.supplier.create({ data });
      await audit(tx, actor, { action: input.id ? "inventory.supplier_updated" : "inventory.supplier_created", entityType: "Supplier", entityId: row.id, before: before ?? undefined, after: data });
      return row;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AppError("There is already a supplier with this name.", "CONFLICT");
    throw e;
  }
}

// ─────────────────────────────── Stock moving ───────────────────────────────

/** New stock in: 50 kg of Beef from ABC Supplier at TZS 15,000/kg. The price becomes the item's cost. */
export async function receiveStock(input: { itemId: string; quantity: number; unitCost?: number | null; supplierId?: string | null; reference?: string | null; expiresOn?: BusinessDate | null; note?: string | null }, actor: Actor, now = new Date()) {
  need(actor, ["inventory.receive"], msg("You cannot record deliveries."));
  return db.$transaction((tx) => receiveStockTx(tx, input, actor, now));
}

/**
 * Stock in, inside the caller's transaction (a delivery, or a purchase's final approval together
 * with its expense). A purchase passes what was actually paid for the line (`totalCost`) — kept
 * on the movement exactly — and the price per unit becomes the item's cost.
 */
export async function receiveStockTx(tx: Tx, input: {
  itemId: string; quantity: number; unitCost?: number | null; totalCost?: number | null; supplierId?: string | null; reference?: string | null;
  expiresOn?: BusinessDate | null; note?: string | null; purchase?: boolean; approvedById?: string | null;
}, actor: Actor, now: Date) {
  const qty = positive(input.quantity);
  const it = await lockItem(tx, input.itemId);
  if (!it.isActive) throw new AppError(msgf("{item} is switched off — the MD can switch it on again.", { item: it.name }));
  if (it.tracksExpiry && !input.expiresOn) throw new AppError(msgf("{item} tracks expiry — enter the expiry date on the delivery.", { item: it.name }), "VALIDATION", { expiresOn: msg("Required") });
  const unitCost = input.unitCost != null && input.unitCost > 0 ? Math.round(input.unitCost) : it.costPerUnit;
  const m = await postTx(tx, it, qty, {
    kind: "RECEIVE", reason: input.purchase ? PURCHASE_REASON : RECEIVE_REASON, note: clean(input.note), unitCost, totalCost: input.totalCost ?? Math.round(qty * unitCost),
    supplierId: input.supplierId || it.supplierId || null, reference: clean(input.reference), expiresOn: input.expiresOn ? toDbDate(input.expiresOn) : null,
    departmentId: it.departmentId, ...(input.approvedById ? { approvedById: input.approvedById, approvedAt: now } : {}),
  }, actor, now, unitCost !== it.costPerUnit ? { costPerUnit: unitCost } : {});
  await audit(tx, actor, {
    action: "inventory.received", entityType: "InventoryItem", entityId: it.id,
    before: { quantity: m.before, costPerUnit: it.costPerUnit },
    after: { quantity: m.after, received: formatQty(qty, it.unit), costPerUnit: unitCost, total: m.totalCost, supplier: m.supplierId, reference: m.reference, ...(input.purchase ? { purchase: true } : {}) },
  });
  return { id: m.id, name: it.name, before: m.before!, after: m.after!, unit: it.unit, total: m.totalCost ?? 0 };
}

/** Stock out for work: 5 kg of Beef for the kitchen. */
export async function takeStock(input: { itemId: string; quantity: number; reason: string; departmentId?: string | null; note?: string | null }, actor: Actor, now = new Date()) {
  need(actor, ["inventory.use", "inventory.approve"], msg("You cannot take stock out."));
  const qty = positive(input.quantity);
  if (!USE_REASONS.some((r) => r.code === input.reason) || input.reason === "TRANSFER") throw new AppError("Choose why the stock is used.", "VALIDATION", { reason: msg("Required") });
  return db.$transaction(async (tx) => {
    const it = await lockItem(tx, input.itemId);
    if (qty > round3(it.quantity)) throw new AppError(msgf("Only {qty} of {item} on the books — ask a manager to count it first.", { qty: formatQty(it.quantity, it.unit, await readerT()), item: it.name }), "VALIDATION", { quantity: msg("Too much") });
    const m = await postTx(tx, it, -qty, { kind: "USE", reason: input.reason, note: clean(input.note), departmentId: input.departmentId || it.departmentId }, actor, now);
    await audit(tx, actor, { action: "inventory.used", entityType: "InventoryItem", entityId: it.id, before: { quantity: m.before }, after: { quantity: m.after, used: formatQty(qty, it.unit), reason: input.reason, note: m.note } });
    return { name: it.name, before: m.before!, after: m.after!, unit: it.unit };
  });
}

/**
 * Waste: the Mpishi reports 2 kg of Chicken spoiled; it waits for a manager, and only when the
 * manager approves does the stock drop (100 kg → 98 kg). A manager's own report is approved at once.
 */
export async function reportWaste(input: { itemId: string; quantity: number; reason: string; note?: string | null }, actor: Actor, now = new Date()) {
  need(actor, ["inventory.use", "inventory.approve"], msg("You cannot report waste."));
  const qty = positive(input.quantity);
  if (!WASTE_REASONS.some((r) => r.code === input.reason)) throw new AppError("Choose why it was wasted.", "VALIDATION", { reason: msg("Required") });
  const approver = has(actor, "inventory.approve");
  return db.$transaction(async (tx) => {
    const it = await lockItem(tx, input.itemId);
    if (qty > round3(it.quantity)) throw new AppError(msgf("Only {qty} of {item} on the books.", { qty: formatQty(it.quantity, it.unit, await readerT()), item: it.name }), "VALIDATION", { quantity: msg("Too much") });
    if (approver) {
      const m = await postTx(tx, it, -qty, { kind: "WASTE", reason: input.reason, note: clean(input.note), departmentId: it.departmentId, approvedById: actor.userId ?? null, approvedAt: now }, actor, now);
      await audit(tx, actor, { action: "inventory.waste_recorded", entityType: "InventoryItem", entityId: it.id, before: { quantity: m.before }, after: { quantity: m.after, wasted: formatQty(qty, it.unit), reason: input.reason, note: m.note } });
      return { pending: false, name: it.name, before: m.before!, after: m.after!, unit: it.unit };
    }
    const m = await tx.inventoryMovement.create({
      data: {
        itemId: it.id, kind: "WASTE", reason: input.reason, note: clean(input.note), change: -qty, unit: it.unit, status: "PENDING",
        totalCost: Math.round(qty * it.costPerUnit), departmentId: it.departmentId, recordedById: actor.userId ?? null, recordedAt: now,
      },
    });
    await audit(tx, actor, { action: "inventory.waste_reported", entityType: "InventoryMovement", entityId: m.id, after: { item: it.name, quantity: formatQty(qty, it.unit), reason: input.reason, note: m.note } });
    return { pending: true, name: it.name, before: it.quantity, after: it.quantity, unit: it.unit };
  });
}

/** A manager approves (the stock drops now) or rejects (nothing changes, with a reason) reported waste. */
export async function decideWaste(id: string, approve: boolean, note: string | null, actor: Actor, now = new Date()) {
  need(actor, ["inventory.approve"], msg("Only a manager approves waste."));
  if (!approve && !note?.trim()) throw new AppError("Say why it is rejected.", "VALIDATION", { note: msg("Required") });
  return db.$transaction(async (tx) => {
    const m = await tx.inventoryMovement.findUnique({ where: { id } });
    if (!m || m.kind !== "WASTE") throw new AppError("Waste report not found.", "NOT_FOUND");
    if (m.status !== "PENDING") throw new AppError("This waste report is already decided.");
    const it = await lockItem(tx, m.itemId);
    if (!approve) {
      await tx.inventoryMovement.update({ where: { id }, data: { status: "REJECTED", approvedById: actor.userId ?? null, approvedAt: now, decisionNote: note!.trim() } });
      await audit(tx, actor, { action: "inventory.waste_rejected", entityType: "InventoryMovement", entityId: id, after: { item: it.name, quantity: formatQty(-m.change, it.unit), reason: note!.trim() } });
      return { approved: false, name: it.name, before: it.quantity, after: it.quantity, unit: it.unit };
    }
    const qty = -m.change;
    const before = round3(it.quantity), after = round3(before - qty);
    await tx.inventoryItem.update({ where: { id: it.id }, data: { quantity: after } });
    await tx.inventoryMovement.update({ where: { id }, data: { status: "POSTED", before, after, approvedById: actor.userId ?? null, approvedAt: now, decisionNote: clean(note) } });
    await audit(tx, actor, { action: "inventory.waste_approved", entityType: "InventoryItem", entityId: it.id, before: { quantity: before }, after: { quantity: after, wasted: formatQty(qty, it.unit), reason: m.reason, reportedBy: m.recordedById } });
    return { approved: true, name: it.name, before, after, unit: it.unit };
  });
}

/**
 * Transfer: 10 kg of Beef from the Kitchen to the Restaurant. It leaves this item and goes into
 * the item of the same name in the other department (made there, same unit, if it is not yet).
 */
export async function transferStock(input: { itemId: string; toDepartmentId: string; quantity: number; note?: string | null }, actor: Actor, now = new Date()) {
  need(actor, ["inventory.approve"], msg("Only a manager moves stock between departments."));
  const qty = positive(input.quantity);
  return db.$transaction(async (tx) => {
    const from = await lockItem(tx, input.itemId);
    if (from.departmentId === input.toDepartmentId) throw new AppError("Choose another department.", "VALIDATION", { toDepartmentId: msg("Same") });
    const dept = await tx.inventoryDepartment.findUnique({ where: { id: input.toDepartmentId } });
    if (!dept || !dept.isActive) throw new AppError("Department not found.", "NOT_FOUND");
    if (qty > round3(from.quantity)) {
      const t = await readerT();
      throw new AppError(msgf("Only {qty} of {item} in {department}.", { qty: formatQty(from.quantity, from.unit, t), item: from.name, department: t(from.department.name) }), "VALIDATION", { quantity: msg("Too much") });
    }
    let target = await tx.inventoryItem.findUnique({ where: { departmentId_name: { departmentId: dept.id, name: from.name } } });
    if (target && target.unit !== from.unit) {
      const t = await readerT();
      throw new AppError(msgf("{department} keeps {item} in {unit}, not {other}.", { department: t(dept.name), item: from.name, unit: t(unitOf(target.unit).plural), other: t(unitOf(from.unit).plural) }));
    }
    if (!target) {
      target = await tx.inventoryItem.create({
        data: { name: from.name, categoryId: from.categoryId, departmentId: dept.id, unit: from.unit, costPerUnit: from.costPerUnit, supplierId: from.supplierId, tracksExpiry: from.tracksExpiry, notes: `Made by a transfer from ${from.department.name}` },
      });
    }
    const to = await lockItem(tx, target.id);
    const note = clean(input.note);
    const out = await postTx(tx, from, -qty, { kind: "USE", reason: "TRANSFER", note: `To ${dept.name}${note ? ` — ${note}` : ""}`, departmentId: dept.id }, actor, now);
    const inn = await postTx(tx, to, qty, { kind: "RECEIVE", reason: "TRANSFER", note: `From ${from.department.name}${note ? ` — ${note}` : ""}`, departmentId: dept.id, unitCost: from.costPerUnit }, actor, now);
    await audit(tx, actor, {
      action: "inventory.transferred", entityType: "InventoryItem", entityId: from.id,
      before: { department: from.department.name, quantity: out.before, [`${dept.name} quantity`]: inn.before },
      after: { department: dept.name, moved: formatQty(qty, from.unit), quantity: out.after, [`${dept.name} quantity`]: inn.after, note },
    });
    return { name: from.name, qty, unit: from.unit, from: from.department.name, to: dept.name };
  });
}

/**
 * Physical count: the system says 59 kg, the shelf has 57.5 kg → a −1.5 kg correction, with a
 * reason. Lines that match are left as they are.
 */
export async function countStock(input: { lines: { itemId: string; counted: number; reason?: string | null; note?: string | null }[] }, actor: Actor, now = new Date()) {
  need(actor, ["inventory.approve"], msg("Only a manager or the MD counts stock."));
  const lines = input.lines.filter((l) => Number.isFinite(l.counted) && l.counted >= 0);
  if (!lines.length) throw new AppError("Enter at least one count.", "VALIDATION", { lines: msg("Empty") });
  return db.$transaction(async (tx) => {
    const out: { name: string; before: number; after: number; unit: string }[] = [];
    for (const l of [...lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
      const it = await lockItem(tx, l.itemId);
      const counted = round3(l.counted);
      const diff = round3(counted - it.quantity);
      if (diff === 0) continue;
      if (!l.reason || !COUNT_REASONS.some((r) => r.code === l.reason)) {
        const vars = { item: it.name, qty: formatQty(Math.abs(diff), it.unit, await readerT()) };
        throw new AppError(diff < 0 ? msgf("Say why {item} is short by {qty}.", vars) : msgf("Say why {item} is over by {qty}.", vars), "VALIDATION", { reason: it.id });
      }
      if (l.reason === "OTHER" && !l.note?.trim()) throw new AppError(msgf("Describe the difference on {item}.", { item: it.name }), "VALIDATION", { note: it.id });
      const m = await postTx(tx, it, diff, { kind: "COUNT", reason: l.reason, note: clean(l.note), departmentId: it.departmentId, approvedById: actor.userId ?? null, approvedAt: now }, actor, now);
      await audit(tx, actor, { action: "inventory.counted", entityType: "InventoryItem", entityId: it.id, before: { quantity: m.before }, after: { quantity: m.after, difference: formatQty(diff, it.unit), reason: l.reason, note: m.note } });
      out.push({ name: it.name, before: m.before!, after: m.after!, unit: it.unit });
    }
    return { corrected: out };
  });
}

/** An expiring delivery dealt with (used up, or thrown away through waste). */
export async function clearExpiry(movementId: string, actor: Actor) {
  need(actor, ["inventory.use", "inventory.approve"], msg("You cannot change stock records."));
  await db.$transaction(async (tx) => {
    const m = await tx.inventoryMovement.update({ where: { id: movementId }, data: { expiryCleared: true } });
    await audit(tx, actor, { action: "inventory.expiry_cleared", entityType: "InventoryMovement", entityId: m.id, after: { expiresOn: m.expiresOn } });
  });
}

// ─────────────────────────────── Recipes ───────────────────────────────

export async function recipesData() {
  const [menu, items] = await Promise.all([
    db.menuItem.findMany({
      where: { isActive: true }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, price: true, type: true, category: { select: { name: true } }, recipe: { select: { itemId: true, quantity: true, unit: true } } },
    }),
    db.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, costPerUnit: true, department: { select: { name: true } } } }),
  ]);
  return { menu, items };
}

/** A dish's recipe, replaced as a whole: Beef Burger = 150 g Beef + 1 Bun + 1 slice Cheese… */
export async function saveRecipe(menuItemId: string, lines: { itemId: string; quantity: number; unit: string }[], actor: Actor) {
  need(actor, MANAGE, msg("Only the MD sets up recipes."));
  const t = await readerT();
  return db.$transaction(async (tx) => {
    const dish = await tx.menuItem.findUnique({ where: { id: menuItemId }, include: { recipe: { include: { item: { select: { name: true } } } } } });
    if (!dish) throw new AppError("Dish not found.", "NOT_FOUND");
    const items = await tx.inventoryItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    const clean = lines.map((l) => {
      const it = byId.get(l.itemId);
      if (!it) throw new AppError("A stock item in the recipe was not found.", "NOT_FOUND");
      if (seen.has(it.id)) throw new AppError(msgf("{item} is in the recipe twice.", { item: it.name }), "VALIDATION");
      seen.add(it.id);
      if (!compatibleUnits(it.unit).includes(l.unit)) {
        throw new AppError(msgf("{item} is kept in {unit} — use {units}.", { item: it.name, unit: t(unitOf(it.unit).plural), units: either(t, compatibleUnits(it.unit).map((u) => t(unitOf(u).label))) }), "VALIDATION");
      }
      return { itemId: it.id, quantity: positive(l.quantity, it.name), unit: l.unit, name: it.name };
    });
    await tx.recipeLine.deleteMany({ where: { menuItemId } });
    if (clean.length) await tx.recipeLine.createMany({ data: clean.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unit: l.unit, menuItemId })) });
    await audit(tx, actor, {
      action: "inventory.recipe_saved", entityType: "MenuItem", entityId: menuItemId,
      before: { dish: dish.name, recipe: dish.recipe.map((r) => `${formatQty(r.quantity, r.unit)} ${r.item.name}`) },
      after: { dish: dish.name, recipe: clean.map((r) => `${formatQty(r.quantity, r.unit)} ${r.name}`) },
    });
    return { lines: clean.length };
  });
}

/**
 * Take a restaurant order's ingredients off stock (its recipes), once per line — called when the
 * order is ready (or closes). Lines without a recipe are only marked. Stock may go below zero here:
 * the food was made; the count will show it.
 */
export async function consumeRecipesTx(tx: Tx, orderId: string, actor: Actor, now: Date) {
  const lines = await tx.restaurantOrderItem.findMany({ where: { orderId, stockUsedAt: null }, select: { id: true, menuItemId: true, quantity: true, name: true } });
  if (!lines.length) return;
  await tx.restaurantOrderItem.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { stockUsedAt: now } });
  const menuIds = [...new Set(lines.map((l) => l.menuItemId).filter(Boolean) as string[])];
  if (!menuIds.length) return;
  const recipe = await tx.recipeLine.findMany({ where: { menuItemId: { in: menuIds }, item: { isActive: true } }, include: { item: { select: { unit: true } } } });
  if (!recipe.length) return;
  const need = new Map<string, { qty: number; dishes: string[] }>();
  for (const l of lines) {
    for (const r of recipe.filter((x) => x.menuItemId === l.menuItemId)) {
      const per = convertQty(r.quantity, r.unit, r.item.unit);
      if (per == null) continue;
      const x = need.get(r.itemId) ?? { qty: 0, dishes: [] };
      x.qty = round3(x.qty + per * l.quantity); x.dishes.push(`${l.quantity} × ${l.name}`);
      need.set(r.itemId, x);
    }
  }
  const order = await tx.restaurantOrder.findUnique({ where: { id: orderId }, select: { number: true } });
  for (const [itemId, x] of [...need.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (x.qty <= 0) continue;
    const it = await lockItem(tx, itemId);
    await postTx(tx, it, -x.qty, { kind: "SALE", reason: SALE_REASON, note: x.dishes.join(", "), reference: order?.number ?? null, orderId, departmentId: it.departmentId }, actor, now);
  }
}

// ─────────────────────────────── Assets ───────────────────────────────

export interface AssetInput {
  id?: string | null; code?: string | null; name: string; category: string; location?: string | null; departmentId?: string | null;
  quantity?: number | null; purchaseDate?: BusinessDate | null; purchaseCost?: number | null; condition: string; status: string;
  supplierId?: string | null; serialNumber?: string | null; assignedTo?: string | null; notes?: string | null;
}

function checkAssetCodes(condition: string, status: string) {
  if (!ASSET_CONDITIONS.some((c) => c.code === condition)) throw new AppError("Choose the condition.", "VALIDATION", { condition: msg("Invalid") });
  if (!ASSET_STATUSES.some((c) => c.code === status)) throw new AppError("Choose the status.", "VALIDATION", { status: msg("Invalid") });
}

export async function assetsData() {
  const [assets, departments, suppliers, moves] = await Promise.all([
    db.asset.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }], include: { department: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } } }),
    db.inventoryDepartment.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.assetMovement.findMany({ orderBy: { at: "desc" }, take: 40, include: { asset: { select: { id: true, code: true, name: true } }, movedBy: { select: { fullName: true } } } }),
  ]);
  return {
    assets: assets.map((a) => ({ ...a, purchaseDate: a.purchaseDate?.toISOString().slice(0, 10) ?? null, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })),
    departments, suppliers,
    moves: moves.map((m) => ({ id: m.id, kind: m.kind, from: m.fromValue, to: m.toValue, quantity: m.quantity, note: m.note, at: m.at.toISOString(), by: m.movedBy?.fullName ?? "—", asset: m.asset })),
  };
}

export async function assetHistory(assetId: string) {
  const rows = await db.assetMovement.findMany({ where: { assetId }, orderBy: { at: "desc" }, take: 50, include: { movedBy: { select: { fullName: true } } } });
  return rows.map((m) => ({ id: m.id, kind: m.kind, from: m.fromValue, to: m.toValue, quantity: m.quantity, note: m.note, at: m.at.toISOString(), by: m.movedBy?.fullName ?? "—" }));
}

export async function saveAsset(input: AssetInput, actor: Actor, now = new Date()) {
  need(actor, ["assets.manage"], msg("Only the MD keeps the asset register."));
  const name = input.name.trim(), category = input.category.trim();
  if (!name) throw new AppError("Give the asset a name.", "VALIDATION", { name: msg("Required") });
  if (!category) throw new AppError("Choose a category.", "VALIDATION", { category: msg("Required") });
  checkAssetCodes(input.condition || "GOOD", input.status || "IN_USE");
  const data = {
    name, category, location: clean(input.location), departmentId: input.departmentId || null, quantity: Math.max(1, Math.round(input.quantity ?? 1)),
    purchaseDate: input.purchaseDate ? toDbDate(input.purchaseDate) : null, purchaseCost: input.purchaseCost != null && input.purchaseCost > 0 ? Math.round(input.purchaseCost) : null,
    condition: input.condition || "GOOD", status: input.status || "IN_USE", supplierId: input.supplierId || null,
    serialNumber: clean(input.serialNumber), assignedTo: clean(input.assignedTo), notes: clean(input.notes),
  };
  try {
    return await db.$transaction(async (tx) => {
      if (input.id) {
        const before = await tx.asset.findUnique({ where: { id: input.id } });
        if (!before) throw new AppError("Asset not found.", "NOT_FOUND");
        const code = clean(input.code) ?? before.code;
        const after = await tx.asset.update({ where: { id: input.id }, data: { ...data, code } });
        // What changed that matters on the floor goes in the asset's history too.
        const track: [string, string | null, string | null][] = [
          ["MOVED", before.location, after.location], ["CONDITION", before.condition, after.condition], ["STATUS", before.status, after.status], ["ASSIGNED", before.assignedTo, after.assignedTo],
        ];
        for (const [kind, a, b] of track) if ((a ?? "") !== (b ?? "")) await tx.assetMovement.create({ data: { assetId: after.id, kind, fromValue: a, toValue: b, movedById: actor.userId ?? null, at: now } });
        const keys = [...Object.keys(data), "code"] as (keyof typeof before)[];
        const changed = keys.filter((k) => String(before[k] ?? "") !== String(after[k] ?? ""));
        if (changed.length) await audit(tx, actor, { action: "asset.updated", entityType: "Asset", entityId: after.id, before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])) });
        return after;
      }
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('asset_code'))::text`;
      let code = clean(input.code);
      if (!code) {
        const last = await tx.asset.findMany({ where: { code: { startsWith: "AST-" } }, select: { code: true } });
        const n = Math.max(0, ...last.map((a) => Number(a.code.slice(4)) || 0)) + 1;
        code = `AST-${String(n).padStart(4, "0")}`;
      }
      const created = await tx.asset.create({ data: { ...data, code, createdById: actor.userId ?? null } });
      await audit(tx, actor, { action: "asset.created", entityType: "Asset", entityId: created.id, after: { code, ...data } });
      return created;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AppError("Another asset already has this Asset ID.", "CONFLICT");
    throw e;
  }
}

/**
 * Move an asset: Chair (Restaurant) → Meeting room. Part of a line (4 of 20 chairs) splits off as
 * its own record at the new place, so both places stay right.
 */
export async function moveAsset(input: { assetId: string; to: string; quantity?: number | null; note?: string | null }, actor: Actor, now = new Date()) {
  need(actor, ["assets.manage", "inventory.approve"], msg("Only a manager or the MD moves assets."));
  const to = input.to.trim();
  if (!to) throw new AppError("Where is it going?", "VALIDATION", { to: msg("Required") });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "assets" WHERE "id" = ${input.assetId} FOR UPDATE`;
    const a = await tx.asset.findUnique({ where: { id: input.assetId } });
    if (!a) throw new AppError("Asset not found.", "NOT_FOUND");
    if ((a.location ?? "") === to) throw new AppError(msgf("It is already at {place}.", { place: to }));
    const qty = Math.round(input.quantity ?? a.quantity);
    if (qty < 1 || qty > a.quantity) throw new AppError(msgf("Move between 1 and {n}.", { n: a.quantity }), "VALIDATION", { quantity: msg("Range") });
    const note = clean(input.note);
    let movedId = a.id;
    if (qty < a.quantity) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('asset_code'))::text`;
      const unitCost = a.purchaseCost ? Math.round(a.purchaseCost / a.quantity) : null;
      await tx.asset.update({ where: { id: a.id }, data: { quantity: a.quantity - qty, purchaseCost: unitCost ? unitCost * (a.quantity - qty) : null } });
      const siblings = await tx.asset.count({ where: { code: { startsWith: `${a.code}-` } } });
      const part = await tx.asset.create({
        data: {
          code: `${a.code}-${siblings + 1}`, name: a.name, category: a.category, location: to, departmentId: a.departmentId, quantity: qty, purchaseDate: a.purchaseDate,
          purchaseCost: unitCost ? unitCost * qty : null, condition: a.condition, status: a.status, supplierId: a.supplierId, serialNumber: null,
          assignedTo: a.assignedTo, notes: a.notes, createdById: actor.userId ?? null,
        },
      });
      movedId = part.id;
      await tx.assetMovement.create({ data: { assetId: a.id, kind: "MOVED", fromValue: a.location, toValue: to, quantity: qty, note: `${qty} of ${a.quantity} moved (now ${part.code})${note ? ` — ${note}` : ""}`, movedById: actor.userId ?? null, at: now } });
    } else {
      await tx.asset.update({ where: { id: a.id }, data: { location: to } });
    }
    await tx.assetMovement.create({ data: { assetId: movedId, kind: "MOVED", fromValue: a.location, toValue: to, quantity: qty, note, movedById: actor.userId ?? null, at: now } });
    await audit(tx, actor, { action: "asset.moved", entityType: "Asset", entityId: a.id, before: { location: a.location, quantity: a.quantity }, after: { location: to, moved: qty, note } });
    return { name: a.name, qty, from: a.location ?? "—", to };
  });
}

/** Asset figures for the overview and the daily report. */
export async function assetSummary(from?: Date, to?: Date) {
  const [all, moved] = await Promise.all([
    db.asset.findMany({ where: { status: { notIn: ["DISPOSED", "LOST"] } }, select: { quantity: true, status: true, condition: true, purchaseCost: true, name: true, code: true, location: true } }),
    from && to ? db.assetMovement.count({ where: { kind: "MOVED", at: { gte: from, lt: to } } }) : Promise.resolve(0),
  ]);
  const repair = all.filter((a) => a.status === "UNDER_REPAIR" || a.status === "OUT_OF_ORDER" || a.condition === "DAMAGED" || a.condition === "POOR");
  return {
    records: all.length, units: all.reduce((t, a) => t + a.quantity, 0), value: all.reduce((t, a) => t + (a.purchaseCost ?? 0), 0),
    underRepair: all.filter((a) => a.status === "UNDER_REPAIR").length, outOfOrder: all.filter((a) => a.status === "OUT_OF_ORDER").length,
    needsAttention: repair.map((a) => ({ name: a.name, code: a.code, location: a.location, status: a.status, condition: a.condition })).slice(0, 12),
    moved,
  };
}

/** Today in the stores, by business date (for screens that only know "now"). */
export async function inventoryToday(now = new Date()) {
  const s = await getSettings();
  const today = businessDateOf(now, businessDayConfig(s));
  return { today, day: await inventoryDay(today, today) };
}

/** A manager (or the MD) records an asset's condition or status — e.g. TV #TV-012: Needs repair, Under repair. */
export async function setAssetState(input: { assetId: string; condition?: string | null; status?: string | null; note?: string | null }, actor: Actor, now = new Date()) {
  need(actor, ["assets.manage", "inventory.approve"], msg("Only a manager or the MD updates assets."));
  return db.$transaction(async (tx) => {
    const a = await tx.asset.findUnique({ where: { id: input.assetId } });
    if (!a) throw new AppError("Asset not found.", "NOT_FOUND");
    const condition = input.condition || a.condition, status = input.status || a.status;
    checkAssetCodes(condition, status);
    if (condition === a.condition && status === a.status) throw new AppError("Nothing changed.");
    await tx.asset.update({ where: { id: a.id }, data: { condition, status } });
    const note = clean(input.note);
    if (condition !== a.condition) await tx.assetMovement.create({ data: { assetId: a.id, kind: "CONDITION", fromValue: a.condition, toValue: condition, note, movedById: actor.userId ?? null, at: now } });
    if (status !== a.status) await tx.assetMovement.create({ data: { assetId: a.id, kind: "STATUS", fromValue: a.status, toValue: status, note, movedById: actor.userId ?? null, at: now } });
    await audit(tx, actor, { action: "asset.state_changed", entityType: "Asset", entityId: a.id, before: { condition: a.condition, status: a.status }, after: { condition, status, note } });
    return { name: a.name, code: a.code };
  });
}
