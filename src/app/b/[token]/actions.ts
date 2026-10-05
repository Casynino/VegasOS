"use server";

import { z } from "zod";
import { getCurrentUser, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { recordQrEvent } from "@/server/services/booking-qr";
import {
  qrBook, qrConfirmation, qrPayNow, qrQuote, qrSearch, type QrBooked, type QrConfirmationResult, type QrQuote, type QrSearchResult, type QrVisit,
} from "@/server/services/hotel-qr";

/**
 * The Hotel booking QR app's actions (/b/<token>) — public. Each one checks what the phone sends, finds the QR again
 * from its token and lets the server work out availability, prices and payment; the phone never names a database id.
 */

const Token = z.string().regex(/^[a-f0-9]{24}$/, "This QR code is not valid — please scan it again.");
/** The browser's own random key (kept on the phone), so one visitor is counted once. */
const Visitor = z.string().regex(/^[a-f0-9]{16,64}$/).optional();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const Stay = z.object({
  checkIn: Day,
  checkOut: Day,
  adults: z.number().int().min(1, "At least one adult.").max(20, "For more than 20 guests, please call us."),
  children: z.number().int().min(0).max(10, "For more than 10 children, please call us.").default(0),
  visitor: Visitor,
});
const Search = Stay.extend({ roomType: z.string().regex(/^[a-z0-9-]{1,80}$/).nullish() });
const RoomNumber = z.string().trim().regex(/^[A-Za-z0-9-]{1,12}$/, "Choose a room.");
const Quote = Stay.extend({ roomNumber: RoomNumber });
const Time = z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the time like 14:30.")]).nullish();
const Book = Stay.extend({
  roomNumber: RoomNumber,
  guest: z.object({
    fullName: z.string().trim().min(2, "Please enter your full name.").max(80),
    phone: z.string().trim().min(7, "Please enter your phone number.").max(30),
    email: z.union([z.literal(""), z.email("Enter a valid email.").max(160)]).nullish(),
  }),
  arrivalTime: Time,
  specialRequest: z.string().trim().max(500, "Keep the request under 500 characters.").nullish(),
  transportRequest: z.object({ flightNumber: z.string().trim().max(12).nullish(), arrivalTime: Time, note: z.string().trim().max(300).nullish() }).nullish(),
  pay: z.enum(["ONLINE", "HOTEL"]),
  payPhone: z.string().trim().max(30).nullish(),
  clientKey: z.string().regex(/^[a-f0-9]{32}$/),
  website: z.string().max(0).optional(), // honeypot
});
const Link = z.object({ ref: z.string().regex(/^VLH-[A-Z0-9]{4,12}$/), key: z.string().min(16).max(200) });
const Pay = z.object({ phone: z.string().trim().min(9, "Enter your mobile-money number.").max(30), clientKey: z.string().regex(/^[a-f0-9]{32}$/) });
const Event = z.object({ type: z.literal("SCAN"), visitor: Visitor });

/** Who is visiting: their address (rate limits) and browser key (counting). Staff signed in on this device are not counted. */
async function visitOf(visitor?: string): Promise<QrVisit & { ip: string | null }> {
  const { ipAddress } = await requestMeta();
  const staff = await getCurrentUser().catch(() => null);
  return { ip: ipAddress, visitor: visitor ?? null, track: !staff };
}

/** The page opened (the scan): counted once per visitor per half hour, only while the QR works. */
export async function recordQrEventAction(token: string, input: z.input<typeof Event>): Promise<ActionResult<{ counted: boolean }>> {
  return runAction(async () => {
    const t = parseInput(Token, token), d = parseInput(Event, input);
    const v = await visitOf(d.visitor);
    await rateLimit(`hotel-qr-event:${v.ip ?? "unknown"}`, 120, 600);
    if (!v.track) return { counted: false };
    return { counted: await recordQrEvent(t, d.type, { visitor: v.visitor, ip: v.ip }) };
  });
}

/** "Check availability": the rooms that can really be booked for these dates and guests, priced. */
export async function qrSearchAction(token: string, input: z.input<typeof Search>): Promise<ActionResult<QrSearchResult>> {
  return runAction(async () => {
    const t = parseInput(Token, token), d = parseInput(Search, input);
    const v = await visitOf(d.visitor);
    await rateLimit(`hotel-qr-search:${v.ip ?? "unknown"}`, 60, 600);
    return qrSearch(t, d, v);
  });
}

/** A room picked: its details and exact price for the stay (checked again: still free, holds the party). */
export async function qrQuoteAction(token: string, input: z.input<typeof Quote>): Promise<ActionResult<QrQuote>> {
  return runAction(async () => {
    const t = parseInput(Token, token), d = parseInput(Quote, input);
    const v = await visitOf(d.visitor);
    await rateLimit(`hotel-qr-quote:${v.ip ?? "unknown"}`, 60, 600);
    return qrQuote(t, d, v);
  });
}

/**
 * "Book": the booking is made (Pay online: held while the guest pays, then the payment page; Pay at hotel: held by the
 * hotel's rules). Send a fresh clientKey per press — and a new one after any error.
 */
export async function qrBookAction(token: string, input: z.input<typeof Book>): Promise<ActionResult<QrBooked>> {
  return runAction(async () => {
    const t = parseInput(Token, token), d = parseInput(Book, input);
    if (d.website) throw new AppError("We couldn’t process this request. Please call us to book.", "VALIDATION");
    const v = await visitOf(d.visitor);
    return qrBook(t, {
      checkIn: d.checkIn, checkOut: d.checkOut, adults: d.adults, children: d.children, roomNumber: d.roomNumber,
      guest: { fullName: d.guest.fullName, phone: d.guest.phone, email: d.guest.email || null },
      arrivalTime: d.arrivalTime || null, specialRequest: d.specialRequest || null,
      transportRequest: d.transportRequest ? { flightNumber: d.transportRequest.flightNumber || null, arrivalTime: d.transportRequest.arrivalTime || null, note: d.transportRequest.note || null } : null,
      pay: d.pay, payPhone: d.payPhone || null, clientKey: d.clientKey,
    }, v);
  });
}

/** The confirmation, again (e.g. while a payment is on its way): "paid" only once nTZS has confirmed it. */
export async function qrBookingStatusAction(token: string, link: z.input<typeof Link>): Promise<ActionResult<QrConfirmationResult>> {
  return runAction(async () => {
    const t = parseInput(Token, token), l = parseInput(Link, link);
    const { ipAddress } = await requestMeta();
    await rateLimit(`hotel-qr-status:${ipAddress ?? "unknown"}`, 240, 600);
    return qrConfirmation(t, l.ref, l.key);
  });
}

/** "Pay now" from the confirmation: what is still owed, worked out on the server. Returns the payment page's token. */
export async function qrPayNowAction(token: string, link: z.input<typeof Link>, input: z.input<typeof Pay>): Promise<ActionResult<{ pay: string }>> {
  return runAction(async () => {
    const t = parseInput(Token, token), l = parseInput(Link, link), d = parseInput(Pay, input);
    const { ipAddress } = await requestMeta();
    const r = await qrPayNow(t, l.ref, l.key, { phone: d.phone, clientKey: d.clientKey, ip: ipAddress });
    return { pay: r.token };
  });
}
