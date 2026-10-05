import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { AppError } from "../errors";
import { rateLimit } from "../rate-limit";
import { getSettings, stayConfig } from "../settings";
import { formatTZS } from "@/lib/format";
import { prettyPhone, validPhone } from "@/lib/guest-messages";
import { addDays, businessDateOf, diffDays, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { GalleryImage } from "@/components/public/content";
import type { HotelSettings } from "@/generated/prisma/client";
import type { BookingQrEventType, ReservationStatus } from "@/generated/prisma/enums";
import { holdDeadline, noShowCutoff, refreshBookingStates } from "./booking-holds";
import { findAvailableRooms } from "./availability";
import { channelFor, loadPricing, quoteFromPromos, quoteStay, type StayQuote } from "./pricing";
import { createReservation, type Actor } from "./reservations";
import { normalizePhone } from "./guests";
import { requestTransportForReservation } from "./transport";
import { notifyBookingGuestSoon } from "./guest-comms";
import { getSiteContent } from "./site-content";
import { ntzsEnabled } from "./ntzs";
import {
  bookAndPayOnline, bookingPayOnline, customerPaymentByToken, ONLINE_BOOKING_HOLD_MINUTES, onlinePayAvailable, payBookingOnline,
} from "./online-pay";
import {
  bookingWindow, buildStay, getBookingForGuest, listPublicRoomTypes, MAX_ADULTS, parseStayParams, publicBookingData, tonightAvailability, websitePricer,
  type PublicRoomType, type StayParams,
} from "./public-booking";
import {
  activeBookingQr, canManageHotelQr, canSeeHotelQrNumbers, canViewHotelQr, HOTEL_QR_SOURCE, logQrEvent, ntzsReferenceOf, QR_PAY_HOTEL_NOTE,
  QR_PAY_ONLINE_NOTE, qrConfirmPath, qrPaymentStatus, qrPayWay, requireBookingQr, type QrPaymentStatus, type QrPayWay,
} from "./booking-qr";

/**
 * THE HOTEL BOOKING QR APP (/b/<token>) — the server side of "Scan → hotel → rooms → availability → book → pay → confirm".
 * It is a booking channel, not a booking system: every step is a call into the services the website and reception use —
 * room types and prices from public-booking / PricingService (the QR is priced like the website), free rooms from the
 * availability engine, the booking from the one reservation engine (source HOTEL_QR, customer matched by phone), the
 * hold rules from booking-holds, and paying online from online-pay (nTZS). Nothing the phone sends is trusted: the QR is
 * found again from its token, the room, the price and the money are worked out here each time, and a booking is paid
 * only once nTZS has confirmed it. Nothing returned here carries a database id.
 */

// ───────────────────────── Shapes the QR app receives ─────────────────────────

/** A room type as the QR app shows it. */
export type QrRoomTypeInfo = {
  slug: string; name: string; shortDescription: string | null; description: string | null; images: string[];
  amenities: { code: string; name: string; icon: string | null }[];
  maxAdults: number; maxChildren: number; bedType: string | null; sizeSqm: number | null;
};
export type QrRoomType = QrRoomTypeInfo & {
  /** The normal price per night. */
  baseRate: number;
  /** Tonight's price per night (after the website promotion, if any) — the "from" price. */
  fromPerNight: number;
  promotion: string | null; promoLabel: string | null;
  /** Rooms of this type free tonight. */
  freeTonight: number;
};
export type QrHotel = {
  name: string; tagline: string | null; phone: string | null; whatsapp: string | null; email: string | null; address: string | null;
  checkInTime: string; checkoutTime: string; receptionHours: string | null; breakfastHours: string | null;
};
export type QrPayOptions = {
  /** Pay online (nTZS) offered now. */
  online: boolean;
  /** Reserve now and pay at the hotel offered now (for these dates, once they are known). */
  atHotel: boolean;
  /** How long a pay-at-hotel booking keeps its room (0 = until the arrival day). */
  holdHours: number;
  /** How long a booking keeps its room while the guest pays online. */
  onlineHoldMinutes: number;
  /**
   * Pay at the hotel for these dates: the room is kept until the guest arrives ("arrival"), or only for holdHours and
   * then released if not paid ("hold") — so the screen never promises "pay when you arrive" when that is not so.
   * Null before the dates are known (the landing).
   */
  atHotelKeeps: "arrival" | "hold" | null;
  /** Pay at the hotel is on, but not for these dates (a long stay, far ahead, or many rooms already waiting): why. */
  atHotelNote: string | null;
};
export type QrLanding = {
  active: true;
  hotel: QrHotel & {
    hero: { src: string; alt: string };
    slides: { src: string; mobileSrc: string | null; alt: string; caption: string | null }[];
    photos: { src: string; alt: string; width: number; height: number; category: string }[];
    highlights: string[];
  };
  policies: string[];
  roomTypes: QrRoomType[];
  booking: QrPayOptions & { open: boolean; message: string | null };
  /** What can be searched: dates from today up to maxCheckIn, up to maxNights; the most guests one room holds. */
  window: { today: BusinessDate; maxCheckIn: BusinessDate; maxNights: number; maxAdults: number; maxChildren: number; maxGuests: number };
};
/** A QR that does not work (unknown, switched off, replaced, archived): who to contact instead. */
export type QrInactive = { active: false; hotel: Pick<QrHotel, "name" | "phone" | "whatsapp">; message: string };

export type QrStayInput = { checkIn: string; checkOut: string; adults: number; children: number };
export type QrStay = { checkIn: BusinessDate; checkOut: BusinessDate; nights: number; adults: number; children: number; checkInTime: string; checkoutTime: string };
/** One room that can really be booked for the stay, priced for it. */
export type QrRoomOffer = {
  number: string; floor: number | null; typeSlug: string; typeName: string;
  /** Normal price per night (average when nights differ) and the price after the promotion. */
  ratePerNight: number; perNight: number;
  gross: number; discount: number; total: number; promotion: string | null;
};
export type QrSearchResult = {
  stay: QrStay;
  /** Room types with free rooms that fit the party, cheapest first, each with its bookable rooms. */
  types: { type: QrRoomTypeInfo; available: number; fromPerNight: number; fromTotal: number; rooms: QrRoomOffer[] }[];
  /** Types with free rooms that one room of cannot hold this party. */
  tooSmall: { slug: string; name: string; maxAdults: number; maxChildren: number; available: number }[];
};
export type QrQuote = {
  stay: QrStay;
  room: { number: string; floor: number | null };
  type: QrRoomTypeInfo;
  /** Night by night: the price that night (a date price may apply), its discount and what is paid. */
  nights: { date: BusinessDate; price: number; discount: number; net: number; datePrice: string | null; promotion: string | null }[];
  ratePerNight: number; perNight: number; sameEveryNight: boolean;
  gross: number; discount: number; total: number; promotion: string | null;
  pay: QrPayOptions;
  policies: string[];
};
export type QrBookInput = QrStayInput & {
  roomNumber: string;
  guest: { fullName: string; phone: string; email?: string | null };
  /** HH:MM the guest expects to arrive. */
  arrivalTime?: string | null;
  specialRequest?: string | null;
  /** A pickup: with a landing time an airport-pickup request is made for the arrival day; otherwise reception arranges it from the note. */
  transportRequest?: { flightNumber?: string | null; arrivalTime?: string | null; note?: string | null } | null;
  pay: QrPayWay;
  /** The mobile-money number to pay from (Pay online) — the guest's phone when not given. */
  payPhone?: string | null;
  /** A fresh 32-hex key per "Book" press (a new one after any error): the same press twice is one booking and one payment. */
  clientKey: string;
};
export type QrBooked = {
  reference: string; manageToken: string; payWay: QrPayWay;
  /** Pay online: the payment page to send the guest to (/pay/<token>); null when it could not start (payError says why). */
  payToken: string | null; payUrl: string | null; payError: string | null;
  /** The QR app's confirmation page of this booking. */
  confirmUrl: string;
  holdUntil: string | null;
};
export type QrConfirmation = {
  reference: string; status: ReservationStatus; confirmed: boolean;
  /** The first name the guest typed when booking (never the profile it was matched to). */
  guestFirstName: string | null;
  /** The hotel's time zone, for the times shown (held until, pickup). */
  timezone: string;
  paymentStatus: QrPaymentStatus; payWay: QrPayWay;
  rooms: { number: string; typeName: string; typeSlug: string }[];
  checkIn: BusinessDate; checkOut: BusinessDate; checkInTime: string; checkoutTime: string; nights: number; adults: number; children: number;
  total: number; paid: number; balance: number; holdUntil: string | null;
  ntzsReference: string | null;
  /** A payment on its way (/pay/<token>), and whether Pay now is offered for what is still owed. */
  livePayment: string | null; canPayNow: boolean;
  /** The guest's private stay link (menu, requests, their bill) and the booking's own page. */
  stayLink: string | null; bookingLink: string;
  pickup: { status: string; at: string; flightNumber: string | null; place: string } | null;
  specialRequest: string | null; arrivalTime: string | null;
  hotel: Pick<QrHotel, "name" | "phone" | "whatsapp">;
  createdAt: string;
};
/** "moved": the link is right but this QR no longer works (or the booking is not from it) — show the booking's own page. */
export type QrConfirmationResult = { state: "ok"; booking: QrConfirmation } | { state: "moved"; href: string } | { state: "not_found" };
/** Who is visiting (for counting the funnel): their address, their browser's key; `track: false` for staff. */
export type QrVisit = { ip?: string | null; visitor?: string | null; track?: boolean };

// ───────────────────────── Helpers ─────────────────────────

const typeInfo = (t: PublicRoomType): QrRoomTypeInfo => ({
  slug: t.slug, name: t.name, shortDescription: t.shortDescription, description: t.description, images: t.images, amenities: t.amenities,
  maxAdults: t.maxAdults, maxChildren: t.maxChildren, bedType: t.bedType, sizeSqm: t.sizeSqm,
});
const fits = (t: { maxAdults: number; maxChildren: number }, p: { adults: number; children: number }) => p.adults <= t.maxAdults && p.children <= t.maxChildren;
const holds = (t: { maxAdults: number; maxChildren: number }) => `${t.maxAdults} adult${t.maxAdults === 1 ? "" : "s"}${t.maxChildren ? ` and ${t.maxChildren} child${t.maxChildren === 1 ? "" : "ren"}` : ""}`;
const taken = (number: string) => new AppError(`Sorry — Room ${number} was just booked for these dates. Please choose another room.`, "UNAVAILABLE", { roomNumber: "Taken" });
const hotelContact = (s: HotelSettings) => ({ name: s.hotelName, phone: s.phone ? prettyPhone(s.phone) : null, whatsapp: s.whatsapp ? prettyPhone(s.whatsapp) : null });
const hoursText = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);

