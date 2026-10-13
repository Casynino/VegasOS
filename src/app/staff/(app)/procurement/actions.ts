"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { msg } from "@/i18n/msg";
import type { PermissionCode } from "@/lib/permissions";
import {
  authorizeQuote, cancelInvoice, cancelOrder, closeDeliveryShort, issueOrder, paySupplier, proposeQuote, recordDelivery, recordInvoice, reportDelivery, saveQuote, verifyInvoice,
} from "@/server/services/procurement";

/**
 * Procurement — every step runs here as the signed-in person. The right is checked here and again in the service
 * (the Accountant buys, Finance authorizes and pays — nobody does both, whatever the screen shows).
 */
async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, roleCode: user.roleCode, ipAddress, permissions: user.permissions };
}
function refresh(id?: string) {
  revalidatePath("/staff/procurement");
  if (id) revalidatePath(`/staff/procurement/${id}`);
  revalidatePath("/staff/stock-requests");
  revalidatePath("/staff/inventory");
  revalidatePath("/staff/expenses");
  revalidatePath("/staff/finance", "layout");
  revalidatePath("/staff", "layout");
}

const Id = z.string().min(1).max(40);
const Why = z.string().trim().max(300).optional().transform((v) => v || null);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Choose a date."));
const file = (formData: FormData, name: string) => {
  const f = formData.get(name);
  return f instanceof File && f.size > 0 ? f : null;
};
function payload(formData: FormData) {
  try { return JSON.parse(String(formData.get("payload") ?? "")); } catch { throw new AppError("The form could not be read — try again.", "VALIDATION"); }
}

const QUOTE: PermissionCode[] = ["procurement.manage"];
const FINANCE: PermissionCode[] = ["purchases.authorize", "purchases.pay"];

const Quote = z.object({
  id: Id,
  supplierId: z.string().max(40).nullable().optional(),
  newSupplier: z.object({ name: z.string().trim().max(80), contactName: z.string().trim().max(80).optional(), phone: z.string().trim().max(40).optional(), email: z.string().trim().max(80).optional() }).nullable().optional(),
  contact: z.string().trim().max(120).optional(),
  validUntil: Day.nullable().optional().or(z.literal("")),
  deliveryDays: z.number().int().min(0).max(365).nullable().optional(),
  note: Why,
  lines: z.array(z.object({ itemId: Id, quantity: z.number().positive().max(1_000_000), unitPrice: z.number().int().min(0).max(2_000_000_000) })).min(1, msg("Price at least one item.")).max(60),
});
/** The Accountant records one supplier's quotation (and its document). */
export async function recordQuoteAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(...QUOTE);
    const d = parseInput(Quote, payload(formData));
    await saveQuote(d.id, { ...d, validUntil: d.validUntil || null }, file(formData, "document"), await actor(user));
    refresh(d.id);
    return null;
  }, msg("Quotation recorded."));
}

export async function proposeQuoteAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ needsFinance: boolean }>> {
  return runAction(async () => {
    const user = await authorize(...QUOTE);
    const d = parseInput(z.object({ id: Id, quoteId: Id }), Object.fromEntries(formData.entries()));
    const r = await proposeQuote(d.id, d.quoteId, await actor(user));
    refresh(d.id);
    return { needsFinance: r.needsFinance };
  }, msg("Quotation proposed."));
}

/** Finance authorizes a price above the budget, or sends it back to the Accountant with the reason. */
export async function authorizeQuoteAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("purchases.authorize");
    const d = parseInput(z.object({ id: Id, decision: z.enum(["AUTHORIZE", "RETURN"]), note: Why }), Object.fromEntries(formData.entries()));
    await authorizeQuote(d.id, d.decision, d.note, await actor(user));
    refresh(d.id);
    return null;
  }, msg("Saved."));
}

export async function issueOrderAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ orderNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(...QUOTE);
    const d = parseInput(z.object({ id: Id, expectedDeliveryOn: Day, note: Why }), Object.fromEntries(formData.entries()));
    const r = await issueOrder(d.id, { expectedDeliveryOn: d.expectedDeliveryOn, note: d.note }, await actor(user));
    refresh(d.id);
    return { orderNumber: r.orderNumber };
  }, msg("Purchase order issued."));
}

