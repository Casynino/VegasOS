import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { createStockRequest, resubmitStockRequest, reviewStockRequest, stockRequests } from "@/server/services/stock-requests";
import { counterActor, managerActor, receptionistActor, resetBusinessData } from "../support/helpers";
import type { Actor } from "@/server/services/reservations";

/** Reception and the Restaurant ask; Finance reviews. Asking is not an expense, and approving is not buying. */
beforeEach(resetBusinessData);
const NOW = new Date("2026-10-14T07:00:00Z");

/** A person with a built-in role, as the app builds them (their role's rights). */
async function withRole(code: string, email: string): Promise<Actor & { userId: string; permissions: ReadonlySet<string> }> {
  const role = await db.role.findUniqueOrThrow({ where: { code }, include: { permissions: { include: { permission: true } } } });
  const u = await db.user.upsert({
    where: { email }, update: { isActive: true, roleId: role.id },
    create: { email, fullName: `${role.name} (test)`, roleId: role.id, passwordHash: await hashPassword("Test12345678"), mustChangePassword: false },
  });
  return { userId: u.id, label: u.fullName, role: role.name, permissions: new Set(role.permissions.map((p) => p.permission.code)) };
}
const finance = () => withRole("FINANCE", "finance@test.local");
const accountant = () => withRole("ACCOUNTANT", "procurement@test.local");

const table = { department: "RECEPTION", urgent: false, title: "Reception table", priority: "HIGH" as const, estimatedTotal: 450_000, neededBy: "2026-10-20", reason: "The front desk has one table for two people", items: [{ name: "Table", quantity: 1, unit: "pcs", note: "120 × 60 cm, dark wood" }] };

describe("Reception asks from its own portal", () => {
  it("1 — a request for a table: reference, title, priority, an ESTIMATE (not an expense), the person and the time", async () => {
    const r = await createStockRequest(table, await receptionistActor(), NOW);
    expect(r).toMatchObject({ number: "SR-2026-0001", status: "SUBMITTED", department: "RECEPTION", title: "Reception table", priority: "HIGH", estimatedTotal: 450_000, approvedBudget: null, urgent: false });
    expect(r.createdAt).toEqual(NOW);
    // an estimate is not money spent or approved
    expect(await db.expense.count()).toBe(0);
    const mine = await stockRequests({ mineOnly: r.requestedById });
    expect(mine.open.map((x) => x.number)).toEqual(["SR-2026-0001"]);
    expect(mine.open[0].requestedBy.fullName).toBeTruthy();
  });

  it("an urgent one is first in the line; a bad estimate or an empty list is refused", async () => {
    const desk = await receptionistActor();
    await createStockRequest(table, desk, NOW);
    const urgent = await createStockRequest({ ...table, title: "Printer paper", priority: "URGENT", items: [{ name: "Printer paper", quantity: 10, unit: "reams" }] }, desk, NOW);
    expect(urgent).toMatchObject({ priority: "URGENT", urgent: true });
    expect((await stockRequests()).open.map((x) => x.title)).toEqual(["Printer paper", "Reception table"]);
    await expect(createStockRequest({ ...table, estimatedTotal: -5 }, desk, NOW)).rejects.toThrow(/whole number of shillings/);
    await expect(createStockRequest({ ...table, estimatedTotal: 12.5 }, desk, NOW)).rejects.toThrow(/whole number of shillings/);
    await expect(createStockRequest({ ...table, items: [] }, desk, NOW)).rejects.toThrow(/Add at least one item/);
  });

  it("a double tap or a retried send makes ONE request; another person cannot reuse the key", async () => {
    const desk = await receptionistActor();
    const key = "form-key-0001-abcd";
    const a = await createStockRequest({ ...table, clientKey: key }, desk, NOW);
    const b = await createStockRequest({ ...table, clientKey: key }, desk, NOW);
    expect(b.id).toBe(a.id);
    const both = await Promise.allSettled([createStockRequest({ ...table, clientKey: "form-key-0002-abcd" }, desk, NOW), createStockRequest({ ...table, clientKey: "form-key-0002-abcd" }, desk, NOW)]);
    expect(both.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await db.stockRequest.count()).toBe(2);
    await expect(createStockRequest({ ...table, clientKey: key }, await counterActor(), NOW)).rejects.toThrow(/already sent/);
  });

  it("a photo or document is kept with the request, and a wrong file type is refused", async () => {
    const desk = await receptionistActor();
    const photo = new File([new Uint8Array([1, 2, 3, 4])], "table.jpg", { type: "image/jpeg" });
    const r = await createStockRequest({ ...table, attachment: photo }, desk, NOW);
    const docs = await db.stockDocument.findMany({ where: { requestId: r.id }, include: { file: true } });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ kind: "REQUEST_PHOTO", uploadedById: desk.userId });
    expect(docs[0].file).toMatchObject({ purpose: "STOCK_DOCUMENT", contentType: "image/jpeg", size: 4 });
    await expect(createStockRequest({ ...table, attachment: new File([new Uint8Array([1])], "x.exe", { type: "application/x-msdownload" }) }, desk, NOW)).rejects.toThrow(/photo/);
  });
});

