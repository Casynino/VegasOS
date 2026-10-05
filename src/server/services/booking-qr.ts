import "server-only";
import { randomBytes } from "node:crypto";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { rateLimit } from "../rate-limit";
import { getSettings, stayConfig } from "../settings";
import { siteOrigin } from "../site-origin";
import { qrSvg } from "@/lib/qr-svg";
import { businessDateOf, businessRangeBounds, fromDbDate, isBusinessDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { Prisma } from "@/generated/prisma/client";
import type { BookingQrEventType, MobilePaymentStatus, ReservationStatus } from "@/generated/prisma/enums";
import type { Actor } from "./reservations";

/**
 * HOTEL BOOKING QR (owner, 2026-10-05) — "Scan to book your stay": printed codes around the hotel (reception, the
 * entrance, rooms, flyers…) that open the hotel's own booking app at /b/<token>. Each code is a saved row: its id is the
 * identity (bookings and numbers point to it), its token is the printed key — a new one can be made (the old card stops
 * working at once) or the code switched off. Bookings made from it are ordinary reservations with the source HOTEL_QR,
 * made by the one reservation engine; this file manages the codes, counts what visitors do, and gives staff the numbers.
 * Reception views, prints and follows its bookings; the Admin (hotel_qr.manage) changes the codes and the switches.
 */

export const HOTEL_QR_SOURCE = "HOTEL_QR";
export const newBookingQrToken = () => randomBytes(12).toString("hex");
/** 24 hex characters — checked before any database read, everywhere a token comes from a phone. */
export const BOOKING_QR_TOKEN = /^[a-f0-9]{24}$/;
export const validBookingQrToken = (t: unknown): t is string => typeof t === "string" && BOOKING_QR_TOKEN.test(t);

/** The note a Hotel QR booking is made with — staff read it on the booking; it also tells how the guest chose to pay. */
export const QR_PAY_ONLINE_NOTE = "Hotel QR: booked and paying online (nTZS) — confirmed by the payment.";
export const QR_PAY_HOTEL_NOTE = "Hotel QR: reserved to pay at the hotel — the room is held until the hold time, then released if not paid.";

/** The QR app's confirmation page of a booking (the manage token is the key; never a database id). */
export const qrConfirmPath = (qrToken: string, reference: string, manageToken: string) =>
  `/b/${qrToken}/done?ref=${encodeURIComponent(reference)}&key=${encodeURIComponent(manageToken)}`;
export const bookingQrUrl = (origin: string, token: string) => `${origin.replace(/\/$/, "")}/b/${token}`;

const has = (a: Actor, ...codes: string[]) => codes.some((c) => a.permissions?.has(c));
/** Changing the codes and the switches is the Admin's (MD, owner). */
export const canManageHotelQr = (a: Actor) => has(a, "hotel_qr.manage");
/** Reception, managers and the Admin see the codes (to show, print, open) and the bookings made from them. */
export const canViewHotelQr = (a: Actor) => has(a, "reservations.view", "hotel_qr.manage", "reports.view");
/** The numbers over a period (scans, bookings, money) are for managers and the Admin. */
export const canSeeHotelQrNumbers = (a: Actor) => has(a, "reports.view", "hotel_qr.manage");

function mustManage(a: Actor) {
  if (!canManageHotelQr(a)) throw new AppError("Only the Admin can change the Hotel QR.", "FORBIDDEN");
}
function mustView(a: Actor) {
  if (!canViewHotelQr(a)) throw new AppError("You do not have permission to see the Hotel QR.", "FORBIDDEN");
}

/** Absolute links for printing: the live site when configured (see siteOrigin). */
async function originOrSite() {
  try { return await siteOrigin(); } catch { return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, ""); }
}

// ───────────────────────── The scanned token (public) ─────────────────────────

/** The QR behind a scanned token while it works (on, not archived). Unknown, switched off, archived or replaced: null. */
export async function activeBookingQr(token: string) {
  if (!validBookingQrToken(token)) return null;
  const qr = await db.bookingQrCode.findUnique({ where: { token }, select: { id: true, label: true, active: true, isActive: true } });
  return qr && qr.active && qr.isActive ? { id: qr.id, label: qr.label } : null;
}

