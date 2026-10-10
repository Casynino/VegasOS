import { BedDouble } from "lucide-react";
import type { InHouseBalances } from "@/server/services/guest-balances";
import type { getRoomBoard } from "@/server/services/rooms";
import { GuestsOwing } from "@/components/staff/reception/guests-owing";
import { RoomGrid } from "@/components/staff/rooms/room-grid";
import { getT } from "@/i18n/server";
import { Panel, PanelLink, SectionLabel } from "./kit";

/**
 * On the manager's and the MD's home, near the top: every room right now — to watch, not to work
 * (no check-in, booking or payment buttons: reception runs the rooms). Tap a room to see it.
 */
export async function RoomsOnHome({ today, rooms, discountMax }: { today: string; rooms: Awaited<ReturnType<typeof getRoomBoard>>; discountMax: number }) {
  const t = await getT();
  return (
    <Panel title={<span className="flex items-center gap-2"><BedDouble className="size-4 text-muted-foreground" />{t("Every room right now")}</span>}
      subtitle={t("Live · tap a room to see who is in it, their bill and its history — or send it for maintenance")} action={<PanelLink href="/staff/finance/rooms">{t("Room performance")}</PanelLink>}>
      <RoomGrid rooms={rooms} today={today}
        perms={{ transport: false, order: false, orderPayNow: false, pay: false, update: true, block: true, maintenanceOnly: true, checkIn: false, checkOut: false, book: true, discount: false, discountMax: 0, move: true, release: true, decide: { discountMax } }} />
    </Panel>
  );
}

/** At the bottom of the manager's and the MD's home: the guests staying who still owe (view only). */
export async function GuestsOwingOnHome({ balances }: { balances: InHouseBalances }) {
  const t = await getT();
  return (
    <div>
      <SectionLabel title={t("Guests owing")} count={balances.summary.owingCount} href="/staff/shifts" linkLabel={t("Shift handover")} t={t} />
      <GuestsOwing b={balances} canPay={false} show={3} />
    </div>
  );
}
