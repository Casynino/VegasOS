import "server-only";
import { db } from "../db";
import { getSettings, stayConfig } from "../settings";
import { ntzsEnabled, ntzsLive } from "./ntzs";
import { ONLINE_SERVICES, type OnlineService } from "./online-pay";
import { maskPhone } from "./mobile-payments";
import { businessRangeBounds, type BusinessDate } from "@/lib/time/business-date";
import type { MobilePaymentStatus } from "@/generated/prisma/enums";
import type { HotelSettings } from "@/generated/prisma/client";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import { englishT } from "@/i18n/translate";

/**
 * ONLINE PAYMENTS (admin) — nTZS at a glance: is it connected and on, every payment attempt (who, what, how much,
 * where it stands, nTZS's reference), the ones that need a person, and the reconciliation: every payment nTZS
 * confirmed must be on the hotel's books — once, for the same amount.
 */

/** Shown with t(label). The "what" of a payment below ("Booking VLH-…", "Order #19") is written in the reader's words. */
export const PURPOSE_LABEL: Record<string, string> = { RESERVATION: msg("Rooms & bills"), RESTAURANT: msg("Restaurant"), TRANSPORT: msg("Transport"), INVOICE: msg("Invoices") };
export const SOURCE_LABEL: Record<string, string> = {
  DESK: msg("Staff · send to phone"), WEBSITE: msg("Website"), PUBLIC_QR: msg("Menu QR"), TABLE_QR: msg("Table QR"), COUNTER_QR: msg("Counter QR"), RESTAURANT_QR: msg("Restaurant QR"),
  ROOM_QR: msg("Room QR"), GUEST_LINK: msg("Stay link"), STAY_LINK: msg("Stay link"), BOOKING_PAGE: msg("Website booking"), TRANSPORT: msg("Website transport"), INVOICE_LINK: msg("Invoice link"),
  HOTEL_QR: msg("Hotel QR booking"),
};
export type OnlineStatusFilter = "all" | "paid" | "pending" | "failed" | "attention";
const STATUS_WHERE: Record<Exclude<OnlineStatusFilter, "all" | "attention">, MobilePaymentStatus[]> = { paid: ["COMPLETED"], pending: ["PENDING"], failed: ["FAILED", "EXPIRED", "CANCELLED"] };

