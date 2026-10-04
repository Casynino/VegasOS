import { randomInt } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { onlinePayStates, setOrderStatus } from "@/server/services/restaurant";
import { placeOnlineOrder } from "@/server/services/online-orders";
import { addItemsByTrackToken, placeLocationOrder } from "@/server/services/restaurant-locations";
import { seatAtTable } from "@/server/services/dining-sessions";
import { placeStayOrder } from "@/server/services/guest-comms";
import { createWebsiteBooking } from "@/server/services/public-booking";
import { createWebsiteMeetingBooking } from "@/server/services/booking-requests";
import { expireUnpaidHolds } from "@/server/services/booking-holds";
import { createTransportRequest } from "@/server/services/transport";
import { createManualInvoice, issueInvoice } from "@/server/services/invoices";
import { customerOnlinePayments, onlinePaymentTotals, onlinePayments, reconcileOnlinePayments } from "@/server/services/online-payments-admin";
import { paymentsByMethod } from "@/server/services/finance";
import { ONLINE_RECORDER_ID, sweepMobilePayments } from "@/server/services/mobile-payments";
import { createHmac } from "node:crypto";
import { POST as ntzsWebhook } from "@/app/api/webhooks/ntzs/route";
import {
  assertCanPayOnline, payTableBillOnline, tableBillPayOnline, bookAndPayOnline, invoicePayOnline, payInvoiceOnline, payStayBillOnline, payTripOnline, stayBillPayOnline, tripForCustomer, bookingPayOnline, cancelCustomerPayment, ONLINE_BOOKING_HOLD_MINUTES, payBookingOnline, customerPaymentByToken, livePaymentForOrder, onlinePayAvailable, payForNewOrder, payOrderOnline, retryCustomerPayment,
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
/** nTZS's GET answer wrapped ({ data: … }) instead of at the top level. */
let wrapGet = false;

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: BEER }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({
    data: { publicOrderingEnabled: true, onlinePayEnabled: true, onlinePayRestaurant: true, onlinePayRoomService: true, onlinePayStayBill: true, onlinePayBooking: true, onlinePayMeeting: true, onlinePayTransport: true, onlinePayInvoices: true },
  });
  process.env.NTZS_API_KEY = "ntzs_test_unit";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
  deposits = {}; sent = []; wrapGet = false;
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
    if (m && deposits[m[1]]) {
      const d = { id: m[1], ...deposits[m[1]], pspReference: "MP777ABC" };
      return new Response(JSON.stringify(wrapGet ? { data: d } : d), { status: 200 });
    }
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

describe("at a table: Pay my bill online", () => {
  it("everything due at the table in one payment — each order paid once nTZS confirms", async () => {
    const table = await db.restaurantLocation.findFirstOrThrow({ where: { kind: "TABLE", isActive: true, qrActive: true }, orderBy: { number: "asc" } });
    const p = phone();
    const seat = await seatAtTable(table.qrToken, { name: "Table Payer", phone: p }, null);
    const a = await placeLocationOrder(table.qrToken, { clientKey: key(), items: [{ menuItemId: BEER, quantity: 1 }], seatToken: seat.token });
    const b = await placeLocationOrder(table.qrToken, { clientKey: key(), items: [{ menuItemId: BEER, quantity: 2 }], seatToken: seat.token });
    expect(await tableBillPayOnline(seat.token)).toEqual({ offered: true, live: null });
    expect(await tableBillPayOnline("not-my-seat-token-at-all-000")).toEqual({ offered: false, live: null });

    const pay = await payTableBillOnline(seat.token, { phone: p, clientKey: key(), ip: ip() });
    const mp = await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: pay.token } });
    expect(mp.amount).toBe(a.total + b.total);
    expect(new Set(mp.orderIds)).toEqual(new Set([a.id, b.id]));
    expect((await tableBillPayOnline(seat.token)).live).toBe(pay.token);
    expect((await nTzsConfirms(pay.token))!.status).toBe("PAID");
    const orders = await db.restaurantOrder.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(orders.every((o) => o.paymentStatus === "PAID")).toBe(true);
    expect(await tableBillPayOnline(seat.token)).toEqual({ offered: false, live: null });
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

/** A room booked on the website with Pay online (held while the guest pays). */
async function bookOnline(days: number, clientKey = key()) {
  const p = phone();
  const sel = { checkIn: addDays(today(), days), checkOut: addDays(today(), days + 2), adults: 2, children: 0, typeSlug: "double-deluxe", rooms: 1 };
  const r = await bookAndPayOnline({
    service: "booking", phone: p, clientKey, ip: ip(),
    create: () => createWebsiteBooking(sel, { fullName: "Website Guest", phone: p }, "10.9.9.9", null, { holdMinutes: ONLINE_BOOKING_HOLD_MINUTES }),
  });
  const mp = r.pay ? await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: r.pay } }) : null;
  return { ...r, phone: p, clientKey, reservationId: mp?.reservationId ?? null };
}

