import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, CalendarRange, CheckCheck, CircleDashed, Clock, FileText, AlertTriangle, Users } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessDayConfig, getSettings } from "@/server/settings";
import { businessDateOf, businessRangeBounds, fromDbDate, addDays } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sendingNow } from "@/server/services/report-delivery";
import { lastCompleted, periodLabel, periodOf, type PersonPeriodData, type TeamPeriodData } from "@/server/services/staff-report";
import { factLine, type ShiftReportData } from "@/server/services/shift-report";
import { MakePeriodReportButton } from "./buttons";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Staff reports") };
}
export const dynamic = "force-dynamic";

const dur = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const minutes = (xs: { startedAt: Date; endedAt: Date | null }[], now: Date) => xs.reduce((t, x) => t + Math.max(0, Math.round(((x.endedAt ?? now).getTime() - x.startedAt.getTime()) / 60000)), 0);
const first = (n: string) => n.replace(/\s*\(.*\)/, "");

/**
 * STAFF REPORTS — every shift's report, and each week's and month's. Staff see only their own: their shift reports,
 * their weekly and monthly reports, and their week and month so far. Managers, the MD and the owner see everyone, the
 * weekly / monthly report the boss receives (the business and the team), and can download any of them.
 */
export default async function StaffReportsPage() {
  const user = await requirePagePermission("shifts.view", "restaurant.shift", "shifts.manage", "reports.view");
  const manager = can(user, "shifts.manage") || can(user, "reports.view");
  const [s, t] = await Promise.all([getSettings(), getT()]);
  const cfg = businessDayConfig(s);
  const dayMonth = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(t.intl, { day: "numeric", month: "short", timeZone: "UTC" });
  const now = new Date();
  const today = businessDateOf(now, cfg);
  const week = periodOf("WEEK", today), month = periodOf("MONTH", today);
  const weekStart = businessRangeBounds(week.from, week.to, cfg).start, monthStart = businessRangeBounds(month.from, month.to, cfg).start;
  const mine = manager ? {} : { userId: user.id };

  const [weekShifts, monthShifts, reports, shifts] = await Promise.all([
    db.actualShift.findMany({ where: { ...mine, startedAt: { gte: weekStart } }, select: { userId: true, startedAt: true, endedAt: true } }),
    db.actualShift.findMany({ where: { ...mine, startedAt: { gte: monthStart } }, select: { userId: true, startedAt: true, endedAt: true } }),
    db.staffReport.findMany({
      where: manager ? { userId: null } : { userId: user.id }, orderBy: { fromDate: "desc" }, take: 30,
      select: { id: true, kind: true, fromDate: true, toDate: true, data: true, generatedAt: true, deliveries: { select: { status: true, sentAt: true, claimedAt: true } } },
    }),
    db.actualShift.findMany({
      where: { ...mine, endedAt: { not: null } }, orderBy: { startedAt: "desc" }, take: manager ? 16 : 12,
      select: { id: true, department: true, businessDate: true, startedAt: true, endedAt: true, user: { select: { fullName: true } }, report: { select: { id: true, data: true } } },
    }),
  ]);
  const lastWeek = lastCompleted("WEEK", today), lastMonth = lastCompleted("MONTH", today);
  const has = (kind: string, from: string) => reports.some((r) => r.kind === kind && fromDbDate(r.fromDate) === from);
  const weekly = reports.filter((r) => r.kind === "WEEK"), monthly = reports.filter((r) => r.kind === "MONTH");

  // Managers: who worked in the last 5 weeks, with their latest shift.
  const people = manager ? await db.actualShift.groupBy({ by: ["userId", "department"], where: { startedAt: { gte: businessRangeBounds(addDays(today, -35), today, cfg).start } }, _count: true, _max: { startedAt: true } }) : [];
  const users = people.length ? await db.user.findMany({ where: { id: { in: [...new Set(people.map((p) => p.userId))] } }, select: { id: true, fullName: true, role: { select: { name: true } } } }) : [];
  const who = new Map(users.map((u) => [u.id, u]));
  const byPerson = [...new Set(people.map((p) => p.userId))].map((id) => {
    const rows = people.filter((p) => p.userId === id);
    const main = rows.reduce((b, r) => (r._count > b._count ? r : b), rows[0]);
    return { id, name: who.get(id)?.fullName ?? t("Staff"), role: who.get(id)?.role.name ?? "", department: main.department, shifts: rows.reduce((t, r) => t + r._count, 0), last: rows.reduce((m, r) => (r._max.startedAt && (!m || r._max.startedAt > m) ? r._max.startedAt : m), null as Date | null) };
  }).sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));

  const so = (label: string, kind: "WEEK" | "MONTH", range: { from: string; to: string }, xs: typeof weekShifts) => {
    const people = new Set(xs.map((x) => x.userId)).size;
    return (
      <Link href={`/staff/reports/staff/live?kind=${kind}`} className="group relative overflow-hidden rounded-3xl border border-border/70 bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.6)]">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-[oklch(0.75_0.12_80)]/10 blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-[oklch(0.75_0.12_80)]/15 text-[oklch(0.6_0.11_78)] dark:text-[#f0cf86]">{kind === "WEEK" ? <CalendarDays className="size-5" /> : <CalendarRange className="size-5" />}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-500" />{t("So far")}</span>
        </div>
        <p className="relative mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="relative text-lg font-semibold">{periodLabel(kind, range.from, range.to, t)}</p>
        <div className="relative mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span><strong className="text-xl font-semibold tabular-nums">{xs.length}</strong> <span className="text-muted-foreground">{xs.length === 1 ? t("shift") : t("shifts")}</span></span>
          <span><strong className="text-xl font-semibold tabular-nums">{dur(minutes(xs, now))}</strong> <span className="text-muted-foreground">{t("on shift")}</span></span>
          {manager && <span><strong className="text-xl font-semibold tabular-nums">{people}</strong> <span className="text-muted-foreground">{people === 1 ? t("person") : t("people")}</span></span>}
        </div>
        <p className="relative mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[oklch(0.55_0.11_76)] dark:text-[#f0cf86]">{manager ? t("Open the business & team so far") : t("Open my report so far")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></p>
      </Link>
    );
  };

  const reportRow = (r: (typeof reports)[number]) => {
    const team = manager ? (r.data as unknown as TeamPeriodData) : null;
    const person = manager ? null : (r.data as unknown as PersonPeriodData);
    const sent = r.deliveries.some((d) => d.status === "SENT" && d.sentAt && d.sentAt >= r.generatedAt);
    const failed = r.deliveries.some((d) => d.status === "FAILED");
    const sending = r.deliveries.some((d) => sendingNow(d, now));
    return (
      <li key={r.id}>
        <Link href={`/staff/reports/staff/${r.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-muted/50">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><FileText className="size-[18px]" /></span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-semibold">{periodLabel(r.kind as "WEEK" | "MONTH", fromDbDate(r.fromDate), fromDbDate(r.toDate), t)}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {team ? <>{team.business ? `${t("Revenue {amount}", { amount: formatTZS(team.business.revenue.total) })} · ` : ""}{t.plural(team.people.length, "{n} person", "{n} people")} · {t("{n} shifts", { n: team.people.reduce((sum, p) => sum + p.shifts, 0) })}</>
                : person ? <>{t.plural(person.totals.shifts, "{n} shift · {duration} on shift", "{n} shifts · {duration} on shift", { duration: dur(person.totals.minutes) })}</> : null}
            </span>
          </span>
          {manager && (
            <span className={cn("hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex", sent ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : failed ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground")}>
              {sent ? <CheckCheck className="size-3" /> : failed ? <AlertTriangle className="size-3" /> : <CircleDashed className={cn("size-3", sending && "animate-spin")} />}
              {sent ? t("Sent to the Boss") : failed ? t("Message failed") : sending ? t("Sending…") : t("Not sent")}
            </span>
          )}
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      </li>
    );
  };

  const list = (title: string, icon: React.ReactNode, xs: typeof reports, empty: string, make?: React.ReactNode) => (
    <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">{icon}{title}<span className="text-sm font-normal text-muted-foreground">({xs.length})</span></h2>
        {make}
      </div>
      {xs.length === 0 ? <p className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p> : <ul className="max-h-[26rem] space-y-0.5 overflow-y-auto overscroll-contain [scrollbar-width:thin]">{xs.map(reportRow)}</ul>}
    </section>
  );

  return (
    <div className="w-full space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card px-5 py-5 sm:px-6">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{manager ? t("Staff & business reports") : t("My reports")}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{manager ? t("Every shift, every week, every month") : t("Your work, {name}", { name: first(user.fullName).split(" ")[0] })}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {manager
            ? t("A report is made when each shift ends, every Monday for the week and on the 1st for the month — the Boss gets each one on WhatsApp with its link. Open, print or download any of them.")
            : t("Your shift reports, and your week and month — counted from your own records. Only you and the managers see them.")}
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {so(t("This week"), "WEEK", week, weekShifts)}
        {so(t("This month"), "MONTH", month, monthShifts)}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {list(t("Weekly reports"), <CalendarDays className="size-4 text-muted-foreground" />, weekly, manager ? t("The first weekly report is made next Monday morning.") : t("Your first weekly report is made next Monday."),
          manager && !has("WEEK", lastWeek.from) ? <MakePeriodReportButton kind="WEEK" label={t("Make last week's report")} className="h-8 text-xs" /> : undefined)}
        {list(t("Monthly reports"), <CalendarRange className="size-4 text-muted-foreground" />, monthly, manager ? t("The first monthly report is made on the 1st.") : t("Your first monthly report is made on the 1st."),
          manager && !has("MONTH", lastMonth.from) ? <MakePeriodReportButton kind="MONTH" label={t("Make {month}'s report", { month: t.locale === "en" ? periodLabel("MONTH", lastMonth.from, lastMonth.to).split(" ")[0] : periodLabel("MONTH", lastMonth.from, lastMonth.to, t) })} className="h-8 text-xs" /> : undefined)}
      </div>

      {manager && byPerson.length > 0 && (
        <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Users className="size-4 text-muted-foreground" />{t("Each person")}<span className="text-sm font-normal text-muted-foreground">· {t("worked in the last 5 weeks")}</span></h2>
          {(["RECEPTION", "RESTAURANT"] as const).filter((k) => byPerson.some((p) => p.department === k)).map((k) => (
          <div key={k} className="mt-3 first:mt-0">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{k === "RECEPTION" ? t("Reception") : t("Restaurant & bar")}</p>
          <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {byPerson.filter((p) => p.department === k).map((p) => (
              <li key={p.id} className="rounded-2xl border border-border/70 p-3.5">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-[#f0cf86] to-[#b0863a] text-xs font-bold text-[#1b1611]">{first(p.name).split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t(p.role)} · {t.plural(p.shifts, "{n} shift", "{n} shifts")}{p.last ? ` · ${t("last {date}", { date: dayMonth(businessDateOf(p.last, cfg)) })}` : ""}</span>
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <Link href={`/staff/reports/staff/live?kind=WEEK&user=${p.id}`} className="flex-1 rounded-xl bg-muted/60 px-3 py-1.5 text-center text-xs font-semibold hover:bg-muted">{t("This week")}</Link>
                  <Link href={`/staff/reports/staff/live?kind=MONTH&user=${p.id}`} className="flex-1 rounded-xl bg-muted/60 px-3 py-1.5 text-center text-xs font-semibold hover:bg-muted">{t("This month")}</Link>
                </div>
              </li>
            ))}
          </ul>
          </div>
          ))}
        </section>
      )}

      <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Clock className="size-4 text-muted-foreground" />{manager ? t("Latest shift reports") : t("My shift reports")}</h2>
          <Link href="/staff/shifts/all" className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted">{manager ? t("All shifts") : t("All my shifts")}</Link>
        </div>
        {shifts.length === 0 ? <p className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">{t("Shift reports show here once a shift has ended.")}</p> : (
          <ul className="grid gap-1 md:grid-cols-2">
            {shifts.map((x) => {
              const d = x.report?.data as unknown as ShiftReportData | undefined;
              const clock = (x: Date) => t.time(x, s.timezone);
              return (
                <li key={x.id}>
                  <Link href={x.report ? `/staff/shifts/${x.id}/report` : `/staff/shifts/${x.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-muted/50">
                    <span className="grid h-11 w-12 shrink-0 place-content-center rounded-xl bg-muted text-center leading-none"><span className="text-base font-semibold tabular-nums">{Number(fromDbDate(x.businessDate).slice(8))}</span><span className="mt-0.5 text-[10px] font-medium uppercase text-muted-foreground">{new Date(`${fromDbDate(x.businessDate)}T12:00:00Z`).toLocaleDateString(t.intl, { month: "short", timeZone: "UTC" })}</span></span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{manager ? x.user.fullName : x.department === "RESTAURANT" ? t("Restaurant shift") : t("Reception shift")} <span className="font-normal text-muted-foreground">· {clock(x.startedAt)} → {x.endedAt ? clock(x.endedAt) : ""}</span></span>
                      <span className="block truncate text-xs text-muted-foreground">{d?.headline?.length ? d.headline.slice(0, 3).map((f) => factLine(f, t)).join(" · ") : x.report ? t("No recorded activity") : t("Report not made yet")}</span>
                    </span>
                    <span className={cn("shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold", x.report ? "bg-[oklch(0.75_0.12_80)]/15 text-[oklch(0.5_0.1_75)] dark:text-[#f0cf86]" : "bg-muted text-muted-foreground")}>{x.report ? t("Report") : t("Shift")}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="text-center text-[11px] text-muted-foreground">{t("Reports count what was recorded in the system — facts, never a score. Updated {time}.", { time: t.dateTime(now, s.timezone) })}</p>
    </div>
  );
}