/** Is online payment working: the key, the webhook, switched on — and the last confirmation that came by webhook. */
export async function onlinePaymentStatus(settings?: HotelSettings) {
  const s = settings ?? (await getSettings());
  const last = await db.auditLog.findFirst({ where: { action: "mobile_payment.completed", after: { path: ["via"], equals: "webhook" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return {
    connected: ntzsEnabled(), live: ntzsLive(), webhookSecret: !!process.env.NTZS_WEBHOOK_SECRET, lastWebhookAt: last?.createdAt ?? null,
    enabled: s.onlinePayEnabled,
    services: ONLINE_SERVICES.map((x) => ({ ...x, on: !!s[FLAG_OF[x.key]] })),
  };
}
const FLAG_OF: Record<OnlineService, keyof HotelSettings> = {
  restaurant: "onlinePayRestaurant", roomService: "onlinePayRoomService", stayBill: "onlinePayStayBill", booking: "onlinePayBooking",
  meeting: "onlinePayMeeting", transport: "onlinePayTransport", invoices: "onlinePayInvoices",
};
export const onlinePayFlag = (k: OnlineService) => FLAG_OF[k];

/** Every attempt in the period (newest first), with what it was for and what it became on the hotel's books. */
export async function onlinePayments(input: {
  from: BusinessDate; to: BusinessDate; status: OnlineStatusFilter; purpose: string | null; q: string;
  /** One shift's time instead of whole hotel days (Collections, a receptionist's shift). */
  window?: { start: Date; end: Date } | null;
  /** Several services at once (Collections: the hotel's, or the restaurant's). */
  purposes?: string[] | null;
}) {
  const s = await getSettings();
  const { start, end } = input.window ?? businessRangeBounds(input.from, input.to, stayConfig(s));
  const q = input.q.trim();
  const digits = q.replace(/\D/g, "");
  const rows = await db.mobilePayment.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      ...(input.status === "attention" ? { attentionAt: { not: null }, resolvedAt: null } : input.status !== "all" ? { status: { in: STATUS_WHERE[input.status] } } : {}),
      ...(input.purposes ? { purpose: { in: input.purposes } } : input.purpose ? { purpose: input.purpose } : {}),
      ...(q ? { OR: [
        { pspReference: { contains: q, mode: "insensitive" as const } }, { depositId: { contains: q, mode: "insensitive" as const } }, { id: q },
        ...(digits.length >= 4 ? [{ phone: { contains: digits.replace(/^0/, "") } }] : []),
      ] } : {}),
    },
    orderBy: { createdAt: "desc" }, take: 300,
    include: { requestedBy: { select: { fullName: true } } },
  });
  const what = await describeMany(rows);
  return rows.map((m) => ({
    id: m.id, at: m.createdAt, paidAt: m.completedAt, amount: m.amount, status: m.status, purpose: m.purpose, source: m.source,
    phone: maskPhone(m.phone), reference: m.pspReference ?? m.depositId ?? null, live: m.livemode,
    by: m.initiator === "CUSTOMER" ? "Customer, online" : m.requestedBy?.fullName ?? "Staff",
    attention: m.attentionAt && !m.resolvedAt ? m.lastError : null, error: m.status !== "COMPLETED" ? m.lastError : null,
    ...(what.get(m.id) ?? { what: PURPOSE_LABEL[m.purpose] ?? m.purpose, customer: null, href: null }),
  }));
}
export type OnlinePaymentRow = Awaited<ReturnType<typeof onlinePayments>>[number];

/**
 * What each attempt paid for — one query per kind, not per row. Display only: written in the words of the person looking
 * ("Booking VLH-…", "Order #19" in English; nothing reads it back).
 */
async function describeMany(rows: { id: string; purpose: string; reservationId: string | null; orderIds: string[]; tripId: string | null; invoiceId: string | null }[]) {
  const t = await getT().catch(() => englishT);
  const [res, orders, trips, invoices] = await Promise.all([
    db.reservation.findMany({ where: { id: { in: rows.flatMap((r) => (r.reservationId ? [r.reservationId] : [])) } }, select: { id: true, reference: true, kind: true, guest: { select: { fullName: true } } } }),
    db.restaurantOrder.findMany({ where: { id: { in: rows.flatMap((r) => r.orderIds) } }, select: { id: true, number: true, customerName: true } }),
    db.transportTrip.findMany({ where: { id: { in: rows.flatMap((r) => (r.tripId ? [r.tripId] : [])) } }, select: { id: true, reference: true, passengerName: true } }),
    db.invoice.findMany({ where: { id: { in: rows.flatMap((r) => (r.invoiceId ? [r.invoiceId] : [])) } }, select: { id: true, number: true, corporateCustomer: { select: { companyName: true } }, guest: { select: { fullName: true } } } }),
  ]);
  const out = new Map<string, { what: string; customer: string | null; href: string | null }>();
  for (const r of rows) {
    if (r.purpose === "RESERVATION" && r.reservationId) {
      const x = res.find((y) => y.id === r.reservationId);
      if (x) out.set(r.id, { what: x.kind === "MEETING" ? t("Meeting room {reference}", { reference: x.reference }) : t("Booking {reference}", { reference: x.reference }), customer: x.guest.fullName, href: `/staff/reservations/${x.id}` });
    } else if (r.purpose === "RESTAURANT") {
      const os = orders.filter((o) => r.orderIds.includes(o.id));
      const numbers = os.map((o) => `#${o.number.replace(/^ORD-\d{4}-0*/, "")}`).join(", ");
      if (os.length) out.set(r.id, { what: os.length > 1 ? t("Orders {numbers}", { numbers }) : t("Order {number}", { number: numbers }), customer: os[0].customerName, href: `/staff/restaurant/history?q=${encodeURIComponent(os[0].number)}` });
    } else if (r.purpose === "TRANSPORT" && r.tripId) {
      const trip = trips.find((y) => y.id === r.tripId);
      if (trip) out.set(r.id, { what: t("Trip {reference}", { reference: trip.reference }), customer: trip.passengerName, href: "/staff/transport" });
    } else if (r.purpose === "INVOICE" && r.invoiceId) {
      const i = invoices.find((y) => y.id === r.invoiceId);
      if (i) out.set(r.id, { what: t("Invoice {number}", { number: i.number }), customer: i.corporateCustomer?.companyName ?? i.guest?.fullName ?? null, href: `/staff/invoices/${i.id}` });
    }
  }
  return out;
}

/** The period in numbers: paid (count, money), still waiting, not completed — and what needs a person (any time). */
export async function onlinePaymentTotals(from: BusinessDate, to: BusinessDate) {
  const s = await getSettings();
  const { start, end } = businessRangeBounds(from, to, stayConfig(s));
  const [byStatus, attention] = await Promise.all([
    db.mobilePayment.groupBy({ by: ["status"], where: { createdAt: { gte: start, lt: end } }, _count: true, _sum: { amount: true } }),
    db.mobilePayment.count({ where: { attentionAt: { not: null }, resolvedAt: null } }),
  ]);
  const of = (st: MobilePaymentStatus[]) => byStatus.filter((b) => st.includes(b.status));
  return {
    paid: { count: of(["COMPLETED"]).reduce((t, b) => t + b._count, 0), amount: of(["COMPLETED"]).reduce((t, b) => t + (b._sum.amount ?? 0), 0) },
    pending: of(["PENDING"]).reduce((t, b) => t + b._count, 0),
    failed: of(["FAILED", "EXPIRED", "CANCELLED"]).reduce((t, b) => t + b._count, 0),
    attention,
  };
}

/**
 * RECONCILIATION — every payment nTZS confirmed in the period, checked against the hotel's books: it is recorded
 * (a guest-bill / invoice payment, restaurant payments, the trip's income), for the amount that came in, and no bill
 * was paid by two confirmed attempts. Anything else is listed for a person.
 */
export async function reconcileOnlinePayments(from: BusinessDate, to: BusinessDate) {
  const s = await getSettings();
  const { start, end } = businessRangeBounds(from, to, stayConfig(s));
  const done = await db.mobilePayment.findMany({ where: { status: "COMPLETED", completedAt: { gte: start, lt: end } }, orderBy: { completedAt: "asc" } });
  const [payments, orderPayments, sales] = await Promise.all([
    db.payment.findMany({ where: { id: { in: done.flatMap((m) => (m.paymentId ? [m.paymentId] : [])) } }, select: { id: true, amount: true, status: true } }),
    db.restaurantOrderPayment.findMany({ where: { id: { in: done.flatMap((m) => m.orderPaymentIds) } }, select: { id: true, amount: true, status: true } }),
    db.revenueTransaction.findMany({ where: { transportTripId: { in: done.flatMap((m) => (m.tripId ? [m.tripId] : [])) }, isVoided: false, account: { code: "NTZS" } }, select: { transportTripId: true, amount: true } }),
  ]);
  const what = await describeMany(done);
  // What is wrong, in the reader's words (the payment's stored note is shown as it was written).
  const t = await getT().catch(() => englishT);
  const issues: { id: string; at: Date; what: string; amount: number; problem: string }[] = [];
  let matched = 0, recorded = 0;
  for (const m of done) {
    const booked = m.purpose === "RESTAURANT"
      ? orderPayments.filter((p) => m.orderPaymentIds.includes(p.id) && p.status === "POSTED").reduce((sum, p) => sum + p.amount, 0)
      : m.purpose === "TRANSPORT" ? sales.filter((x) => x.transportTripId === m.tripId).reduce((sum, x) => sum + x.amount, 0)
      : payments.filter((p) => p.id === m.paymentId && p.status === "POSTED").reduce((sum, p) => sum + p.amount, 0);
    recorded += booked;
    const label = what.get(m.id)?.what ?? PURPOSE_LABEL[m.purpose] ?? m.purpose;
    // A person already dealt with it (refunded, applied elsewhere): not an open difference any more.
    const problem = m.resolvedAt ? null
      : booked === 0 ? (m.attentionAt ? t("Not on the books — {reason}", { reason: m.lastError ?? t("needs a person") }) : t("Confirmed by nTZS but not on the hotel's books"))
      : booked !== m.amount ? `${t("On the books: {booked} of {amount}", { booked: booked.toLocaleString("en-US"), amount: m.amount.toLocaleString("en-US") })}${m.lastError ? ` — ${m.lastError}` : ""}`
      : null;
    if (problem) issues.push({ id: m.id, at: m.completedAt ?? m.createdAt, what: label, amount: m.amount, problem });
    else matched++;
  }
  // The same bill paid by two confirmed attempts.
  const byTarget = new Map<string, typeof done>();
  for (const m of done) if (m.targetKey) byTarget.set(m.targetKey, [...(byTarget.get(m.targetKey) ?? []), m]);
  for (const [, list] of byTarget) {
    if (list.length < 2) continue;
    const last = list[list.length - 1];
    issues.push({ id: last.id, at: last.completedAt ?? last.createdAt, what: what.get(last.id)?.what ?? PURPOSE_LABEL[last.purpose] ?? last.purpose, amount: list.reduce((sum, x) => sum + x.amount, 0), problem: t("Paid by {n} confirmed attempts — check it is not paid twice", { n: list.length }) });
  }
  return { confirmed: done.length, confirmedAmount: done.reduce((sum, m) => sum + m.amount, 0), recorded, matched, issues };
}

/** Money that came in by nTZS but needs a person (any time) — for the attention lists (Collections, Online payments). */
export async function onlineAttentionRows(purpose?: "RESTAURANT") {
  const rows = await db.mobilePayment.findMany({
    where: { attentionAt: { not: null }, resolvedAt: null, ...(purpose ? { purpose } : {}) },
    orderBy: { attentionAt: "desc" }, take: 30, include: { requestedBy: { select: { fullName: true } } },
  });
  const what = await describeMany(rows);
  return rows.map((m) => {
    const d = what.get(m.id);
    return {
      id: m.id, amount: m.amount, phone: maskPhone(m.phone), purpose: m.purpose, note: m.lastError, at: (m.attentionAt ?? m.createdAt).toISOString(),
      where: [d?.customer, d?.what ?? PURPOSE_LABEL[m.purpose]].filter(Boolean).join(" · "),
      by: m.requestedBy?.fullName.replace(/\s*\(.*\)/, "") ?? "the customer (online)", reference: m.pspReference ?? m.depositId, href: d?.href ?? null,
    };
  });
}

/** A customer's online payments (nTZS) — their bookings and stays, orders, trips and invoices — newest first. */
export async function customerOnlinePayments(guestId: string, take = 20) {
  const [orders, trips, invoices] = await Promise.all([
    db.restaurantOrder.findMany({ where: { guestId }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.transportTrip.findMany({ where: { guestId }, select: { id: true } }),
    db.invoice.findMany({ where: { guestId }, select: { id: true } }),
  ]);
  const rows = await db.mobilePayment.findMany({
    where: { OR: [
      { reservation: { guestId } }, ...(orders.length ? [{ orderIds: { hasSome: orders.map((o) => o.id) } }] : []),
      ...(trips.length ? [{ tripId: { in: trips.map((t) => t.id) } }] : []), ...(invoices.length ? [{ invoiceId: { in: invoices.map((i) => i.id) } }] : []),
    ] },
    orderBy: { createdAt: "desc" }, take,
  });
  const what = await describeMany(rows);
  return rows.map((m) => ({
    id: m.id, at: m.completedAt ?? m.createdAt, amount: m.amount, status: m.status, reference: m.pspReference ?? m.depositId ?? null,
    online: m.initiator === "CUSTOMER", what: what.get(m.id)?.what ?? PURPOSE_LABEL[m.purpose] ?? m.purpose, href: what.get(m.id)?.href ?? null,
  }));
}