describe("room booking and the meeting room: Pay online", () => {
  it("the booking is held while the guest pays; the payment confirms it — the whole amount, recorded once", async () => {
    const b = await bookOnline(10);
    expect(b.pay).toBeTruthy();
    const held = await db.reservation.findUniqueOrThrow({ where: { id: b.reservationId! } });
    expect(held.status).toBe("RESERVED");
    expect(held.holdUntil!.getTime() - Date.now()).toBeGreaterThan(25 * 60_000);
    expect(held.holdUntil!.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    expect(sent[0]).toMatchObject({ amountTzs: held.balanceAmount });

    // The same press again: the same booking, the same payment.
    const again = await bookAndPayOnline({ service: "booking", phone: b.phone, clientKey: b.clientKey, ip: ip(), create: () => { throw new Error("must not book twice"); } });
    expect(again.pay).toBe(b.pay);
    expect(await db.reservation.count()).toBe(1);

    const waiting = await customerPaymentByToken(b.pay!, { check: true });
    expect(waiting).toMatchObject({ status: "PENDING" });
    expect(waiting!.back!.href).toContain(`/booking/${held.reference}?token=`);

    deposits[await depositOf(b.pay!)].status = "completed";
    await db.mobilePayment.updateMany({ where: { publicToken: b.pay! }, data: { lastCheckedAt: null } });
    const paid = await customerPaymentByToken(b.pay!, { check: true });
    expect(paid).toMatchObject({ status: "PAID", amount: held.balanceAmount });
    const r = await db.reservation.findUniqueOrThrow({ where: { id: held.id }, include: { payments: { include: { account: true } } } });
    expect(r.status).toBe("CONFIRMED");
    expect(r.holdUntil).toBeNull();
    expect(r.balanceAmount).toBe(0);
    expect(r.payments).toHaveLength(1);
    expect(r.payments[0]).toMatchObject({ amount: held.balanceAmount, recordedById: ONLINE_RECORDER_ID, status: "POSTED" });
    expect(r.payments[0].account!.code).toBe("NTZS");
    // Nothing left to pay: the booking page offers no payment.
    expect((await bookingPayOnline(r.reference, r.manageToken)).offered).toBe(false);
  });

  it("not paid: the room is kept while a payment is on its way, then released — Try again says so", async () => {
    const b = await bookOnline(12);
    const id = b.reservationId!;
    await db.reservation.update({ where: { id }, data: { holdUntil: new Date(Date.now() - 60_000) } });
    await expireUnpaidHolds();
    expect((await db.reservation.findUniqueOrThrow({ where: { id } })).status).toBe("RESERVED"); // still paying

    await cancelCustomerPayment(b.pay!);
    await expireUnpaidHolds();
    expect((await db.reservation.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELLED");
    const view = await customerPaymentByToken(b.pay!);
    expect(view!.message).toMatch(/released/);
    await expect(retryCustomerPayment(b.pay!, { clientKey: key(), ip: ip() })).rejects.toThrow(/released/);
  });

  it("from the booking's page: pays what is owed; a wrong link or a company bill is refused", async () => {
    const b = await bookOnline(14);
    const r = await db.reservation.findUniqueOrThrow({ where: { id: b.reservationId! } });
    await cancelCustomerPayment(b.pay!);
    expect(await bookingPayOnline(r.reference, r.manageToken)).toEqual({ offered: true, live: null });
    await expect(payBookingOnline(r.reference, "x".repeat(32), { phone: b.phone, clientKey: key(), ip: ip() })).rejects.toThrow(/not found/);
    const again = await payBookingOnline(r.reference, r.manageToken, { phone: b.phone, clientKey: key(), ip: ip() });
    expect((await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: again.token } })).amount).toBe(r.balanceAmount);
    expect((await bookingPayOnline(r.reference, r.manageToken)).live).toBe(again.token);
    await db.reservation.update({ where: { id: r.id }, data: { billTo: "COMPANY" } });
    await expect(payBookingOnline(r.reference, r.manageToken, { phone: b.phone, clientKey: key(), ip: ip() })).rejects.toThrow(/billed to your company/);
  });

  it("the meeting room: booked at once and paid online; switched off, nothing is booked", async () => {
    const p = phone();
    const input = { date: addDays(today(), 6), start: "09:00", end: "13:00", attendees: 8, fullName: "Meeting Host", phone: p, companyName: "Acme Ltd" };
    const m = await bookAndPayOnline({ service: "meeting", phone: p, clientKey: key(), ip: ip(), create: () => createWebsiteMeetingBooking(input, "10.9.9.9", { holdMinutes: ONLINE_BOOKING_HOLD_MINUTES }) });
    const mp = await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: m.pay! } });
    const r = await db.reservation.findUniqueOrThrow({ where: { id: mp.reservationId! } });
    expect(r).toMatchObject({ kind: "MEETING", status: "RESERVED", companyName: "Acme Ltd" });
    expect(mp.amount).toBe(r.balanceAmount);
    expect((await customerPaymentByToken(m.pay!))!.what).toMatch(/Meeting room booking/);

    await db.hotelSettings.updateMany({ data: { onlinePayMeeting: false } });
    const before = await db.reservation.count();
    await expect(bookAndPayOnline({ service: "meeting", phone: p, clientKey: key(), ip: ip(), create: () => createWebsiteMeetingBooking({ ...input, start: "14:00", end: "16:00" }, null, { holdMinutes: 30 }) }))
      .rejects.toThrow(/not available/);
    expect(await db.reservation.count()).toBe(before);
    await db.hotelSettings.updateMany({ data: { onlinePayMeeting: true } });
  });
});

