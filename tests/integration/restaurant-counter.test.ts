import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { createRestaurantOrder, declineRestaurantOrder, markPaymentNotReceived, payOrdersTogether, payRoomOrderNow, recordOrderPayment, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { takeSessionPayment } from "@/server/services/dining-sessions";
import { placeOnlineOrder, storePaymentProof } from "@/server/services/online-orders";
import { waiterOnCounter } from "@/server/services/waiter-on-counter";
import { startWaiterShift } from "@/server/services/waiter-work";
import { chefActor, managerActor, counterActor, receptionistActor, resetBusinessData, waiterActor } from "../support/helpers";

/**
 * Waiters handle the customers and the service; the one shared Restaurant Counter account records the
 * official restaurant payments. A waiter may bring the cash — the payment is the Counter's ("brought by"),
 * never the waiter's. A customer who paid online is never collected from again.
 */
const SAFARI = "mi_beers_safari";
const BEER = "mi_beers_heineken";
const PHONE = "0712 606 707";
let n = 0;
const key = () => `${(++n).toString(16).padStart(8, "0")}${"c".repeat(24)}`;

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: { in: [SAFARI, BEER] } }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { publicOrderingEnabled: true, orderPaymentConfirm: true } });
  await db.restaurantLocation.updateMany({ data: { waiterId: null, isActive: true, blockedAs: null } });
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: "staffcode" } } });
});
afterAll(async () => {
  await resetBusinessData();
});

/** A waiter's own order at a table (theirs), not paid yet. */
const waiterOrder = async (locationId = "loc_in_2") =>
  createRestaurantOrder({ type: "DINE_IN", locationId, settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 2 }] }, await waiterActor(), new Date(), { customerPhone: PHONE });

async function readyUp(id: string) {
  const chef = await chefActor();
  await setOrderStatus(id, "ACCEPTED", chef);
  for (const i of await db.restaurantOrderItem.findMany({ where: { orderId: id } })) await setOrderItemPrepared(id, i.id, true, chef);
  await setOrderStatus(id, "READY", chef);
}

/** The customer paid online first: their screenshot, the account and the code. */
async function paidOnline() {
  const { id } = await storePaymentProof(new File([new Uint8Array([137, 80, 78, 71])], "pay.png", { type: "image/png" }));
  const acct = await db.moneyAccount.findFirstOrThrow({ where: { kind: "MOBILE_MONEY", accountNumber: { not: null }, isActive: true } });
  return { proofId: id, accountId: acct.id, reference: "SGH4K2L9PQ" };
}

describe("waiters serve; they never record a payment", () => {
  it("a waiter cannot record a payment in any way — the order stays unpaid and nothing is counted", async () => {
    const waiter = await waiterActor();
    expect(waiter.permissions?.has("revenue.record")).toBe(false);
    const o = await waiterOrder();
    await expect(recordOrderPayment(o.id, { accountId: "acct_cash" }, waiter)).rejects.toThrow(/cannot record payments/);
    await expect(payOrdersTogether([o.id], { accountId: "acct_cash" }, waiter)).rejects.toThrow(/cannot record payments/);
    await expect(takeSessionPayment(o.sessionId!, { accountId: "acct_cash" }, waiter)).rejects.toThrow(/cannot record payments/);
    await expect(payRoomOrderNow(o.id, { accountId: "acct_cash" }, waiter)).rejects.toThrow(/cannot record payments/);
    await expect(createRestaurantOrder({ type: "TAKEAWAY", settlement: "PAY_NOW", accountId: "acct_cash", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { customerPhone: PHONE }))
      .rejects.toThrow(/Restaurant Counter/);
    await readyUp(o.id);
    await expect(setOrderStatus(o.id, "DELIVERED", waiter, new Date(), { pay: { accountId: "acct_cash" } })).rejects.toThrow(/Restaurant Counter/);
    // Serving it without the money is theirs to do: delivered, still waiting for its payment.
    await setOrderStatus(o.id, "DELIVERED", waiter);
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "DELIVERED", paymentStatus: "UNPAID", paidAmount: 0 });
    expect(await db.restaurantOrderPayment.count()).toBe(0);
    expect(await db.revenueTransaction.count({ where: { restaurantOrderId: o.id } })).toBe(0);
  });
});

