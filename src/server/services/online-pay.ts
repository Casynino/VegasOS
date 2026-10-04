import "server-only";
import { timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { AppError } from "../errors";
import { getSettings } from "../settings";
import { rateLimit } from "../rate-limit";
import { ntzsEnabled, ntzsPhone } from "./ntzs";
import { cancelMobilePayment, checkMobilePayment, maskPhone, requestMobilePayment, type PromptTarget } from "./mobile-payments";
import { guestStayBill } from "./stay-bill";
import { OPEN_SESSION, seatOf } from "./dining-core";
import type { HotelSettings, MobilePayment } from "@/generated/prisma/client";
import { formatTime } from "@/lib/format";
import { TRIP_TYPE_LABEL } from "@/lib/transport-meta";

/**
 * PAY ONLINE — the hotel's one customer-facing online payment (owner, 2026-10-04): wherever a customer pays online
 * (an order, room service, their room bill, a booking, the meeting room, transport, an invoice) it is nTZS underneath,
 * through this one service: the amount is worked out on the server, one live payment per bill, the same "Pay" pressed
 * twice is one payment, and the customer follows it on one page (/pay/<token>) — never told "paid" before nTZS has
 * confirmed it. Admin turns online payment on or off, for everything or per service.
 */

export type OnlineService = "restaurant" | "roomService" | "stayBill" | "booking" | "meeting" | "transport" | "invoices";
const FLAG: Record<OnlineService, keyof HotelSettings> = {
  restaurant: "onlinePayRestaurant", roomService: "onlinePayRoomService", stayBill: "onlinePayStayBill", booking: "onlinePayBooking",
  meeting: "onlinePayMeeting", transport: "onlinePayTransport", invoices: "onlinePayInvoices",
};
export const ONLINE_SERVICES: { key: OnlineService; label: string; hint: string }[] = [
  { key: "restaurant", label: "Restaurant & bar orders", hint: "Table, counter and main-restaurant QR codes, the website menu" },
  { key: "roomService", label: "Room service", hint: "Guests ordering from their room or stay link (Charge to room stays too)" },
  { key: "stayBill", label: "Guest bills", hint: "A staying guest pays what they owe from their stay link" },
  { key: "booking", label: "Room bookings", hint: "Book on the website and pay online — confirmed when paid" },
  { key: "meeting", label: "Meeting room", hint: "Book the meeting room on the website and pay online" },
  { key: "transport", label: "Transport", hint: "Airport and other trips requested on the website" },
  { key: "invoices", label: "Invoices", hint: "Pay an invoice from its link" },
];

/** Online payment offered for this service now: nTZS set up, switched on, and this service on. */
export async function onlinePayAvailable(service?: OnlineService, settings?: HotelSettings) {
  if (!ntzsEnabled()) return false;
  const s = settings ?? (await getSettings());
  if (!s.onlinePayEnabled) return false;
  return service ? !!s[FLAG[service]] : true;
}

/** Start a customer's online payment. Returns the private token of the payment page. */
export async function startCustomerPayment(input: {
  target: PromptTarget; phone: string; clientKey: string | null; source: string; service: OnlineService; ip: string | null;
}) {
  if (!(await onlinePayAvailable(input.service))) throw new AppError("Online payment is not available right now — please pay at the hotel.", "CONFLICT");
  const phone = ntzsPhone(input.phone);
  if (!phone) throw new AppError("Enter your mobile-money number, e.g. 0712 345 678.", "VALIDATION", { phone: "Invalid" });
  // A phone cannot be flooded with payment requests, nor a device send many (guests on the hotel Wi-Fi share one address).
  await rateLimit(`online-pay:ip:${input.ip ?? "unknown"}`, 40, 600);
  await rateLimit(`online-pay:phone:${phone}`, 6, 600);
  const mp = await requestMobilePayment(input.target, phone, null, new Date(), { source: input.source, clientKey: input.clientKey });
  return { token: mp.publicToken!, reused: mp.reused };
}

/** Before an order goes in with "Pay online": offered for it now, and a number that can pay (checked again as the request goes). */
export async function assertCanPayOnline(service: OnlineService, phone: string | null | undefined) {
  if (!(await onlinePayAvailable(service))) throw new AppError("Online payment is not available right now — please choose another way to pay.", "CONFLICT");
  if (!ntzsPhone(phone)) throw new AppError("Enter your mobile-money number, e.g. 0712 345 678.", "VALIDATION", { payPhone: "Invalid" });
}

/** Room service (the room QR, the guest's stay link) or the restaurant — each switched on or off on its own. */
const orderService = (source: string | null): OnlineService => (source === "ROOM_QR" || source === "GUEST_LINK" || source === "STAY_LINK" ? "roomService" : "restaurant");

/**
 * "Pay online" with a new order: the order is in (waiting for its payment) — now the payment request, under the same
 * key as the order (the same "Place order" pressed twice is one order and one payment). Returns the payment page to
 * send the customer to; when no request could start, why — the order's own page offers Pay online again.
 */
export async function payForNewOrder(order: { id: string; source: string; payOnlineAt: Date | null }, input: { phone: string; clientKey: string; ip: string | null }) {
  if (!order.payOnlineAt) return { pay: null, payError: null };
  const clientKey = `order:${input.clientKey}`;
  try {
    const r = await startCustomerPayment({ target: { purpose: "RESTAURANT", orderIds: [order.id] }, phone: input.phone, clientKey, source: order.source, service: orderService(order.source), ip: input.ip });
    return { pay: r.token, payError: null };
  } catch (e) {
    // Made and refused (nTZS busy, the number cannot pay…): its page says so, with Try again.
    const tried = await db.mobilePayment.findUnique({ where: { clientKey }, select: { publicToken: true } });
    if (tried?.publicToken) return { pay: tried.publicToken, payError: null };
    return { pay: null, payError: e instanceof AppError ? e.message : "Online payment could not start — please try again." };
  }
}

/** "Pay online" for an order already placed (from its own page): what is still due on it, worked out here. */
export async function payOrderOnline(trackToken: string, input: { phone: string; clientKey: string | null; ip: string | null }) {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(trackToken)) throw new AppError("Order not found.", "NOT_FOUND");
  const o = await db.restaurantOrder.findUnique({ where: { trackToken }, select: { id: true, source: true, status: true, settlement: true } });
  if (!o) throw new AppError("Order not found.", "NOT_FOUND");
  if (o.status === "CANCELLED") throw new AppError("This order was cancelled.", "CONFLICT");
  if (o.settlement === "ROOM") throw new AppError("This order is on your room bill — it is settled with your stay.", "CONFLICT");
  return startCustomerPayment({ target: { purpose: "RESTAURANT", orderIds: [o.id] }, phone: input.phone, clientKey: input.clientKey, source: o.source, service: orderService(o.source), ip: input.ip });
}

