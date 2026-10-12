import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { can, requirePagePermission } from "@/server/auth";
import { businessDayConfig, getSettings } from "@/server/settings";
import { getT } from "@/i18n/server";
import { businessDateOf, isBusinessDate } from "@/lib/time/business-date";
import { listKindOf, type ListKind } from "@/lib/daily-lists";
import { buildDailyList, getDailyListCopy, listDailyListCopies } from "@/server/services/daily-lists";
import { PageHeader } from "@/components/staff/page-header";
import { ListWorkspace } from "@/components/staff/lists/list-workspace";
import { watchesRooms } from "../../rooms/room-page-data";

export const metadata: Metadata = { title: "Daily guest & room lists" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PERMISSION = { HOUSEKEEPING: "rooms.view", GUESTS: "reservations.view" } as const satisfies Record<ListKind, string>;

/**
 * Daily Guest & Room Lists — the Housekeeping Checklist and the In-House Guest & Breakfast List, to preview, print
 * and save. Today's list is read live from the rooms and bookings; an earlier day shows the copies printed then.
 */
export default async function DailyListPage({ params, searchParams }: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ kind: slug }, sp] = await Promise.all([params, searchParams]);
  const kind = listKindOf(slug);
  if (!kind) notFound();
  const user = await requirePagePermission("dashboard.front_desk");
  if (!can(user, PERMISSION[kind])) redirect("/staff/forbidden");

  const [settings, t] = await Promise.all([getSettings(), getT()]);
  const now = new Date();
  const today = businessDateOf(now, businessDayConfig(settings));

  // A printed copy asked for by its link — only one of this list.
  const copyId = one(sp.copy);
  const asked = copyId ? await getDailyListCopy(copyId) : null;
  let copy = asked?.kind === kind ? asked : null;

  const picked = one(sp.date);
  const date = copy ? copy.date : picked && isBusinessDate(picked) && picked <= today ? picked : today;
  const copies = await listDailyListCopies(date, kind);
  // An earlier day is never rebuilt from today's rooms: it opens on the last copy printed that day.
  if (!copy && date !== today && copies.length) copy = await getDailyListCopy(copies[0].id);
  const live = !copy && date === today ? await buildDailyList(kind, now) : null;

  const tabs = (["HOUSEKEEPING", "GUESTS"] as const).filter((k) => can(user, PERMISSION[k]));
  const hotel = {
    name: settings.hotelName,
    address: [settings.postalAddress, settings.addressLine, settings.city, settings.country].filter(Boolean).join(", "),
    contact: [settings.phone, settings.email, settings.website].filter(Boolean).join("  ·  "),
  };

  return (
    <div className="mx-auto w-full max-w-[1560px]">
      <div className="print:hidden">
        <PageHeader eyebrow={t("Reception")} title={t("Daily guest & room lists")}
          description={t("Print the housekeeping checklist and the in-house guest & breakfast list. Both are read from the rooms and bookings as they are now.")} />
      </div>
      <ListWorkspace key={copy?.id ?? `live-${date}`} kind={kind} today={today} date={date} live={live} copy={copy} copies={copies} hotel={hotel} tabs={tabs}
        canTick={can(user, "rooms.status.update") && !watchesRooms(user)} />
    </div>
  );
}
