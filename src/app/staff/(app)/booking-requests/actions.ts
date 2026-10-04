"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import {
  assignRequest, convertRequest, logContact, relinkCustomer, setRequestStatus, submitBookingRequest,
} from "@/server/services/booking-requests";
import { isBusinessDate, zonedInstant, type BusinessDate } from "@/lib/time/business-date";
import { getSettings } from "@/server/settings";
import type { BookingRequestStatus } from "@/generated/prisma/enums";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions as ReadonlySet<string> };
}

function refresh(id?: string) {
  revalidatePath("/staff/booking-requests");
  if (id) revalidatePath(`/staff/booking-requests/${id}`);
  for (const p of ["/admin/dashboard", "/manager/dashboard", "/reception/dashboard"]) revalidatePath(p);
}

const date = z.string().refine((v) => isBusinessDate(v), "Choose a valid date.");

export async function setRequestStatusAction(input: { id: string; to: BookingRequestStatus; note?: string }) {
  return runAction(async () => {
    const user = await authorize("booking_requests.manage");
    await setRequestStatus(input.id, input.to, await actor(user), input.note ?? null);
    refresh(input.id);
    return null;
  }, "Status updated.");
}

export async function logContactAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("booking_requests.manage");
    const d = parseInput(z.object({
      id: z.string().min(1),
      note: z.string().trim().min(2, "Write what was said or agreed.").max(1000),
      contactedAt: z.string().optional(),
    }), formData);
    // "2026-10-04T14:30" from the form is hotel time (never the server's own clock zone).
    const m = d.contactedAt?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    const at = m && isBusinessDate(m[1]) ? zonedInstant(m[1] as BusinessDate, Number(m[2]) * 60 + Number(m[3]), (await getSettings()).timezone) : null;
    await logContact(d.id, { note: d.note, contactedAt: at && !Number.isNaN(at.getTime()) ? at : null }, await actor(user));
    refresh(d.id);
    return null;
  }, "Contact logged.");
}

export async function assignRequestAction(input: { id: string; userId: string | null }) {
  return runAction(async () => {
    const user = await authorize("booking_requests.manage");
    await assignRequest(input.id, input.userId, await actor(user));
    refresh(input.id);
    return null;
  }, "Assignment updated.");
}

export async function relinkCustomerAction(input: { id: string; guestId: string }) {
  return runAction(async () => {
    const user = await authorize("booking_requests.manage");
    await relinkCustomer(input.id, input.guestId === "NEW" ? "NEW" : input.guestId, await actor(user));
    refresh(input.id);
    return null;
  }, "Customer updated.");
}

/** Confirm & create reservation — the engine re-checks availability and price at this moment. */
export async function convertRequestAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  let target: string | null = null;
  const res = await runAction(async () => {
    const user = await authorize("booking_requests.manage");
    const d = parseInput(z.object({
      id: z.string().min(1),
      checkIn: date,
      checkOut: date,
      roomTypeId: z.string().min(1, "Choose a room type."),
      roomId: z.string().optional(),
      roomCount: z.coerce.number().int().min(1).max(10),
      adults: z.coerce.number().int().min(1).max(40),
      children: z.coerce.number().int().min(0).max(40),
      discountPerNight: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional(),
      discountReason: z.string().trim().max(200).optional(),
      note: z.string().trim().max(500).optional(),
      // Food & drinks from the menu: JSON [{ menuItemId, quantity }] — prices come from the menu on the server.
      menuItems: z.string().max(8000).optional().transform((v, ctx) => {
        if (!v) return [];
        try {
          return z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).max(40).parse(JSON.parse(v));
        } catch {
          ctx.addIssue({ code: "custom", message: "The food & drinks list could not be read — pick them again." });
          return z.NEVER;
        }
      }),
    }), formData);
    const reservation = await convertRequest(d.id, {
      checkIn: d.checkIn as BusinessDate, checkOut: d.checkOut as BusinessDate, roomTypeId: d.roomTypeId, roomId: d.roomId || null,
      roomCount: d.roomCount, adults: d.adults, children: d.children,
      discountPerNight: typeof d.discountPerNight === "number" ? d.discountPerNight : null,
      discountReason: d.discountReason || null, note: d.note || null, menuItems: d.menuItems.length ? d.menuItems : null,
    }, await actor(user));
    refresh(d.id);
    revalidatePath("/staff/reservations");
    // From the list (the request opened in place) the receptionist stays on the list; from its own page, the reservation opens.
    // (The list then shows it under Converted, open: "Reservation made" with its link.)
    target = formData.get("stay") === "1" ? `/staff/booking-requests?status=converted&open=${d.id}` : `/staff/reservations/${reservation.id}`;
    return null;
  }, "Reservation created.");
  if (res.ok && target) redirect(target);
  return res;
}

/** Staff log a request that came in by WhatsApp or phone, so every lead lives in one queue. */
export async function logManualRequestAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize("booking_requests.manage");
    const d = parseInput(z.object({
      sourceCode: z.enum(["WHATSAPP", "PHONE", "INSTAGRAM", "DIRECT", "OTHER"]),
      fullName: z.string().trim().min(2, "Enter the customer's name.").max(120),
      phone: z.string().trim().min(7, "Enter a phone number.").max(30),
      email: z.union([z.literal(""), z.email("Enter a valid email.")]).optional(),
      checkIn: date,
      checkOut: date,
      typeSlug: z.string().min(1, "Choose a room type."),
      rooms: z.coerce.number().int().min(1).max(10),
      adults: z.coerce.number().int().min(1).max(40),
      children: z.coerce.number().int().min(0).max(40),
      expectedArrivalTime: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.")]).optional(),
      specialRequests: z.string().trim().max(1000).optional(),
    }), formData);
    const { ipAddress } = await requestMeta();
    const a = await actor(user);
    const r = await submitBookingRequest(
      { checkIn: d.checkIn as BusinessDate, checkOut: d.checkOut as BusinessDate, typeSlug: d.typeSlug, rooms: d.rooms, adults: d.adults, children: d.children },
      { fullName: d.fullName, phone: d.phone, email: d.email || null, expectedArrivalTime: d.expectedArrivalTime || null, specialRequests: d.specialRequests || null },
      ipAddress, null, { sourceCode: d.sourceCode, actor: a },
    );
    refresh();
    return { id: r.id };
  }, "Request logged.");
}
