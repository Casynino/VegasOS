import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { createStockRequest, reviewStockRequest } from "@/server/services/stock-requests";
import {
  authorizeQuote, cancelInvoice, cancelOrder, closeDeliveryShort, issueOrder, paySupplier, proposeQuote, purchasingPosition, recordDelivery, recordInvoice, reportDelivery, saveQuote, verifyInvoice,
} from "@/server/services/procurement";
import { staffAlerts } from "@/server/services/staff-alerts";
import { purchasesAboveFinanceLimit } from "@/server/services/procurement-desk";
import { recordExpense, voidExpense } from "@/server/services/expenses";
import { counterActor, receptionistActor, resetBusinessData } from "../support/helpers";
import type { Actor } from "@/server/services/reservations";

/** Reception/Restaurant ask → Finance reviews → the Accountant quotes → (Finance authorizes) → order → delivery → invoice → Finance pays. */
beforeEach(resetBusinessData);
const NOW = new Date("2026-10-14T07:00:00Z");
const LATER = new Date("2026-10-16T07:00:00Z");

type Who = Actor & { userId: string; permissions: ReadonlySet<string> };
async function withRole(code: string, email: string): Promise<Who> {
  const role = await db.role.findUniqueOrThrow({ where: { code }, include: { permissions: { include: { permission: true } } } });
  const u = await db.user.upsert({
    where: { email }, update: { isActive: true, roleId: role.id },
    create: { email, fullName: `${role.name} (test)`, roleId: role.id, passwordHash: await hashPassword("Test12345678"), mustChangePassword: false },
  });
  return { userId: u.id, label: u.fullName, role: role.name, permissions: new Set(role.permissions.map((p) => p.permission.code)) };
}
const finance = () => withRole("FINANCE", "finance@test.local");
const accountant = () => withRole("ACCOUNTANT", "procurement@test.local");
const owner = () => withRole("OWNER", "boss@test.local");

async function supplierOf(name: string) {
  return db.supplier.upsert({ where: { name }, update: {}, create: { name, phone: "+255700000001" } });
}
async function cashAccount() {
  return db.moneyAccount.findFirstOrThrow({ where: { kind: "BANK", isActive: true, acceptsExpenses: true } });
}

/** An approved request with a budget — a table (not stock) and soda crates (a stock item). */
async function approvedRequest(budget: number | null = 500_000) {
  const soda = await db.inventoryItem.upsert({
    where: { id: "item-soda-proc" }, update: { quantity: 2 },
    create: { id: "item-soda-proc", name: "Soda crate (proc test)", categoryId: "invcat_food", departmentId: "invdep_restaurant", unit: "CRATE", quantity: 2, costPerUnit: 18_000 },
  });
  const r = await createStockRequest({
    department: "RESTAURANT", urgent: false, title: "Soda and a table", estimatedTotal: 450_000,
    items: [{ name: "Table", quantity: 1, unit: "pcs" }, { name: "Soda crate (proc test)", quantity: 10, unit: "crates", inventoryItemId: soda.id }],
  }, await counterActor(), NOW);
  await reviewStockRequest(r.id, "APPROVE", null, await finance(), NOW, { approvedBudget: budget });
  const items = await db.stockRequestItem.findMany({ where: { requestId: r.id }, orderBy: { name: "asc" } });
  return { r, soda, table: items.find((i) => i.name === "Table")!, sodaLine: items.find((i) => i.name.startsWith("Soda"))! };
}
const lines = (x: Awaited<ReturnType<typeof approvedRequest>>, table: number, soda: number) => [
  { itemId: x.table.id, quantity: 1, unitPrice: table }, { itemId: x.sodaLine.id, quantity: 10, unitPrice: soda },
];
const status = async (id: string) => (await db.stockRequest.findUniqueOrThrow({ where: { id } })).status;

