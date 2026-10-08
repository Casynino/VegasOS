"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarRange, Moon, Presentation, Tag, Trophy, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";
import { CARD_META, type CardState } from "@/components/staff/rooms/room-card";

export type RoomRow = {
  id: string; number: string; type: string; meeting: boolean; status: string; dot: string;
  /** Its status as the front desk board shows it (same colours). */
  state: CardState;
  nights: number; shortTime: number; income: number; discount: number; occupancy: number;
  now: { guest: string; reservationId: string; until: string } | null;
  stays: { reservationId: string; reference: string; guest: string; guestId: string; from: string; to: string; nights: number; income: number }[];
};

const n = (v: number) => v.toLocaleString("en-US");
const day = (d: string, t: T) => new Date(`${d}T00:00:00Z`).toLocaleDateString(t.intl, { day: "numeric", month: "short", timeZone: "UTC" });

/** Every room — floor by floor (a tinted tile each: the greener, the more it earned) or ranked by income. Tap one for its detail. */
export function RoomCards({ rows, period, days }: { rows: RoomRow[]; period: string; days: number }) {
  const t = useT();
  const [sort, setSort] = useState<"floor" | "income">("floor");
  const [open, setOpen] = useState<RoomRow | null>(null);
  const [only, setOnly] = useState<CardState | null>(null);
  const best = Math.max(1, ...rows.map((r) => r.income));
  const states = (Object.keys(CARD_META) as CardState[]).map((k) => ({ k, count: rows.filter((r) => r.state === k).length })).filter((x) => x.count > 0);
  const floors = [...new Set(rows.map((r) => floorOf(r.number)))].map((key) => {
    const rooms = rows.filter((r) => floorOf(r.number) === key);
    const guestRooms = rooms.filter((r) => !r.meeting);
    const nights = guestRooms.reduce((t, r) => t + r.nights, 0);
    return { key, rooms, income: rooms.reduce((t, r) => t + r.income, 0), nights, full: guestRooms.length ? Math.round((nights / (guestRooms.length * days)) * 100) : 0 };
  });
  // Every floor on one line: as many columns as the biggest floor has rooms (rooms line up floor over floor).
  const perRow = Math.min(10, Math.max(...floors.map((f) => f.rooms.length)));
  const earners = [...rows].filter((r) => r.income > 0).sort((a, b) => b.income - a.income);
  const unsold = rows.length - earners.length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t("Room by room")}</h2>
          <p className="text-xs text-muted-foreground">{sort === "floor" ? t("Colour: the room's status right now · green figure: what it earned in the period") : t("Rooms that earned in the period, best first")}</p>
        </div>
        <div role="tablist" className="inline-flex rounded-xl border border-border/70 bg-card p-0.5 text-xs font-medium">
          {([["floor", t("By floor")], ["income", t("Top earners")]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={sort === k} onClick={() => setSort(k)}
              className={cn("rounded-lg px-3 py-1.5 transition-colors", sort === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{label}</button>
          ))}
        </div>
      </div>

      {sort === "floor" && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setOnly(null)} aria-pressed={!only}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors", !only ? "border-transparent bg-foreground text-background" : "border-border/70 bg-card text-muted-foreground hover:text-foreground")}>
            {t("All")}<span className="tabular-nums opacity-70">{rows.length}</span>
          </button>
          {states.map(({ k, count }) => (
            <button key={k} type="button" onClick={() => setOnly(only === k ? null : k)} aria-pressed={only === k}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors", only === k ? "border-foreground/30 bg-muted text-foreground" : "border-border/70 bg-card text-muted-foreground hover:text-foreground")}>
              <span className={cn("size-2 rounded-full", CARD_META[k].dot)} />{t(CARD_META[k].label)}<span className="tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      {sort === "floor" ? floors.filter((f) => !only || f.rooms.some((r) => r.state === only)).map((f) => (
        <div key={f.key} className="rounded-3xl border border-border/70 bg-card p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
            <p className="text-sm font-semibold">{f.key === "·" ? t("Other rooms") : t("Floor {floor}", { floor: f.key })} <span className="font-normal text-muted-foreground">· {t.plural(f.rooms.length, "{n} room", "{n} rooms")}</span></p>
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span>{t.rich("<b>{amount}</b> earned", { b: (c) => <strong className={cn("font-semibold tabular-nums", f.income ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>{c}</strong> }, { amount: n(f.income) })}</span>
              <span>{f.nights === 1
                ? t.rich("<b>{n}</b> night", { b: (c) => <strong className="font-semibold tabular-nums text-foreground">{c}</strong> }, { n: f.nights })
                : t.rich("<b>{n}</b> nights", { b: (c) => <strong className="font-semibold tabular-nums text-foreground">{c}</strong> }, { n: f.nights })}</span>
              <span>{t.rich("<b>{pct}%</b> full", { b: (c) => <strong className="font-semibold tabular-nums text-foreground">{c}</strong> }, { pct: f.full })}</span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:[grid-template-columns:repeat(var(--per-row),minmax(0,1fr))]" style={{ "--per-row": perRow } as React.CSSProperties}>
            {f.rooms.filter((r) => !only || r.state === only).map((r) => <Tile key={r.id} r={r} best={best} onOpen={() => setOpen(r)} />)}
          </div>
        </div>
      )) : (
        <div className="overflow-hidden rounded-3xl border border-border/70 bg-card">
          {earners.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("No room earned anything in this period.")}</p> : (
            <ol className="divide-y divide-border/60">
              {earners.map((r, i) => {
                const sold = r.nights + r.shortTime;
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpen(r)} className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 sm:grid-cols-[2rem_minmax(0,1.2fr)_minmax(0,2fr)_auto]">
                      <span className={cn("grid size-7 place-items-center rounded-lg text-xs font-bold tabular-nums", i === 0 ? "bg-[oklch(0.72_0.12_80)]/20 text-[oklch(0.55_0.12_78)] dark:text-[#f0cf86]" : "bg-muted text-muted-foreground")}>{i + 1}</span>
                      <span className="min-w-0 leading-tight">
                        <span className="flex items-center gap-2"><span className="text-base font-bold tabular-nums">{r.number}</span><span className={cn("size-1.5 rounded-full", r.dot)} title={t(r.status)} /></span>
                        <span className="block truncate text-xs text-muted-foreground">{t(r.type)} · {t.plural(r.nights, "{n} night", "{n} nights")}{r.shortTime ? ` + ${t("{n} short", { n: r.shortTime })}` : ""} · {t("average {amount}", { amount: n(Math.round(r.income / Math.max(1, sold))) })}</span>
                      </span>
                      <span className="hidden h-2 overflow-hidden rounded-full bg-muted sm:block"><span className="block h-full rounded-full bg-linear-to-r from-emerald-500 to-teal-400" style={{ width: `${(r.income / best) * 100}%` }} /></span>
                      <span className="text-right font-semibold tabular-nums">{n(r.income)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {unsold > 0 && <p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">{t.plural(unsold, "{n} room earned nothing in this period — see them By floor.", "{n} rooms earned nothing in this period — see them By floor.")}</p>}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(v) => { if (!v) setOpen(null); }}>
        <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
          {open && <Detail r={open} period={period} days={days} best={best} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

const floorOf = (number: string) => (/^\d{3,}$/.test(number) ? number.slice(0, number.length - 2) : "·");

/** One room, as on the front desk board (status colour, who is in it, when they leave) — plus what it earned. */
function Tile({ r, best, onOpen }: { r: RoomRow; best: number; onOpen: () => void }) {
  const t = useT();
  const m = CARD_META[r.state];
  const Icon = m.icon;
  const sold = r.nights + r.shortTime;
  return (
    <button type="button" onClick={onOpen} title={`${t("Room {room}", { room: r.number })} · ${t(m.label)}`}
      className={cn("group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-card bg-linear-to-br to-transparent to-60% py-2.5 pl-3.5 pr-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-[0_12px_26px_-16px_rgba(15,23,42,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-white/[0.12] dark:bg-white/[0.035]", m.tint, m.hover)}>
      <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r-full", m.dot)} />
      <span className="flex items-center justify-between gap-1.5">
        <span className="text-lg font-semibold leading-none tracking-tight tabular-nums">{r.number}</span>
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full ring-2 ring-card", m.dot)} />
      </span>
      <span className="mt-1 flex items-center gap-1 truncate text-[10px] text-muted-foreground">{r.meeting && <Presentation className="size-3 shrink-0" />}{t(r.type)}</span>
      <span className={cn("mt-2 truncate text-xs", r.now ? "font-medium" : "text-muted-foreground")}>{r.now?.guest ?? t(m.label)}</span>
      <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground"><Icon className="size-3 shrink-0 opacity-70" /><span className="truncate">{r.now ? t("leaves {date}", { date: day(r.now.until, t) }) : t(m.label)}</span></span>
      <span className="mt-2 flex items-baseline justify-between gap-1 border-t border-dashed border-border/70 pt-1.5">
        <span className={cn("text-xs font-semibold tabular-nums", r.income ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/60")}>{r.income ? n(r.income) : "—"}</span>
        <span className="truncate text-[10px] text-muted-foreground">{sold ? t.plural(sold, "{count} night", "{count} nights", { count: `${r.nights}${r.shortTime ? `+${r.shortTime}` : ""}` }) : t("not sold")}</span>
      </span>
      <span className="mt-1 h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${(r.income / best) * 100}%` }} /></span>
    </button>
  );
}

function Detail({ r, period, days, best }: { r: RoomRow; period: string; days: number; best: number }) {
  const t = useT();
  const sold = r.nights + r.shortTime;
  return (
    <>
      {/* The content has no padding (p-0): the band starts at the edge. The room number takes the icon's place;
          the tile sits at the top so the figures below can run the band's full width. */}
      <DialogHeader icon={<span className="text-base font-bold tabular-nums">{r.number}</span>} eyebrow={t("Rooms")} tone="emerald" className="mx-0 mt-0 [&>div:last-child]:items-start">
        <DialogTitle>{t("Room {room}", { room: r.number })}</DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-x-2">
          <span>{t(r.type)}</span><span>·</span><span className="inline-flex items-center gap-1"><span className={cn("size-1.5 rounded-full", r.dot)} />{t(r.status)}</span>
        </DialogDescription>
        {/* Pulled back under the tile (size-11 / sm:size-12 + gap-3.5) and over the close button's room (pr-8). */}
        <div className="relative mt-3 -mr-8 -ml-[3.625rem] grid grid-cols-3 gap-2 sm:-ml-[3.875rem]">
          <Mini label={t("Earned")} value={r.income ? n(r.income) : "—"} strong />
          <Mini label={t("Nights · {days}d", { days })} value={`${r.nights}${r.shortTime ? ` + ${r.shortTime}` : ""}`} />
          <Mini label={t("Average rate")} value={sold ? n(Math.round(r.income / sold)) : "—"} />
        </div>
      </DialogHeader>

      <div className="space-y-4 p-5">
        <div className="space-y-1.5 text-sm">
          <Row icon={Moon} label={t("Nights sold in the period")} value={t.plural(days, "{pct}% of {n} night", "{pct}% of {n} nights", { pct: r.occupancy })} />
          <Row icon={Tag} label={t("Discounts given")} value={r.discount ? `− ${n(r.discount)}` : t("none")} />
          <Row icon={Trophy} label={t("Against the best room")} value={`${Math.round((r.income / best) * 100)}%`} />
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-linear-to-r from-emerald-500 to-teal-400" style={{ width: `${(r.income / best) * 100}%` }} /></div>
        </div>

        {r.now && (
          <Link href={`/staff/reservations/${r.now.reservationId}`} className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] px-3.5 py-2.5 text-sm transition-colors hover:bg-emerald-500/10">
            <UserRound className="size-4 shrink-0 text-emerald-500" />
            <span className="min-w-0 flex-1 leading-tight"><span className="block font-medium">{r.now.guest}</span><span className="text-xs text-muted-foreground">{t("In the room now · leaves {date}", { date: day(r.now.until, t) })}</span></span>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        )}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><CalendarRange className="size-3.5" />{t("Stays · {period}", { period })}</p>
          {r.stays.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{t("Nobody stayed in this room in the period.")}</p> : (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
              {r.stays.map((s) => (
                <li key={s.reservationId}>
                  <Link href={`/staff/reservations/${s.reservationId}`} className="flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/40">
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-medium">{s.guest}</span>
                      <span className="block truncate text-xs text-muted-foreground">{day(s.from, t)}{s.to !== s.from ? ` → ${day(s.to, t)}` : ""} · {t.plural(s.nights, "{n} night", "{n} nights")} · {s.reference}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{n(s.income)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
          <Link href={`/staff/rooms/${r.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted">{t("Room page")}<ArrowUpRight className="size-3.5" /></Link>
        </div>
      </div>
    </>
  );
}

function Mini({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10">
      <p className="text-[10px] uppercase tracking-wider text-white/50">{label}</p>
      <p className={cn("font-semibold tabular-nums", strong ? "text-lg text-emerald-300" : "text-base")}>{value}</p>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Moon; label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="size-3.5" />{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </p>
  );
}
