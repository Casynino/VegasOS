import { randomInt } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { assignAndCheckIn, changeStayDates, checkIn, createReservation } from "@/server/services/reservations";
import { findAvailableRooms } from "@/server/services/availability";
import { expireUnpaidHolds, holdForPayment } from "@/server/services/booking-holds";
import { cancelCustomerPayment, customerPaymentByToken, payStayBillOnline, retryCustomerPayment, stayBillPayOnline } from "@/server/services/online-pay";
import { BOOKING_PAY_SOURCES, requestMobilePayment } from "@/server/services/mobile-payments";
import { getBookingForGuest } from "@/server/services/public-booking";
import { getCheckInBooking } from "@/server/services/front-desk";
import { createBookingQr } from "@/server/services/booking-qr";
import { qrBook, qrConfirmation, qrPayNow, qrSearch, type QrBookInput } from "@/server/services/hotel-qr";
import { overnightStay } from "@/lib/time/stay";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/**
 * THE BOOKING RULE — gaps found while verifying it (owner, 2026-10-05): a guest still in the room is never sold over;
 * a hold whose time ran out never makes a room look "just taken"; Try again asks the price the guest was shown; a
 * request that never reached the phone keeps no room; reception can work a pay-later booking like any other.
 * nTZS is faked here (no real money).
 */
const TZ = "Africa/Dar_es_Salaam";
const ENV = { key: process.env.NTZS_API_KEY, secret: process.env.NTZS_WEBHOOK_SECRET };
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
    data: { hotelQrEnabled: true, hotelQrPayAtHotel: true, publicBookingEnabled: true, onlinePayEnabled: true, onlinePayBooking: true, onlinePayStayBill: true, unpaidHoldHours: 24, guestNotifications: {} },
  });
  process.env.NTZS_API_KEY = "ntzs_test_unit";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
  deposits = {}; sent = []; refuseNext = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/deposits") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (refuseNext !== null) {
        const status = refuseNext; refuseNext = null;
        return new Response(JSON.stringify({ error: { code: "invalid_phone", message: "That phone number cannot pay" } }), { status });
      }
      sent.push(body);
      const id = `dep_${sent.length}`;
      deposits[id] = { status: "submitted", amountTzs: body.amountTzs };
      return new Response(JSON.stringify({ id, status: "submitted", amountTzs: body.amountTzs, paymentMethod: "mobile_money" }), { status: 201 });
    }
    const m = url.match(/\/deposits\/([^/?]+)$/);
    if (m && deposits[m[1]]) return new Response(JSON.stringify({ id: m[1], ...deposits[m[1]], pspReference: "MP888GAPS" }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), { status: 404 });
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.priceRule.deleteMany({ where: { name: { startsWith: "Gap test" } } });
});
afterAll(async () => {
  for (const [k, v] of [["NTZS_API_KEY", ENV.key], ["NTZS_WEBHOOK_SECRET", ENV.secret]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await resetBusinessData();
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_events"`);
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_codes" WHERE "id" <> 'bqr_reception'`);
});

const newQr = async () => createBookingQr({ label: "Gap test" }, await managerActor());

/** A booking from the QR for a given room — Pay later ("HOTEL") by default. */
async function qrBooking(token: string, s: ReturnType<typeof stayIn>, roomNumber: string, pay: QrBookInput["pay"] = "HOTEL", name = "Gap Guest") {
  const p = phone();
  const b = await qrBook(token, { ...s, roomNumber, guest: { fullName: name, phone: p }, pay, clientKey: key() }, { ip: ip(), track: false });
  const r = await db.reservation.findUniqueOrThrow({ where: { reference: b.reference }, include: { rooms: { include: { room: true } } } });
  return { ...b, r, phone: p };
}

/** nTZS confirms the payment behind this page, and the page sees it. */
async function ntzsConfirms(payToken: string) {
  const mp = await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: payToken } });
  deposits[mp.depositId!].status = "completed";
  await db.mobilePayment.update({ where: { id: mp.id }, data: { lastCheckedAt: null } });
  await customerPaymentByToken(payToken, { check: true });
}