/** The same, for a step that needs it (search, book…): a QR that stopped working says so. */
export async function requireBookingQr(token: string) {
  const qr = await activeBookingQr(token);
  if (!qr) throw new AppError("This booking QR code is no longer active — please ask reception, or scan the code at the desk.", "NOT_FOUND");
  return qr;
}

// ───────────────────────── The codes (staff) ─────────────────────────

export type BookingQrCard = {
  id: string; label: string; placement: string | null; token: string; url: string; qr: string;
  active: boolean; archived: boolean; sortOrder: number; scans: number; lastScannedAt: Date | null;
  regeneratedAt: Date | null; revokedAt: Date | null; createdAt: Date; madeBy: string | null; bookings: number;
};

/** Every code (or the archived ones), with its link, the QR drawing (SVG), scans and how many bookings it brought. */
export async function bookingQrCodes(actor: Actor, opts: { archived?: boolean; origin?: string } = {}): Promise<BookingQrCard[]> {
  mustView(actor);
  const origin = opts.origin ?? (await originOrSite());
  const rows = await db.bookingQrCode.findMany({
    where: { isActive: !opts.archived },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { generatedBy: { select: { fullName: true } }, _count: { select: { reservations: true } } },
  });
  return rows.map((q) => {
    const url = bookingQrUrl(origin, q.token);
    return {
      id: q.id, label: q.label, placement: q.placement, token: q.token, url, qr: qrSvg(url),
      active: q.active && q.isActive, archived: !q.isActive, sortOrder: q.sortOrder, scans: q.scanCount, lastScannedAt: q.lastScannedAt,
      regeneratedAt: q.regeneratedAt, revokedAt: q.revokedAt, createdAt: q.createdAt, madeBy: q.generatedBy?.fullName ?? null, bookings: q._count.reservations,
    };
  });
}

function cleanLabel(input: { label: string; placement?: string | null }) {
  const label = input.label.trim().replace(/\s+/g, " ");
  if (label.length < 2 || label.length > 60) throw new AppError("Name the place the QR goes (e.g. Entrance, Lobby, Flyer).", "VALIDATION", { label: "Required" });
  const placement = input.placement?.trim().replace(/\s+/g, " ") || null;
  if (placement && placement.length > 120) throw new AppError("Keep the note short.", "VALIDATION", { placement: "Too long" });
  return { label, placement };
}

/** A new code for another place (the entrance, a flyer…) — its own token, its own numbers. */
export async function createBookingQr(input: { label: string; placement?: string | null }, actor: Actor) {
  mustManage(actor);
  const { label, placement } = cleanLabel(input);
  return db.$transaction(async (tx) => {
    const last = await tx.bookingQrCode.aggregate({ _max: { sortOrder: true } });
    const qr = await tx.bookingQrCode.create({
      data: { label, placement, token: newBookingQrToken(), sortOrder: (last._max.sortOrder ?? 0) + 1, generatedById: actor.userId ?? null },
    });
    await audit(tx, actor, { action: "hotel_qr.created", entityType: "BookingQrCode", entityId: qr.id, after: { label, placement } });
    return { id: qr.id, token: qr.token };
  });
}

async function loadCode(tx: Tx, id: string) {
  const qr = await tx.bookingQrCode.findUnique({ where: { id } });
  if (!qr) throw new AppError("QR code not found.", "NOT_FOUND");
  return qr;
}

/** Rename a code or change where it is placed (the printed card keeps working). */
export async function updateBookingQr(id: string, input: { label: string; placement?: string | null }, actor: Actor) {
  mustManage(actor);
  const { label, placement } = cleanLabel(input);
  await db.$transaction(async (tx) => {
    const qr = await loadCode(tx, id);
    await tx.bookingQrCode.update({ where: { id }, data: { label, placement } });
    await audit(tx, actor, { action: "hotel_qr.renamed", entityType: "BookingQrCode", entityId: id, before: { label: qr.label, placement: qr.placement }, after: { label, placement } });
  });
}

