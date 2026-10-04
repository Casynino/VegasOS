import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, Clock, FileText, History, Repeat2, Wallet } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { DESK_LIMIT, getShiftOverview, shiftHistory, type ShiftHistoryRow } from "@/server/services/shifts";
import { inHouseBalances } from "@/server/services/guest-balances";
import { addDays, eachDate, fromDbDate, toDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatMinutesLabel, formatTZS } from "@/lib/format";
import { needsOwnShift } from "@/lib/permissions";
import { PAYMENT_STATUS_META } from "@/lib/payment-status";
import { cn } from "@/lib/utils";
import { ShiftControls } from "@/components/staff/shift-controls";
import { SlimBanner } from "@/components/staff/slim-banner";
import { DeskCard } from "@/components/staff/desk-card";
import { ScheduleSelect, RotationForm, SwapForm } from "./shift-forms";

export const metadata: Metadata = { title: "Shifts" };
export const dynamic = "force-dynamic";

const initials = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
const firstName = (n: string) => n.replace(/\s*\(.*\)/, "").split(" ")[0];
const dur = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/**
 * RECEPTION SHIFTS — the desk at a glance: who is on it now (up to two receptionists), who is scheduled, the money
 * still to collect and what the last shift handed over; then the schedule as a calendar, the handover notes, and the
 * shifts worked — each with its report. Managers plan the rota here and close a shift when someone cannot.
 */
