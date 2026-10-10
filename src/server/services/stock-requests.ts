import "server-only";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { getSettingsTx } from "../settings";
import type { Prisma } from "@/generated/prisma/client";
import { drinkEmoji, drinkUnit, type StockGroup } from "@/lib/stock-catalog";
import { formatQty, round3 } from "@/lib/inventory";
import { mediaUrl } from "./media";
import { receiveStockTx } from "./inventory";
import { createPurchaseExpenseTx, storeReceipt } from "./expenses";
import { accountOptions, resolveAccountTx } from "./payment-accounts";
import type { Actor } from "./reservations";
import { msg, msgf } from "@/i18n/msg";

/**
 * STOCK REQUESTS → PURCHASE → FINAL APPROVAL.
 *
 *  1. A department asks (kitchen, bar, reception for housekeeping…): what, how much, why. No money.
 *  2. A manager reviews it: approve for purchase, send it back to be changed, or reject — and may
 *     change the amounts or the list first (with the reason). Approval is permission to buy, not
 *     an expense.
 *  3. Whoever buys records what was ACTUALLY bought: quantities, prices, the supplier, the receipt
 *     (number + photo) and the company account that paid — then sends it for final approval.
 *  4. A manager checks the purchase: sends it back for correction, or approves it. Only then, in
 *     one step, the stock is received (at the price paid, linked to the purchase line), ONE
 *     expense is made for the actual amount (the ledger and the account read it — nothing is
 *     typed in twice) and the request is completed.
 * Every step keeps who (and in what role), when, from → to, what changed and why.
 */

type StockActor = Actor & { roleCode?: string | null };

export const STOCK_STATUS: Record<string, string> = {
  SUBMITTED: msg("Waiting for review"), SENT_BACK: msg("Sent back to change"), APPROVED: msg("Approved — to buy"), PURCHASING: msg("Being bought"),
  PENDING_APPROVAL: msg("Bought — waiting for approval"), COMPLETED: msg("Done — in stock"), REJECTED: msg("Rejected"), CANCELLED: msg("Cancelled"),
};
export const OPEN_STOCK = ["SUBMITTED", "SENT_BACK", "APPROVED", "PURCHASING", "PENDING_APPROVAL"];

/** Asking: the kitchen, the waiters, reception (for housekeeping, maintenance…). */
export const canRequestStock = (a: Actor) => !!a.permissions?.has("inventory.request");
/** Reviewing and the final approval: managers, the MD, the owner. */
export const canReviewStock = (a: Actor) => !!a.permissions?.has("expenses.approve");
/** Buying and recording the purchase. */
export const canBuyStock = (a: Actor) => !!a.permissions?.has("inventory.receive");

/** What each department's purchases are, as an expense (the approver may choose another). */
const EXPENSE_GROUP: Record<string, string> = {
  KITCHEN: "FOOD", RESTAURANT: "FOOD", BAR: "BAR_SUPPLIES", HOUSEKEEPING: "HOUSEKEEPING", MAINTENANCE: "MAINTENANCE",
  RECEPTION: "OFFICE_SUPPLIES", OFFICE: "OFFICE_SUPPLIES", GENERAL: "OTHER",
};

const clean = (s: string | null | undefined, max = 300) => s?.trim().slice(0, max) || null;
const line = (i: { quantity: number; unit: string; name: string }) => `${i.quantity} ${i.unit} ${i.name}`;
const money = (n: number) => `TZS ${n.toLocaleString("en-US")}`;

async function eventTx(tx: Tx, requestId: string, action: string, actor: StockActor, p: { from?: string | null; to?: string | null; reason?: string | null; before?: unknown; after?: unknown }, at: Date) {
  await tx.stockRequestEvent.create({
    data: {
      requestId, action, fromStatus: p.from ?? null, toStatus: p.to ?? null, byId: actor.userId ?? null, byLabel: actor.label ?? null, byRole: actor.role ?? null,
      reason: p.reason ?? null, before: (p.before ?? undefined) as Prisma.InputJsonValue | undefined, after: (p.after ?? undefined) as Prisma.InputJsonValue | undefined, at,
    },
  });
}

/** Lock a request and check it is at one of the given steps. */
async function lockRequestTx(tx: Tx, id: string, statuses: string[], wrong: string) {
  await tx.$queryRaw`SELECT "id" FROM "stock_requests" WHERE "id" = ${id} FOR UPDATE`;
  const r = await tx.stockRequest.findUnique({ where: { id }, include: { items: { orderBy: { id: "asc" } } } });
  if (!r) throw new AppError("Request not found.", "NOT_FOUND");
  if (!statuses.includes(r.status)) throw new AppError(wrong, "CONFLICT");
  return r;
}

