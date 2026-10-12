import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { checkIn, checkOut, createReservation, overstayDue } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { createRestaurantOrder, orderBill } from "@/server/services/restaurant";
import { stayBill } from "@/server/services/stay-bill";
import { guestAccountName } from "@/lib/pay-account";
import { cancelMobilePayment, checkMobilePayment, mobilePaymentsNeedingAttention, requestMobilePayment, resolveMobilePaymentAttention, settleMobilePayment, sweepMobilePayments } from "@/server/services/mobile-payments";
import { resolveAccountTx } from "@/server/services/payment-accounts";
import { ntzsPhone, verifyNtzsWebhook } from "@/server/services/ntzs";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { counterActor, managerActor as anyManager, receptionistActor as anyReceptionist, resetBusinessData, roomType, waiterActor } from "../support/helpers";

/**
 * nTZS mobile-money collections (owner, 2026-10-04): reception sends a prompt for a guest's bill, the Counter for an
 * order; the customer approves on their phone; nTZS confirms and the payment is recorded by itself — once — into the
 * nTZS account. nTZS itself is faked here (no real money).
 */
const TZ = "Africa/Dar_es_Salaam";
const BEER = "mi_beers_safari";
const today = () => businessDateOf(new Date());
const signed = <T extends { userId?: string | null }>(a: T) => ({ ...a, userId: a.userId! });
const ENV = { key: process.env.NTZS_API_KEY, secret: process.env.NTZS_WEBHOOK_SECRET };

let deposits: Record<string, { status: string; amountTzs: number }> = {};
let sent: Record<string, unknown>[] = [];
let failNext: { status: number; body: unknown } | null = null;

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: BEER }, data: { isAvailable: true, isActive: true } });
  await db.restaurantLocation.updateMany({ data: { waiterId: null, isActive: true, blockedAs: null } });
  process.env.NTZS_API_KEY = "ntzs_test_unit";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
  deposits = {}; sent = []; failNext = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (failNext) { const f = failNext; failNext = null; return new Response(JSON.stringify(f.body), { status: f.status }); }
    if (url.endsWith("/deposits") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      sent.push(body);
      const id = `dep_${sent.length}`;
      deposits[id] = { status: "submitted", amountTzs: body.amountTzs };
      return new Response(JSON.stringify({ id, status: "submitted", amountTzs: body.amountTzs, paymentMethod: "mobile_money", instructions: "Check your phone" }), { status: 201 });
    }
    const m = url.match(/\/deposits\/([^/?]+)$/);
    if (m && deposits[m[1]]) return new Response(JSON.stringify({ id: m[1], ...deposits[m[1]], pspReference: "MP123XYZ" }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404 });
  });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  process.env.NTZS_API_KEY = ENV.key; process.env.NTZS_WEBHOOK_SECRET = ENV.secret;
  if (ENV.key === undefined) delete process.env.NTZS_API_KEY;
  if (ENV.secret === undefined) delete process.env.NTZS_WEBHOOK_SECRET;
  await resetBusinessData();
});

async function stayOwing(name: string) {
  const dd = await roomType("DOUBLE_DELUXE");
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: name, phone: "0712 555 001" }, stay: { kind: "overnight", arrivalDate: addDays(today(), -1), departureDate: addDays(today(), 2) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await anyManager(), zonedInstant(addDays(today(), -3), 12 * 60, TZ));
  await checkIn(r.id, await anyManager(), null, zonedInstant(addDays(today(), -1), 15 * 60, TZ));
  return db.reservation.findUniqueOrThrow({ where: { id: r.id } });
}

describe("phone numbers and webhook signatures", () => {
  it("phones become nTZS's 255… form; anything else is refused", () => {
    expect(ntzsPhone("0712 345 678")).toBe("255712345678");
    expect(ntzsPhone("+255 712 345 678")).toBe("255712345678");
    expect(ntzsPhone("712345678")).toBe("255712345678");
    expect(ntzsPhone("0222 123 456")).toBeNull();
    expect(ntzsPhone("12345")).toBeNull();
  });

  it("only a recent, correctly signed webhook is genuine (timestamp in seconds or milliseconds)", () => {
    const body = JSON.stringify({ type: "deposit.completed", data: { depositId: "dep_1" } });
    const now = Date.now();
    const sign = (ts: string) => createHmac("sha256", "whsec_unit").update(`${ts}.${body}`).digest("hex");
    const sec = String(Math.floor(now / 1000)), ms = String(now);
    expect(verifyNtzsWebhook(body, sign(sec), sec, now)).toBe(true);
    expect(verifyNtzsWebhook(body, sign(ms), ms, now)).toBe(true);
    expect(verifyNtzsWebhook(body, sign(sec).replace(/.$/, (c) => (c === "0" ? "1" : "0")), sec, now)).toBe(false);
    expect(verifyNtzsWebhook(`${body} `, sign(sec), sec, now)).toBe(false);
    const old = String(Math.floor((now - 20 * 60_000) / 1000));
    expect(verifyNtzsWebhook(body, sign(old), old, now)).toBe(false);
    expect(verifyNtzsWebhook(body, null, sec, now)).toBe(false);
  });
});