async function payOptions(s: HotelSettings): Promise<QrPayOptions> {
  return {
    online: await onlinePayAvailable("booking", s), atHotel: s.hotelQrPayAtHotel, holdHours: s.unpaidHoldHours, onlineHoldMinutes: ONLINE_BOOKING_HOLD_MINUTES,
    atHotelKeeps: null, atHotelNote: null,
  };
}

/**
 * Pay at the hotel holds a room unpaid for whoever types a phone number — so it has limits that do not depend on what
 * the phone sends: stays up to HOLD_MAX_NIGHTS; held until the arrival day (no hold time set) only for arrivals within
 * HOLD_TO_ARRIVAL_MAX_DAYS; and unpaid QR holds never cover more than a share of the hotel's rooms for any dates.
 * Past those, Pay now (the payment confirms the booking).
 */
export const HOLD_MAX_NIGHTS = 14;
export const HOLD_TO_ARRIVAL_MAX_DAYS = 30;
const HOLD_MAX_SHARE = 0.2;

/** How the guest can pay for this stay — Pay at the hotel checked against those limits, and what it really means. */
async function payOptionsFor(s: HotelSettings, p: Pick<StayParams, "checkIn" | "checkOut">, now = new Date()): Promise<QrPayOptions> {
  const pay = await payOptions(s);
  if (!pay.atHotel) return pay;
  const not = (note: string): QrPayOptions => ({ ...pay, atHotel: false, atHotelNote: note });
  if (diffDays(p.checkIn, p.checkOut) > HOLD_MAX_NIGHTS) return not(`For more than ${HOLD_MAX_NIGHTS} nights, please pay now to book here — or call reception.`);
  if (s.unpaidHoldHours <= 0 && diffDays(businessDateOf(now, stayConfig(s)), p.checkIn) > HOLD_TO_ARRIVAL_MAX_DAYS) {
    return not(`To book more than ${HOLD_TO_ARRIVAL_MAX_DAYS} days ahead here, please pay now — or call reception.`);
  }
  const [rooms, held] = await Promise.all([
    db.room.count({ where: { isActive: true, roomType: { isActive: true, isPublic: true, category: "GUEST_ROOM" } } }),
    db.reservation.count({
      where: {
        source: { code: HOTEL_QR_SOURCE }, status: "RESERVED", paidAmount: { lte: 0 }, internalNotes: { contains: QR_PAY_HOTEL_NOTE },
        OR: [{ holdUntil: null }, { holdUntil: { gt: now } }], arrivalDate: { lt: toDbDate(p.checkOut) }, departureDate: { gt: toDbDate(p.checkIn) },
      },
    }),
  ]);
  if (held >= Math.max(2, Math.ceil(rooms * HOLD_MAX_SHARE))) return not("Pay at the hotel is not available for these dates — please pay now to book, or call reception.");
  // Kept until they come only when the hold outlasts the arrival day (or there is no hold time); otherwise "pay within".
  const end = holdDeadline(s, now);
  return { ...pay, atHotelKeeps: !end || end >= noShowCutoff(p.checkIn, s) ? "arrival" : "hold" };
}