async function nextNumberTx(tx: Tx, prefix: "SR" | "P", now: Date) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock_${prefix}_number`}))::text`;
  const year = String(now.getFullYear());
  const last = prefix === "SR"
    ? (await tx.stockRequest.findFirst({ where: { number: { startsWith: `SR-${year}-` } }, orderBy: { number: "desc" }, select: { number: true } }))?.number
    : (await tx.stockRequest.findFirst({ where: { purchaseNumber: { startsWith: `P-${year}-` } }, orderBy: { purchaseNumber: "desc" }, select: { purchaseNumber: true } }))?.purchaseNumber;
  return `${prefix}-${year}-${String(last ? Number(last.slice(-4)) + 1 : 1).padStart(4, "0")}`;
}

// ───────────────────────── 1. Asking ─────────────────────────

export interface StockRequestInput {
  /** The department's code: KITCHEN, BAR, RESTAURANT, HOUSEKEEPING, MAINTENANCE, RECEPTION, OFFICE, GENERAL. */
  department: string;
  urgent: boolean;
  neededBy?: string | null;
  /** What it is for. */
  reason?: string | null;
  note?: string | null;
  items: { id?: string | null; name: string; quantity: number; unit: string; note?: string | null; inventoryItemId?: string | null }[];
}

function cleanItems(items: StockRequestInput["items"]) {
  const out = items.map((i) => ({ id: i.id ?? null, name: i.name.trim().slice(0, 80), quantity: round3(i.quantity), unit: i.unit.trim() || "pcs", note: clean(i.note, 120), inventoryItemId: i.inventoryItemId || null })).filter((i) => i.name);
  if (!out.length) throw new AppError("Add at least one item.", "VALIDATION", { items: msg("Empty") });
  if (out.some((i) => !(i.quantity > 0) || i.quantity > 100_000)) throw new AppError("Give each item a quantity.", "VALIDATION", { items: msg("Quantity") });
  return out;
}

/** Link lines to the department's stock items: the one picked, or the item with the same name. */
async function linkItemsTx(tx: Tx, departmentId: string | null, items: ReturnType<typeof cleanItems>) {
  const picked = items.map((i) => i.inventoryItemId).filter((x): x is string => !!x);
  const known = await tx.inventoryItem.findMany({
    where: { isActive: true, OR: [{ id: { in: picked } }, ...(departmentId ? [{ departmentId, name: { in: items.map((i) => i.name), mode: "insensitive" as const } }] : [])] },
    select: { id: true, name: true, departmentId: true },
  });
  return items.map((i) => {
    const byId = i.inventoryItemId ? known.find((k) => k.id === i.inventoryItemId) : null;
    if (i.inventoryItemId && !byId) throw new AppError(msgf("{item} is not a stock item in use.", { item: i.name }), "VALIDATION", { items: msg("Item") });
    const byName = known.find((k) => k.departmentId === departmentId && k.name.toLowerCase() === i.name.toLowerCase());
    return { ...i, inventoryItemId: byId?.id ?? byName?.id ?? null };
  });
}

export async function createStockRequest(input: StockRequestInput, actor: StockActor, now = new Date()) {
  if (!actor.userId || !canRequestStock(actor)) throw new AppError("You cannot request stock.", "FORBIDDEN");
  const items = cleanItems(input.items);
  return db.$transaction(async (tx) => {
    const dept = await tx.inventoryDepartment.findUnique({ where: { code: input.department } });
    if (!dept || !dept.isActive) throw new AppError("Choose the department it is for.", "VALIDATION", { department: msg("Required") });
    const linked = await linkItemsTx(tx, dept.id, items);
    const number = await nextNumberTx(tx, "SR", now);
    const r = await tx.stockRequest.create({
      data: {
        number, department: dept.code, departmentId: dept.id, urgent: input.urgent, neededBy: input.neededBy ? new Date(`${input.neededBy}T00:00:00Z`) : null,
        reason: clean(input.reason), note: clean(input.note), requestedById: actor.userId!, createdAt: now, status: "SUBMITTED",
        items: { create: linked.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, note: i.note, inventoryItemId: i.inventoryItemId })) },
      },
    });
    await eventTx(tx, r.id, "SUBMITTED", actor, { to: "SUBMITTED", after: { department: dept.name, urgent: input.urgent, items: linked.map(line), reason: r.reason } }, now);
    await audit(tx, actor, { action: "stock_request.created", entityType: "StockRequest", entityId: r.id, after: { number, department: dept.name, urgent: input.urgent, items: linked.map(line), reason: r.reason, role: actor.role ?? null } });
    return r;
  });
}

