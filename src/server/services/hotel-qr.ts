import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { AppError } from "../errors";
import { msg, msgf } from "@/i18n/msg";
import { getT, rememberGuestLanguage } from "@/i18n/server";
import { englishT, type T } from "@/i18n/translate";
import { rateLimit } from "../rate-limit";
import { getSettings } from "../settings";
import { formatTZS } from "@/lib/format";
import { prettyPhone, validPhone } from "@/lib/guest-messages";
import { addDays, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { GalleryImage } from "@/components/public/content";
import type { HotelSettings } from "@/generated/prisma/client";
import type { BookingQrEventType, ReservationStatus } from "@/generated/prisma/enums";
import { expireUnpaidHolds, isPayLater, PAY_LATER_KEY, refreshBookingStates } from "./booking-holds";
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
 *
 * THE RULE (owner, 2026-10-05) — paying is what reserves a room: Pay now holds the room only while the guest pays (30
 * minutes) and the booking is confirmed when nTZS confirms the money; Pay later makes the booking (reception sees it)
 * but holds no room — it stays free for everyone and whoever pays first gets it; paying later re-checks the room.
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
  /** Pay online (nTZS) offered now: the room is held while the guest pays, the booking confirmed by the payment. */
  online: boolean;
  /** Book now and pay later (at the hotel, or online from the booking) offered now — no room is held until it is paid. */
  atHotel: boolean;
  /** How long a booking keeps its room while the guest pays online. */
  onlineHoldMinutes: number;
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
  /**
   * Room types with free rooms that fit the party, cheapest first, each with its bookable rooms — only the chosen type
   * when one was chosen and it has rooms for the party; otherwise every type that has (never a false "nothing free").
   */
  types: { type: QrRoomTypeInfo; available: number; fromPerNight: number; fromTotal: number; rooms: QrRoomOffer[] }[];
  /** Types with free rooms that one room of cannot hold this party. */
  tooSmall: { slug: string; name: string; maxAdults: number; maxChildren: number; available: number }[];
  /**
   * The room type the guest chose, and what it has for them: "ok" (its rooms are shown), "too_small" (free, but one room
   * takes fewer guests) or "full" (nothing free for these dates) — then `types` shows the other rooms that fit.
   */
  chosen: { slug: string; name: string; maxAdults: number; maxChildren: number; state: "ok" | "too_small" | "full" } | null;
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
  /** A room is kept for this booking (paid, or held while it is being paid) — false for pay later: not held until paid. */
  roomHeld: boolean;
  /** The first name the guest typed when booking (never the profile it was matched to). */
  guestFirstName: string | null;
  /** The phone the guest typed when booking (their own link) — the number Pay now offers first. */
  guestPhone: string | null;
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
/** The translator of whoever sees the words (the guest on their phone; English outside a request). */
const viewerT = () => getT().catch(() => englishT);
/** "2 adults and 1 child" — how many one room takes, in the reader's language. */
const holds = (x: { maxAdults: number; maxChildren: number }, t: T = englishT) => {
  const adults = t.plural(x.maxAdults, "{n} adult", "{n} adults");
  return x.maxChildren ? t("{adults} and {children}", { adults, children: t.plural(x.maxChildren, "{n} child", "{n} children") }) : adults;
};
const taken = (number: string) => new AppError(msgf("Sorry — Room {room} was just booked for these dates. Please choose another room.", { room: number }), "UNAVAILABLE", { roomNumber: msg("Taken") });
/** "255712345678" → "0712 345 678" — how a guest types their own number (Pay now offers it first). */
const localPhone = (p: string | null) => {
  const m = p ? /^(?:255|0)?([67]\d{2})(\d{3})(\d{3})$/.exec(p.replace(/\D/g, "")) : null;
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : p;
};
const hotelContact = (s: HotelSettings) => ({ name: s.hotelName, phone: s.phone ? prettyPhone(s.phone) : null, whatsapp: s.whatsapp ? prettyPhone(s.whatsapp) : null });

/**
 * How the guest can pay. Pay later holds no room (the rule above), so it needs no limits by stay length, dates or a
 * share of the hotel — only the anti-spam limits per phone and per device in qrBook.
 */
async function payOptions(s: HotelSettings): Promise<QrPayOptions> {
  return { online: await onlinePayAvailable("booking", s), atHotel: s.hotelQrPayAtHotel, onlineHoldMinutes: ONLINE_BOOKING_HOLD_MINUTES };
}

/**
 * The hotel's rules, in plain words, from its settings (never written into the page) — in the guest's language. The
 * first line stays English: the QR screens leave it out by how it starts ("Check-in from"; the times are shown apart).
 */
function policiesOf(s: HotelSettings, pay: QrPayOptions, t: T = englishT) {
  const w = bookingWindow(s);
  return [
    `Check-in from ${w.checkInTime}. Check-out by ${w.checkoutTime}.`,
    pay.online ? t("Pay now and your booking is confirmed as soon as the payment comes in. We keep the room for {minutes} minutes while you pay.", { minutes: pay.onlineHoldMinutes }) : null,
    pay.atHotel ? t("Pay later: the room is not reserved until it is paid — whoever pays first gets it.") : null,
    s.noShowPolicy === "REFUND_DUE" ? t("Paid but cannot come? Tell us and your payment is refunded.") : t("A paid booking that is cancelled or not used is not refunded."),
    s.lateCheckoutFee > 0 ? t("Late check-out: {amount}.", { amount: formatTZS(s.lateCheckoutFee) }) : null,
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
  if (p.kind === "empty") throw new AppError("Choose your check-in and check-out dates.", "VALIDATION", { checkIn: msg("Required") });
  if (p.kind === "invalid") throw new AppError(Object.values(p.errors)[0] ?? msg("Please check your dates."), "VALIDATION", p.errors);
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
  if (!room || !type) throw new AppError("That room cannot be booked here — please choose another room.", "UNAVAILABLE", { roomNumber: msg("Unknown") });
  if (!fits(type, p)) {
    const t = await viewerT();
    throw new AppError(msgf("Room {room} ({type}) holds up to {holds} — please choose a bigger room.", { room: room.number, type: t(type.name), holds: holds(type, t) }), "VALIDATION", { roomNumber: msg("Too small") });
  }
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
  const [settings, t] = await Promise.all([getSettings(), viewerT()]);
  const qr = await activeBookingQr(token);
  if (!qr) return { active: false, hotel: hotelContact(settings), message: t("This booking QR code is not active. Please ask reception, or call us to book.") };
  const [content, types, price, tonight, pay] = await Promise.all([getSiteContent(), listPublicRoomTypes(), websitePricer(settings, t), tonightAvailability(settings), payOptions(settings)]);
  const free = new Map(tonight.types.map((x) => [x.slug, x.free]));
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
    policies: policiesOf(settings, pay, t),
    roomTypes: types.map((x) => {
      const p = price(x);
      return { ...typeInfo(x), baseRate: p.baseRate, fromPerNight: p.net, promotion: p.promotion, promoLabel: p.promoLabel, freeTonight: free.get(x.slug) ?? 0 };
    }),
    booking: {
      ...pay, open,
      message: !settings.hotelQrEnabled ? t("Booking from this QR is switched off right now — please ask reception or call us.")
        : !open ? t("Booking here is not available right now — please ask reception or call us.") : null,
    },
    window: {
      today: w.today, maxCheckIn: w.maxArrival, maxNights: w.maxNights,
      maxAdults: types.length ? Math.max(...types.map((x) => x.maxAdults)) : MAX_ADULTS,
      maxChildren: types.length ? Math.max(...types.map((x) => x.maxChildren)) : 0,
      maxGuests: types.length ? Math.max(...types.map((x) => x.maxAdults + x.maxChildren)) : MAX_ADULTS,
    },
  };
}

// ───────────────────────── 2. Availability ─────────────────────────

/**
 * "Check availability": the rooms that can really be booked for these dates — only what the availability engine finds
 * free (no booking held or paid, no guest in it, not blocked for maintenance or out of service; meeting rooms never;
 * a booking to pay later holds nothing) — each priced for the stay by the pricing engine on the Hotel QR's channel.
 * Lapsed holds are released first. A chosen room type that cannot take the party (or is full) never ends in "nothing
 * free": every other room that fits is shown, and `chosen` says why.
 */
export async function qrSearch(token: string, input: QrStayInput & { roomType?: string | null }, visit: QrVisit = {}): Promise<QrSearchResult> {
  const { qr, settings } = await openQr(token);
  const { params, stay, out } = stayFor(settings, input);
  await refreshBookingStates();
  const types = await listPublicRoomTypes();
  const pick = input.roomType ? types.find((t) => t.slug === input.roomType) : null;
  if (input.roomType && !pick) throw new AppError("That room type cannot be booked here.", "VALIDATION", { roomType: msg("Unknown") });
  const [free, pricing] = await Promise.all([findAvailableRooms({ stay }), loadPricing(db, stay.arrivalDate, addDays(stay.departureDate, -1))]);
  const channel = channelFor(HOTEL_QR_SOURCE);
  const result: QrSearchResult = { stay: out, types: [], tooSmall: [], chosen: null };
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
  if (pick) {
    const state = result.types.some((g) => g.type.slug === pick.slug) ? "ok" : free.some((r) => r.roomTypeId === pick.id) ? "too_small" : "full";
    result.chosen = { slug: pick.slug, name: pick.name, maxAdults: pick.maxAdults, maxChildren: pick.maxChildren, state };
    // Its rooms when it has some for the party; otherwise everything else that fits stays on the screen (and why the
    // chosen one is not among them is said once, by `chosen`).
    if (state === "ok") {
      result.types = result.types.filter((g) => g.type.slug === pick.slug);
      result.tooSmall = [];
    } else result.tooSmall = result.tooSmall.filter((t) => t.slug !== pick.slug);
  }
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
  const pay = await payOptions(settings);
  const n = Math.max(1, stay.nights);
  await track(qr.id, "SELECT", visit);
  return {
    stay: out, room: { number: room.number, floor: room.floor }, type: typeInfo(type),
    nights: q.nights.map((x) => ({ date: x.date, price: x.base, discount: x.promoDiscount + x.manualDiscount, net: x.net, datePrice: x.priceRule?.name ?? null, promotion: x.promotion?.name ?? null })),
    ratePerNight: Math.round(q.gross / n), perNight: Math.round(q.net / n), sameEveryNight: new Set(q.nights.map((x) => x.net)).size <= 1,
    gross: q.gross, discount: q.promoDiscount + q.manualDiscount, total: q.net, promotion: q.promotion?.name ?? null,
    pay, policies: policiesOf(settings, pay, await viewerT()),
  };
}

// ───────────────────────── 4. Book ─────────────────────────

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
function timeOf(v: string | null | undefined, field: string) {
  const t = v?.trim();
  if (!t) return null;
  if (!TIME.test(t)) throw new AppError("Enter the time like 14:30.", "VALIDATION", { [field]: msg("Invalid") });
  return t;
}

function guestOf(g: QrBookInput["guest"]) {
  const fullName = g.fullName.trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 80) throw new AppError("Please enter your full name.", "VALIDATION", { fullName: msg("Required") });
  if (!validPhone(g.phone)) throw new AppError("Please enter a phone number we can reach you on (e.g. 0712 345 678).", "VALIDATION", { phone: msg("Invalid") });
  const email = g.email?.trim().toLowerCase() || null;
  if (email && (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new AppError("Please check your email address.", "VALIDATION", { email: msg("Invalid") });
  return { fullName, phone: normalizePhone(g.phone)!, email };
}

function pickupOf(t: QrBookInput["transportRequest"], checkIn: BusinessDate) {
  if (!t) return null;
  const flightNumber = t.flightNumber?.trim().toUpperCase().replace(/\s+/g, " ") || null;
  if (flightNumber && !/^[A-Z0-9 -]{2,12}$/.test(flightNumber)) throw new AppError("Please check the flight number.", "VALIDATION", { flightNumber: msg("Invalid") });
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
 * amount (confirmed only when nTZS confirms it). Pay later: the booking is made (reception sees it, the guest gets the
 * details) but no room is held — whoever pays first gets it; paying later from the booking re-checks the room.
 */
export async function qrBook(token: string, input: QrBookInput, visit: QrVisit & { ip: string | null }): Promise<QrBooked> {
  const { qr, settings } = await openQr(token);
  const guest = guestOf(input.guest);
  const eta = timeOf(input.arrivalTime, "arrivalTime");
  const specialRequests = input.specialRequest?.trim().slice(0, 500) || null;
  if (!/^[a-f0-9]{32}$/.test(input.clientKey)) throw new AppError("Please try again.", "VALIDATION");
  // A device (guests on the hotel Wi-Fi share one address) cannot make many bookings — counted first, before anything
  // is looked up.
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
    if (!same) throw new AppError(msgf("You already booked Room {room} ({ref}) — check that booking, or choose your room again.", { room: was.rooms[0]?.room.number ?? "", ref: was.reference }), "CONFLICT");
    return bookedOf(token, was, qrPayWay({ internalNotes: was.internalNotes, startedOnline: !!payToken }), payToken, null);
  }

  const pay = await payOptions(settings);
  if (way === "ONLINE" && !pay.online) {
    throw new AppError(pay.atHotel ? msg("Paying online is not available right now — please choose Pay later.") : msg("Booking here is not available right now — please ask reception or call us."), "CONFLICT");
  }
  if (way === "HOTEL" && !pay.atHotel) {
    throw new AppError(pay.online ? msg("Please choose Pay now to book here.") : msg("Booking here is not available right now — please ask reception or call us."), "CONFLICT");
  }
  // Pay later holds no room, but it lands with reception: a phone number can make only a few a day — and one address
  // (guests on the hotel Wi-Fi share one) a fair number more.
  if (way === "HOTEL") {
    await limited(`hotel-qr-hold:${guest.phone}`, 5, 86_400, msg("This phone number has made several bookings today — choose Pay now, or ask reception."));
    await limited(`hotel-qr-hold-ip:${visit.ip ?? "unknown"}`, 40, 86_400, msg("Too many bookings from this network today — choose Pay now, or ask reception."));
  }
  const { room, type } = await pickRoom(input.roomNumber, params);
  await expireUnpaidHolds(); // a hold whose time ran out never makes the room look taken
  if (!(await findAvailableRooms({ stay, roomIds: [room.id] })).length) throw taken(room.number);
  await track(qr.id, "ATTEMPT", visit);

  const actor: Actor = { userId: null, label: "Hotel QR", ipAddress: visit.ip, permissions: new Set<string>() };
  const create = async () => {
    let r;
    try {
      r = await createReservation({
        // Pay now: held while the guest pays. Pay later: made, but no room held (INQUIRY) until it is paid.
        sourceCode: HOTEL_QR_SOURCE, bookingQrId: qr.id, status: way === "ONLINE" ? "RESERVED" : "INQUIRY",
        // Typed by the guest: found again by the phone only; what they typed (and this press's key) stays with the booking.
        guest: { fullName: guest.fullName, phone: guest.phone, email: guest.email, selfService: true },
        externalData: publicBookingData("HOTEL_QR", guest, { key: keyMark(input.clientKey), ...(way === "HOTEL" && { [PAY_LATER_KEY]: true }) }),
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
    // The language the guest chose on this phone: their booking messages and pages follow it (never fails the booking).
    await rememberGuestLanguage(r.guestId);
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

  // Pay later: one booking per press, even pressed twice at once.
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

/** A daily limit that says what to do instead (never "wait a few minutes" for a whole day). */
async function limited(key: string, limit: number, seconds: number, message: string) {
  try { await rateLimit(key, limit, seconds); } catch (e) {
    if (e instanceof AppError && e.code === "RATE_LIMITED") throw new AppError(message, "RATE_LIMITED");
    throw e;
  }
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
        guestToken: true, internalNotes: true, eta: true, externalData: true,
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
      roomHeld: ["RESERVED", "CONFIRMED", "CHECKED_IN"].includes(b.status),
      guestFirstName: b.guestName.trim().split(/\s+/)[0] || null, guestPhone: localPhone(b.guestPhone), timezone: s.timezone,
      paymentStatus: qrPaymentStatus({ paidAmount: b.paidAmount, balanceAmount: b.balanceAmount, refunded }, way, r.mobilePayments[0] ?? null, new Date(), b.status === "RESERVED" && isPayLater(r.externalData)),
      payWay: way,
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

/**
 * "Pay now" from the QR confirmation (a booking made to pay later, or a payment that did not go through): what is owed,
 * worked out here. A pay-later booking's room is checked again first and held while it is paid (requestMobilePayment).
 */
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
    websiteBookingOn: s.publicBookingEnabled, onlineHoldMinutes: ONLINE_BOOKING_HOLD_MINUTES,
    canManage: canManageHotelQr(actor), canSeeNumbers: canSeeHotelQrNumbers(actor),
  };
}