/** The hotel's rules, in plain words, from its settings (never written into the page). */
function policiesOf(s: HotelSettings, pay: QrPayOptions) {
  const w = bookingWindow(s);
  return [
    `Check-in from ${w.checkInTime}. Check-out by ${w.checkoutTime}.`,
    pay.online ? `Pay online and your booking is confirmed as soon as the payment comes in. We keep the room for ${pay.onlineHoldMinutes} minutes while you pay.` : null,
    pay.atHotel
      ? s.unpaidHoldHours > 0 ? `Pay at the hotel: we keep your room for ${hoursText(s.unpaidHoldHours)}. If it is not paid by then, the room is released.` : "Pay at the hotel: we keep your room until your arrival day."
      : null,
    s.noShowPolicy === "REFUND_DUE" ? "Paid but cannot come? Tell us and your payment is refunded." : "A paid booking that is cancelled or not used is not refunded.",
    s.lateCheckoutFee > 0 ? `Late check-out: ${formatTZS(s.lateCheckoutFee)}.` : null,
  ].filter((x): x is string => !!x);
}

/** The QR works and booking from it is on — or a clear reason why not. */
async function openQr(token: string) {
  const qr = await requireBookingQr(token);
  const settings = await getSettings();
  if (!settings.hotelQrEnabled) throw new AppError("Booking from this QR is switched off right now — please ask reception or call us.", "FORBIDDEN");
  return { qr, settings };
}