describe("a guest's bill", () => {
  it("reception sends the prompt; nTZS confirms; the payment is recorded once into the nTZS account, as reception's", async () => {
    const r = await stayOwing("Mobile Guest");
    const recep = signed(await anyReceptionist());
    const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 50_000 }, "0712 555 001", recep);
    expect(mp).toMatchObject({ status: "PENDING", depositId: "dep_1", phone: "255712555001", amount: 50_000 });
    expect(sent[0]).toMatchObject({ amountTzs: 50_000, paymentMethod: "mobile_money", phoneNumber: "255712555001", collectToTreasury: true, externalReference: mp.id });

    const first = await settleMobilePayment(mp.id, { received: 50_000, pspReference: "MP123XYZ", source: "webhook" });
    expect(first.recorded).toBe(true);
    // nTZS repeats the webhook, and the waiting screen asks too: still one payment.
    const again = await settleMobilePayment(mp.id, { received: 50_000, source: "webhook" });
    expect(again.recorded).toBe(false);
    const payments = await db.payment.findMany({ where: { reservationId: r.id }, include: { account: true, method: true } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amount: 50_000, recordedById: recep.userId, reference: "nTZS MP123XYZ" });
    expect(payments[0].account.code).toBe("NTZS");
    expect(payments[0].method.code).toBe("NTZS");
    // The books name the account after nTZS; the guest's own bill says how they paid, in plain words.
    expect(payments[0].account.name).toBe("nTZS · Mobile money (phone)");
    expect((await stayBill(r.id))!.payments.map((p) => p.account)).toEqual(["Mobile money (phone)"]);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).paidAmount).toBe(50_000);
    expect(await db.mobilePayment.findUniqueOrThrow({ where: { id: mp.id } })).toMatchObject({ status: "COMPLETED", paymentId: payments[0].id });
  });

  it("refuses: more than owed, under TZS 500, a bad number, a second prompt while one waits", async () => {
    const r = await stayOwing("Careful Guest");
    const recep = signed(await anyReceptionist());
    await expect(requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: r.balanceAmount + 1 }, "0712 555 001", recep)).rejects.toThrow(/more than the guest owes/);
    await expect(requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 400 }, "0712 555 001", recep)).rejects.toThrow(/start at TZS 500/);
    await expect(requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 10_000 }, "0222 123 456", recep)).rejects.toThrow(/mobile-money number/);
    await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 10_000 }, "0712 555 001", recep);
    await expect(requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 10_000 }, "0712 555 001", recep)).rejects.toThrow(/already waiting/);
  });

  it("never records more than is still owed — the rest is flagged, not lost", async () => {
    const r = await stayOwing("Paid Twice Guest");
    const recep = signed(await anyReceptionist());
    const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: r.balanceAmount }, "0712 555 001", recep);
    // Meanwhile the guest paid part in cash.
    await recordReservationPayment({ reservationId: r.id, amount: 30_000, accountId: "acct_cash" }, recep);
    await settleMobilePayment(mp.id, { received: r.balanceAmount, source: "webhook" });
    const after = await db.mobilePayment.findUniqueOrThrow({ where: { id: mp.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.lastError).toMatch(/TZS 30,000 more than/);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).balanceAmount).toBe(0);
  });

  it("the waiting screen / scheduled run asks nTZS: completed is recorded, failed is marked; a cancelled prompt that is paid after all is still recorded", async () => {
    const r = await stayOwing("Polling Guest");
    const recep = signed(await anyReceptionist());
    const a = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 20_000 }, "0712 555 001", recep);
    deposits[a.depositId!].status = "failed";
    expect((await checkMobilePayment(a.id)).status).toBe("FAILED");

    const b = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 20_000 }, "0712 555 001", recep);
    await cancelMobilePayment(b.id, recep);
    deposits[b.depositId!].status = "completed";
    // Old enough for the scheduled run to look at it.
    await db.mobilePayment.update({ where: { id: b.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const sweep = await sweepMobilePayments(new Date());
    expect(sweep.checked).toBeGreaterThanOrEqual(1);
    expect(await db.mobilePayment.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "COMPLETED" });
    expect(await db.payment.count({ where: { reservationId: r.id } })).toBe(1);
  });

  it("when nTZS refuses the prompt, it is marked failed with nTZS's reason", async () => {
    const r = await stayOwing("Refused Guest");
    failNext = { status: 400, body: { error: { code: "invalid_phone", message: "bad phone" } } };
    await expect(requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 10_000 }, "0712 555 001", signed(await anyReceptionist()))).rejects.toThrow(/not a Tanzanian mobile-money number/);
    expect(await db.mobilePayment.findFirstOrThrow({ where: { reservationId: r.id } })).toMatchObject({ status: "FAILED" });
  });
});

