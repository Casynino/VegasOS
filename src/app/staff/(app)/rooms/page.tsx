import type { Metadata } from "next";
import Link from "next/link";
import { QrCode, Settings2, Tags } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { getRoomBoard } from "@/server/services/rooms";
import { accountOptions } from "@/server/services/payment-accounts";
import { billMenu } from "@/server/services/restaurant";
import { recentChargeItems } from "@/server/services/payments";
import { PageHeader } from "@/components/staff/page-header";
import { buttonVariants } from "@/components/ui/button";
import { RoomGrid } from "@/components/staff/rooms/room-grid";
import { roomGridPerms, roomQrInfo, watchesRooms } from "./room-page-data";
import { RoomDialog } from "./manage/dialogs";
import { db } from "@/server/db";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Rooms") };
}

export default async function RoomsPage() {
  const user = await requirePagePermission("rooms.view");
  const t = await getT();
  const today = await businessToday();
  const canOrder = can(user, "restaurant.orders");
  const canAdd = can(user, "rooms.manage");
  const [rooms, methods, menu, recent, qr, types] = await Promise.all([
    getRoomBoard(today),
    accountOptions("payments"),
    canOrder ? billMenu() : null,
    can(user, "payments.record") ? recentChargeItems() : [],
    roomQrInfo(),
    canAdd ? db.roomType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  return (
    <div className="w-full">
      <PageHeader
        title={t("Rooms")}
        description={watchesRooms(user)
          ? t("Every room at a glance — tap one to see who is in it, the bill and its history. Your decisions are on each room: move a guest, close or open a room, release a no-show's room. Reception runs the rest.")
          : t("Every room at a glance. Click a room to check in or out, open the stay, or update housekeeping.")}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href="/staff/rooms/qr" className={buttonVariants({ variant: "outline" })}><QrCode /> {t("Room QR codes")}</Link>
            {canAdd && (
              <Link href="/staff/rooms/manage" className={buttonVariants({ variant: "outline" })}>
                <Settings2 /> {t("Room types & inventory")}
              </Link>
            )}
            {can(user, "pricing.manage") && (
              <Link href="/staff/settings/pricing" className={buttonVariants({ variant: "outline" })}>
                <Tags /> {t("Room pricing")}
              </Link>
            )}
            {canAdd && <RoomDialog types={types.map((rt) => ({ id: rt.id, name: t(rt.name) }))} />}
          </div>
        )}
      />
      <RoomGrid rooms={rooms} today={today} methods={methods} menu={menu} recent={recent} qr={qr} perms={await roomGridPerms(user)} />
    </div>
  );
}