/** The order's payment on its way now (its page links back to it), if any — found from the order's own link. */
export async function livePaymentForOrder(trackToken: string) {
  const o = await db.restaurantOrder.findUnique({ where: { trackToken }, select: { id: true } });
  if (!o) return null;
  const mp = await db.mobilePayment.findFirst({
    where: { purpose: "RESTAURANT", initiator: "CUSTOMER", status: "PENDING", completedAt: null, orderIds: { has: o.id }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" }, select: { publicToken: true },
  });
  return mp?.publicToken ?? null;
}

/** A booking made and paid online keeps its room this long while the guest pays — the payment confirms it. */
export const ONLINE_BOOKING_HOLD_MINUTES = 30;

/**
 * "Pay online" while booking (a room, or the meeting room): the booking is made — held a short while — and its payment
 * request goes for the whole amount, worked out on the server. The same press twice is one booking and one payment.
 * Returns the payment page (or, when the request could not start, the booking's own page, which offers it again).
 */
export async function bookAndPayOnline(input: {
  service: "booking" | "meeting"; phone: string; clientKey: string; ip: string | null;
  create: () => Promise<{ id: string; reference: string; manageToken: string }>;
}) {
  await assertCanPayOnline(input.service, input.phone);
  const clientKey = `book:${input.clientKey}`;
  const made = await db.mobilePayment.findUnique({ where: { clientKey }, select: { publicToken: true } });
  if (made?.publicToken) return { pay: made.publicToken, booking: null, payError: null };
  // One booking per press — even pressed twice at once (the screen sends a new key after an error).
  try { await rateLimit(`book-once:${input.clientKey}`, 1, 3600); }
  catch { throw new AppError("Your booking is on its way — check your phone for the payment request.", "CONFLICT"); }
  const b = await input.create();
  const page = `/booking/${b.reference}?token=${encodeURIComponent(b.manageToken)}`;
  const r = await db.reservation.findUniqueOrThrow({ where: { id: b.id }, select: { balanceAmount: true } });
  try {
    const started = await startCustomerPayment({
      target: { purpose: "RESERVATION", reservationId: b.id, amount: r.balanceAmount }, phone: input.phone, clientKey, source: "BOOKING_PAGE", service: input.service, ip: input.ip,
    });
    return { pay: started.token, booking: page, payError: null };
  } catch (e) {
    const tried = await db.mobilePayment.findUnique({ where: { clientKey }, select: { publicToken: true } });
    if (tried?.publicToken) return { pay: tried.publicToken, booking: page, payError: null };
    return { pay: null, booking: page, payError: e instanceof AppError ? e.message : "Online payment could not start — please try again." };
  }
}

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** A booking from its private page (reference + token) — what online payment needs to know about it. */
async function bookingByLink(reference: string, token: string) {
  if (!/^VLH-[A-Z0-9]{4,12}$/.test(reference) || !token || token.length > 200) return null;
  const r = await db.reservation.findUnique({ where: { reference }, select: { id: true, manageToken: true, status: true, kind: true, billTo: true, balanceAmount: true } });
  return r && sameToken(r.manageToken, token) ? r : null;
}
const bookingService = (r: { status: string; kind: string }): OnlineService =>
  r.status === "CHECKED_IN" || r.status === "CHECKED_OUT" ? "stayBill" : r.kind === "MEETING" ? "meeting" : "booking";

/** Pay online offered on a booking's page now: something the guest owes, and online payment on for it. */
export async function bookingPayOnline(reference: string, token: string) {
  const r = await bookingByLink(reference, token);
  if (!r || r.billTo !== "GUEST" || r.balanceAmount <= 0 || r.status === "CANCELLED" || r.status === "NO_SHOW") return { offered: false, live: null };
  const live = await db.mobilePayment.findFirst({
    where: { reservationId: r.id, initiator: "CUSTOMER", status: "PENDING", completedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" }, select: { publicToken: true },
  });
  return { offered: await onlinePayAvailable(bookingService(r)), live: live?.publicToken ?? null };
}

/** "Pay online" from a booking's page: what is still owed on it, worked out here. */
export async function payBookingOnline(reference: string, token: string, input: { phone: string; clientKey: string | null; ip: string | null }) {
  const r = await bookingByLink(reference, token);
  if (!r) throw new AppError("Booking not found.", "NOT_FOUND");
  if (r.status === "CANCELLED" || r.status === "NO_SHOW") throw new AppError("This booking is closed — please contact us.", "CONFLICT");
  if (r.billTo !== "GUEST") throw new AppError("This booking is billed to your company — please contact us to pay.", "CONFLICT");
  if (r.balanceAmount <= 0) throw new AppError("Nothing is owed on this booking.", "CONFLICT");
  return startCustomerPayment({
    target: { purpose: "RESERVATION", reservationId: r.id, amount: r.balanceAmount }, phone: input.phone, clientKey: input.clientKey, source: "BOOKING_PAGE", service: bookingService(r), ip: input.ip,
  });
}

type StayLink = { guestToken: string } | { roomQrToken: string };
const liveForReservation = async (reservationId: string) => (await db.mobilePayment.findFirst({
  where: { reservationId, initiator: "CUSTOMER", status: "PENDING", completedAt: null, expiresAt: { gt: new Date() } },
  orderBy: { createdAt: "desc" }, select: { publicToken: true },
}))?.publicToken ?? null;

/** A staying guest's bill (their stay link, or the room's QR card): Pay online offered for what they owe. */
export async function stayBillPayOnline(where: StayLink) {
  const bill = await guestStayBill(where);
  if (!bill || bill.totals.balance <= 0) return { offered: false, live: null, due: 0 };
  return { offered: await onlinePayAvailable("stayBill"), live: await liveForReservation(bill.id), due: bill.totals.balance };
}

/** "Pay online" for a staying guest's bill: what is owed now, worked out here (a company's bill is never shown or paid here). */
export async function payStayBillOnline(where: StayLink, input: { phone: string; clientKey: string | null; ip: string | null }) {
  const bill = await guestStayBill(where);
  if (!bill) throw new AppError("This bill was not found.", "NOT_FOUND");
  if (bill.totals.balance <= 0) throw new AppError("Nothing is owed — thank you.", "CONFLICT");
  return startCustomerPayment({
    target: { purpose: "RESERVATION", reservationId: bill.id, amount: bill.totals.balance }, phone: input.phone, clientKey: input.clientKey,
    source: "guestToken" in where ? "STAY_LINK" : "ROOM_QR", service: "stayBill", ip: input.ip,
  });
}

// ───────────── Transport and invoices ─────────────

/** A website trip by its private link: what online payment needs to know about it. */
const tripByLink = (payToken: string) => /^[A-Za-z0-9_-]{16,40}$/.test(payToken)
  ? db.transportTrip.findUnique({ where: { payToken }, include: { sales: { where: { isVoided: false }, select: { id: true } } } }) : Promise.resolve(null);
const tripDue = (t: { status: string; charge: number | null; chargeId: string | null; paidAt: Date | null; sales: { id: string }[] }) =>
  t.status === "CANCELLED" || t.status === "NO_SHOW" || t.chargeId || t.paidAt || t.sales.length ? 0 : t.charge ?? 0;

/** A website trip's own page: the trip, and Pay online offered for its price. */
export async function tripForCustomer(payToken: string) {
  const t = await tripByLink(payToken);
  if (!t) return null;
  const due = tripDue(t);
  const live = due > 0 ? (await db.mobilePayment.findFirst({
    where: { tripId: t.id, initiator: "CUSTOMER", status: "PENDING", completedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { publicToken: true },
  }))?.publicToken ?? null : null;
  return {
    reference: t.reference, type: t.type, status: t.status, pickupAt: t.pickupAt, pickupLocation: t.pickupLocation, destination: t.destination, flightNumber: t.flightNumber,
    passengers: t.passengers, name: t.passengerName, phone: t.passengerPhone, price: t.charge ?? 0, option: t.priceOption, paid: !!(t.paidAt || t.sales.length), onBill: !!t.chargeId,
    due, live, online: due > 0 && t.type !== "GUEST_TRANSPORT" ? await onlinePayAvailable("transport") : false,
  };
}

/** "Pay online" for a website trip (its own page, or right after asking for it): its price, worked out here. */
export async function payTripOnline(payToken: string, input: { phone: string; clientKey: string | null; ip: string | null }) {
  const t = await tripByLink(payToken);
  if (!t) throw new AppError("Trip not found.", "NOT_FOUND");
  // A custom trip's price is a starting price — confirmed with the guest first, then paid.
  if (t.type === "GUEST_TRANSPORT" && !t.confirmedAt) throw new AppError("We confirm this trip's price with you first — then you can pay.", "CONFLICT");
  return startCustomerPayment({ target: { purpose: "TRANSPORT", tripId: t.id }, phone: input.phone, clientKey: input.clientKey, source: "TRANSPORT", service: "transport", ip: input.ip });
}

/**
 * What an invoice's link can pay online: an issued company / group invoice is paid itself; a booking's invoice follows
 * its booking, so the booking is paid (never more than either still owes).
 */
async function invoiceTarget(verifyToken: string): Promise<{ target: PromptTarget; due: number; liveWhere: { invoiceId: string } | { reservationId: string } } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(verifyToken)) return null;
  const inv = await db.invoice.findUnique({ where: { verifyToken }, select: { id: true, status: true, balanceAmount: true, reservationId: true } });
  if (!inv || !["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status) || inv.balanceAmount <= 0) return null;
  if (!inv.reservationId) return { target: { purpose: "INVOICE", invoiceId: inv.id }, due: inv.balanceAmount, liveWhere: { invoiceId: inv.id } };
  const r = await db.reservation.findUnique({ where: { id: inv.reservationId }, select: { status: true, balanceAmount: true } });
  const due = r && r.status !== "CANCELLED" && r.status !== "NO_SHOW" ? Math.min(inv.balanceAmount, r.balanceAmount) : 0;
  return due > 0 ? { target: { purpose: "RESERVATION", reservationId: inv.reservationId, amount: due }, due, liveWhere: { reservationId: inv.reservationId } } : null;
}

/** An invoice by its "scan to verify" link: Pay online offered for what is still owed. */
export async function invoicePayOnline(verifyToken: string) {
  const t = await invoiceTarget(verifyToken);
  if (!t) return { offered: false, live: null, due: 0 };
  const live = await db.mobilePayment.findFirst({
    where: { ...t.liveWhere, initiator: "CUSTOMER", status: "PENDING", completedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { publicToken: true },
  });
  return { offered: await onlinePayAvailable("invoices"), live: live?.publicToken ?? null, due: t.due };
}

/** "Pay online" for an invoice from its link: what is still owed, worked out here. */
export async function payInvoiceOnline(verifyToken: string, input: { phone: string; clientKey: string | null; ip: string | null }) {
  const t = await invoiceTarget(verifyToken);
  if (!t) throw new AppError("Nothing is owed on this invoice.", "CONFLICT");
  return startCustomerPayment({ target: t.target, phone: input.phone, clientKey: input.clientKey, source: "INVOICE_LINK", service: "invoices", ip: input.ip });
}

/** The seated customer's table (their private seat): the orders on it still to pay — never what went on a room bill. */
async function tableOrdersDue(seatToken: string | null) {
  const seat = await seatOf(seatToken);
  if (!seat || !OPEN_SESSION.includes(seat.member.session.status)) return [];
  const orders = await db.restaurantOrder.findMany({
    where: { sessionId: seat.member.session.id, status: { not: "CANCELLED" }, settlement: { not: "ROOM" } }, select: { id: true, total: true, paidAmount: true },
  });
  return orders.filter((o) => o.total > o.paidAmount).map((o) => o.id);
}

/** A table's bill: Pay online offered for what is due on it (and a payment already on its way). */
export async function tableBillPayOnline(seatToken: string | null) {
  const ids = await tableOrdersDue(seatToken);
  if (!ids.length) return { offered: false, live: null };
  const live = await db.mobilePayment.findFirst({
    where: { purpose: "RESTAURANT", initiator: "CUSTOMER", status: "PENDING", completedAt: null, orderIds: { hasSome: ids }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" }, select: { publicToken: true },
  });
  return { offered: await onlinePayAvailable("restaurant"), live: live?.publicToken ?? null };
}

/** "Pay my bill online" at the table: everything still due on the table's orders, worked out here, in one payment. */
export async function payTableBillOnline(seatToken: string | null, input: { phone: string; clientKey: string | null; ip: string | null }) {
  const ids = await tableOrdersDue(seatToken);
  if (!ids.length) throw new AppError("Nothing to pay right now.", "CONFLICT");
  return startCustomerPayment({ target: { purpose: "RESTAURANT", orderIds: ids }, phone: input.phone, clientKey: input.clientKey, source: "TABLE_QR", service: "restaurant", ip: input.ip });
}

export type CustomerPayStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
export type CustomerPayView = {
  token: string; status: CustomerPayStatus; amount: number; phone: string; what: string; reference: string; at: string; paidAt: string | null;
  back: { href: string; label: string } | null; receipt: string | null; message: string | null; canRetry: boolean; canCancel: boolean;
};

const STATUS: Record<MobilePayment["status"], CustomerPayStatus> = { PENDING: "PENDING", COMPLETED: "PAID", FAILED: "FAILED", EXPIRED: "EXPIRED", CANCELLED: "CANCELLED" };
const CHECK_EVERY_MS = 6_000;

/** What the customer's payment page shows (nTZS is asked again at most every few seconds while it waits). */
export async function customerPaymentByToken(token: string, opts: { check?: boolean } = {}): Promise<CustomerPayView | null> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
  let mp = await db.mobilePayment.findUnique({ where: { publicToken: token } });
  if (!mp) return null;
  // Asked again while it waits — and also when it timed out, was stopped or marked failed but nTZS may still have the
  // money (a late approval): opening the page shows "paid" once nTZS has it. Never more often than every few seconds.
  const unrecorded = !mp.completedAt && (mp.status === "PENDING" || (!!mp.depositId && Date.now() - mp.createdAt.getTime() < 48 * 3_600_000));
  if (opts.check && unrecorded && (!mp.lastCheckedAt || Date.now() - mp.lastCheckedAt.getTime() > CHECK_EVERY_MS)) {
    await db.mobilePayment.update({ where: { id: mp.id }, data: { lastCheckedAt: new Date() } });
    mp = await checkMobilePayment(mp.id).catch(() => mp!);
    if (mp.status === "PENDING" && mp.expiresAt && mp.expiresAt < new Date()) {
      await db.mobilePayment.updateMany({ where: { id: mp.id, status: "PENDING", completedAt: null }, data: { status: "EXPIRED" } });
      mp = (await db.mobilePayment.findUnique({ where: { id: mp.id } }))!;
    }
  }
  const { what, back, receipt, unpaidNote } = await describe(mp);
  const status = STATUS[mp.status];
  const ended = status === "FAILED" ? "The payment was not completed." : status === "EXPIRED" ? "The payment request ran out of time." : status === "CANCELLED" ? "This payment request was cancelled." : null;
  return {
    token, status, amount: mp.amount, phone: maskPhone(mp.phone), what, at: mp.createdAt.toISOString(), paidAt: mp.completedAt?.toISOString() ?? null,
    reference: (mp.pspReference || mp.depositId || mp.id).slice(-10).toUpperCase(), back, receipt,
    message: ended ? [ended, unpaidNote].filter(Boolean).join(" ") : null,
    canRetry: status === "FAILED" || status === "EXPIRED" || status === "CANCELLED",
    canCancel: status === "PENDING" && mp.initiator === "CUSTOMER",
  };
}

/** What was paid for, and where the customer goes back to. */
async function describe(mp: MobilePayment) {
  if (mp.purpose === "TRANSPORT" && mp.tripId) {
    const t = await db.transportTrip.findUnique({ where: { id: mp.tripId }, select: { reference: true, type: true, payToken: true } });
    return {
      what: t ? `${TRIP_TYPE_LABEL[t.type]} ${t.reference}` : "Transport",
      back: t?.payToken ? { href: `/transport/trip/${t.payToken}`, label: "View your trip" } : { href: "/transport", label: "Back to transport" },
      receipt: null, unpaidNote: null,
    };
  }
  if (mp.purpose === "INVOICE" && mp.invoiceId) {
    const inv = await db.invoice.findUnique({ where: { id: mp.invoiceId }, select: { number: true, verifyToken: true } });
    return {
      what: inv ? `Invoice ${inv.number}` : "Invoice",
      back: inv?.verifyToken ? { href: `/verify/${inv.verifyToken}`, label: "View the invoice" } : null,
      receipt: null, unpaidNote: null,
    };
  }
  if (mp.purpose === "RESTAURANT") {
    const orders = await db.restaurantOrder.findMany({ where: { id: { in: mp.orderIds } }, select: { number: true, trackToken: true, type: true, status: true, paymentStatus: true, payOnlineAt: true }, orderBy: { createdAt: "asc" } });
    const open = orders.filter((o) => o.status !== "CANCELLED" && o.paymentStatus !== "PAID");
    // Not paid: take out waits for its payment; anything else goes ahead and is paid later.
    const unpaidNote = !open.length ? null
      : open.some((o) => o.payOnlineAt && o.status === "PENDING" && (o.type === "TAKEAWAY" || o.type === "PICKUP")) ? "We start your order once it is paid."
      : open.every((o) => o.type === "ROOM_SERVICE") ? "Your order still goes ahead — try again, or pay at reception."
      : "Your order still goes ahead — try again, or pay at the counter when you are done.";
    const nos = orders.map((o) => `#${o.number.replace(/^ORD-\d{4}-0*/, "")}`);
    const track = orders.find((o) => o.trackToken)?.trackToken ?? null;
    return {
      what: orders.length > 1 ? `Restaurant bill · orders ${nos.join(", ")}` : `Restaurant order ${nos[0] ?? ""}`.trim(),
      back: track ? { href: `/order/${track}`, label: "View your order" } : null,
      receipt: track && mp.status === "COMPLETED" ? `/order/${track}/receipt` : null,
      unpaidNote,
    };
  }
  if (mp.reservationId) {
    const r = await db.reservation.findUnique({ where: { id: mp.reservationId }, select: { reference: true, kind: true, manageToken: true, guestToken: true, status: true, holdUntil: true } });
    if (r) {
      const booking = mp.source === "BOOKING_PAGE" || mp.source === "WEBSITE";
      const held = r.status === "RESERVED" && r.holdUntil && r.holdUntil > new Date() ? formatTime(r.holdUntil, (await getSettings()).timezone) : null;
      return {
        unpaidNote: r.status === "CANCELLED" ? "The booking was released — please book again." : held ? `We hold your booking until ${held} — try again to confirm it.` : null,
        what: r.kind === "MEETING" ? `Meeting room booking ${r.reference}` : booking ? `Room booking ${r.reference}` : `Your bill · ${r.reference}`,
        back: booking ? { href: `/booking/${r.reference}?token=${r.manageToken}`, label: "View your booking" }
          : mp.source === "ROOM_QR" ? await roomPageOf(mp.reservationId)
          : mp.source === "INVOICE_LINK" ? await invoicePageOf(mp.reservationId)
          : r.guestToken ? { href: `/stay/${r.guestToken}`, label: "Back to your stay" } : null,
        receipt: null,
      };
    }
  }
  return { what: "Payment", back: null, receipt: null, unpaidNote: null };
}

/** Paid from a booking's invoice link: back to that invoice. */
async function invoicePageOf(reservationId: string) {
  const inv = await db.invoice.findFirst({ where: { reservationId, verifyToken: { not: null } }, orderBy: { createdAt: "desc" }, select: { verifyToken: true } });
  return inv?.verifyToken ? { href: `/verify/${inv.verifyToken}`, label: "View the invoice" } : null;
}

/** Paid from the room's QR card: back to that room's page (never the guest's private stay link). */
async function roomPageOf(reservationId: string) {
  const qr = await db.roomQrCode.findFirst({ where: { active: true, room: { reservationRooms: { some: { reservationId, status: "CHECKED_IN" } } } }, select: { token: true } });
  return qr ? { href: `/r/${qr.token}?view=guest`, label: "Back to your room" } : null;
}

/** The customer stops waiting (they will pay another way). Money that still comes in is recorded all the same. */
export async function cancelCustomerPayment(token: string) {
  const mp = await db.mobilePayment.findUnique({ where: { publicToken: token }, select: { id: true, initiator: true, status: true } });
  if (!mp || mp.initiator !== "CUSTOMER") throw new AppError("Payment not found.", "NOT_FOUND");
  if (mp.status === "PENDING") await cancelMobilePayment(mp.id, { label: "Customer · online" });
}

/**
 * "Try again" after a payment that did not go through: a new payment request for the same bill — the amount worked
 * out again (never more than is owed now). Returns the new payment page's token.
 */
export async function retryCustomerPayment(token: string, input: { phone?: string | null; clientKey: string | null; ip: string | null }) {
  const found = await db.mobilePayment.findUnique({ where: { publicToken: token } });
  if (!found || found.initiator !== "CUSTOMER") throw new AppError("Payment not found.", "NOT_FOUND");
  // The last attempt may have gone through after all (approved late): asked first — then it is "paid", never asked twice.
  const old = found.status !== "COMPLETED" && found.depositId ? await checkMobilePayment(found.id).catch(() => found) : found;
  if (old.status === "COMPLETED") return { token, reused: true };
  if (old.status === "PENDING") await cancelMobilePayment(old.id, { label: "Customer · online" });
  let target: PromptTarget, service: OnlineService;
  if (old.purpose === "RESTAURANT") {
    target = { purpose: "RESTAURANT", orderIds: old.orderIds };
    service = orderService(old.source);
  } else if (old.purpose === "TRANSPORT" && old.tripId) {
    target = { purpose: "TRANSPORT", tripId: old.tripId };
    service = "transport";
  } else if (old.purpose === "INVOICE" && old.invoiceId) {
    target = { purpose: "INVOICE", invoiceId: old.invoiceId };
    service = "invoices";
  } else {
    const r = old.reservationId ? await db.reservation.findUnique({ where: { id: old.reservationId }, select: { balanceAmount: true, kind: true, status: true } }) : null;
    if (r?.status === "CANCELLED" || r?.status === "NO_SHOW") throw new AppError("This booking was released — please book again.", "CONFLICT");
    if (!r || r.balanceAmount <= 0) throw new AppError("Nothing is owed any more.", "CONFLICT");
    target = { purpose: "RESERVATION", reservationId: old.reservationId!, amount: Math.min(old.amount, r.balanceAmount) };
    service = old.source === "BOOKING_PAGE" || old.source === "WEBSITE" ? (r.kind === "MEETING" ? "meeting" : "booking") : old.source === "INVOICE_LINK" ? "invoices" : "stayBill";
  }
  return startCustomerPayment({ target, phone: input.phone || old.phone, clientKey: input.clientKey, source: old.source ?? "WEBSITE", service, ip: input.ip });
}