/**
 * A new QR for a place (a card was taken, or should stop working): the old card stops working at once — everywhere —
 * and the new one works straight away (also when the code was switched off). Past bookings keep their link.
 */
export async function regenerateBookingQr(id: string, actor: Actor, now = new Date()) {
  mustManage(actor);
  return db.$transaction(async (tx) => {
    const qr = await loadCode(tx, id);
    if (!qr.isActive) throw new AppError("This QR is archived — make a new one instead.", "CONFLICT");
    const token = newBookingQrToken();
    await tx.bookingQrCode.update({ where: { id }, data: { token, regeneratedAt: now, generatedById: actor.userId ?? null, active: true, revokedAt: null } });
    await audit(tx, actor, { action: "hotel_qr.regenerated", entityType: "BookingQrCode", entityId: id, before: { label: qr.label, active: qr.active }, after: { label: qr.label, active: true } });
    return { token };
  });
}

/** Switch a code off (revoked: scanning it says it is not active, nothing can be booked from it) or back on. */
export async function setBookingQrActive(id: string, active: boolean, actor: Actor, now = new Date()) {
  mustManage(actor);
  await db.$transaction(async (tx) => {
    const qr = await loadCode(tx, id);
    if (!qr.isActive) throw new AppError("This QR is archived.", "CONFLICT");
    if (qr.active === active) return;
    await tx.bookingQrCode.update({ where: { id }, data: { active, revokedAt: active ? null : now } });
    await audit(tx, actor, { action: active ? "hotel_qr.enabled" : "hotel_qr.disabled", entityType: "BookingQrCode", entityId: id, before: { label: qr.label, active: qr.active }, after: { label: qr.label, active } });
  });
}

/** Archive a code no longer used: it stops working and leaves the list; its bookings and numbers stay. */
export async function archiveBookingQr(id: string, actor: Actor, now = new Date()) {
  mustManage(actor);
  await db.$transaction(async (tx) => {
    const qr = await loadCode(tx, id);
    if (!qr.isActive) return;
    await tx.bookingQrCode.update({ where: { id }, data: { isActive: false, active: false, revokedAt: qr.revokedAt ?? now } });
    await audit(tx, actor, { action: "hotel_qr.archived", entityType: "BookingQrCode", entityId: id, before: { label: qr.label, active: qr.active }, after: { label: qr.label, active: false, archived: true } });
  });
}

/**
 * The Admin's two switches: booking from the QR on or off, and whether a guest may reserve there and pay at the hotel.
 * Paying online follows the hotel's "Room bookings" online-payment switch (Finance → Online payments).
 */
export async function setHotelQrSettings(input: { enabled?: boolean; payAtHotel?: boolean }, actor: Actor) {
  mustManage(actor);
  const data: { hotelQrEnabled?: boolean; hotelQrPayAtHotel?: boolean } = {};
  if (typeof input.enabled === "boolean") data.hotelQrEnabled = input.enabled;
  if (typeof input.payAtHotel === "boolean") data.hotelQrPayAtHotel = input.payAtHotel;
  return db.$transaction(async (tx) => {
    const before = await tx.hotelSettings.findUniqueOrThrow({ where: { id: 1 }, select: { hotelQrEnabled: true, hotelQrPayAtHotel: true } });
    const after = Object.keys(data).length ? await tx.hotelSettings.update({ where: { id: 1 }, data, select: { hotelQrEnabled: true, hotelQrPayAtHotel: true } }) : before;
    if (Object.keys(data).length) {
      await audit(tx, actor, {
        action: "hotel_qr.settings", entityType: "HotelSettings", entityId: "1",
        before: { bookingOn: before.hotelQrEnabled, payAtHotel: before.hotelQrPayAtHotel }, after: { bookingOn: after.hotelQrEnabled, payAtHotel: after.hotelQrPayAtHotel },
      });
    }
    return { enabled: after.hotelQrEnabled, payAtHotel: after.hotelQrPayAtHotel };
  });
}