/**
 * Change the list: the manager while it is waiting or approved (the amounts approved, items added
 * or taken off — always with the reason; what was asked stays), or the person who asked once it
 * was sent back to them (what they ask for). Lines keep their identity; nothing is deleted.
 */
export async function editStockRequest(id: string, input: { items: StockRequestInput["items"]; urgent?: boolean; note?: string | null; reason?: string | null }, actor: StockActor, now = new Date()) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  const items = cleanItems(input.items);
  await db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, id, ["SUBMITTED", "SENT_BACK", "APPROVED"], msg("This request can no longer be changed — it is being bought or closed."));
    const asker = r.status === "SENT_BACK" && r.requestedById === actor.userId;
    if (!asker && !(canReviewStock(actor) && r.status !== "SENT_BACK")) throw new AppError(r.status === "SENT_BACK" ? msg("It was sent back to the person who asked — they change it.") : msg("Only a manager can change a stock request."), "FORBIDDEN");
    const why = clean(input.reason);
    if (!asker && (why?.length ?? 0) < 3) throw new AppError("Say why you change the request.", "VALIDATION", { reason: msg("Required") });
    const linked = await linkItemsTx(tx, r.departmentId, items);
    const live = r.items.filter((i) => !i.removedAt);
    const before = live.map((i) => line({ ...i, quantity: i.approvedQty ?? i.quantity }));
    for (const it of linked) {
      const old = it.id ? live.find((x) => x.id === it.id) : null;
      if (old) {
        await tx.stockRequestItem.update({
          where: { id: old.id },
          data: asker ? { name: it.name, quantity: it.quantity, unit: it.unit, note: it.note, inventoryItemId: it.inventoryItemId, approvedQty: null }
            : { approvedQty: it.quantity, unit: it.unit, note: it.note, inventoryItemId: it.inventoryItemId },
        });
      } else await tx.stockRequestItem.create({ data: { requestId: id, name: it.name, quantity: it.quantity, unit: it.unit, note: it.note, inventoryItemId: it.inventoryItemId, ...(asker ? {} : { approvedQty: it.quantity }) } });
    }
    const gone = live.filter((x) => !linked.some((it) => it.id === x.id));
    if (gone.length) await tx.stockRequestItem.updateMany({ where: { id: { in: gone.map((g) => g.id) } }, data: { removedAt: now } });
    await tx.stockRequest.update({ where: { id }, data: { urgent: input.urgent ?? r.urgent, note: input.note === undefined ? r.note : clean(input.note) } });
    const after = linked.map(line);
    await eventTx(tx, id, "EDITED", actor, { reason: why, before: { items: before, urgent: r.urgent }, after: { items: after, urgent: input.urgent ?? r.urgent } }, now);
    await audit(tx, actor, { action: "stock_request.edited", entityType: "StockRequest", entityId: id, before: { items: before, urgent: r.urgent }, after: { items: after, urgent: input.urgent ?? r.urgent, reason: why, role: actor.role ?? null } });
  });
}

// ───────────────────────── 2. The manager's review ─────────────────────────

