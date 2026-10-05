import { randomInt } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { assignAndCheckIn, checkIn, confirmReservation } from "@/server/services/reservations";
import { createWebsiteBooking, getBookingForGuest } from "@/server/services/public-booking";
import { expireUnpaidHolds, processNoShows } from "@/server/services/booking-holds";
import { bookingPayOnline, customerPaymentByToken, payBookingOnline, retryCustomerPayment } from "@/server/services/online-pay";
import { requestMobilePayment } from "@/server/services/mobile-payments";
import { recordReservationPayment, reversePayment } from "@/server/services/payments";
import { staffAlerts } from "@/server/services/staff-alerts";
import { getCheckInBooking } from "@/server/services/front-desk";
import { createBookingQr, qrBookings } from "@/server/services/booking-qr";
import { qrBook, qrConfirmation, qrPayNow, qrSearch, type QrBookInput } from "@/server/services/hotel-qr";
import { quoteStay } from "@/server/services/pricing";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { addDays, businessDateOf } from "@/lib/time/business-date";
import { managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/**
 * THE BOOKING RULE (owner, 2026-10-05) — paying is what reserves a room, on the Hotel QR and the website alike:
 *  - Pay now: the room is held only while the guest pays (30 minutes); confirmed only when nTZS confirms the money;
 *    not paid in time → the room is free again.
 *  - Pay later: the booking is made and reception sees it, but NO room is held — whoever pays first gets the room.
 *    Paying later re-checks the room: the same one, another free one of its type (a new price is shown first), or
 *    "just taken". During that payment the 30-minute hold applies; not paid → back to pay later, never cancelled.
 *  - The QR never says "nothing free" while other rooms fit the party.
 * nTZS is faked here (no real money).
 */
const ENV = { key: process.env.NTZS_API_KEY, secret: process.env.NTZS_WEBHOOK_SECRET, notify: process.env.GUEST_NOTIFY_WEBHOOK_URL };
const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[randomInt(16)]).join("");
const key = () => hex(32);
// Fresh numbers and addresses every run: the per-phone / per-address limits are kept between runs.
const phone = () => `07${randomInt(10_000_000, 99_999_999)}`;
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
const today = () => businessDateOf(new Date());
const stayIn = (days: number, nights = 2, adults = 2) => ({ checkIn: addDays(today(), days), checkOut: addDays(today(), days + nights), adults, children: 0 });

let deposits: Record<string, { status: string; amountTzs: number }> = {};
let sent: { amountTzs: number }[] = [];
/** The next payment request: nTZS refuses it (this HTTP status). */
let refuseNext: number | null = null;