/** What was changed on the Hotel QR, newest first (made, renamed, new code, on / off, archived, the switches). */
export async function hotelQrHistory(actor: Actor, take = 30) {
  if (!has(actor, "hotel_qr.manage", "staff.activity.view")) throw new AppError("You do not have permission to see this history.", "FORBIDDEN");
  const rows = await db.auditLog.findMany({
    where: { action: { startsWith: "hotel_qr." } }, orderBy: { createdAt: "desc" }, take: Math.min(Math.max(1, take), 200),
    select: { id: true, createdAt: true, action: true, actorLabel: true, entityId: true, before: true, after: true },
  });
  return rows.map((r) => ({ id: r.id, at: r.createdAt, action: r.action, by: r.actorLabel ?? "System", qrId: r.entityId, before: r.before, after: r.after }));
}

// ───────────────────────── What visitors do (the funnel) ─────────────────────────

/** Each step is counted at most this often per visitor (a refresh loop does not inflate the numbers). */
const EVENT_LIMIT: Record<BookingQrEventType, [count: number, seconds: number]> = {
  SCAN: [1, 1800], SEARCH: [30, 600], SELECT: [30, 600], ATTEMPT: [10, 600],
};
/**
 * …and scans at most this often per address and code: the visitor's key is chosen by their browser, so a script that
 * invents a new one each time adds a few scans an hour, not thousands (a hotel Wi-Fi has room for a lobby of guests).
 * Searches, room picks and "Book" are limited per address where they are asked for.
 */
const SCANS_PER_ADDRESS: [count: number, seconds: number] = [10, 1800];

/** Who did it: their browser's own key (else their address), and their address. */
export type QrEventVisitor = { visitor?: string | null; ip?: string | null };

/** Count one step for a QR already found on the server. A scan also moves the code's own counter. Returns whether it was counted. */
export async function logQrEvent(qrId: string, type: BookingQrEventType, visit: QrEventVisitor, now = new Date()) {
  const [count, seconds] = EVENT_LIMIT[type];
  try {
    await rateLimit(`bqr-event:${type}:${qrId}:${visit.visitor ?? visit.ip ?? "unknown"}`, count, seconds);
    if (type === "SCAN") await rateLimit(`bqr-event:SCAN:${qrId}:address:${visit.ip ?? "unknown"}`, ...SCANS_PER_ADDRESS);
  } catch (e) {
    if (e instanceof AppError && e.code === "RATE_LIMITED") return false;
    throw e;
  }
  if (type === "SCAN") {
    await db.$transaction([
      db.bookingQrEvent.create({ data: { qrId, type, createdAt: now } }),
      db.bookingQrCode.update({ where: { id: qrId }, data: { scanCount: { increment: 1 }, lastScannedAt: now } }),
    ]);
  } else {
    await db.bookingQrEvent.create({ data: { qrId, type, createdAt: now } });
  }
  return true;
}

/** A visitor's step reported by the QR app (the scan, when the page opens): counted only while the QR works. */
export async function recordQrEvent(token: string, type: BookingQrEventType, visit: QrEventVisitor = {}, now = new Date()) {
  const qr = await activeBookingQr(token);
  if (!qr) return false;
  return logQrEvent(qr.id, type, visit, now);
}

// ───────────────────────── Payment status of a QR booking ─────────────────────────

/** Where a QR booking's money stands — for the guest's confirmation and reception's list. */
export type QrPaymentStatus = "PAYMENT_PENDING" | "PAID" | "PAYMENT_FAILED" | "PAYMENT_EXPIRED" | "REFUNDED" | "PARTIALLY_PAID" | "PAY_AT_HOTEL";
export type QrPayWay = "ONLINE" | "HOTEL";

