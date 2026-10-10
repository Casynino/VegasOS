"use server";

import { cookies } from "next/headers";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { LOCALE_COOKIE, toLocale } from "./config";

/**
 * Switching language changes how things are SHOWN to this one person — nothing else: no business data, no
 * permissions, no one else's language. Not audited (it is not a business change).
 */

/**
 * A visitor (website, QR, guest pages) picks a language: remembered on this device. On their own guest pages
 * (stay link, order tracking, booking link) it is also saved on their customer record — their WhatsApp messages
 * follow it. Only the token they hold identifies them; nothing else is changed.
 */
export async function setVisitorLanguage(locale: string, own?: { stay?: string | null; order?: string | null; booking?: string | null }) {
  const l = toLocale(locale);
  if (!l) return { ok: false as const };
  (await cookies()).set(LOCALE_COOKIE, l, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  try {
    const guestId =
      own?.stay ? (await db.reservation.findUnique({ where: { guestToken: own.stay }, select: { guestId: true } }))?.guestId
      : own?.booking ? (await db.reservation.findUnique({ where: { manageToken: own.booking }, select: { guestId: true } }))?.guestId
      : own?.order ? (await db.restaurantOrder.findUnique({ where: { trackToken: own.order }, select: { guestId: true } }))?.guestId
      : null;
    if (guestId) await db.guest.update({ where: { id: guestId }, data: { preferredLanguage: l } });
  } catch (e) {
    console.error("[i18n] could not save the guest's language", e);
  }
  return { ok: true as const };
}

/** A signed-in staff member picks their own interface language (kept on their account, on every device). */
export async function setMyLanguage(locale: string) {
  const l = toLocale(locale);
  const user = await getCurrentUser();
  if (!l || !user) return { ok: false as const };
  await db.user.update({ where: { id: user.id }, data: { preferredLanguage: l } });
  return { ok: true as const };
}
