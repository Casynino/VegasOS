import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  approvePurchase, cancelStockRequest, createStockRequest, editStockRequest, purchasingSummary, resubmitStockRequest, reviewStockRequest, savePurchase, sendBackPurchase, stockRequests,
} from "@/server/services/stock-requests";
import { saveInventoryItem } from "@/server/services/inventory";
import { recordExpense, voidExpense } from "@/server/services/expenses";
import { chefActor, managerActor, receptionistActor, resetBusinessData } from "../support/helpers";
import type { Actor } from "@/server/services/reservations";

/** Stock requests → purchase → final approval: the stock and the ONE expense happen together, at the end. */
beforeEach(resetBusinessData);
const NOW = new Date("2026-09-30T07:00:00Z");
const TODAY = "2026-09-30";

async function mdActor(): Promise<Actor & { userId: string; permissions: ReadonlySet<string> }> {
  const u = await db.user.findUniqueOrThrow({ where: { email: "admin@vegas.test" }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, role: u.role.name, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) };
}
const item = async (name: string, unit: string, qty: number, extra: { tracksExpiry?: boolean } = {}) =>
  (await saveInventoryItem({ name, categoryId: "invcat_food", departmentId: "invdep_kitchen", unit, openingQuantity: qty, costPerUnit: 10_000, ...extra }, await managerActor())).id;
const stock = async (id: string) => (await db.inventoryItem.findUniqueOrThrow({ where: { id } })).quantity;
const lines = (id: string) => db.stockRequestItem.findMany({ where: { requestId: id, removedAt: null }, orderBy: { name: "asc" } });

async function askForBeefAndRice() {
  const beef = await item("Beef", "KG", 20, { tracksExpiry: true });
  const rice = await item("Rice", "KG", 5);
  const r = await createStockRequest({
    department: "KITCHEN", urgent: false, reason: "Weekend wedding", items: [{ name: "Beef", quantity: 10, unit: "kg" }, { name: "Rice", quantity: 25, unit: "kg" }, { name: "Charcoal", quantity: 2, unit: "bags" }],
  }, await chefActor(), NOW);
  return { r, beef, rice };
}

