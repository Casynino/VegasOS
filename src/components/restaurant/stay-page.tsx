import type { HotelSettings } from "@/generated/prisma/client";
import type { GuestStay } from "@/server/services/guest-comms";
import { restaurantMenu } from "@/server/services/online-orders";
import { customerPayAccounts } from "@/server/services/payment-accounts";
import { formatTime } from "@/lib/format";
import { formatMinutes } from "@/lib/time/business-date";
import { prettyPhone } from "@/lib/guest-messages";
import { telHref, whatsappHref } from "@/components/public/contact";
import { RestaurantApp } from "./restaurant-app";
import { restaurantShell } from "./shell";
import { StayBottom, StayTop, type StayInfo } from "./stay-app";

/** A room photo for the welcome: the meeting room, a suite, or a guest room. */
const photoFor = (meeting: boolean, types: string) =>
  meeting ? "/images/illustrative/meeting-room.webp" : /suite|executive/i.test(types) ? "/images/room-red/room-red-07.webp" : "/images/room-red/room-red-05.webp";

/**
 * A guest's page — from the link in their booking / welcome message, or the QR card in their
 * room. The restaurant app's look: their stay on top (room, dates, bill, Wi-Fi, reception),
 * the menu right below (ordering to the room bill while they are staying), then the hotel.
 */
export async function StayPage({ stay, s, target, via }: {
  stay: GuestStay; s: HotelSettings; target: { kind: "stay" | "room"; token: string }; via?: "room";
}) {
  const inHouse = stay.status === "CHECKED_IN";
  const meeting = stay.kind === "MEETING";
  const rooms = stay.rooms.filter((r) => !inHouse || r.inHouse);
  const room = rooms.map((r) => r.number).join(", ");
  const types = [...new Set(rooms.map((r) => r.type))].join(" · ");
  const first = stay.guestName.split(/\s+/)[0] ?? "";
  const phone = s.whatsapp || s.phone;
  const info: StayInfo = {
    hotel: s.hotelName,
    billHref: target.kind === "room" ? `/r/${target.token}/bill` : `/stay/${target.token}/bill`,
    via: via ?? null,
    room, types, meeting, photo: stay.roomInfo?.photos[0] ?? photoFor(meeting, types), fee: s.roomServiceFee,
    photos: stay.roomInfo?.photos.length ? stay.roomInfo.photos : [photoFor(meeting, types)],
    about: stay.roomInfo?.description ?? null, bed: stay.roomInfo?.bed ?? null, size: stay.roomInfo?.size ?? null, amenities: stay.roomInfo?.amenities ?? [],
    nights: stay.rooms.reduce((m, r) => Math.max(m, r.nights), 0),
    when: meeting && stay.meeting
      ? { inLabel: "Starts", inTime: formatTime(stay.meeting.start, s.timezone), outLabel: "Ends", outTime: formatTime(stay.meeting.end, s.timezone), outDate: stay.arrival }
      : { inLabel: "Check-in", inTime: `from ${formatMinutes(s.standardCheckInMinutes)}`, outLabel: "Check-out", outTime: `by ${formatMinutes(s.checkoutMinutes)}`, outDate: stay.departure },
    callHref: s.phone ? telHref(s.phone) : null,
    waHref: s.whatsapp ? whatsappHref(s.whatsapp, `Hello, this is ${first} (booking ${stay.reference}).`) : null,
    phoneLabel: phone ? prettyPhone(phone) : null,
    wifi: inHouse && !meeting ? { network: s.wifiNetwork || null, password: s.wifiPassword || null } : null,
    hours: [
      s.breakfastHours && { label: "Breakfast", value: s.breakfastHours },
      s.restaurantHours && { label: "Restaurant", value: s.restaurantHours },
      s.barHours && { label: "Bar", value: s.barHours },
      { label: "Reception", value: s.receptionHours || "24 hours" },
    ].filter((h): h is { label: string; value: string } => !!h),
    address: [s.addressLine, s.city].filter(Boolean).join(", ") || null,
    mapHref: s.mapUrl || null,
    ask: inHouse && !meeting ? target : null,
  };
  const { status } = restaurantShell(s);
  return (
    <RestaurantApp brand={{ name: s.hotelName, hotel: s.hotelName, tagline: meeting ? "Your meeting" : inHouse ? "Your stay" : "Your booking" }}
      status={status} menu={await restaurantMenu()} canOrder={stay.canOrder}
      place={{
        kind: "room", room: room || "—", guest: first, meeting, fee: s.roomServiceFee, stayHref: info.billHref,
        orders: stay.orders.map((o) => ({ number: o.number, status: o.status, total: o.total, track: o.track })),
      }}
      checkout={{ kind: "room", target, where: meeting ? "the meeting room" : `Room ${room}`, guest: first, payTo: await customerPayAccounts() }}
      top={<StayTop key="stay-top" stay={stay} info={info} />}
      bottom={<StayBottom key="stay-bottom" stay={stay} info={info} />} />
  );
}
