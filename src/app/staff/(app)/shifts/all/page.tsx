import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCheck, ChevronRight, CircleDashed, Clock, ConciergeBell, FileText, History, ShieldAlert, UtensilsCrossed } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { addDays, toDbDate, isBusinessDate } from "@/lib/time/business-date";
import { formatBusinessDate } from "@/lib/format";
import { shiftLabel } from "@/lib/shift-label";
import { cn } from "@/lib/utils";
import { shiftDuration } from "@/server/services/shift-report";

export const metadata: Metadata = { title: "Staff shifts" };
export const dynamic = "force-dynamic";

const DEPT = {
  RECEPTION: { label: "Reception", icon: ConciergeBell, tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  RESTAURANT: { label: "Restaurant", icon: UtensilsCrossed, tone: "bg-orange-500/12 text-orange-700 dark:text-orange-300" },
} as const;

/**
 * STAFF SHIFTS — who is working now and every shift that ended, for waiters and reception alike, each with the report
 * made automatically when it ended and whether it reached the boss. Managers, the MD and the owner see everyone; a
 * waiter sees their own. Reports are never made by hand here — the system makes them.
 */
export default async function StaffShiftsPage({ searchParams }: PageProps<"/staff/shifts/all">) {
  const user = await requirePagePermission("shifts.manage", "restaurant.shift", "shifts.view");
  const manager = can(user, "shifts.manage");
  const [sp, s, today] = await Promise.all([searchParams, getSettings(), businessToday()]);
  const dept: "RECEPTION" | "RESTAURANT" | null = sp.dept === "RECEPTION" || sp.dept === "RESTAURANT" ? sp.dept : null;
  const person = manager && typeof sp.person === "string" ? sp.person : manager ? null : user.id;
  const days = sp.days === "30" ? 30 : sp.days === "90" ? 90 : 7;
  const day = typeof sp.day === "string" && isBusinessDate(sp.day) ? sp.day : null;
  const from = day ?? addDays(today, -(days - 1));
  const to = day ?? today;
  const where = { ...(dept && { department: dept }), ...(person && { userId: person }) };

  const [open, rows, people] = await Promise.all([
    db.actualShift.findMany({ where: { ...where, endedAt: null }, orderBy: { startedAt: "asc" }, include: { user: { select: { id: true, fullName: true, role: { select: { name: true } } } } } }),
    db.actualShift.findMany({
      where: { ...where, endedAt: { not: null }, businessDate: { gte: toDbDate(from), lte: toDbDate(to) } }, orderBy: { startedAt: "desc" }, take: 300,
      include: {
        user: { select: { id: true, fullName: true, role: { select: { name: true } } } }, closedBy: { select: { id: true, fullName: true } },
        report: { select: { id: true, version: true, generatedAt: true, sendSkipped: true, deliveries: { select: { status: true, sentAt: true } } } },
      },
    }),
    manager ? db.user.findMany({ where: { actualShifts: { some: {} } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }) : Promise.resolve([]),
  ]);
  const now = new Date();
  const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: s.timezone }).format(d);
  const minutes = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  const sendState = (r: (typeof rows)[number]["report"]) => {
    if (!r) return "MISSING";
    const current = r.deliveries.filter((d) => d.sentAt && d.sentAt >= r.generatedAt && d.status === "SENT");
    return current.length ? "SENT" : r.deliveries.some((d) => d.status === "FAILED") ? "FAILED" : (r.sendSkipped && !r.deliveries.length) || !s.shiftReportEnabled ? "OFF" : "PENDING";
  };
  const endedToday = rows.filter((r) => r.businessDate.toISOString().slice(0, 10) === today);
  const failed = rows.filter((r) => sendState(r.report) === "FAILED").length;
  const sent = rows.filter((r) => sendState(r.report) === "SENT").length;
  const link = (p: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { dept, person: manager ? person : null, days: day ? null : String(days), day, ...p };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "days" && v === "7")) q.set(k, v);
    return `/staff/shifts/all${q.size ? `?${q}` : ""}`;
  };
  // Grouped by hotel day, newest first.
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.businessDate.toISOString().slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }

  return (
    <div className="w-full space-y-5">
      <header className="relative overflow-hidden rounded-3xl bg-[#15110c] text-white ring-1 ring-white/10">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-[oklch(0.75_0.13_80)]/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4 px-5 pb-4 pt-5 sm:px-6">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-[#f0cf86] ring-1 ring-white/10"><History className="size-6" /></span>
          <div className="min-w-[12rem] flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#f0cf86]">People</p>
            <h1 className="font-display text-[28px] font-semibold leading-tight">{manager ? "Staff shifts" : "My shifts"}</h1>
            <p className="mt-0.5 text-xs text-white/60">{manager ? "Who is working now, and every shift that ended — with the report made automatically for each." : "Your shifts and the report made when each one ended."}</p>
          </div>
        </div>
        <dl className="relative grid grid-cols-2 gap-px border-t border-white/10 bg-white/5 sm:grid-cols-4">
          {[
            { label: "On shift now", value: open.length, sub: open.length ? open.map((o) => o.user.fullName.split(" ")[0]).slice(0, 3).join(", ") : "nobody", tone: open.length ? "text-emerald-300" : "text-white/50" },
            { label: "Ended today", value: endedToday.length, sub: "hotel day 04:00 → 04:00", tone: "text-white" },
            { label: "Reports sent", value: sent, sub: `to the Boss · ${day ? formatBusinessDate(day) : `last ${days} days`}`, tone: "text-[#f0cf86]" },
            { label: "Messages failed", value: failed, sub: failed ? "tried again automatically" : "none", tone: failed ? "text-rose-300" : "text-white/50" },
          ].map((x) => (
            <div key={x.label} className="bg-[#15110c] px-5 py-3">
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50">{x.label}</dt>
              <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", x.tone)}>{x.value}</dd>
              <p className="truncate text-[11px] text-white/40">{x.sub}</p>
            </div>
          ))}
        </dl>
      </header>

      {/* Working now */}
      {open.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 px-1 text-sm font-semibold"><span className="size-2 animate-pulse rounded-full bg-emerald-500" />On shift now</h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {open.map((o) => {
              const D = DEPT[o.department];
              return (
                <li key={o.id}>
                  <Link href={`/staff/shifts/${o.id}`} className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] px-3.5 py-3 transition hover:border-emerald-500/60">
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", D.tone)}><D.icon className="size-5" /></span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{o.user.fullName}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{o.user.role.name} · since {clock(o.startedAt)} · {shiftDuration(minutes(o.startedAt, now))}</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card p-2 text-xs">
        <span className="inline-flex rounded-xl bg-muted p-0.5">
          {([[null, "Everyone"], ["RECEPTION", "Reception"], ["RESTAURANT", "Restaurant"]] as const).map(([v, l]) => (
            <Link key={l} href={link({ dept: v })} className={cn("rounded-lg px-3 py-1.5 font-semibold", dept === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</Link>
          ))}
        </span>
        <span className="inline-flex rounded-xl bg-muted p-0.5">
          {(["7", "30", "90"] as const).map((v) => (
            <Link key={v} href={link({ days: v, day: null })} className={cn("rounded-lg px-3 py-1.5 font-semibold", !day && String(days) === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{v} days</Link>
          ))}
        </span>
        {manager && people.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {person && <Link href={link({ person: null })} className="rounded-lg bg-[oklch(0.75_0.12_80)]/15 px-2.5 py-1.5 font-semibold">{people.find((p) => p.id === person)?.fullName ?? "Person"} ✕</Link>}
            {!person && people.slice(0, 12).map((p) => <Link key={p.id} href={link({ person: p.id })} className="rounded-lg px-2.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">{p.fullName.split(" ")[0]}</Link>)}
          </span>
        )}
        {day && <Link href={link({ day: null })} className="ml-auto rounded-lg bg-muted px-2.5 py-1.5 font-semibold">{formatBusinessDate(day)} ✕</Link>}
      </div>

      {rows.length === 0 ? (
        <div className="grid place-items-center rounded-3xl border border-dashed border-border/80 bg-card/40 px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground"><Clock className="size-7" /></span>
          <p className="mt-3 text-base font-semibold">No shift ended in this period</p>
          <p className="mt-1 text-sm text-muted-foreground">When someone ends their shift, it appears here with its report.</p>
        </div>
      ) : [...byDay.entries()].map(([d, list]) => (
        <section key={d} className="space-y-2">
          <h2 className="flex items-baseline gap-2 px-1">
            <span className="text-sm font-semibold">{d === today ? "Today" : formatBusinessDate(d)}</span>
            <span className="text-xs text-muted-foreground">· {list.length} shift{list.length === 1 ? "" : "s"} · {shiftDuration(list.reduce((t, r) => t + minutes(r.startedAt, r.endedAt!), 0))} worked</span>
          </h2>
          <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            {list.map((r, i) => {
              const D = DEPT[r.department];
              const st = sendState(r.report);
              const byManager = !!r.closedById && r.closedById !== r.userId;
              return (
                <li key={r.id} className={cn("flex flex-wrap items-center gap-3 px-3.5 py-3", i > 0 && "border-t border-border/50")}>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", D.tone)}><D.icon className="size-4" /></span>
                  <div className="min-w-[10rem] flex-1 leading-tight">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{r.user.fullName}<span className="text-[11px] font-normal text-muted-foreground">{r.user.role.name}</span></p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted-foreground">
                      <span className="tabular-nums">{clock(r.startedAt)} → {clock(r.endedAt!)}</span><span>·</span><span className="font-medium text-foreground/80">{shiftDuration(minutes(r.startedAt, r.endedAt!))}</span><span>·</span><span>{shiftLabel(r.startedAt, s.timezone)}</span>
                      {byManager && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-1.5 font-semibold text-amber-700 dark:text-amber-300"><ShieldAlert className="size-3" />closed by {r.closedBy?.fullName.split(" ")[0] ?? "a manager"}</span>}
                    </p>
                  </div>
                  {manager && (
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      st === "SENT" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : st === "FAILED" ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-muted text-muted-foreground")}>
                      {st === "SENT" ? <CheckCheck className="size-3" /> : st === "FAILED" ? <AlertTriangle className="size-3" /> : <CircleDashed className="size-3" />}
                      {st === "SENT" ? "Sent to the Boss" : st === "FAILED" ? "Message failed" : st === "MISSING" ? "Report being made" : st === "OFF" ? "Not sent — sending was off" : "Not sent yet"}
                    </span>
                  )}
                  <span className="flex gap-1.5">
                    <Link href={`/staff/shifts/${r.id}`} className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted">Shift</Link>
                    <Link href={`/staff/shifts/${r.id}/report`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-2.5 text-xs font-semibold text-[oklch(0.2_0.03_60)] hover:brightness-105"><FileText className="size-3.5" />Report</Link>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