export default async function ShiftsPage() {
  const user = await requirePagePermission("shifts.view");
  const [today, s] = await Promise.all([businessToday(), getSettings()]);
  const from = addDays(today, -7);
  const to = addDays(today, 13);
  const manage = can(user, "shifts.manage");
  // Receptionists work under their own shift; managers, the MD and the owner supervise without one.
  const worksShifts = needsOwnShift(user.permissions);

  const [overview, schedules, actuals, receptionists, history, balances] = await Promise.all([
    getShiftOverview(today),
    db.shiftSchedule.findMany({ where: { businessDate: { gte: toDbDate(from), lte: toDbDate(to) } }, include: { scheduledUser: { select: { id: true, fullName: true } } } }),
    db.actualShift.findMany({ where: { department: "RECEPTION", businessDate: { gte: toDbDate(from), lte: toDbDate(today) } }, include: { user: { select: { fullName: true } } }, orderBy: { startedAt: "asc" } }),
    // Who works reception shifts: shifts.work without shifts.manage (managers, the MD and the owner never do).
    db.user.findMany({
      where: { isActive: true, AND: [{ role: { permissions: { some: { permission: { code: "shifts.work" } } } } }, { NOT: { role: { permissions: { some: { permission: { code: "shifts.manage" } } } } } }] },
      select: { id: true, fullName: true }, orderBy: { fullName: "asc" },
    }),
    // A receptionist sees only their own shifts; a manager everyone's.
    shiftHistory({ userId: manage ? null : user.id, take: 12, department: "RECEPTION" }),
    inHouseBalances(today),
  ]);
  const byDate = new Map(schedules.map((x) => [fromDbDate(x.businessDate), x]));
  const actualByDate = new Map<string, typeof actuals>();
  actuals.forEach((a) => { const k = fromDbDate(a.businessDate); actualByDate.set(k, [...(actualByDate.get(k) ?? []), a]); });
  const mine = overview.openAll.find((o) => o.userId === user.id) ?? null;
  const desk = overview.openAll;
  const now = new Date();
  const clock = (d: Date | string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: s.timezone }).format(new Date(d));
  // Collect at check-out: reception, inside its own shift. Managers watch (View).
  const canPay = worksShifts && !!mine && can(user, "payments.record");
  const sum = balances.summary;
  const past = eachDate(from, today).filter((d) => d < today);
  const ahead = eachDate(today, addDays(to, 1)).filter((d) => d <= to);

  return (
    <div className="w-full space-y-5">
      <SlimBanner icon={<Clock />} eyebrow={`People · ${formatBusinessDate(today, true)}`} title="Reception shifts"
        sub={`Up to two receptionists work the desk together · the hotel day turns at ${formatMinutesLabel(s.businessDayStartMinutes)}`}
        right={<>
          {worksShifts && (
            <ShiftControls variant="switch" myShiftOpen={!!mine} since={mine ? clock(mine.startedAt) : null}
              otherOpenBy={!mine && overview.full ? desk.map((o) => firstName(o.user.fullName)).join(" and ") : null}
              scheduledName={overview.scheduledToday?.scheduledUser.fullName ?? null} isScheduled={overview.scheduledToday?.scheduledUserId === user.id} />
          )}
          {mine && <Link href={`/staff/shifts/${mine.id}`} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted">My shift<ArrowRight className="size-3.5" /></Link>}
          {manage && <Link href="/staff/shifts/all" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted"><History className="size-4" />All staff shifts</Link>}
        </>} />

      {/* ── The desk and the day at a glance ── */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <DeskCard desk={desk} limit={DESK_LIMIT} meId={user.id} manage={manage} timezone={s.timezone} now={now} className="sm:col-span-2 xl:col-span-1" />
        {[
          { icon: CalendarDays, tone: "bg-[oklch(0.75_0.12_80)]/15 text-[oklch(0.55_0.11_75)] dark:text-[#f0cf86]", label: "Scheduled today", value: overview.scheduledToday ? (overview.scheduledToday.scheduledUserId === user.id ? "You" : overview.scheduledToday.scheduledUser.fullName) : "Nobody", sub: "this hotel day", warn: !overview.scheduledToday },
          { icon: CalendarDays, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-300", label: "Tomorrow", value: overview.scheduledTomorrow?.scheduledUser.fullName ?? "Nobody", sub: formatBusinessDate(addDays(today, 1)), warn: !overview.scheduledTomorrow },
          { icon: History, tone: "bg-muted text-muted-foreground", label: "Previous shift", value: overview.previous?.user.fullName ?? "—", sub: overview.previous?.endedAt ? `ended ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: s.timezone }).format(overview.previous.endedAt)} · ${clock(overview.previous.endedAt)}` : "none yet" },
          { icon: Wallet, tone: "bg-rose-500/12 text-rose-600 dark:text-rose-300", label: "Money to collect", value: formatTZS(sum.totalOutstanding), sub: sum.owingCount ? `${sum.owingCount} of ${sum.guestsCheckedIn} guests owe` : "everyone is paid up", money: sum.totalOutstanding > 0 },
        ].map((x) => (
          <div key={x.label} className="flex items-center gap-3.5 rounded-3xl border border-border/70 bg-card px-4 py-3.5">
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", x.tone)}><x.icon className="size-5" /></span>
            <div className="min-w-0 leading-tight">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{x.label}</p>
              <p className={cn("mt-0.5 text-base font-semibold leading-snug [overflow-wrap:anywhere]", x.warn && "text-amber-700 dark:text-amber-300", x.money && "text-rose-600 dark:text-rose-400")}>{x.value}</p>
              <p className="truncate text-xs text-muted-foreground">{x.sub}</p>
            </div>
          </div>
        ))}
      </section>

      <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-5", manage && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
        <div className="min-w-0 space-y-5">
          {/* ── Money to collect: the guests staying who still owe — the handover is not only the keys ── */}
          <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
            <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 sm:px-5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold"><Wallet className="size-4 text-rose-500" />Money to collect</h2>
                <p className="text-xs text-muted-foreground">Guests staying who still owe — saved in the handover when a shift ends.</p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-muted px-2.5 py-1"><strong className="tabular-nums">{sum.guestsCheckedIn}</strong> staying · {sum.occupiedRooms} rooms</span>
                <span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-emerald-700 dark:text-emerald-300"><strong className="tabular-nums">{sum.fullyPaid}</strong> fully paid</span>
                <span className="rounded-full bg-rose-500/12 px-2.5 py-1 text-rose-700 dark:text-rose-300"><strong className="tabular-nums">{sum.owingCount}</strong> owing</span>
              </div>
            </div>
            {balances.owing.length === 0 ? (
              <p className="m-4 flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-4 py-4 text-sm font-medium text-emerald-700 dark:text-emerald-300 sm:m-5"><CheckCircle2 className="size-4" />Nobody staying owes money.</p>
            ) : (
              <>
                <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-px border-y border-border/60 bg-border/50 md:grid-cols-2">
                  {balances.owing.slice(0, 6).map((x) => <OwingCard key={x.reservationId} x={x} canPay={canPay} />)}
                </ul>
                {balances.owing.length > 6 && (
                  <details className="group border-b border-border/60">
                    <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
                      <ChevronDown className="size-3.5 transition group-open:rotate-180" /><span className="group-open:hidden">Show {balances.owing.length - 6} more</span><span className="hidden group-open:inline">Show less</span>
                    </summary>
                    <ul className="grid grid-cols-[minmax(0,1fr)] gap-px border-t border-border/60 bg-border/50 md:grid-cols-2">
                      {balances.owing.slice(6).map((x) => <OwingCard key={x.reservationId} x={x} canPay={canPay} />)}
                    </ul>
                  </details>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                  <span className="text-sm font-semibold">Total to collect</span>
                  <span className="text-right">
                    <span className="block text-lg font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatTZS(sum.totalOutstanding)}</span>
                    <span className="block text-[11px] text-muted-foreground">{formatTZS(sum.totalOwedSoFar)} for the nights so far</span>
                  </span>
                </div>
              </>
            )}
          </section>

          {/* ── The schedule as a calendar ── */}
          <section className="@container rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="size-4 text-[oklch(0.62_0.11_78)]" />Schedule</h2>
                <p className="text-xs text-muted-foreground">{manage ? "Pick who works each day — or generate a rotation." : "Who works the desk each hotel day."}</p>
              </div>
              <span className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500" />worked</span>
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" />not as scheduled</span>
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-rose-500" />no shift</span>
              </span>
            </div>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Today & the next 13 days</p>
            <ul className="mt-2 grid grid-cols-2 gap-2 @md:grid-cols-4 @4xl:grid-cols-7">
              {ahead.map((d) => {
                const sch = byDate.get(d);
                const isToday = d === today;
                const worked = isToday ? actualByDate.get(d) ?? [] : [];
                return (
                  <li key={d} className={cn("flex min-h-28 min-w-0 flex-col overflow-hidden rounded-2xl border p-2.5", isToday ? "border-[oklch(0.75_0.12_80)]/60 bg-[oklch(0.75_0.12_80)]/[0.08]" : "border-border/70")}>
                    <DayHead d={d} today={isToday} />
                    <div className="mt-auto pt-2">
                      {manage ? <ScheduleSelect short date={d} value={sch?.scheduledUserId ?? ""} users={receptionists} current={sch?.scheduledUser ?? null} className="h-8 w-full pl-2 pr-6 text-xs" />
                        : sch ? <Person name={sch.scheduledUserId === user.id ? "You" : sch.scheduledUser.fullName} /> : <p className="text-xs text-muted-foreground">Not scheduled</p>}
                      {worked.length > 0 && <p className="mt-1.5 truncate text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">Worked: {[...new Set(worked.map((w) => firstName(w.user.fullName)))].join(" & ")}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <details className="group mt-4">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground">
                <ChevronDown className="size-3.5 transition group-open:rotate-180" />The last 7 days — scheduled and worked
              </summary>
              <ul className="mt-2 grid grid-cols-2 gap-2 @md:grid-cols-4 @4xl:grid-cols-7">
                {past.map((d) => {
                  const sch = byDate.get(d);
                  const worked = actualByDate.get(d) ?? [];
                  const mismatch = !!sch && worked.length > 0 && !worked.some((w) => w.userId === sch.scheduledUserId);
                  const state = worked.length === 0 ? "none" : mismatch ? "diff" : "ok";
                  return (
                    <li key={d} className={cn("flex min-h-28 min-w-0 flex-col overflow-hidden rounded-2xl border p-2.5", state === "none" ? "border-rose-500/30 bg-rose-500/[0.04]" : state === "diff" ? "border-amber-500/40 bg-amber-500/[0.05]" : "border-border/70")}>
                      <DayHead d={d} />
                      <p className="mt-1 truncate text-[10.5px] text-muted-foreground">Scheduled: {sch ? firstName(sch.scheduledUser.fullName) : "—"}</p>
                      <div className="mt-auto space-y-1 pt-2">
                        {worked.length === 0 ? <p className="flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400"><AlertTriangle className="size-3.5" />No shift</p> : worked.map((w) => (
                          (() => {
                            const body = <><span className={cn("flex items-center gap-1 truncate text-xs font-semibold", state === "diff" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300")}><span className="size-1.5 shrink-0 rounded-full bg-current" />{firstName(w.user.fullName)}{w.isReplacement && " · cover"}</span>
                              <span className="block truncate text-[10.5px] tabular-nums text-muted-foreground">{clock(w.startedAt)} → {w.endedAt ? clock(w.endedAt) : "open"}</span></>;
                            // A colleague's shift opens only for a manager (or their own).
                            return manage || w.userId === user.id
                              ? <Link key={w.id} href={`/staff/shifts/${w.id}`} className="block rounded-lg px-1 py-0.5 hover:bg-muted">{body}</Link>
                              : <div key={w.id} className="block rounded-lg px-1 py-0.5">{body}</div>;
                          })()
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          </section>
        </div>

        {manage && <aside className="min-w-0 space-y-5">
          {/* ── Planning (managers) ── */}
          {manage && (
            <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold"><Repeat2 className="size-4 text-violet-500" />Plan the rota</h2>
              <p className="mb-3 text-xs text-muted-foreground">Tick receptionists in the order they rotate — one per day.</p>
              <RotationForm users={receptionists} from={today} />
              <div className="mt-5 border-t border-border/60 pt-4">
                <p className="mb-2 text-sm font-semibold">Swap two days</p>
                <SwapForm today={today} />
              </div>
            </section>
          )}
        </aside>}
      </div>

      {/* ── Shifts worked, each with its report ── */}
      <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold"><History className="size-4 text-muted-foreground" />{manage ? "Shifts worked" : "My shifts"}</h2>
            <p className="text-xs text-muted-foreground">{manage ? "The latest reception shifts — open one, or its report made when it ended." : "Your latest shifts and the report made when each ended."}</p>
          </div>
          {manage && <Link href="/staff/shifts/all?dept=RECEPTION" className="inline-flex items-center gap-1 text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.1_82)]">Every shift & report<ArrowRight className="size-3.5" /></Link>}
        </div>
        {history.length === 0 ? <p className="mt-4 rounded-2xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">No shifts worked yet.</p> : (
          <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {history.map((h) => <ShiftCard key={h.id} h={h} showWho={manage} clock={clock} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function DayHead({ d, today = false }: { d: string; today?: boolean }) {
  const dt = new Date(`${d}T12:00:00Z`);
  return (
    <p className="flex items-baseline justify-between gap-1">
      <span className={cn("text-[10.5px] font-semibold uppercase tracking-wider", today ? "text-[oklch(0.55_0.11_75)] dark:text-[#f0cf86]" : "text-muted-foreground")}>{today ? "Today" : dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
      <span className="text-lg font-semibold leading-none tabular-nums">{dt.getUTCDate()}<span className="ml-0.5 text-[10px] font-medium text-muted-foreground">{dt.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span></span>
    </p>
  );
}

function Person({ name }: { name: string }) {
  return (
    <p className="flex items-center gap-1.5">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[oklch(0.75_0.12_80)]/18 text-[9px] font-bold text-[oklch(0.5_0.1_75)] dark:text-[#f0cf86]">{name === "You" ? "Me" : initials(name)}</span>
      <span className="truncate text-xs font-semibold">{name === "You" ? "You" : firstName(name)}</span>
    </p>
  );
}

/** One guest who owes: room, name, how much of the bill is paid, what is left. */
function OwingCard({ x, canPay }: { x: Awaited<ReturnType<typeof inHouseBalances>>["owing"][number]; canPay: boolean }) {
  const paidPct = x.total > 0 ? Math.min(100, Math.round((x.paid / x.total) * 100)) : 0;
  const meta = PAYMENT_STATUS_META[x.status];
  return (
    <li className="flex items-center gap-3 bg-card px-4 py-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-500/12 text-center text-violet-700 ring-1 ring-inset ring-violet-500/20 dark:text-violet-200">
        <span className="leading-none"><span className="block text-[8px] font-semibold uppercase tracking-[0.12em] opacity-70">Room</span><span className="block text-[15px] font-bold tabular-nums">{x.rooms[0] ?? "—"}</span></span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <Link href={`/staff/reservations/${x.reservationId}`} className="truncate text-sm font-semibold hover:underline">{x.guest}</Link>
          <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold", meta.className)}>{meta.label}</span>
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" title={`${paidPct}% paid`}>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
        </div>
        <p className="mt-1 truncate text-[11px] text-muted-foreground tabular-nums">Paid {x.paid.toLocaleString("en-US")} of {x.total.toLocaleString("en-US")}{x.rooms.length > 1 ? ` · rooms ${x.rooms.join(", ")}` : ""}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">{x.outstanding.toLocaleString("en-US")}</p>
        {canPay
          ? <Link href={`/staff/check-out?id=${x.reservationId}#workspace`} className="mt-1 inline-flex items-center gap-1 rounded-lg bg-foreground px-2 py-1 text-[11px] font-semibold text-background hover:opacity-90"><Wallet className="size-3" />Collect</Link>
          : <Link href={`/staff/reservations/${x.reservationId}`} className="mt-1 inline-flex rounded-lg border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-muted">View</Link>}
      </div>
    </li>
  );
}

/** One shift worked: who, which, when, how long, what they collected — and its report. */
function ShiftCard({ h, showWho, clock }: { h: ShiftHistoryRow; showWho: boolean; clock: (d: string) => string }) {
  const mins = h.endedAt ? Math.round((new Date(h.endedAt).getTime() - new Date(h.startedAt).getTime()) / 60000) : null;
  return (
    <li className="flex flex-col rounded-2xl border border-border/70 p-3.5">
      <div className="flex items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", h.open ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}><Clock className="size-5" /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{showWho ? `${h.person.name} · ` : ""}{h.label}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{formatBusinessDate(h.businessDate)} · <span className="tabular-nums">{clock(h.startedAt)} → {h.endedAt ? clock(h.endedAt) : "open"}</span>{mins !== null ? ` · ${dur(mins)}` : ""}</p>
        </div>
        {h.open && <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">On now</span>}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Collected</p>
          <p className="text-base font-semibold tabular-nums">{formatTZS(h.collected)}</p>
        </div>
        <span className="flex gap-1.5">
          <Link href={`/staff/shifts/${h.id}`} className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted">Shift</Link>
          {!h.open && <Link href={`/staff/shifts/${h.id}/report`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-2.5 text-xs font-semibold text-[oklch(0.2_0.03_60)] hover:brightness-105"><FileText className="size-3.5" />Report</Link>}
        </span>
      </div>
      {(h.closedBy || h.replacement) && (
        <p className="mt-2.5 flex flex-wrap gap-1.5 text-[10.5px]">
          {h.closedBy && <span className="rounded-full bg-amber-500/12 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300">Closed by {firstName(h.closedBy)}{h.closeReason ? ` — ${h.closeReason}` : ""}</span>}
          {h.replacement && <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">Covering</span>}
        </p>
      )}
    </li>
  );
}
