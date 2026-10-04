import { randomInt } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { onlinePayStates, setOrderStatus } from "@/server/services/restaurant";
import { placeOnlineOrder } from "@/server/services/online-orders";
import { addItemsByTrackToken } from "@/server/services/restaurant-locations";
import { placeStayOrder } from "@/server/services/guest-comms";
import { ONLINE_RECORDER_ID } from "@/server/services/mobile-payments";
import {
  assertCanPayOnline, cancelCustomerPayment, customerPaymentByToken, livePaymentForOrder, onlinePayAvailable, payForNewOrder, payOrderOnline, retryCustomerPayment,
} from "@/server/services/online-pay";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { chefActor, managerActor, resetBusinessData, roomType } from "../support/helpers";

/**
 * PAY ONLINE (owner, 2026-10-04): the customer's own online payment, nTZS underneath — the order waits for it, the
 * amount is the server's, the same press twice is one payment, and "paid" is shown only once nTZS confirmed it.
 * nTZS is faked here (no real money).
 */
const TZ = "Africa/Dar_es_Salaam";
const BEER = "mi_beers_safari";
const ENV = { key: process.env.NTZS_API_KEY, secret: process.env.NTZS_WEBHOOK_SECRET };
const key = () => Array.from({ length: 32 }, () => "0123456789abcdef"[randomInt(16)]).join("");
// Fresh numbers and addresses every run: the per-phone / per-address limits are kept between runs.
const phone = () => `07${randomInt(10_000_000, 99_999_999)}`;
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
const today = () => businessDateOf(new Date());

let deposits: Record<string, { status: string; amountTzs: number }> = {};
let sent: Record<string, unknown>[] = [];

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: BEER }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({
    data: { publicOrderingEnabled: true, onlinePayEnabled: true, onlinePayRestaurant: true, onlinePayRoomService: true, onlinePayStayBill: true, onlinePayBooking: true },
  });
  process.env.NTZS_API_KEY = "ntzs_test_unit";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
  deposits = {}; sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/deposits") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      sent.push(body);
      const id = `dep_${sent.length}`;
      deposits[id] = { status: "submitted", amountTzs: body.amountTzs };
      return new Response(JSON.stringify({ id, status: "submitted", amountTzs: body.amountTzs, paymentMethod: "mobile_money" }), { status: 201 });
    }
    const m = url.match(/\/deposits\/([^/?]+)$/);
    if (m && deposits[m[1]]) return new Response(JSON.stringify({ id: m[1], ...deposits[m[1]], pspReference: "MP777ABC" }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404 });
  });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  process.env.NTZS_API_KEY = ENV.key; process.env.NTZS_WEBHOOK_SECRET = ENV.secret;
  if (ENV.key === undefined) delete process.env.NTZS_API_KEY;
  if (ENV.secret === undefined) delete process.env.NTZS_WEBHOOK_SECRET;
  await db.hotelSettings.updateMany({ data: { onlinePayEnabled: true, onlinePayRestaurant: true, onlinePayRoomService: true } });
  await resetBusinessData();
});

/** The customer orders from the website with Pay online, and the payment request goes. */
async function orderPayingOnline(kind: "DINE_IN" | "TAKEAWAY" = "DINE_IN") {
  const k = key(), p = phone();
  const order = await placeOnlineOrder({
    clientKey: k, items: [{ menuItemId: BEER, quantity: 2 }], name: "Asha Online", phone: p, kind, payOnline: true,
    deliveryAddress: kind === "TAKEAWAY" ? "Mikocheni B, Plot 45, near the pharmacy" : null,
  });
  const started = await payForNewOrder(order, { phone: p, clientKey: k, ip: ip() });
  return { order, phone: p, clientKey: k, token: started.pay! };
}

const depositOf = async (token: string) => (await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: token } })).depositId!;

