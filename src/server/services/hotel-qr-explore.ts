import "server-only";
import { db } from "../db";
import { getSettings } from "../settings";
import { MENU_PHOTO_BY_FILE } from "@/lib/menu-photos";
import { MAP_LINK_URL } from "@/components/public/site-config";
import { mediaUrl } from "./media";
import { restaurantMenu } from "./online-orders";
import { publicMeetingRoom } from "./booking-requests";
import { parseImages } from "./public-booking";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import { englishT } from "@/i18n/translate";

/**
 * WHAT THE HOTEL QR SHOWS TO EXPLORE (/b/<token>) — read only, nothing here books or prices anything: the photos for
 * the opening (the building, a room, a bathroom, the lobby, the meeting room — from the media library, the hotel's own
 * photos only), a few dishes from the restaurant app's own menu (its "Recommended", with their photo credits), the
 * meeting room (name, how many it takes, its photo) and the hotel's hours and map. No database id leaves this file.
 */

export type ExplorePhoto = { src: string; alt: string; label: string; width: number; height: number };
/** One place in the opening: an upright photo for phones and a wide one for computers (the same photo when only one). */
export type OpeningSlide = { label: string; tall: ExplorePhoto; wide: ExplorePhoto };
export type ExploreDish = { key: string; name: string; price: number; from: boolean; image: string; drink: boolean };
export type ExploreCredit = { item: string; creator: string; license: string; licenseUrl: string; sourcePage: string };
export type QrExplore = {
  /** The opening: one place after another — the building first. */
  opening: OpeningSlide[];
  /** "The hotel": outside, reception, the details, rooms and bathrooms — the hotel's own photos, each with its word. */
  hotel: ExplorePhoto[];
  food: {
    dishes: ExploreDish[];
    /** "Picked by our kitchen" / "Most ordered" / "A taste of the menu" — the restaurant app's own words. */
    note: string;
    /** Licensed stock photos among the dishes: their credits (the hotel's own photos need none). */
    credits: ExploreCredit[];
    restaurantHours: string | null; barHours: string | null;
    /** The restaurant app (menu + ordering), opened in a new tab. */
    menuHref: string;
  };
  meeting: { name: string; capacity: number; about: string | null; photo: ExplorePhoto | null; href: string } | null;
  /** Directions: the hotel's own map link, or a search for its area. */
  mapHref: string;
};

/** The opening's places, in order, and the word under each (English: the page finds places by it and shows t(label)). */
const OPENING: { category: "EXTERIOR" | "ROOMS" | "BATHROOMS" | "RECEPTION" | "MEETING_ROOM"; label: string }[] = [
  { category: "EXTERIOR", label: msg("The hotel") },
  { category: "ROOMS", label: msg("Your room") },
  { category: "BATHROOMS", label: msg("The bathroom") },
  { category: "RECEPTION", label: msg("Reception") },
  { category: "MEETING_ROOM", label: msg("Meeting room") },
  { category: "EXTERIOR", label: msg("Outside") },
];