beforeEach(async () => {
  await resetBusinessData();
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_events"`);
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_codes" WHERE "id" <> 'bqr_reception'`);
  await db.hotelSettings.updateMany({
    data: { hotelQrEnabled: true, hotelQrPayAtHotel: true, publicBookingEnabled: true, onlinePayEnabled: true, onlinePayBooking: true, unpaidHoldHours: 24, guestNotifications: {} },
  });
  process.env.NTZS_API_KEY = "ntzs_test_unit";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
  delete process.env.GUEST_NOTIFY_WEBHOOK_URL;
  deposits = {}; sent = []; refuseNext = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/deposits") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (refuseNext !== null) {
        const status = refuseNext; refuseNext = null;
        return new Response(JSON.stringify({ error: { code: "invalid_phone", message: "That phone cannot pay" } }), { status });
      }
      sent.push(body);
      const id = `dep_${sent.length}`;
      deposits[id] = { status: "submitted", amountTzs: body.amountTzs };
      return new Response(JSON.stringify({ id, status: "submitted", amountTzs: body.amountTzs, paymentMethod: "mobile_money" }), { status: 201 });
    }
    const m = url.match(/\/deposits\/([^/?]+)$/);
    if (m && deposits[m[1]]) return new Response(JSON.stringify({ id: m[1], ...deposits[m[1]], pspReference: "MP888RULE" }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404 });
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.priceRule.deleteMany({ where: { name: { startsWith: "Rule test" } } });
});
afterAll(async () => {
  for (const [k, v] of [["NTZS_API_KEY", ENV.key], ["NTZS_WEBHOOK_SECRET", ENV.secret], ["GUEST_NOTIFY_WEBHOOK_URL", ENV.notify]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await resetBusinessData();
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_events"`);
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_codes" WHERE "id" <> 'bqr_reception'`);
});

const newQr = async () => createBookingQr({ label: "Entrance" }, await managerActor());

/** A booking from the QR for a given room — Pay later ("HOTEL") by default. */
async function qrBooking(token: string, s: ReturnType<typeof stayIn>, roomNumber: string, pay: QrBookInput["pay"] = "HOTEL", name = "Rule Guest") {
  const p = phone();
  const b = await qrBook(token, { ...s, roomNumber, guest: { fullName: name, phone: p }, pay, clientKey: key() }, { ip: ip(), track: false });
  const r = await db.reservation.findUniqueOrThrow({ where: { reference: b.reference }, include: { rooms: { include: { room: true } } } });
  return { ...b, r, phone: p };
}

const offered = async (token: string, s: ReturnType<typeof stayIn>, roomType?: string) =>
  (await qrSearch(token, { ...s, roomType: roomType ?? null }, { track: false })).types.flatMap((t) => t.rooms.map((r) => r.number));

/** nTZS confirms the payment behind this page, and the page sees it. */
async function ntzsConfirms(payToken: string) {
  const mp = await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: payToken } });
  deposits[mp.depositId!].status = "completed";
  await db.mobilePayment.update({ where: { id: mp.id }, data: { lastCheckedAt: null } });
  await customerPaymentByToken(payToken, { check: true });
}

const reservation = (id: string) => db.reservation.findUniqueOrThrow({ where: { id }, include: { rooms: { include: { room: true } } } });

