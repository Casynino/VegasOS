"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { siteOrigin } from "@/server/site-origin";
import { parseInput } from "@/server/validation";
import {
  archiveBookingQr, createBookingQr, HOTEL_QR_SOURCE, regenerateBookingQr, setBookingQrActive, setHotelQrSettings, updateBookingQr,
} from "@/server/services/booking-qr";
import { guestMessage } from "@/server/services/guest-comms";
import { msg } from "@/i18n/msg";

/**
 * The Hotel QR page's changes — the Admin's only (hotel_qr.manage): a code for another place, rename, a new code
 * (the old card stops working), switch off / on, archive, and the two switches. The service checks the right again.
 * Reception: the booking details of a QR booking, to send to the guest from the list.
 */

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions };
}
function refresh() {
  revalidatePath("/staff/hotel-qr");
  revalidatePath("/staff/settings/control");
}

const Id = z.string().trim().min(1).max(40);
const Place = z.object({
  label: z.string().trim().min(2, msg("Name the place the QR goes (e.g. Entrance, Lobby, Flyer).")).max(60, msg("Keep the name short.")),
  placement: z.string().trim().max(120, msg("Keep the note short.")).nullable().optional(),
});

/** A new code for another place (the entrance, a flyer…) — its own card and its own numbers. */
export async function createBookingQrAction(input: { label: string; placement?: string | null }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize("hotel_qr.manage");
    const data = parseInput(Place, input);
    const qr = await createBookingQr(data, await actor(user));
    refresh();
    return { id: qr.id };
  }, msg("QR made — print its card."));
}

/** Rename a code or change its note (the printed card keeps working). */
export async function updateBookingQrAction(input: { id: string; label: string; placement?: string | null }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("hotel_qr.manage");
    const { id, ...data } = parseInput(Place.extend({ id: Id }), input);
    await updateBookingQr(id, data, await actor(user));
    refresh();
    return null;
  }, msg("Saved."));
}

/** A new code for the same place: the old printed card stops working at once. */
export async function regenerateBookingQrAction(input: { id: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("hotel_qr.manage");
    await regenerateBookingQr(parseInput(Id, input.id), await actor(user));
    refresh();
    return null;
  }, msg("New QR made — print the new card and replace the old one."));
}

/** Switch a code off (scanning it says it is not active) or back on. */
export async function setBookingQrActiveAction(input: { id: string; active: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("hotel_qr.manage");
    await setBookingQrActive(parseInput(Id, input.id), input.active === true, await actor(user));
    refresh();
    return null;
  }, input.active ? msg("QR switched on.") : msg("QR switched off — scanning it now asks the guest to contact reception."));
}

/** Archive a code no longer used: it stops working and leaves the list; its bookings and numbers stay. */
export async function archiveBookingQrAction(input: { id: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("hotel_qr.manage");
    await archiveBookingQr(parseInput(Id, input.id), await actor(user));
    refresh();
    return null;
  }, msg("QR archived — it no longer works."));
}

/** Booking from the QR on / off, and whether a guest may reserve there and pay at the hotel. */
export async function setHotelQrSettingsAction(input: { enabled?: boolean; payAtHotel?: boolean }): Promise<ActionResult<{ enabled: boolean; payAtHotel: boolean }>> {
  return runAction(async () => {
    const user = await authorize("hotel_qr.manage");
    const data = parseInput(z.object({ enabled: z.boolean().optional(), payAtHotel: z.boolean().optional() }), input);
    const saved = await setHotelQrSettings(data, await actor(user));
    refresh();
    return saved;
  });
}

/**
 * "Send booking details" from the QR bookings list (reception): the hotel's booking message for this Hotel QR booking,
 * ready to send from this device — the same message and log as on the booking itself.
 */
export async function qrBookingMessageAction(input: { reservationId: string }): Promise<ActionResult<{
  text: string; subject: string; link: string; guest: { name: string; phone: string | null; email: string | null };
  /** The guest's own language, so the window says which language the message is written in. */
  language: string | null;
  sent: { type: string; channel: string; at: string; by: string | null }[];
}>> {
  return runAction(async () => {
    await authorize("reservations.view");
    const id = parseInput(Id, input.reservationId);
    const r = await db.reservation.findUnique({ where: { id }, select: { status: true, kind: true, source: { select: { code: true } }, guest: { select: { preferredLanguage: true } } } });
    if (!r || r.source.code !== HOTEL_QR_SOURCE) throw new AppError("Booking not found.", "NOT_FOUND");
    if (r.kind !== "STAY" || r.status === "CANCELLED" || r.status === "NO_SHOW") throw new AppError("This booking is closed — there are no booking details to send.", "CONFLICT");
    let origin: string;
    try { origin = await siteOrigin(); } catch { origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, ""); }
    const [m, sent] = await Promise.all([
      guestMessage(id, "BOOKING_CREATED", origin),
      db.guestMessage.findMany({ where: { reservationId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { sentBy: { select: { fullName: true } } } }),
    ]);
    return {
      text: m.text, subject: m.subject, link: m.link, guest: { name: m.guest.name, phone: m.guest.phone, email: m.guest.email }, language: r.guest.preferredLanguage,
      // Sent by the hotel's messaging (booking confirmed) counts as the booking details too.
      sent: sent.filter((x) => x.status === "SENT").map((x) => ({ type: x.type === "BOOKING_CONFIRMED" ? "BOOKING_CREATED" : x.type, channel: x.channel, at: x.createdAt.toISOString(), by: x.sentBy?.fullName ?? null })),
    };
  });
}