/** The dates and party, checked like the website's search (the booking window, at most 90 nights). */
function stayFor(settings: HotelSettings, input: QrStayInput) {
  const window = bookingWindow(settings);
  const p = parseStayParams({ checkIn: input.checkIn, checkOut: input.checkOut, adults: String(input.adults), children: String(input.children) }, window);
  if (p.kind === "empty") throw new AppError("Choose your check-in and check-out dates.", "VALIDATION", { checkIn: "Required" });
  if (p.kind === "invalid") throw new AppError(Object.values(p.errors)[0] ?? "Please check your dates.", "VALIDATION", p.errors);
  const stay = buildStay(settings, p.value);
  const out: QrStay = { ...p.value, nights: stay.nights, checkInTime: window.checkInTime, checkoutTime: window.checkoutTime };
  return { params: p.value, stay, out };
}

/** The room asked for by its number: a public guest room that holds the party (whether it is free is checked separately). */
async function pickRoom(roomNumber: string, p: Pick<StayParams, "adults" | "children">) {
  const number = roomNumber.trim();
  const room = /^[A-Za-z0-9-]{1,12}$/.test(number)
    ? await db.room.findUnique({ where: { number }, select: { id: true, number: true, floor: true, isActive: true, roomTypeId: true } })
    : null;
  const type = room?.isActive ? (await listPublicRoomTypes()).find((t) => t.id === room.roomTypeId) : undefined;
  if (!room || !type) throw new AppError("That room cannot be booked here — please choose another room.", "UNAVAILABLE", { roomNumber: "Unknown" });
  if (!fits(type, p)) throw new AppError(`Room ${room.number} (${type.name}) holds up to ${holds(type)} — please choose a bigger room.`, "VALIDATION", { roomNumber: "Too small" });
  return { room, type };
}

function offerOf(room: { number: string; floor: number | null }, type: PublicRoomType, q: StayQuote, nights: number): QrRoomOffer {
  const n = Math.max(1, nights);
  return {
    number: room.number, floor: room.floor, typeSlug: type.slug, typeName: type.name,
    ratePerNight: Math.round(q.gross / n), perNight: Math.round(q.net / n), gross: q.gross, discount: q.promoDiscount + q.manualDiscount, total: q.net,
    promotion: q.promotion?.name ?? null,
  };
}

/** Count a step of the funnel — never in the way of the guest. */
async function track(qrId: string, type: BookingQrEventType, visit: QrVisit) {
  if (visit.track === false) return;
  try { await logQrEvent(qrId, type, { visitor: visit.visitor, ip: visit.ip }); } catch (e) { console.error("[hotel-qr] could not count", type, e); }
}

// ───────────────────────── 1. The landing ─────────────────────────

/**
 * What the QR opens: the hotel (photos, contacts, times, rules), its room types with tonight's real price and free
 * rooms, and whether booking is open here and how one can pay. Does not count the scan (the app reports it when it
 * opens — link previews and bots do not).
 */
export async function qrLanding(token: string): Promise<QrLanding | QrInactive> {
  const settings = await getSettings();
  const qr = await activeBookingQr(token);
  if (!qr) return { active: false, hotel: hotelContact(settings), message: "This booking QR code is not active. Please ask reception, or call us to book." };
  const [content, types, price, tonight, pay] = await Promise.all([getSiteContent(), listPublicRoomTypes(), websitePricer(settings), tonightAvailability(settings), payOptions(settings)]);
  const free = new Map(tonight.types.map((t) => [t.slug, t.free]));
  const w = bookingWindow(settings);
  const open = settings.hotelQrEnabled && (pay.online || pay.atHotel);
  const hero = content.home.hero;
  return {
    active: true,
    hotel: {
      ...hotelContact(settings), tagline: settings.tagline, email: settings.email,
      address: [settings.addressLine, settings.city].filter(Boolean).join(", ") || null,
      checkInTime: w.checkInTime, checkoutTime: w.checkoutTime, receptionHours: settings.receptionHours, breakfastHours: settings.breakfastHours,
      hero: { src: hero.image.src, alt: hero.image.alt },
      slides: hero.slides.map((x) => ({ src: x.src, mobileSrc: x.mobileSrc ?? null, alt: x.alt, caption: x.caption ?? null })),
      photos: (content.gallery as GalleryImage[]).map((g) => ({ src: g.src, alt: g.alt, width: g.width, height: g.height, category: g.category })),
      highlights: hero.highlights,
    },
    policies: policiesOf(settings, pay),
    roomTypes: types.map((t) => {
      const p = price(t);
      return { ...typeInfo(t), baseRate: p.baseRate, fromPerNight: p.net, promotion: p.promotion, promoLabel: p.promoLabel, freeTonight: free.get(t.slug) ?? 0 };
    }),
    booking: {
      ...pay, open,
      message: !settings.hotelQrEnabled ? "Booking from this QR is switched off right now — please ask reception or call us."
        : !open ? "Booking here is not available right now — please ask reception or call us." : null,
    },
    window: {
      today: w.today, maxCheckIn: w.maxArrival, maxNights: w.maxNights,
      maxAdults: types.length ? Math.max(...types.map((t) => t.maxAdults)) : MAX_ADULTS,
      maxChildren: types.length ? Math.max(...types.map((t) => t.maxChildren)) : 0,
      maxGuests: types.length ? Math.max(...types.map((t) => t.maxAdults + t.maxChildren)) : MAX_ADULTS,
    },
  };
}