const Delivery = z.object({
  id: Id, note: Why,
  lines: z.array(z.object({
    itemId: Id, quantity: z.number().min(0).max(1_000_000), rejectedQty: z.number().min(0).max(1_000_000).optional(),
    problem: z.enum(["DAMAGED", "WRONG", "OTHER"]).nullable().optional(), note: z.string().trim().max(200).optional(), expiresOn: Day.nullable().optional().or(z.literal("")),
  })).min(1, msg("Say what arrived.")).max(60),
});
/** Goods arrived: what was accepted goes into stock (once), anything not accepted is recorded with the problem. */
export async function recordDeliveryAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("procurement.manage", "inventory.receive");
    const d = parseInput(Delivery, payload(formData));
    await recordDelivery(d.id, { note: d.note, lines: d.lines.map((l) => ({ ...l, expiresOn: l.expiresOn || null })) }, file(formData, "document"), await actor(user));
    refresh(d.id);
    return null;
  }, msg("Delivery recorded."));
}

export async function closeDeliveryAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(...QUOTE);
    const d = parseInput(z.object({ id: Id, reason: z.string().trim().max(300) }), Object.fromEntries(formData.entries()));
    await closeDeliveryShort(d.id, d.reason, await actor(user));
    refresh(d.id);
    return null;
  }, msg("Delivery closed."));
}

export async function cancelOrderAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("procurement.manage", "purchases.authorize");
    const d = parseInput(z.object({ id: Id, reason: z.string().trim().max(300) }), Object.fromEntries(formData.entries()));
    await cancelOrder(d.id, d.reason, await actor(user));
    refresh(d.id);
    return null;
  }, msg("Order cancelled."));
}

/** The person who asked says whether what arrived is right (or what is missing, damaged or wrong). */
export async function reportDeliveryAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("inventory.request", "procurement.manage", "expenses.approve");
    const d = parseInput(z.object({ id: Id, correct: z.enum(["yes", "no"]), note: Why }), Object.fromEntries(formData.entries()));
    await reportDelivery(d.id, { correct: d.correct === "yes", note: d.note }, await actor(user));
    refresh(d.id);
    return null;
  }, msg("Thank you — noted."));
}

const Invoice = z.object({
  id: Id, number: z.string().trim().min(1, msg("Enter the invoice number.")).max(60),
  amount: z.coerce.number().int(msg("Whole shillings only.")).min(1, msg("Enter the invoice amount.")),
  invoiceDate: Day, dueOn: Day.optional().or(z.literal("")), note: Why,
});
export async function recordInvoiceAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(...QUOTE);
    const d = parseInput(Invoice, Object.fromEntries(formData.entries()));
    await recordInvoice(d.id, { number: d.number, amount: d.amount, invoiceDate: d.invoiceDate, dueOn: d.dueOn || null, note: d.note }, file(formData, "document"), await actor(user));
    refresh(d.id);
    return null;
  }, msg("Invoice recorded."));
}

export async function verifyInvoiceAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("purchases.pay");
    const d = parseInput(z.object({ id: Id, requestId: Id, decision: z.enum(["VERIFY", "DISPUTE"]), note: Why }), Object.fromEntries(formData.entries()));
    await verifyInvoice(d.id, d.decision, d.note, await actor(user));
    refresh(d.requestId);
    return null;
  }, msg("Saved."));
}

export async function cancelInvoiceAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(...QUOTE, ...FINANCE);
    const d = parseInput(z.object({ id: Id, requestId: Id, reason: z.string().trim().max(300) }), Object.fromEntries(formData.entries()));
    await cancelInvoice(d.id, d.reason, await actor(user));
    refresh(d.requestId);
    return null;
  }, msg("Invoice cancelled."));
}

/** Finance pays a verified invoice — recorded when the money has really been paid. */
export async function paySupplierAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("purchases.pay");
    const d = parseInput(z.object({
      id: Id, requestId: Id, amount: z.coerce.number().int(msg("Whole shillings only.")).min(1, msg("Enter the amount paid.")),
      accountId: z.string().min(1, msg("Which account paid?")).max(40), paidOn: Day, reference: z.string().trim().max(80).optional(),
      note: Why, clientKey: z.string().trim().min(8).max(64).optional(),
    }), Object.fromEntries(formData.entries()));
    await paySupplier(d.id, { amount: d.amount, accountId: d.accountId, paidOn: d.paidOn, reference: d.reference, note: d.note, clientKey: d.clientKey }, await actor(user));
    refresh(d.requestId);
    return null;
  }, msg("Payment recorded."));
}