describe("the Restaurant asks to restock", () => {
  it("2 — the Counter asks for beverages, picking stock items where they exist; nothing enters stock by asking", async () => {
    const soda = await db.inventoryItem.create({ data: { name: "Soda crate", categoryId: "invcat_food", departmentId: "invdep_restaurant", unit: "CRATE", quantity: 2, costPerUnit: 18_000 } });
    const r = await createStockRequest({ department: "RESTAURANT", urgent: false, title: "Soda restock", priority: "NORMAL", estimatedTotal: 360_000, items: [{ name: "Soda crate", quantity: 20, unit: "crates", inventoryItemId: soda.id }, { name: "Paper cups", quantity: 500, unit: "pcs" }] }, await counterActor(), NOW);
    const items = await db.stockRequestItem.findMany({ where: { requestId: r.id }, orderBy: { name: "asc" } });
    expect(items.map((i) => [i.name, i.inventoryItemId])).toEqual([["Paper cups", null], ["Soda crate", soda.id]]);
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: soda.id } })).quantity).toBe(2);
    expect(await db.inventoryMovement.count({ where: { itemId: soda.id } })).toBe(0);
  });
});

describe("Finance reviews", () => {
  it("3 — asks for more information (a reason is needed); the person answers and sends it again", async () => {
    const desk = await receptionistActor();
    const fin = await finance();
    const r = await createStockRequest(table, desk, NOW);
    await expect(reviewStockRequest(r.id, "SEND_BACK", null, fin, NOW)).rejects.toThrow(/Say what to change/);
    await reviewStockRequest(r.id, "SEND_BACK", "What size, and where will it stand?", fin, NOW);
    const back = await db.stockRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(back).toMatchObject({ status: "SENT_BACK", decisionNote: "What size, and where will it stand?", decidedById: fin.userId });
    await resubmitStockRequest(r.id, desk, NOW);
    expect((await db.stockRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("SUBMITTED");
    const story = (await db.stockRequestEvent.findMany({ where: { requestId: r.id }, orderBy: { at: "asc" } })).map((e) => e.action);
    expect(story).toEqual(["SUBMITTED", "SENT_BACK", "SUBMITTED"]);
  });

  it("4 — rejects with a reason, never without one", async () => {
    const r = await createStockRequest(table, await receptionistActor(), NOW);
    const fin = await finance();
    await expect(reviewStockRequest(r.id, "REJECT", null, fin, NOW)).rejects.toThrow(/Say why it is rejected/);
    await reviewStockRequest(r.id, "REJECT", "We already have one in storage", fin, NOW);
    expect(await db.stockRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "REJECTED", decisionNote: "We already have one in storage" });
    await expect(reviewStockRequest(r.id, "APPROVE", null, fin, NOW)).rejects.toThrow(/not waiting for review/);
  });

  it("5 — approves: the budget is what Finance sets (the person's estimate when none is set); approving is not an expense and not stock", async () => {
    const desk = await receptionistActor();
    const fin = await finance();
    const a = await createStockRequest(table, desk, NOW);
    await reviewStockRequest(a.id, "APPROVE", null, fin, NOW);
    expect(await db.stockRequest.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "APPROVED", approvedBudget: 450_000, decidedById: fin.userId });
    const b = await createStockRequest({ ...table, clientKey: "other-form-key-1" }, desk, NOW);
    await reviewStockRequest(b.id, "APPROVE", null, fin, NOW, { approvedBudget: 300_000 });
    expect((await db.stockRequest.findUniqueOrThrow({ where: { id: b.id } })).approvedBudget).toBe(300_000);
    await expect(reviewStockRequest((await createStockRequest({ ...table, clientKey: "third-form-key-0" }, desk, NOW)).id, "APPROVE", null, fin, NOW, { approvedBudget: -1 })).rejects.toThrow(/whole number of shillings/);
    expect(await db.expense.count()).toBe(0);
    expect(await db.inventoryMovement.count()).toBe(0);
  });

  it("the people who ask cannot review; the Accountant (purchasing) cannot review either; nobody reviews their own request when the hotel keeps approvals apart", async () => {
    const r = await createStockRequest(table, await receptionistActor(), NOW);
    for (const who of [await receptionistActor(), await counterActor(), await accountant()]) {
      await expect(reviewStockRequest(r.id, "APPROVE", null, who, NOW), who.label).rejects.toThrow(/Only Finance or a manager/);
    }
    // a manager who asks (managers can ask and review), with approvals kept apart
    const mgr = await managerActor();
    const own = await createStockRequest({ ...table, department: "OFFICE", clientKey: "manager-own-key-1" }, mgr, NOW);
    await expect(reviewStockRequest(own.id, "APPROVE", null, mgr, NOW)).resolves.toBeUndefined(); // the hotel's default: allowed
    const second = await createStockRequest({ ...table, department: "OFFICE", clientKey: "manager-own-key-2" }, mgr, NOW);
    await db.hotelSettings.update({ where: { id: 1 }, data: { purchaseApproverMustDiffer: true } });
    try {
      await expect(reviewStockRequest(second.id, "APPROVE", null, mgr, NOW)).rejects.toThrow(/own request/);
      await reviewStockRequest(second.id, "APPROVE", null, await finance(), NOW); // another person can
    } finally { await db.hotelSettings.update({ where: { id: 1 }, data: { purchaseApproverMustDiffer: false } }); }
  });

  it("every step keeps who, when and why, and is audited", async () => {
    const desk = await receptionistActor();
    const fin = await finance();
    const r = await createStockRequest(table, desk, NOW);
    await reviewStockRequest(r.id, "APPROVE", "Go ahead", fin, NOW);
    const audits = await db.auditLog.findMany({ where: { entityType: "StockRequest", entityId: r.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["stock_request.created", "stock_request.approved_for_purchase"]);
    expect(audits[1].userId).toBe(fin.userId);
    const events = await db.stockRequestEvent.findMany({ where: { requestId: r.id }, orderBy: { at: "asc" } });
    expect(events.map((e) => [e.action, e.byId])).toEqual([["SUBMITTED", desk.userId], ["APPROVED", fin.userId]]);
  });
});

describe("each department asks for its own things", () => {
  it("Reception files under the hotel's departments and is refused the kitchen's; the Counter the other way round; a manager may file for any", async () => {
    const desk = await receptionistActor();
    const counter = await counterActor();
    const towels = { urgent: false, items: [{ name: "Bath towels", quantity: 20, unit: "pcs" }] };
    const beef = { urgent: false, items: [{ name: "Beef", quantity: 10, unit: "kg" }] };
    expect((await createStockRequest({ ...towels, department: "RECEPTION" }, desk, NOW)).department).toBe("RECEPTION");
    expect((await createStockRequest({ ...towels, department: "HOUSEKEEPING", clientKey: "hk-towels-0001" }, desk, NOW)).department).toBe("HOUSEKEEPING");
    await expect(createStockRequest({ ...towels, department: "KITCHEN", clientKey: "wrong-dept-001" }, desk, NOW)).rejects.toThrow(/own department/);
    await expect(createStockRequest({ ...beef, department: "BAR", clientKey: "wrong-dept-002" }, desk, NOW)).rejects.toThrow(/own department/);
    expect((await createStockRequest({ ...beef, department: "KITCHEN", clientKey: "kitchen-beef-01" }, counter, NOW)).department).toBe("KITCHEN");
    await expect(createStockRequest({ ...towels, department: "RECEPTION", clientKey: "wrong-dept-003" }, counter, NOW)).rejects.toThrow(/own department/);
    const mgr = await managerActor();
    expect((await createStockRequest({ ...towels, department: "RECEPTION", clientKey: "mgr-any-0001" }, mgr, NOW)).department).toBe("RECEPTION");
    expect((await createStockRequest({ ...beef, department: "KITCHEN", clientKey: "mgr-any-0002" }, mgr, NOW)).department).toBe("KITCHEN");
    // Finance sees which department each request is from
    const all = await db.stockRequest.findMany({ select: { department: true } });
    expect(all.map((r) => r.department).sort()).toEqual(["HOUSEKEEPING", "KITCHEN", "KITCHEN", "RECEPTION", "RECEPTION"]);
  });
});
