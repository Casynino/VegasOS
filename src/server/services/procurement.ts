import "server-only";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { getSettingsTx } from "../settings";
import { formatQty, round3 } from "@/lib/inventory";
import { receiveStockTx } from "./inventory";
import { createPurchaseExpenseTx, storeReceipt } from "./expenses";
import { clean, eventTx, EXPENSE_GROUP, lockRequestTx, nextNumberTx, type StockActor } from "./stock-requests";
import { msg, msgf } from "@/i18n/msg";

/**
 * PROCUREMENT — what happens after Finance approves a purchase request, when it is ordered from a supplier.
 *
 *   Accountant   records supplier quotations → proposes one → (Finance authorizes it when it is above the approved budget)
 *                → issues the purchase order → records what was delivered → records the supplier's invoice.
 *   Finance      authorizes a quotation above the budget → verifies the invoice against the order and the delivery
 *                → pays the supplier. The payment is the expense.
 *
 * Money is never counted twice: a request is not an expense, an approval is not a payment, an order is not a delivery and
 * an invoice is not a payment. The ONLY expense of an ordered purchase is each payment to the supplier. Stock goes in only
 * when a delivery line is recorded (once per line), never because a request was approved or an order issued.
 * The Accountant has no right to approve, authorize or pay: those are separate rights, held by Finance.
 */

const can = (a: StockActor, code: string) => !!a.permissions?.has(code);
const isBoss = (a: StockActor) => can(a, "dashboard.admin") || can(a, "dashboard.owner");
function need(a: StockActor, codes: string[], text: string) {
  if (!a.userId || !codes.some((c) => can(a, c))) throw new AppError(text, "FORBIDDEN");
}
const money = (n: number) => `TZS ${n.toLocaleString("en-US")}`;
const EPS = 0.0005;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const eatToday = (now: Date) => new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

type ItemRow = { id: string; name: string; unit: string; quantity: number; approvedQty: number | null; removedAt: Date | null; inventoryItemId: string | null; orderedQty: number | null; orderedUnitPrice: number | null; receivedQty: number };
const toBuy = (i: Pick<ItemRow, "approvedQty" | "quantity">) => i.approvedQty ?? i.quantity;
const live = (items: ItemRow[]) => items.filter((i) => !i.removedAt);

/** Keep a document (a quotation, a delivery note, a supplier invoice) with the request. */
async function attach(tx: Tx, requestId: string, kind: "QUOTATION" | "DELIVERY_NOTE" | "INVOICE" | "OTHER", file: File | null, actor: StockActor, refId: string | null, note?: string | null) {
  if (!file || file.size <= 0) return null;
  const fileId = await storeReceipt(tx, file, actor.userId!, "STOCK_DOCUMENT");
  return tx.stockDocument.create({ data: { requestId, kind, refId, fileId, note: clean(note, 120), uploadedById: actor.userId! } });
}

// ───────────────────────── Quotations ─────────────────────────

export interface QuoteInput {
  supplierId?: string | null;
  /** A supplier that is not in the list yet: it is added to the list. */
  newSupplier?: { name: string; contactName?: string | null; phone?: string | null; email?: string | null } | null;
  contact?: string | null;
  /** The last day the price holds (YYYY-MM-DD). */
  validUntil?: string | null;
  deliveryDays?: number | null;
  note?: string | null;
  lines: { itemId: string; quantity: number; unitPrice: number }[];
}