/** How the guest chose to pay: the note the booking was made with — without it, whether they started paying online. */
export function qrPayWay(r: { internalNotes: string | null; startedOnline: boolean }): QrPayWay {
  if (r.internalNotes?.includes(QR_PAY_ONLINE_NOTE)) return "ONLINE";
  if (r.internalNotes?.includes(QR_PAY_HOTEL_NOTE)) return "HOTEL";
  return r.startedOnline ? "ONLINE" : "HOTEL";
}

/**
 * From the booking's money (the engine's numbers: paid, balance, refunds) and its latest online payment. "Paid" only
 * once the money is on the booking — nTZS confirmed it (webhook / check), never because the guest pressed Pay.
 */
export function qrPaymentStatus(
  r: { paidAmount: number; balanceAmount: number; refunded: number },
  way: QrPayWay,
  latest: { status: MobilePaymentStatus; expiresAt: Date | null } | null,
  now = new Date(),
): QrPaymentStatus {
  if (r.paidAmount > 0) return r.balanceAmount > 0 ? "PARTIALLY_PAID" : "PAID";
  if (r.refunded > 0) return "REFUNDED";
  const live = latest?.status === "PENDING" && (!latest.expiresAt || latest.expiresAt > now);
  // On its way — or confirmed by nTZS a moment ago and being put on the booking.
  if (live || latest?.status === "COMPLETED") return "PAYMENT_PENDING";
  if (way === "HOTEL") return "PAY_AT_HOTEL";
  if (!latest) return "PAYMENT_FAILED"; // the payment request could not start
  return latest.status === "EXPIRED" || latest.status === "PENDING" ? "PAYMENT_EXPIRED" : "PAYMENT_FAILED";
}

/** nTZS's reference for the money that came in (what the guest's phone shows), if any. */
export function ntzsReferenceOf(
  mps: { status: MobilePaymentStatus; pspReference: string | null; depositId: string | null }[],
  payments: { kind: string; reference: string | null; method: { code: string } }[],
) {
  const done = mps.find((m) => m.status === "COMPLETED");
  if (done) return done.pspReference ?? done.depositId;
  const p = payments.find((x) => x.kind === "PAYMENT" && x.method.code === "NTZS" && x.reference);
  return p?.reference?.replace(/^nTZS\s+/, "") ?? null;
}

// ───────────────────────── Bookings made from the QR (staff) ─────────────────────────

export type QrBookingsView = "all" | "waiting" | "paid" | "arriving" | "upcoming" | "cancelled";
export type QrBookingsFilter = {
  view?: QrBookingsView;
  /** Made between these hotel days (inclusive). */
  from?: BusinessDate | null; to?: BusinessDate | null;
  qrId?: string | null;
  /** Reference, guest name or phone. */
  q?: string | null;
  take?: number;
};

export type QrBookingRow = {
  id: string; reference: string; guestName: string; phone: string | null; email: string | null;
  rooms: { number: string; typeName: string }[]; roomType: string;
  checkIn: BusinessDate; checkOut: BusinessDate; nights: number; adults: number; children: number;
  status: ReservationStatus; paymentStatus: QrPaymentStatus; payWay: QrPayWay;
  amount: number; paid: number; balance: number; holdUntil: Date | null;
  ntzsReference: string | null; specialRequest: string | null; arrivalTime: string | null; notes: string | null;
  qr: { id: string; label: string } | null; source: "HOTEL_QR"; createdAt: Date;
  /** The booking details reached the guest (sent by the provider, or by reception from the booking) — else reception sends them. */
  detailsSent: boolean;
  /** The company pays (no money is taken from the guest here). */
  companyPays: boolean;
};

