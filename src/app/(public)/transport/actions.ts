"use server";

import { z } from "zod";
import { db } from "@/server/db";
import { requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { createTransportRequest } from "@/server/services/transport";
import { payTripOnline } from "@/server/services/online-pay";

const schema = z.object({
  serviceId: z.string().min(1, "Choose a service."),
  optionId: z.string().optional(),
  passengerName: z.string().trim().min(2, "Please enter your full name.").max(120),
  passengerPhone: z.string().trim().regex(/^\+?[\d\s().-]{7,}$/, "Enter a phone number we can call or WhatsApp."),
  passengerEmail: z.union([z.literal(""), z.email("Enter a valid email address.").max(160)]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time."),
  airport: z.string().trim().max(120).optional(),
  pickupLocation: z.string().trim().max(200).optional(),
  destination: z.string().trim().max(200).optional(),
  flightNumber: z.string().trim().max(20).optional(),
  passengers: z.coerce.number().int().min(1, "At least 1 guest.").max(20, "For more than 20 guests, please call us."),
  bags: z.coerce.number().int().min(0).max(40).optional(),
  reservationRef: z.string().trim().max(40).optional(),
  roomNumber: z.string().trim().max(10).optional(),
  notes: z.string().trim().max(600).optional(),
  company: z.string().max(0).optional(), // honeypot
});

export type TransportReceipt = { reference: string; name: string; service: string; option: string | null; date: string; time: string; price: number; pickup: boolean; custom: boolean; /** The trip's private page (status, Pay online). */ page: string | null };

/** A guest asks for transport — no account, no password. Starts PENDING; the hotel calls to confirm. */
export async function requestTransportAction(input: z.input<typeof schema>): Promise<ActionResult<TransportReceipt>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    if (input.company) throw new AppError("Please try again.");
    await rateLimit(`web-transport:${ipAddress ?? "unknown"}`, 6, 600);
    const d = parseInput(schema, input);
    const trip = await createTransportRequest({
      ...d, passengerEmail: d.passengerEmail || null, bags: d.bags ?? null, roomNumber: d.roomNumber || null,
    }, { source: "WEBSITE" });
    const service = await db.transportService.findUnique({ where: { id: d.serviceId }, select: { name: true, type: true } });
    return {
      reference: trip.reference, name: d.passengerName.split(/\s+/)[0], service: service?.name ?? "Transport", option: trip.priceOption,
      date: d.date, time: d.time, price: trip.charge ?? 0, pickup: service?.type === "AIRPORT_PICKUP", custom: service?.type === "GUEST_TRANSPORT",
      page: trip.payToken ? `/transport/trip/${trip.payToken}` : null,
    };
  });
}

const Pay = z.object({ phone: z.string().trim().min(9, "Enter your mobile-money number.").max(30), clientKey: z.string().regex(/^[a-f0-9]{32}$/) });

/** "Pay online" for a website trip (bound to its private link): its price, worked out on the server. Returns the payment page. */
export async function payTripOnlineAction(token: string, input: z.input<typeof Pay>): Promise<ActionResult<{ pay: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    const d = parseInput(Pay, input);
    const r = await payTripOnline(z.string().regex(/^[A-Za-z0-9_-]{16,40}$/).parse(token), { phone: d.phone, clientKey: d.clientKey, ip: ipAddress });
    return { pay: r.token };
  });
}