/** A guest still in the room a night past the planned check-out, with everything on the bill paid. */
async function stayedPast(name: string) {
  const dd = await roomType("DOUBLE_DELUXE");
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: name, phone: "0712 555 001" }, stay: { kind: "overnight", arrivalDate: addDays(today(), -3), departureDate: addDays(today(), -1) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await anyManager(), zonedInstant(addDays(today(), -5), 12 * 60, TZ));
  await checkIn(r.id, await anyManager(), null, zonedInstant(addDays(today(), -3), 15 * 60, TZ));
  const owed = (await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).balanceAmount;
  await recordReservationPayment({ reservationId: r.id, amount: owed, accountId: "acct_cash" }, signed(await anyReceptionist()));
  return db.reservation.findUniqueOrThrow({ where: { id: r.id } });
}

describe("at check-out: the nights past the planned check-out (owner, 2026-10-12)", () => {
  it("the prompt may ask for them; when the money comes they go on the bill and the payment is recorded — once", async () => {
    const r = await stayedPast("Late Guest");
    expect(r.balanceAmount).toBe(0);
    const due = await overstayDue(r.id);
    expect(due.nights).toBe(1);
    expect(due.amount).toBeGreaterThan(0);
    // Working it out wrote nothing.
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).netAmount).toBe(r.netAmount);

    const recep = signed(await anyReceptionist());
    await expect(requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: due.balance + 1 }, "0712 555 001", recep)).rejects.toThrow(/more than the guest owes/);
    // The guest's own pay page asks only for what is on the bill.
    await expect(requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: due.balance }, "0712 555 001", null)).rejects.toThrow(/Nothing is owed/);
    const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: due.balance }, "0712 555 001", recep);
    expect(mp).toMatchObject({ status: "PENDING", amount: due.amount, overstayAmount: due.amount });
    // Nothing on the bill until the money comes.
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).netAmount).toBe(r.netAmount);

    expect((await settleMobilePayment(mp.id, { received: due.amount, pspReference: "MPLATE1", source: "webhook" })).recorded).toBe(true);
    expect((await settleMobilePayment(mp.id, { received: due.amount, source: "webhook" })).recorded).toBe(false);
    const paid = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(paid).toMatchObject({ netAmount: r.netAmount + due.amount, paidAmount: r.paidAmount + due.amount, balanceAmount: 0, status: "CHECKED_IN" });
    expect(await db.payment.count({ where: { reservationId: r.id, reference: "nTZS MPLATE1" } })).toBe(1);
    expect((await db.mobilePayment.findUniqueOrThrow({ where: { id: mp.id } })).lastError).toBeNull();

    // The check-out finds the nights already on the bill and adds none.
    await checkOut(r.id, await anyManager());
    expect(await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ netAmount: r.netAmount + due.amount, balanceAmount: 0, status: "CHECKED_OUT" });
  });

  it("the guest paid cash and left before the phone money came: it is flagged, not lost, and nothing is charged twice", async () => {
    const r = await stayedPast("Cash First Guest");
    const due = await overstayDue(r.id);
    const recep = signed(await anyReceptionist());
    const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: due.balance }, "0712 555 001", recep);
    await checkOut(r.id, await anyManager(), { payment: { amount: due.balance, accountId: "acct_cash" } });
    await settleMobilePayment(mp.id, { received: due.amount, source: "webhook" });
    const after = await db.mobilePayment.findUniqueOrThrow({ where: { id: mp.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.lastError).toMatch(/more than/);
    expect(await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ netAmount: r.netAmount + due.amount, balanceAmount: 0, status: "CHECKED_OUT" });
  });

  it("a guest who has not stayed past the check-out: the prompt is still only for what is on the bill", async () => {
    const r = await stayOwing("On Time Guest");
    const recep = signed(await anyReceptionist());
    await expect(requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: r.balanceAmount + 1 }, "0712 555 001", recep)).rejects.toThrow(/more than the guest owes/);
    const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: r.balanceAmount }, "0712 555 001", recep);
    expect(mp.overstayAmount).toBeNull();
  });
});