/** Record one supplier's quotation: who, line by line what they would charge, how long it holds, and their document. Nothing is bought. */
export async function saveQuote(requestId: string, input: QuoteInput, file: File | null, actor: StockActor, now = new Date()) {
  need(actor, ["procurement.manage"], "Only Finance or the Accountant records quotations.");
  if (input.validUntil && (!DATE.test(input.validUntil) || input.validUntil < eatToday(now))) throw new AppError("The quotation must still be valid — check the date.", "VALIDATION", { validUntil: msg("Invalid") });
  if (input.deliveryDays != null && (!Number.isInteger(input.deliveryDays) || input.deliveryDays < 0 || input.deliveryDays > 365)) throw new AppError("Delivery days must be a whole number.", "VALIDATION", { deliveryDays: msg("Invalid") });
  if (!input.lines.length) throw new AppError("Price at least one item.", "VALIDATION", { lines: msg("Empty") });
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, requestId, ["APPROVED"], msg("Quotations are recorded for requests Finance approved, before an order."));
    if (r.chosenQuoteId) throw new AppError("A quotation is already proposed for this request. Wait for Finance, or ask for it to be returned.", "CONFLICT");
    const items = live(r.items as ItemRow[]);
    const seen = new Set<string>();
    let total = 0;
    const lines = input.lines.map((l) => {
      const it = items.find((x) => x.id === l.itemId);
      if (!it) throw new AppError("A line of this quotation is not on the request.", "VALIDATION", { lines: msg("Item") });
      if (seen.has(it.id)) throw new AppError(msgf("{item} is priced twice.", { item: it.name }), "VALIDATION", { lines: msg("Duplicate") });
      seen.add(it.id);
      const quantity = round3(l.quantity);
      if (!(quantity > 0)) throw new AppError(msgf("How many {item}?", { item: it.name }), "VALIDATION", { lines: msg("Quantity") });
      if (quantity > toBuy(it) + EPS) throw new AppError(msgf("{item}: you may not buy more than Finance approved ({qty}).", { item: it.name, qty: `${round3(toBuy(it))} ${it.unit}` }), "VALIDATION", { lines: msg("Quantity") });
      if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new AppError(msgf("Enter the price of {item} in whole shillings.", { item: it.name }), "VALIDATION", { lines: msg("Price") });
      const lineTotal = Math.round(quantity * l.unitPrice);
      total += lineTotal;
      return { itemId: it.id, quantity, unitPrice: l.unitPrice, lineTotal };
    });
    if (total <= 0) throw new AppError("The quotation has no price.", "VALIDATION", { lines: msg("Total") });

    // Who quoted: one from the list, or a new one for the list.
    let supplierId = input.supplierId || null;
    if (!supplierId && input.newSupplier?.name.trim()) {
      const name = input.newSupplier.name.trim().slice(0, 80);
      if (name.length < 2) throw new AppError("Give the supplier a name.", "VALIDATION", { supplier: msg("Required") });
      const same = await tx.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
      const s = same ?? await tx.supplier.create({ data: { name, contactName: clean(input.newSupplier.contactName, 80), phone: clean(input.newSupplier.phone, 40), email: clean(input.newSupplier.email, 80) } });
      if (!same) await audit(tx, actor, { action: "supplier.created", entityType: "Supplier", entityId: s.id, after: { name: s.name, by: "procurement" } });
      supplierId = s.id;
    }
    if (supplierId) {
      const s = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true, isActive: true } });
      if (!s || !s.isActive) throw new AppError("That supplier is not in use.", "VALIDATION", { supplier: msg("Invalid") });
    } else throw new AppError("Who gave the quotation?", "VALIDATION", { supplier: msg("Required") });

    // The same quotation sent twice in a minute (a double tap): the one already recorded.
    const since = new Date(now.getTime() - 60_000);
    const twin = await tx.stockQuote.findFirst({ where: { requestId, supplierId, total, recordedById: actor.userId!, createdAt: { gte: since } } });
    if (twin) return twin;

    const quote = await tx.stockQuote.create({
      data: {
        requestId, supplierId, contact: clean(input.contact, 120), total, validUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00Z`) : null,
        deliveryDays: input.deliveryDays ?? null, note: clean(input.note, 300), recordedById: actor.userId!, createdAt: now,
        lines: { create: lines },
      },
      include: { supplier: { select: { name: true } } },
    });
    await attach(tx, requestId, "QUOTATION", file, actor, quote.id, quote.supplier?.name ?? null);
    await eventTx(tx, requestId, "QUOTE_RECORDED", actor, { reason: clean(input.note, 300), after: { supplier: quote.supplier?.name, total, lines: lines.length, validUntil: input.validUntil ?? null } }, now);
    await audit(tx, actor, { action: "stock_request.quote_recorded", entityType: "StockRequest", entityId: requestId, after: { supplier: quote.supplier?.name, total, lines: lines.length, quote: quote.id } });
    return quote;
  });
}

/**
 * The Accountant proposes ONE quotation to buy from. Within the approved budget it is authorized at once (nobody
 * has to be asked again); above it — or when no budget was approved — it goes to Finance to be authorized.
 */
export async function proposeQuote(requestId: string, quoteId: string, actor: StockActor, now = new Date()) {
  need(actor, ["procurement.manage"], "Only Finance or the Accountant proposes a quotation.");
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, requestId, ["APPROVED"], msg("This request is not waiting for a quotation."));
    if (r.chosenQuoteId) throw new AppError("A quotation is already proposed.", "CONFLICT");
    const q = await tx.stockQuote.findUnique({ where: { id: quoteId }, include: { supplier: { select: { name: true } } } });
    if (!q || q.requestId !== requestId) throw new AppError("Quotation not found.", "NOT_FOUND");
    if (q.validUntil && q.validUntil.toISOString().slice(0, 10) < eatToday(now)) throw new AppError("That quotation has expired — ask the supplier for a new one.", "VALIDATION");
    const budget = r.approvedBudget ?? r.estimatedTotal;
    const needsFinance = budget == null || q.total > budget;
    const to = needsFinance ? "AWAITING_AUTHORIZATION" : "APPROVED";
    await tx.stockRequest.update({
      where: { id: requestId },
      data: needsFinance ? { status: to, chosenQuoteId: q.id, authorizedAt: null, authorizedById: null, authorizationNote: null }
        : { status: to, chosenQuoteId: q.id, authorizedAt: now, authorizedById: null, authorizationNote: `Within the approved budget of ${money(budget!)}.` },
    });
    const after = { supplier: q.supplier?.name, total: q.total, budget, authorization: needsFinance ? "needed" : "automatic" };
    await eventTx(tx, requestId, "QUOTE_PROPOSED", actor, { from: r.status, to, after }, now);
    await audit(tx, actor, { action: "stock_request.quote_proposed", entityType: "StockRequest", entityId: requestId, before: { status: r.status }, after: { status: to, ...after, quote: q.id } });
    return { status: to, needsFinance };
  });
}

/** Finance's answer to a proposed quotation that is above the budget: authorize it, or return it to the Accountant (with the reason). */
export async function authorizeQuote(requestId: string, decision: "AUTHORIZE" | "RETURN", note: string | null, actor: StockActor, now = new Date()) {
  need(actor, ["purchases.authorize"], "Only Finance can authorize a purchase price.");
  const why = clean(note, 300);
  if (decision === "RETURN" && (why?.length ?? 0) < 3) throw new AppError("Say what the Accountant should do — e.g. ask for a better price.", "VALIDATION", { note: msg("Required") });
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, requestId, ["AWAITING_AUTHORIZATION"], msg("This quotation is not waiting for authorization."));
    const q = r.chosenQuoteId ? await tx.stockQuote.findUnique({ where: { id: r.chosenQuoteId }, include: { supplier: { select: { name: true } } } }) : null;
    if (!q) throw new AppError("There is no proposed quotation.", "CONFLICT");
    const settings = await getSettingsTx(tx);
    if (decision === "AUTHORIZE") {
      if (settings.financeAuthorizationLimit != null && q.total > settings.financeAuthorizationLimit && !isBoss(actor)) {
        throw new AppError(msgf("{amount} is above what Finance may authorize alone ({limit}) — the Boss or the MD authorizes it.", { amount: money(q.total), limit: money(settings.financeAuthorizationLimit) }), "FORBIDDEN");
      }
      if (settings.purchaseApproverMustDiffer && q.recordedById === actor.userId) throw new AppError("You recorded this quotation — another person authorizes it.", "FORBIDDEN");
      await tx.stockRequest.update({ where: { id: requestId }, data: { status: "APPROVED", authorizedAt: now, authorizedById: actor.userId, authorizationNote: why } });
      await eventTx(tx, requestId, "QUOTE_AUTHORIZED", actor, { from: r.status, to: "APPROVED", reason: why, after: { supplier: q.supplier?.name, total: q.total, budget: r.approvedBudget } }, now);
      await audit(tx, actor, { action: "stock_request.quote_authorized", entityType: "StockRequest", entityId: requestId, before: { status: r.status }, after: { status: "APPROVED", total: q.total, budget: r.approvedBudget, reason: why, quote: q.id } });
    } else {
      await tx.stockRequest.update({ where: { id: requestId }, data: { status: "APPROVED", chosenQuoteId: null, authorizedAt: null, authorizedById: null, authorizationNote: why } });
      await eventTx(tx, requestId, "QUOTE_RETURNED", actor, { from: r.status, to: "APPROVED", reason: why, after: { supplier: q.supplier?.name, total: q.total } }, now);
      await audit(tx, actor, { action: "stock_request.quote_returned", entityType: "StockRequest", entityId: requestId, before: { status: r.status, total: q.total }, after: { status: "APPROVED", reason: why } });
    }
    return { status: "APPROVED" };
  });
}

// ───────────────────────── The purchase order ─────────────────────────

/** Issue the purchase order for the authorized quotation. Nothing has arrived and nothing is paid; the amount is committed. */
export async function issueOrder(requestId: string, input: { expectedDeliveryOn: string; note?: string | null }, actor: StockActor, now = new Date()) {
  need(actor, ["procurement.manage"], "Only Finance or the Accountant issues purchase orders.");
  if (!DATE.test(input.expectedDeliveryOn ?? "")) throw new AppError("When will it be delivered?", "VALIDATION", { expectedDeliveryOn: msg("Required") });
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, requestId, ["APPROVED"], msg("This request is not ready to be ordered."));
    if (!r.chosenQuoteId || !r.authorizedAt) throw new AppError("The price is not authorized yet — a purchase order cannot be issued.", "CONFLICT");
    const q = await tx.stockQuote.findUniqueOrThrow({ where: { id: r.chosenQuoteId }, include: { lines: true, supplier: { select: { id: true, name: true } } } });
    const today = eatToday(now);
    if (input.expectedDeliveryOn < today) throw new AppError("The delivery date cannot be in the past.", "VALIDATION", { expectedDeliveryOn: msg("Past") });
    if (q.validUntil && q.validUntil.toISOString().slice(0, 10) < today) throw new AppError("The quotation has expired — ask the supplier to confirm the price, then record a new quotation.", "VALIDATION");
    const orderNumber = await nextNumberTx(tx, "PO", now);
    for (const l of q.lines) await tx.stockRequestItem.update({ where: { id: l.itemId }, data: { orderedQty: l.quantity, orderedUnitPrice: l.unitPrice, receivedQty: 0 } });
    const notOrdered = live(r.items as ItemRow[]).filter((i) => !q.lines.some((l) => l.itemId === i.id)).map((i) => i.name);
    await tx.stockRequest.update({
      where: { id: requestId },
      data: {
        status: "ORDERED", orderNumber, orderedAt: now, orderedById: actor.userId, orderTotal: q.total, expectedDeliveryOn: new Date(`${input.expectedDeliveryOn}T00:00:00Z`),
        orderNote: clean(input.note, 300), supplierId: q.supplierId, supplierName: q.supplierName,
      },
    });
    const after = { order: orderNumber, supplier: q.supplier?.name ?? q.supplierName, total: q.total, expected: input.expectedDeliveryOn, notOrdered };
    await eventTx(tx, requestId, "ORDER_ISSUED", actor, { from: r.status, to: "ORDERED", reason: clean(input.note, 300), after }, now);
    await audit(tx, actor, { action: "stock_request.order_issued", entityType: "StockRequest", entityId: requestId, before: { status: r.status }, after: { status: "ORDERED", ...after, authorizedBy: r.authorizedById } });
    return { orderNumber, total: q.total };
  });
}

// ───────────────────────── Deliveries ─────────────────────────

export interface DeliveryInput {
  lines: { itemId: string; quantity: number; rejectedQty?: number | null; problem?: "DAMAGED" | "WRONG" | "OTHER" | null; note?: string | null; expiresOn?: string | null }[];
  note?: string | null;
}

/**
 * Record what really arrived. What is accepted goes into stock — once for each delivery line, at the price ordered; what
 * arrived damaged or wrong is recorded, does NOT go into stock and is still owed. Several deliveries are fine (a partial one).
 */
export async function recordDelivery(requestId: string, input: DeliveryInput, file: File | null, actor: StockActor, now = new Date()) {
  need(actor, ["procurement.manage", "inventory.receive"], "You cannot record deliveries.");
  if (!input.lines.length) throw new AppError("Say what arrived.", "VALIDATION", { lines: msg("Empty") });
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, requestId, ["ORDERED", "PART_DELIVERED"], msg("This order is not waiting for a delivery."));
    const items = live(r.items as ItemRow[]);
    const seen = new Set<string>();
    const prepared = input.lines.map((l) => {
      const it = items.find((x) => x.id === l.itemId && x.orderedQty != null);
      if (!it) throw new AppError("A delivered line is not on this order.", "VALIDATION", { lines: msg("Item") });
      if (seen.has(it.id)) throw new AppError(msgf("{item} appears twice.", { item: it.name }), "VALIDATION", { lines: msg("Duplicate") });
      seen.add(it.id);
      const quantity = round3(l.quantity ?? 0), rejected = round3(l.rejectedQty ?? 0);
      if (!(quantity >= 0) || !(rejected >= 0) || quantity + rejected <= 0) throw new AppError(msgf("How many {item} arrived?", { item: it.name }), "VALIDATION", { lines: msg("Quantity") });
      const outstanding = round3(it.orderedQty! - it.receivedQty);
      if (quantity > outstanding + EPS) throw new AppError(msgf("{item}: only {qty} is still to come — report anything more as a problem, do not add it to stock.", { item: it.name, qty: `${outstanding} ${it.unit}` }), "VALIDATION", { lines: msg("Too many") });
      if (rejected > 0 && !l.problem) throw new AppError(msgf("{item}: what is wrong with the items you did not accept?", { item: it.name }), "VALIDATION", { lines: msg("Problem") });
      if (l.expiresOn && !DATE.test(l.expiresOn)) throw new AppError("Check the expiry date.", "VALIDATION", { lines: msg("Expiry") });
      return { it, quantity, rejected, problem: rejected > 0 ? l.problem! : null, note: clean(l.note, 200), expiresOn: l.expiresOn || null };
    });

    // The same delivery sent twice in a minute (a double tap): the one already recorded, never a second stock-in.
    const sig = prepared.map((p) => `${p.it.id}:${p.quantity}:${p.rejected}`).sort().join("|");
    const recent = await tx.stockDelivery.findMany({ where: { requestId, receivedById: actor.userId!, receivedAt: { gte: new Date(now.getTime() - 60_000) } }, include: { lines: true } });
    const twin = recent.find((d) => d.lines.map((l) => `${l.itemId}:${l.quantity}:${l.rejectedQty}`).sort().join("|") === sig);
    if (twin) return { id: twin.id, status: r.status, problems: 0, repeated: true };

    const delivery = await tx.stockDelivery.create({ data: { requestId, receivedById: actor.userId!, receivedAt: now, note: clean(input.note, 300) } });
    const stockIn: string[] = [];
    // Sorted by stock item, so two deliveries at once never wait on each other.
    for (const p of [...prepared].sort((a, b) => (a.it.inventoryItemId ?? "").localeCompare(b.it.inventoryItemId ?? ""))) {
      let movementId: string | null = null;
      if (p.quantity > 0 && p.it.inventoryItemId) {
        const m = await receiveStockTx(tx, {
          itemId: p.it.inventoryItemId, quantity: p.quantity, unitCost: p.it.orderedUnitPrice ?? undefined, totalCost: Math.round(p.quantity * (p.it.orderedUnitPrice ?? 0)),
          supplierId: r.supplierId, reference: `${r.orderNumber} · ${r.number}`, expiresOn: p.expiresOn,
          note: `Delivered against order ${r.orderNumber}`, purchase: true, approvedById: r.authorizedById ?? r.decidedById,
        }, actor, now);
        movementId = m.id;
        stockIn.push(`${m.name} +${formatQty(p.quantity, m.unit)}`);
      }
      await tx.stockDeliveryLine.create({
        data: { deliveryId: delivery.id, itemId: p.it.id, quantity: p.quantity, rejectedQty: p.rejected, problem: p.problem, note: p.note, expiresOn: p.expiresOn ? new Date(`${p.expiresOn}T00:00:00Z`) : null, movementId },
      });
      await tx.stockRequestItem.update({ where: { id: p.it.id }, data: { receivedQty: round3(p.it.receivedQty + p.quantity) } });
    }
    await attach(tx, requestId, "DELIVERY_NOTE", file, actor, delivery.id, null);
    const after = await tx.stockRequestItem.findMany({ where: { requestId, removedAt: null, orderedQty: { not: null } } });
    const complete = after.every((i) => i.receivedQty >= (i.orderedQty ?? 0) - EPS);
    const to = complete ? "DELIVERED" : "PART_DELIVERED";
    await tx.stockRequest.update({ where: { id: requestId }, data: { status: to, receivedAt: complete ? now : r.receivedAt } });
    const problems = prepared.filter((p) => p.rejected > 0).map((p) => `${p.rejected} ${p.it.unit} ${p.it.name} — ${p.problem?.toLowerCase()}${p.note ? `: ${p.note}` : ""}`);
    const summary = prepared.map((p) => `${p.quantity} ${p.it.unit} ${p.it.name}`);
    await eventTx(tx, requestId, "DELIVERY_RECORDED", actor, { from: r.status, to, reason: clean(input.note, 300), after: { delivered: summary, stockIn, complete } }, now);
    if (problems.length) await eventTx(tx, requestId, "DELIVERY_PROBLEM", actor, { reason: problems.join(" · "), after: { problems } }, now);
    await audit(tx, actor, { action: "stock_request.delivery_recorded", entityType: "StockRequest", entityId: requestId, before: { status: r.status }, after: { status: to, delivered: summary, stockIn, problems, order: r.orderNumber } });
    return { id: delivery.id, status: to, problems: problems.length, repeated: false };
  });
}

/** The rest will not come: close the order as delivered, with the reason (the supplier is owed the difference — the invoice covers what arrived). */
export async function closeDeliveryShort(requestId: string, reason: string, actor: StockActor, now = new Date()) {
  need(actor, ["procurement.manage"], "Only Finance or the Accountant closes an order.");
  const why = clean(reason, 300);
  if ((why?.length ?? 0) < 5) throw new AppError("Say why the rest is not coming.", "VALIDATION", { reason: msg("Required") });
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, requestId, ["PART_DELIVERED"], msg("Only a partly delivered order can be closed."));
    const missing = live(r.items as ItemRow[]).filter((i) => i.orderedQty != null && i.receivedQty < i.orderedQty - EPS).map((i) => `${round3(i.orderedQty! - i.receivedQty)} ${i.unit} ${i.name}`);
    await tx.stockRequest.update({ where: { id: requestId }, data: { status: "DELIVERED", receivedAt: now } });
    await eventTx(tx, requestId, "DELIVERY_CLOSED_SHORT", actor, { from: r.status, to: "DELIVERED", reason: why, after: { missing } }, now);
    await audit(tx, actor, { action: "stock_request.delivery_closed_short", entityType: "StockRequest", entityId: requestId, before: { status: r.status }, after: { status: "DELIVERED", missing, reason: why } });
  });
}

/** The department that asked says the delivery is not right (or confirms it is). Only history: it tells Finance and the Accountant. */
export async function reportDelivery(requestId: string, input: { correct: boolean; note?: string | null }, actor: StockActor, now = new Date()) {
  const note = clean(input.note, 300);
  if (!input.correct && (note?.length ?? 0) < 3) throw new AppError("Say what is wrong — missing, damaged or not what was asked.", "VALIDATION", { note: msg("Required") });
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, requestId, ["ORDERED", "PART_DELIVERED", "DELIVERED", "COMPLETED"], msg("Nothing has been ordered for this request."));
    if (r.requestedById !== actor.userId && !can(actor, "procurement.manage") && !can(actor, "expenses.approve")) throw new AppError("Only the person who asked can report on the delivery.", "FORBIDDEN");
    await eventTx(tx, requestId, input.correct ? "DELIVERY_CONFIRMED" : "DELIVERY_REPORTED", actor, { reason: note }, now);
    await audit(tx, actor, { action: input.correct ? "stock_request.delivery_confirmed" : "stock_request.delivery_reported", entityType: "StockRequest", entityId: requestId, after: { note, order: r.orderNumber } });
  });
}

// ───────────────────────── Invoices and payment ─────────────────────────

/** The value of what has arrived, at the ordered prices. */
const deliveredValue = (items: ItemRow[]) => live(items).reduce((s, i) => s + Math.round(i.receivedQty * (i.orderedUnitPrice ?? 0)), 0);

/** The Accountant records the supplier's invoice (with its document). It is not a payment and not an expense. */
export async function recordInvoice(requestId: string, input: { number: string; amount: number; invoiceDate: string; dueOn?: string | null; note?: string | null }, file: File | null, actor: StockActor, now = new Date()) {
  need(actor, ["procurement.manage"], "Only Finance or the Accountant records supplier invoices.");
  const number = input.number.trim().slice(0, 60);
  if (!number) throw new AppError("What is the invoice number?", "VALIDATION", { number: msg("Required") });
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > 2_000_000_000) throw new AppError("Enter the invoice amount in whole shillings.", "VALIDATION", { amount: msg("Invalid") });
  if (!DATE.test(input.invoiceDate) || input.invoiceDate > eatToday(now)) throw new AppError("Check the invoice date.", "VALIDATION", { invoiceDate: msg("Invalid") });
  if (input.dueOn && !DATE.test(input.dueOn)) throw new AppError("Check the due date.", "VALIDATION", { dueOn: msg("Invalid") });
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, requestId, ["ORDERED", "PART_DELIVERED", "DELIVERED"], msg("There is no order to invoice."));
    const same = await tx.supplierInvoice.findUnique({ where: { requestId_number: { requestId, number } } });
    if (same) throw new AppError("This invoice is already recorded for this order.", "CONFLICT");
    const inv = await tx.supplierInvoice.create({
      data: {
        requestId, number, supplierId: r.supplierId, supplierName: r.supplierName, amount: input.amount, invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
        dueOn: input.dueOn ? new Date(`${input.dueOn}T00:00:00Z`) : null, note: clean(input.note, 300), recordedById: actor.userId!, recordedAt: now,
      },
    });
    await attach(tx, requestId, "INVOICE", file, actor, inv.id, number);
    const over = r.orderTotal != null && input.amount > r.orderTotal ? input.amount - r.orderTotal : 0;
    await eventTx(tx, requestId, "INVOICE_RECORDED", actor, { reason: clean(input.note, 300), after: { invoice: number, amount: input.amount, order: r.orderTotal, aboveOrder: over || null, document: !!file } }, now);
    await audit(tx, actor, { action: "stock_request.invoice_recorded", entityType: "SupplierInvoice", entityId: inv.id, after: { request: r.number, order: r.orderNumber, invoice: number, amount: input.amount, aboveOrder: over || null } });
    return inv;
  });
}

/** Finance checks the invoice against the order and what arrived: verified (may be paid) or disputed. */
export async function verifyInvoice(invoiceId: string, decision: "VERIFY" | "DISPUTE", note: string | null, actor: StockActor, now = new Date()) {
  need(actor, ["purchases.pay"], "Only Finance verifies supplier invoices.");
  const why = clean(note, 300);
  if (decision === "DISPUTE" && (why?.length ?? 0) < 3) throw new AppError("Say what is wrong with the invoice.", "VALIDATION", { note: msg("Required") });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "supplier_invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const inv = await tx.supplierInvoice.findUnique({ where: { id: invoiceId }, include: { request: { include: { items: true } } } });
    if (!inv) throw new AppError("Invoice not found.", "NOT_FOUND");
    if (!["RECEIVED", "DISPUTED"].includes(inv.status)) throw new AppError("This invoice is not waiting to be checked.", "CONFLICT");
    const delivered = deliveredValue(inv.request.items as ItemRow[]);
    if (decision === "VERIFY" && inv.amount > delivered && (why?.length ?? 0) < 5) {
      throw new AppError(msgf("The invoice ({invoice}) is more than what was delivered ({delivered}). Say why you accept it, or dispute it.", { invoice: money(inv.amount), delivered: money(delivered) }), "VALIDATION", { note: msg("Required") });
    }
    const status = decision === "VERIFY" ? "VERIFIED" : "DISPUTED";
    await tx.supplierInvoice.update({ where: { id: invoiceId }, data: { status, verifiedById: actor.userId, verifiedAt: now, verifyNote: why } });
    await eventTx(tx, inv.requestId, decision === "VERIFY" ? "INVOICE_VERIFIED" : "INVOICE_DISPUTED", actor, { reason: why, after: { invoice: inv.number, amount: inv.amount, delivered, order: inv.request.orderTotal } }, now);
    await audit(tx, actor, { action: decision === "VERIFY" ? "supplier_invoice.verified" : "supplier_invoice.disputed", entityType: "SupplierInvoice", entityId: invoiceId, before: { status: inv.status }, after: { status, amount: inv.amount, delivered, reason: why } });
    return { status };
  });
}

/** Take a wrongly recorded invoice out (never after money was paid against it). It stays on the record, cancelled, with the reason. */
export async function cancelInvoice(invoiceId: string, reason: string, actor: StockActor, now = new Date()) {
  need(actor, ["procurement.manage", "purchases.pay"], "You cannot cancel invoices.");
  const why = clean(reason, 300);
  if ((why?.length ?? 0) < 5) throw new AppError("Say why the invoice is cancelled.", "VALIDATION", { reason: msg("Required") });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "supplier_invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const inv = await tx.supplierInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new AppError("Invoice not found.", "NOT_FOUND");
    if (inv.paidAmount > 0 || inv.status === "PAID" || inv.status === "PART_PAID") throw new AppError("Money was already paid against this invoice — it cannot be cancelled.", "CONFLICT");
    if (inv.status === "CANCELLED") throw new AppError("This invoice is already cancelled.", "CONFLICT");
    if (inv.status === "VERIFIED" && !can(actor, "purchases.pay")) throw new AppError("Finance already verified this invoice — Finance cancels it.", "FORBIDDEN");
    await tx.supplierInvoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED", verifyNote: why } });
    await eventTx(tx, inv.requestId, "INVOICE_CANCELLED", actor, { reason: why, after: { invoice: inv.number, amount: inv.amount } }, now);
    await audit(tx, actor, { action: "supplier_invoice.cancelled", entityType: "SupplierInvoice", entityId: invoiceId, before: { status: inv.status, amount: inv.amount }, after: { status: "CANCELLED", reason: why } });
  });
}

export interface SupplierPaymentInput {
  amount: number;
  accountId: string;
  /** The day it was really paid (YYYY-MM-DD). */
  paidOn: string;
  reference?: string | null;
  note?: string | null;
  /** Created when the form opens: a double tap pays once. */
  clientKey?: string | null;
  categoryId?: string | null;
}

/**
 * Finance pays the supplier — recorded only when the money has really been paid, from a company account. Each payment is
 * the expense of this purchase (once); the ledger, the account and the reports read it. A verified invoice only.
 */
export async function paySupplier(invoiceId: string, input: SupplierPaymentInput, actor: StockActor, now = new Date()) {
  need(actor, ["purchases.pay"], "Only Finance pays suppliers.");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter the amount paid in whole shillings.", "VALIDATION", { amount: msg("Invalid") });
  if (!DATE.test(input.paidOn) || input.paidOn > eatToday(now)) throw new AppError("The payment date cannot be in the future.", "VALIDATION", { paidOn: msg("Invalid") });
  if (!input.accountId) throw new AppError("Which company account paid?", "VALIDATION", { accountId: msg("Required") });
  const clientKey = clean(input.clientKey, 64);
  if (clientKey) {
    const same = await db.supplierPayment.findUnique({ where: { clientKey } });
    if (same) return { paymentId: same.id, repeated: true as const };
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "supplier_invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
      const inv = await tx.supplierInvoice.findUnique({ where: { id: invoiceId }, include: { request: true, supplier: { select: { name: true } } } });
      if (!inv) throw new AppError("Invoice not found.", "NOT_FOUND");
      if (!["VERIFIED", "PART_PAID"].includes(inv.status)) throw new AppError(inv.status === "PAID" ? "This invoice is already paid." : "Only a verified invoice can be paid.", "CONFLICT");
      const balance = inv.amount - inv.paidAmount;
      if (input.amount > balance) throw new AppError(msgf("{amount} is more than what is still owed on this invoice ({balance}).", { amount: money(input.amount), balance: money(balance) }), "VALIDATION", { amount: msg("Too much") });
      const r = inv.request;
      // The invoice file can sit on only one expense (a file belongs to one receipt): the first payment carries it, the later ones point to the invoice number.
      const doc = inv.paidAmount > 0 ? null : await tx.stockDocument.findFirst({ where: { requestId: r.id, kind: "INVOICE", refId: inv.id }, select: { fileId: true } });
      const categoryId = input.categoryId
        ?? (await tx.expenseCategory.findUnique({ where: { code: EXPENSE_GROUP[r.department] ?? "OTHER" } }))?.id
        ?? (await tx.expenseCategory.findUniqueOrThrow({ where: { code: "OTHER" } })).id;
      const spentAt = new Date(`${input.paidOn}T12:00:00+03:00`);
      const supplier = inv.supplier?.name ?? inv.supplierName;
      const expense = await createPurchaseExpenseTx(tx, {
        amount: input.amount, categoryId, spentAt, accountId: input.accountId, description: `Supplier payment · ${inv.number} · ${r.orderNumber} · ${r.number}`, payee: supplier,
        reference: clean(input.reference, 80) ?? inv.number, notes: clean(input.note, 300), receiptFileId: doc?.fileId ?? null,
        purchaserId: r.orderedById ?? inv.recordedById, submittedAt: inv.recordedAt, approverId: actor.userId!, now, trail: { submitted: "Supplier invoice", approved: "Payment to the supplier" },
      }, actor);
      const pay = await tx.supplierPayment.create({
        data: { invoiceId, amount: input.amount, accountId: input.accountId, paidOn: new Date(`${input.paidOn}T00:00:00Z`), reference: clean(input.reference, 80), note: clean(input.note, 300), paidById: actor.userId!, expenseId: expense.id, clientKey },
      });
      const paid = inv.paidAmount + input.amount;
      const status = paid >= inv.amount ? "PAID" : "PART_PAID";
      await tx.supplierInvoice.update({ where: { id: invoiceId }, data: { paidAmount: paid, status } });
      await eventTx(tx, r.id, "SUPPLIER_PAID", actor, { after: { invoice: inv.number, amount: input.amount, balance: inv.amount - paid, expense: expense.number, supplier } }, now);
      await audit(tx, actor, { action: "supplier_invoice.paid", entityType: "SupplierInvoice", entityId: invoiceId, before: { paidAmount: inv.paidAmount, status: inv.status }, after: { paidAmount: paid, status, payment: input.amount, expense: expense.number, account: input.accountId, order: r.orderNumber } });
      await completeIfDone(tx, r.id, actor, now);
      return { paymentId: pay.id, repeated: false as const };
    });
  } catch (e) {
    if (clientKey && isUniqueViolation(e)) {
      const same = await db.supplierPayment.findUnique({ where: { clientKey } });
      if (same) return { paymentId: same.id, repeated: true as const };
    }
    throw e;
  }
}

/** Completed only when everything is on the record: delivered (or closed), invoiced, and every invoice paid. */
async function completeIfDone(tx: Tx, requestId: string, actor: StockActor, now: Date) {
  const r = await tx.stockRequest.findUniqueOrThrow({ where: { id: requestId }, include: { invoices: { where: { status: { not: "CANCELLED" } } } } });
  if (r.status !== "DELIVERED" || !r.invoices.length || r.invoices.some((i) => i.status !== "PAID")) return false;
  await tx.stockRequest.update({ where: { id: requestId }, data: { status: "COMPLETED" } });
  await eventTx(tx, requestId, "COMPLETED", actor, { from: "DELIVERED", to: "COMPLETED", after: { paid: r.invoices.reduce((s, i) => s + i.paidAmount, 0) } }, now);
  await audit(tx, actor, { action: "stock_request.completed", entityType: "StockRequest", entityId: requestId, before: { status: "DELIVERED" }, after: { status: "COMPLETED" } });
  return true;
}

/** After a delivery is closed or completed late: an order that was fully invoiced and paid before the last delivery completes now. */
export async function completeWhenReady(requestId: string, actor: StockActor, now = new Date()) {
  return db.$transaction((tx) => completeIfDone(tx, requestId, actor, now));
}

/** Cancel an order that was never delivered (the supplier cannot supply): the request is closed with the reason; nothing was paid. */
export async function cancelOrder(requestId: string, reason: string, actor: StockActor, now = new Date()) {
  need(actor, ["procurement.manage", "purchases.authorize"], "You cannot cancel an order.");
  const why = clean(reason, 300);
  if ((why?.length ?? 0) < 5) throw new AppError("Say why the order is cancelled.", "VALIDATION", { reason: msg("Required") });
  return db.$transaction(async (tx) => {
    const r = await lockRequestTx(tx, requestId, ["ORDERED"], msg("Only an order with nothing delivered can be cancelled."));
    const invoiced = await tx.supplierInvoice.count({ where: { requestId, status: { not: "CANCELLED" } } });
    if (invoiced) throw new AppError("There is an invoice for this order — cancel it first.", "CONFLICT");
    await tx.stockRequest.update({ where: { id: requestId }, data: { status: "CANCELLED", cancelledAt: now } });
    await eventTx(tx, requestId, "CANCELLED", actor, { from: r.status, to: "CANCELLED", reason: why }, now);
    await audit(tx, actor, { action: "stock_request.order_cancelled", entityType: "StockRequest", entityId: requestId, before: { status: r.status, order: r.orderNumber, total: r.orderTotal }, after: { status: "CANCELLED", reason: why } });
  });
}

/** Where the hotel stands: the same purchases at each stage — never to be added together. */
export async function purchasingPosition() {
  const where = { status: { notIn: ["REJECTED", "CANCELLED"] } };
  const [asked, approved, ordered, invoiced, paid, owed] = await Promise.all([
    db.stockRequest.aggregate({ where: { ...where, status: { in: ["SUBMITTED", "SENT_BACK"] } }, _sum: { estimatedTotal: true }, _count: true }),
    db.stockRequest.aggregate({ where: { status: { in: ["APPROVED", "AWAITING_AUTHORIZATION"] } }, _sum: { approvedBudget: true }, _count: true }),
    db.stockRequest.aggregate({ where: { status: { in: ["ORDERED", "PART_DELIVERED", "DELIVERED", "COMPLETED"] } }, _sum: { orderTotal: true }, _count: true }),
    db.supplierInvoice.aggregate({ where: { status: { not: "CANCELLED" } }, _sum: { amount: true }, _count: true }),
    db.supplierPayment.aggregate({ _sum: { amount: true }, _count: true }),
    db.supplierInvoice.aggregate({ where: { status: { in: ["RECEIVED", "VERIFIED", "DISPUTED", "PART_PAID"] } }, _sum: { amount: true, paidAmount: true }, _count: true }),
  ]);
  return {
    requested: { count: asked._count, amount: asked._sum.estimatedTotal ?? 0 },
    approved: { count: approved._count, amount: approved._sum.approvedBudget ?? 0 },
    ordered: { count: ordered._count, amount: ordered._sum.orderTotal ?? 0 },
    invoiced: { count: invoiced._count, amount: invoiced._sum.amount ?? 0 },
    paid: { count: paid._count, amount: paid._sum.amount ?? 0 },
    owed: { count: owed._count, amount: (owed._sum.amount ?? 0) - (owed._sum.paidAmount ?? 0) },
  };
}
export type PurchasingPosition = Awaited<ReturnType<typeof purchasingPosition>>;