const reservation = (id: string) => db.reservation.findUniqueOrThrow({ where: { id }, include: { rooms: { include: { room: true } } } });
const offered = async (token: string, s: ReturnType<typeof stayIn>, type?: string) =>
  (await qrSearch(token, { ...s, roomType: type ?? null }, { track: false })).types.flatMap((t) => t.rooms.map((r) => r.number));

/** Room 302's only other Executive (402) costs more for these nights — a room moved at payment is dearer. */
async function dearer402(s: ReturnType<typeof stayIn>) {
  const ex = await roomType("EXECUTIVE");
  const other = ex.rooms.find((r) => r.number === "402")!;
  await db.priceRule.create({ data: { name: "Gap test room 402", scope: "ROOMS", roomIds: [other.id], price: 130_000, startDate: new Date(`${s.checkIn}T00:00:00Z`), endDate: new Date(`${addDays(s.checkOut, -1)}T00:00:00Z`) } });
}

describe("a guest still in the room is never sold over", () => {
  it("checked in past their check-out time (not checked out yet): the room is not free tonight — only after the next check-out time", async () => {
    const mgr = await managerActor();
    const st = await roomType("STANDARD");
    const room = st.rooms[0];
    const t = today();
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Over Stayer", phone: phone() }, stay: { kind: "overnight", arrivalDate: addDays(t, -2), departureDate: addDays(t, -1) },
      rooms: [{ roomTypeId: st.id, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgr, zonedInstant(addDays(t, -3), 12 * 60, TZ));
    await checkIn(r.id, mgr, null, zonedInstant(addDays(t, -2), 15 * 60, TZ));

    // Tonight: taken — on every screen (the engine, the Hotel QR, the website's "free tonight").
    expect(await findAvailableRooms({ stay: overnightStay({ arrivalDate: t, departureDate: addDays(t, 1) }), roomIds: [room.id] })).toEqual([]);
    const q = await newQr();
    expect(await offered(q.token, { checkIn: t, checkOut: addDays(t, 1), adults: 1, children: 0 })).not.toContain(room.number);
    // A later stay is not blocked by it (reception checks the guest out before then).
    expect(await findAvailableRooms({ stay: overnightStay({ arrivalDate: addDays(t, 3), departureDate: addDays(t, 4) }), roomIds: [room.id] })).toHaveLength(1);
    // Nobody can book or pay for it tonight either: the engine refuses under its lock.
    await expect(createReservation({
      sourceCode: "WEBSITE", guest: { fullName: "Tonight Guest", phone: phone() }, stay: { kind: "overnight", arrivalDate: t, departureDate: addDays(t, 1) },
      rooms: [{ roomTypeId: st.id, roomId: room.id, adults: 1, children: 0 }],
    }, mgr)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("paying later re-checks the room against holds that have really lapsed", () => {
  it("a Pay-now hold whose time ran out (not swept yet) does not make the pay-later guest's room 'just taken'", async () => {
    const q = await newQr();
    const s = stayIn(9);
    const later = await qrBooking(q.token, s, "101");
    const payer = await qrBooking(q.token, s, "101", "ONLINE", "Never Paid");
    await db.mobilePayment.updateMany({ where: { publicToken: payer.payToken! }, data: { status: "EXPIRED" } });
    await db.reservation.update({ where: { id: payer.r.id }, data: { holdUntil: new Date(Date.now() - 60_000) } });

    const pay = await qrPayNow(q.token, later.reference, later.manageToken, { phone: later.phone, clientKey: key(), ip: ip() });
    expect(pay.token).toBeTruthy();
    const r = await reservation(later.r.id);
    expect(r.status).toBe("RESERVED");
    expect(r.rooms[0].room.number).toBe("101");
    expect((await reservation(payer.r.id)).status).toBe("CANCELLED");
  });
});

describe("Try again on the payment page after the room moved to a dearer one", () => {
  it("asks the whole new price it announced, never the old amount — and shows it", async () => {
    const q = await newQr();
    const s = stayIn(11);
    await dearer402(s);
    const b = await qrBooking(q.token, s, "302");
    // The first try is refused by nTZS: back to pay later on 302, with a payment page to try again from.
    refuseNext = 422;
    await expect(qrPayNow(q.token, b.reference, b.manageToken, { phone: b.phone, clientKey: key(), ip: ip() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await reservation(b.r.id)).toMatchObject({ status: "INQUIRY", holdUntil: null });
    const failed = await db.mobilePayment.findFirstOrThrow({ where: { reservationId: b.r.id }, orderBy: { createdAt: "desc" } });
    // Refused before reaching the phone: the page says why, and has nothing to "check again".
    const view = (await customerPaymentByToken(failed.publicToken!))!;
    expect(view).toMatchObject({ status: "FAILED", sent: false, retryAmount: b.r.netAmount });
    expect(view.message).toMatch(/That number cannot receive/);

    // Meanwhile someone books 302 and pays.
    const taker = await qrBooking(q.token, s, "302", "ONLINE", "Quick Payer");
    await ntzsConfirms(taker.payToken!);
    // Try again: moved to 402 at the new price — said first, nothing asked of the phone.
    const asked = sent.length;
    const moved = await retryCustomerPayment(failed.publicToken!, { clientKey: key(), ip: ip() }).catch((e: unknown) => e);
    expect(moved).toMatchObject({ code: "CONFLICT" });
    const after = await reservation(b.r.id);
    expect(after.rooms[0].room.number).toBe("402");
    expect(after.netAmount).not.toBe(b.r.netAmount);
    expect(String((moved as Error).message)).toContain(`TZS ${after.netAmount.toLocaleString("en-US")}`);
    expect(sent).toHaveLength(asked);
    // The payment page now offers the new amount.
    expect((await customerPaymentByToken(failed.publicToken!))!.retryAmount).toBe(after.netAmount);
    // Try again once more: the whole new price is asked — and paid, nothing left owing.
    const again = await retryCustomerPayment(failed.publicToken!, { clientKey: key(), ip: ip() });
    expect(sent.at(-1)).toMatchObject({ amountTzs: after.netAmount });
    await ntzsConfirms(again.token);
    expect(await reservation(b.r.id)).toMatchObject({ status: "CONFIRMED", balanceAmount: 0 });
  });
});

describe("the QR confirmation never calls an unpaid pay-later booking 'reserved'", () => {
  it("kept only while paying (moved to a dearer room, nothing asked yet): not PAY_AT_HOTEL; the payment stopped: not held at all", async () => {
    const q = await newQr();
    const s = stayIn(15);
    await dearer402(s);
    const b = await qrBooking(q.token, s, "302");
    const taker = await qrBooking(q.token, s, "302", "ONLINE", "Quick Payer");
    await ntzsConfirms(taker.payToken!);
    await expect(qrPayNow(q.token, b.reference, b.manageToken, { phone: b.phone, clientKey: key(), ip: ip() })).rejects.toMatchObject({ code: "CONFLICT" });
    const c = await qrConfirmation(q.token, b.reference, b.manageToken, { check: false });
    expect(c).toMatchObject({ state: "ok", booking: { status: "RESERVED", roomHeld: true, payWay: "HOTEL" } });
    expect(c.state === "ok" && c.booking.paymentStatus).not.toBe("PAY_AT_HOTEL");
    // The guest's own number is offered for Pay now.
    expect(c.state === "ok" && c.booking.guestPhone?.replace(/\D/g, "")).toBe(b.phone);

    // Pressed again, then the guest stops the payment: the room is let go at once — not kept for the 30 minutes.
    const pay = await qrPayNow(q.token, b.reference, b.manageToken, { phone: b.phone, clientKey: key(), ip: ip() });
    await cancelCustomerPayment(pay.token);
    expect(await reservation(b.r.id)).toMatchObject({ status: "INQUIRY", holdUntil: null });
    const after = await qrConfirmation(q.token, b.reference, b.manageToken, { check: false });
    expect(after).toMatchObject({ state: "ok", booking: { status: "INQUIRY", roomHeld: false } });
    expect(await offered(q.token, s, "executive")).toContain("402");
  });
});

describe("Pay now that never reached the phone does not keep the room", () => {
  it("a refused payment request lets the room go at once; the booking stays (not held) and Try again checks the room again", async () => {
    const q = await newQr();
    const s = stayIn(17);
    refuseNext = 422;
    const b = await qrBooking(q.token, s, "101", "ONLINE", "Wrong Number");
    expect(sent).toHaveLength(0);
    expect(await offered(q.token, s, "twin")).toContain("101");
    const r = await reservation(b.r.id);
    expect(r).toMatchObject({ status: "INQUIRY", holdUntil: null, cancelledAt: null });
    expect(await getBookingForGuest(b.reference, b.manageToken)).toMatchObject({ status: "INQUIRY", payLater: true });
    // The right number this time: the room is checked again and held while paying, then paid.
    const again = await retryCustomerPayment(b.payToken!, { phone: phone(), clientKey: key(), ip: ip() });
    expect((await reservation(b.r.id)).status).toBe("RESERVED");
    await ntzsConfirms(again.token);
    expect((await reservation(b.r.id)).status).toBe("CONFIRMED");
  });

  it("one number keeps at most two rooms waiting for its payment", async () => {
    const q = await newQr();
    const p = phone();
    const book = (days: number, room: string) => qrBook(q.token, { ...stayIn(days), roomNumber: room, guest: { fullName: "Hold Many", phone: phone() }, pay: "ONLINE", payPhone: p, clientKey: key() }, { ip: ip(), track: false });
    await book(20, "104");
    await book(24, "105");
    await expect(book(28, "106")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.reservation.count({ where: { status: "RESERVED", rooms: { some: { room: { number: "106" } } } } })).toBe(0);
  });
});

describe("reception works a pay-later booking like any other", () => {
  it("its dates change at the desk (still not held), and an early guest checks in", async () => {
    const q = await newQr();
    const s = stayIn(6);
    const b = await qrBooking(q.token, s, "104");
    const desk = await receptionistActor();
    const rr = b.r.rooms[0];
    await changeStayDates(rr.id, { arrivalDate: s.checkIn, departureDate: addDays(s.checkOut, 1) }, desk);
    const longer = await reservation(b.r.id);
    expect(longer).toMatchObject({ status: "INQUIRY", holdUntil: null });
    expect(longer.rooms[0]).toMatchObject({ status: "INQUIRY", nights: 3 });
    expect(longer.netAmount).toBeGreaterThan(b.r.netAmount);
    // They come early: moved to today, then checked in (what the check-in desk's one tap does).
    await changeStayDates(rr.id, { arrivalDate: today(), departureDate: addDays(today(), 2) }, desk);
    await assignAndCheckIn(b.r.id, { guest: { idType: "NIDA", idNumber: "TZ-EARLY-1" } }, desk);
    expect((await reservation(b.r.id)).status).toBe("CHECKED_IN");
  });

  it("Reservations 'Arriving today' lists a pay-later guest arriving today", async () => {
    const q = await newQr();
    const b = await qrBooking(q.token, stayIn(0, 1), "206");
    const d = new Date(`${today()}T00:00:00Z`);
    // The same filter as the Reservations page's "Arriving today" (src/app/staff/(app)/reservations/page.tsx).
    const arrivals = await db.reservation.findMany({
      where: {
        rooms: { some: { status: { in: ["RESERVED", "CONFIRMED", "INQUIRY"] }, OR: [{ arrivalDate: { lte: d }, departureDate: { gt: d } }, { arrivalDate: d, isDayUse: true }] } },
        status: { in: ["RESERVED", "CONFIRMED", "INQUIRY"] },
      },
      select: { id: true },
    });
    expect(arrivals.map((x) => x.id)).toContain(b.r.id);
  });

  it("check-in desk: a pay-later room busy only today (an early arrival) is not reported as 'taken by a guest who paid first'", async () => {
    const st = await roomType("DOUBLE_DELUXE");
    const desk = await receptionistActor();
    const q = await newQr();
    const room = st.rooms.find((r) => r.number === "309")!;
    await createReservation({ sourceCode: "WALK_IN", guest: { fullName: "In Tonight", phone: phone() }, stay: { kind: "walkIn", nights: 1 }, checkInNow: true, rooms: [{ roomTypeId: st.id, roomId: room.id, adults: 1, children: 0 }] }, desk);
    const b = await qrBooking(q.token, stayIn(7), "309");
    const card = await getCheckInBooking(b.r.id, today());
    expect(card!.rooms[0].current).toMatchObject({ taken: false, busy: true, ready: false });
  });

  it("a payment request reception sends on a desk enquiry holds the room while it is paid — and it stays an enquiry", async () => {
    const desk = await receptionistActor();
    const st = await roomType("DOUBLE_DELUXE");
    const s = stayIn(8);
    const room = st.rooms.find((r) => r.number === "308")!;
    const r = await createReservation({
      sourceCode: "PHONE", status: "INQUIRY", guest: { fullName: "Desk Enquiry", phone: phone() }, stay: { kind: "overnight", arrivalDate: s.checkIn, departureDate: s.checkOut },
      rooms: [{ roomTypeId: st.id, roomId: room.id, adults: 1, children: 0 }],
    }, desk);
    const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: r.balanceAmount }, phone(), { ...desk, userId: desk.userId! });
    expect((await reservation(r.id)).status).toBe("RESERVED");
    // A staff request on a room held only while it is paid times out like the guest's own (never hours).
    expect(mp.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    await db.mobilePayment.update({ where: { id: mp.id }, data: { status: "EXPIRED" } });
    await db.reservation.update({ where: { id: r.id }, data: { holdUntil: new Date(Date.now() - 60_000) } });
    await expireUnpaidHolds();
    const back = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    // Back to an enquiry — never turned into an online pay-later booking.
    expect(back).toMatchObject({ status: "INQUIRY", holdUntil: null });
    expect(back.externalData && (back.externalData as Record<string, unknown>).payLater).toBeFalsy();
    expect(back.externalData && (back.externalData as Record<string, unknown>).payingHold).toBeFalsy();
  });

  it("a room re-checked at payment is on the booking's room moves, in plain words", async () => {
    const q = await newQr();
    const s = stayIn(10);
    const b = await qrBooking(q.token, s, "105");
    const taker = await qrBooking(q.token, s, "105", "ONLINE", "Quick Payer");
    await ntzsConfirms(taker.payToken!);
    await holdForPayment(b.r.id, { userId: null, label: "Customer · online" });
    const moved = await db.roomAssignment.findFirstOrThrow({ where: { reservationRoom: { reservationId: b.r.id } }, include: { fromRoom: true, toRoom: true } });
    expect(moved).toMatchObject({ source: "PAYMENT", fromRoom: { number: "105" } });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "reservation.paying_hold", entityId: b.r.id } });
    expect((log.after as { moved: string[] }).moved[0]).toMatch(/^105 → \d+ \(Double Deluxe\)$/);
  });
});

describe("paying a pay-later booking from the stay link", () => {
  it("is a booking payment: offered with 'Room bookings' on (even with 'Guest bills' off), confirmed by message", async () => {
    await db.hotelSettings.updateMany({ data: { onlinePayStayBill: false, onlinePayBooking: true } });
    const q = await newQr();
    const b = await qrBooking(q.token, stayIn(15), "307");
    const r = await db.reservation.findUniqueOrThrow({ where: { id: b.r.id }, select: { guestToken: true } });
    expect(r.guestToken).toBeTruthy();
    expect(await stayBillPayOnline({ guestToken: r.guestToken! })).toMatchObject({ offered: true });
    const pay = await payStayBillOnline({ guestToken: r.guestToken! }, { phone: b.phone, clientKey: key(), ip: ip() });
    const mp = await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: pay.token } });
    expect(BOOKING_PAY_SOURCES).toContain(mp.source);
    expect((await customerPaymentByToken(pay.token))!.what).toBe(`Room booking ${b.reference}`);
    await ntzsConfirms(pay.token);
    expect((await reservation(b.r.id)).status).toBe("CONFIRMED");
  });
});