/** Approve for purchase (permission to buy — not an expense), send back to be changed, or reject. */
export async function reviewStockRequest(id: string, decision: "APPROVE" | "SEND_BACK" | "REJECT", note: string | null, actor: StockActor, now = new Date()) {
  if (!actor.userId || !canReviewStock(actor)) throw new AppError("Only a manager can review stock requests.", "FORBIDDEN");
  const why = clean(note);
  if (decision !== "APPROVE" && (why?.length ?? 0) < 3) throw new AppError(decision === "REJECT" ? msg("Say why it is rejected.") : msg("Say what to change."), "VALIDATION", { note: msg("Required") });
  const from = decision === "REJECT" ? ["SUBMITTED", "SENT_BACK", "APPROVED"] : ["SUBMITTED"];
  const to = decision === "APPROVE" ? "APPROVED" : decision === "SEND_BACK" ? "SENT_BACK" : "REJECTED";
  await db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, id, from, decision === "REJECT" ? msg("It is already being bought or closed.") : msg("This request is not waiting for review."));
    if (decision === "APPROVE") {
      for (const i of r.items.filter((x) => !x.removedAt && x.approvedQty == null)) await tx.stockRequestItem.update({ where: { id: i.id }, data: { approvedQty: i.quantity } });
    }
    await tx.stockRequest.update({ where: { id }, data: { status: to, decidedById: actor.userId, decidedAt: now, decisionNote: why ?? r.decisionNote } });
    await eventTx(tx, id, to, actor, { from: r.status, to, reason: why }, now);
    await audit(tx, actor, { action: `stock_request.${decision === "APPROVE" ? "approved_for_purchase" : decision === "SEND_BACK" ? "sent_back" : "rejected"}`, entityType: "StockRequest", entityId: id, before: { status: r.status }, after: { status: to, reason: why, role: actor.role ?? null } });
  });
}

/** The person who asked sends it again after changing it. */
export async function resubmitStockRequest(id: string, actor: StockActor, now = new Date()) {
  await db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, id, ["SENT_BACK"], msg("This request was not sent back."));
    if (r.requestedById !== actor.userId) throw new AppError("Only the person who asked can send it again.", "FORBIDDEN");
    await tx.stockRequest.update({ where: { id }, data: { status: "SUBMITTED" } });
    await eventTx(tx, id, "SUBMITTED", actor, { from: "SENT_BACK", to: "SUBMITTED" }, now);
    await audit(tx, actor, { action: "stock_request.resubmitted", entityType: "StockRequest", entityId: id, before: { status: "SENT_BACK" }, after: { status: "SUBMITTED" } });
  });
}

/** The person who asked no longer needs it (before it is approved). */
export async function cancelStockRequest(id: string, reason: string | null, actor: StockActor, now = new Date()) {
  await db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, id, ["SUBMITTED", "SENT_BACK"], msg("It is already approved or closed — ask the manager."));
    if (r.requestedById !== actor.userId) throw new AppError("Only the person who asked can cancel it.", "FORBIDDEN");
    await tx.stockRequest.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now } });
    await eventTx(tx, id, "CANCELLED", actor, { from: r.status, to: "CANCELLED", reason: clean(reason) }, now);
    await audit(tx, actor, { action: "stock_request.cancelled", entityType: "StockRequest", entityId: id, before: { status: r.status }, after: { status: "CANCELLED", reason: clean(reason) } });
  });
}

// ───────────────────────── 3. The purchase ─────────────────────────

export interface PurchaseInput {
  lines: { id: string; inventoryItemId?: string | null; purchasedQty: number; unitPrice: number; lineTotal?: number | null; expiresOn?: string | null }[];
  supplierId?: string | null;
  supplierName?: string | null;
  receiptNumber?: string | null;
  noReceiptReason?: string | null;
  /** The day it was bought (YYYY-MM-DD). */
  purchasedOn: string;
  accountId?: string | null;
  note?: string | null;
  /** Send it for the final approval (otherwise saved while buying). */
  submit: boolean;
}

/**
 * Record what was actually bought — the quantities, prices and totals from the receipt (never
 * the amounts asked for), the supplier, the receipt and the account that paid. Saved while
 * buying (Being bought), then sent for the final approval. Still no expense and no stock.
 */
