"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, BedDouble, CalendarX, Clock, Hourglass, Moon, Presentation, Tag, Trophy, Users, type LucideIcon } from "lucide-react";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ROOM_STATUS_META } from "@/lib/room-status";
import { MEETING_ROOM_STATUS_LABEL, timeRange } from "@/lib/meeting";
import { meetingInsightAction, roomInsightAction } from "@/app/staff/(app)/rooms/actions";
import type { ActionResult } from "@/server/errors";
import type { MeetingInsight, RoomInsight } from "@/server/services/room-insight";
import type { RoomBoardRoom } from "@/server/services/rooms";

const n = (v: number) => v.toLocaleString("en-US");
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }).slice(0, 2);

/** Loads a card's performance when a manager or the MD opens it. */
function useInsight<T>(load: (input: { roomId: string }) => Promise<ActionResult<T>>, roomId: string, enabled: boolean) {
  const [data, setData] = useState<{ id: string; v: T } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void load({ roomId }).then((r) => { if (live && r.ok) setData({ id: roomId, v: r.data }); });
    return () => { live = false; };
  }, [load, roomId, enabled]);
  return data?.id === roomId ? data.v : null;
}
export const useRoomInsight = (roomId: string, enabled: boolean) => useInsight(roomInsightAction, roomId, enabled);
export const useMeetingInsight = (roomId: string, enabled: boolean) => useInsight(meetingInsightAction, roomId, enabled);

// ───────────────────────── shared parts (rooms, the meeting room — like the table card) ─────────────────────────

