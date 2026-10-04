import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { redirect } from "next/navigation";
import { can, getCurrentUser } from "@/server/auth";
import { roomForQr, scanRoomQr } from "@/server/services/room-qr";
import { restaurantMenu } from "@/server/services/online-orders";
import { customerPayAccounts } from "@/server/services/payment-accounts";
import { telHref, whatsappHref } from "@/components/public/contact";
import { StayPage } from "@/components/restaurant/stay-page";
import { RestaurantApp } from "@/components/restaurant/restaurant-app";
import { restaurantShell } from "@/components/restaurant/shell";
import { RoomWelcome } from "@/components/restaurant/room-welcome";

export const metadata: Metadata = { title: "Welcome", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * The QR card in a room opens here. The QR belongs to the room: the stay checked in to the
 * room right now is found on the server (today one guest, tomorrow the next). A guest staying
 * gets their stay page — room, bill, Wi-Fi, and the menu ordering to their room bill; when
 * nobody is checked in, the same restaurant app with the room on top (owner, 2026-10-04: one look everywhere).
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

  // Nobody checked in: the same restaurant app as a table or the main menu (one look everywhere) — the room on top,
  // then the menu to order at the restaurant or take out (nothing goes on a room bill without a stay).
  const room = scan?.room ?? null;
  const where = room ? (room.meeting ? "the meeting room" : `Room ${room.number}`) : null;
  const { brand, status } = restaurantShell(s);
  return (
    <RestaurantApp brand={brand} status={status} menu={await restaurantMenu()} canOrder={s.publicOrderingEnabled}
      place={{ kind: "public", table: null }} checkout={{ kind: "public", table: null, fromQr: true, payTo: await customerPayAccounts() }}
      top={<RoomWelcome room={room} info={scan?.info ?? null} hotel={s.hotelName}
        callHref={s.phone ? telHref(s.phone) : null} waHref={s.whatsapp ? whatsappHref(s.whatsapp, where ? `Hello, this is about ${where}.` : "Hello") : null} />} />
  );
}