describe("the Restaurant Counter records the payment", () => {
  it("at the Counter, confirmed at once, brought by the waiter — the order is still the waiter's to serve", async () => {
    const [waiter, counter] = [await waiterActor(), await counterActor()];
    const o = await waiterOrder();
    expect(o.assignedToId).toBe(waiter.userId);
    await recordOrderPayment(o.id, { accountId: "acct_cash", reference: "TBL-2", handedOverById: waiter.userId }, counter);

    const pay = await db.restaurantOrderPayment.findFirstOrThrow({ where: { orderId: o.id } });
    expect(pay).toMatchObject({ amount: o.total, status: "POSTED", atCounter: true, collectedById: counter.userId, handedOverById: waiter.userId, confirmedById: counter.userId, reference: "TBL-2" });
    expect(pay.confirmedAt).not.toBeNull();
    // Order handled by: the waiter · payment recorded through: the Restaurant Counter.
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ paymentStatus: "PAID", paidAmount: o.total, assignedToId: waiter.userId, createdById: waiter.userId });
    const note = await db.restaurantOrderEvent.findFirstOrThrow({ where: { orderId: o.id, note: { startsWith: "Payment received" } } });
    expect(note.note).toMatch(/Restaurant Counter/);
    expect(note.note).toMatch(/brought by Waiter/);
    expect(note.note).not.toMatch(/waiting for reception/);
    expect(note.byId).toBe(counter.userId);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "restaurant_order.paid", entityId: o.id } });
    expect(log.userId).toBe(counter.userId);
    expect(log.after).toMatchObject({ recordedThrough: "Restaurant Counter", broughtBy: expect.stringContaining("Waiter"), confirmed: true });
  });

  it("without a waiter named, the payment is simply the Counter's", async () => {
    const counter = await counterActor();
    const o = await waiterOrder();
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, counter);
    expect(await db.restaurantOrderPayment.findFirstOrThrow({ where: { orderId: o.id } })).toMatchObject({ atCounter: true, handedOverById: null, collectedById: counter.userId });
    const note = await db.restaurantOrderEvent.findFirstOrThrow({ where: { orderId: o.id, note: { startsWith: "Payment received" } } });
    expect(note.note).toMatch(/Restaurant Counter/);
    expect(note.note).not.toMatch(/brought by/);
  });

  it("only a waiter can be named as the one who brought the money — anyone else is refused and nothing is recorded", async () => {
    const counter = await counterActor();
    const role = await db.role.findUniqueOrThrow({ where: { code: "RESTAURANT" } });
    const gone = await db.user.upsert({
      where: { email: "waiter-gone@vegas.test" }, update: { isActive: false, roleId: role.id },
      create: { email: "waiter-gone@vegas.test", fullName: "Former Waiter (test)", roleId: role.id, passwordHash: await hashPassword("Waiter12345"), mustChangePassword: false, isActive: false },
    });
    const o = await waiterOrder();
    for (const someone of [(await chefActor()).userId, (await receptionistActor()).userId, (await managerActor()).userId, counter.userId, gone.id, "no-such-user"]) {
      await expect(recordOrderPayment(o.id, { accountId: "acct_cash", handedOverById: someone }, counter)).rejects.toThrow(/Choose the waiter who brought the money/);
    }
    expect(await db.restaurantOrderPayment.count({ where: { orderId: o.id } })).toBe(0);
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ paymentStatus: "UNPAID", paidAmount: 0 });
  });

  it("on the Counter, the waiter picked from the list makes the order theirs; paid now, the money is the Counter's, brought by that waiter", async () => {
    const [waiter, counter] = [await waiterActor(), await counterActor()];
    await startWaiterShift(waiter);
    const as = await waiterOnCounter(waiter.userId!, { id: counter.userId!, label: "Restaurant Counter" });
    const input = { type: "TAKEAWAY" as const, settlement: "PAY_NOW" as const, accountId: "acct_cash", items: [{ menuItemId: SAFARI, quantity: 2 }] };
    // Picking the waiter never records money as theirs.
    await expect(createRestaurantOrder(input, as, new Date(), { customerPhone: PHONE })).rejects.toThrow(/Restaurant Counter/);

    const o = await createRestaurantOrder(input, as, new Date(), { customerPhone: PHONE, payBy: counter, handedOverById: waiter.userId });
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ assignedToId: waiter.userId, createdById: waiter.userId, settlement: "PAY_NOW", paymentStatus: "PAID", paidAmount: o.total });
    expect(await db.waiterAssignment.findFirst({ where: { orderId: o.id } })).toMatchObject({ kind: "TAKEN", via: "PIN", toUserId: waiter.userId, deviceUserId: counter.userId });
    const pay = await db.restaurantOrderPayment.findFirstOrThrow({ where: { orderId: o.id } });
    expect(pay).toMatchObject({ amount: o.total, atCounter: true, collectedById: counter.userId, handedOverById: waiter.userId, confirmedById: counter.userId });
    expect(pay.confirmedAt).not.toBeNull();
  });

  it("served by the waiter, paid at the Counter in the same step: completed, each responsibility on record", async () => {
    const [waiter, counter] = [await waiterActor(), await counterActor()];
    const o = await waiterOrder("loc_in_3");
    await readyUp(o.id);
    await setOrderStatus(o.id, "DELIVERED", waiter, new Date(), { pay: { accountId: "acct_cash", handedOverById: waiter.userId }, payBy: counter });
    const done = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { payments: true } });
    expect(done).toMatchObject({ status: "COMPLETED", paymentStatus: "PAID", deliveredById: waiter.userId, assignedToId: waiter.userId });
    expect(done.payments).toHaveLength(1);
    expect(done.payments[0]).toMatchObject({ atCounter: true, collectedById: counter.userId, handedOverById: waiter.userId, confirmedById: counter.userId });
    const served = await db.restaurantOrderEvent.findFirstOrThrow({ where: { orderId: o.id, to: "DELIVERED", note: { startsWith: "Served at" } } });
    expect(served.byId).toBe(waiter.userId);
  });
});

