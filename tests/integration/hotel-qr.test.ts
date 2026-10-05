import { randomInt } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createReservation } from "@/server/services/reservations";
import { getBookingForGuest } from "@/server/services/public-booking";
import { stayView } from "@/server/services/guest-comms";
import { quoteStay } from "@/server/services/pricing";
import { cancelCustomerPayment, customerPaymentByToken } from "@/server/services/online-pay";
import { staffAlerts } from "@/server/services/staff-alerts";
import {
  activeBookingQr, archiveBookingQr, bookingQrAnalytics, bookingQrCodes, createBookingQr, hotelQrHistory, qrBookings, qrConfirmPath, QR_PAY_HOTEL_NOTE,
  recordQrEvent, regenerateBookingQr, setBookingQrActive, setHotelQrSettings, updateBookingQr,
} from "@/server/services/booking-qr";
import { hotelQrSetup, qrBook, qrConfirmation, qrLanding, qrPayNow, qrQuote, qrSearch, type QrBookInput } from "@/server/services/hotel-qr";
import { internationalPhone, shortName } from "@/lib/guest-messages";
import { addDays, businessDateOf } from "@/lib/time/business-date";
import { managerActor, receptionistActor, resetBusinessData, roomType, waiterActor } from "../support/helpers";

/**
 * HOTEL BOOKING QR (owner, 2026-10-05): scan → rooms → availability → book → pay → confirm, as a booking channel of the
 * one system — the same availability, prices, reservations, customers, holds and nTZS payments as the website and
 * reception, with the source HOTEL_QR. nTZS and the messaging provider are faked here (no real money, no real texts).
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
let sent: Record<string, unknown>[] = [];
let texts: { to: string; text: string; event: string }[] = [];

beforeEach(async () => {
  await resetBusinessData();
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_events"`);
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_codes" WHERE "id" <> 'bqr_reception'`);
  await db.hotelSettings.updateMany({ data: { hotelQrEnabled: true, hotelQrPayAtHotel: true, onlinePayEnabled: true, onlinePayBooking: true, unpaidHoldHours: 24, guestNotifications: {} } });
  process.env.NTZS_API_KEY = "ntzs_test_unit";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
  delete process.env.GUEST_NOTIFY_WEBHOOK_URL;
  deposits = {}; sent = []; texts = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "https://notify.test/hook") {
      texts.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }
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
afterEach(async () => {
  vi.restoreAllMocks();
  await db.priceRule.deleteMany({ where: { name: { startsWith: "QR test" } } });
});
afterAll(async () => {
  for (const [k, v] of [["NTZS_API_KEY", ENV.key], ["NTZS_WEBHOOK_SECRET", ENV.secret], ["GUEST_NOTIFY_WEBHOOK_URL", ENV.notify]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await resetBusinessData();
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_events"`);
  await db.$executeRawUnsafe(`DELETE FROM "booking_qr_codes" WHERE "id" <> 'bqr_reception'`);
  await db.hotelSettings.updateMany({ data: { hotelQrEnabled: true, hotelQrPayAtHotel: true } });
});

async function newQr(label = "Entrance") {
  return createBookingQr({ label, placement: "By the gate" }, await managerActor());
}

/** A free Double Deluxe room for the stay, as the QR app finds it. */
async function freeRoom(token: string, s: ReturnType<typeof stayIn>, skip: string[] = []) {
  const res = await qrSearch(token, { ...s, roomType: "double-deluxe" }, { track: false });
  const room = res.types[0]?.rooms.find((r) => !skip.includes(r.number));
  if (!room) throw new Error("no free Double Deluxe room");
  return room;
}

async function book(token: string, o: Partial<QrBookInput> & { days?: number; name?: string; phone?: string; ip?: string } = {}) {
  const s = { ...stayIn(o.days ?? 10), ...(o.checkIn ? { checkIn: o.checkIn, checkOut: o.checkOut! } : {}) };
  const p = o.phone ?? phone();
  const roomNumber = o.roomNumber ?? (await freeRoom(token, s)).number;
  const booked = await qrBook(token, {
    ...s, roomNumber, guest: { fullName: o.name ?? "Neema Scanner", phone: p, email: o.guest?.email ?? null },
    pay: o.pay ?? "HOTEL", clientKey: o.clientKey ?? key(), payPhone: o.payPhone ?? null, arrivalTime: o.arrivalTime ?? null, specialRequest: o.specialRequest ?? null,
    transportRequest: o.transportRequest ?? null,
  }, { ip: o.ip ?? ip(), track: false });
  const r = await db.reservation.findUniqueOrThrow({ where: { reference: booked.reference }, include: { source: true, guest: true, rooms: { include: { room: true } } } });
  return { ...booked, r, phone: p, roomNumber, stay: s };
}

const depositOf = async (token: string) => (await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: token } })).depositId!;
/** nTZS confirms the payment behind this page (seen when the page or the confirmation asks again). */
async function ntzsConfirms(payToken: string) {
  deposits[await depositOf(payToken)].status = "completed";
  await db.mobilePayment.updateMany({ where: { publicToken: payToken }, data: { lastCheckedAt: null } });
}

