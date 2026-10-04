"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import {
  approvePurchase, cancelStockRequest, createStockRequest, editStockRequest, resubmitStockRequest, reviewStockRequest, savePurchase, sendBackPurchase,
} from "@/server/services/stock-requests";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, roleCode: user.roleCode, ipAddress, permissions: user.permissions };
}
function refresh() {
  revalidatePath("/staff/stock-requests");
  revalidatePath("/staff/inventory");
  revalidatePath("/staff/expenses");
  revalidatePath("/staff/finance", "layout");
  revalidatePath("/staff", "layout");
}
const Id = z.string().min(1).max(40);
const Why = z.string().trim().max(300);

const Item = z.object({
  id: z.string().max(40).nullable().optional(),
  name: z.string().trim().min(1, "Name each item.").max(80),
  quantity: z.coerce.number().positive("Give each item a quantity.").max(100_000),
  unit: z.string().trim().max(20),
  note: z.string().trim().max(120).optional(),
  inventoryItemId: z.string().max(40).nullable().optional(),
});
const Request = z.object({
  department: z.string().trim().min(1, "Choose the department it is for.").max(40),
  urgent: z.boolean(),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  reason: Why.optional(),
  note: Why.optional(),
  items: z.array(Item).min(1, "Add at least one item.").max(40),
});

/** A department asks for stock (the kitchen, the waiters, reception for housekeeping…). */
export async function createStockRequestAction(input: z.input<typeof Request>): Promise<ActionResult<{ number: string }>> {
  return runAction(async () => {
    const user = await authorize("inventory.request");
    const d = parseInput(Request, input);
    const r = await createStockRequest({ ...d, neededBy: d.neededBy || null }, await actor(user));
    refresh();
    return { number: r.number };
  }, "Request sent to the manager.");
}

const Edit = z.object({ id: Id, items: z.array(Item).min(1, "Keep at least one item.").max(40), urgent: z.boolean().optional(), note: Why.optional(), reason: Why.optional() });
/** Change the list: the manager (with the reason) before buying, or the person who asked once it was sent back to them. */
export async function editStockRequestAction(input: z.input<typeof Edit>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("inventory.request", "expenses.approve");
    const d = parseInput(Edit, input);
    await editStockRequest(d.id, { items: d.items, urgent: d.urgent, note: d.note, reason: d.reason }, await actor(user));
    refresh();
    return null;
  }, "Request updated.");
}

const Review = z.object({ id: Id, decision: z.enum(["APPROVE", "SEND_BACK", "REJECT"]), note: Why.optional() });
/** The manager's review: approve for purchase, send back to be changed, or reject. */
export async function reviewStockRequestAction(input: z.input<typeof Review>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("expenses.approve");
    const d = parseInput(Review, input);
    await reviewStockRequest(d.id, d.decision, d.note ?? null, await actor(user));
    refresh();
    return null;
  }, input.decision === "APPROVE" ? "Approved for purchase." : input.decision === "SEND_BACK" ? "Sent back to change." : "Rejected.");
}

/** The person who asked sends it again after changing it. */
export async function resubmitStockRequestAction(input: { id: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("inventory.request");
    await resubmitStockRequest(Id.parse(input.id), await actor(user));
    refresh();
    return null;
  }, "Sent to the manager again.");
}

/** The person who asked no longer needs it. */
export async function cancelStockRequestAction(input: { id: string; reason?: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("inventory.request");
    await cancelStockRequest(Id.parse(input.id), Why.optional().parse(input.reason) ?? null, await actor(user));
    refresh();
    return null;
  }, "Request cancelled.");
}

const Purchase = z.object({
  lines: z.array(z.object({
    id: Id, inventoryItemId: z.string().max(40).nullable().optional(),
    purchasedQty: z.coerce.number().min(0).max(100_000), unitPrice: z.coerce.number().int().min(0).max(1_000_000_000),
    lineTotal: z.coerce.number().int().min(0).max(1_000_000_000).nullable().optional(), expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })).min(1).max(60),
  supplierId: z.string().max(40).nullable().optional(),
  supplierName: z.string().trim().max(120).nullable().optional(),
  receiptNumber: z.string().trim().max(60).nullable().optional(),
  noReceiptReason: z.string().trim().max(200).nullable().optional(),
  purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "When was it bought?"),
  accountId: z.string().max(40).nullable().optional(),
  note: Why.nullable().optional(),
  submit: z.boolean(),
});
/**
 * Record what was actually bought (the form sends JSON in "data" and the receipt photo in "receipt"):
 * saved while buying, or sent for the final approval.
 */
export async function savePurchaseAction(form: FormData): Promise<ActionResult<{ purchaseNumber: string; total: number; status: string }>> {
  return runAction(async () => {
    const user = await authorize("inventory.receive");
    const id = Id.parse(form.get("id"));
    let raw: unknown;
    try { raw = JSON.parse(String(form.get("data") ?? "")); } catch { throw new AppError("The purchase could not be read — try again.", "VALIDATION"); }
    const d = parseInput(Purchase, raw);
    const file = form.get("receipt");
    const r = await savePurchase(id, d, file instanceof File && file.size > 0 ? file : null, await actor(user));
    refresh();
    return r;
  });
}

/** Back to the buyer for correction (a wrong amount, a price, no receipt). */
export async function sendBackPurchaseAction(input: { id: string; reason: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("expenses.approve");
    await sendBackPurchase(Id.parse(input.id), Why.parse(input.reason), await actor(user));
    refresh();
    return null;
  }, "Sent back for correction.");
}

/** The final approval: the stock goes in and the one expense is made — in one step. */
export async function approvePurchaseAction(input: { id: string; categoryId?: string | null }): Promise<ActionResult<{ expenseNumber: string | null; amount: number; received: number }>> {
  return runAction(async () => {
    const user = await authorize("expenses.approve");
    const r = await approvePurchase(Id.parse(input.id), { categoryId: input.categoryId ? Id.parse(input.categoryId) : null }, await actor(user));
    refresh();
    return r;
  });
}
