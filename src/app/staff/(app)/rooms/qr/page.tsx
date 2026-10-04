import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowLeft } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { siteOrigin } from "@/server/site-origin";
import { roomQrCodes } from "@/server/services/room-qr";
import { ROOM_STATUS_META } from "@/lib/room-status";
import { buttonVariants } from "@/components/ui/button";
import { QrCards } from "./qr-cards";

export const metadata: Metadata = { title: "Room QR codes" };
export const dynamic = "force-dynamic";

const svg = (url: string) => QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "H", color: { dark: "#0b1026", light: "#00000000" } }); // H: the logo in the middle never stops it scanning

/**
 * A permanent QR card for every room (and the meeting room), plus the public menu QR.
 * A room's QR opens whoever is checked in to it at that moment — or the room and the menu
 * when it is free. Cards never need reprinting when guests or the menu change.
 */
export default async function RoomQrPage({ searchParams }: PageProps<"/staff/rooms/qr">) {
  // Everyone at the desk and in the restaurant can view, print and download cards; changing them is for managers.
  const user = await requirePagePermission("rooms.view", "restaurant.orders", "rooms.manage", "restaurant.menu");
  const print = (await searchParams).print;
  const [rooms, s, origin] = await Promise.all([roomQrCodes(), getSettings(), siteOrigin()]);
  const cards = await Promise.all(rooms.map(async (r) => {
    const url = `${origin}/r/${r.qrCode!.token}`;
    const guest = r.reservationRooms[0]?.reservation.guest.fullName ?? null;
    return {
      id: r.id, number: r.number, type: r.roomType.name, floor: r.floor, url, qr: await svg(url), meeting: r.roomType.category === "MEETING_ROOM",
      active: r.qrCode!.active, scans: r.qrCode!.scanCount, lastScan: r.qrCode!.lastScannedAt?.toISOString() ?? null,
      now: guest ? `In use · ${guest.split(/\s+/)[0]}` : ROOM_STATUS_META[r.status].label,
    };
  }));
  const publicUrl = `${origin}/order?qr=1`;
  return (
    <div className="w-full space-y-4">
      <Link href="/staff/rooms" className={buttonVariants({ variant: "ghost", size: "sm" }) + " print:hidden"}><ArrowLeft /> Rooms</Link>
      <QrCards cards={cards} hotel={s.hotelName} phone={s.phone} canManage={can(user, "rooms.manage") || can(user, "restaurant.menu")}
        publicCard={{ url: publicUrl, qr: await svg(publicUrl) }} origin={origin} autoPrint={typeof print === "string" ? print : null} />
    </div>
  );
}
