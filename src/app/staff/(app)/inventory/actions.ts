"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import {
  clearExpiry, countStock, decideWaste, itemDetail, moveAsset, assetHistory, receiveStock, reportWaste, saveAsset, saveInventoryCategory,
  saveInventoryDepartment, saveInventoryItem, saveRecipe, saveSupplier, setAssetState, takeStock, transferStock,
} from "@/server/services/inventory";
import { formatQty } from "@/lib/inventory";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions };
}
function refresh() {
  for (const p of ["/staff/inventory", "/staff/assets", "/manager/dashboard", "/admin/dashboard"]) revalidatePath(p, "layout");
}
const Id = z.string().min(1).max(40);
const Qty = z.coerce.number().positive(msg("Enter the quantity.")).max(10_000_000);
const Text = (max = 300) => z.string().trim().max(max).nullish();
const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("").transform(() => null));
/** "Beef: 12 kg → 10 kg" — shown to the person who did it, units in their language. */
const moved = (r: { name: string; before: number; after: number; unit: string }, t: T) => `${r.name}: ${formatQty(r.before, r.unit, t)} → ${formatQty(r.after, r.unit, t)}`;

// ── Stock moving ──

export async function receiveStockAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const user = await authorize("inventory.receive");
    const d = z.object({ itemId: Id, quantity: Qty, unitCost: z.coerce.number().int().min(0).max(1_000_000_000).nullish(), supplierId: Id.nullish().or(z.literal("")), reference: Text(80), expiresOn: Date_, note: Text() }).parse(input);
    const r = await receiveStock({ ...d, supplierId: d.supplierId || null }, await actor(user));
    refresh();
    return { message: moved(r, await getT()) };
  });
}

export async function takeStockAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const user = await authorize("inventory.use", "inventory.approve");
    const d = z.object({ itemId: Id, quantity: Qty, reason: z.string().min(1).max(40), departmentId: Id.nullish(), note: Text() }).parse(input);
    const r = await takeStock(d, await actor(user));
    refresh();
    return { message: moved(r, await getT()) };
  });
}

export async function reportWasteAction(input: unknown): Promise<ActionResult<{ message: string; pending: boolean }>> {
  return runAction(async () => {
    const user = await authorize("inventory.use", "inventory.approve");
    const d = z.object({ itemId: Id, quantity: Qty, reason: z.string().min(1).max(40), note: Text() }).parse(input);
    const r = await reportWaste(d, await actor(user));
    refresh();
    const t = await getT();
    return { pending: r.pending, message: r.pending ? t("{name}: waste sent to the manager to approve.", { name: r.name }) : moved(r, t) };
  });
}

export async function decideWasteAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const user = await authorize("inventory.approve");
    const d = z.object({ id: Id, approve: z.boolean(), note: Text() }).parse(input);
    const r = await decideWaste(d.id, d.approve, d.note ?? null, await actor(user));
    refresh();
    const t = await getT();
    return { message: r.approved ? t("Approved — {change}", { change: moved(r, t) }) : t("Rejected — {name} stays at {qty}.", { name: r.name, qty: formatQty(r.after, r.unit, t) }) };
  });
}

export async function transferStockAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const user = await authorize("inventory.approve");
    const d = z.object({ itemId: Id, toDepartmentId: Id, quantity: Qty, note: Text() }).parse(input);
    const r = await transferStock(d, await actor(user));
    refresh();
    const t = await getT();
    return { message: `${formatQty(r.qty, r.unit, t)} ${r.name}: ${t(r.from)} → ${t(r.to)}` };
  });
}

export async function countStockAction(input: unknown): Promise<ActionResult<{ corrected: number }>> {
  return runAction(async () => {
    const user = await authorize("inventory.approve");
    const d = z.object({ lines: z.array(z.object({ itemId: Id, counted: z.coerce.number().min(0).max(10_000_000), reason: z.string().max(40).nullish(), note: Text() })).min(1).max(500) }).parse(input);
    const r = await countStock(d, await actor(user));
    refresh();
    return { corrected: r.corrected.length };
  });
}

export async function clearExpiryAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("inventory.use", "inventory.approve");
    const d = z.object({ id: Id }).parse(input);
    await clearExpiry(d.id, await actor(user));
    refresh();
    return null;
  }, msg("Marked as dealt with."));
}

export async function itemDetailAction(input: unknown) {
  return runAction(async () => {
    const user = await authorize("inventory.view");
    const d = z.object({ id: Id }).parse(input);
    // Purchase prices and suppliers only for those who buy or approve stock.
    const money = ["inventory.receive", "inventory.approve", "expenses.approve", "finance.view"].some((p) => user.permissions.has(p as never));
    return itemDetail(d.id, { money });
  });
}