describe("quotations", () => {
  it("6 — the Accountant records supplier quotations; Finance's approval is what allows it; the Accountant cannot approve", async () => {
    const acc = await accountant();
    const x = await approvedRequest();
    const a = await saveQuote(x.r.id, { supplierId: (await supplierOf("Mwenge Furniture")).id, validUntil: "2026-10-30", deliveryDays: 5, lines: lines(x, 250_000, 18_000) }, null, acc, NOW);
    const b = await saveQuote(x.r.id, { newSupplier: { name: "Kariakoo Wholesale", phone: "+255711111111" }, lines: lines(x, 230_000, 20_000) }, new File([new Uint8Array([1, 2])], "q.pdf", { type: "application/pdf" }), acc, NOW);
    expect([a.total, b.total]).toEqual([430_000, 430_000]);
    expect(await db.supplier.findFirst({ where: { name: "Kariakoo Wholesale" } })).toBeTruthy();
    expect(await db.stockQuoteLine.count({ where: { quoteId: b.id } })).toBe(2);
    expect(await db.stockDocument.findMany({ where: { requestId: x.r.id, kind: "QUOTATION" } })).toHaveLength(1);
    // nothing is committed or spent by quoting
    expect(await db.expense.count()).toBe(0);
    expect(await status(x.r.id)).toBe("APPROVED");
    // nobody but procurement records quotations; no more than Finance approved; a bad price is refused
    await expect(saveQuote(x.r.id, { supplierId: a.supplierId, lines: lines(x, 1, 1) }, null, await receptionistActor(), NOW)).rejects.toThrow(/Only Finance or the Accountant/);
    await expect(saveQuote(x.r.id, { supplierId: a.supplierId, lines: [{ itemId: x.sodaLine.id, quantity: 11, unitPrice: 18_000 }] }, null, acc, NOW)).rejects.toThrow(/more than Finance approved/);
    await expect(saveQuote(x.r.id, { supplierId: a.supplierId, lines: [{ itemId: x.table.id, quantity: 1, unitPrice: -5 }] }, null, acc, NOW)).rejects.toThrow(/whole shillings/);
    await expect(saveQuote(x.r.id, { lines: lines(x, 1, 1) }, null, acc, NOW)).rejects.toThrow(/Who gave the quotation/);
    // a request Finance has not approved cannot be quoted
    const fresh = await createStockRequest({ department: "RECEPTION", urgent: false, items: [{ name: "Paper", quantity: 5, unit: "reams" }] }, await receptionistActor(), NOW);
    await expect(saveQuote(fresh.id, { supplierId: a.supplierId, lines: [{ itemId: (await db.stockRequestItem.findFirstOrThrow({ where: { requestId: fresh.id } })).id, quantity: 5, unitPrice: 1000 }] }, null, acc, NOW)).rejects.toThrow(/Finance approved/);
  });

  it("the same quotation sent twice makes one", async () => {
    const acc = await accountant();
    const x = await approvedRequest();
    const s = await supplierOf("Mwenge Furniture");
    const one = await saveQuote(x.r.id, { supplierId: s.id, lines: lines(x, 250_000, 18_000) }, null, acc, NOW);
    const two = await saveQuote(x.r.id, { supplierId: s.id, lines: lines(x, 250_000, 18_000) }, null, acc, NOW);
    expect(two.id).toBe(one.id);
    expect(await db.stockQuote.count({ where: { requestId: x.r.id } })).toBe(1);
  });
});

