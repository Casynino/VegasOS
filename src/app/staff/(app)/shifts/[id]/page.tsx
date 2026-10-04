import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowLeftRight, ArrowRightLeft, Banknote, BedDouble, CalendarPlus, ChevronRight, Clock, FileText, HandPlatter, History, LogIn, LogOut, Receipt, RotateCcw, ShieldAlert, Undo2, UserRoundCheck, type LucideIcon } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { shiftDetail, type ShiftDetail } from "@/server/services/shifts";
import { waiterResponsibilities } from "@/server/services/waiter-work";
import { formatBusinessDate, formatDateTime, formatTime, formatTZS } from "@/lib/format";
import { needsOwnShift, worksWaiterShift } from "@/lib/permissions";
import type { ActivityArea } from "@/lib/activity-words";
import { ManagerCloseShift, ShiftControls } from "@/components/staff/shift-controls";
import { cn } from "@/lib/utils";
import { CloseWaiterShift } from "./close-waiter-shift";

export const metadata: Metadata = { title: "Shift" };
export const dynamic = "force-dynamic";

const EXPENSE_STATUS: Record<string, { label: string; tone: string }> = {
  RECORDED: { label: "Recorded", tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  APPROVED: { label: "Approved", tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  PENDING_APPROVAL: { label: "Waiting for approval", tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  CORRECTION_REQUESTED: { label: "Sent back to correct", tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  REJECTED: { label: "Rejected", tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  VOIDED: { label: "Cancelled", tone: "bg-muted text-muted-foreground" },
};
const AREA_TONE: Record<ActivityArea, string> = {
  "Front desk": "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  Bookings: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  Money: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  Restaurant: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
  Stores: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  Rooms: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
  Customers: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300",
  Shifts: "bg-muted text-muted-foreground",
  "Sign-in": "bg-muted text-muted-foreground",
  Other: "bg-muted text-muted-foreground",
};

/** 440 → "7 h 20"; under an hour → "45 min". */
const duration = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * ONE SHIFT — as a manager opens anyone's, or a receptionist / waiter their own: who worked it,
 * when it started and closed (and who closed it, with the reason when a manager did), and what
 * happened in its time. Reception: the money collected (by how it came in), room charges apart, then
 * check-ins, check-outs, bookings, room changes. Restaurant (a waiter): service only — the orders
 * that became theirs, handed on and served; no money, since waiters serve and the Restaurant Counter
 * records the payments. Then expenses recorded and every action. Read-only; a manager can close it
 * from here while it is open. shifts.view keeps it open to a receptionist off shift.
 */
export default async function ShiftPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("shifts.view", "restaurant.shift");
  const { id } = await params;
  const s = await shiftDetail(id);
  if (!s) notFound();
  const manage = can(user, "shifts.manage");
  // Anyone but a manager sees only their own shifts.
  if (!manage && s.person.id !== user.id) redirect("/staff/forbidden");
  const mine = s.person.id === user.id;
  const restaurant = s.department === "RESTAURANT";
  // A waiter's open shift: what they still have, so a manager closing it picks who takes it over.
  const work = restaurant && s.open && manage ? await waiterResponsibilities(s.person.id) : null;
  const left = work?.blocking
    ? [work.orders.length && plural(work.orders.length, "open order"), work.sessions.length && plural(work.sessions.length, "table") + " with customers"].filter(Boolean).join(" and ")
    : null;
  const back = can(user, "shifts.view") ? { href: "/staff/shifts", label: "Shifts" } : { href: "/staff/restaurant", label: "Home" };
  const m = s.money;
  const actions = s.timeline.filter((t) => t.area !== "Sign-in");
  const notCounted = s.expenses.rows.length - s.expenses.count;

  return (
    <div className="w-full space-y-4">
      {/* Who, which shift, when — and how it closed */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-wrap items-center gap-3.5 px-4 py-4 sm:px-5">
          <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl text-white", s.open ? "bg-linear-to-br from-emerald-500 to-emerald-700" : "bg-linear-to-br from-slate-500 to-slate-800")}><Clock className="size-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{mine ? "My shift" : restaurant ? "Restaurant shift" : "Reception shift"} · {s.person.role}</p>
            <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{s.person.name} · {s.label} · {formatBusinessDate(s.businessDate)}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", s.open ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{s.open ? "Open" : "Closed"}</span>
              {s.open
                ? <span>Started {formatDateTime(s.startedAt)} · open, running for {duration(s.minutes)}</span>
                : <span>{formatDateTime(s.startedAt)} → {formatDateTime(s.endedAt!)} · worked {duration(s.minutes)}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={back.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm font-medium hover:bg-muted"><ArrowLeft className="size-4" />{back.label}</Link>
            {/* The report made when the shift ended (the same document the boss gets). */}
            {!s.open && (
              <Link href={`/staff/shifts/${s.id}/report`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-2.5 text-sm font-semibold text-[oklch(0.2_0.03_60)] hover:brightness-105"><FileText className="size-4" />Shift report</Link>
            )}
            {s.open && manage && (restaurant
              ? <CloseWaiterShift shiftId={s.id} name={s.person.name} waiterId={s.person.id} left={left} />
              : <ManagerCloseShift shiftId={s.id} name={s.person.name} />)}
            {s.open && mine && !restaurant && needsOwnShift(user.permissions) && <ShiftControls variant="switch" since={formatTime(s.startedAt)} myShiftOpen otherOpenBy={null} scheduledName={null} isScheduled />}
            {/* A waiter closes their shift on Home (once — not when the back link already goes there). */}
            {s.open && mine && restaurant && worksWaiterShift(user.permissions) && back.href !== "/staff/restaurant" && (
              <Link href="/staff/restaurant" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-2.5 text-sm font-medium text-background hover:opacity-90"><Clock className="size-4" />Home</Link>
            )}
          </div>
        </div>
        {(s.replacement || (s.scheduled && s.scheduled !== s.person.name) || s.closedBy || s.closingNote) && (
          <div className="space-y-1.5 border-t border-border/60 px-4 py-3 text-sm sm:px-5">
            {s.scheduled && s.scheduled !== s.person.name && <p className="text-muted-foreground">Scheduled that day: <span className="font-medium text-foreground">{s.scheduled}</span></p>}
            {s.replacement && <p className="text-muted-foreground">Worked instead of the schedule — <span className="text-foreground">“{s.replacement}”</span></p>}
            {s.closedBy && (s.closedBy.byManager
              ? <p className="flex items-start gap-1.5 rounded-xl bg-amber-500/12 px-3 py-2 font-medium text-amber-800 dark:text-amber-200"><ShieldAlert className="mt-0.5 size-4 shrink-0" />Closed by manager {s.closedBy.name}{s.closeReason ? ` — ${s.closeReason}` : ""}</p>
              : <p className="text-muted-foreground">Closed by {mine ? "you" : s.closedBy.name}{s.endedAt ? ` at ${formatTime(s.endedAt)}` : ""}</p>)}
            {s.closingNote && !s.closedBy?.byManager && <p className="whitespace-pre-line rounded-xl bg-muted/50 px-3 py-2 text-foreground"><span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Handover note</span>{s.closingNote}</p>}
          </div>
        )}
      </section>

      {/* Reception's money: collected by how it came in; refunds, reversed and room charges apart.
          A waiter's shift has none — waiters serve; the Restaurant Counter records the payments. */}
      {!restaurant && <section className="grid gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-card px-4 py-4 sm:col-span-2 sm:px-5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Banknote className="size-3.5 text-emerald-500" />Collected</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatTZS(m.collected)}</p>
          <p className="text-xs text-muted-foreground">
            {m.payments} payment{m.payments === 1 ? "" : "s"}{m.refunds ? ` · ${formatTZS(m.net)} kept after refunds` : ""}{m.toConfirm ? ` · ${formatTZS(m.toConfirm)} still to confirm` : ""}
          </p>
          {m.byKind.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {m.byKind.map((k) => <span key={k.name} className="rounded-full border border-border/80 bg-background/50 px-2.5 py-1 text-[11px] font-medium tabular-nums">{k.name} · {k.amount.toLocaleString("en-US")}</span>)}
            </div>
          )}
          {m.bySource.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{m.bySource.map((x) => `${x.label} ${x.amount.toLocaleString("en-US")}`).join(" · ")}</p>}
          <Link href={`/staff/collections?shift=${s.id}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.1_82)]">See every payment<ChevronRight className="size-3.5" /></Link>
        </div>
        <Tile icon={BedDouble} tone="bg-violet-500/12 text-violet-600 dark:text-violet-300" label="Room charges handled" value={formatTZS(m.roomCharges)}
          sub={m.roomOrders ? `${m.roomOrders} order${m.roomOrders === 1 ? "" : "s"} put on room bills — not money collected` : "None this shift"} />
        <div className="grid gap-px bg-border/60">
          <Tile icon={RotateCcw} tone="bg-sky-500/12 text-sky-600 dark:text-sky-300" label="Refunds given" value={formatTZS(m.refunds)} sub={m.refundCount ? `${m.refundCount} refund${m.refundCount === 1 ? "" : "s"}` : "None"} />
          <Tile icon={Undo2} tone="bg-rose-500/12 text-rose-600 dark:text-rose-300" label="Reversed" value={formatTZS(m.reversed)} sub={m.reversedCount ? `${m.reversedCount} payment${m.reversedCount === 1 ? "" : "s"} — not counted` : "None"} />
        </div>
      </section>}

      {/* The work done */}
      {restaurant ? (
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-4">
          <Tile icon={UserRoundCheck} tone="bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" label={mine ? "Orders you looked after" : "Orders they looked after"} value={String(s.counts.ordersTaken)} sub={`Picked up, given or transferred to ${mine ? "you" : "them"}`} />
          <Tile icon={ArrowRightLeft} tone="bg-sky-500/12 text-sky-600 dark:text-sky-300" label="Handed on" value={String(s.counts.ordersHandedOn)} sub="Orders transferred to a colleague" />
          <Tile icon={HandPlatter} tone="bg-orange-500/12 text-orange-600 dark:text-orange-300" label="Served" value={String(s.counts.delivered)} sub="Orders that reached the customer" />
          <Tile icon={Receipt} tone="bg-amber-500/15 text-amber-700 dark:text-amber-300" label="Expenses recorded" value={formatTZS(s.expenses.total)} sub={s.expenses.rows.length ? `${s.expenses.rows.length} expense${s.expenses.rows.length === 1 ? "" : "s"}${notCounted ? ` · ${notCounted} not counted (waiting, rejected or cancelled)` : ""}` : "None"} />
        </section>
      ) : (
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-5">
          <Tile icon={LogIn} tone="bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" label="Check-ins" value={String(s.counts.checkIns)} sub="Guests checked in" />
          <Tile icon={LogOut} tone="bg-sky-500/12 text-sky-600 dark:text-sky-300" label="Check-outs" value={String(s.counts.checkOuts)} sub="Guests checked out" />
          <Tile icon={CalendarPlus} tone="bg-indigo-500/12 text-indigo-600 dark:text-indigo-300" label="Bookings" value={String(s.counts.bookings)} sub="Made, walk-ins included" />
          <Tile icon={ArrowLeftRight} tone="bg-teal-500/12 text-teal-600 dark:text-teal-300" label="Room changes" value={String(s.counts.roomChanges)} sub="Guests moved" />
          <div className="col-span-2 grid sm:col-span-1">
            <Tile icon={Receipt} tone="bg-amber-500/15 text-amber-700 dark:text-amber-300" label="Expenses recorded" value={formatTZS(s.expenses.total)} sub={s.expenses.rows.length ? `${s.expenses.rows.length} expense${s.expenses.rows.length === 1 ? "" : "s"}${notCounted ? ` · ${notCounted} not counted (waiting, rejected or cancelled)` : ""}` : "None"} />
          </div>
        </section>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Every action, newest first */}
        <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
          <header className="flex items-baseline justify-between gap-2 border-b border-border/60 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><History className="size-4 text-muted-foreground" />What was done</p>
            <p className="text-xs text-muted-foreground">{actions.length} action{actions.length === 1 ? "" : "s"} · newest first</p>
          </header>
          {actions.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing recorded in this shift yet.</p> : (
            <ul className="divide-y divide-border/50">
              {actions.map((t) => <TimelineRow key={t.id} t={t} />)}
            </ul>
          )}
        </section>

        {/* Expenses recorded in the shift */}
        <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
          <header className="flex items-baseline justify-between gap-2 border-b border-border/60 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Receipt className="size-4 text-muted-foreground" />Expenses recorded</p>
            <p className="text-sm font-semibold tabular-nums">{formatTZS(s.expenses.total)}</p>
          </header>
          {s.expenses.rows.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">No expenses recorded in this shift.</p> : (
            <>
              <ul className="divide-y divide-border/50">
                {s.expenses.rows.map((e) => {
                  const st = EXPENSE_STATUS[e.status] ?? { label: e.status, tone: "bg-muted text-muted-foreground" };
                  return (
                    <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{formatTime(e.at)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.what}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{e.number}{e.account ? ` · ${e.account}` : ""}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", st.tone)}>{st.label}</span>
                          {e.purchase && <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Stock purchase</span>}
                        </span>
                      </span>
                      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", (e.status === "REJECTED" || e.status === "VOIDED") && "text-muted-foreground line-through")}>{formatTZS(e.amount)}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">The total counts recorded and approved expenses only.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, tone, label, value, sub }: { icon: LucideIcon; tone: string; label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 bg-card px-4 py-4 sm:px-5">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3", tone)}><Icon /></span><span className="truncate">{label}</span></p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
      <p className="line-clamp-2 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/** One action in the shift: when, in plain words, which part of the hotel — linked when it has a page. */
function TimelineRow({ t }: { t: ShiftDetail["timeline"][number] }) {
  const body = (
    <>
      <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(t.at)}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{upper(t.what)}</span>
      <span className={cn("hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline", AREA_TONE[t.area])}>{t.area}</span>
      {t.href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </>
  );
  return (
    <li>
      {t.href
        ? <Link href={t.href} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40">{body}</Link>
        : <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>}
    </li>
  );
}
