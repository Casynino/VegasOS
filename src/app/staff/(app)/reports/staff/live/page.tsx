import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessDayConfig, getSettings } from "@/server/settings";
import { businessDateOf, businessRangeBounds } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";
import { buildBusinessPeriod, buildPersonPeriod, periodLabel, periodLabelOf, periodOf, renderPersonPeriodText, type TeamPeriodData } from "@/server/services/staff-report";
import { PersonPeriodPaper, TeamPeriodPaper, type Hotel } from "@/components/staff/reports/staff-report-paper";
import { ReportActions } from "../../report-actions";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("So far") };
}
export const dynamic = "force-dynamic";

/**
 * THE WEEK OR MONTH SO FAR — the same report as the one made when it ends, counted now. Staff see their own; managers,
 * the MD and the owner see anyone's, or the business and the whole team.
 */
export default async function LiveStaffReportPage({ searchParams }: PageProps<"/staff/reports/staff/live">) {
  const user = await requirePagePermission("shifts.view", "restaurant.shift", "shifts.manage", "reports.view");
  const manager = can(user, "shifts.manage") || can(user, "reports.view");
  const sp = await searchParams;
  const kind = sp.kind === "MONTH" ? "MONTH" : "WEEK";
  const asked = typeof sp.user === "string" && /^[a-z0-9]{10,40}$/i.test(sp.user) ? sp.user : null;
  if (asked && !manager && asked !== user.id) redirect("/staff/forbidden");
  const who = manager ? asked : user.id; // null = the team (managers only)
  const [s, t] = await Promise.all([getSettings(), getT()]);
  const cfg = businessDayConfig(s);
  const now = new Date();
  const today = businessDateOf(now, cfg);
  const { from } = periodOf(kind, today);
  const hotel: Hotel = {
    name: s.hotelName, tagline: s.tagline,
    address: [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", "),
    contact: [s.phone, s.email, s.website].filter(Boolean).join("  ·  "),
  };
  const what = kind === "WEEK" ? t("This week") : t("This month");
  const preparedAt = t.dateTime(now, s.timezone);
  const number = `${kind === "WEEK" ? "WR" : "MR"}-${from.replaceAll("-", "")}-LIVE`;
  const tab = (k: "WEEK" | "MONTH") => `/staff/reports/staff/live?kind=${k}${asked ? `&user=${asked}` : ""}`;

  let paper: React.ReactNode, title: string, share: string;
  if (who) {
    const built = await buildPersonPeriod(who, kind, from, today, { live: true });
    // Shown in the reader's words (counted now — nothing here is kept).
    const d = { ...built, label: periodLabelOf(built, t) };
    title = d.person.name;
    share = renderPersonPeriodText(d, s.hotelName, null, t).replace(/\*/g, "");
    paper = <PersonPeriodPaper d={d} hotel={hotel} number={number} preparedAt={preparedAt} timezone={s.timezone} shiftHref={(id, report) => (report ? `/staff/shifts/${id}/report` : `/staff/shifts/${id}`)} />;
  } else {
    const { start, end } = businessRangeBounds(from, today, cfg);
    const workers = await db.actualShift.findMany({ where: { startedAt: { gte: start, lt: end } }, distinct: ["userId"], select: { userId: true } });
    const [business, ...people] = await Promise.all([buildBusinessPeriod(kind, from, today), ...workers.map((w) => buildPersonPeriod(w.userId, kind, from, today, { live: true }))]);
    const d: TeamPeriodData = {
      v: 1, kind, from, to: today, label: t("{period} · so far", { period: periodLabel(kind, from, periodOf(kind, today).to, t) }), live: true, business,
      people: people.map((p) => ({ userId: p.person.id, name: p.person.name, role: p.person.role, department: p.department, reportId: "", token: "", shifts: p.totals.shifts, minutes: p.totals.minutes, headline: p.headline.slice(2, 6) }))
        .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name)),
    };
    title = t("The hotel & the team");
    share = `${t("{period} so far", { period: what })} · ${s.hotelName}`;
    paper = <TeamPeriodPaper d={d} hotel={hotel} number={number} preparedAt={preparedAt} personHref={(p) => `/staff/reports/staff/live?kind=${kind}&user=${p.userId}`} />;
  }

  return (
    <div className="w-full space-y-4">
      <style>{"@media print { @page { size: A4; margin: 8mm; } html, body, #staff-root { background: #fff !important; } }"}</style>
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card print:hidden">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link href={asked && manager ? `/staff/reports/staff/live?kind=${kind}` : "/staff/reports/staff"} aria-label={t("Back")} className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" /></Link>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("{period} so far · counted now", { period: what })}</p>
              <h1 className="text-xl font-semibold leading-tight tracking-tight">{title}</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">{kind === "WEEK" ? t("The full report is made automatically when the week ends.") : t("The full report is made automatically when the month ends.")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-border/70 p-0.5">
              {(["WEEK", "MONTH"] as const).map((k) => <Link key={k} href={tab(k)} className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", k === kind ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{k === "WEEK" ? t("This week") : t("This month")}</Link>)}
            </div>
            <ReportActions fileName={`${s.hotelName}-${kind === "WEEK" ? "this-week" : "this-month"}-${who ? title : "team"}`.replace(/[^\w]+/g, "-").toLowerCase()} share={share} />
          </div>
        </div>
      </section>
      {paper}
    </div>
  );
}
