import type { Metadata } from "next";
import { timeRange } from "@/lib/meeting";
import Link from "next/link";
import { CalendarPlus, CalendarRange, ChevronLeft, ChevronRight, List, TriangleAlert } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { refreshBookingStates } from "@/server/services/booking-holds";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { addDays, diffDays, eachDate, fromDbDate, isBusinessDate, toDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatShortDate } from "@/lib/format";
import { BookingBar, type BarInfo } from "./booking-bar";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Room schedule" };

const SPANS = [{ n: 7, label: "Week" }, { n: 14, label: "2 weeks" }, { n: 31, label: "Month" }] as const;

/** One calm colour per kind of stay: a soft fill with a strong left edge. */
const BAR = {
  CHECKED_IN: { cls: "bg-linear-to-r from-sky-500/30 to-sky-500/[0.12] border-sky-500 text-sky-950 ring-1 ring-inset ring-sky-500/25 dark:text-white", dot: "bg-sky-500", label: "In the hotel" },
  CONFIRMED: { cls: "bg-linear-to-r from-emerald-500/30 to-emerald-500/[0.12] border-emerald-500 text-emerald-950 ring-1 ring-inset ring-emerald-500/25 dark:text-white", dot: "bg-emerald-500", label: "Reserved · paid / confirmed" },
  RESERVED: { cls: "border-dashed bg-linear-to-r from-amber-400/25 to-amber-400/[0.08] border-amber-500 text-amber-950 ring-1 ring-inset ring-amber-500/20 dark:text-amber-50", dot: "bg-amber-500", label: "Pending · unpaid (held for a while)" },
  OVERDUE: { cls: "bg-linear-to-r from-rose-500/30 to-rose-500/[0.12] border-rose-500 text-rose-950 ring-1 ring-inset ring-rose-500/25 dark:text-white", dot: "bg-rose-500", label: "Checkout overdue" },
  NO_SHOW: { cls: "border-dashed bg-rose-500/[0.12] border-rose-400 text-rose-950 ring-1 ring-inset ring-rose-400/20 dark:text-rose-50", dot: "bg-rose-400", label: "No-show · room still held" },
  BLOCK: { cls: "border-zinc-400 text-zinc-600 dark:text-zinc-300 bg-[repeating-linear-gradient(135deg,rgba(120,120,120,0.14)_0_6px,transparent_6px_12px)]", dot: "bg-zinc-400", label: "Maintenance" },
} as const;
type Tone = keyof typeof BAR;
type Bar = { key: string; start: number; end: number; tone: Tone; title: string; sub: string; nights: number; href?: string; clipL: boolean; clipR: boolean; lane: number; info?: BarInfo };

const wd = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const mon = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(d);
const initials = (n: string) => n.replace(/\(.*\)/, "").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

/**
 * Every room against every night. A booking holds its room from the moment it
 * is made until it is cancelled, so this shows exactly what the website and
 * the desk can still sell. Stays run from the afternoon of arrival to the
 * morning of departure, like a hotel tape chart; tap a free night to book it.
 */