// ── Setup (the MD) ──

const Num = z.coerce.number().min(0).max(10_000_000).nullish().or(z.literal("").transform(() => null));

export async function saveItemAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize("inventory.manage");
    const d = z.object({
      id: Id.nullish(), name: z.string().trim().min(1, msg("Name the item.")).max(80), sku: Text(40), categoryId: Id, departmentId: Id, unit: z.string().min(1).max(20),
      minStock: Num, reorderLevel: Num, maxStock: Num, costPerUnit: Num, supplierId: Id.nullish().or(z.literal("")), location: Text(60), tracksExpiry: z.boolean().optional(),
      isActive: z.boolean().optional(), notes: Text(), openingQuantity: Num,
    }).parse(input);
    const r = await saveInventoryItem({ ...d, supplierId: d.supplierId || null }, await actor(user));
    refresh();
    return { id: r.id };
  }, msg("Saved."));
}

export async function saveDepartmentAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("inventory.manage");
    const d = z.object({ id: Id.nullish(), name: z.string().trim().min(1).max(40), isActive: z.boolean().optional() }).parse(input);
    await saveInventoryDepartment(d, await actor(user));
    refresh();
    return null;
  }, msg("Saved."));
}

export async function saveCategoryAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("inventory.manage");
    const d = z.object({ id: Id.nullish(), name: z.string().trim().min(1).max(40), departmentId: Id.nullish().or(z.literal("")), isActive: z.boolean().optional() }).parse(input);
    await saveInventoryCategory({ ...d, departmentId: d.departmentId || null }, await actor(user));
    refresh();
    return null;
  }, msg("Saved."));
}

export async function saveSupplierAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("inventory.manage");
    const d = z.object({ id: Id.nullish(), name: z.string().trim().min(1).max(80), contactName: Text(80), phone: Text(30), email: Text(80), notes: Text(), isActive: z.boolean().optional() }).parse(input);
    await saveSupplier(d, await actor(user));
    refresh();
    return null;
  }, msg("Saved."));
}

export async function saveRecipeAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("inventory.manage");
    const d = z.object({ menuItemId: Id, lines: z.array(z.object({ itemId: Id, quantity: z.coerce.number().positive().max(100_000), unit: z.string().min(1).max(20) })).max(40) }).parse(input);
    await saveRecipe(d.menuItemId, d.lines, await actor(user));
    revalidatePath("/staff/inventory", "layout");
    return null;
  }, msg("Recipe saved."));
}

// ── Assets ──

export async function saveAssetAction(input: unknown): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const user = await authorize("assets.manage");
    const d = z.object({
      id: Id.nullish(), code: Text(30), name: z.string().trim().min(1, msg("Name the asset.")).max(80), category: z.string().trim().min(1).max(60), location: Text(60),
      departmentId: Id.nullish().or(z.literal("")), quantity: z.coerce.number().int().min(1).max(100_000).nullish(), purchaseDate: Date_,
      purchaseCost: z.coerce.number().int().min(0).max(100_000_000_000).nullish().or(z.literal("").transform(() => null)),
      condition: z.string().min(1).max(20), status: z.string().min(1).max(20), supplierId: Id.nullish().or(z.literal("")),
      serialNumber: Text(60), assignedTo: Text(80), notes: Text(),
    }).parse(input);
    const r = await saveAsset({ ...d, departmentId: d.departmentId || null, supplierId: d.supplierId || null }, await actor(user));
    refresh();
    return { id: r.id, code: r.code };
  }, msg("Saved."));
}

export async function moveAssetAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const user = await authorize("assets.manage", "inventory.approve");
    const d = z.object({ assetId: Id, to: z.string().trim().min(1).max(60), quantity: z.coerce.number().int().min(1).nullish(), note: Text() }).parse(input);
    const r = await moveAsset(d, await actor(user));
    refresh();
    const t = await getT();
    return { message: `${r.qty > 1 ? `${r.qty} × ` : ""}${r.name}: ${t(r.from)} → ${t(r.to)}` };
  });
}

export async function assetHistoryAction(input: unknown) {
  return runAction(async () => {
    await authorize("assets.view");
    const d = z.object({ id: Id }).parse(input);
    return assetHistory(d.id);
  });
}

export async function assetStateAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("assets.manage", "inventory.approve");
    const d = z.object({ assetId: Id, condition: z.string().max(20).nullish(), status: z.string().max(20).nullish(), note: Text() }).parse(input);
    await setAssetState(d, await actor(user));
    refresh();
    return null;
  }, msg("Asset updated."));
}
