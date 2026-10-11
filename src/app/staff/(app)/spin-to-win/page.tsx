import type { Metadata } from "next";
import QRCode from "qrcode";
import { can, requirePagePermission } from "@/server/auth";
import { siteOrigin } from "@/server/site-origin";
import { getSettings } from "@/server/settings";
import { spinBoard, spinGiftList, spinQrCodes } from "@/server/services/spin";
import { getT } from "@/i18n/server";
import { SpinBoard } from "./spin-board";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Spin to Win") };
}
export const dynamic = "force-dynamic";

const svg = (url: string) => QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "H", color: { dark: "#0b1026", light: "#00000000" } });

/**
 * Spin to Win for staff: the switch and the numbers, which menu items are gifts, every room's own card, and what was
 * given — kept apart from the hotel's income. The Admin changes; managers and the MD follow.
 */
export default async function SpinToWinPage() {
  const user = await requirePagePermission("spin.manage", "reports.view");
  const t = await getT();
  const [board, rooms, gifts, origin, hotel] = await Promise.all([spinBoard(), spinQrCodes(), spinGiftList(), siteOrigin(), getSettings()]);
  const cards = await Promise.all(rooms.filter((r) => r.qr).map(async (r) => {
    const url = `${origin}/spin/${r.qr!.token}`;
    return {
      id: r.id, number: r.number, type: t(r.type), tier: r.tier, url, qr: await svg(url), active: r.qr!.active, scans: r.qr!.scanCount,
      lastScan: r.qr!.lastScannedAt?.toISOString() ?? null, guest: r.guest ? r.guest.split(/\s+/)[0] : null,
      used: r.session?.spinsUsed ?? null, allowed: r.session?.spinsAllowed ?? null,
    };
  }));
  return (
    <SpinBoard
      canManage={can(user, "spin.manage")}
      settings={board.settings} running={board.running} today={board.today}
      given={board.given} giftsNow={board.gifts.length}
      types={board.types.map((x) => ({ ...x, name: t(x.name) }))}
      gifts={gifts}
      recent={board.recent.map((r) => ({
        id: r.id, at: r.createdAt.toISOString(), spin: r.spinNumber, of: r.session.spinsAllowed, name: r.name, value: r.value, where: r.fulfilment,
        room: r.session.roomNumber, guest: r.session.guestName, order: r.order?.number ?? null, status: r.order?.status ?? null,
      }))}
      unclaimed={board.unclaimed.map((u) => ({ id: u.id, at: u.createdAt.toISOString(), name: u.name, room: u.session.roomNumber, guest: u.session.guestName }))}
      noGift={board.noGift.map((n) => ({ id: n.id, at: n.at.toISOString(), room: n.room ?? null, guest: n.guest ?? null }))}
      cards={cards} hotel={hotel.hotelName}
    />
  );
}