describe("restaurant: Pay online", () => {
  it("the order waits for the payment; paid only once nTZS confirms it — recorded once, by the system, into the nTZS account", async () => {
    const { order, clientKey, phone: p, token } = await orderPayingOnline();
    expect(order.payOnlineAt).not.toBeNull();
    expect(order.settlement).toBe("UNPAID");
    expect(order.paymentProofFileId).toBeNull();
    expect(token).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ amountTzs: order.total, paymentMethod: "mobile_money" });

    // The same "Place order" pressed twice: the same order and the same payment — no second prompt.
    const again = await placeOnlineOrder({ clientKey, items: [{ menuItemId: BEER, quantity: 2 }], name: "Asha Online", phone: p, kind: "DINE_IN", payOnline: true });
    expect(again.id).toBe(order.id);
    expect((await payForNewOrder(again, { phone: p, clientKey, ip: ip() })).pay).toBe(token);
    expect(sent).toHaveLength(1);

    // While it is on its way: the kitchen waits, nothing is added, the order page links to it.
    expect((await onlinePayStates([order])).get(order.id)).toBe("PAYING");
    await expect(setOrderStatus(order.id, "PREPARING", await chefActor())).rejects.toThrow(/paying this order online/);
    await expect(addItemsByTrackToken(order.trackToken!, [{ menuItemId: BEER, quantity: 1 }])).rejects.toThrow(/still on its way/);
    expect(await livePaymentForOrder(order.trackToken!)).toBe(token);

    // Waiting is never "paid".
    const waiting = await customerPaymentByToken(token, { check: true });
    expect(waiting).toMatchObject({ status: "PENDING", amount: order.total, canCancel: true, canRetry: false, receipt: null });
    expect(waiting!.phone).not.toContain(p.slice(3, 9));

    // nTZS confirms: the page says paid, the order is paid, the kitchen can start.
    deposits[await depositOf(token)].status = "completed";
    await db.mobilePayment.updateMany({ where: { publicToken: token }, data: { lastCheckedAt: null } });
    const paid = await customerPaymentByToken(token, { check: true });
    expect(paid).toMatchObject({ status: "PAID", amount: order.total });
    expect(paid!.receipt).toBe(`/order/${order.trackToken}/receipt`);
    const o = await db.restaurantOrder.findUniqueOrThrow({ where: { id: order.id }, include: { payments: { include: { account: true } } } });
    expect(o.paymentStatus).toBe("PAID");
    expect(o.payments).toHaveLength(1);
    expect(o.payments[0]).toMatchObject({ amount: order.total, collectedById: ONLINE_RECORDER_ID, status: "POSTED" });
    expect(o.payments[0].account.code).toBe("NTZS");
    expect((await onlinePayStates([o])).size).toBe(0);
    await expect(setOrderStatus(order.id, "PREPARING", await chefActor())).resolves.toBeTruthy();

    // Asked again later (a refresh, the scheduled run): still one payment.
    await customerPaymentByToken(token, { check: true });
    expect(await db.restaurantOrderPayment.count({ where: { orderId: order.id } })).toBe(1);
    await expect(payOrderOnline(order.trackToken!, { phone: p, clientKey: key(), ip: ip() })).rejects.toThrow(/already paid/);
  });

  it("not paid: eating here goes ahead (pay later); take out keeps waiting — Try again asks for what is due", async () => {
    const dine = await orderPayingOnline("DINE_IN");
    deposits[await depositOf(dine.token)].status = "failed";
    const failed = await customerPaymentByToken(dine.token, { check: true });
    expect(failed).toMatchObject({ status: "FAILED", canRetry: true });
    expect(failed!.message).toMatch(/still goes ahead/);
    expect((await onlinePayStates([dine.order])).size).toBe(0);
    await expect(setOrderStatus(dine.order.id, "PREPARING", await chefActor())).resolves.toBeTruthy();
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: dine.order.id } })).paymentStatus).toBe("UNPAID");

    const out = await orderPayingOnline("TAKEAWAY");
    await cancelCustomerPayment(out.token);
    const stopped = await customerPaymentByToken(out.token);
    expect(stopped).toMatchObject({ status: "CANCELLED", canRetry: true });
    expect(stopped!.message).toMatch(/once it is paid/);
    expect((await onlinePayStates([out.order])).get(out.order.id)).toBe("NOT_PAID");
    await expect(setOrderStatus(out.order.id, "PREPARING", await chefActor())).rejects.toThrow(/not paid yet/);

    const retry = await retryCustomerPayment(out.token, { clientKey: key(), ip: ip() });
    expect(retry.token).not.toBe(out.token);
    const mp = await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: retry.token } });
    expect(mp.amount).toBe(out.order.total);
    expect(mp.orderIds).toEqual([out.order.id]);
    expect((await onlinePayStates([out.order])).get(out.order.id)).toBe("PAYING");
  });

  it("switched off — everywhere or for the restaurant only — Pay online is not offered and nothing starts", async () => {
    await db.hotelSettings.updateMany({ data: { onlinePayRestaurant: false } });
    expect(await onlinePayAvailable("restaurant")).toBe(false);
    expect(await onlinePayAvailable("roomService")).toBe(true);
    await expect(assertCanPayOnline("restaurant", "0712 345 678")).rejects.toThrow(/not available/);

    await db.hotelSettings.updateMany({ data: { onlinePayRestaurant: true, onlinePayEnabled: false } });
    expect(await onlinePayAvailable("roomService")).toBe(false);
    await expect(assertCanPayOnline("roomService", "0712 345 678")).rejects.toThrow(/not available/);

    await db.hotelSettings.updateMany({ data: { onlinePayEnabled: true } });
    await expect(assertCanPayOnline("restaurant", "0222 123 456")).rejects.toThrow(/mobile-money number/);
    delete process.env.NTZS_API_KEY;
    expect(await onlinePayAvailable("restaurant")).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe("room service: Pay online or Bill to my room", () => {
  it("paid online stays off the room bill; billed to the room is unchanged", async () => {
    const mgr = await managerActor();
    const st = await roomType("STANDARD");
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Rehema Stay", phone: phone() }, stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 2) },
      rooms: [{ roomTypeId: st.id, roomId: st.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgr, zonedInstant(addDays(today(), -1), 12 * 60, TZ));
    await checkIn(r.id, mgr, null, new Date());
    const stay = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });

    const k = key();
    const online = await placeStayOrder(stay.guestToken!, { items: [{ menuItemId: BEER, quantity: 1 }], clientKey: k, payOnline: true });
    expect(online).toMatchObject({ type: "ROOM_SERVICE", settlement: "UNPAID" });
    expect(online.payOnlineAt).not.toBeNull();
    expect(await db.reservationCharge.count({ where: { restaurantOrderId: online.id } })).toBe(0);
    const pay = await payForNewOrder(online, { phone: phone(), clientKey: k, ip: ip() });
    expect(pay.pay).toBeTruthy();
    expect((await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: pay.pay! } })).source).toBe("GUEST_LINK");

    const billed = await placeStayOrder(stay.guestToken!, { items: [{ menuItemId: BEER, quantity: 1 }], clientKey: key() });
    expect(billed.settlement).toBe("ROOM");
    expect(billed.payOnlineAt).toBeNull();
    expect(await db.reservationCharge.count({ where: { restaurantOrderId: billed.id, isVoided: false } })).toBeGreaterThan(0);
  });
});

describe("the system account", () => {
  it("records online payments but is not a person: it cannot sign in", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { id: ONLINE_RECORDER_ID }, include: { role: true } });
    expect(u.isActive).toBe(false);
    expect(u.role.code).toBe("SYSTEM_ONLINE");
    expect(u.passwordHash.startsWith("$")).toBe(false);
  });
});