describe("pay later holds no room — whoever pays first gets it", () => {
  it("a second guest can book and pay the very same room; the first one is told plainly, and paying later re-checks the room", async () => {
    const q = await newQr();
    const s = stayIn(8);
    // Twin: one room only (101).
    const first = await qrBooking(q.token, s, "101", "HOTEL", "Later Guest");
    expect(first.r).toMatchObject({ status: "INQUIRY", holdUntil: null, paidAmount: 0 });
    expect(first.r.rooms[0]).toMatchObject({ status: "INQUIRY" });
    expect(first.r.netAmount).toBeGreaterThan(0);
    // Still offered to everyone.
    expect(await offered(q.token, s, "twin")).toEqual(["101"]);

    // Another guest books it and pays now: it is theirs once nTZS confirms.
    const second = await qrBooking(q.token, s, "101", "ONLINE", "Paying Guest");
    expect(second.r.status).toBe("RESERVED");
    await ntzsConfirms(second.payToken!);
    expect((await reservation(second.r.id)).status).toBe("CONFIRMED");
    const full = await qrSearch(q.token, { ...s, roomType: "twin" }, { track: false });
    expect(full.chosen!.state).toBe("full");
    expect(full.types.flatMap((t) => t.rooms.map((r) => r.number))).not.toContain("101");

    // The first guest's booking is still there (reception sees it), not cancelled — and their Pay now is refused plainly.
    const c = await qrConfirmation(q.token, first.reference, first.manageToken);
    expect(c).toMatchObject({ state: "ok", booking: { status: "INQUIRY", roomHeld: false, paymentStatus: "PAY_AT_HOTEL", canPayNow: true } });
    const refused = await qrPayNow(q.token, first.reference, first.manageToken, { phone: first.phone, clientKey: key(), ip: ip() }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: "UNAVAILABLE" });
    expect(String((refused as Error).message)).toMatch(/Room 101 was just taken .* no other Twin is free\. Please choose again/);
    expect(await reservation(first.r.id)).toMatchObject({ status: "INQUIRY", holdUntil: null });
    expect(sent).toHaveLength(1); // only the paying guest was ever asked
  });

  it("paying later: the same room while it is still free — held while paying, confirmed only when nTZS confirms", async () => {
    const q = await newQr();
    const s = stayIn(9);
    const b = await qrBooking(q.token, s, "104");
    const pay = await qrPayNow(q.token, b.reference, b.manageToken, { phone: b.phone, clientKey: key(), ip: ip() });
    const held = await reservation(b.r.id);
    expect(held).toMatchObject({ status: "RESERVED", paidAmount: 0 });
    expect(held.rooms[0].room.number).toBe("104");
    expect(held.holdUntil!.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(held.holdUntil!.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    expect(sent).toEqual([expect.objectContaining({ amountTzs: b.r.netAmount })]);
    // Held now: nobody else can book it while the guest pays.
    expect(await offered(q.token, s, "double-deluxe")).not.toContain("104");
    expect((await qrConfirmation(q.token, b.reference, b.manageToken, { check: false }))).toMatchObject({ booking: { status: "RESERVED", roomHeld: true, paymentStatus: "PAYMENT_PENDING" } });

    // Pressing Pay is not paying: confirmed only once nTZS confirms.
    expect((await reservation(b.r.id)).status).toBe("RESERVED");
    await ntzsConfirms(pay.token);
    expect(await reservation(b.r.id)).toMatchObject({ status: "CONFIRMED", holdUntil: null, paidAmount: b.r.netAmount, balanceAmount: 0 });
  });

  it("paying later when the room was taken: another free room of the same type — at the same price it goes straight on", async () => {
    const q = await newQr();
    const s = stayIn(10);
    const b = await qrBooking(q.token, s, "105");
    const taker = await qrBooking(q.token, s, "105", "ONLINE", "Quick Payer");
    await ntzsConfirms(taker.payToken!);

    const pay = await qrPayNow(q.token, b.reference, b.manageToken, { phone: b.phone, clientKey: key(), ip: ip() });
    const moved = await reservation(b.r.id);
    expect(moved.status).toBe("RESERVED");
    expect(moved.rooms[0].room.number).not.toBe("105");
    expect(moved.netAmount).toBe(b.r.netAmount);
    expect(await db.auditLog.count({ where: { action: "reservation.room_assigned", entityId: b.r.id } })).toBe(1);
    await ntzsConfirms(pay.token);
    expect((await reservation(b.r.id)).status).toBe("CONFIRMED");
    // Two confirmed bookings, two different rooms — never the same room twice.
    const rooms = await db.reservationRoom.findMany({ where: { status: "CONFIRMED" }, select: { roomId: true } });
    expect(new Set(rooms.map((x) => x.roomId)).size).toBe(2);
  });

  it("paying later when the room was taken and the only other room of the type costs more: the new price is shown first, then paid", async () => {
    const q = await newQr();
    const s = stayIn(11);
    const ex = await roomType("EXECUTIVE");
    const other = ex.rooms.find((r) => r.number === "402")!;
    await db.priceRule.create({ data: { name: "Rule test room 402", scope: "ROOMS", roomIds: [other.id], price: 130_000, startDate: new Date(`${s.checkIn}T00:00:00Z`), endDate: new Date(`${addDays(s.checkOut, -1)}T00:00:00Z`) } });
    // What the pricing engine says Room 402 costs for these nights (a promotion may apply too).
    const price = (await quoteStay(db, { dates: [s.checkIn, addDays(s.checkIn, 1)], base: ex.baseRate, roomTypeId: ex.id, roomId: other.id, channel: "WEBSITE" })).net;
    const tzs = (n: number) => `TZS ${n.toLocaleString("en-US")}`;
    const b = await qrBooking(q.token, s, "302");
    const taker = await qrBooking(q.token, s, "302", "ONLINE", "Quick Payer");
    await ntzsConfirms(taker.payToken!);
    const asked = sent.length;

    const err = await qrPayNow(q.token, b.reference, b.manageToken, { phone: b.phone, clientKey: key(), ip: ip() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "CONFLICT" });
    const after = await reservation(b.r.id);
    expect(String((err as Error).message)).toContain(`Room 302 was just taken — Room 402 (Executive) is kept for you instead. The price is now ${tzs(price)} (was ${tzs(b.r.netAmount)}).`);
    expect(price).not.toBe(b.r.netAmount);
    expect(after).toMatchObject({ status: "RESERVED", netAmount: price });
    expect(after.rooms[0].room.number).toBe("402");
    expect(sent).toHaveLength(asked); // nothing asked of the phone yet

    // Pressed again: the new amount is asked — and confirmed by nTZS.
    const pay = await qrPayNow(q.token, b.reference, b.manageToken, { phone: b.phone, clientKey: key(), ip: ip() });
    expect(sent.at(-1)).toMatchObject({ amountTzs: price });
    await ntzsConfirms(pay.token);
    expect(await reservation(b.r.id)).toMatchObject({ status: "CONFIRMED", balanceAmount: 0 });
  });

  it("two guests who booked the same room to pay later press Pay now at once: one gets the room, never both", async () => {
    const q = await newQr();
    const s = stayIn(12);
    const a = await qrBooking(q.token, s, "101", "HOTEL", "Twin A");
    const b = await qrBooking(q.token, s, "101", "HOTEL", "Twin B");
    const tries = await Promise.allSettled([a, b].map((x) => qrPayNow(q.token, x.reference, x.manageToken, { phone: x.phone, clientKey: key(), ip: ip() })));
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1);
    expect((tries.find((t) => t.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "UNAVAILABLE" });
    expect(await db.reservationRoom.count({ where: { room: { number: "101" }, status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] } } })).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("not paid in time: the paying hold lapses back to pay later (never cancelled) and the room is free again; a refused request lets go at once", async () => {
    const q = await newQr();
    const s = stayIn(13);
    const b = await qrBooking(q.token, s, "106");
    const pay = await qrPayNow(q.token, b.reference, b.manageToken, { phone: b.phone, clientKey: key(), ip: ip() });
    // While the payment request is on its way the room stays held, even past the hold time.
    await db.reservation.update({ where: { id: b.r.id }, data: { holdUntil: new Date(Date.now() - 60_000) } });
    await expireUnpaidHolds();
    expect((await reservation(b.r.id)).status).toBe("RESERVED");
    await db.mobilePayment.updateMany({ where: { publicToken: pay.token }, data: { status: "EXPIRED" } });
    await expireUnpaidHolds();
    expect(await reservation(b.r.id)).toMatchObject({ status: "INQUIRY", holdUntil: null, cancelledAt: null });
    expect(await offered(q.token, s, "double-deluxe")).toContain("106");
    expect(await db.auditLog.count({ where: { action: "reservation.back_to_pay_later", entityId: b.r.id } })).toBe(1);
    expect((await customerPaymentByToken(pay.token))!.message).toMatch(/not reserved until it is paid/);

    // nTZS refuses the next request (a number that cannot pay): nothing is held — at once.
    refuseNext = 422;
    await expect(retryCustomerPayment(pay.token, { clientKey: key(), ip: ip() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await reservation(b.r.id)).toMatchObject({ status: "INQUIRY", holdUntil: null });
    // Try again works (the room is checked again and held while paying).
    const again = await retryCustomerPayment(pay.token, { clientKey: key(), ip: ip() });
    expect((await reservation(b.r.id)).status).toBe("RESERVED");
    await ntzsConfirms(again.token);
    expect((await reservation(b.r.id)).status).toBe("CONFIRMED");
  });
});

describe("pay now", () => {
  it("holds the room only while paying; not paid in time, the booking lapses and the room is free again", async () => {
    const q = await newQr();
    const s = stayIn(14);
    const b = await qrBooking(q.token, s, "107", "ONLINE");
    expect(b.r).toMatchObject({ status: "RESERVED", paidAmount: 0 });
    expect(b.r.holdUntil!.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    expect(await offered(q.token, s, "double-deluxe")).not.toContain("107");
    await db.mobilePayment.updateMany({ where: { publicToken: b.payToken! }, data: { status: "EXPIRED" } });
    await db.reservation.update({ where: { id: b.r.id }, data: { holdUntil: new Date(Date.now() - 60_000) } });
    await expireUnpaidHolds();
    expect((await reservation(b.r.id)).status).toBe("CANCELLED");
    expect(await offered(q.token, s, "double-deluxe")).toContain("107");
  });
});

describe("the website: one rule", () => {
  const sel = (days: number) => ({ checkIn: addDays(today(), days), checkOut: addDays(today(), days + 2), adults: 2, children: 0, typeSlug: "twin", rooms: 1 });

  it("book now, pay later: a booking reception sees, no room held; Pay now from the booking page holds and confirms it", async () => {
    const p = phone();
    const b = await createWebsiteBooking(sel(15), { fullName: "Web Later", phone: p }, ip(), null, { payLater: true });
    const r = await reservation(b.id);
    expect(r).toMatchObject({ status: "INQUIRY", holdUntil: null, externalData: expect.objectContaining({ payLater: true, channel: "WEBSITE" }) });
    expect(r.internalNotes).toMatch(/pay later/);
    expect(r.netAmount).toBeGreaterThan(0);
    // The room stays free: another website guest can book it and pay now.
    const other = await createWebsiteBooking(sel(15), { fullName: "Web Payer", phone: phone() }, ip(), null, { holdMinutes: 30 });
    expect((await reservation(other.id)).status).toBe("RESERVED");
    await db.reservation.update({ where: { id: other.id }, data: { holdUntil: new Date(Date.now() - 60_000) } });
    await expireUnpaidHolds(); // nobody paid: released

    // The guest's own page: the price and Pay now.
    const page = await getBookingForGuest(b.reference, b.manageToken);
    expect(page).toMatchObject({ status: "INQUIRY", balanceAmount: r.netAmount });
    expect(await bookingPayOnline(b.reference, b.manageToken)).toEqual({ offered: true, live: null });
    const pay = await payBookingOnline(b.reference, b.manageToken, { phone: p, clientKey: key(), ip: ip() });
    expect((await reservation(b.id)).status).toBe("RESERVED");
    await ntzsConfirms(pay.token);
    expect(await reservation(b.id)).toMatchObject({ status: "CONFIRMED", balanceAmount: 0 });
  });
});

describe("reception", () => {
  it("lists, badges and the bell say it plainly: not paid · room not held", async () => {
    const q = await newQr();
    const s = stayIn(16);
    const b = await qrBooking(q.token, s, "203");
    const web = await createWebsiteBooking({ ...s, typeSlug: "double-deluxe", rooms: 1 }, { fullName: "Web Later", phone: phone() }, ip(), null, { payLater: true });
    const desk = await receptionistActor();

    expect(RESERVATION_STATUS_META.INQUIRY.label).toBe("Not paid · room not held");
    const rows = await qrBookings(desk, { view: "waiting" });
    expect(rows).toEqual([expect.objectContaining({ reference: b.reference, status: "INQUIRY", roomHeld: false, paymentStatus: "PAY_AT_HOTEL", payWay: "HOTEL" })]);
    const alerts = (await staffAlerts(desk.permissions!)).filter((a) => a.id.startsWith("hotelqr:"));
    expect(alerts.map((a) => a.id).sort()).toEqual([`hotelqr:${b.r.id}:later`, `hotelqr:${web.id}:later`].sort());
    expect(alerts.every((a) => a.text.includes("not paid · room not held"))).toBe(true);
    expect(alerts.find((a) => a.id.includes(web.id))!.text).toMatch(/^Website booking — Web Later/);
    // Reception cannot "hold" it without payment (only a payment, or a manager, secures it).
    await expect(confirmReservation(b.r.id, desk)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("at the desk: a payment secures the room (another of its type if it was taken); check-in gives them any free room", async () => {
    const q = await newQr();
    const desk = await receptionistActor();
    const cash = await db.moneyAccount.findFirstOrThrow({ where: { code: "CASH_DRAWER" } });
    // Arriving today, booked to pay later; their room went to a guest who paid first.
    const s = stayIn(0, 1);
    const b = await qrBooking(q.token, s, "204");
    const taker = await qrBooking(q.token, s, "204", "ONLINE", "Quick Payer");
    await ntzsConfirms(taker.payToken!);

    // Check-in on the taken room is refused plainly; the check-in desk marks it and offers free rooms.
    await expect(checkIn(b.r.id, desk)).rejects.toThrow(/Room 204 was taken by a guest who paid first/);
    const card = await getCheckInBooking(b.r.id, today());
    expect(card!.rooms[0].current).toMatchObject({ number: "204", taken: true, ready: false });
    const free = card!.rooms[0].options.find((o) => o.sameType)!;
    await assignAndCheckIn(b.r.id, { assignments: [{ reservationRoomId: card!.rooms[0].id, roomId: free.id }], guest: { idNumber: "TZ-RULE-1" } }, desk);
    const inHouse = await reservation(b.r.id);
    expect(inHouse.status).toBe("CHECKED_IN");
    expect(inHouse.rooms[0].room.number).toBe(free.number);

    // Another booking to pay later, its room taken: a desk payment moves it to a free room of its type and confirms it.
    const s2 = stayIn(20);
    const c = await qrBooking(q.token, s2, "205");
    const taker2 = await qrBooking(q.token, s2, "205", "ONLINE", "Quick Payer");
    await ntzsConfirms(taker2.payToken!);
    await recordReservationPayment({ reservationId: c.r.id, amount: 10_000, accountId: cash.id }, desk);
    const paid = await reservation(c.r.id);
    expect(paid.status).toBe("CONFIRMED");
    expect(paid.rooms[0].room.number).not.toBe("205");

    // The money goes back: without a payment it holds no room again (back to pay later).
    const p = await db.payment.findFirstOrThrow({ where: { reservationId: c.r.id } });
    await reversePayment(p.id, "Wrong booking", await managerActor());
    expect(await reservation(c.r.id)).toMatchObject({ status: "INQUIRY", holdUntil: null });
  });

  it("a payment request reception sends holds the room while the guest pays", async () => {
    const q = await newQr();
    const s = stayIn(22);
    const b = await qrBooking(q.token, s, "206");
    const desk = await receptionistActor();
    await requestMobilePayment({ purpose: "RESERVATION", reservationId: b.r.id, amount: 20_000 }, b.phone, { ...desk, userId: desk.userId! });
    expect((await reservation(b.r.id)).status).toBe("RESERVED");
    expect(await offered(q.token, s, "double-deluxe")).not.toContain("206");
  });

  it("nobody paid or came: closed at the arrival day's cut-off (no room was ever held)", async () => {
    const q = await newQr();
    const b = await qrBooking(q.token, stayIn(0, 1), "207");
    await processNoShows(new Date(Date.now() + 2 * 86_400_000));
    expect(await reservation(b.r.id)).toMatchObject({ status: "CANCELLED", cancelReason: expect.stringMatching(/Not paid and did not arrive/) });
  });
});

describe("the QR never says 'nothing free' while rooms fit", () => {
  it("a room type too small for the party, or full: every other free room that fits is shown, with why", async () => {
    const q = await newQr();
    const s = stayIn(30);
    // The owner's screenshot: Standard Single only, 2 guests.
    const single = await qrSearch(q.token, { ...s, roomType: "standard-single" }, { track: false });
    expect(single.chosen).toMatchObject({ slug: "standard-single", state: "too_small", maxAdults: 1 });
    expect(single.types.length).toBeGreaterThan(1);
    expect(single.types.some((t) => t.type.slug === "double-deluxe")).toBe(true);
    expect(single.types.every((t) => t.type.maxAdults >= 2)).toBe(true);
    // One adult: the type itself.
    const one = await qrSearch(q.token, { ...s, adults: 1, roomType: "standard-single" }, { track: false });
    expect(one.chosen!.state).toBe("ok");
    expect(one.types.map((t) => t.type.slug)).toEqual(["standard-single"]);
    // Full (the one Twin is paid for): the others.
    const paid = await qrBooking(q.token, s, "101", "ONLINE");
    await ntzsConfirms(paid.payToken!);
    const twin = await qrSearch(q.token, { ...s, roomType: "twin" }, { track: false });
    expect(twin.chosen!.state).toBe("full");
    expect(twin.types.length).toBeGreaterThan(0);
    // Nothing fits at all (five adults in one room): then, and only then, empty — with the types that are too small.
    const five = await qrSearch(q.token, { ...s, adults: 5, roomType: "double-deluxe" }, { track: false });
    expect(five.types).toEqual([]);
    expect(five.tooSmall.length).toBeGreaterThan(0);
  });
});
