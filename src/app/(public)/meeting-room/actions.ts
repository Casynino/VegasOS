"use server";

import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { meetingAvailability, submitMeetingRequest } from "@/server/services/booking-requests";

const when = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  start: z.string().regex(/^\d{2}:\d{2}$/, "Choose a start time."),
  end: z.string().regex(/^\d{2}:\d{2}$/, "Choose an end time."),
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
  attendees: z.coerce.number().int().min(1, "At least 1 person.").max(500),
  fullName: z.string().trim().min(2, "Please enter your full name.").max(120),
  companyName: z.string().trim().max(120).optional(),
  phone: z.string().trim().regex(/^\+?[\d\s().-]{7,}$/, "Enter a phone number we can call or WhatsApp."),
  email: z.union([z.literal(""), z.email("Enter a valid email address.").max(160)]).optional(),
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
    const d = parseInput(booking, input);
    const r = await submitMeetingRequest({ ...d, email: d.email || null, companyName: d.companyName || null }, ipAddress);
    return { reference: r.reference, manageToken: r.manageToken, name: d.fullName.split(/\s+/)[0], date: r.date, time: r.time, price: r.price, room: r.name };
  });
}