/** nTZS confirms the payment behind this page; the page (asked again) shows the result. */
async function nTzsConfirms(token: string) {
  deposits[await depositOf(token)].status = "completed";
  await db.mobilePayment.updateMany({ where: { publicToken: token }, data: { lastCheckedAt: null } });
  return customerPaymentByToken(token, { check: true });
}

describe("guest bills, transport and invoices: Pay online", () => {
  it("a staying guest pays their bill from their stay link — never a company's bill; the room QR payer goes back to the room", async () => {
    const mgr = await managerActor();
    const st = await roomType("STANDARD");
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Bill Payer", phone: phone() }, stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 2) },
      rooms: [{ roomTypeId: st.id, roomId: st.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgr, zonedInstant(addDays(today(), -1), 12 * 60, TZ));
    await checkIn(r.id, mgr, null, new Date());
    const stay = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    const offer = await stayBillPayOnline({ guestToken: stay.guestToken! });
    expect(offer).toMatchObject({ offered: true, live: null, due: stay.balanceAmount });

    const p = await payStayBillOnline({ guestToken: stay.guestToken! }, { phone: phone(), clientKey: key(), ip: ip() });
    expect((await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: p.token } })).amount).toBe(stay.balanceAmount);
    expect((await customerPaymentByToken(p.token))!.back!.href).toBe(`/stay/${stay.guestToken}`);
    expect((await stayBillPayOnline({ guestToken: stay.guestToken! })).live).toBe(p.token);
    const paid = await nTzsConfirms(p.token);
    expect(paid!.status).toBe("PAID");
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).balanceAmount).toBe(0);
    await expect(payStayBillOnline({ guestToken: stay.guestToken! }, { phone: phone(), clientKey: key(), ip: ip() })).rejects.toThrow(/Nothing is owed/);

    await db.reservation.update({ where: { id: r.id }, data: { billTo: "COMPANY" } });
    expect((await stayBillPayOnline({ guestToken: stay.guestToken! })).offered).toBe(false);
  });

  it("a website trip is paid online once, at its price — its income into the nTZS account; a custom trip waits for its price", async () => {
    const pickup = await db.transportService.findUniqueOrThrow({ where: { code: "AIRPORT_PICKUP" } });
    const trip = await createTransportRequest({
      serviceId: pickup.id, passengerName: "Flying Guest", passengerPhone: phone(), date: addDays(today(), 3), time: "18:30",
      airport: "Julius Nyerere International Airport (DAR)", flightNumber: "TK603", passengers: 2, bags: 2,
    }, { source: "WEBSITE" });
    expect(trip.payToken).toBeTruthy();
    const view = await tripForCustomer(trip.payToken!);
    expect(view).toMatchObject({ due: trip.charge, online: true, paid: false });

    const p = await payTripOnline(trip.payToken!, { phone: phone(), clientKey: key(), ip: ip() });
    expect((await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: p.token } })).amount).toBe(trip.charge);
    expect((await customerPaymentByToken(p.token))!.back!.href).toBe(`/transport/trip/${trip.payToken}`);
    expect((await nTzsConfirms(p.token))!.status).toBe("PAID");
    const t = await db.transportTrip.findUniqueOrThrow({ where: { id: trip.id }, include: { sales: { include: { account: true } } } });
    expect(t.paidAt).not.toBeNull();
    expect(t.sales).toHaveLength(1);
    expect(t.sales[0]).toMatchObject({ amount: trip.charge, kind: "TRANSPORT", recordedById: ONLINE_RECORDER_ID });
    expect(t.sales[0].account!.code).toBe("NTZS");
    expect((await tripForCustomer(trip.payToken!))!.paid).toBe(true);
    await expect(payTripOnline(trip.payToken!, { phone: phone(), clientKey: key(), ip: ip() })).rejects.toThrow(/already paid/);

    const custom = await db.transportService.findUniqueOrThrow({ where: { code: "CUSTOM" } });
    const ride = await createTransportRequest({ serviceId: custom.id, passengerName: "City Guest", passengerPhone: phone(), date: addDays(today(), 2), time: "10:00", destination: "Mlimani City", passengers: 1 }, { source: "WEBSITE" });
    expect((await tripForCustomer(ride.payToken!))!.online).toBe(false);
    await expect(payTripOnline(ride.payToken!, { phone: phone(), clientKey: key(), ip: ip() })).rejects.toThrow(/confirm this trip's price/);
  });

  it("an issued invoice is paid online from its link — what is still owed, recorded on the invoice", async () => {
    const mgr = await managerActor();
    const guest = await db.guest.create({ data: { fullName: "Invoice Customer", phone: phone() } });
    const draft = await createManualInvoice({ guestId: guest.id, lines: [{ description: "Conference package", quantity: 1, unitAmount: 150_000 }] }, mgr);
    expect((await invoicePayOnline(draft.verifyToken ?? "x".repeat(20))).offered).toBe(false); // a draft is never payable
    await issueInvoice(draft.id, mgr);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(await invoicePayOnline(inv.verifyToken!)).toMatchObject({ offered: true, due: 150_000 });

    const p = await payInvoiceOnline(inv.verifyToken!, { phone: phone(), clientKey: key(), ip: ip() });
    expect((await customerPaymentByToken(p.token))).toMatchObject({ what: `Invoice ${inv.number}`, amount: 150_000 });
    expect((await nTzsConfirms(p.token))!.status).toBe("PAID");
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { payments: { include: { method: true } } } });
    expect(after).toMatchObject({ status: "PAID", balanceAmount: 0, paidAmount: 150_000 });
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ amount: 150_000, recordedById: ONLINE_RECORDER_ID });
    expect(after.payments[0].method.code).toBe("NTZS");
    expect((await invoicePayOnline(inv.verifyToken!)).offered).toBe(false);
  });
});