describe("paid online: recorded automatically, never collected again", () => {
  const ADDRESS = "Mikocheni B, Plot 45, near the pharmacy";
  const online = async (phone: string, proof?: Awaited<ReturnType<typeof paidOnline>>) =>
    placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Online Payer", phone, kind: "TAKEAWAY", deliveryAddress: ADDRESS, paidFirst: proof ?? await paidOnline() });
  /** As if the restaurant had no Counter account yet: the online order then waits for the check. */
  async function withoutCounter<T>(fn: () => Promise<T>) {
    const screens = await db.user.findMany({ where: { isActive: true, role: { code: "RESTAURANT_SCREEN" } }, select: { id: true } });
    await db.user.updateMany({ where: { id: { in: screens.map((u) => u.id) } }, data: { isActive: false } });
    try { return await fn(); } finally { await db.user.updateMany({ where: { id: { in: screens.map((u) => u.id) } }, data: { isActive: true } }); }
  }

  it("the customer's proof is recorded at once — the Counter's, confirmed, counted once; nobody records it again", async () => {
    const [waiter, counter, desk] = [await waiterActor(), await counterActor(), await receptionistActor()];
    const proof = await paidOnline();
    const o = await online("0754 808 909", proof);
    expect(o).toMatchObject({ paymentProofFileId: proof.proofId, customerPaidToId: proof.accountId, customerPayRef: proof.reference, paymentStatus: "PAID", paidAmount: o.total });
    const pays = await db.restaurantOrderPayment.findMany({ where: { orderId: o.id } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ online: true, atCounter: true, notReceived: false, accountId: proof.accountId, reference: proof.reference, amount: o.total, confirmedByRole: "Automatic — paid online" });
    expect(pays[0].confirmedAt).not.toBeNull();
    // Under the restaurant's Counter account (the official payment station).
    expect((await db.user.findUniqueOrThrow({ where: { id: pays[0].collectedById! }, include: { role: true } })).role.code).toBe("RESTAURANT_SCREEN");

    await expect(recordOrderPayment(o.id, { accountId: proof.accountId }, waiter)).rejects.toThrow(/cannot record payments/);
    for (const who of [counter, desk]) await expect(recordOrderPayment(o.id, { accountId: proof.accountId, reference: proof.reference }, who)).rejects.toThrow(/already paid/);
    const sales = await db.revenueTransaction.findMany({ where: { restaurantOrderId: o.id, isVoided: false } });
    expect(sales.reduce((t, x) => t + x.amount, 0)).toBe(o.total); // counted once
    const events = await db.restaurantOrderEvent.findMany({ where: { orderId: o.id } });
    expect(events.some((e) => /Paid online by the customer .* recorded automatically/.test(e.note ?? ""))).toBe(true);
  });

  it("it is accepted straight away — nobody has to confirm it", async () => {
    const o = await online("0754 808 920");
    await setOrderStatus(o.id, "PREPARING", await chefActor());
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PREPARING");
  });

  it("Payment not received: the payment is taken off (not counted, not a refund) and the order declined — the Counter or reception; never a waiter", async () => {
    const [counter, desk, waiter] = [await counterActor(), await receptionistActor(), await waiterActor()];
    const o = await online("0754 808 911");
    await expect(markPaymentNotReceived(o.id, waiter)).rejects.toThrow(/Counter or reception/);
    await markPaymentNotReceived(o.id, counter);
    const after = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { payments: true } });
    expect(after).toMatchObject({ status: "CANCELLED", paidAmount: 0, paymentStatus: "UNPAID" });
    expect(after.cancelReason).toMatch(/^Payment not received/);
    expect(after.payments[0]).toMatchObject({ status: "REVERSED", notReceived: true, online: true });
    expect(await db.revenueTransaction.count({ where: { restaurantOrderId: o.id, isVoided: false } })).toBe(0);
    await expect(markPaymentNotReceived(o.id, counter)).rejects.toThrow(/already cancelled/);

    // Reception can say so too — while the order is still being made.
    const o2 = await online("0754 808 912");
    await setOrderStatus(o2.id, "PREPARING", await chefActor());
    await markPaymentNotReceived(o2.id, desk);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o2.id } })).status).toBe("CANCELLED");

    // Once it is ready it can no longer be declined (a manager reverses the payment instead).
    const o3 = await online("0754 808 913");
    await readyUp(o3.id);
    await expect(markPaymentNotReceived(o3.id, counter)).rejects.toThrow(/already ready/);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o3.id } })).paymentStatus).toBe("PAID");
  });

  it("declined with the reason Payment not received: not received, not a refund; declined for another reason: it was paid — a refund", async () => {
    const counter = await counterActor();
    const a = await online("0754 808 914");
    await declineRestaurantOrder(a.id, "Payment not received", [], counter);
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: a.id }, include: { payments: true } })).toMatchObject({ status: "CANCELLED", paymentStatus: "UNPAID", payments: [{ notReceived: true, status: "REVERSED" }] });
    const b = await online("0754 808 915");
    await declineRestaurantOrder(b.id, "Out of stock", [], counter);
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: b.id }, include: { payments: true } })).toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED", payments: [{ notReceived: false, status: "REVERSED" }] });
  });

  it("no Counter account yet: still recorded automatically (under an account that records payments) — never left to type in", async () => {
    const chef = await chefActor();
    const o = await withoutCounter(() => online("0754 808 916"));
    expect(o).toMatchObject({ paymentStatus: "PAID", paidAmount: o.total });
    const p = await db.restaurantOrderPayment.findFirstOrThrow({ where: { orderId: o.id } });
    expect(p).toMatchObject({ online: true, status: "POSTED", collectedById: null }); // never credited to a person
    expect(p.confirmedAt).not.toBeNull();
    await setOrderStatus(o.id, "PREPARING", chef);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PREPARING");
  });
});