export async function qrExplore(): Promise<QrExplore> {
  const [settings, media, menu, meetingRoom] = await Promise.all([
    getSettings(),
    db.mediaAsset.findMany({
      where: { isActive: true, isIllustrative: false, category: { in: ["EXTERIOR", "ROOMS", "BATHROOMS", "RECEPTION", "MEETING_ROOM", "FACILITIES"] } },
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }],
      select: { id: true, url: true, altText: true, category: true, width: true, height: true, roomTypeId: true },
    }),
    restaurantMenu(),
    publicMeetingRoom(),
  ]);

  const photo = (m: (typeof media)[number], label: string): ExplorePhoto => ({ src: mediaUrl(m), alt: m.altText, label, width: m.width ?? 1600, height: m.height ?? 1067 });
  // Each place: the hotel's first upright photo for phones and its first wide one for computers (the media library's
  // order: featured first) — a photo used once is not used again.
  const used = new Set<string>();
  const opening: OpeningSlide[] = [];
  const upright = (m: (typeof media)[number]) => (m.height ?? 0) > (m.width ?? 0);
  for (const o of OPENING) {
    const left = media.filter((x) => x.category === o.category && !used.has(mediaUrl(x)));
    if (!left.length) continue;
    const tall = left.find(upright) ?? left[0];
    const wide = left.find((x) => !upright(x)) ?? tall;
    used.add(mediaUrl(tall)).add(mediaUrl(wide));
    opening.push({ label: o.label, tall: photo(tall, o.label), wide: photo(wide, o.label) });
  }

  // The hotel: everything outside and at reception, the details, the rooms' photos not kept for one room type, and a
  // few bathrooms — in that order (the first of each makes the mosaic).
  const group = (category: string, label: string, max: number, only?: (m: (typeof media)[number]) => boolean) =>
    media.filter((m) => m.category === category && (!only || only(m))).slice(0, max).map((m) => photo(m, label));
  const hotelPhotos = [
    ...group("EXTERIOR", msg("Outside"), 8), ...group("RECEPTION", msg("Reception"), 6), ...group("FACILITIES", msg("Details"), 6),
    ...group("ROOMS", msg("Rooms"), 8, (m) => !m.roomTypeId), ...group("BATHROOMS", msg("Bathrooms"), 6),
  ];

  // Dishes: the restaurant app's "Recommended" first, then dishes with a photo from each food section in turn.
  const entries = menu.sections.flatMap((s) => s.entries.map((e) => ({ e, drink: s.drink })));
  const byKey = new Map(entries.map((x) => [x.e.key, x]));
  const orderable = (x: (typeof entries)[number]) => !!x.e.image && x.e.options.some((o) => o.available);
  const picked = menu.recommended.map((k) => byKey.get(k)).filter((x): x is (typeof entries)[number] => !!x && orderable(x));
  const food = menu.sections.filter((s) => !s.drink).map((s) => s.entries.map((e) => ({ e, drink: false })).filter(orderable));
  for (let round = 0; picked.length < 8 && food.some((l) => l.length > round); round++) {
    for (const list of food) {
      const x = list[round];
      if (x && picked.length < 8 && !picked.some((p) => p.e.key === x.e.key)) picked.push(x);
    }
  }
  const dishes: ExploreDish[] = picked.slice(0, 8).map(({ e, drink }) => {
    const prices = e.options.filter((o) => o.available).map((o) => o.price);
    return { key: e.key, name: e.name, price: Math.min(...prices), from: e.options.length > 1, image: e.image!, drink };
  });
  const credits = [...new Map(dishes.flatMap((d) => {
    const p = MENU_PHOTO_BY_FILE.get(d.image);
    return p ? [[p.sourcePage, { item: d.name, creator: p.creator, license: p.license, licenseUrl: p.licenseUrl, sourcePage: p.sourcePage }] as const] : [];
  })).values()];

  // The meeting room: its own photo (the media library first, then the room type's list) — never a stock one here.
  const meetingMedia = media.find((m) => m.category === "MEETING_ROOM");
  const meetingSrc = meetingMedia ? null : meetingRoom ? parseImages(meetingRoom.images)[0] ?? null : null;
  // The photo's description, in the visitor's language.
  const t = await getT().catch(() => englishT);
  const meeting = meetingRoom ? {
    name: meetingRoom.name, capacity: meetingRoom.maxAdults, about: meetingRoom.shortDescription || null,
    photo: meetingMedia ? photo(meetingMedia, meetingRoom.name) : meetingSrc ? { src: meetingSrc, alt: t("{name} at {hotel}", { name: t(meetingRoom.name), hotel: settings.hotelName }), label: meetingRoom.name, width: 1600, height: 1067 } : null,
    href: "/meeting-room",
  } : null;

  return {
    opening,
    hotel: hotelPhotos,
    food: {
      dishes, credits,
      note: menu.recommendedBy === "featured" ? msg("Picked by our kitchen") : menu.recommendedBy === "popular" ? msg("Most ordered") : msg("A taste of the menu"),
      restaurantHours: settings.restaurantHours?.trim() || null, barHours: settings.barHours?.trim() || null,
      menuHref: "/order",
    },
    meeting,
    mapHref: settings.mapUrl?.trim() || MAP_LINK_URL,
  };
}
