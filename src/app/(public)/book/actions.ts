"use server";

import { redirect } from "next/navigation";
import { requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { createWebsiteBooking, quoteSelection, type Selection } from "@/server/services/public-booking";
import { bookAndPayOnline, ONLINE_BOOKING_HOLD_MINUTES } from "@/server/services/online-pay";
import { DEFAULT_AIRPORT } from "@/server/services/transport";
import { notifyBookingGuestSoon } from "@/server/services/guest-comms";
import { formatBusinessDate } from "@/lib/format";
import { bookingSchema, type BookingInput } from "./schema";

export interface BookingReview {
  typeName: string;
  rooms: number;
  nights: number;
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkoutTime: string;
  adults: number;
  children: number;
  ratePerNight: number;
  discountPerNight: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  pickup: { flightNumber: string; date: string; time: string; airport: string; passengers: number } | null;
}

function toSelection(v: BookingInput): Selection {
  return { checkIn: v.checkIn, checkOut: v.checkOut, adults: v.adults, children: v.children, typeSlug: v.type, rooms: v.rooms };
}

function pickupOf(v: BookingInput) {
  return v.pickup === "yes" && v.flightNumber && v.pickupDate && v.pickupTime
    ? { flightNumber: v.flightNumber, arrivalDate: v.pickupDate, arrivalTime: v.pickupTime, airport: v.airport || null, passengers: typeof v.passengers === "number" ? v.passengers : null, notes: v.pickupNotes || null }
    : null;
}

function parse(formData: FormData): BookingInput {
  const v = parseInput(bookingSchema, formData);
  if (v.company) throw new AppError("We couldn’t process this request. Please call us to book.", "VALIDATION");
  return v;
}

/** Step 3 → 4: validate guest details and re-price the stay from live data. */
export async function reviewBookingAction(_prev: ActionResult<BookingReview> | undefined, formData: FormData): Promise<ActionResult<BookingReview>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`web-review:${ipAddress ?? "unknown"}`, 30, 600);
    const v = parse(formData);
    const q = await quoteSelection(toSelection(v));
    return {
      typeName: q.type.name,
      rooms: v.rooms,
      nights: q.nights,
      checkIn: formatBusinessDate(v.checkIn, true),
      checkOut: formatBusinessDate(v.checkOut, true),
      checkInTime: q.checkInTime,
      checkoutTime: q.checkoutTime,
      adults: v.adults,
      children: v.children,
      ratePerNight: q.ratePerNight,
      discountPerNight: q.discountPerNight,
      grossAmount: q.grossAmount,
      discountAmount: q.discountAmount,
      netAmount: q.netAmount,
      pickup:
        v.pickup === "yes" && v.flightNumber && v.pickupDate && v.pickupTime
          ? {
              flightNumber: v.flightNumber.toUpperCase(),
              date: formatBusinessDate(v.pickupDate),
              time: v.pickupTime,
              airport: v.airport || DEFAULT_AIRPORT,
              passengers: typeof v.passengers === "number" ? v.passengers : v.adults + v.children,
            }
          : null,
    };
  });
}

/**
 * Step 4 → Book now, pay later (owner, 2026-10-05): the booking is made and reception sees it, but no room is held
 * until it is paid — whoever pays first gets the room. Then the booking's own page, where the guest can pay any time
 * (the room is checked again then: the same one, another of its type, or "just taken").
 */
export async function confirmBookingAction(_prev: ActionResult<null> | undefined, formData: FormData): Promise<ActionResult<null>> {
  let target: string | null = null;
  const result = await runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`web-book:${ipAddress ?? "unknown"}`, 5, 600);
    const v = parse(formData);
    // A booking that holds nothing still lands with reception: a number can make only a few a day (anti-spam).
    const digits = v.phone.replace(/\D/g, "").slice(-9) || "unknown";
    try { await rateLimit(`web-pay-later:${digits}`, 5, 86_400); } catch (e) {
      if (e instanceof AppError && e.code === "RATE_LIMITED") throw new AppError("This phone number has made several bookings today — choose Pay now, or call us.", "RATE_LIMITED");
      throw e;
    }
    const b = await createWebsiteBooking(toSelection(v), {
      fullName: v.fullName, phone: v.phone, email: v.email || null, nationality: v.nationality || null,
      specialRequests: v.specialRequests || null, expectedArrivalTime: v.expectedArrivalTime,
    }, ipAddress, pickupOf(v), { payLater: true });
    // The booking details (and its link, to pay any time) by message, as from the Hotel QR — a number gets only a few a
    // day, whoever types it. Nothing is sent when no provider is connected.
    if (await softLimit(`web-text:${digits}`, 3, 86_400)) await notifyBookingGuestSoon(b.id, "BOOKING_CREATED");
    target = `/booking/${b.reference}?token=${encodeURIComponent(b.manageToken)}`;
    return null;
  });
  if (result.ok && target) redirect(target);
  return result;
}

/**
 * Step 4 → Pay online: the booking is made at once (the room held a short while) and the payment request goes to the
 * guest's phone; the payment confirms it. Then the payment page — or, if no request could start, the booking's page.
 */
export async function payAndBookAction(_prev: ActionResult<null> | undefined, formData: FormData): Promise<ActionResult<null>> {
  let target: string | null = null;
  const result = await runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`web-book:${ipAddress ?? "unknown"}`, 5, 600);
    const v = parse(formData);
    const payPhone = String(formData.get("payPhone") ?? "").trim().slice(0, 30);
    const clientKey = String(formData.get("clientKey") ?? "");
    if (!/^[a-f0-9]{32}$/.test(clientKey)) throw new AppError("Please try again.", "VALIDATION");
    const r = await bookAndPayOnline({
      service: "booking", phone: payPhone, clientKey, ip: ipAddress,
      create: () => createWebsiteBooking(toSelection(v), {
        fullName: v.fullName, phone: v.phone, email: v.email || null, nationality: v.nationality || null,
        specialRequests: v.specialRequests || null, expectedArrivalTime: v.expectedArrivalTime,
      }, ipAddress, pickupOf(v), { holdMinutes: ONLINE_BOOKING_HOLD_MINUTES }),
    });
    target = r.pay ? `/pay/${r.pay}` : r.booking;
    return null;
  });
  if (result.ok && target) redirect(target);
  return result;
}

/** A soft limit: false once reached (nothing is refused — something optional is just not done). */
async function softLimit(key: string, limit: number, seconds: number) {
  try { await rateLimit(key, limit, seconds); return true; } catch { return false; }
}
