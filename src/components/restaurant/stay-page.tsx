import type { HotelSettings } from "@/generated/prisma/client";
import type { GuestStay } from "@/server/services/guest-comms";
import { restaurantMenu } from "@/server/services/online-orders";
import { onlinePayAvailable, stayBillPayOnline } from "@/server/services/online-pay";
import { guestRequestNotes } from "@/server/services/room-qr-page";
import { payRoomBillOnlineAction } from "@/app/r/[token]/actions";
import { payStayBillOnlineAction } from "@/app/stay/[token]/actions";
import { formatTime } from "@/lib/format";
import { formatMinutes, localCalendarDate } from "@/lib/time/business-date";
import { requestLabel } from "@/components/room-qr/asks";
import { hotelInfo } from "@/components/room-qr/contact";
import { MEETING_PHOTO, realPhotos, ROOM_PHOTO, SUITE_PHOTO } from "@/components/room-qr/photos";
import { RestaurantApp } from "./restaurant-app";
import { restaurantShell } from "./shell";
import { StayBottom, StayTop, type StayInfo } from "./stay-app";

/** A room photo when the room type has none of its own: the meeting room, a suite, or a guest room. */
const photoFor = (meeting: boolean, types: string) => (meeting ? MEETING_PHOTO : /suite|executive/i.test(types) ? SUITE_PHOTO : ROOM_PHOTO);

/**
 * The guest's page — from the link in their booking / welcome message, or the QR card in their room — "Your room" in
 * the Hotel QR app's calm look: their room on top (photos, welcome, dates, one gold button), the bill and their orders,
 * what they can ask for the room, then the menu (ordering to the room bill while they are staying), then the hotel.
 * The room QR shows the stay checked in to that room now, by first name only.
 */
export async function StayPage({ stay, s, target, via }: {
  stay: GuestStay; s: HotelSettings; target: { kind: "stay" | "room"; token: string }; via?: "room";
}) {
  const inHouse = stay.status === "CHECKED_IN";
  const meeting = stay.kind === "MEETING";
  const rooms = stay.rooms.filter((r) => !inHouse || r.inHouse);
  const room = rooms.map((r) => r.number).join(", ");
  const types = [...new Set(rooms.map((r) => r.type))].join(" · ");
  // First name only, written normally ("HONEST" → "Honest").
  const raw = stay.guestName.split(/\s+/)[0] ?? "";
  const first = /^[A-Z]{2,}$/.test(raw) ? raw[0] + raw.slice(1).toLowerCase() : raw;
  const ask = inHouse && !meeting ? target : null;
  // The room card: anyone in the room can scan it, so the page gets only what the card shows — the first name, no
  // booking reference, phone, email or company (they would otherwise travel in the page's data).
  const shown: GuestStay = via === "room" ? { ...stay, guestName: first, reference: "", phone: null, email: null, company: null } : stay;

  const [menu, online, bill, notes] = await Promise.all([
    restaurantMenu(), onlinePayAvailable("roomService", s),
    stayBillPayOnline(target.kind === "room" ? { roomQrToken: target.token } : { guestToken: target.token }),
    ask ? guestRequestNotes(stay.requests.map((q) => q.id)) : Promise.resolve({} as Record<string, string>),
  ]);

  const info: StayInfo = {
    hotel: s.hotelName,
    billHref: target.kind === "room" ? `/r/${target.token}/bill` : `/stay/${target.token}/bill`,
    via: via ?? null,
    room, types, meeting, fee: s.roomServiceFee,
    photos: realPhotos(stay.roomInfo?.photos ?? [], photoFor(meeting, types)),
    today: localCalendarDate(new Date(), s.timezone),
    nights: stay.rooms.reduce((m, r) => Math.max(m, r.nights), 0),
    checkInTime: formatMinutes(s.standardCheckInMinutes), checkoutTime: formatMinutes(s.checkoutMinutes), checkoutMinutes: s.checkoutMinutes,
    meetingTimes: meeting && stay.meeting ? { start: formatTime(stay.meeting.start, s.timezone), end: formatTime(stay.meeting.end, s.timezone) } : null,
    lateFee: s.lateCheckoutFee,
    wifi: inHouse && !meeting ? { network: s.wifiNetwork || null, password: s.wifiPassword || null } : null,
    ask,
    requests: stay.requests.map((q) => ({ id: q.id, label: requestLabel(q.type, notes[q.id]), status: q.status, at: q.at })),
    // The bill page's own payment: offered for what is owed now (or the one on its way), bound to this link / card.
    pay: bill.offered || bill.live
      ? { due: bill.due, live: bill.live, action: target.kind === "room" ? payRoomBillOnlineAction.bind(null, target.token) : payStayBillOnlineAction.bind(null, target.token) }
      : null,
    // The room card: no booking reference in the message (anyone in the room can scan it) — the room says who.
    contact: hotelInfo(s, via === "room" ? `Hello, this is ${first} in ${meeting ? "the meeting room" : `Room ${room}`}.` : `Hello, this is ${first} (booking ${stay.reference}).`),
    bookHref: "/book",
  };
  const { status } = restaurantShell(s);
  return (
    <RestaurantApp brand={{ name: s.hotelName, hotel: s.hotelName, tagline: meeting ? "Your meeting" : inHouse ? "Your room" : "Your booking" }}
      status={status} menu={menu} canOrder={stay.canOrder}
      place={{
        kind: "room", room: room || "—", guest: first, meeting, fee: s.roomServiceFee, stayHref: info.billHref,
        orders: stay.orders.map((o) => ({ number: o.number, status: o.status, total: o.total, track: o.track })),
      }}
      checkout={{ kind: "room", target, where: meeting ? "the meeting room" : `Room ${room}`, guest: first, online }}
      top={<StayTop key="stay-top" stay={shown} info={info} />}
      bottom={<StayBottom key="stay-bottom" stay={shown} info={info} />} />
  );
}