// ───────────────────────── 2. Availability ─────────────────────────

/**
 * "Check availability": the rooms that can really be booked for these dates — only what the availability engine finds
 * free (no booking, hold or guest in it, not blocked for maintenance or out of service; meeting rooms never) — each
 * priced for the stay by the pricing engine on the Hotel QR's channel. Lapsed holds are released first.
 */
export async function qrSearch(token: string, input: QrStayInput & { roomType?: string | null }, visit: QrVisit = {}): Promise<QrSearchResult> {
  const { qr, settings } = await openQr(token);
  const { params, stay, out } = stayFor(settings, input);
  await refreshBookingStates();
  let types = await listPublicRoomTypes();
  if (input.roomType) {
    types = types.filter((t) => t.slug === input.roomType);
    if (!types.length) throw new AppError("That room type cannot be booked here.", "VALIDATION", { roomType: "Unknown" });
  }
  const [free, pricing] = await Promise.all([findAvailableRooms({ stay }), loadPricing(db, stay.arrivalDate, addDays(stay.departureDate, -1))]);
  const channel = channelFor(HOTEL_QR_SOURCE);
  const result: QrSearchResult = { stay: out, types: [], tooSmall: [] };
  for (const type of types) {
    const rooms = free.filter((r) => r.roomTypeId === type.id);
    if (!rooms.length) continue; // fully booked for these dates
    if (!fits(type, params)) {
      result.tooSmall.push({ slug: type.slug, name: type.name, maxAdults: type.maxAdults, maxChildren: type.maxChildren, available: rooms.length });
      continue;
    }
    // Each room priced on its own: a date price or promotion may be for some rooms only.
    const offers = rooms.map((r) => offerOf(r, type, quoteFromPromos({ dates: stay.nightDates, base: type.baseRate, roomTypeId: type.id, roomId: r.id, channel, ...pricing }), stay.nights));
    result.types.push({
      type: typeInfo(type), available: offers.length, rooms: offers,
      fromPerNight: Math.min(...offers.map((o) => o.perNight)), fromTotal: Math.min(...offers.map((o) => o.total)),
    });
  }
  result.types.sort((a, b) => a.fromTotal - b.fromTotal);
  await track(qr.id, "SEARCH", visit);
  return result;
}

// ───────────────────────── 3. The room ─────────────────────────

/** The room's details and exact price for the stay — re-checked: still free, holds the party. */
export async function qrQuote(token: string, input: QrStayInput & { roomNumber: string }, visit: QrVisit = {}): Promise<QrQuote> {
  const { qr, settings } = await openQr(token);
  const { params, stay, out } = stayFor(settings, input);
  await refreshBookingStates();
  const { room, type } = await pickRoom(input.roomNumber, params);
  if (!(await findAvailableRooms({ stay, roomIds: [room.id] })).length) throw taken(room.number);
  // Exactly what the engine will store for this room (syncRoomNights prices the same way).
  const q = await quoteStay(db, { dates: stay.nightDates, base: type.baseRate, roomTypeId: type.id, roomId: room.id, channel: channelFor(HOTEL_QR_SOURCE) });
  const pay = await payOptionsFor(settings, params);
  const n = Math.max(1, stay.nights);
  await track(qr.id, "SELECT", visit);
  return {
    stay: out, room: { number: room.number, floor: room.floor }, type: typeInfo(type),
    nights: q.nights.map((x) => ({ date: x.date, price: x.base, discount: x.promoDiscount + x.manualDiscount, net: x.net, datePrice: x.priceRule?.name ?? null, promotion: x.promotion?.name ?? null })),
    ratePerNight: Math.round(q.gross / n), perNight: Math.round(q.net / n), sameEveryNight: new Set(q.nights.map((x) => x.net)).size <= 1,
    gross: q.gross, discount: q.promoDiscount + q.manualDiscount, total: q.net, promotion: q.promotion?.name ?? null,
    pay, policies: policiesOf(settings, pay),
  };
}

// ───────────────────────── 4. Book ─────────────────────────

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
function timeOf(v: string | null | undefined, field: string) {
  const t = v?.trim();
  if (!t) return null;
  if (!TIME.test(t)) throw new AppError("Enter the time like 14:30.", "VALIDATION", { [field]: "Invalid" });
  return t;
}

