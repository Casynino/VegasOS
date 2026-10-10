import "server-only";
import { db } from "../db";
import type { HotelSettings } from "@/generated/prisma/client";
import { getT } from "@/i18n/server";
import { englishT } from "@/i18n/translate";
import { getPublicRoomType, parseImages, websitePricer } from "./public-booking";

/**
 * Read-only extras for the guest's room page (the room QR card and the private stay link) — nothing here writes.
 * The page itself comes from room-qr / guest-comms; these only add what the new look shows besides.
 */

/**
 * The words a guest's own recent requests were sent with ("Room change: …"), by request id — so the page can name a
 * room change or a late check-out instead of "General help". The ids come from the stay the server found, never the phone.
 */
export async function guestRequestNotes(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await db.serviceRequest.findMany({ where: { id: { in: ids.slice(0, 12) }, type: "GENERAL" }, select: { id: true, description: true } });
  return Object.fromEntries(rows.filter((r) => r.description).map((r) => [r.id, r.description!.slice(0, 120)]));
}

/** All the photos of a room type (the meeting room too — the website's room list only has guest rooms). */
export async function roomTypePhotos(slug: string) {
  const t = await db.roomType.findUnique({ where: { slug }, select: { images: true } });
  return t ? parseImages(t.images).slice(0, 10) : [];
}

/**
 * A free room's card: its type as the website sells it — the photos, tonight's website price ("from", the same pricer
 * as the website and the Hotel QR), who it holds — and where "Book a room like this" goes: the website's page of the
 * room type. Not the Hotel QR booking app: its visits and bookings count for the printed QR they were opened from, and a
 * room card is not one of them. Null for a type the website does not sell (the meeting room, a private type).
 */
export async function roomTypeOffer(slug: string, s: HotelSettings) {
  // The promotion label ("10% off") in the guest's language — the page shows it as it is.
  const words = await getT().catch(() => englishT);
  const [type, price] = await Promise.all([getPublicRoomType(slug), websitePricer(s, words)]);
  if (!type) return null;
  const p = price(type);
  return {
    name: type.name, images: type.images, from: p.net, base: p.baseRate, promo: p.promoLabel,
    adults: type.maxAdults, children: type.maxChildren, bed: type.bedType, size: type.sizeSqm,
    bookHref: `/rooms/${encodeURIComponent(type.slug)}`,
  };
}