describe("authorization above the budget", () => {
  it("within the approved budget the quotation is authorized at once — no second approval is asked", async () => {
    const acc = await accountant();
    const x = await approvedRequest(500_000);
    const q = await saveQuote(x.r.id, { supplierId: (await supplierOf("Mwenge Furniture")).id, lines: lines(x, 250_000, 18_000) }, null, acc, NOW);
    expect(await proposeQuote(x.r.id, q.id, acc, NOW)).toEqual({ status: "APPROVED", needsFinance: false });
    expect(await db.stockRequest.findUniqueOrThrow({ where: { id: x.r.id } })).toMatchObject({ status: "APPROVED", chosenQuoteId: q.id, authorizedById: null });
    expect((await db.stockRequest.findUniqueOrThrow({ where: { id: x.r.id } })).authorizedAt).toEqual(NOW);
  });

  it("7 — a quotation above the approved budget goes back to Finance and cannot be ordered until Finance authorizes it", async () => {
    const acc = await accountant();
    const fin = await finance();
    const x = await approvedRequest(400_000);
    const q = await saveQuote(x.r.id, { supplierId: (await supplierOf("Mwenge Furniture")).id, lines: lines(x, 250_000, 18_000) }, null, acc, NOW); // 430,000 > 400,000
    expect(await proposeQuote(x.r.id, q.id, acc, NOW)).toEqual({ status: "AWAITING_AUTHORIZATION", needsFinance: true });
    await expect(issueOrder(x.r.id, { expectedDeliveryOn: "2026-10-20" }, acc, NOW)).rejects.toThrow(/not ready to be ordered/);
    // the Accountant cannot authorize her own proposal; neither can the departments
    for (const who of [acc, await counterActor(), await receptionistActor()]) await expect(authorizeQuote(x.r.id, "AUTHORIZE", null, who, NOW)).rejects.toThrow(/Only Finance/);
    // Finance returns it with a reason, the Accountant gets a better price, proposes again, Finance authorizes
    await expect(authorizeQuote(x.r.id, "RETURN", null, fin, NOW)).rejects.toThrow(/Say what/);
    await authorizeQuote(x.r.id, "RETURN", "Ask for TZS 400,000", fin, NOW);
    expect(await db.stockRequest.findUniqueOrThrow({ where: { id: x.r.id } })).toMatchObject({ status: "APPROVED", chosenQuoteId: null, authorizedAt: null });
    const better = await saveQuote(x.r.id, { supplierId: (await supplierOf("Kariakoo Wholesale")).id, lines: lines(x, 240_000, 18_500) }, null, acc, NOW); // 425,000: still above
    await proposeQuote(x.r.id, better.id, acc, NOW);
    await authorizeQuote(x.r.id, "AUTHORIZE", "Accepted — the table is needed", fin, NOW);
    expect(await db.stockRequest.findUniqueOrThrow({ where: { id: x.r.id } })).toMatchObject({ status: "APPROVED", chosenQuoteId: better.id, authorizedById: fin.userId, authorizationNote: "Accepted — the table is needed" });
    const audits = (await db.auditLog.findMany({ where: { entityId: x.r.id, action: { startsWith: "stock_request.quote" } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(audits).toEqual(["stock_request.quote_recorded", "stock_request.quote_proposed", "stock_request.quote_returned", "stock_request.quote_recorded", "stock_request.quote_proposed", "stock_request.quote_authorized"]);
  });

  it("above Finance's own limit only the Boss or the MD authorizes", async () => {
    const acc = await accountant();
    const fin = await finance();
    const x = await approvedRequest(100_000);
    await db.hotelSettings.update({ where: { id: 1 }, data: { financeAuthorizationLimit: 400_000 } });
    try {
      const q = await saveQuote(x.r.id, { supplierId: (await supplierOf("Mwenge Furniture")).id, lines: lines(x, 250_000, 18_000) }, null, acc, NOW);
      await proposeQuote(x.r.id, q.id, acc, NOW);
      // it waits on the Boss's own dashboard, not Finance's (and nothing waits there when no limit is set)
      expect(await purchasesAboveFinanceLimit()).toEqual({ count: 1, limit: 400_000 });
      await expect(authorizeQuote(x.r.id, "AUTHORIZE", null, fin, NOW)).rejects.toThrow(/above what Finance may authorize/);
      await authorizeQuote(x.r.id, "AUTHORIZE", "Boss agreed", await owner(), NOW);
      expect((await purchasesAboveFinanceLimit()).count).toBe(0);
      expect((await db.stockRequest.findUniqueOrThrow({ where: { id: x.r.id } })).authorizedAt).toBeTruthy();
      // Finance cannot approve a budget above its limit either
      const big = await createStockRequest({ department: "RESTAURANT", urgent: false, items: [{ name: "Oven", quantity: 1, unit: "pcs" }], clientKey: "big-oven-key-001" }, await counterActor(), NOW);
      await expect(reviewStockRequest(big.id, "APPROVE", null, fin, NOW, { approvedBudget: 900_000 })).rejects.toThrow(/above what Finance may approve alone/);
    } finally { await db.hotelSettings.update({ where: { id: 1 }, data: { financeAuthorizationLimit: null } }); }
  });
});

/** A fully authorized order: quote → propose → order. */
async function ordered(budget = 500_000) {
  const acc = await accountant();
  const x = await approvedRequest(budget);
  const q = await saveQuote(x.r.id, { supplierId: (await supplierOf("Mwenge Furniture")).id, validUntil: "2026-10-30", lines: lines(x, 250_000, 18_000) }, null, acc, NOW); // 430,000
  await proposeQuote(x.r.id, q.id, acc, NOW);
  const po = await issueOrder(x.r.id, { expectedDeliveryOn: "2026-10-20", note: "Deliver to reception" }, acc, NOW);
  return { acc, x, q, po };
}

describe("the purchase order and deliveries", () => {
  it("8 — the purchase order is issued after the approvals: a number, the supplier, the committed amount and the expected date — and not before", async () => {
    const { x, po } = await ordered();
    expect(po).toMatchObject({ orderNumber: "PO-2026-0001", total: 430_000 });
    const r = await db.stockRequest.findUniqueOrThrow({ where: { id: x.r.id }, include: { items: true } });
    expect(r).toMatchObject({ status: "ORDERED", orderTotal: 430_000, orderNote: "Deliver to reception" });
    expect(r.expectedDeliveryOn?.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(r.items.find((i) => i.name === "Table")).toMatchObject({ orderedQty: 1, orderedUnitPrice: 250_000, receivedQty: 0 });
    // ordering is not stock and not an expense
    expect(await db.expense.count()).toBe(0);
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: x.soda.id } })).quantity).toBe(2);
    await expect(issueOrder(x.r.id, { expectedDeliveryOn: "2026-10-20" }, await accountant(), NOW)).rejects.toThrow(/not ready to be ordered/);
  });

  it("9 and 10 — a partial delivery: only what arrived goes into stock, exactly once; the rest is still to come", async () => {
    const { acc, x } = await ordered();
    const d1 = await recordDelivery(x.r.id, { lines: [{ itemId: x.sodaLine.id, quantity: 4 }] }, null, acc, LATER);
    expect(d1.status).toBe("PART_DELIVERED");
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: x.soda.id } })).quantity).toBe(6);
    // the same delivery pressed twice is not added twice
    const again = await recordDelivery(x.r.id, { lines: [{ itemId: x.sodaLine.id, quantity: 4 }] }, null, acc, LATER);
    expect(again.repeated).toBe(true);
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: x.soda.id } })).quantity).toBe(6);
    // more than was ordered cannot be added to stock
    await expect(recordDelivery(x.r.id, { lines: [{ itemId: x.sodaLine.id, quantity: 7 }] }, null, acc, new Date(LATER.getTime() + 3_600_000))).rejects.toThrow(/only 6 crates is still to come/);
    const later = new Date(LATER.getTime() + 2 * 3_600_000);
    const d2 = await recordDelivery(x.r.id, { lines: [{ itemId: x.sodaLine.id, quantity: 6 }, { itemId: x.table.id, quantity: 1 }] }, null, acc, later);
    expect(d2.status).toBe("DELIVERED");
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: x.soda.id } })).quantity).toBe(12);
    // one movement per delivery line, each linked once
    expect(await db.inventoryMovement.count({ where: { itemId: x.soda.id, reason: { not: "OPENING" } } })).toBeGreaterThanOrEqual(2);
    const lns = await db.stockDeliveryLine.findMany({ where: { delivery: { requestId: x.r.id }, itemId: x.sodaLine.id } });
    expect(lns.map((l) => l.quantity).sort()).toEqual([4, 6]);
    expect(new Set(lns.map((l) => l.movementId)).size).toBe(2);
    // the table is not a stock item: received, never added to stock
    expect((await db.stockRequestItem.findUniqueOrThrow({ where: { id: x.table.id } })).receivedQty).toBe(1);
  });

  it("a damaged or wrong delivery is recorded, does not enter stock, and is still owed; the rest can be closed short with a reason", async () => {
    const { acc, x } = await ordered();
    const d = await recordDelivery(x.r.id, { lines: [{ itemId: x.sodaLine.id, quantity: 7, rejectedQty: 3, problem: "DAMAGED", note: "3 crates leaking" }, { itemId: x.table.id, quantity: 1 }] }, null, acc, LATER);
    expect(d).toMatchObject({ status: "PART_DELIVERED", problems: 1 });
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: x.soda.id } })).quantity).toBe(9);
    expect(await db.stockRequestEvent.count({ where: { requestId: x.r.id, action: "DELIVERY_PROBLEM" } })).toBe(1);
    await expect(recordDelivery(x.r.id, { lines: [{ itemId: x.sodaLine.id, quantity: 0, rejectedQty: 1 }] }, null, acc, new Date(LATER.getTime() + 3_600_000))).rejects.toThrow(/what is wrong/);
    await expect(closeDeliveryShort(x.r.id, "no", acc, LATER)).rejects.toThrow(/Say why/);
    await closeDeliveryShort(x.r.id, "The supplier cannot replace the 3 crates", acc, LATER);
    expect(await status(x.r.id)).toBe("DELIVERED");
    // the department that asked says the delivery is not right
    await reportDelivery(x.r.id, { correct: false, note: "Only 7 crates came" }, await counterActor(), LATER);
    expect(await db.stockRequestEvent.count({ where: { requestId: x.r.id, action: "DELIVERY_REPORTED" } })).toBe(1);
    await expect(reportDelivery(x.r.id, { correct: false }, await counterActor(), LATER)).rejects.toThrow(/Say what is wrong/);
    await expect(reportDelivery(x.r.id, { correct: true }, await receptionistActor(), LATER)).rejects.toThrow(/Only the person who asked/);
  });

  it("an order with nothing delivered can be cancelled with a reason", async () => {
    const { acc, x } = await ordered();
    await expect(cancelOrder(x.r.id, "no", acc, LATER)).rejects.toThrow(/Say why/);
    await cancelOrder(x.r.id, "The supplier closed down", acc, LATER);
    expect(await status(x.r.id)).toBe("CANCELLED");
    expect(await db.expense.count()).toBe(0);
  });
});