describe("admin: online payments, reconciliation, reports", () => {
  it("lists every attempt; the books match what nTZS confirmed; a difference is listed; the daily report says NTZS online", async () => {
    const a = await orderPayingOnline();
    expect((await nTzsConfirms(a.token))!.status).toBe("PAID");
    const b = await orderPayingOnline();
    deposits[await depositOf(b.token)].status = "failed";
    await db.mobilePayment.updateMany({ where: { publicToken: b.token }, data: { lastCheckedAt: null } });
    await customerPaymentByToken(b.token, { check: true });

    const day = today();
    const totals = await onlinePaymentTotals(day, day);
    expect(totals.paid).toEqual({ count: 1, amount: a.order.total });
    expect(totals.failed).toBe(1);
    const rows = await onlinePayments({ from: day, to: day, status: "all", purpose: null, q: "" });
    expect(rows.map((r) => r.status).sort()).toEqual(["COMPLETED", "FAILED"]);
    expect(rows.find((r) => r.status === "COMPLETED")).toMatchObject({ by: "Customer, online", reference: "MP777ABC", amount: a.order.total });
    expect((await onlinePayments({ from: day, to: day, status: "failed", purpose: "RESTAURANT", q: "" })).length).toBe(1);

    let recon = await reconcileOnlinePayments(day, day);
    expect(recon).toMatchObject({ confirmed: 1, matched: 1, recorded: a.order.total, issues: [] });
    // A payment taken off the books by hand: reconciliation lists it.
    await db.restaurantOrderPayment.updateMany({ where: { orderId: a.order.id }, data: { status: "REVERSED" } });
    recon = await reconcileOnlinePayments(day, day);
    expect(recon.issues).toHaveLength(1);
    expect(recon.issues[0].problem).toMatch(/not on the hotel's books/);
    await db.restaurantOrderPayment.updateMany({ where: { orderId: a.order.id }, data: { status: "POSTED" } });

    const report = await paymentsByMethod(day, day);
    expect(report.rows.find((r) => r.code === "NTZS")).toMatchObject({ method: "NTZS online", amount: a.order.total });

    // The customer's profile: their online payments.
    const guestId = (await db.restaurantOrder.findUniqueOrThrow({ where: { id: a.order.id } })).guestId!;
    const history = await customerOnlinePayments(guestId);
    expect(history[0]).toMatchObject({ status: "COMPLETED", amount: a.order.total, online: true, reference: "MP777ABC" });
  });
});

/** A webhook from nTZS, signed with the hotel's secret. */
function webhook(body: unknown) {
  const raw = JSON.stringify(body), ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", "whsec_unit").update(`${ts}.${raw}`).digest("hex");
  return ntzsWebhook(new Request("http://hotel.test/api/webhooks/ntzs", { method: "POST", body: raw, headers: { "x-webhook-signature": sig, "x-webhook-timestamp": ts } }));
}
const paidNow = async (orderId: string) => (await db.restaurantOrder.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus;

describe("nTZS confirmations (live incident, 2026-10-04: paid, minted — but not recorded)", () => {
  it("a deposit nTZS reads as \"minted\" is paid — also when its answer is wrapped", async () => {
    const a = await orderPayingOnline();
    deposits[await depositOf(a.token)].status = "minted";
    wrapGet = true;
    expect((await customerPaymentByToken(a.token, { check: true }))!.status).toBe("PAID");
    expect(await paidNow(a.order.id)).toBe("PAID");
  });

  it("the webhook is understood in nTZS's shapes: event or type, depositId or id, a status in the data — or it asks nTZS", async () => {
    const a = await orderPayingOnline();
    const depA = await depositOf(a.token);
    const ok = await webhook({ event: "deposit.minted", data: { id: depA, amountTzs: a.order.total, status: "minted" } });
    expect(ok.status).toBe(200);
    expect(await paidNow(a.order.id)).toBe("PAID");
    // The same call again changes nothing.
    await webhook({ event: "deposit.minted", data: { id: depA, amountTzs: a.order.total } });
    expect(await db.restaurantOrderPayment.count({ where: { orderId: a.order.id } })).toBe(1);

    // An event we do not know about one of our payments: nTZS is asked — and it says minted.
    const b = await orderPayingOnline();
    const depB = await depositOf(b.token);
    deposits[depB].status = "minted";
    expect((await webhook({ type: "deposit.updated", data: { depositId: depB } })).status).toBe(200);
    expect(await paidNow(b.order.id)).toBe("PAID");

    // Found by our own reference when nTZS sends no deposit id.
    const c = await orderPayingOnline();
    const mpC = await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: c.token } });
    await webhook({ type: "deposit.completed", data: { externalReference: mpC.id, amountTzs: c.order.total } });
    expect(await paidNow(c.order.id)).toBe("PAID");

    // Not signed: refused, nothing recorded.
    const d = await orderPayingOnline();
    const bad = await ntzsWebhook(new Request("http://hotel.test/api/webhooks/ntzs", { method: "POST", body: JSON.stringify({ type: "deposit.completed", data: { depositId: await depositOf(d.token) } }) }));
    expect(bad.status).toBe(401);
    expect(await paidNow(d.order.id)).toBe("UNPAID");
  });

  it("approved late (after the page gave up): opening it again, the scheduled run and Try again all find the money — never asked twice", async () => {
    // Timed out on our side, then nTZS has it: the page shows paid.
    const a = await orderPayingOnline();
    await db.mobilePayment.updateMany({ where: { publicToken: a.token }, data: { status: "EXPIRED", lastCheckedAt: null } });
    deposits[await depositOf(a.token)].status = "minted";
    expect((await customerPaymentByToken(a.token, { check: true }))!.status).toBe("PAID");

    // The scheduled run picks up a timed-out one too.
    const b = await orderPayingOnline();
    await db.mobilePayment.updateMany({ where: { publicToken: b.token }, data: { status: "EXPIRED", createdAt: new Date(Date.now() - 5 * 60_000) } });
    deposits[await depositOf(b.token)].status = "completed";
    await sweepMobilePayments();
    expect(await paidNow(b.order.id)).toBe("PAID");

    // "Try again" on an attempt that went through: the same page, paid — no second prompt to the phone.
    const c = await orderPayingOnline();
    await db.mobilePayment.updateMany({ where: { publicToken: c.token }, data: { status: "FAILED" } });
    deposits[await depositOf(c.token)].status = "minted";
    const before = sent.length;
    const again = await retryCustomerPayment(c.token, { clientKey: key(), ip: ip() });
    expect(again).toEqual({ token: c.token, reused: true });
    expect(sent.length).toBe(before);
    expect(await paidNow(c.order.id)).toBe("PAID");

    // A new payment for a bill whose earlier attempt went through late: that one is recorded first, nothing new asked.
    const d = await orderPayingOnline();
    await db.mobilePayment.updateMany({ where: { publicToken: d.token }, data: { status: "CANCELLED" } });
    deposits[await depositOf(d.token)].status = "minted";
    await expect(payOrderOnline(d.order.trackToken!, { phone: d.phone, clientKey: key(), ip: ip() })).rejects.toThrow(/already paid/);
    expect(await paidNow(d.order.id)).toBe("PAID");
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