function guestOf(g: QrBookInput["guest"]) {
  const fullName = g.fullName.trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 80) throw new AppError("Please enter your full name.", "VALIDATION", { fullName: "Required" });
  if (!validPhone(g.phone)) throw new AppError("Please enter a phone number we can reach you on (e.g. 0712 345 678).", "VALIDATION", { phone: "Invalid" });
  const email = g.email?.trim().toLowerCase() || null;
  if (email && (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new AppError("Please check your email address.", "VALIDATION", { email: "Invalid" });
  return { fullName, phone: normalizePhone(g.phone)!, email };
}

function pickupOf(t: QrBookInput["transportRequest"], checkIn: BusinessDate) {
  if (!t) return null;
  const flightNumber = t.flightNumber?.trim().toUpperCase().replace(/\s+/g, " ") || null;
  if (flightNumber && !/^[A-Z0-9 -]{2,12}$/.test(flightNumber)) throw new AppError("Please check the flight number.", "VALIDATION", { flightNumber: "Invalid" });
  const arrivalTime = timeOf(t.arrivalTime, "transportTime");
  const note = t.note?.trim().replace(/\s+/g, " ").slice(0, 300) || null;
  if (!flightNumber && !arrivalTime && !note) return null;
  const text = `Hotel QR: pickup requested${flightNumber ? ` — flight ${flightNumber}` : ""}${arrivalTime ? `, arriving ${checkIn} ${arrivalTime}` : ""}${note ? ` (${note})` : ""}.`;
  return { flightNumber, arrivalTime, note, text };
}

/** The key of a "Book" press as kept on its booking (a hash — the key itself stays on the phone). */
const keyMark = (clientKey: string) => createHash("sha256").update(`hotel-qr-book:${clientKey}`).digest("hex").slice(0, 40);

/**
 * The booking this very key already made (the same "Book" pressed again, or its answer lost on the way) — found only
 * from the key: its payment request, or the mark the booking was made with. Never from a phone number, dates or a
 * room anyone could type.
 */
async function madeWithKey(qrId: string, clientKey: string) {
  const mp = await db.mobilePayment.findUnique({ where: { clientKey: `book:${clientKey}` }, select: { publicToken: true, reservationId: true } });
  const select = {
    reference: true, manageToken: true, status: true, holdUntil: true, internalNotes: true, arrivalDate: true, departureDate: true,
    rooms: { select: { room: { select: { number: true } } } },
  } as const;
  const r = mp?.reservationId
    ? await db.reservation.findFirst({ where: { id: mp.reservationId, bookingQrId: qrId }, select })
    : await db.reservation.findFirst({
      where: { bookingQrId: qrId, source: { code: HOTEL_QR_SOURCE }, createdAt: { gte: new Date(Date.now() - 86_400_000) }, externalData: { path: ["key"], equals: keyMark(clientKey) } },
      select,
    });
  return r ? { r, payToken: mp?.publicToken ?? null } : null;
}

function bookedOf(qrToken: string, r: { reference: string; manageToken: string; status: ReservationStatus; holdUntil: Date | null }, way: QrPayWay, payToken: string | null, payError: string | null): QrBooked {
  return {
    reference: r.reference, manageToken: r.manageToken, payWay: way, payToken, payUrl: payToken ? `/pay/${payToken}` : null, payError,
    confirmUrl: qrConfirmPath(qrToken, r.reference, r.manageToken), holdUntil: r.status === "RESERVED" ? r.holdUntil?.toISOString() ?? null : null,
  };
}

/**
 * "Book": everything is checked again on the server — the QR, the switches, the dates, the room (free, holds the party)
 * — and the booking is made by the reservation engine, which re-checks the room under its lock (two people booking the
 * same room at once: one gets it, the other is told it was just taken). The customer is found by phone, never saved
 * twice (and never shown or changed from here). Pay online: held 30 minutes and its payment request goes for the exact
 * amount (confirmed only when nTZS confirms it). Pay at hotel: held by the hotel's hold rules, within the limits of
 * payOptionsFor, and the guest gets the booking details.
 */
export async function qrBook(token: string, input: QrBookInput, visit: QrVisit & { ip: string | null }): Promise<QrBooked> {
  const { qr, settings } = await openQr(token);
  const guest = guestOf(input.guest);
  const eta = timeOf(input.arrivalTime, "arrivalTime");
  const specialRequests = input.specialRequest?.trim().slice(0, 500) || null;
  if (!/^[a-f0-9]{32}$/.test(input.clientKey)) throw new AppError("Please try again.", "VALIDATION");
  // Bookings hold rooms: a device (guests on the hotel Wi-Fi share one address) cannot make many — counted first,
  // before anything is looked up.
  await rateLimit(`hotel-qr-book:${visit.ip ?? "unknown"}`, 10, 600);
  const way: QrPayWay = input.pay === "ONLINE" ? "ONLINE" : "HOTEL";
  const { params, stay } = stayFor(settings, input);
  const pickup = pickupOf(input.transportRequest, params.checkIn);

  // The same press again (or its answer lost on the way): the same booking — no second booking, no second payment.
  const again = await madeWithKey(qr.id, input.clientKey);
  if (again) {
    const { r: was, payToken } = again;
    // The key belongs to that booking: asked with another room or other dates, it is not handed back as this one.
    const same = was.arrivalDate.getTime() === toDbDate(params.checkIn).getTime() && was.departureDate.getTime() === toDbDate(params.checkOut).getTime()
      && was.rooms.some((x) => x.room.number === input.roomNumber.trim());
    if (!same) throw new AppError(`You already booked Room ${was.rooms[0]?.room.number ?? ""} (${was.reference}) — check that booking, or choose your room again.`, "CONFLICT");
    return bookedOf(token, was, qrPayWay({ internalNotes: was.internalNotes, startedOnline: !!payToken }), payToken, null);
  }

  const pay = await payOptionsFor(settings, params);
  if (way === "ONLINE" && !pay.online) {
    throw new AppError(pay.atHotel ? "Paying online is not available right now — please choose Pay at the hotel." : "Booking here is not available right now — please ask reception or call us.", "CONFLICT");
  }
  if (way === "HOTEL" && !pay.atHotel) {
    throw new AppError(pay.atHotelNote ?? (pay.online ? "Please choose Pay now to book here." : "Booking here is not available right now — please ask reception or call us."), "CONFLICT");
  }
  // An unpaid hold: a phone number and a device can make only a few a day (on top of the limits in payOptionsFor).
  if (way === "HOTEL") {
    await rateLimit(`hotel-qr-hold:${guest.phone}`, 5, 86_400);
    await rateLimit(`hotel-qr-hold-ip:${visit.ip ?? "unknown"}`, 5, 86_400);
  }
  const { room, type } = await pickRoom(input.roomNumber, params);
  if (!(await findAvailableRooms({ stay, roomIds: [room.id] })).length) throw taken(room.number);
  await track(qr.id, "ATTEMPT", visit);

  const actor: Actor = { userId: null, label: "Hotel QR", ipAddress: visit.ip, permissions: new Set<string>() };
  const create = async () => {
    let r;
    try {
      r = await createReservation({
        sourceCode: HOTEL_QR_SOURCE, bookingQrId: qr.id, status: "RESERVED",
        // Typed by the guest: found again by the phone only; what they typed (and this press's key) stays with the booking.
        guest: { fullName: guest.fullName, phone: guest.phone, email: guest.email, selfService: true },
        externalData: publicBookingData("HOTEL_QR", guest, { key: keyMark(input.clientKey) }),
        stay: { kind: "overnight", arrivalDate: params.checkIn, departureDate: params.checkOut },
        // The chosen room, priced by the engine (no discount from the phone: the Hotel QR sees the website's promotions).
        rooms: [{ roomTypeId: type.id, roomId: room.id, adults: params.adults, children: params.children }],
        specialRequests, eta,
        internalNotes: [way === "ONLINE" ? QR_PAY_ONLINE_NOTE : QR_PAY_HOTEL_NOTE, pickup?.text].filter(Boolean).join(" "),
        holdMinutes: way === "ONLINE" ? ONLINE_BOOKING_HOLD_MINUTES : null,
      }, actor);
    } catch (e) {
      if (e instanceof AppError && e.code === "UNAVAILABLE") throw taken(room.number);
      throw e;
    }
    if (pickup?.arrivalTime) {
      // The booking is made; a trip request that fails must not undo it — reception sees the pickup in the notes.
      try {
        await requestTransportForReservation({ reservationId: r.id, flightNumber: pickup.flightNumber, arrivalDate: params.checkIn, arrivalTime: pickup.arrivalTime, notes: pickup.note });
      } catch (e) {
        console.error("[hotel-qr] pickup request failed", r.reference, e);
      }
    }
    return r;
  };

  if (way === "ONLINE") {
    let made: Awaited<ReturnType<typeof create>> | null = null;
    const r = await bookAndPayOnline({
      service: "booking", phone: input.payPhone?.trim() || guest.phone, clientKey: input.clientKey, ip: visit.ip, source: "HOTEL_QR",
      page: (b) => qrConfirmPath(token, b.reference, b.manageToken),
      create: async () => { made = await create(); return { id: made.id, reference: made.reference, manageToken: made.manageToken }; },
    });
    const b = made as Awaited<ReturnType<typeof create>> | null;
    const ref = b ?? (r.ref ? await db.reservation.findUnique({ where: { reference: r.ref.reference }, select: { reference: true, manageToken: true, status: true, holdUntil: true } }) : null);
    if (!ref) throw new AppError("Your booking is being made — please wait a moment, then check your booking.", "CONFLICT");
    return bookedOf(token, ref, way, r.pay, r.payError);
  }

  // Pay at hotel: one booking per press, even pressed twice at once.
  const once = `book-once:${input.clientKey}`;
  try { await rateLimit(once, 1, 3600); } catch {
    throw new AppError("Your booking is being made — please wait a moment, then check your booking.", "CONFLICT");
  }
  let r: Awaited<ReturnType<typeof create>>;
  try {
    r = await create();
  } catch (e) {
    // Nothing was booked: the same press may run again and get the real answer (not "being made" for an hour).
    await db.rateLimitBucket.deleteMany({ where: { key: once } }).catch(() => null);
    throw e;
  }
  // The booking details by message, once the answer has gone — and a number gets only a few a day, whoever types it.
  if (await allowed(`hotel-qr-text:${guest.phone}`, 3, 86_400)) await notifyBookingGuestSoon(r.id, "BOOKING_CREATED");
  return bookedOf(token, r, way, null, null);
}

/** A soft limit: false once reached (nothing is refused — something optional is just not done). */
async function allowed(key: string, limit: number, seconds: number) {
  try { await rateLimit(key, limit, seconds); return true; } catch { return false; }
}

// ───────────────────────── 5. The confirmation ─────────────────────────

/**
 * The booking as its guest sees it from the QR app, by reference + its private key (checked in constant time): status,
 * where the money stands, the room, dates, totals, the nTZS reference once paid, and the guest's links. While a payment
 * is on its way nTZS is asked (at most every few seconds) — "paid" shows only once nTZS has confirmed it.
 */
export async function qrConfirmation(token: string, reference: string, manageToken: string, opts: { check?: boolean } = {}): Promise<QrConfirmationResult> {
  let b = await getBookingForGuest(reference, manageToken);
  if (!b) return { state: "not_found" };
  const qr = await activeBookingQr(token);
  const link = await db.reservation.findUniqueOrThrow({ where: { reference }, select: { bookingQrId: true } });
  const bookingLink = `/booking/${reference}?token=${encodeURIComponent(manageToken)}`;
  if (!qr || link.bookingQrId !== qr.id) return { state: "moved", href: bookingLink };

  const pay = await bookingPayOnline(reference, manageToken);
  if (opts.check !== false && pay.live) {
    await customerPaymentByToken(pay.live, { check: true });
    b = (await getBookingForGuest(reference, manageToken)) ?? b;
  }
  const [s, r, after] = await Promise.all([
    getSettings(),
    db.reservation.findUniqueOrThrow({
      where: { reference },
      select: {
        guestToken: true, internalNotes: true, eta: true,
        payments: { where: { status: "POSTED" }, select: { kind: true, amount: true, reference: true, method: { select: { code: true } } } },
        mobilePayments: { where: { initiator: "CUSTOMER" }, orderBy: { createdAt: "desc" }, select: { status: true, expiresAt: true, pspReference: true, depositId: true } },
      },
    }),
    pay.live ? bookingPayOnline(reference, manageToken) : Promise.resolve(pay),
  ]);
  const w = bookingWindow(s);
  const way = qrPayWay({ internalNotes: r.internalNotes, startedOnline: r.mobilePayments.length > 0 });
  const refunded = r.payments.filter((p) => p.kind === "REFUND").reduce((t, p) => t + p.amount, 0);
  const live = b.rooms.filter((x) => x.status !== "CANCELLED");
  const rooms = live.length ? live : b.rooms;
  const closed = b.status === "CANCELLED" || b.status === "NO_SHOW";
  return {
    state: "ok",
    booking: {
      reference: b.reference, status: b.status, confirmed: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(b.status),
      guestFirstName: b.guestName.trim().split(/\s+/)[0] || null, timezone: s.timezone,
      paymentStatus: qrPaymentStatus({ paidAmount: b.paidAmount, balanceAmount: b.balanceAmount, refunded }, way, r.mobilePayments[0] ?? null), payWay: way,
      rooms: rooms.map((x) => ({ number: x.roomNumber, typeName: x.typeName, typeSlug: x.typeSlug })),
      checkIn: b.arrivalDate, checkOut: b.departureDate, checkInTime: w.checkInTime, checkoutTime: w.checkoutTime,
      nights: rooms.reduce((m, x) => Math.max(m, x.nights), 0), adults: b.adults, children: b.children,
      total: b.netAmount, paid: b.paidAmount, balance: b.balanceAmount, holdUntil: b.status === "RESERVED" ? b.holdUntil?.toISOString() ?? null : null,
      ntzsReference: ntzsReferenceOf(r.mobilePayments, r.payments),
      livePayment: after.live, canPayNow: after.offered && !after.live && !closed,
      stayLink: r.guestToken && !closed ? `/stay/${r.guestToken}` : null, bookingLink,
      pickup: b.pickup ? { status: b.pickup.status, at: b.pickup.pickupAt.toISOString(), flightNumber: b.pickup.flightNumber, place: b.pickup.pickupLocation } : null,
      specialRequest: b.specialRequests, arrivalTime: r.eta,
      hotel: hotelContact(s), createdAt: b.createdAt.toISOString(),
    },
  };
}

/** "Pay now" from the QR confirmation (a booking held to pay at the hotel, or a payment that did not go through): what is owed, worked out here. */
export async function qrPayNow(token: string, reference: string, manageToken: string, input: { phone: string; clientKey: string | null; ip: string | null }) {
  await requireBookingQr(token);
  return payBookingOnline(reference, manageToken, { ...input, source: "HOTEL_QR" });
}

// ───────────────────────── For the staff page ─────────────────────────

/** The Hotel QR's switches and what they mean right now (Pay online also needs nTZS and the hotel's online-payment switches). */
export async function hotelQrSetup(actor: Actor) {
  if (!canViewHotelQr(actor)) throw new AppError("You do not have permission to see the Hotel QR.", "FORBIDDEN");
  const s = await getSettings();
  return {
    bookingOn: s.hotelQrEnabled, payAtHotel: s.hotelQrPayAtHotel,
    payOnline: await onlinePayAvailable("booking", s), onlinePaySwitchedOn: s.onlinePayEnabled && s.onlinePayBooking, ntzsConnected: ntzsEnabled(),
    websiteBookingOn: s.publicBookingEnabled, unpaidHoldHours: s.unpaidHoldHours, onlineHoldMinutes: ONLINE_BOOKING_HOLD_MINUTES,
    holdLimits: { maxNights: HOLD_MAX_NIGHTS, toArrivalMaxDays: HOLD_TO_ARRIVAL_MAX_DAYS },
    canManage: canManageHotelQr(actor), canSeeNumbers: canSeeHotelQrNumbers(actor),
  };
}
