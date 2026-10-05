import "server-only";
import { refreshBookingStates } from "./booking-holds";
import { timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { AppError } from "../errors";
import { businessDayConfig, getSettings, stayConfig } from "../settings";
import { availabilityByType } from "./availability";
import { createReservation, type Actor, type RoomRequest } from "./reservations";
import { loadPricing, quoteStay } from "./pricing";
import { requestTransportForReservation } from "./transport";
import { priceNight, promoLabel, type RoomQuote } from "@/lib/pricing";
import { addDays, businessDateOf, formatMinutes, fromDbDate, isBusinessDate, type BusinessDate } from "@/lib/time/business-date";
import { MAX_NIGHTS, overnightStay, StayError, type Stay } from "@/lib/time/stay";
import type { HotelSettings, Prisma } from "@/generated/prisma/client";

/**
 * PublicBookingService — a thin, read-mostly wrapper used by the public
 * website. It never decides availability or prices itself: availability comes
 * from the availability engine, money from PricingService, and bookings are
 * written only through ReservationService.createReservation (source WEBSITE).
 */

export const WEBSITE_SOURCE = "WEBSITE";
export const MAX_ADULTS = 20;
export const MAX_CHILDREN = 10;
export const MAX_ROOMS_PER_BOOKING = 10;

// ───────────────────────────── Room types ─────────────────────────────

export interface PublicRoomType {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  baseRate: number;
  maxAdults: number;
  maxChildren: number;
  bedType: string | null;
  sizeSqm: number | null;
  images: string[];
  amenities: { code: string; name: string; icon: string | null }[];
}

/** Photos uploaded on the live site are kept in Vercel Blob (allowed in next.config.ts); the rest are served by the app. */
const BLOB_PHOTO = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

export function parseImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && (v.startsWith("/") || BLOB_PHOTO.test(v)));
}

const roomTypeInclude = {
  amenities: { include: { amenity: true } },
} as const;

type RoomTypeRow = Prisma.RoomTypeGetPayload<{ include: typeof roomTypeInclude }>;

function toPublic(t: RoomTypeRow): PublicRoomType {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    shortDescription: t.shortDescription,
    description: t.description,
    baseRate: t.baseRate,
    maxAdults: t.maxAdults,
    maxChildren: t.maxChildren,
    bedType: t.bedType,
    sizeSqm: t.sizeSqm,
    images: parseImages(t.images),
    amenities: t.amenities
      .map((a) => a.amenity)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((a) => ({ code: a.code, name: a.name, icon: a.icon })),
  };
}

export async function listPublicRoomTypes(): Promise<PublicRoomType[]> {
  const rows = await db.roomType.findMany({
    where: { isActive: true, isPublic: true, category: "GUEST_ROOM" },
    include: roomTypeInclude,
    orderBy: [{ sortOrder: "asc" }, { baseRate: "asc" }],
  });
  return rows.map(toPublic);
}

export async function getPublicRoomType(slug: string): Promise<PublicRoomType | null> {
  const row = await db.roomType.findFirst({
    where: { slug, isActive: true, isPublic: true, category: "GUEST_ROOM" },
    include: roomTypeInclude,
  });
  return row ? toPublic(row) : null;
}

/**
 * Tonight's website price per room type, from the pricing engine (the same
 * promotions reception sees). Returns a pricer so a page loads promotions once.
 */
export async function websitePricer(settings: HotelSettings) {
  const today = bookingWindow(settings).today;
  const { promos, rules } = await loadPricing(db, today, today);
  return (t: { id: string; baseRate: number }) => {
    const n = priceNight({ date: today, base: t.baseRate, roomTypeId: t.id, roomId: null, channel: "WEBSITE", promos, rules });
    const promo = n.promotion ? promos.find((p) => p.id === n.promotion!.id) : null;
    return { baseRate: n.base, discount: n.promoDiscount, net: n.net, promotion: n.promotion?.name ?? null, promoLabel: promo ? promoLabel(promo) : null };
  };
}

/** Price one room of a type for a stay on the website: base − promotion, night by night. */
async function websiteStayQuote(type: { id: string; baseRate: number }, dates: string[]) {
  const q = await quoteStay(db, { dates, base: type.baseRate, roomTypeId: type.id, roomId: null, channel: "WEBSITE" });
  const n = Math.max(1, dates.length);
  const perRoom: RoomQuote & { promotion: string | null } = {
    ratePerNight: Math.round(q.gross / n),
    discountPerNight: Math.round(q.promoDiscount / n),
    netPerNight: Math.round(q.net / n),
    units: n,
    grossAmount: q.gross,
    discountAmount: q.promoDiscount,
    netAmount: q.net,
    promotion: q.promotion?.name ?? null,
  };
  return perRoom;
}