function Head({ number, title, dot, status, subtitle, glow, minis }: {
  number: string; title: string; dot: string; status: string; subtitle: string; glow: string; minis: { label: string; value: string; strong?: boolean }[];
}) {
  return (
    <div className="relative overflow-hidden bg-[#15110c] px-5 py-5 text-white">
      <div aria-hidden className={cn("absolute -right-16 -top-20 size-56 rounded-full blur-3xl", glow)} />
      <DialogClose render={<button type="button" aria-label="Close" className="absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20" />}>
        <span aria-hidden className="text-lg leading-none">×</span>
      </DialogClose>
      <div className="relative flex items-center gap-4 pr-8">
        <span className="grid h-14 min-w-14 shrink-0 place-items-center rounded-2xl bg-white/10 px-2 text-xl font-bold tabular-nums ring-1 ring-white/15">{number}</span>
        <div className="min-w-0">
          <DialogTitle className="truncate text-xl text-white">{title}</DialogTitle>
          <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/60">
            <span className="inline-flex items-center gap-1"><span className={cn("size-1.5 rounded-full", dot)} />{status}</span><span>·</span><span>{subtitle}</span>
          </DialogDescription>
        </div>
      </div>
      <div className="relative mt-4 grid grid-cols-3 gap-2">
        {minis.map((m) => (
          <div key={m.label} className="min-w-0 rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10">
            <p className="truncate text-[10px] uppercase tracking-wider text-white/50">{m.label}</p>
            <p className={cn("truncate font-semibold tabular-nums", m.strong ? "text-lg text-emerald-300" : "text-base")}>{m.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Rows({ rows, bar, barClass }: { rows: { icon: LucideIcon; label: string; value: string }[]; bar?: number; barClass: string }) {
  return (
    <div className="space-y-1.5 text-sm">
      {rows.map(({ icon: Icon, label, value }) => (
        <p key={label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-muted-foreground"><Icon className="size-3.5 shrink-0" />{label}</span>
          <span className="text-right font-medium tabular-nums">{value}</span>
        </p>
      ))}
      {bar != null && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", barClass)} style={{ width: `${Math.min(100, bar)}%` }} /></div>}
    </div>
  );
}

function Bars({ title, total, points, color, empty }: { title: string; total: string; points: { d: string; value: number; label: string }[]; color: string; empty: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const any = points.some((p) => p.value > 0);
  return (
    <div>
      <p className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span className="flex items-center gap-1.5"><Moon className="size-3.5" />{title}</span>
        <span className="normal-case tracking-normal tabular-nums">{total}</span>
      </p>
      {!any ? <p className="rounded-2xl bg-muted/50 px-3 py-3 text-center text-xs text-muted-foreground">{empty}</p> : (
        <div className="grid h-20 items-end gap-1" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
          {points.map((p, i) => (
            <div key={p.d} className="flex h-full flex-col items-center justify-end gap-1" title={`${day(p.d)} · ${p.label}`}>
              <span className={cn("w-full rounded-[4px]", p.value ? color : "bg-muted", p.value && i !== points.length - 1 && "opacity-50")} style={{ height: p.value ? `${Math.max(12, (p.value / max) * 100)}%` : "6%" }} />
              <span className={cn("text-[9px] text-muted-foreground", i === points.length - 1 && "font-semibold text-foreground")}>{weekday(p.d)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Latest({ title, empty, items }: { title: string; empty: string; items: { id: string; href: string; title: string; now?: boolean; sub: string; amount: number }[] }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><Clock className="size-3.5" />{title}</p>
      {items.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">{empty}</p> : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
          {items.map((s) => (
            <li key={s.id}>
              <Link href={s.href} className="flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/40">
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-medium">{s.title}{s.now && <span className="ml-1.5 rounded-full bg-sky-500/15 px-1.5 text-[10px] font-semibold text-sky-600 dark:text-sky-300">now</span>}</span>
                  <span className="block truncate text-xs text-muted-foreground">{s.sub}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{n(s.amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Links({ roomId }: { roomId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/staff/rooms/${roomId}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><BedDouble className="size-3.5" />Room page<ArrowUpRight className="size-3.5" /></Link>
      <Link href="/staff/finance/rooms" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Trophy className="size-3.5" />All rooms&apos; performance</Link>
    </div>
  );
}

const Loading = () => <div className="h-24 animate-pulse rounded-2xl bg-muted/50" />;

// ───────────────────────── guest rooms ─────────────────────────

/** The card's dark head, like the table card: number, type, status, rate — and this month in three figures. */
export function InsightHeader({ room, overdue, data }: { room: RoomBoardRoom; overdue: boolean; data: RoomInsight | null }) {
  const meta = ROOM_STATUS_META[room.displayStatus];
  return (
    <Head number={room.number} title={`Room ${room.number}`} dot={overdue ? "bg-rose-500" : meta.dot} status={overdue ? "Checkout overdue" : meta.label}
      subtitle={`${room.roomType.name} · TZS ${n(room.roomType.baseRate)} a night`} glow="bg-violet-500/20"
      minis={[
        { label: `Earned · ${data?.month.label ?? "this month"}`, value: data ? (data.month.earned ? n(data.month.earned) : "—") : "…", strong: true },
        { label: "Nights sold", value: data ? `${data.month.nights}${data.month.dayUse ? ` + ${data.month.dayUse}` : ""}` : "…" },
        { label: "Occupancy", value: data ? `${data.month.occupancy}%` : "…" },
      ]} />
  );
}

/** How the room is doing against the others (under the head). */
export function InsightRows({ data }: { data: RoomInsight | null }) {
  if (!data) return <Loading />;
  const m = data.month;
  const vsBest = m.best ? Math.round((m.earned / m.best) * 100) : 0;
  return (
    <Rows barClass="bg-linear-to-r from-violet-500 to-sky-400" bar={vsBest} rows={[
      { icon: Tag, label: "Average rate", value: m.averageRate ? `TZS ${n(m.averageRate)}` : "—" },
      { icon: Users, label: "Guests this month", value: `${m.guests}${m.discount ? ` · TZS ${n(m.discount)} discounts` : ""}` },
      { icon: Trophy, label: "Rank among the rooms", value: m.rank && m.earned ? `#${m.rank} of ${m.rooms} · ${vsBest}% of the best` : "not sold yet this month" },
    ]} />
  );
}

/** The last 14 nights (sold or empty) and the latest guests. */
export function InsightHistory({ data, room }: { data: RoomInsight | null; room: RoomBoardRoom }) {
  if (!data) return null;
  const sold = data.last14.filter((d) => d.sold).length;
  return (
    <>
      <Bars title={`Last 14 nights · ${sold} sold`} total={`TZS ${n(data.last14.reduce((t, d) => t + d.amount, 0))}`} color="bg-violet-500"
        empty="No night sold in the last 14 days." points={data.last14.map((d) => ({ d: d.d, value: d.amount, label: d.sold ? `TZS ${n(d.amount)}` : "empty" }))} />
      <Latest title="Latest guests" empty="No guest has stayed in this room yet."
        items={data.stays.map((s) => ({
          id: s.id, href: `/staff/reservations/${s.reservationId}`, title: s.guest, now: s.status === "CHECKED_IN", amount: s.amount,
          sub: `${day(s.from)}${s.to !== s.from ? ` → ${day(s.to)}` : ""} · ${s.dayUse ? "short time" : `${s.nights} night${s.nights === 1 ? "" : "s"}`} · ${s.reference}`,
        }))} />
      <Links roomId={room.id} />
    </>
  );
}

// ───────────────────────── the meeting room ─────────────────────────

/** The meeting room's dark head: this month's income, bookings and how much of the open hours were used. */
export function MeetingInsightHeader({ room, status, data }: { room: RoomBoardRoom; status: string; data: MeetingInsight | null }) {
  return (
    <Head number={room.number} title={room.roomType.name} dot={ROOM_STATUS_META[status as keyof typeof ROOM_STATUS_META]?.dot ?? "bg-emerald-500"} status={MEETING_ROOM_STATUS_LABEL[status] ?? status}
      subtitle={`TZS ${n(room.roomType.baseRate)} per booking · by time`} glow="bg-emerald-500/20"
      minis={[
        { label: `Income · ${data?.month.label ?? "this month"}`, value: data ? (data.month.income ? n(data.month.income) : "—") : "…", strong: true },
        { label: "Bookings", value: data ? String(data.month.bookings) : "…" },
        { label: "Used", value: data ? `${data.month.utilisation}%` : "…" },
      ]} />
  );
}

/** Hours used, cancellations, the last 14 days and the latest meetings. */
export function MeetingInsightBody({ data, room }: { data: MeetingInsight | null; room: RoomBoardRoom }) {
  if (!data) return <Loading />;
  const m = data.month;
  const total = data.last14.reduce((t, d) => t + d.hours, 0);
  return (
    <>
      <Rows barClass="bg-linear-to-r from-emerald-500 to-teal-400" bar={m.utilisation} rows={[
        { icon: Hourglass, label: "Hours booked", value: `${m.hours} of ${m.openHours} open hours` },
        { icon: Tag, label: "Average per booking", value: m.perBooking ? `TZS ${n(m.perBooking)}` : "—" },
        { icon: Presentation, label: "Completed", value: `${m.completed} of ${m.bookings}` },
        { icon: CalendarX, label: "Cancelled · no-shows", value: `${m.cancelled} · ${m.noShows}` },
      ]} />
      <Bars title="Last 14 days · hours booked" total={`${Math.round(total * 10) / 10} h`} color="bg-emerald-500" empty="No meeting in the last 14 days."
        points={data.last14.map((d) => ({ d: d.d, value: d.hours, label: d.hours ? `${d.hours} h` : "free" }))} />
      <Latest title="Latest meetings" empty="No meeting yet."
        items={data.latest.map((b) => ({
          id: b.id, href: `/staff/reservations/${b.reservationId}`, title: b.who, now: b.status === "CHECKED_IN", amount: b.amount,
          sub: `${day(b.date)} · ${timeRange(b.startAt, b.endAt)} · ${b.reference}${b.status === "NO_SHOW" ? " · no-show" : ""}`,
        }))} />
      <Links roomId={room.id} />
    </>
  );
}