describe("asking and the manager's review", () => {
  it("the kitchen asks (linked to its stock items by name, no money); the manager approves for purchase — still no expense, no stock", async () => {
    const { r, beef, rice } = await askForBeefAndRice();
    expect(r).toMatchObject({ number: "SR-2026-0001", status: "SUBMITTED", department: "KITCHEN", reason: "Weekend wedding" });
    expect((await lines(r.id)).map((l) => [l.name, l.inventoryItemId])).toEqual([["Beef", beef], ["Charcoal", null], ["Rice", rice]]);
    await expect(reviewStockRequest(r.id, "APPROVE", null, await chefActor(), NOW)).rejects.toThrow(/Only a manager/);
    await reviewStockRequest(r.id, "APPROVE", null, await managerActor(), NOW);
    expect((await db.stockRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("APPROVED");
    expect((await lines(r.id)).map((l) => l.approvedQty)).toEqual([10, 2, 25]);
    expect(await db.expense.count()).toBe(0);
    expect(await stock(beef)).toBe(20);
  });

  it("the manager changes amounts with the reason (what was asked stays), sends it back; the cook changes and resends it, or cancels", async () => {
    const { r } = await askForBeefAndRice();
    const mgr = await managerActor();
    const [beefLine, charcoal, riceLine] = await lines(r.id);
    await expect(editStockRequest(r.id, { items: [{ id: beefLine.id, name: "Beef", quantity: 8, unit: "kg" }] }, mgr, NOW)).rejects.toThrow(/Say why/);
    await editStockRequest(r.id, { items: [{ id: beefLine.id, name: "Beef", quantity: 8, unit: "kg" }, { id: riceLine.id, name: "Rice", quantity: 25, unit: "kg" }], reason: "8 kg is enough" }, mgr, NOW);
    const after = await db.stockRequestItem.findMany({ where: { requestId: r.id }, orderBy: { name: "asc" } });
    expect(after.map((l) => [l.name, l.quantity, l.approvedQty, !!l.removedAt])).toEqual([["Beef", 10, 8, false], ["Charcoal", 2, null, true], ["Rice", 25, 25, false]]);
    expect(charcoal.id).toBe(after[1].id);

    await expect(reviewStockRequest(r.id, "SEND_BACK", "", mgr, NOW)).rejects.toThrow(/what to change/);
    await reviewStockRequest(r.id, "SEND_BACK", "Split it — rice next week", mgr, NOW);
    const cook = await chefActor();
    await editStockRequest(r.id, { items: [{ id: beefLine.id, name: "Beef", quantity: 8, unit: "kg" }] }, cook, NOW);
    await resubmitStockRequest(r.id, cook, NOW);
    expect((await db.stockRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("SUBMITTED");
    await cancelStockRequest(r.id, "Not needed any more", cook, NOW);
    const events = await db.stockRequestEvent.findMany({ where: { requestId: r.id }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["SUBMITTED", "EDITED", "SENT_BACK", "EDITED", "SUBMITTED", "CANCELLED"]);
    expect(events[1]).toMatchObject({ reason: "8 kg is enough", byLabel: mgr.label });
  });

  it("reception does not ask for stock (the restaurant's); a manager can ask for another department; someone who only asks sees their own requests", async () => {
    await expect(createStockRequest({ department: "HOUSEKEEPING", urgent: true, items: [{ name: "Toilet paper", quantity: 4, unit: "packs" }] }, await receptionistActor(), NOW)).rejects.toThrow(/cannot request stock/);
    const mgr = await managerActor();
    const r = await createStockRequest({ department: "HOUSEKEEPING", urgent: true, items: [{ name: "Toilet paper", quantity: 4, unit: "packs" }] }, mgr, NOW);
    expect(r).toMatchObject({ department: "HOUSEKEEPING" });
    await expect(createStockRequest({ department: "NOPE", urgent: false, items: [{ name: "X", quantity: 1, unit: "pcs" }] }, mgr, NOW)).rejects.toThrow(/department/);
    await askForBeefAndRice();
    expect((await stockRequests({ mineOnly: mgr.userId })).open.map((x) => x.number)).toEqual([r.number]);
  });
});

describe("the purchase and the final approval", () => {
  async function bought(opts: { submit?: boolean } = {}) {
    const x = await askForBeefAndRice();
    const mgr = await managerActor();
    await reviewStockRequest(x.r.id, "APPROVE", null, mgr, NOW);
    const [beefLine, charcoal, riceLine] = await lines(x.r.id);
    const input = {
      lines: [
        { id: beefLine.id, inventoryItemId: x.beef, purchasedQty: 9.5, unitPrice: 12_000, expiresOn: "2026-10-05" as string | null },
        { id: riceLine.id, inventoryItemId: x.rice, purchasedQty: 25, unitPrice: 3_000 },
        { id: charcoal.id, inventoryItemId: null, purchasedQty: 2, unitPrice: 15_000 },
      ],
      supplierName: "ABC Foods", receiptNumber: "RC-778", noReceiptReason: "Market stall — handwritten receipt kept in the office" as string | null,
      purchasedOn: TODAY, accountId: "acct_cash" as string | null, note: "Beef was short", submit: opts.submit ?? true,
    };
    const p = await savePurchase(x.r.id, input, null, mgr, NOW);
    return { ...x, mgr, p, input };
  }

  it("records what was ACTUALLY bought; final approval puts the stock in and makes ONE expense for the actual amount — and never twice", async () => {
    const { r, beef, rice, p, mgr } = await bought();
    expect(p).toMatchObject({ purchaseNumber: "P-2026-0001", total: 114_000 + 75_000 + 30_000, status: "PENDING_APPROVAL" });
    expect(await db.expense.count()).toBe(0); // bought is not yet an expense
    expect(await stock(beef)).toBe(20);

    const md = await mdActor();
    const done = await approvePurchase(r.id, {}, md, NOW);
    expect(done).toMatchObject({ amount: 219_000, received: 2 });
    expect(await stock(beef)).toBe(29.5);
    expect(await stock(rice)).toBe(30);
    const m = await db.inventoryMovement.findFirstOrThrow({ where: { itemId: beef, kind: "RECEIVE" } });
    expect(m).toMatchObject({ reason: "PURCHASE", change: 9.5, before: 20, after: 29.5, unitCost: 12_000, totalCost: 114_000, approvedById: md.userId, reference: "P-2026-0001 · SR-2026-0001" });
    expect(m.note).toMatch(/Received from purchase P-2026-0001/);

    const e = await db.expense.findFirstOrThrow({ include: { approvals: { orderBy: { createdAt: "asc" } }, category: true, stockRequest: true } });
    expect(e).toMatchObject({ amount: 219_000, status: "APPROVED", accountId: "acct_cash", payee: "ABC Foods", createdById: mgr.userId, reference: "RC-778 · P-2026-0001 · SR-2026-0001" });
    expect(e.category.code).toBe("FOOD");
    expect(e.approvals.map((a) => [a.action, a.actorId])).toEqual([["SUBMITTED", mgr.userId], ["APPROVED", md.userId]]);
    expect(e.stockRequest?.id).toBe(r.id);
    const req = await db.stockRequest.findUniqueOrThrow({ where: { id: r.id }, include: { items: true } });
    expect(req).toMatchObject({ status: "COMPLETED", expenseId: e.id, finalApprovedById: md.userId, purchasedById: mgr.userId });
    expect(req.items.filter((i) => i.movementId)).toHaveLength(2); // charcoal is on the expense, not in stock

    await expect(approvePurchase(r.id, {}, md, NOW)).rejects.toThrow(/not waiting/);
    expect(await db.expense.count()).toBe(1);
    // The same receipt cannot be typed in again as an expense, and the purchase's expense changes only from the purchase.
    await expect(recordExpense({ categoryId: e.categoryId, amount: 219_000, description: "Kitchen shopping", reference: "RC-778", accountId: "acct_cash" }, md)).rejects.toThrow(/already on stock purchase/);
    await expect(voidExpense(e.id, "Mistake", md)).rejects.toThrow(/comes from purchase/);

    const summary = await purchasingSummary(TODAY);
    expect(summary).toMatchObject({ spentToday: 219_000, spentMonth: 219_000, byDepartment: [{ name: "Kitchen", amount: 219_000 }] });
    expect(await db.auditLog.count({ where: { action: "stock_request.final_approved", entityId: r.id } })).toBe(1);
  });

  it("a wrong purchase goes back for correction with the reason, keeping what it was; the buyer fixes it and sends it again", async () => {
    const { r, mgr, input } = await bought();
    const md = await mdActor();
    await expect(sendBackPurchase(r.id, "", md, NOW)).rejects.toThrow(/what to correct/);
    await sendBackPurchase(r.id, "Rice price looks too high", md, NOW);
    expect(await db.stockRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "PURCHASING", correctionNote: "Rice price looks too high" });
    await savePurchase(r.id, { ...input, lines: input.lines.map((l) => (l.purchasedQty === 25 ? { ...l, unitPrice: 2_800 } : l)) }, null, mgr, NOW);
    const done = await approvePurchase(r.id, {}, md, NOW);
    expect(done.amount).toBe(114_000 + 70_000 + 30_000);
    const events = await db.stockRequestEvent.findMany({ where: { requestId: r.id }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["SUBMITTED", "APPROVED", "PURCHASE_SUBMITTED", "PURCHASE_SENT_BACK", "PURCHASE_SUBMITTED", "FINAL_APPROVED"]);
    expect(events[3]).toMatchObject({ reason: "Rice price looks too high", before: expect.objectContaining({ total: 219_000 }) });
  });

  it("the buyer may approve their own purchase (both shown) — unless the MD requires someone else", async () => {
    const { r, mgr } = await bought();
    await db.hotelSettings.updateMany({ data: { purchaseApproverMustDiffer: true } });
    try {
      await expect(approvePurchase(r.id, {}, mgr, NOW)).rejects.toThrow(/another manager/);
    } finally {
      await db.hotelSettings.updateMany({ data: { purchaseApproverMustDiffer: false } });
    }
    await approvePurchase(r.id, {}, mgr, NOW);
    const ev = await db.stockRequestEvent.findFirstOrThrow({ where: { requestId: r.id, action: "FINAL_APPROVED" } });
    expect(ev.after).toMatchObject({ selfApproved: true });
    expect((await db.expense.findFirstOrThrow()).notes).toMatch(/also gave the final approval/);
  });

  it("sending for approval needs what was bought, the account, the seller, and the receipt (or why there is none); only buyers record purchases", async () => {
    const { r, input, mgr } = await bought({ submit: false });
    expect((await db.stockRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PURCHASING");
    const send = { ...input, submit: true };
    await expect(savePurchase(r.id, send, null, await chefActor(), NOW)).rejects.toThrow(/cannot record purchases/);
    await expect(savePurchase(r.id, { ...send, accountId: null }, null, mgr, NOW)).rejects.toThrow(/account/);
    await expect(savePurchase(r.id, { ...send, noReceiptReason: null }, null, mgr, NOW)).rejects.toThrow(/receipt/);
    await expect(savePurchase(r.id, { ...send, lines: send.lines.map((l) => ("expiresOn" in l ? { ...l, expiresOn: null } : l)) }, null, mgr, NOW)).rejects.toThrow(/expiry/);
  });
});