export async function savePurchase(id: string, input: PurchaseInput, receipt: File | null, actor: StockActor, now = new Date()) {
  if (!actor.userId || !canBuyStock(actor)) throw new AppError("You cannot record purchases.", "FORBIDDEN");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchasedOn)) throw new AppError("When was it bought?", "VALIDATION", { purchasedOn: msg("Required") });
  const purchasedAt = new Date(`${input.purchasedOn}T12:00:00+03:00`);
  if (purchasedAt.getTime() > now.getTime() + 24 * 3600_000) throw new AppError("The purchase date cannot be in the future.", "VALIDATION", { purchasedOn: msg("Future") });
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, id, ["APPROVED", "PURCHASING"], msg("This request is not approved for purchase."));
    const live = r.items.filter((i) => !i.removedAt);
    const itemIds = input.lines.map((l) => l.inventoryItemId).filter((x): x is string => !!x);
    const stock = await tx.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, unit: true, isActive: true, tracksExpiry: true } });
    let total = 0;
    const done: string[] = [];
    for (const l of input.lines) {
      const it = live.find((x) => x.id === l.id);
      if (!it) throw new AppError("A line on this purchase is no longer on the request.", "VALIDATION");
      const qty = round3(l.purchasedQty);
      if (!(qty >= 0) || qty > 100_000) throw new AppError(msgf("How much {item} was bought? (0 if none)", { item: it.name }), "VALIDATION", { lines: msg("Quantity") });
      if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new AppError(msgf("Enter the price of {item} in whole shillings.", { item: it.name }), "VALIDATION", { lines: msg("Price") });
      const lineTotal = qty === 0 ? 0 : l.lineTotal != null ? Math.round(l.lineTotal) : Math.round(qty * l.unitPrice);
      if (!(lineTotal >= 0)) throw new AppError(msgf("Check the total for {item}.", { item: it.name }), "VALIDATION", { lines: msg("Total") });
      const s = l.inventoryItemId ? stock.find((x) => x.id === l.inventoryItemId) : null;
      if (l.inventoryItemId && !s) throw new AppError(msgf("{item}: that stock item was not found.", { item: it.name }), "VALIDATION");
      if (input.submit && qty > 0 && s) {
        if (!s.isActive) throw new AppError(msgf("{item} is switched off in the stores — choose another item, or \"not kept in stock\".", { item: s.name }), "VALIDATION");
        if (s.tracksExpiry && !l.expiresOn) throw new AppError(msgf("{item} tracks expiry — enter the expiry date on the receipt.", { item: s.name }), "VALIDATION", { lines: msg("Expiry") });
      }
      await tx.stockRequestItem.update({
        where: { id: it.id },
        data: { purchasedQty: qty, unitPrice: l.unitPrice, lineTotal, inventoryItemId: l.inventoryItemId || null, expiresOn: l.expiresOn ? new Date(`${l.expiresOn}T00:00:00Z`) : null },
      });
      total += lineTotal;
      if (qty > 0) done.push(`${s ? formatQty(qty, s.unit) : `${qty} ${it.unit}`} ${it.name} · ${money(lineTotal)}`);
    }
    const account = input.accountId ? (await resolveAccountTx(tx, { accountId: input.accountId }, "expenses")).account : null;
    const supplier = input.supplierId ? await tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true } }) : null;
    if (input.supplierId && !supplier) throw new AppError("That supplier was not found.", "VALIDATION", { supplierId: msg("Invalid") });
    const receiptFileId = receipt && receipt.size > 0 ? await storeReceipt(tx, receipt, actor.userId!, "PURCHASE_RECEIPT") : r.receiptFileId;
    const noReceipt = clean(input.noReceiptReason, 200);
    if (input.submit) {
      if (!done.length || total <= 0) throw new AppError("Enter what was bought and what it cost.", "VALIDATION", { lines: msg("Empty") });
      if (!account) throw new AppError("Which company account paid for it?", "VALIDATION", { accountId: msg("Required") });
      if (!supplier && !clean(input.supplierName)) throw new AppError("Who was it bought from?", "VALIDATION", { supplier: msg("Required") });
      if (!receiptFileId && (noReceipt?.length ?? 0) < 3) throw new AppError("Add the photo of the receipt — or say why there is none.", "VALIDATION", { receipt: msg("Required") });
    }
    const to = input.submit ? "PENDING_APPROVAL" : "PURCHASING";
    const purchaseNumber = r.purchaseNumber ?? await nextNumberTx(tx, "P", now);
    const [oldSupplier, oldAccount] = r.purchaseNumber ? await Promise.all([
      r.supplierId ? tx.supplier.findUnique({ where: { id: r.supplierId }, select: { name: true } }) : null,
      r.accountId ? tx.moneyAccount.findUnique({ where: { id: r.accountId }, select: { name: true } }) : null,
    ]) : [null, null];
    const before = r.purchaseNumber ? { total: r.purchaseTotal, supplier: oldSupplier?.name ?? r.supplierName, receipt: r.receiptNumber, account: oldAccount?.name ?? null } : null;
    await tx.stockRequest.update({
      where: { id },
      data: {
        status: to, purchaseNumber, purchasedById: actor.userId, purchasedAt, supplierId: supplier?.id ?? null, supplierName: supplier ? null : clean(input.supplierName, 120),
        receiptNumber: clean(input.receiptNumber, 60), receiptFileId, noReceiptReason: receiptFileId ? null : noReceipt, accountId: account?.id ?? null,
        purchaseNote: clean(input.note), purchaseTotal: total, ...(input.submit ? { submittedAt: now, correctionNote: null } : {}),
      },
    });
    const after = { total, lines: done, supplier: supplier?.name ?? clean(input.supplierName), receipt: clean(input.receiptNumber, 60), photo: !!receiptFileId, account: account?.name ?? null, bought: input.purchasedOn };
    await eventTx(tx, id, input.submit ? "PURCHASE_SUBMITTED" : "PURCHASE_SAVED", actor, { from: r.status, to, before, after }, now);
    await audit(tx, actor, { action: input.submit ? "stock_request.purchase_submitted" : "stock_request.purchase_saved", entityType: "StockRequest", entityId: id, before: before ?? undefined, after: { ...after, purchase: purchaseNumber, role: actor.role ?? null } });
    return { purchaseNumber, total, status: to };
  });
}

