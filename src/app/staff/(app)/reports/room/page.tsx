import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, ExternalLink } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/staff/page-header";
import type { RoomReportData } from "@/server/services/room-report-data";
import { roomReportLink } from "@/server/services/room-report";
import { ROOM_REPORT_HOUR, ROOM_REPORT_MINUTE } from "@/server/services/room-report";
import { SendRoomReportByDateButton, RoomReportAdminButtons } from "../daily/report-buttons";

export const metadata: Metadata = { title: "Daily room reports" };
export const dynamic = "force-dynamic";

/** Daily Room Reports — every one made, its delivery status, the link, resend, regenerate and switch-off. */
export default async function RoomReportsPage() {
  const user = await requirePagePermission("reports.view");
  const manage = can(user, "reports.daily.manage");
  const [today, settings, reports] = await Promise.all([
    businessToday(), getSettings(),
    db.roomReport.findMany({ orderBy: { businessDate: "desc" }, take: 45 }),
  ]);
  const yesterday = addDays(today, -1);
  const anchors = await db.dailyReport.findMany({
    where: { businessDate: { in: reports.map((r) => r.businessDate) } },
    select: { businessDate: true, deliveries: { where: { purpose: "ROOM_REPORT" }, select: { status: true, sentAt: true, lastError: true, attempts: true, providerResponse: true } } },
  });
  const delivery = (d: Date) => anchors.find((a) => a.businessDate.getTime() === d.getTime())?.deliveries ?? [];
  const hh = `${String(ROOM_REPORT_HOUR).padStart(2, "0")}:${String(ROOM_REPORT_MINUTE).padStart(2, "0")}`;
  return (
    <div className="w-full space-y-4">
      <PageHeader eyebrow="Automation" title="Daily room reports" description={`Made automatically every day at ${hh} (${settings.timezone}) for the business day that just ended (04:00 → 04:00) and sent to the Boss by WhatsApp with a secure link to the full report. Kept here as a record.`}
        actions={manage ? <SendRoomReportByDateButton date={yesterday} className="h-9 text-xs" /> : undefined} />
      {reports.length === 0 ? (
        <p className="rounded-3xl border border-border/70 bg-card px-5 py-8 text-center text-sm text-muted-foreground">No room report yet. The first one is made automatically at {hh}{manage ? " — or send yesterday's now with the button above" : ""}.</p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/70 bg-card">
          {reports.map((r) => {
            const d = r.data as unknown as RoomReportData;
            const date = r.businessDate.toISOString().slice(0, 10);
            const dl = delivery(r.businessDate);
            const sent = dl.some((x) => x.status === "SENT" && x.sentAt && x.sentAt >= r.generatedAt);
            const failed = !sent && dl.find((x) => x.status === "FAILED");
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <span className="grid size-10 place-items-center rounded-2xl bg-muted/60 text-muted-foreground"><BedDouble className="size-5" /></span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="font-medium tabular-nums">{date}{r.version > 1 && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">v{r.version}</span>}{r.revokedAt && <span className="ml-1.5 rounded-full bg-rose-500/15 px-1.5 text-[10px] font-semibold text-rose-600">link off</span>}</p>
                  <p className="truncate text-xs text-muted-foreground">{d.perf.occupied}/{d.guestRooms} occupied · {d.perf.newSales} new · {d.perf.continuing} continuing · {d.perf.checkedOut} out · {formatTZS(d.money.expected)} new revenue</p>
                  {failed && <p className="truncate text-xs text-rose-600">{failed.lastError ?? "Not delivered"} (attempt {failed.attempts})</p>}
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", sent ? "bg-emerald-500/15 text-emerald-600" : failed ? "bg-rose-500/15 text-rose-600" : "bg-muted text-muted-foreground")}>{sent ? "Sent" : failed ? "Failed" : "Not sent"}</span>
                <Link href={roomReportLink(r.shareToken)} target="_blank" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted"><ExternalLink className="size-3.5" />Open</Link>
                {manage && <RoomReportAdminButtons date={date} sent={sent} revoked={!!r.revokedAt} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
