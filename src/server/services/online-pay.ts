import "server-only";
import { db } from "../db";
import { AppError } from "../errors";
import { getSettings } from "../settings";
import { rateLimit } from "../rate-limit";
import { ntzsEnabled, ntzsPhone } from "./ntzs";
import { cancelMobilePayment, checkMobilePayment, maskPhone, requestMobilePayment, type PromptTarget } from "./mobile-payments";
import type { HotelSettings, MobilePayment } from "@/generated/prisma/client";

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
  if (opts.check && mp.status === "PENDING" && (!mp.lastCheckedAt || Date.now() - mp.lastCheckedAt.getTime() > CHECK_EVERY_MS)) {
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
    const r = await db.reservation.findUnique({ where: { id: mp.reservationId }, select: { reference: true, kind: true, manageToken: true, guestToken: true, status: true } });
    if (r) {
      const booking = mp.source === "BOOKING_PAGE" || mp.source === "WEBSITE";
      return {
        what: r.kind === "MEETING" ? `Meeting room booking ${r.reference}` : booking ? `Room booking ${r.reference}` : `Your bill · ${r.reference}`,
        back: booking ? { href: `/booking/${r.reference}?token=${r.manageToken}`, label: "View your booking" }
          : r.guestToken ? { href: `/stay/${r.guestToken}`, label: "Back to your stay" } : null,
        receipt: null, unpaidNote: null,
      };
    }
  }
  return { what: "Payment", back: null, receipt: null, unpaidNote: null };
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
  const old = await db.mobilePayment.findUnique({ where: { publicToken: token } });
  if (!old || old.initiator !== "CUSTOMER") throw new AppError("Payment not found.", "NOT_FOUND");
  if (old.status === "COMPLETED") throw new AppError("This payment is already done.", "CONFLICT");
  if (old.status === "PENDING") await cancelMobilePayment(old.id, { label: "Customer · online" });
  let target: PromptTarget, service: OnlineService;
  if (old.purpose === "RESTAURANT") {
    target = { purpose: "RESTAURANT", orderIds: old.orderIds };
    service = orderService(old.source);
  } else {
    const r = old.reservationId ? await db.reservation.findUnique({ where: { id: old.reservationId }, select: { balanceAmount: true, kind: true } }) : null;
    if (!r || r.balanceAmount <= 0) throw new AppError("Nothing is owed any more.", "CONFLICT");
    target = { purpose: "RESERVATION", reservationId: old.reservationId!, amount: Math.min(old.amount, r.balanceAmount) };
    service = old.source === "BOOKING_PAGE" || old.source === "WEBSITE" ? (r.kind === "MEETING" ? "meeting" : "booking") : "stayBill";
  }
  return startCustomerPayment({ target, phone: input.phone || old.phone, clientKey: input.clientKey, source: old.source ?? "WEBSITE", service, ip: input.ip });
}