// ───────────────────────── 4. The final approval ─────────────────────────

/** Something is wrong with the purchase (too much bought, a price, no receipt): back to the buyer to correct. */
export async function sendBackPurchase(id: string, reason: string, actor: StockActor, now = new Date()) {
  if (!actor.userId || !canReviewStock(actor)) throw new AppError("Only a manager can check purchases.", "FORBIDDEN");
  const why = clean(reason);
  if ((why?.length ?? 0) < 3) throw new AppError("Say what to correct.", "VALIDATION", { reason: msg("Required") });
  await db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, id, ["PENDING_APPROVAL"], msg("This purchase is not waiting for approval."));
    await tx.stockRequest.update({ where: { id }, data: { status: "PURCHASING", correctionNote: why } });
    await eventTx(tx, id, "PURCHASE_SENT_BACK", actor, { from: r.status, to: "PURCHASING", reason: why, before: { total: r.purchaseTotal, lines: r.items.filter((i) => (i.purchasedQty ?? 0) > 0).map((i) => `${i.purchasedQty} × ${i.name} = ${money(i.lineTotal ?? 0)}`) } }, now);
    await audit(tx, actor, { action: "stock_request.purchase_sent_back", entityType: "StockRequest", entityId: id, before: { status: r.status, total: r.purchaseTotal }, after: { status: "PURCHASING", reason: why, role: actor.role ?? null } });
  });
}

/**
 * The final approval — the company accepts the purchase. In ONE step (all or nothing): each bought
 * stock line is received into stock at the price paid (linked to its line, so never twice), ONE
 * expense is made for the actual amount from the account that paid (the ledger, the account and
 * the reports read it), and the request is completed. The buyer and the approver both stay on the
 * record; when the MD requires it, the buyer cannot give the final approval themselves.
 */