describe("invoice and payment", () => {
  async function delivered() {
    const o = await ordered();
    await recordDelivery(o.x.r.id, { lines: [{ itemId: o.x.sodaLine.id, quantity: 10 }, { itemId: o.x.table.id, quantity: 1 }] }, null, o.acc, LATER);
    return o;
  }

  it("11 — the invoice is recorded by the Accountant, verified by Finance, and paid by Finance: the payment is the one expense; the request completes when everything is in", async () => {
    const { acc, x } = await delivered();
    const fin = await finance();
    const bank = await cashAccount();
    const inv = await recordInvoice(x.r.id, { number: "INV-884", amount: 430_000, invoiceDate: "2026-10-15", dueOn: "2026-10-30" }, new File([new Uint8Array([9])], "inv.pdf", { type: "application/pdf" }), acc, LATER);
    // an invoice is not an expense
    expect(await db.expense.count()).toBe(0);
    expect(await db.stockDocument.count({ where: { requestId: x.r.id, kind: "INVOICE", refId: inv.id } })).toBe(1);
    // the Accountant can neither verify nor pay; an unverified invoice cannot be paid
    await expect(verifyInvoice(inv.id, "VERIFY", null, acc, LATER)).rejects.toThrow(/Only Finance/);
    await expect(paySupplier(inv.id, { amount: 430_000, accountId: bank.id, paidOn: "2026-10-16" }, acc, LATER)).rejects.toThrow(/Only Finance pays/);
    await expect(paySupplier(inv.id, { amount: 430_000, accountId: bank.id, paidOn: "2026-10-16" }, fin, LATER)).rejects.toThrow(/verified invoice/);
    await verifyInvoice(inv.id, "VERIFY", null, fin, LATER);
    // too much, in the future, or twice
    await expect(paySupplier(inv.id, { amount: 500_000, accountId: bank.id, paidOn: "2026-10-16" }, fin, LATER)).rejects.toThrow(/more than what is still owed/);
    await expect(paySupplier(inv.id, { amount: 100_000, accountId: bank.id, paidOn: "2026-12-01" }, fin, LATER)).rejects.toThrow(/future/);
    // a part payment, then the rest; each is an expense, once
    const p1 = await paySupplier(inv.id, { amount: 200_000, accountId: bank.id, paidOn: "2026-10-16", reference: "TRF-1", clientKey: "pay-key-000001" }, fin, LATER);
    const again = await paySupplier(inv.id, { amount: 200_000, accountId: bank.id, paidOn: "2026-10-16", reference: "TRF-1", clientKey: "pay-key-000001" }, fin, LATER);
    expect(again).toMatchObject({ repeated: true, paymentId: p1.paymentId });
    expect(await db.expense.count()).toBe(1);
    expect(await status(x.r.id)).toBe("DELIVERED");
    expect(await db.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ status: "PART_PAID", paidAmount: 200_000 });
    await paySupplier(inv.id, { amount: 230_000, accountId: bank.id, paidOn: "2026-10-17", reference: "TRF-2" }, fin, new Date(LATER.getTime() + 86_400_000));
    expect(await db.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ status: "PAID", paidAmount: 430_000 });
    expect((await db.expense.aggregate({ _sum: { amount: true } }))._sum.amount).toBe(430_000);
    expect(await status(x.r.id)).toBe("COMPLETED");
    // the story: who submitted, reviewed, approved, ordered, received and paid
    const events = await db.stockRequestEvent.findMany({ where: { requestId: x.r.id }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.action)).toEqual([
      "SUBMITTED", "APPROVED", "QUOTE_RECORDED", "QUOTE_PROPOSED", "ORDER_ISSUED", "DELIVERY_RECORDED", "INVOICE_RECORDED", "INVOICE_VERIFIED", "SUPPLIER_PAID", "SUPPLIER_PAID", "COMPLETED",
    ]);
    const paid = await db.supplierPayment.findMany({ where: { invoiceId: inv.id }, include: { expense: true } });
    expect(paid.every((p) => p.paidById === fin.userId && p.expense.status === "APPROVED")).toBe(true);
    // paying never touches stock
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: x.soda.id } })).quantity).toBe(12);
  });

  it("the expense of a supplier payment changes only from the purchase: it cannot be voided by hand, and its invoice number cannot be typed in again as an expense", async () => {
    const { acc, x } = await delivered();
    const fin = await finance();
    const inv = await recordInvoice(x.r.id, { number: "INV-777", amount: 430_000, invoiceDate: "2026-10-15" }, null, acc, LATER);
    // typed in again before it is paid: refused (it becomes an expense when Finance pays it)
    const bank = await cashAccount();
    const cat = await db.expenseCategory.findFirstOrThrow({ where: { isActive: true } });
    const again = { amount: 430_000, categoryId: cat.id, description: "Furniture", spentAt: LATER, accountId: bank.id, reference: "inv-777" } as unknown as Parameters<typeof recordExpense>[0];
    await expect(recordExpense(again, fin)).rejects.toThrow(/already on order/);
    await verifyInvoice(inv.id, "VERIFY", null, fin, LATER);
    const paid = await paySupplier(inv.id, { amount: 430_000, accountId: bank.id, paidOn: "2026-10-16" }, fin, LATER);
    const expense = await db.supplierPayment.findUniqueOrThrow({ where: { id: paid.paymentId } });
    await expect(voidExpense(expense.expenseId, "Entered by mistake", fin)).rejects.toThrow(/payment of supplier invoice INV-777/);
    expect((await db.expense.aggregate({ _sum: { amount: true } }))._sum.amount).toBe(430_000);
  });

  it("an invoice above what was delivered needs Finance's reason or is disputed; a duplicate invoice and a cancelled one are handled", async () => {
    const { acc, x } = await ordered();
    const fin = await finance();
    await recordDelivery(x.r.id, { lines: [{ itemId: x.table.id, quantity: 1 }] }, null, acc, LATER); // only the table: 250,000 delivered
    const inv = await recordInvoice(x.r.id, { number: "INV-1", amount: 430_000, invoiceDate: "2026-10-15" }, null, acc, LATER);
    await expect(recordInvoice(x.r.id, { number: "INV-1", amount: 430_000, invoiceDate: "2026-10-15" }, null, acc, LATER)).rejects.toThrow(/already recorded/);
    await expect(verifyInvoice(inv.id, "VERIFY", null, fin, LATER)).rejects.toThrow(/more than what was delivered/);
    await expect(verifyInvoice(inv.id, "DISPUTE", null, fin, LATER)).rejects.toThrow(/Say what is wrong/);
    await verifyInvoice(inv.id, "DISPUTE", "The soda has not come yet", fin, LATER);
    expect((await db.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("DISPUTED");
    await cancelInvoice(inv.id, "Wrong invoice sent by the supplier", acc, LATER);
    expect((await db.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("CANCELLED");
    expect(await db.expense.count()).toBe(0);
  });

  it("an invoice cannot be cancelled once money was paid against it", async () => {
    const { acc, x } = await delivered();
    const fin = await finance();
    const inv = await recordInvoice(x.r.id, { number: "INV-2", amount: 430_000, invoiceDate: "2026-10-15" }, null, acc, LATER);
    await verifyInvoice(inv.id, "VERIFY", null, fin, LATER);
    await paySupplier(inv.id, { amount: 10_000, accountId: (await cashAccount()).id, paidOn: "2026-10-16" }, fin, LATER);
    await expect(cancelInvoice(inv.id, "Entered by mistake", fin, LATER)).rejects.toThrow(/already paid/);
  });

  it("the position keeps the stages apart: requested, approved, ordered, invoiced, paid, owed — and the expenses are only what was paid", async () => {
    const { acc, x } = await delivered();
    const fin = await finance();
    const inv = await recordInvoice(x.r.id, { number: "INV-3", amount: 430_000, invoiceDate: "2026-10-15" }, null, acc, LATER);
    let pos = await purchasingPosition();
    expect(pos.ordered.amount).toBe(430_000);
    expect(pos.invoiced.amount).toBe(430_000);
    expect(pos.paid.amount).toBe(0);
    expect(pos.owed.amount).toBe(430_000);
    await verifyInvoice(inv.id, "VERIFY", null, fin, LATER);
    await paySupplier(inv.id, { amount: 130_000, accountId: (await cashAccount()).id, paidOn: "2026-10-16" }, fin, LATER);
    pos = await purchasingPosition();
    expect(pos.paid.amount).toBe(130_000);
    expect(pos.owed.amount).toBe(300_000);
    expect((await db.expense.aggregate({ _sum: { amount: true } }))._sum.amount).toBe(130_000);
  });
});

describe("who may do what", () => {
  it("12 — unauthorized staff cannot approve, authorize or pay: reception, the Counter, the Accountant and the Manager", async () => {
    const { acc, x } = await ordered();
    const inv = await recordInvoice(x.r.id, { number: "INV-9", amount: 100_000, invoiceDate: "2026-10-15" }, null, acc, LATER);
    const mgr = await withRole("MANAGER", "manager@test.local");
    for (const who of [await receptionistActor(), await counterActor(), acc, mgr]) {
      await expect(authorizeQuote(x.r.id, "AUTHORIZE", null, who, NOW), `${who.label} authorize`).rejects.toThrow(/Only Finance/);
      await expect(verifyInvoice(inv.id, "VERIFY", null, who, LATER), `${who.label} verify`).rejects.toThrow(/Only Finance/);
      await expect(paySupplier(inv.id, { amount: 1000, accountId: "x", paidOn: "2026-10-16" }, who, LATER), `${who.label} pay`).rejects.toThrow(/Only Finance pays/);
    }
    for (const who of [await receptionistActor(), await counterActor(), mgr]) {
      await expect(issueOrder(x.r.id, { expectedDeliveryOn: "2026-10-20" }, who, NOW), `${who.label} order`).rejects.toThrow(/Only Finance or the Accountant/);
      await expect(recordInvoice(x.r.id, { number: "INV-X", amount: 1000, invoiceDate: "2026-10-15" }, null, who, LATER), `${who.label} invoice`).rejects.toThrow(/Only Finance or the Accountant/);
    }
  });
});

describe("the bell", () => {
  const purchase = async (who: Who) => (await staffAlerts(who.permissions, who.userId)).filter((a) => a.kind === "purchase").map((a) => a.text);

  it("14 — each person hears what is theirs: the Accountant to quote and order, Finance to authorize, verify and pay, the person who asked about their request", async () => {
    const acc = await accountant(), fin = await finance();
    const x = await approvedRequest(400_000);
    const asker = await db.stockRequest.findUniqueOrThrow({ where: { id: x.r.id } });
    // Finance organizes the purchasing too (owner, 2026-10-13), so it hears what the Accountant hears
    expect(await purchase(acc)).toEqual([expect.stringMatching(/get quotations for/)]);
    expect(await purchase(fin)).toEqual([expect.stringMatching(/get quotations for/)]);
    const q = await saveQuote(x.r.id, { supplierId: (await supplierOf("Mwenge Furniture")).id, lines: lines(x, 250_000, 18_000) }, null, acc, NOW);
    await proposeQuote(x.r.id, q.id, acc, NOW);
    expect(await purchase(acc)).toEqual([]);
    expect(await purchase(fin)).toEqual([expect.stringMatching(/authorize the price .*30,000 above the budget/)]);
    await authorizeQuote(x.r.id, "AUTHORIZE", null, fin, NOW);
    expect(await purchase(acc)).toEqual([expect.stringMatching(/issue the order/)]);
    expect(await purchase(fin)).toEqual([expect.stringMatching(/issue the order/)]);
    await issueOrder(x.r.id, { expectedDeliveryOn: "2026-10-20" }, acc, NOW);
    await recordDelivery(x.r.id, { lines: [{ itemId: x.sodaLine.id, quantity: 10 }, { itemId: x.table.id, quantity: 1 }] }, null, acc, LATER);
    // the person who asked hears it arrived — and nobody else does
    const askerAlerts = (await staffAlerts(new Set(["inventory.request"]), asker.requestedById)).filter((a) => a.kind === "purchase");
    expect(askerAlerts).toHaveLength(1);
    expect(askerAlerts[0].text).toMatch(/arrived/);
    expect((await staffAlerts(new Set(["inventory.request"]), (await receptionistActor()).userId!)).filter((a) => a.kind === "purchase")).toEqual([]);
    const inv = await recordInvoice(x.r.id, { number: "INV-B", amount: 430_000, invoiceDate: "2026-10-15" }, null, acc, LATER);
    expect(await purchase(fin)).toEqual([expect.stringMatching(/verify supplier invoice INV-B/)]);
    await verifyInvoice(inv.id, "VERIFY", null, fin, LATER);
    expect(await purchase(fin)).toEqual([expect.stringMatching(/pay supplier invoice INV-B · TZS 430,000/)]);
    await paySupplier(inv.id, { amount: 430_000, accountId: (await cashAccount()).id, paidOn: "2026-10-16" }, fin, LATER);
    expect(await purchase(fin)).toEqual([]);
  });
});