export default async function RoomCalendarPage({ searchParams }: PageProps<"/staff/reservations/calendar">) {
  const user = await requirePagePermission("reservations.view");
  await refreshBookingStates();
  // Managers and the MD watch the chart; reception books from it.
  const watching = can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");
  const canBook = !watching && can(user, "reservations.create");
  const canIn = !watching && can(user, "reservations.check_in"), canOut = !watching && can(user, "reservations.check_out");
  const sp = await searchParams;
  const today = await businessToday();
  const days = SPANS.find((s) => String(s.n) === sp.days)?.n ?? 14;
  const from = typeof sp.from === "string" && isBusinessDate(sp.from) ? sp.from : today;
  const to = addDays(from, days); // exclusive
  const dates = eachDate(from, to);

  const [rooms, stays, blocks] = await Promise.all([
    db.room.findMany({
      where: { isActive: true, roomType: { isActive: true } },
      select: { id: true, number: true, roomType: { select: { id: true, name: true, sortOrder: true } } },
    }),
    db.reservationRoom.findMany({
      where: {
        // A no-show keeps its room (shown as "action required") until it is released.
        AND: [
          { OR: [{ status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] } }, { status: "NO_SHOW", releasedAt: null }] },
          { OR: [{ departureDate: { gt: toDbDate(from) } }, { status: "CHECKED_IN" }, { isDayUse: true, arrivalDate: { gte: toDbDate(from) } }] },
        ],
        arrivalDate: { lt: toDbDate(to) },
      },
      select: {
        id: true, roomId: true, status: true, arrivalDate: true, departureDate: true, isDayUse: true, nights: true, startAt: true, endAt: true, adults: true, children: true,
        room: { select: { number: true } }, roomType: { select: { name: true } },
        reservation: { select: {
          id: true, kind: true, reference: true, companyName: true, netAmount: true, paidAmount: true, balanceAmount: true, billTo: true,
          guest: { select: { fullName: true, phone: true } }, source: { select: { name: true } }, corporateCustomer: { select: { companyName: true } },
        } },
      },
    }),
    db.roomBlock.findMany({
      where: { closedAt: null, startDate: { lt: toDbDate(to) }, OR: [{ endDate: null }, { endDate: { gt: toDbDate(from) } }] },
      select: { id: true, roomId: true, type: true, startDate: true, endDate: true, reason: true },
    }),
  ]);

  // Rooms grouped by type (hotel order), numbers ascending inside each group.
  rooms.sort((a, b) => a.roomType.sortOrder - b.roomType.sortOrder || a.roomType.name.localeCompare(b.roomType.name) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  const groups: { name: string; rooms: typeof rooms }[] = [];
  for (const r of rooms) {
    const g = groups.at(-1);
    if (g?.name === r.roomType.name) g.rooms.push(r); else groups.push({ name: r.roomType.name, rooms: [r] });
  }

  // Place stays & blocks on the nights they cover, clipped to the range.
  const col = (d: string) => Math.max(0, Math.min(days, diffDays(from, d)));
  const bars = new Map<string, Bar[]>();
  const taken = new Map<string, boolean[]>(rooms.map((r) => [r.id, Array(days).fill(false)]));
  const push = (roomId: string, b: Omit<Bar, "lane">) => {
    if (b.end <= b.start) return;
    (bars.get(roomId) ?? bars.set(roomId, []).get(roomId)!).push({ ...b, lane: 0 });
    const t = taken.get(roomId);
    if (t) for (let i = b.start; i < b.end; i++) t[i] = true;
  };
  for (const s of stays) {
    const arr = fromDbDate(s.arrivalDate);
    const booked = s.isDayUse ? addDays(arr, 1) : fromDbDate(s.departureDate);
    const overdue = s.status === "CHECKED_IN" && booked <= today;
    const dep = overdue ? addDays(today, 1) : booked; // still in the room until checked out
    push(s.roomId, {
      key: s.id, start: col(arr), end: col(dep), tone: overdue ? "OVERDUE" : (s.status as Tone), nights: s.nights,
      title: `${s.status === "NO_SHOW" ? "No-show · " : ""}${s.reservation.kind === "MEETING" ? s.reservation.companyName ?? s.reservation.guest.fullName : s.reservation.guest.fullName}`,
      sub: s.reservation.kind === "MEETING" ? `Meeting ${timeRange(s.startAt, s.endAt)}` : s.isDayUse ? `Short time · ${formatBusinessDate(arr)}` : `${formatBusinessDate(arr)} → ${formatBusinessDate(booked)}`,
      href: `/staff/reservations/${s.reservation.id}`, clipL: arr < from, clipR: dep > to,
      info: (() => {
        const r = s.reservation;
        const meeting = r.kind === "MEETING";
        const tone = overdue ? "OVERDUE" : (s.status as Tone);
        const actions: BarInfo["actions"] = [];
        if (s.status === "CHECKED_IN" && canOut && !meeting) actions.push({ label: overdue ? "Check out now" : "Check out", href: `/staff/check-out?id=${r.id}#workspace`, primary: true });
        if ((s.status === "RESERVED" || s.status === "CONFIRMED") && arr <= today && canIn && !meeting) actions.push({ label: "Check in", href: `/staff/check-in?id=${r.id}#workspace`, primary: true });
        actions.push({ label: "Open booking", href: `/staff/reservations/${r.id}` });
        return {
          id: r.id, reference: r.reference, who: meeting ? r.companyName ?? r.guest.fullName : r.guest.fullName, guest: r.guest.fullName, phone: r.guest.phone,
          company: r.corporateCustomer?.companyName ?? r.companyName, status: BAR[tone].label.split(" · ")[0], dot: BAR[tone].dot,
          room: s.room.number, type: s.roomType.name,
          dates: s.isDayUse || meeting ? formatShortDate(arr) : `${formatShortDate(arr)} → ${formatShortDate(booked)}`,
          nights: meeting ? "Meeting" : s.isDayUse ? "Short time" : `${s.nights} night${s.nights === 1 ? "" : "s"}`,
          times: `${hhmm(s.startAt)} → ${hhmm(s.endAt)}`,
          people: `${s.adults} adult${s.adults === 1 ? "" : "s"}${s.children ? ` · ${s.children} child${s.children === 1 ? "" : "ren"}` : ""}`,
          source: r.source.name, net: r.netAmount, paid: r.paidAmount, balance: r.balanceAmount,
          billTo: r.billTo === "GROUP" ? "Group" : r.billTo && r.billTo !== "GUEST" ? "Company" : null, actions,
        };
      })(),
    });
  }
  for (const b of blocks) {
    const start = fromDbDate(b.startDate);
    const end = b.endDate ? fromDbDate(b.endDate) : to;
    push(b.roomId, {
      key: b.id, start: col(start), end: col(end), tone: "BLOCK", nights: 0, title: b.type === "MAINTENANCE" ? "Maintenance" : "Out of service",
      sub: b.reason ?? (b.endDate ? `until ${formatBusinessDate(end)}` : "no end date"), clipL: start < from, clipR: end > to,
    });
  }
  // Overlapping stays (an overdue guest and today's arrival) get their own line.
  const lanes = new Map<string, number>();
  for (const [roomId, list] of bars) {
    list.sort((a, b) => a.start - b.start);
    const ends: number[] = [];
    for (const b of list) {
      const lane = ends.findIndex((e) => e <= b.start);
      b.lane = lane === -1 ? ends.length : lane;
      ends[b.lane] = b.end;
    }
    lanes.set(roomId, ends.length || 1);
  }

  const freePerNight = dates.map((_, i) => rooms.filter((r) => !taken.get(r.id)![i]).length);
  const fullNights = dates.filter((_, i) => freePerNight[i] === 0);
  const booked = rooms.length ? Math.round((100 * freePerNight.reduce((s, f) => s + (rooms.length - f), 0)) / (rooms.length * days)) : 0;
  const fewest = Math.min(...freePerNight);
  const clashes = [...lanes.values()].filter((n) => n > 1).length;
  const link = (p: { from?: string; days?: number }) => `?${new URLSearchParams({ from: p.from ?? from, days: String(p.days ?? days) })}`;

  // Two half-columns per day: stays start at the afternoon half and end at the morning half.
  const half = days > 14 ? "1.05rem" : days > 7 ? "1.5rem" : "1.75rem";
  // Phones: fixed day width (scroll sideways). Larger screens: days share the width.
  const grid = { gridTemplateColumns: `var(--label) repeat(${days * 2}, var(--track))` };
  const dayCols = (i: number) => `${2 + 2 * i} / span 2`;
  const months = dates.reduce<{ name: string; start: number; span: number }[]>((acc, d, i) => {
    const m = mon(d);
    if (acc.at(-1)?.name === m) acc.at(-1)!.span++; else acc.push({ name: m, start: i, span: 1 });
    return acc;
  }, []);
  const todayIdx = dates.indexOf(today);

  return (
    <div className="w-full space-y-4">
      {/* Slim header */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-violet-400 to-indigo-600 text-white shadow-[0_10px_24px_-12px_rgb(139_92_246)]"><CalendarRange className="size-6" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">Room schedule · {user.roleName}</p>
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">Every room, every night</h1>
              <p className="text-xs text-muted-foreground">Tap a booking to see its guest, dates and bill{canBook ? " · tap an empty night to book it" : ""}.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/staff/reservations" className={buttonVariants({ variant: "outline", size: "sm" })}><List /> List</Link>
            {canBook && <Link href="/staff/reservations/new" className={buttonVariants({ size: "sm" })}><CalendarPlus /> New booking</Link>}
          </div>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_2px_4px_rgba(15,23,42,0.03),0_12px_32px_-18px_rgba(15,23,42,0.18)]">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
          <div className="flex items-center rounded-xl border border-border/70 p-0.5">
            <Link aria-label="Earlier" href={link({ from: addDays(from, -days) })} className="grid size-8 place-items-center rounded-lg hover:bg-muted"><ChevronLeft className="size-4" /></Link>
            <Link href={link({ from: today })} className={cn("rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-muted", from === today && "text-muted-foreground")}>Today</Link>
            <Link aria-label="Later" href={link({ from: addDays(from, days) })} className="grid size-8 place-items-center rounded-lg hover:bg-muted"><ChevronRight className="size-4" /></Link>
          </div>
          <h2 className="px-1 text-base font-semibold tracking-tight">
            <span className="tabular-nums">{formatShortDate(from)}</span> <span className="text-muted-foreground">–</span> <span className="tabular-nums">{formatShortDate(addDays(to, -1))}</span>
          </h2>
          <form className="flex items-center gap-1">
            <input type="hidden" name="days" value={days} />
            <input type="date" name="from" defaultValue={from} aria-label="Jump to date" className="h-8 rounded-lg border border-border/70 bg-transparent px-2 text-xs" />
            <button className="h-8 rounded-lg px-2.5 text-xs font-medium hover:bg-muted">Go</button>
          </form>
          <div className="ml-auto flex rounded-xl bg-muted p-0.5 text-xs">
            {SPANS.map((s) => (
              <Link key={s.n} href={link({ days: s.n })} className={cn("rounded-lg px-3 py-1.5 font-medium transition-colors", s.n === days ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{s.label}</Link>
            ))}
          </div>
        </div>

        {/* At a glance */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-border/70 px-4 py-2 text-xs">
          <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", fullNights.length ? "bg-rose-500" : "bg-emerald-500")} />
            {fullNights.length ? <><strong>{fullNights.length}</strong> fully booked night{fullNights.length === 1 ? "" : "s"}: {fullNights.slice(0, 3).map((d) => formatBusinessDate(d)).join(", ")}{fullNights.length > 3 ? "…" : ""}</> : "Rooms free every night"}
          </span>
          <span className="text-muted-foreground"><strong className="text-foreground">{booked}%</strong> booked</span>
          <span className="text-muted-foreground">Fewest free: <strong className={cn("text-foreground", fewest <= 3 && "text-amber-600 dark:text-amber-400")}>{fewest}</strong> on {formatBusinessDate(dates[freePerNight.indexOf(fewest)])}</span>
          {clashes > 0 && <span className="flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400"><TriangleAlert className="size-3.5" />{clashes} room{clashes === 1 ? "" : "s"} with two guests at once — sort out</span>}
          <span className="ml-auto hidden flex-wrap gap-3 text-muted-foreground lg:flex">
            {(Object.keys(BAR) as Tone[]).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", BAR[k].dot)} />{BAR[k].label}</span>)}
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-max px-1 pb-2 text-xs [--label:5rem] [--track:var(--half)] sm:min-w-0 sm:[--label:8.5rem] sm:[--track:minmax(var(--half),1fr)]" style={{ "--half": half } as React.CSSProperties}>
            {/* Months */}
            <div className="grid" style={grid}>
              <div className="sticky left-0 z-30 bg-card" />
              {months.map((m) => (
                <div key={m.name + m.start} style={{ gridColumn: `${2 + 2 * m.start} / span ${m.span * 2}` }} className="truncate border-l border-border/60 px-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:border-l-0">{m.name}</div>
              ))}
            </div>
            {/* Days */}
            <div className="grid" style={grid}>
              <div className="sticky left-0 z-30 bg-card" />
              {dates.map((d, i) => {
                const isToday = d === today;
                const weekend = ["Sat", "Sun"].includes(wd(d));
                return (
                  <div key={d} style={{ gridColumn: dayCols(i) }} className="flex flex-col items-center gap-0.5 py-1.5">
                    <span className={cn("text-[10px] font-medium uppercase", weekend ? "text-amber-600/80 dark:text-amber-400/80" : "text-muted-foreground")}>{days > 14 ? wd(d)[0] : wd(d)}</span>
                    <span className={cn("grid size-7 place-items-center rounded-full text-[13px] font-semibold tabular-nums", isToday && "bg-[oklch(0.75_0.13_80)] text-black")}>{Number(d.slice(8))}</span>
                  </div>
                );
              })}
            </div>
            {/* Free rooms per night */}
            <div className="grid items-center border-b border-border/70 pb-2" style={grid}>
              <div className="sticky left-0 z-30 bg-card pl-3 text-[11px] font-medium text-muted-foreground">Rooms free</div>
              {freePerNight.map((f, i) => {
                const pct = rooms.length ? (rooms.length - f) / rooms.length : 0;
                return (
                  <div key={i} style={{ gridColumn: dayCols(i) }} className="px-0.5" title={`${f} of ${rooms.length} rooms free on ${formatBusinessDate(dates[i])}`}>
                    {f === 0 ? (
                      <span className="block rounded-md bg-rose-500 py-0.5 text-center text-[10px] font-bold uppercase text-white">Full</span>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <span className={cn("text-[11px] font-semibold tabular-nums", f <= 3 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>{f}</span>
                        <span className="h-1 w-full max-w-8 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", f <= 3 ? "bg-amber-500" : "bg-emerald-500/70")} style={{ width: `${Math.round(pct * 100)}%` }} /></span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {groups.map((g) => (
              <div key={g.name}>
                <div className="grid" style={grid}>
                  <div className="sticky left-0 z-30 col-span-1 bg-card px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.name}</div>
                  <div style={{ gridColumn: `2 / span ${days * 2}` }} className="mb-1 mt-4 border-t border-dashed border-border/70" />
                </div>
                {g.rooms.map((r) => {
                  const n = lanes.get(r.id) ?? 1;
                  const rows = `1 / span ${n}`;
                  return (
                    <div key={r.id} className="group/row grid rounded-lg hover:bg-muted/40" style={{ ...grid, gridTemplateRows: `repeat(${n}, 2.5rem)` }}>
                      <div className="sticky left-0 z-20 flex items-center gap-2 bg-card pl-3 pr-2 group-hover/row:bg-muted" style={{ gridRow: rows, gridColumn: 1 }}>
                        <span className="text-sm font-semibold tabular-nums">{r.number}</span>
                        {n > 1 && <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400" title="Two stays on the same night — an overdue guest is still in the room"><TriangleAlert className="size-3" />Clash</span>}
                      </div>
                      {dates.map((d, i) => {
                        const cell = cn("border-l border-border/40", i === todayIdx && "bg-[oklch(0.75_0.13_80)]/[0.07]");
                        const style = { gridRow: rows, gridColumn: dayCols(i) };
                        return canBook && !taken.get(r.id)![i] && d >= today ? (
                          <Link key={d} href={`/staff/reservations/new?room=${r.id}&from=${d}`} style={style} title={`Book room ${r.number} from ${formatBusinessDate(d)}`}
                            className={cn(cell, "group/cell grid place-items-center hover:bg-primary/10")}>
                            <CalendarPlus className="size-3.5 text-primary opacity-0 transition-opacity group-hover/cell:opacity-100" />
                          </Link>
                        ) : <div key={d} className={cell} style={style} />;
                      })}
                      {(bars.get(r.id) ?? []).map((b) => {
                        const startLine = b.clipL ? 2 + 2 * b.start : 3 + 2 * b.start;
                        const endLine = b.clipR ? 2 + 2 * days : 3 + 2 * b.end;
                        const span = endLine - startLine; // in half-days
                        const wide = span * (days > 14 ? 1 : 1.6) >= 5;
                        const cls = cn("relative z-10 my-1 flex min-w-0 items-center gap-1.5 overflow-hidden border-l-[3px] px-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-[box-shadow,transform] hover:z-20 hover:-translate-y-px hover:shadow-md",
                          BAR[b.tone].cls, b.clipL ? "rounded-l-none border-l-0" : "rounded-l-lg", b.clipR ? "rounded-r-none" : "rounded-r-lg");
                        const inner = (
                          <>
                            {wide && b.tone !== "BLOCK" && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/70 text-[9px] font-bold text-foreground/80 dark:bg-black/25 dark:text-white/85">{initials(b.title)}</span>}
                            <span className="min-w-0 leading-tight">
                              <span className="block truncate text-[11px] font-semibold">{b.title}</span>
                              {span >= 4 && <span className="block truncate text-[10px] opacity-70">{b.nights ? `${b.nights} night${b.nights === 1 ? "" : "s"} · ` : ""}{b.sub}</span>}
                            </span>
                          </>
                        );
                        const style = { gridRow: b.lane + 1, gridColumn: `${startLine} / ${endLine}` };
                        const title = `${b.title} · ${BAR[b.tone].label} · ${b.sub}`;
                        return b.info
                          ? <BookingBar key={b.key} className={cls} style={style} title={title} info={b.info}>{inner}</BookingBar>
                          : <div key={b.key} className={cls} style={style} title={title}>{inner}</div>;
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border/70 px-4 py-2.5 text-[11px] text-muted-foreground lg:hidden">
          {(Object.keys(BAR) as Tone[]).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", BAR[k].dot)} />{BAR[k].label}</span>)}
        </div>
        <p className="border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">Stays run from the afternoon they arrive to the morning they leave. Tap a booking for its card{canBook ? "; tap an empty night to book that room" : ""}.</p>
      </section>
    </div>
  );
}