export async function approvePurchase(id: string, opts: { categoryId?: string | null }, actor: StockActor, now = new Date()) {
  if (!actor.userId || !canReviewStock(actor)) throw new AppError("Only a manager can approve purchases.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, id, ["PENDING_APPROVAL"], msg("This purchase is not waiting for approval."));
    if (r.expenseId) throw new AppError("This purchase already has its expense.", "CONFLICT");
    const settings = await getSettingsTx(tx);
    const selfApproved = r.purchasedById === actor.userId;
    if (selfApproved && settings.purchaseApproverMustDiffer) throw new AppError("You bought this — another manager (or the MD) gives the final approval.", "FORBIDDEN");
    if (!r.accountId || !r.purchasedById || !r.submittedAt || !r.purchaseNumber) throw new AppError("The purchase is not complete — send it back to be finished.", "VALIDATION");
    const [dept, supplier, purchaser] = await Promise.all([
      r.departmentId ? tx.inventoryDepartment.findUnique({ where: { id: r.departmentId } }) : null,
      r.supplierId ? tx.supplier.findUnique({ where: { id: r.supplierId }, select: { name: true } }) : null,
      tx.user.findUniqueOrThrow({ where: { id: r.purchasedById }, select: { fullName: true } }),
    ]);
    const bought = r.items.filter((i) => !i.removedAt && (i.purchasedQty ?? 0) > 0);
    const amount = bought.reduce((t, i) => t + (i.lineTotal ?? 0), 0);
    if (!bought.length || amount <= 0) throw new AppError("Nothing was bought on this purchase.", "VALIDATION");
    const ref = `${r.purchaseNumber} · ${r.number}`;

    // Stock in — each line once (sorted, so two approvals never deadlock).
    const received: string[] = [];
    for (const i of bought.filter((x) => x.inventoryItemId && !x.movementId).sort((a, b) => a.inventoryItemId!.localeCompare(b.inventoryItemId!))) {
      const m = await receiveStockTx(tx, {
        itemId: i.inventoryItemId!, quantity: i.purchasedQty!, unitCost: i.unitPrice || Math.round((i.lineTotal ?? 0) / i.purchasedQty!), totalCost: i.lineTotal ?? 0,
        supplierId: r.supplierId, reference: ref, expiresOn: i.expiresOn ? i.expiresOn.toISOString().slice(0, 10) : null,
        note: `Received from purchase ${r.purchaseNumber} · bought by ${purchaser.fullName}`, purchase: true, approvedById: actor.userId,
      }, actor, now);
      await tx.stockRequestItem.update({ where: { id: i.id }, data: { movementId: m.id } });
      received.push(`${m.name} +${formatQty(i.purchasedQty!, m.unit)}: ${formatQty(m.before, m.unit)} → ${formatQty(m.after, m.unit)}`);
    }

    // The one expense — the actual amount.
    const category = opts.categoryId
      ? await tx.expenseCategory.findUnique({ where: { id: opts.categoryId } })
      : (await tx.expenseCategory.findUnique({ where: { code: EXPENSE_GROUP[r.department] ?? "OTHER" } })) ?? (await tx.expenseCategory.findUnique({ where: { code: "OTHER" } }));
    if (!category) throw new AppError("Choose what kind of expense this is.", "VALIDATION", { categoryId: msg("Required") });
    const expense = await createPurchaseExpenseTx(tx, {
      amount, categoryId: category.id, spentAt: r.purchasedAt ?? r.submittedAt, accountId: r.accountId,
      description: `Stock purchase ${r.purchaseNumber} · ${dept?.name ?? r.department} · ${bought.map((i) => i.name).join(", ")}`, payee: supplier?.name ?? r.supplierName,
      reference: r.receiptNumber ? `${r.receiptNumber} · ${ref}` : ref,
      notes: [r.purchaseNote, r.noReceiptReason ? `No receipt: ${r.noReceiptReason}` : null, `Bought by ${purchaser.fullName}${selfApproved ? " (also gave the final approval)" : ""}`].filter(Boolean).join(" · "),
      receiptFileId: r.receiptFileId, purchaserId: r.purchasedById, submittedAt: r.submittedAt, approverId: actor.userId!, now,
    }, actor);

    await tx.stockRequest.update({ where: { id }, data: { status: "COMPLETED", expenseId: expense.id, finalApprovedById: actor.userId, finalApprovedAt: now, receivedAt: now } });
    const after = { expense: expense.number, amount, category: category.name, received, notInStock: bought.filter((i) => !i.inventoryItemId).map((i) => i.name), selfApproved };
    await eventTx(tx, id, "FINAL_APPROVED", actor, { from: r.status, to: "COMPLETED", after }, now);
    await audit(tx, actor, { action: "stock_request.final_approved", entityType: "StockRequest", entityId: id, before: { status: r.status }, after: { ...after, purchase: r.purchaseNumber, buyer: purchaser.fullName, role: actor.role ?? null } });
    return { expenseNumber: expense.number, amount, received: received.length };
  });
}

// ───────────────────────── Reading ─────────────────────────

const LIST_INCLUDE = {
  items: { where: { removedAt: null }, orderBy: { id: "asc" as const }, include: { inventoryItem: { select: { id: true, name: true, unit: true, tracksExpiry: true } } } },
  requestedBy: { select: { fullName: true } }, decidedBy: { select: { fullName: true } }, purchasedBy: { select: { fullName: true } }, finalApprovedBy: { select: { fullName: true } },
  inventoryDepartment: { select: { name: true } }, supplier: { select: { id: true, name: true } }, account: { select: { id: true, name: true } },
  expense: { select: { id: true, number: true, amount: true, status: true } }, receiptFile: { select: { id: true, contentType: true } },
  events: { orderBy: { at: "asc" as const } },
} satisfies Prisma.StockRequestInclude;
export type StockRequestRow = Prisma.StockRequestGetPayload<{ include: typeof LIST_INCLUDE }>;

