import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { redirect } from "next/navigation";
import { can, getCurrentUser } from "@/server/auth";
import { roomForQr, scanRoomQr } from "@/server/services/room-qr";
import { restaurantMenu } from "@/server/services/online-orders";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { roomTypeOffer, roomTypePhotos } from "@/server/services/room-qr-page";
import { StayPage } from "@/components/restaurant/stay-page";
import { RestaurantApp } from "@/components/restaurant/restaurant-app";
import { restaurantShell } from "@/components/restaurant/shell";
import { telHref } from "@/components/hotel-qr/lib";
import { FreeRoomTop, type FreeRoom } from "@/components/room-qr/free-room";
import { HotelFooter } from "@/components/room-qr/parts";
import { hotelInfo } from "@/components/room-qr/contact";
import { MEETING_PHOTO, realPhotos, ROOM_PHOTO } from "@/components/room-qr/photos";

export const metadata: Metadata = { title: "Welcome", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The QR card in a room opens here. The QR belongs to the room: the stay checked in to the room right now is found on
 * the server (today one guest, tomorrow the next). A guest staying gets "Your room" — welcome, bill, what they can ask
 * for the room, and the menu ordering to their room bill. When nobody is checked in, the room itself (its photos, type,
 * tonight's price, Book a room like this) and the menu to eat at the restaurant or take out — nothing goes on a room bill
 * without a stay. An unknown or switched-off card: the restaurant app as it was.
 */
export default async function RoomQrPage({ params, searchParams }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  // Staff scanning a room's card get the room control page (not the guest's). "?view=guest" shows what guests see.
  if (sp.view !== "guest") {
    const [user, qrRoom] = await Promise.all([getCurrentUser(), roomForQr(token)]);
    if (qrRoom && user && can(user, "rooms.view")) redirect(`/staff/rooms/${qrRoom.roomId}`);
  }
  const [scan, s] = await Promise.all([scanRoomQr(token), getSettings()]);

  // Someone is staying in the room: their page — the stay on top, the menu to order to the room bill.
  if (scan?.stay) return <StayPage stay={scan.stay} s={s} target={{ kind: "room", token }} via="room" />;

  const room = scan?.room?.active ? scan.room : null;
  const label = room ? (room.meeting ? `Meeting room ${room.number}` : `Room ${room.number}`) : null;
  const { brand, status } = restaurantShell(s);
  const [menu, online] = await Promise.all([restaurantMenu(), onlinePayAvailable("restaurant", s)]);
  const app = {
    status, menu, canOrder: s.publicOrderingEnabled,
    place: { kind: "public" as const, table: null, room: !!room, label, note: room ? "Eat at the restaurant or take out · room service once you are checked in" : null },
    checkout: { kind: "public" as const, table: null, fromQr: true, online },
  };
  if (!room || !scan?.info) return <RestaurantApp brand={brand} {...app} />;

  // Nobody checked in: the room itself, the website's way — its photos and tonight's website price.
  const t = scan.info;
  const [offer, photos] = await Promise.all([room.meeting ? null : roomTypeOffer(t.slug, s), roomTypePhotos(t.slug)]);
  const free: FreeRoom = {
    title: label!,
    type: room.meeting ? "For meetings & events" : t.type,
    // Real photos only (no stock passed off as this room).
    photos: realPhotos(offer?.images.length ? offer.images : photos.length ? photos : t.photo ? [t.photo] : [], room.meeting ? MEETING_PHOTO : ROOM_PHOTO),
    from: offer?.from ?? null, base: offer?.base ?? null, promo: offer?.promo ?? null,
    facts: [
      room.meeting ? `Up to ${plural(t.adults, "person", "people")}` : `Up to ${plural(t.adults, "adult")}${t.children ? ` and ${plural(t.children, "child", "children")}` : ""}`,
      t.size ? `${t.size} m²` : null,
      !room.meeting && t.bed ? t.bed : null,
    ].filter(Boolean).join(" · ") || null,
    book: room.meeting ? { label: "Book the meeting room", href: "/meeting-room" }
      // A room of this type (not this very room number) — booked on the website's page of the room type.
      : offer ? { label: "Book a room like this", href: offer.bookHref }
      : s.phone ? { label: "Call to book", href: telHref(s.phone) } : null,
    menuNote: "Eat at the restaurant or take out · room service once you are checked in.",
  };
  return (
    <RestaurantApp brand={{ name: s.hotelName, hotel: s.hotelName, tagline: "Welcome" }} {...app}
      top={<FreeRoomTop key="room-top" room={free} />}
      bottom={<HotelFooter key="room-bottom" info={hotelInfo(s, `Hello ${s.hotelName}, I have a question about ${label}.`)} note={`The card of ${label}. Once you have checked in, it opens your own room page.`} />} />
  );
}
