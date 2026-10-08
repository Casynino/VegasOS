"use server";

import { orderCustomerName } from "@/server/services/online-orders";
import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { createWebsiteMeetingBooking, meetingAvailability, submitMeetingRequest } from "@/server/services/booking-requests";
import { bookAndPayOnline, ONLINE_BOOKING_HOLD_MINUTES } from "@/server/services/online-pay";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";

const when = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Choose a date.")),
  start: z.string().regex(/^\d{2}:\d{2}$/, msg("Choose a start time.")),
  end: z.string().regex(/^\d{2}:\d{2}$/, msg("Choose an end time.")),
});

export type MeetingCheck = { available: boolean; price: number; capacity: number; booked: string[] };

/** "Check availability": is the meeting room free for that time? (No names are shown — only booked times.) */
export async function checkMeetingAction(input: z.input<typeof when>): Promise<ActionResult<MeetingCheck>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`web-meeting-check:${ipAddress ?? "unknown"}`, 40, 600);
    return meetingAvailability(parseInput(when, input));
  });
}

const booking = when.extend({
  attendees: z.coerce.number().int().min(1, msg("At least 1 person.")).max(500),
  /** Blank for a returning guest (found by their phone): the name we have is used. */
  fullName: z.union([z.literal(""), z.string().trim().min(2, msg("Please enter your full name.")).max(120)]).optional(),
  companyName: z.string().trim().max(120).optional(),
  phone: z.string().trim().regex(/^\+?[\d\s().-]{7,}$/, msg("Enter a phone number we can call or WhatsApp.")),
  email: z.union([z.literal(""), z.email(msg("Enter a valid email address.")).max(160)]).optional(),
  requirements: z.string().trim().max(800).optional(),
  notes: z.string().trim().max(800).optional(),
  website: z.string().max(0).optional(), // honeypot
});

export type MeetingReceipt = { reference: string; manageToken: string; name: string; date: string; time: string; price: number; room: string };

/** "Book now": files a booking request; the hotel confirms it (it becomes a normal reservation of the meeting room). */
export async function bookMeetingAction(input: z.input<typeof booking>): Promise<ActionResult<MeetingReceipt>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    if (input.website) throw new AppError("Please try again.");
    await rateLimit(`web-meeting-book:${ipAddress ?? "unknown"}`, 6, 600);
    const p = parseInput(booking, input);
    const d = { ...p, fullName: await orderCustomerName(p.fullName, p.phone, { field: "fullName", max: 120 }) };
    const r = await submitMeetingRequest({ ...d, email: d.email || null, companyName: d.companyName || null }, ipAddress);
    // Shown to the visitor: the room's name in the language they chose.
    const t = await getT();
    return { reference: r.reference, manageToken: r.manageToken, name: d.fullName.split(/\s+/)[0], date: r.date, time: r.time, price: r.price, room: t(r.name) };
  });
}

const payOnline = booking.extend({
  payPhone: z.string().trim().min(9, msg("Enter your mobile-money number.")).max(30),
  clientKey: z.string().regex(/^[a-f0-9]{32}$/),
});

/** "Book & pay online": the meeting room is booked at once (held a short while) and the payment confirms it. Returns where to go next. */
export async function payMeetingAction(input: z.input<typeof payOnline>): Promise<ActionResult<{ next: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    if (input.website) throw new AppError("Please try again.");
    await rateLimit(`web-meeting-book:${ipAddress ?? "unknown"}`, 6, 600);
    const p = parseInput(payOnline, input);
    const d = { ...p, fullName: await orderCustomerName(p.fullName, p.phone, { field: "fullName", max: 120 }) };
    const r = await bookAndPayOnline({
      service: "meeting", phone: d.payPhone, clientKey: d.clientKey, ip: ipAddress,
      create: () => createWebsiteMeetingBooking({ ...d, email: d.email || null, companyName: d.companyName || null }, ipAddress, { holdMinutes: ONLINE_BOOKING_HOLD_MINUTES }),
    });
    const next = r.pay ? `/pay/${r.pay}` : r.booking;
    if (!next) throw new AppError("Please try again.");
    return { next };
  });
}