/** Open requests first (urgent on top, oldest first), then the latest closed ones — only one's own for someone who just asks. */
export async function stockRequests(opts: { mineOnly?: string | null } = {}) {
  const where = opts.mineOnly ? { requestedById: opts.mineOnly } : {};
  const [open, closed] = await Promise.all([
    db.stockRequest.findMany({ where: { ...where, status: { in: OPEN_STOCK } }, include: LIST_INCLUDE, orderBy: [{ urgent: "desc" }, { createdAt: "asc" }] }),
    db.stockRequest.findMany({ where: { ...where, status: { notIn: OPEN_STOCK } }, include: LIST_INCLUDE, orderBy: { updatedAt: "desc" }, take: 40 }),
  ]);
  return { open, closed };
}

/** Waiting for a manager: to review, and bought purchases to approve (the red count beside "Stock requests"). */
export const newStockRequestCount = () => db.stockRequest.count({ where: { status: { in: ["SUBMITTED", "PENDING_APPROVAL"] } } });

/**
 * Stock purchasing for managers: how many requests are at each step, what was spent (the
 * purchases' own expenses — the same money the ledger shows, never added on top) today and this
 * month, by department, and what is waiting.
 */
export async function purchasingSummary(today: string) {
  const month = `${today.slice(0, 7)}-01`;
  const [byStatus, spent, waiting] = await Promise.all([
    db.stockRequest.groupBy({ by: ["status"], _count: true, where: { status: { in: OPEN_STOCK } } }),
    db.expense.findMany({
      where: { stockRequest: { isNot: null }, status: { in: ["RECORDED", "APPROVED"] }, businessDate: { gte: new Date(`${month}T00:00:00Z`) } },
      select: { amount: true, businessDate: true, stockRequest: { select: { department: true, inventoryDepartment: { select: { name: true } } } } },
    }),
    db.stockRequest.aggregate({ where: { status: "PENDING_APPROVAL" }, _sum: { purchaseTotal: true } }),
  ]);
  const count = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;
  const dept = new Map<string, number>();
  for (const e of spent) {
    const name = e.stockRequest?.inventoryDepartment?.name ?? e.stockRequest?.department ?? msg("Other");
    dept.set(name, (dept.get(name) ?? 0) + e.amount);
  }
  return {
    toReview: count("SUBMITTED"), sentBack: count("SENT_BACK"), toBuy: count("APPROVED"), buying: count("PURCHASING"), toApprove: count("PENDING_APPROVAL"),
    toApproveAmount: waiting._sum.purchaseTotal ?? 0,
    spentToday: spent.filter((e) => e.businessDate.toISOString().slice(0, 10) === today).reduce((t, e) => t + e.amount, 0),
    spentMonth: spent.reduce((t, e) => t + e.amount, 0),
    byDepartment: [...dept.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}
export type PurchasingSummary = Awaited<ReturnType<typeof purchasingSummary>>;

/** What the purchase form offers: suppliers, the accounts that pay, stock items, expense groups. */
export async function purchaseOptions() {
  const [suppliers, accounts, items, categories] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    accountOptions("expenses"),
    db.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, departmentId: true, tracksExpiry: true, costPerUnit: true } }),
    db.expenseCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  return { suppliers, accounts: accounts.map((a) => ({ id: a.id, name: a.name })), items, categories, expenseGroup: EXPENSE_GROUP };
}
export type PurchaseOptions = Awaited<ReturnType<typeof purchaseOptions>>;

/** The departments someone can ask for. */
export const requestDepartments = () => db.inventoryDepartment.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true } });

/**
 * The bar's drinks for the stock list, from the live menu by section (Beers, Wines…). Juices and
 * smoothies made in house are left out — their fruit is in the kitchen list.
 */
export async function stockDrinks(): Promise<StockGroup[]> {
  const rows = await db.menuItem.findMany({
    where: { isActive: true, category: { type: "DRINK" }, NOT: { name: { contains: "fresh", mode: "insensitive" } } },
    select: { name: true, image: { select: { id: true, url: true, isActive: true } }, category: { select: { id: true, name: true } } },
    orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
  });
  const groups = new Map<string, StockGroup>();
  for (const r of rows) {
    const g = groups.get(r.category.id) ?? { key: `drinks-${r.category.id}`, name: r.category.name.replace(/sides & /i, ""), emoji: drinkEmoji(r.category.name, r.category.name), items: [] };
    g.items.push({ name: r.name, unit: drinkUnit(r.category.name, r.name), emoji: drinkEmoji(r.category.name, r.name), image: r.image?.isActive ? mediaUrl(r.image) : null });
    groups.set(r.category.id, g);
  }
  return [...groups.values()];
}