describe("the Hotel QR codes", () => {
  it("made and listed with its link and drawing; reception sees them but cannot change them", async () => {
    const m = await managerActor(), desk = await receptionistActor();
    const q = await newQr("Entrance");
    await expect(createBookingQr({ label: "Lobby" }, desk)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(regenerateBookingQr(q.id, desk)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setHotelQrSettings({ enabled: false }, desk)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const cards = await bookingQrCodes(desk, { origin: "https://hotel.test" });
    const card = cards.find((c) => c.id === q.id)!;
    expect(card).toMatchObject({ label: "Entrance", placement: "By the gate", url: `https://hotel.test/b/${q.token}`, active: true, archived: false, scans: 0, bookings: 0 });
    expect(card.qr.startsWith("<svg")).toBe(true);
    await updateBookingQr(q.id, { label: "Main entrance", placement: null }, m);
    expect((await bookingQrCodes(m, { origin: "https://hotel.test" })).find((c) => c.id === q.id)).toMatchObject({ label: "Main entrance", placement: null });
    await expect(bookingQrCodes(await waiterActor())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await hotelQrSetup(desk)).toMatchObject({ bookingOn: true, payAtHotel: true, payOnline: true, canManage: false, canSeeNumbers: false });
    expect(await hotelQrSetup(m)).toMatchObject({ canManage: true, canSeeNumbers: true });
  });

  it("a new code stops the old one everywhere at once; switched off and archived codes do not work; every change is in the history", async () => {
    const m = await managerActor();
    const q = await newQr();
    const before = await book(q.token, { days: 30 });
    const old = q.token;
    const { token } = await regenerateBookingQr(q.id, m);
    expect(token).not.toBe(old);
    expect(token).toMatch(/^[a-f0-9]{24}$/);

    // The old card: nothing works any more.
    expect(await activeBookingQr(old)).toBeNull();
    expect(await qrLanding(old)).toMatchObject({ active: false });
    await expect(qrSearch(old, stayIn(10))).rejects.toThrow(/no longer active/);
    await expect(qrQuote(old, { ...stayIn(10), roomNumber: before.roomNumber })).rejects.toThrow(/no longer active/);
    await expect(qrBook(old, { ...stayIn(12), roomNumber: before.roomNumber, guest: { fullName: "Late Guest", phone: phone() }, pay: "HOTEL", clientKey: key() }, { ip: ip() })).rejects.toThrow(/no longer active/);
    expect(await recordQrEvent(old, "SCAN", { visitor: hex(32) })).toBe(false);
    // A booking made before keeps working — on its own page.
    expect(await qrConfirmation(old, before.reference, before.manageToken)).toEqual({ state: "moved", href: `/booking/${before.reference}?token=${encodeURIComponent(before.manageToken)}` });
    expect((await qrConfirmation(token, before.reference, before.manageToken)).state).toBe("ok");
    expect((await db.reservation.findUniqueOrThrow({ where: { id: before.r.id } })).bookingQrId).toBe(q.id);

    // The new card works.
    expect(await qrLanding(token)).toMatchObject({ active: true });

    // Switched off (revoked), then on again.
    await setBookingQrActive(q.id, false, m);
    expect((await db.bookingQrCode.findUniqueOrThrow({ where: { id: q.id } })).revokedAt).not.toBeNull();
    expect(await qrLanding(token)).toMatchObject({ active: false });
    await expect(qrSearch(token, stayIn(10))).rejects.toThrow(/no longer active/);
    await setBookingQrActive(q.id, true, m);
    expect(await qrLanding(token)).toMatchObject({ active: true });

    // Archived: gone from the list, not working, its booking still linked.
    await archiveBookingQr(q.id, m);
    expect(await activeBookingQr(token)).toBeNull();
    expect((await bookingQrCodes(m, { origin: "https://hotel.test" })).some((c) => c.id === q.id)).toBe(false);
    expect((await bookingQrCodes(m, { origin: "https://hotel.test", archived: true })).find((c) => c.id === q.id)).toMatchObject({ archived: true, active: false, bookings: 1 });
    await expect(regenerateBookingQr(q.id, m)).rejects.toThrow(/archived/);

    const history = await hotelQrHistory(m);
    const mine = history.filter((h) => h.qrId === q.id).map((h) => h.action);
    expect(mine).toEqual(expect.arrayContaining(["hotel_qr.created", "hotel_qr.regenerated", "hotel_qr.disabled", "hotel_qr.enabled", "hotel_qr.archived"]));
    // A token is a key: never written to the history.
    expect(JSON.stringify(history)).not.toContain(old);
    expect(JSON.stringify(history)).not.toContain(token);
    await expect(hotelQrHistory(await receptionistActor())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("booking switched off: the QR still opens the hotel, but nothing can be searched or booked; pay at hotel switched off: online only", async () => {
    const m = await managerActor();
    const q = await newQr();
    expect(await setHotelQrSettings({ enabled: false }, m)).toEqual({ enabled: false, payAtHotel: true });
    const landing = await qrLanding(q.token);
    expect(landing).toMatchObject({ active: true, booking: { open: false } });
    expect(landing.active && landing.booking.message).toMatch(/switched off/);
    await expect(qrSearch(q.token, stayIn(10))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(qrBook(q.token, { ...stayIn(10), roomNumber: "305", guest: { fullName: "Off Guest", phone: phone() }, pay: "HOTEL", clientKey: key() }, { ip: ip() })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await setHotelQrSettings({ enabled: true, payAtHotel: false }, m);
    const l2 = await qrLanding(q.token);
    expect(l2).toMatchObject({ active: true, booking: { open: true, atHotel: false, online: true } });
    const s = stayIn(15);
    const room = await freeRoom(q.token, s);
    await expect(qrBook(q.token, { ...s, roomNumber: room.number, guest: { fullName: "Hotel Payer", phone: phone() }, pay: "HOTEL", clientKey: key() }, { ip: ip() })).rejects.toThrow(/Pay now/);
    expect(await db.reservation.count()).toBe(0);
    const online = await book(q.token, { days: 15, roomNumber: room.number, pay: "ONLINE" });
    expect(online.payToken).toBeTruthy();
    expect(await db.auditLog.count({ where: { action: "hotel_qr.settings" } })).toBe(2);
  });
});

describe("availability and prices", () => {
  it("only rooms that can really be booked: a booked room and a room in maintenance are not offered; meeting rooms never; a party too big is told", async () => {
    const q = await newQr();
    const s = stayIn(20);
    const dd = await roomType("DOUBLE_DELUXE");
    const rooms = dd.rooms.filter((r) => r.isActive);
    const [booked, blocked, free] = rooms;
    await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Phone Guest", phone: phone() }, stay: { kind: "overnight", arrivalDate: s.checkIn, departureDate: s.checkOut },
      rooms: [{ roomTypeId: dd.id, roomId: booked.id, adults: 2, children: 0 }],
    }, await managerActor());
    await db.roomBlock.create({ data: { roomId: blocked.id, type: "MAINTENANCE", startDate: new Date(`${s.checkIn}T00:00:00Z`) } });

    const res = await qrSearch(q.token, s);
    const offered = res.types.flatMap((t) => t.rooms.map((r) => r.number));
    expect(offered).not.toContain(booked.number);
    expect(offered).not.toContain(blocked.number);
    expect(offered).toContain(free.number);
    expect(res.types.some((t) => t.type.slug === "meeting-room")).toBe(false);
    expect(res.stay).toMatchObject({ checkIn: s.checkIn, checkOut: s.checkOut, nights: 2, adults: 2 });
    const ddOffer = res.types.find((t) => t.type.slug === "double-deluxe")!;
    expect(ddOffer.available).toBe(rooms.length - 2);

    await expect(qrQuote(q.token, { ...s, roomNumber: booked.number })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(qrBook(q.token, { ...s, roomNumber: blocked.number, guest: { fullName: "Blocked Try", phone: phone() }, pay: "HOTEL", clientKey: key() }, { ip: ip() }))
      .rejects.toThrow(/just booked/);
    // The meeting room cannot be asked for by its number either.
    const meeting = await db.room.findFirstOrThrow({ where: { roomType: { category: "MEETING_ROOM" } } });
    await expect(qrQuote(q.token, { ...s, roomNumber: meeting.number })).rejects.toMatchObject({ code: "UNAVAILABLE" });

    // Five adults: no single room holds them.
    const big = await qrSearch(q.token, { ...s, adults: 5 });
    expect(big.types).toEqual([]);
    expect(big.tooSmall.map((t) => t.slug)).toContain("double-deluxe");
    // Dates are checked like the website's.
    await expect(qrSearch(q.token, { ...s, checkIn: addDays(today(), -1) })).rejects.toThrow(/past/);
    await expect(qrSearch(q.token, { ...s, checkOut: s.checkIn })).rejects.toThrow(/after check-in/);
  });

  it("the price is the pricing engine's (date prices and the website's promotions, room by room, night by night) — and exactly what the booking stores", async () => {
    const q = await newQr();
    const s = stayIn(25, 3);
    const dd = await roomType("DOUBLE_DELUXE");
    await db.priceRule.create({ data: { name: "QR test busy night", scope: "ROOM_TYPES", roomTypeIds: [dd.id], price: 95_000, startDate: new Date(`${s.checkIn}T00:00:00Z`), endDate: new Date(`${s.checkIn}T00:00:00Z`) } });
    const room = await freeRoom(q.token, s);
    const roomId = dd.rooms.find((r) => r.number === room.number)!.id;
    const engine = await quoteStay(db, { dates: [s.checkIn, addDays(s.checkIn, 1), addDays(s.checkIn, 2)], base: dd.baseRate, roomTypeId: dd.id, roomId, channel: "WEBSITE" });
    expect(room.total).toBe(engine.net);
    expect(room.gross).toBe(engine.gross);

    const quote = await qrQuote(q.token, { ...s, roomNumber: room.number });
    expect(quote.total).toBe(engine.net);
    expect(quote.nights).toHaveLength(3);
    expect(quote.nights[0]).toMatchObject({ date: s.checkIn, price: 95_000, datePrice: "QR test busy night" });
    expect(quote.nights[1].price).toBe(dd.baseRate);
    expect(quote.sameEveryNight).toBe(false);
    expect(quote.room.number).toBe(room.number);
    expect(quote.policies.join(" ")).toMatch(/Check-in from/);

    const b = await book(q.token, { checkIn: s.checkIn, checkOut: s.checkOut, roomNumber: room.number });
    expect(b.r.netAmount).toBe(engine.net);
    expect(b.r.balanceAmount).toBe(engine.net);
  });
});

describe("booking from the QR", () => {
  it("pay at hotel: a held reservation from this QR (source HOTEL_QR, the hotel's hold); the customer is found by phone; the same press twice is one booking", async () => {
    const q = await newQr();
    const p = phone(), k = key();
    const b = await book(q.token, { days: 12, phone: p, name: "Asha Mwema", arrivalTime: "18:30", specialRequest: "Quiet room please", clientKey: k });
    expect(b.r.source.code).toBe("HOTEL_QR");
    expect(b.r.bookingQrId).toBe(q.id);
    expect(b.r.status).toBe("RESERVED");
    expect(b.r.holdUntil!.getTime() - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    expect(b.r.holdUntil!.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    expect(b.r.internalNotes).toContain(QR_PAY_HOTEL_NOTE);
    expect(b.r).toMatchObject({ eta: "18:30", specialRequests: "Quiet room please" });
    expect(b.r.rooms.map((x) => x.room.number)).toEqual([b.roomNumber]);
    expect(b).toMatchObject({ payWay: "HOTEL", payToken: null, payUrl: null, confirmUrl: qrConfirmPath(q.token, b.reference, b.manageToken) });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "reservation.created", entityId: b.r.id } });
    expect(log).toMatchObject({ actorLabel: "Hotel QR", after: expect.objectContaining({ source: "HOTEL_QR", bookingQr: "Entrance" }) });

    // The same press again: the same booking.
    const again = await qrBook(q.token, { ...b.stay, roomNumber: b.roomNumber, guest: { fullName: "Asha Mwema", phone: p }, pay: "HOTEL", clientKey: k }, { ip: ip() });
    expect(again.reference).toBe(b.reference);
    expect(await db.reservation.count()).toBe(1);

    // The desk cannot book "as" the QR: its bookings come from a scanned code only (the numbers stay true).
    const dd = await roomType("DOUBLE_DELUXE");
    await expect(createReservation({
      sourceCode: "HOTEL_QR", guest: { fullName: "Desk Guest", phone: phone() }, stay: { kind: "overnight", arrivalDate: addDays(today(), 50), departureDate: addDays(today(), 51) },
      rooms: [{ roomTypeId: dd.id, adults: 1, children: 0 }],
    }, await managerActor())).rejects.toThrow(/made by guests from the QR/);

    // Booking again with the same number: the same customer (never saved twice).
    const second = await book(q.token, { days: 40, phone: p.replace(/^0/, "+255"), name: "Asha M." });
    expect(second.r.guestId).toBe(b.r.guestId);
    expect(await db.guest.count({ where: { phone: b.r.guest.phone } })).toBe(1);

    // The guest's confirmation: by reference and its private key only.
    const c = await qrConfirmation(q.token, b.reference, b.manageToken);
    expect(c.state).toBe("ok");
    if (c.state !== "ok") return;
    expect(c.booking).toMatchObject({
      reference: b.reference, status: "RESERVED", confirmed: false, paymentStatus: "PAY_AT_HOTEL", payWay: "HOTEL", rooms: [{ number: b.roomNumber, typeSlug: "double-deluxe" }],
      checkIn: b.stay.checkIn, checkOut: b.stay.checkOut, nights: 2, adults: 2, total: b.r.netAmount, paid: 0, balance: b.r.netAmount, canPayNow: true, livePayment: null,
      bookingLink: `/booking/${b.reference}?token=${encodeURIComponent(b.manageToken)}`, arrivalTime: "18:30",
    });
    expect(c.booking.holdUntil).toBe(b.r.holdUntil!.toISOString());
    expect(c.booking.stayLink).toBe(`/stay/${b.r.guestToken}`);
    expect(await qrConfirmation(q.token, b.reference, "x".repeat(32))).toEqual({ state: "not_found" });
    expect(await qrConfirmation(q.token, "VLH-NOPE99", b.manageToken)).toEqual({ state: "not_found" });
    expect(await qrConfirmation(q.token, b.reference, b.manageToken.slice(0, -1))).toEqual({ state: "not_found" });
  });

  it("two people book the same room for the same dates at once: one gets it, the other is told it was just taken", async () => {
    const q = await newQr();
    const s = stayIn(18);
    const room = await freeRoom(q.token, s);
    const tries = await Promise.allSettled([1, 2].map((i) => qrBook(q.token, {
      ...s, roomNumber: room.number, guest: { fullName: `Racer ${i}`, phone: phone() }, pay: i === 1 ? "HOTEL" : "ONLINE", clientKey: key(),
    }, { ip: ip() })));
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1);
    const lost = tries.find((t) => t.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "UNAVAILABLE" });
    expect(String(lost.reason.message)).toMatch(new RegExp(`Room ${room.number} was just booked`));
    expect(await db.reservationRoom.count({ where: { room: { number: room.number }, status: { not: "CANCELLED" } } })).toBe(1);
    // Taken now: no longer offered.
    expect((await qrSearch(q.token, s, { track: false })).types.flatMap((t) => t.rooms.map((r) => r.number))).not.toContain(room.number);
  });

  it("pay online: held 30 minutes with one payment request for the exact amount — confirmed only once nTZS confirms; the same press is one booking and one payment", async () => {
    const q = await newQr();
    const b = await book(q.token, { days: 14, pay: "ONLINE" });
    expect(b.payToken).toBeTruthy();
    expect(b.payUrl).toBe(`/pay/${b.payToken}`);
    expect(b.payError).toBeNull();
    expect(b.r).toMatchObject({ status: "RESERVED", paidAmount: 0 });
    expect(b.r.holdUntil!.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    const mp = await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: b.payToken! } });
    expect(mp).toMatchObject({ source: "HOTEL_QR", status: "PENDING", amount: b.r.balanceAmount, reservationId: b.r.id, initiator: "CUSTOMER" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ amountTzs: b.r.netAmount });

    // Pressing Pay is not paying.
    const waiting = await qrConfirmation(q.token, b.reference, b.manageToken);
    expect(waiting).toMatchObject({ state: "ok", booking: { status: "RESERVED", confirmed: false, paymentStatus: "PAYMENT_PENDING", livePayment: b.payToken, canPayNow: false, ntzsReference: null } });

    // The same press again: the same booking and payment — nothing new asked of the phone.
    const again = await qrBook(q.token, { ...b.stay, roomNumber: b.roomNumber, guest: { fullName: "Neema Scanner", phone: b.phone }, pay: "ONLINE", clientKey: mp.clientKey!.slice(5) }, { ip: ip() });
    expect(again).toMatchObject({ reference: b.reference, payToken: b.payToken });
    expect(sent).toHaveLength(1);
    expect(await db.reservation.count()).toBe(1);

    // The payment page goes back to the QR's confirmation.
    const page = await customerPaymentByToken(b.payToken!);
    expect(page).toMatchObject({ status: "PENDING", what: `Room booking ${b.reference}`, back: { href: qrConfirmPath(q.token, b.reference, b.manageToken) } });

    // nTZS confirms: paid, confirmed, its reference shown — recorded once.
    await ntzsConfirms(b.payToken!);
    const paid = await qrConfirmation(q.token, b.reference, b.manageToken);
    expect(paid).toMatchObject({ state: "ok", booking: { status: "CONFIRMED", confirmed: true, paymentStatus: "PAID", payWay: "ONLINE", paid: b.r.netAmount, balance: 0, holdUntil: null, ntzsReference: "MP777ABC", canPayNow: false } });
    const r = await db.reservation.findUniqueOrThrow({ where: { id: b.r.id }, include: { payments: true } });
    expect(r).toMatchObject({ status: "CONFIRMED", holdUntil: null, paidAmount: b.r.netAmount });
    expect(r.payments).toHaveLength(1);

    // Reception's list: the booking, PAID, with nTZS's reference and the QR it came from.
    const rows = await qrBookings(await receptionistActor());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reference: b.reference, source: "HOTEL_QR", paymentStatus: "PAID", payWay: "ONLINE", ntzsReference: "MP777ABC", paid: b.r.netAmount, balance: 0, qr: { id: q.id, label: "Entrance" }, rooms: [{ number: b.roomNumber }] });
    expect((await qrBookings(await receptionistActor(), { view: "waiting" }))).toHaveLength(0);
    expect((await qrBookings(await receptionistActor(), { q: b.reference.slice(-4) })).map((x) => x.reference)).toEqual([b.reference]);

    // The QR switched off later: the payment page and the confirmation send the guest to the booking's own page.
    await setBookingQrActive(q.id, false, await managerActor());
    expect((await customerPaymentByToken(b.payToken!))!.back!.href).toBe(`/booking/${b.reference}?token=${b.manageToken}`);
    expect((await qrConfirmation(q.token, b.reference, b.manageToken)).state).toBe("moved");
  });

  it("a payment that did not go through: failed or timed out is shown as such, and Pay now asks again for what is owed", async () => {
    const q = await newQr();
    const b = await book(q.token, { days: 16, pay: "ONLINE" });
    await cancelCustomerPayment(b.payToken!);
    expect(await qrConfirmation(q.token, b.reference, b.manageToken, { check: false })).toMatchObject({ booking: { paymentStatus: "PAYMENT_FAILED", canPayNow: true } });
    await db.mobilePayment.updateMany({ where: { publicToken: b.payToken! }, data: { status: "EXPIRED" } });
    expect(await qrConfirmation(q.token, b.reference, b.manageToken, { check: false })).toMatchObject({ booking: { paymentStatus: "PAYMENT_EXPIRED" } });
    const again = await qrPayNow(q.token, b.reference, b.manageToken, { phone: b.phone, clientKey: key(), ip: ip() });
    const mp = await db.mobilePayment.findUniqueOrThrow({ where: { publicToken: again.token } });
    expect(mp).toMatchObject({ source: "HOTEL_QR", amount: b.r.balanceAmount, status: "PENDING" });
    await expect(qrPayNow(q.token, b.reference, "y".repeat(32), { phone: b.phone, clientKey: key(), ip: ip() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("keeping guests and rooms safe", () => {
  it("a press's key finds only the booking it made — never another guest's, from their phone, dates or room; the key itself is not kept", async () => {
    const q = await newQr();
    const victim = await book(q.token, { days: 12, name: "Victim Guest" });
    const k = key();
    const mine = await book(q.token, { days: 30, name: "Other Guest", clientKey: k });
    // My key again, with the other guest's phone, dates and room: my booking is named — theirs never.
    const err = await qrBook(q.token, { ...victim.stay, roomNumber: victim.roomNumber, guest: { fullName: "Other Guest", phone: victim.phone }, pay: "HOTEL", clientKey: k }, { ip: ip() })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "CONFLICT" });
    expect(String((err as Error).message)).toContain(mine.reference);
    expect(String((err as Error).message)).not.toContain(victim.reference);
    expect(String((err as Error).message)).not.toMatch(/being made/);
    // A fresh key with their details: a new attempt — their room is taken — never their booking.
    await expect(qrBook(q.token, { ...victim.stay, roomNumber: victim.roomNumber, guest: { fullName: "Other Guest", phone: victim.phone }, pay: "HOTEL", clientKey: key() }, { ip: ip() }))
      .rejects.toMatchObject({ code: "UNAVAILABLE" });
    // The same key with the same booking: the same booking (a lost answer).
    expect((await qrBook(q.token, { ...mine.stay, roomNumber: mine.roomNumber, guest: { fullName: "Other Guest", phone: mine.phone }, pay: "HOTEL", clientKey: k }, { ip: ip() })).reference).toBe(mine.reference);
    // Only a hash of the key is kept with the booking.
    const stored = await db.reservation.findUniqueOrThrow({ where: { id: mine.r.id }, select: { externalData: true } });
    expect(JSON.stringify(stored.externalData)).not.toContain(k);
    expect(await db.reservation.count()).toBe(2);
  });

  it("a booking that failed (the room was just taken) frees its key: the same press can run again — not 'being made' for an hour", async () => {
    const q = await newQr();
    const s = stayIn(19);
    const [room, other] = (await qrSearch(q.token, { ...s, roomType: "double-deluxe" }, { track: false })).types[0].rooms;
    for (const pay of ["HOTEL", "ONLINE"] as const) {
      const keys = [key(), key()];
      const target = pay === "HOTEL" ? room.number : other.number;
      const tries = await Promise.allSettled(keys.map((k, i) => qrBook(q.token, {
        ...s, roomNumber: target, guest: { fullName: `Racer ${pay} ${i}`, phone: phone() }, pay, clientKey: k,
      }, { ip: ip() })));
      const lost = tries.findIndex((t) => t.status === "rejected");
      expect(lost).toBeGreaterThanOrEqual(0);
      expect((tries[lost] as PromiseRejectedResult).reason).toMatchObject({ code: "UNAVAILABLE" });
      expect(await db.rateLimitBucket.count({ where: { key: `book-once:${keys[lost]}` } })).toBe(0);
      // Pressed again (the answer was lost) for another room: booked — not "being made".
      const free = (await qrSearch(q.token, s, { track: false })).types.flatMap((t) => t.rooms).find((r) => r.number !== room.number && r.number !== other.number)!;
      const again = await qrBook(q.token, { ...s, roomNumber: free.number, guest: { fullName: "Second Try", phone: phone() }, pay, clientKey: keys[lost] }, { ip: ip() });
      expect(again.reference).toMatch(/^VLH-/);
    }
  });

  it("pay at the hotel has limits that do not depend on the phone typed: long stays, far-ahead holds, a share of the rooms, holds per device", async () => {
    const q = await newQr();
    // More than 14 nights: Pay now only (the payment confirms the booking).
    const long = stayIn(10, 15);
    const longRoom = await freeRoom(q.token, long);
    const lq = await qrQuote(q.token, { ...long, roomNumber: longRoom.number });
    expect(lq.pay).toMatchObject({ online: true, atHotel: false });
    expect(lq.pay.atHotelNote).toMatch(/14 nights/);
    await expect(qrBook(q.token, { ...long, roomNumber: longRoom.number, guest: { fullName: "Long Stay", phone: phone() }, pay: "HOTEL", clientKey: key() }, { ip: ip() }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    // A 24-hour hold for an arrival in 10 days is "pay within", never "pay when you arrive".
    const soon = stayIn(10);
    const soonRoom = await freeRoom(q.token, soon);
    expect((await qrQuote(q.token, { ...soon, roomNumber: soonRoom.number })).pay).toMatchObject({ atHotel: true, atHotelKeeps: "hold", holdHours: 24 });
    // No hold time: kept until the guest comes — only for arrivals up to 30 days ahead.
    await db.hotelSettings.updateMany({ data: { unpaidHoldHours: 0 } });
    expect((await qrQuote(q.token, { ...soon, roomNumber: soonRoom.number })).pay).toMatchObject({ atHotel: true, atHotelKeeps: "arrival" });
    const far = stayIn(45);
    const farQuote = await qrQuote(q.token, { ...far, roomNumber: (await freeRoom(q.token, far)).number });
    expect(farQuote.pay).toMatchObject({ atHotel: false, online: true });
    expect(farQuote.pay.atHotelNote).toMatch(/30 days/);
    await db.hotelSettings.updateMany({ data: { unpaidHoldHours: 24 } });

    // Unpaid QR holds never cover more than a share of the rooms for the same dates — then Pay now.
    const rooms = await db.room.count({ where: { isActive: true, roomType: { isActive: true, isPublic: true, category: "GUEST_ROOM" } } });
    const cap = Math.max(2, Math.ceil(rooms * 0.2));
    const s = { ...stayIn(60), adults: 1 };
    const free = (await qrSearch(q.token, s, { track: false })).types.flatMap((t) => t.rooms.map((r) => r.number));
    expect(free.length).toBeGreaterThan(cap);
    for (const n of free.slice(0, cap)) {
      await qrBook(q.token, { ...s, roomNumber: n, guest: { fullName: "Held Guest", phone: phone() }, pay: "HOTEL", clientKey: key() }, { ip: ip() });
    }
    const next = free[cap];
    await expect(qrBook(q.token, { ...s, roomNumber: next, guest: { fullName: "One Too Many", phone: phone() }, pay: "HOTEL", clientKey: key() }, { ip: ip() }))
      .rejects.toThrow(/not available for these dates/);
    expect((await qrBook(q.token, { ...s, roomNumber: next, guest: { fullName: "Pays Now", phone: phone() }, pay: "ONLINE", clientKey: key() }, { ip: ip() })).payToken).toBeTruthy();

    // One device (one address): a few unpaid holds a day, whatever numbers are typed.
    const addr = ip();
    for (let i = 0; i < 5; i++) await book(q.token, { days: 70 + i * 3, ip: addr });
    const s6 = stayIn(90);
    await expect(qrBook(q.token, { ...s6, roomNumber: (await freeRoom(q.token, s6)).number, guest: { fullName: "Sixth Hold", phone: phone() }, pay: "HOTEL", clientKey: key() }, { ip: addr }))
      .rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("a QR given a new code: the payment page's link back never hands out the new code to a booking made from the old card", async () => {
    const m = await managerActor();
    const q = await newQr();
    const b = await book(q.token, { days: 14, pay: "ONLINE" });
    expect((await customerPaymentByToken(b.payToken!))!.back!.href).toBe(qrConfirmPath(q.token, b.reference, b.manageToken));
    const { token } = await regenerateBookingQr(q.id, m);
    const back = (await customerPaymentByToken(b.payToken!))!.back!.href;
    expect(back).toBe(`/booking/${b.reference}?token=${b.manageToken}`);
    expect(back).not.toContain(token);
    // A booking made from the new card goes back to it.
    const fresh = await book(token, { days: 17, pay: "ONLINE" });
    expect((await customerPaymentByToken(fresh.payToken!))!.back!.href).toBe(qrConfirmPath(token, fresh.reference, fresh.manageToken));
  });

  it("someone else's phone or email typed on the QR: the booking never shows (or changes) that customer's profile", async () => {
    const q = await newQr();
    const p = phone();
    const dd = await roomType("DOUBLE_DELUXE");
    const desk = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Real Owner", phone: p }, stay: { kind: "overnight", arrivalDate: addDays(today(), 80), departureDate: addDays(today(), 81) },
      rooms: [{ roomTypeId: dd.id, adults: 1, children: 0 }],
    }, await managerActor());
    const owner = await db.guest.findUniqueOrThrow({ where: { id: desk.guestId } });
    expect(owner.email).toBeNull();

    const b = await book(q.token, { days: 12, phone: p, name: "Someone Else", guest: { fullName: "", phone: "", email: "someone@else.test" } });
    // Found by the phone (one customer per number) — but the profile is not changed from a public page…
    expect(b.r.guestId).toBe(owner.id);
    expect(await db.guest.findUniqueOrThrow({ where: { id: owner.id } })).toMatchObject({ fullName: "Real Owner", email: null });
    // …what was typed is on the booking for reception to check.
    expect(b.r.internalNotes).toContain('Booked as name "Someone Else", email someone@else.test');
    // …and the booking's own pages show what was typed, never the profile.
    const page = await getBookingForGuest(b.reference, b.manageToken);
    expect(page).toMatchObject({ guestName: "Someone Else" });
    expect(JSON.stringify(page)).not.toContain("Real Owner");
    const c = await qrConfirmation(q.token, b.reference, b.manageToken);
    expect(c).toMatchObject({ state: "ok", booking: { guestFirstName: "Someone" } });
    expect(JSON.stringify(c)).not.toContain("Real Owner");
    const stay = await stayView({ guestToken: b.r.guestToken! });
    expect(stay!.guestName).toBe(shortName("Someone Else"));

    // An email anyone could type never finds a customer.
    const other = await book(q.token, { days: 15, name: "Email Typer", guest: { fullName: "", phone: "", email: "someone@else.test" } });
    expect(other.r.guestId).not.toBe(owner.id);
    await db.guest.update({ where: { id: other.r.guestId }, data: { email: "victim@mail.test" } });
    const third = await book(q.token, { days: 18, name: "Third Typer", guest: { fullName: "", phone: "", email: "victim@mail.test" } });
    expect(third.r.guestId).not.toBe(other.r.guestId);
  });
});

describe("reception and the guest", () => {
  it("reception's bell: a pay-at-hotel booking rings while it waits; a paid-online one for half an hour after it is paid — each once", async () => {
    const q = await newQr();
    const desk = (await receptionistActor()).permissions!;
    const hotel = await book(q.token, { days: 11, name: "Bell Hotel" });
    const online = await book(q.token, { days: 13, pay: "ONLINE", name: "Bell Online" });
    let alerts = await staffAlerts(desk);
    const qrAlerts = () => alerts.filter((a) => a.id.startsWith("hotelqr:"));
    expect(qrAlerts()).toEqual([expect.objectContaining({ id: `hotelqr:${hotel.r.id}:hotel`, kind: "booking", href: `/staff/reservations/${hotel.r.id}` })]);
    expect(qrAlerts()[0].text).toMatch(new RegExp(`Bell Hotel · Room ${hotel.roomNumber} · .* · pay at hotel`));

    await ntzsConfirms(online.payToken!);
    await customerPaymentByToken(online.payToken!, { check: true });
    alerts = await staffAlerts(desk);
    expect(qrAlerts().map((a) => a.id).sort()).toEqual([`hotelqr:${hotel.r.id}:hotel`, `hotelqr:${online.r.id}:paid`].sort());
    expect(qrAlerts().find((a) => a.id.endsWith(":paid"))!.text).toMatch(/paid online/);

    await db.reservation.update({ where: { id: online.r.id }, data: { confirmedAt: new Date(Date.now() - 31 * 60_000) } });
    alerts = await staffAlerts(desk);
    expect(qrAlerts().map((a) => a.id)).toEqual([`hotelqr:${hotel.r.id}:hotel`]);
    // Not for those who do not follow bookings.
    expect((await staffAlerts((await waiterActor()).permissions!)).some((a) => a.id.startsWith("hotelqr:"))).toBe(false);
  });

  it("the guest gets the booking details by message when a provider is connected — pay at hotel at once, paid online once nTZS confirmed (once)", async () => {
    process.env.GUEST_NOTIFY_WEBHOOK_URL = "https://notify.test/hook";
    const q = await newQr();
    const hotel = await book(q.token, { days: 21, name: "Text Hotel" });
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ to: internationalPhone(hotel.phone), event: "BOOKING_CREATED" });
    expect(texts[0].text).toContain(hotel.reference);
    expect(await db.guestMessage.findFirst({ where: { reservationId: hotel.r.id } })).toMatchObject({ type: "BOOKING_CREATED", status: "SENT", channel: "PROVIDER" });

    const online = await book(q.token, { days: 23, pay: "ONLINE", name: "Text Online" });
    expect(texts).toHaveLength(1); // not before it is paid
    await ntzsConfirms(online.payToken!);
    await qrConfirmation(q.token, online.reference, online.manageToken);
    await qrConfirmation(q.token, online.reference, online.manageToken);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toMatchObject({ event: "BOOKING_CONFIRMED" });
    expect(texts[1].text).toMatch(/Confirmed/);
    expect(await db.guestMessage.count({ where: { reservationId: online.r.id, type: "BOOKING_CONFIRMED" } })).toBe(1);

    // Switched off by the hotel: nothing is sent.
    await db.hotelSettings.updateMany({ data: { guestNotifications: { bookingCreated: false } } });
    await book(q.token, { days: 27, name: "Quiet Guest" });
    expect(texts).toHaveLength(2);
  });
});

describe("the numbers", () => {
  it("scans (once per visitor), searches, selections, attempts — and from the bookings themselves: bookings, payments, money received, conversion — per QR", async () => {
    const m = await managerActor();
    const a = await newQr("Lobby"), b = await newQr("Flyer");
    const v1 = hex(32), v2 = hex(32);
    expect(await recordQrEvent(a.token, "SCAN", { visitor: v1 })).toBe(true);
    expect(await recordQrEvent(a.token, "SCAN", { visitor: v1 })).toBe(false); // a refresh is not a new visit
    expect(await recordQrEvent(a.token, "SCAN", { visitor: v2 })).toBe(true);
    expect(await recordQrEvent(b.token, "SCAN", { visitor: hex(32) })).toBe(true);
    expect((await db.bookingQrCode.findUniqueOrThrow({ where: { id: a.id } })).scanCount).toBe(2);

    const s = stayIn(9);
    const res = await qrSearch(a.token, s, { visitor: v1 });
    const [r1, r2, r3] = res.types.find((t) => t.type.slug === "double-deluxe")!.rooms;
    await qrQuote(a.token, { ...s, roomNumber: r1.number }, { visitor: v1 });
    const visit = { visitor: v1, ip: ip() };
    await qrBook(a.token, { ...s, roomNumber: r1.number, guest: { fullName: "Funnel Hotel", phone: phone() }, pay: "HOTEL", clientKey: key() }, visit);
    const paidB = await qrBook(a.token, { ...s, roomNumber: r2.number, guest: { fullName: "Funnel Paid", phone: phone() }, pay: "ONLINE", clientKey: key() }, visit);
    const failB = await qrBook(a.token, { ...s, roomNumber: r3.number, guest: { fullName: "Funnel Failed", phone: phone() }, pay: "ONLINE", clientKey: key() }, visit);
    await ntzsConfirms(paidB.payToken!);
    await customerPaymentByToken(paidB.payToken!, { check: true });
    await cancelCustomerPayment(failB.payToken!);
    const paid = await db.reservation.findUniqueOrThrow({ where: { reference: paidB.reference } });

    const n = await bookingQrAnalytics(m, { from: today(), to: today() });
    expect(n).toMatchObject({
      scans: 3, searches: 1, selections: 1, attempts: 3, bookings: 3, confirmed: 1, waiting: 2, cancelled: 0,
      paymentsCompleted: 1, paidOnline: paid.paidAmount, paymentsFailed: 1, paymentsExpired: 0, paymentsPending: 0, revenue: paid.paidAmount,
    });
    expect(n.conversionRate).toBeCloseTo(1);
    const rowA = n.byQr.find((x) => x.qrId === a.id)!, rowB = n.byQr.find((x) => x.qrId === b.id)!;
    expect(rowA).toMatchObject({ label: "Lobby", scans: 2, bookings: 3, revenue: paid.paidAmount });
    expect(rowA.conversionRate).toBeCloseTo(1.5);
    expect(rowB).toMatchObject({ label: "Flyer", scans: 1, bookings: 0, revenue: 0, conversionRate: 0 });
    expect(await bookingQrAnalytics(m, { from: today(), to: today() }, b.id)).toMatchObject({ scans: 1, bookings: 0, qrId: b.id });
    // Staff signed in are not counted; another day has nothing.
    await qrSearch(a.token, s, { track: false });
    expect((await bookingQrAnalytics(m, { from: today(), to: today() })).searches).toBe(1);
    expect(await bookingQrAnalytics(m, { from: addDays(today(), -10), to: addDays(today(), -9) })).toMatchObject({ scans: 0, bookings: 0, revenue: 0, conversionRate: null });
    // Period money is for managers and the Admin.
    await expect(bookingQrAnalytics(await receptionistActor(), { from: today(), to: today() })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A payment reversed later stays on its own day; the reversal counts on the day it was made (a closed day never changes).
    const pay = await db.payment.findFirstOrThrow({ where: { reservationId: paid.id, status: "POSTED" } });
    await db.payment.update({ where: { id: pay.id }, data: { status: "REVERSED", reversedAt: new Date(), reversalBusinessDate: new Date(`${addDays(today(), 1)}T00:00:00Z`) } });
    expect(await bookingQrAnalytics(m, { from: today(), to: today() })).toMatchObject({ revenue: pay.amount, paidOnline: pay.amount });
    expect(await bookingQrAnalytics(m, { from: addDays(today(), 1), to: addDays(today(), 1) })).toMatchObject({ revenue: -pay.amount, paidOnline: -pay.amount });
    expect(await bookingQrAnalytics(m, { from: today(), to: addDays(today(), 1) })).toMatchObject({ revenue: 0, paidOnline: 0 });
  });

  it("a script inventing a new visitor key each time adds only a few scans from one address", async () => {
    const q = await newQr("Social media");
    const addr = ip();
    let counted = 0;
    for (let i = 0; i < 14; i++) if (await recordQrEvent(q.token, "SCAN", { visitor: hex(32), ip: addr })) counted += 1;
    expect(counted).toBe(10);
    expect(await recordQrEvent(q.token, "SCAN", { visitor: hex(32), ip: ip() })).toBe(true); // another guest on another connection
    expect((await db.bookingQrCode.findUniqueOrThrow({ where: { id: q.id } })).scanCount).toBe(11);
  });
});

describe("what the phone receives", () => {
  it("never a database id — only the QR token, room type slugs, room numbers, the booking reference and its key, the payment page token", async () => {
    const q = await newQr();
    const s = stayIn(33);
    const out: unknown[] = [];
    out.push(await qrLanding(q.token));
    const res = await qrSearch(q.token, s);
    out.push(res);
    const room = res.types[0].rooms[0];
    out.push(await qrQuote(q.token, { ...s, roomNumber: room.number }));
    const hotel = await qrBook(q.token, { ...s, roomNumber: room.number, guest: { fullName: "Private Person", phone: phone() }, pay: "HOTEL", clientKey: key() }, { ip: ip() });
    out.push(hotel);
    const k = key();
    const online = await book(q.token, { days: 35, pay: "ONLINE", clientKey: k });
    out.push(await qrBook(q.token, { ...online.stay, roomNumber: online.roomNumber, guest: { fullName: "Neema Scanner", phone: online.phone }, pay: "ONLINE", clientKey: k }, { ip: ip() }));
    await ntzsConfirms(online.payToken!);
    out.push(await qrConfirmation(q.token, online.reference, online.manageToken));
    out.push(await qrConfirmation(q.token, hotel.reference, hotel.manageToken));
    const json = JSON.stringify(out);

    const ids = [
      q.id,
      ...(await db.room.findMany({ select: { id: true } })).map((x) => x.id),
      ...(await db.roomType.findMany({ select: { id: true } })).map((x) => x.id),
      ...(await db.reservation.findMany({ select: { id: true, guestId: true, sourceId: true } })).flatMap((x) => [x.id, x.guestId, x.sourceId]),
      ...(await db.reservationRoom.findMany({ select: { id: true } })).map((x) => x.id),
      ...(await db.mobilePayment.findMany({ select: { id: true } })).map((x) => x.id),
      ...(await db.payment.findMany({ select: { id: true } })).map((x) => x.id),
      ...(await db.promotion.findMany({ select: { id: true } })).map((x) => x.id),
      ...(await db.user.findMany({ select: { id: true } })).map((x) => x.id),
    ];
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(json, id).not.toContain(id);
  });
});
