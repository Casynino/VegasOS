import type { Metadata } from "next";
import Link from "next/link";
import { Clock9, MessageSquareText } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { formatDateTime, formatShortDate, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DailyReportData } from "@/server/services/daily-report";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { FinanceTabs } from "@/components/staff/finance/finance-nav";
import { GenerateReportButton } from "./report-buttons";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Daily reports") };
}

export default async function DailyReportsPage() {
  const user = await requirePagePermission("reports.view");
  const [today, t] = await Promise.all([businessToday(), getT()]);
  const reports = await db.dailyReport.findMany({ orderBy: { businessDate: "desc" }, take: 60, include: { deliveries: true } });
  const todays = reports.find((r) => r.businessDate.toISOString().slice(0, 10) === today);
  const make = can(user, "reports.daily.manage") && !todays && <GenerateReportButton date={today} label={t("Make today's now")} variant="outline" className="h-9 text-xs" />;
  return (
    <div className="w-full space-y-4">
      {can(user, "finance.view") ? <FinanceTabs active="/staff/reports/daily" actions={make} /> : (
        <PageHeader eyebrow={t("Automation")} title={t("Daily business reports")} description={t("Made automatically every day at 21:00 and sent to the Boss by WhatsApp. Kept here as a record.")} actions={make} />
      )}

      {/* How it works, and today's */}
      <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-border/70 bg-card px-4 py-3.5 sm:px-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[oklch(0.72_0.12_80/0.16)] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.11_82)]"><Clock9 className="size-5" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">{t("Made automatically at 21:00, every day")}</p>
          <p className="text-xs text-muted-foreground">{t("Nobody needs to make it: the system builds the day's report (hotel day 04:00 → 04:00), keeps it here and sends the summary to the Boss.")}</p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", todays ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>{todays ? t("Today's report is ready") : t("Today's comes at 21:00")}</span>
      </section>

      {reports.length === 0 ? (
        <EmptyState icon={<MessageSquareText />} title={t("No reports yet")} description={t("The first report is made automatically tonight at 21:00.")} />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/70 bg-card">
          {reports.map((r) => {
            const d = r.data as unknown as DailyReportData;
            const date = r.businessDate.toISOString().slice(0, 10);
            const sent = r.deliveries.some((x) => x.status === "SENT" && x.sentAt && x.sentAt >= r.generatedAt);
            const failed = !sent && r.deliveries.some((x) => x.status === "FAILED");
            return (
              <li key={r.id}>
                <Link href={`/staff/reports/daily/${r.id}`} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[3.25rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:px-5">
                  <span className="grid h-12 place-items-center rounded-2xl bg-muted/60 text-center leading-none">
                    <span><span className="block text-[10px] uppercase text-muted-foreground">{new Date(`${date}T00:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", timeZone: "UTC" })}</span><span className="text-lg font-semibold tabular-nums">{Number(date.slice(8))}</span></span>
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block font-medium tabular-nums">{t.locale === "en" ? formatShortDate(date) : t.shortDate(date)}{r.version > 1 && <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">v{r.version}</span>}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.automatic ? t("Automatic") : r.generatedBy} · {t.locale === "en" ? formatDateTime(r.generatedAt) : t.dateTime(r.generatedAt)}</span>
                  </span>
                  <span className="hidden min-w-0 leading-tight sm:block"><span className="block text-[11px] text-muted-foreground">{t("Revenue")}</span><span className="font-semibold tabular-nums">{formatTZS(d.revenue.total)}</span></span>
                  <span className="hidden min-w-0 leading-tight sm:block"><span className="block text-[11px] text-muted-foreground">{t("Collected")}</span><span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatTZS(d.money.collected)}</span></span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", sent ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : failed ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground")}>{sent ? t("Sent") : failed ? t("Failed") : t("Not sent")}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