// ───────────────────────────── Booking window ─────────────────────────────

export interface BookingWindow {
  enabled: boolean;
  today: BusinessDate;
  maxArrival: BusinessDate;
  maxNights: number;
  checkInTime: string;
  checkoutTime: string;
}

export function bookingWindow(settings: HotelSettings, now = new Date()): BookingWindow {
  const today = businessDateOf(now, businessDayConfig(settings));
  return {
    enabled: settings.publicBookingEnabled,
    today,
    maxArrival: addDays(today, settings.maxAdvanceBookingDays),
    maxNights: MAX_NIGHTS,
    checkInTime: formatMinutes(settings.standardCheckInMinutes),
    checkoutTime: formatMinutes(settings.checkoutMinutes),
  };
}

// ───────────────────────────── Search ─────────────────────────────

export interface StayParams {
  checkIn: BusinessDate;
  checkOut: BusinessDate;
  adults: number;
  children: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function intParam(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isInteger(n) ? n : Number.NaN;
}

/**
 * Validate stay search params (from the URL). Returns `null` when no search
 * was made yet, or an error message keyed by field.
 */
export function parseStayParams(
  raw: RawParams,
  window: BookingWindow,
): { kind: "empty" } | { kind: "invalid"; errors: Record<string, string>; partial: Partial<StayParams> } | { kind: "ok"; value: StayParams } {
  const checkIn = one(raw.checkIn)?.trim();
  const checkOut = one(raw.checkOut)?.trim();
  const adults = intParam(one(raw.adults), 2);
  const children = intParam(one(raw.children), 0);
  if (!checkIn && !checkOut) return { kind: "empty" };

  const errors: Record<string, string> = {};
  if (!checkIn || !isBusinessDate(checkIn)) errors.checkIn = "Choose a check-in date.";
  else if (checkIn < window.today) errors.checkIn = "Check-in cannot be in the past.";
  else if (checkIn > window.maxArrival) errors.checkIn = "That date is too far ahead to book online.";
  if (!checkOut || !isBusinessDate(checkOut)) errors.checkOut = "Choose a check-out date.";
  else if (checkIn && isBusinessDate(checkIn) && checkOut <= checkIn) errors.checkOut = "Check-out must be after check-in.";
  else if (checkIn && isBusinessDate(checkIn) && checkOut > addDays(checkIn, MAX_NIGHTS)) {
    errors.checkOut = `Online bookings are limited to ${MAX_NIGHTS} nights.`;
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS) errors.adults = `Adults must be between 1 and ${MAX_ADULTS}.`;
  if (!Number.isInteger(children) || children < 0 || children > MAX_CHILDREN) errors.children = `Children must be between 0 and ${MAX_CHILDREN}.`;

  const partial: Partial<StayParams> = {
    checkIn: checkIn && isBusinessDate(checkIn) ? checkIn : undefined,
    checkOut: checkOut && isBusinessDate(checkOut) ? checkOut : undefined,
    adults: Number.isInteger(adults) ? adults : undefined,
    children: Number.isInteger(children) ? children : undefined,
  };
  if (Object.keys(errors).length) return { kind: "invalid", errors, partial };
  return { kind: "ok", value: { checkIn: checkIn!, checkOut: checkOut!, adults, children } };
}

/** The overnight stay for public dates (the Hotel QR builds its stays the same way). */
export function buildStay(settings: HotelSettings, p: Pick<StayParams, "checkIn" | "checkOut">): Stay {
  try {
    return overnightStay({ arrivalDate: p.checkIn, departureDate: p.checkOut }, stayConfig(settings));
  } catch (e) {
    if (e instanceof StayError) throw new AppError(e.message, "VALIDATION");
    throw e;
  }
}

/** Fewest rooms of a type that fit the party, or Infinity if it can never fit. */
export function minRoomsFor(t: { maxAdults: number; maxChildren: number }, adults: number, children: number): number {
  if (t.maxAdults < 1) return Infinity;
  const byAdults = Math.ceil(adults / t.maxAdults);
  const byChildren = children === 0 ? 0 : t.maxChildren > 0 ? Math.ceil(children / t.maxChildren) : Infinity;
  return Math.max(1, byAdults, byChildren);
}

/** Spread the party evenly over `rooms` rooms (each room keeps at least one adult). */
export function distributeGuests(
  t: { id: string; maxAdults: number; maxChildren: number },
  adults: number,
  children: number,
  rooms: number,
): RoomRequest[] | null {
  if (rooms < minRoomsFor(t, adults, children) || rooms > adults) return null;
  const split = (total: number) => Array.from({ length: rooms }, (_, i) => Math.floor(total / rooms) + (i < total % rooms ? 1 : 0));
  const a = split(adults);
  const c = split(children);
  const out = a.map((ad, i) => ({ roomTypeId: t.id, adults: ad, children: c[i] }));
  if (out.some((r) => r.adults < 1 || r.adults > t.maxAdults || r.children > t.maxChildren)) return null;
  return out;
}

export interface SearchOption {
  type: PublicRoomType;
  available: number;
  minRooms: number;
  maxRooms: number;
  perRoom: RoomQuote & { promotion: string | null }; // one room for the whole stay
}

export interface SearchResult {
  params: StayParams;
  nights: number;
  options: SearchOption[];
  /** Room types with free rooms that cannot hold this party (e.g. too many guests). */
  tooSmall: { name: string; available: number }[];
}

export async function searchAvailability(params: StayParams): Promise<SearchResult> {
  await refreshBookingStates();
  const settings = await getSettings();
  const stay = buildStay(settings, params);
  const [types, counts] = await Promise.all([listPublicRoomTypes(), availabilityByType(stay)]);

  const options: SearchOption[] = [];
  const tooSmall: SearchResult["tooSmall"] = [];
  for (const type of types) {
    const available = counts.get(type.id) ?? 0;
    if (available === 0) continue; // sold out: hide
    const minRooms = minRoomsFor(type, params.adults, params.children);
    const maxRooms = Math.min(available, params.adults, MAX_ROOMS_PER_BOOKING);
    if (minRooms > maxRooms) {
      tooSmall.push({ name: type.name, available });
      continue;
    }
    options.push({
      type,
      available,
      minRooms,
      maxRooms,
      perRoom: await websiteStayQuote(type, stay.nightDates),
    });
  }
  options.sort((a, b) => a.perRoom.netAmount - b.perRoom.netAmount);
  return { params, nights: stay.nights, options, tooSmall };
}

// ───────────────────────────── Selection & quote ─────────────────────────────

export interface Selection extends StayParams {
  typeSlug: string;
  rooms: number;
}

export interface SelectionQuote {
  selection: Selection;
  type: PublicRoomType;
  nights: number;
  available: number;
  roomRequests: RoomRequest[];
  ratePerNight: number;
  discountPerNight: number;
  /** Promotion applied (name), if any. */
  promotion: string | null;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  checkInTime: string;
  checkoutTime: string;
}

/**
 * Re-check a chosen room type + quantity against live availability and price
 * it server-side. Throws AppError UNAVAILABLE when it can no longer be booked.
 */
export async function quoteSelection(sel: Selection): Promise<SelectionQuote> {
  await refreshBookingStates();
  const settings = await getSettings();
  if (!settings.publicBookingEnabled) throw new AppError("Online booking is currently unavailable. Please contact us to book.", "FORBIDDEN");
  const window = bookingWindow(settings);
  if (sel.checkIn < window.today) throw new AppError("Check-in cannot be in the past.", "VALIDATION");
  if (sel.checkIn > window.maxArrival) {
    throw new AppError(`Bookings can be made up to ${settings.maxAdvanceBookingDays} days ahead.`, "VALIDATION");
  }
  const stay = buildStay(settings, sel);
  const type = await getPublicRoomType(sel.typeSlug);
  if (!type) throw new AppError("That room type is not available for online booking.", "UNAVAILABLE");

  const counts = await availabilityByType(stay);
  const available = counts.get(type.id) ?? 0;
  if (available < sel.rooms) {
    throw new AppError(
      available === 0
        ? `Sorry — ${type.name} is now fully booked for these dates.`
        : `Sorry — only ${available} ${type.name} room${available === 1 ? " is" : "s are"} left for these dates.`,
      "UNAVAILABLE",
    );
  }
  const roomRequests = distributeGuests(type, sel.adults, sel.children, sel.rooms);
  if (!roomRequests) {
    throw new AppError(
      `${sel.rooms} ${type.name} room${sel.rooms === 1 ? "" : "s"} cannot hold ${sel.adults} adult(s)${sel.children ? ` and ${sel.children} child(ren)` : ""}. Each room fits up to ${type.maxAdults} adult(s)${type.maxChildren ? ` and ${type.maxChildren} child(ren)` : ""}.`,
      "VALIDATION",
    );
  }
  const q = await websiteStayQuote(type, stay.nightDates);
  return {
    selection: sel,
    type,
    nights: stay.nights,
    available,
    roomRequests,
    ratePerNight: q.ratePerNight,
    discountPerNight: q.discountPerNight,
    promotion: q.promotion,
    grossAmount: q.grossAmount * sel.rooms,
    discountAmount: q.discountAmount * sel.rooms,
    netAmount: q.netAmount * sel.rooms,
    checkInTime: window.checkInTime,
    checkoutTime: window.checkoutTime,
  };
}

// ───────────────────────────── Create booking ─────────────────────────────

/** The name and contact a customer typed on a public booking page — kept with the booking (Reservation.externalData). */
export type BookedAs = { fullName: string; phone: string | null; email: string | null };

/** What a public page keeps with its booking: where it came from, what was typed, and anything the channel adds. */
export const publicBookingData = (channel: "WEBSITE" | "HOTEL_QR", bookedAs: BookedAs, extra: Record<string, string> = {}) =>
  ({ channel, bookedAs, ...extra });

/** What the customer typed when booking on a public page (null for a booking made at the desk). */
export function bookedAsOf(data: unknown): BookedAs | null {
  const b = data && typeof data === "object" && "bookedAs" in data ? (data as { bookedAs: unknown }).bookedAs : null;
  if (!b || typeof b !== "object" || typeof (b as BookedAs).fullName !== "string") return null;
  const x = b as Partial<BookedAs>;
  return { fullName: x.fullName!, phone: typeof x.phone === "string" ? x.phone : null, email: typeof x.email === "string" ? x.email : null };
}

export interface WebsiteGuest {
  fullName: string;
  phone: string;
  email?: string | null;
  nationality?: string | null;
  specialRequests?: string | null;
  /** HH:MM as given by the guest. */
  expectedArrivalTime?: string | null;
}

export interface PickupRequest {
  flightNumber: string;
  arrivalDate: BusinessDate;
  arrivalTime: string; // HH:MM, hotel local time
  airport?: string | null;
  passengers?: number | null;
  notes?: string | null;
}

/** Create a website booking through the single reservation engine. */
export async function createWebsiteBooking(sel: Selection, guest: WebsiteGuest, ipAddress: string | null, pickup?: PickupRequest | null, opts: { holdMinutes?: number } = {}) {
  const quote = await quoteSelection(sel); // early, friendly checks; the engine re-validates in its transaction
  const actor: Actor = { userId: null, label: "website", ipAddress, permissions: new Set<string>() };
  const reservation = await createReservation(
    {
      sourceCode: WEBSITE_SOURCE,
      status: "RESERVED",
      // Typed by the customer: found again by their phone only; what they typed stays with the booking.
      guest: {
        fullName: guest.fullName,
        phone: guest.phone,
        email: guest.email || null,
        nationality: guest.nationality || null,
        selfService: true,
      },
      externalData: publicBookingData("WEBSITE", { fullName: guest.fullName.trim(), phone: guest.phone.trim() || null, email: guest.email?.trim() || null }),
      stay: { kind: "overnight", arrivalDate: sel.checkIn, departureDate: sel.checkOut },
      rooms: quote.roomRequests, // no discount given → engine applies the standard website discount
      specialRequests: guest.specialRequests || null,
      internalNotes: [
        opts.holdMinutes ? "Website: booked and paying online (nTZS) — confirmed by the payment." : null,
        pickup ? `Website: airport pickup requested — flight ${pickup.flightNumber.toUpperCase()}, arriving ${pickup.arrivalDate} ${pickup.arrivalTime}.` : null,
      ].filter(Boolean).join(" ") || null,
      eta: guest.expectedArrivalTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(guest.expectedArrivalTime) ? guest.expectedArrivalTime : null,
      holdMinutes: opts.holdMinutes ?? null,
    },
    actor,
  );
  let pickupRequested = false;
  if (pickup) {
    // The booking is already committed; a failed trip request must not undo it.
    // Staff still see the request in the reservation's internal notes.
    try {
      await requestTransportForReservation({
        reservationId: reservation.id,
        flightNumber: pickup.flightNumber,
        arrivalDate: pickup.arrivalDate,
        arrivalTime: pickup.arrivalTime,
        airport: pickup.airport,
        passengers: pickup.passengers,
        notes: pickup.notes,
      });
      pickupRequested = true;
    } catch (e) {
      console.error("[public-booking] airport pickup request failed", reservation.reference, e);
    }
  }
  return { id: reservation.id, reference: reservation.reference, manageToken: reservation.manageToken, pickupRequested };
}

// ───────────────────────────── View booking ─────────────────────────────

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Load a booking for its guest. Returns null unless the manage token matches. A booking made on a public page shows
 * back the name and phone typed there — never the profile it was matched to by the phone (anyone can type a number).
 */
export async function getBookingForGuest(reference: string, token: string | undefined | null) {
  if (!token || token.length > 200 || !/^VLH-[A-Z0-9]{4,12}$/.test(reference)) return null;
  const r = await db.reservation.findUnique({
    where: { reference },
    include: {
      guest: { select: { fullName: true, email: true, phone: true } },
      rooms: { include: { room: { select: { number: true } }, roomType: { select: { name: true, slug: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!r || !sameToken(r.manageToken, token)) return null;
  const trip = await db.transportTrip.findFirst({
    where: { reservationId: r.id, type: "AIRPORT_PICKUP", status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: { status: true, pickupAt: true, flightNumber: true, pickupLocation: true },
  });
  const typed = bookedAsOf(r.externalData);
  return {
    pickup: trip,
    reference: r.reference,
    status: r.status,
    kind: r.kind,
    holdUntil: r.holdUntil,
    guestName: typed?.fullName ?? r.guest.fullName,
    guestPhone: typed ? typed.phone : r.guest.phone,
    arrivalDate: fromDbDate(r.arrivalDate),
    departureDate: fromDbDate(r.departureDate),
    adults: r.adults,
    children: r.children,
    specialRequests: r.specialRequests,
    grossAmount: r.grossAmount,
    discountAmount: r.discountAmount,
    chargesAmount: r.chargesAmount,
    netAmount: r.netAmount,
    paidAmount: r.paidAmount,
    balanceAmount: r.balanceAmount,
    createdAt: r.createdAt,
    // No database ids: this goes to a public page.
    rooms: r.rooms.map((rr) => ({
      typeName: rr.roomType.name,
      typeSlug: rr.roomType.slug,
      roomNumber: rr.room.number,
      status: rr.status,
      nights: rr.nights,
      startAt: rr.startAt,
      endAt: rr.endAt,
      ratePerNight: rr.ratePerNight,
      discountPerNight: rr.discountPerNight,
      netAmount: rr.netAmount,
    })),
  };
}

// ───────────────────────────── Real hotel numbers ─────────────────────────────

/** Live inventory numbers for the website (never hard-coded). */
export async function publicStats(): Promise<{ rooms: number; roomTypes: number }> {
  const [rooms, roomTypes] = await Promise.all([
    db.room.count({ where: { isActive: true, roomType: { isActive: true, isPublic: true, category: "GUEST_ROOM" } } }),
    db.roomType.count({ where: { isActive: true, isPublic: true, category: "GUEST_ROOM" } }),
  ]);
  return { rooms, roomTypes };
}

// ───────────────────────────── Tonight (hero card) ─────────────────────────────

export interface TonightAvailability {
  date: BusinessDate;
  totalFree: number;
  fromNet: number | null;
  fromBase: number | null;
  types: { slug: string; name: string; free: number; net: number; base: number }[];
}

/** Live rooms free tonight and the lowest website price — same engine as booking. */
export async function tonightAvailability(settings: HotelSettings): Promise<TonightAvailability> {
  await refreshBookingStates();
  const w = bookingWindow(settings);
  const stay = buildStay(settings, { checkIn: w.today, checkOut: addDays(w.today, 1) });
  const [types, counts, price] = await Promise.all([listPublicRoomTypes(), availabilityByType(stay), websitePricer(settings)]);
  const rows = types
    .map((t) => ({ slug: t.slug, name: t.name, free: counts.get(t.id) ?? 0, ...price(t) }))
    .filter((t) => t.free > 0)
    .sort((a, b) => a.net - b.net)
    .map((t) => ({ slug: t.slug, name: t.name, free: t.free, net: t.net, base: t.baseRate }));
  return {
    date: w.today,
    totalFree: rows.reduce((s, t) => s + t.free, 0),
    fromNet: rows[0]?.net ?? null,
    fromBase: rows[0]?.base ?? null,
    types: rows,
  };
}