/** Hotel QR bookings for reception and managers — who, which room, when, and where the money stands (incl. nTZS's reference). */
export async function qrBookings(actor: Actor, filter: QrBookingsFilter = {}, now = new Date()): Promise<QrBookingRow[]> {
  mustView(actor);
  const s = await getSettings();
  const today = toDbDate(businessDateOf(now, stayConfig(s)));
  const view = filter.view ?? "all";
  const where: Prisma.ReservationWhereInput = { source: { code: HOTEL_QR_SOURCE }, ...(filter.qrId ? { bookingQrId: filter.qrId } : {}) };
  const and: Prisma.ReservationWhereInput[] = [];
  if (view === "waiting") and.push({ status: "RESERVED" });
  if (view === "paid") and.push({ paidAmount: { gt: 0 } });
  if (view === "arriving") and.push({ arrivalDate: today, status: { in: ["RESERVED", "CONFIRMED"] } });
  if (view === "upcoming") and.push({ arrivalDate: { gte: today }, status: { in: ["RESERVED", "CONFIRMED"] } });
  if (view === "cancelled") and.push({ status: { in: ["CANCELLED", "NO_SHOW"] } });
  if (filter.from && isBusinessDate(filter.from)) and.push({ businessDate: { gte: toDbDate(filter.from) } });
  if (filter.to && isBusinessDate(filter.to)) and.push({ businessDate: { lte: toDbDate(filter.to) } });
  const q = filter.q?.trim().slice(0, 60);
  if (q) {
    const digits = q.replace(/\D/g, "").replace(/^0/, "");
    and.push({ OR: [
      { reference: { contains: q, mode: "insensitive" } },
      { guest: { fullName: { contains: q, mode: "insensitive" } } },
      ...(digits.length >= 4 ? [{ guest: { phone: { contains: digits } } }] : []),
    ] });
  }
  const rows = await db.reservation.findMany({
    where: { ...where, AND: and },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, filter.take ?? 100), 300),
    select: {
      id: true, reference: true, status: true, arrivalDate: true, departureDate: true, adults: true, children: true, netAmount: true, paidAmount: true, balanceAmount: true,
      holdUntil: true, specialRequests: true, eta: true, internalNotes: true, createdAt: true,
      guest: { select: { fullName: true, phone: true, email: true } },
      bookingQr: { select: { id: true, label: true } },
      rooms: { orderBy: { createdAt: "asc" }, select: { nights: true, status: true, room: { select: { number: true } }, roomType: { select: { name: true } } } },
      payments: { where: { status: "POSTED" }, select: { kind: true, amount: true, reference: true, method: { select: { code: true } } } },
      mobilePayments: { where: { initiator: "CUSTOMER" }, orderBy: { createdAt: "desc" }, select: { status: true, expiresAt: true, pspReference: true, depositId: true } },
      guestMessages: { where: { type: { in: ["BOOKING_CREATED", "BOOKING_CONFIRMED"] }, status: { not: "FAILED" } }, take: 1, select: { id: true } },
      billTo: true,
    },
  });
  return rows.map((r) => {
    const live = r.rooms.filter((x) => x.status !== "CANCELLED");
    const shown = live.length ? live : r.rooms;
    const way = qrPayWay({ internalNotes: r.internalNotes, startedOnline: r.mobilePayments.length > 0 });
    const refunded = r.payments.filter((p) => p.kind === "REFUND").reduce((t, p) => t + p.amount, 0);
    return {
      id: r.id, reference: r.reference, guestName: r.guest.fullName, phone: r.guest.phone, email: r.guest.email,
      rooms: shown.map((x) => ({ number: x.room.number, typeName: x.roomType.name })), roomType: [...new Set(shown.map((x) => x.roomType.name))].join(", "),
      checkIn: fromDbDate(r.arrivalDate), checkOut: fromDbDate(r.departureDate), nights: shown.reduce((m, x) => Math.max(m, x.nights), 0), adults: r.adults, children: r.children,
      status: r.status, paymentStatus: qrPaymentStatus({ paidAmount: r.paidAmount, balanceAmount: r.balanceAmount, refunded }, way, r.mobilePayments[0] ?? null, now), payWay: way,
      amount: r.netAmount, paid: r.paidAmount, balance: r.balanceAmount, holdUntil: r.status === "RESERVED" ? r.holdUntil : null,
      ntzsReference: ntzsReferenceOf(r.mobilePayments, r.payments), specialRequest: r.specialRequests, arrivalTime: r.eta, notes: r.internalNotes,
      qr: r.bookingQr, source: "HOTEL_QR" as const, createdAt: r.createdAt,
      detailsSent: r.guestMessages.length > 0, companyPays: r.billTo !== "GUEST",
    };
  });
}