describe("restaurant orders", () => {
  it("the Counter sends the prompt for an order; once confirmed the order is paid into the nTZS account (income lines too)", async () => {
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_1", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 2 }] }, await waiterActor(), new Date(), { customerPhone: "0712 555 777" });
    const counter = signed(await counterActor());
    const mp = await requestMobilePayment({ purpose: "RESTAURANT", orderIds: [o.id] }, "0712 555 777", counter);
    expect(mp.amount).toBe(o.total);
    await settleMobilePayment(mp.id, { received: o.total, source: "webhook" });
    const paid = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { payments: { include: { account: true } } } });
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]).toMatchObject({ amount: o.total, confirmedByRole: "Automatic — nTZS mobile money" });
    expect(paid.payments[0].account.code).toBe("NTZS");
    // …and so does the guest's receipt.
    expect((await orderBill(o.id, "order"))!.orders.flatMap((x) => x.payments.map((p) => guestAccountName(p.account)))).toEqual(["Mobile money (phone)"]);
    const sales = await db.revenueTransaction.findMany({ where: { restaurantOrderId: o.id, isVoided: false }, include: { account: true } });
    expect(sales.reduce((t, x) => t + x.amount, 0)).toBe(o.total);
    expect(sales.every((x) => x.account.code === "NTZS")).toBe(true);
    // Paid already: no second prompt.
    await expect(requestMobilePayment({ purpose: "RESTAURANT", orderIds: [o.id] }, "0712 555 777", counter)).rejects.toThrow(/already paid/);
  });

  it("an order changed since the prompt is not paid with too little money — the money is flagged", async () => {
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_2", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, await waiterActor(), new Date(), { customerPhone: "0712 555 778" });
    const mp = await requestMobilePayment({ purpose: "RESTAURANT", orderIds: [o.id] }, "0712 555 778", signed(await counterActor()));
    await settleMobilePayment(mp.id, { received: mp.amount - 100, source: "webhook" });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe("UNPAID");
    expect((await db.mobilePayment.findUniqueOrThrow({ where: { id: mp.id } })).lastError).toMatch(/no longer matched/);
  });
});

describe("safety (review, 2026-10-04)", () => {
  it("a Cancel that lands after the payment was recorded never leads to a second recording", async () => {
    const r = await stayOwing("Race Guest");
    const recep = signed(await anyReceptionist());
    const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 40_000 }, "0712 555 001", recep);
    await settleMobilePayment(mp.id, { received: 40_000, source: "webhook" });
    // The receptionist's Cancel arrives afterwards: it does nothing to a recorded prompt.
    expect((await cancelMobilePayment(mp.id, recep)).status).toBe("COMPLETED");
    // Even a row someone forced back (old data): settle sees the payment and does not record it again.
    await db.mobilePayment.update({ where: { id: mp.id }, data: { status: "CANCELLED" } });
    deposits[mp.depositId!].status = "completed";
    await db.mobilePayment.update({ where: { id: mp.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    await sweepMobilePayments(new Date());
    expect(await db.payment.count({ where: { reservationId: r.id } })).toBe(1);
  });

  it("money that cannot go on the bill is kept as received and listed for a person — not retried forever", async () => {
    const r = await stayOwing("Settled Guest");
    const recep = signed(await anyReceptionist());
    const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: 30_000 }, "0712 555 001", recep);
    // The guest paid everything in cash meanwhile: nothing left to put this on.
    await recordReservationPayment({ reservationId: r.id, amount: r.balanceAmount, accountId: "acct_cash" }, recep);
    await settleMobilePayment(mp.id, { received: 30_000, source: "webhook" });
    const after = await db.mobilePayment.findUniqueOrThrow({ where: { id: mp.id } });
    expect(after).toMatchObject({ status: "COMPLETED", paymentId: null });
    expect(after.attentionAt).not.toBeNull();
    const list = await mobilePaymentsNeedingAttention();
    expect(list.map((x) => x.id)).toContain(mp.id);
    await resolveMobilePaymentAttention(mp.id, "Refunded to the guest by M-Pesa", recep);
    expect((await mobilePaymentsNeedingAttention()).map((x) => x.id)).not.toContain(mp.id);
  });

  it("the nTZS account is never reachable by hand — not for a payment, not for an expense", async () => {
    await expect(resolveAccountTx(db, { accountId: "acct_ntzs" })).rejects.toThrow(/does not receive payments/);
    await expect(resolveAccountTx(db, { methodId: "pm_ntzs" })).rejects.toThrow(/moves only when nTZS confirms/);
    await expect(resolveAccountTx(db, { methodId: "pm_ntzs" }, "expenses")).rejects.toThrow(/moves only when nTZS confirms/);
    expect((await resolveAccountTx(db, { methodId: "pm_ntzs" }, "payments", { internal: true })).account.code).toBe("NTZS");
  });
});

