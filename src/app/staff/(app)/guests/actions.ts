"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { normalizePhone, removeCustomer, setGuestLanguage } from "@/server/services/guests";
import { validPhone } from "@/lib/guest-messages";
import { LOCALES } from "@/i18n/config";
import { msg, msgf } from "@/i18n/msg";

const opt = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const phoneOpt = z.string().trim().max(30).refine((v) => !v || validPhone(v), msg("Enter a phone number like 0712 345 678 or +44…")).transform((v) => v || null);
const GuestSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().trim().min(2, msg("Name is required.")).max(120),
  phone: phoneOpt,
  altPhone: phoneOpt.optional(),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email(msg("Enter a valid email."))]).transform((v) => v || null),
  idType: opt(40),
  idNumber: opt(60),
  nationality: opt(60),
  address: opt(200),
  notes: opt(1000),
  preferences: opt(1000).optional(),
  dateOfBirth: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Choose a date."))]).optional(),
  preferredChannel: z.union([z.literal(""), z.enum(["WHATSAPP", "SMS", "EMAIL", "CALL"])]).optional(),
  marketingConsent: z.string().optional(),
  vip: z.string().optional(),
  tags: z.string().trim().max(300).optional(),
  /** The full form (profile page) — the short form on a booking only has the basics. */
  full: z.string().optional(),
});

/** Save a customer's details. Every change is written to the history with the old and new values. */
export async function updateGuestAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("guests.manage");
    const d = parseInput(GuestSchema, formData);
    const before = await db.guest.findUnique({ where: { id: d.id } });
    if (!before) throw new AppError("Guest not found.", "NOT_FOUND");
    const full = d.full === "1";
    const consent = d.marketingConsent === "on";
    const next = {
      fullName: d.fullName, phone: normalizePhone(d.phone), email: d.email, idType: d.idType, idNumber: d.idNumber,
      nationality: d.nationality, address: d.address, notes: d.notes,
      ...(full ? {
        altPhone: normalizePhone(d.altPhone ?? null), preferences: d.preferences ?? null,
        dateOfBirth: d.dateOfBirth ? new Date(`${d.dateOfBirth}T00:00:00Z`) : null,
        preferredChannel: d.preferredChannel || null,
        marketingConsent: consent, marketingConsentAt: consent === before.marketingConsent ? before.marketingConsentAt : consent ? new Date() : null,
        tags: [...new Set((d.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 12).map((t) => t.slice(0, 24)),
        // VIP is a manager's call.
        ...(user.permissions.has("reports.view") ? { vip: d.vip === "on" } : {}),
      } : {}),
    };
    const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof typeof before])));
    if (!Object.keys(changed).length) return null;
    if (before.deletedAt) throw new AppError("This customer was removed.", "CONFLICT");
    // The name and the number are who the customer is: only staff with the right (reception, waiters, managers, admin) change them.
    const identity = "fullName" in changed || ("phone" in changed && before.phone) || ("altPhone" in changed && before.altPhone);
    if (identity && !user.permissions.has("guests.delete")) {
      throw new AppError("You cannot change a customer's name or phone number.", "FORBIDDEN");
    }
    // One number, one customer: the phone finds them everywhere.
    if (changed.phone) {
      const other = await db.guest.findFirst({ where: { id: { not: d.id }, deletedAt: null, phone: changed.phone as string }, select: { fullName: true, reference: true } });
      if (other) throw new AppError(msgf("This number already belongs to {name} ({ref}).", { name: other.fullName, ref: other.reference }), "CONFLICT", { phone: msg("Taken") });
    }
    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      await tx.guest.update({ where: { id: d.id }, data: next });
      await audit(tx, { userId: user.id, label: user.fullName, ipAddress }, {
        action: "guest.updated", entityType: "Guest", entityId: d.id,
        before: Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof typeof before]])),
        after: changed,
      });
    });
    revalidatePath(`/staff/guests/${d.id}`);
    return null;
  }, msg("Customer updated."));
}

const Language = z.object({ id: z.string().min(1), language: z.union([z.enum(LOCALES), z.literal("")]) });

/** The language the hotel writes to this customer in (WhatsApp, their pages) — "" = not set (English). Kept in the history. */
export async function setGuestLanguageAction(input: z.input<typeof Language>): Promise<ActionResult<{ changed: boolean }>> {
  return runAction(async () => {
    const user = await authorize("guests.manage");
    const d = parseInput(Language, input);
    const { ipAddress } = await requestMeta();
    const res = await setGuestLanguage(d.id, d.language || null, { userId: user.id, label: user.fullName, ipAddress });
    revalidatePath(`/staff/guests/${d.id}`);
    return res;
  }, msg("Message language saved."));
}

const MessageLog = z.object({
  reservationId: z.string().min(1).optional(),
  guestId: z.string().min(1).optional(),
  restaurantOrderId: z.string().min(1).optional(),
  type: z.enum(["BOOKING_CREATED", "BOOKING_CONFIRMED", "BOOKING_UPDATED", "BOOKING_CANCELLED", "ROOM_CHANGED", "PAYMENT_RECEIVED", "BOOKING_REMINDER", "WELCOME", "CHECKOUT_REMINDER", "THANK_YOU", "PAYMENT", "CUSTOM",
    "ORDER_RECEIVED", "ORDER_PREPARING", "ORDER_READY", "ORDER_DELIVERED", "ORDER_CANCELLED", "ORDER_PAID", "TRANSPORT"]),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL", "COPY", "CALL"]),
  to: z.string().trim().max(160).optional(),
  body: z.string().max(4000),
});

/** Reception sent a message to a guest (WhatsApp / SMS / email from their device): keep it on the guest's history. */
export async function logGuestMessageAction(input: z.input<typeof MessageLog>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("reservations.view", "guests.manage", "restaurant.orders");
    const d = parseInput(MessageLog, input);
    const order = d.restaurantOrderId ? await db.restaurantOrder.findUnique({ where: { id: d.restaurantOrderId }, select: { guestId: true, reservationId: true } }) : null;
    const guestId = d.guestId ?? order?.guestId ?? (d.reservationId ? (await db.reservation.findUnique({ where: { id: d.reservationId }, select: { guestId: true } }))?.guestId : null);
    if (!guestId) throw new AppError("Guest not found.", "NOT_FOUND");
    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      const m = await tx.guestMessage.create({
        data: { guestId, reservationId: d.reservationId ?? order?.reservationId ?? null, restaurantOrderId: d.restaurantOrderId ?? null, type: d.type, channel: d.channel, to: d.to || null, body: d.body, sentById: user.id },
      });
      await audit(tx, { userId: user.id, label: user.fullName, ipAddress }, {
        action: "guest.message_sent", entityType: "Guest", entityId: guestId, after: { message: m.id, type: d.type, channel: d.channel, to: d.to ?? null, reservation: d.reservationId ?? null },
      });
    });
    revalidatePath(`/staff/guests/${guestId}`);
    return null;
  });
}

/** Reception, waiters, managers, admin: remove a customer (see removeCustomer — records with money stay in the books). */
export async function removeCustomerAction(id: string): Promise<ActionResult<{ deleted: boolean }>> {
  return runAction(async () => {
    const user = await authorize("guests.delete");
    const { ipAddress } = await requestMeta();
    const res = await removeCustomer(String(id), { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions });
    revalidatePath("/staff/guests");
    return res;
  });
}