// ───────────────────────── The numbers (managers, Admin) ─────────────────────────

export interface BookingQrNumbers {
  /** Visits counted when the booking page opened (one per visitor per half hour). */
  scans: number;
  searches: number;
  /** A room opened to see its price (the room details). */
  selections: number;
  /** "Book" pressed with everything filled in. */
  attempts: number;
  /** Reservations made from the QR on these days (enquiries excluded). */
  bookings: number;
  /** …of which confirmed (paid, or confirmed by the hotel), in the hotel or gone home. */
  confirmed: number;
  /** …still waiting: held for payment. */
  waiting: number;
  /** …released or not used (hold ran out, cancelled, no-show). */
  cancelled: number;
  /** Online payments nTZS confirmed in the period; and their money as recorded on the bookings (less any reversed since). */
  paymentsCompleted: number;
  paidOnline: number;
  paymentsFailed: number;
  paymentsExpired: number;
  paymentsPending: number;
  /**
   * Money actually received on QR bookings in the period — any way (online, at the desk), less refunds — counted like
   * Reports: each payment on its own day, a reversal on the day it was reversed (a closed month does not change).
   */
  revenue: number;
  /** bookings ÷ scans (null before the first scan). */
  conversionRate: number | null;
}
export interface BookingQrAnalytics extends BookingQrNumbers {
  from: BusinessDate; to: BusinessDate; qrId: string | null;
  byQr: ({ qrId: string; label: string; active: boolean; archived: boolean } & BookingQrNumbers)[];
}

const CONFIRMED: ReservationStatus[] = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
const blank = (): BookingQrNumbers => ({
  scans: 0, searches: 0, selections: 0, attempts: 0, bookings: 0, confirmed: 0, waiting: 0, cancelled: 0,
  paymentsCompleted: 0, paidOnline: 0, paymentsFailed: 0, paymentsExpired: 0, paymentsPending: 0, revenue: 0, conversionRate: null,
});

/**
 * The Hotel QR's numbers for a period (hotel days), for all codes or one: what visitors did (counted by the app), and —
 * from the bookings and payments themselves, the one source of truth — what it brought (bookings by the day they were
 * made, like Reports; payments by the day they came in).
 */
export async function bookingQrAnalytics(actor: Actor, period: { from: BusinessDate; to: BusinessDate }, qrId?: string | null, now = new Date()): Promise<BookingQrAnalytics> {
  if (!canSeeHotelQrNumbers(actor)) throw new AppError("Only managers and the Admin see the Hotel QR's numbers.", "FORBIDDEN");
  if (!isBusinessDate(period.from) || !isBusinessDate(period.to) || period.to < period.from) throw new AppError("Choose a valid period.", "VALIDATION");
  const s = await getSettings();
  const { start, end } = businessRangeBounds(period.from, period.to, stayConfig(s));
  const qrWhere = qrId ? { bookingQrId: qrId } : {};
  const resWhere: Prisma.ReservationWhereInput = { source: { code: HOTEL_QR_SOURCE }, ...qrWhere };
  const [codes, events, bookings, mps, money] = await Promise.all([
    db.bookingQrCode.findMany({ where: qrId ? { id: qrId } : {}, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, label: true, active: true, isActive: true } }),
    db.bookingQrEvent.groupBy({ by: ["qrId", "type"], where: { createdAt: { gte: start, lt: end }, ...(qrId ? { qrId } : {}) }, _count: true }),
    db.reservation.findMany({
      where: { ...resWhere, status: { not: "INQUIRY" }, businessDate: { gte: toDbDate(period.from), lte: toDbDate(period.to) } },
      select: { bookingQrId: true, status: true },
    }),
    db.mobilePayment.findMany({
      where: { initiator: "CUSTOMER", purpose: "RESERVATION", reservation: resWhere, OR: [{ createdAt: { gte: start, lt: end } }, { completedAt: { gte: start, lt: end } }] },
      select: { status: true, amount: true, createdAt: true, completedAt: true, expiresAt: true, reservation: { select: { bookingQrId: true } } },
    }),
    db.payment.findMany({
      where: {
        reservation: resWhere,
        OR: [
          { status: { in: ["POSTED", "REVERSED"] }, businessDate: { gte: toDbDate(period.from), lte: toDbDate(period.to) } },
          { status: "REVERSED", reversalBusinessDate: { gte: toDbDate(period.from), lte: toDbDate(period.to) } },
        ],
      },
      select: { id: true, kind: true, amount: true, status: true, businessDate: true, reversalBusinessDate: true, reservation: { select: { bookingQrId: true } } },
    }),
  ]);
  // Which of those payments the guests made online themselves (nTZS, recorded from their payment request).
  const online = new Set((await db.mobilePayment.findMany({
    where: { initiator: "CUSTOMER", status: "COMPLETED", paymentId: { in: money.map((p) => p.id) } }, select: { paymentId: true },
  })).map((m) => m.paymentId));

  const total = blank();
  const per = new Map(codes.map((c) => [c.id, blank()]));
  const into = (id: string | null | undefined, f: (n: BookingQrNumbers) => void) => {
    f(total);
    const n = id ? per.get(id) : undefined;
    if (n) f(n);
  };
  const EVENT_FIELD: Record<BookingQrEventType, "scans" | "searches" | "selections" | "attempts"> = { SCAN: "scans", SEARCH: "searches", SELECT: "selections", ATTEMPT: "attempts" };
  for (const e of events) into(e.qrId, (n) => { n[EVENT_FIELD[e.type]] += e._count; });
  for (const b of bookings) {
    into(b.bookingQrId, (n) => {
      n.bookings += 1;
      if (CONFIRMED.includes(b.status)) n.confirmed += 1;
      else if (b.status === "RESERVED") n.waiting += 1;
      else if (b.status === "CANCELLED" || b.status === "NO_SHOW") n.cancelled += 1;
    });
  }
  const inPeriod = (d: Date | null) => !!d && d >= start && d < end;
  for (const m of mps) {
    into(m.reservation?.bookingQrId, (n) => {
      if (m.status === "COMPLETED") {
        if (inPeriod(m.completedAt)) n.paymentsCompleted += 1;
      } else if (inPeriod(m.createdAt)) {
        const timedOut = m.status === "EXPIRED" || (m.status === "PENDING" && !!m.expiresAt && m.expiresAt <= now);
        if (timedOut) n.paymentsExpired += 1;
        else if (m.status === "PENDING") n.paymentsPending += 1;
        else n.paymentsFailed += 1;
      }
    });
  }
  const from = toDbDate(period.from).getTime(), to = toDbDate(period.to).getTime();
  const inDays = (d: Date | null) => !!d && d.getTime() >= from && d.getTime() <= to;
  for (const p of money) {
    const signed = p.kind === "PAYMENT" ? p.amount : -p.amount;
    // On its own day; a reversal takes it back on the day it was reversed (or its own day, when that was not kept).
    const amount = (inDays(p.businessDate) ? signed : 0) - (p.status === "REVERSED" && inDays(p.reversalBusinessDate ?? p.businessDate) ? signed : 0);
    if (!amount) continue;
    into(p.reservation?.bookingQrId, (n) => {
      n.revenue += amount;
      if (online.has(p.id)) n.paidOnline += amount;
    });
  }
  const rate = (n: BookingQrNumbers) => ({ ...n, conversionRate: n.scans > 0 ? n.bookings / n.scans : null });

  return {
    from: period.from, to: period.to, qrId: qrId ?? null, ...rate(total),
    byQr: codes
      .map((c) => ({ qrId: c.id, label: c.label, active: c.active && c.isActive, archived: !c.isActive, ...rate(per.get(c.id)!) }))
      // An archived code is listed only for a period it still has numbers in.
      .filter((r) => !r.archived || !!(r.scans || r.bookings || r.revenue || r.paymentsCompleted)),
  };
}
