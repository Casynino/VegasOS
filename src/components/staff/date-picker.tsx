"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { calendarAvailabilityAction } from "@/app/staff/(app)/reservations/actions";
import { useT } from "@/i18n/client";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { englishT, type T } from "@/i18n/translate";

type Day = { free: number; paid: number; unpaid: number };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const add = (d: string, n: number) => { const x = parse(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const between = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);

/** "Sunday, 27 September 2026" — the date in words, never 27/09/2026 (in the person's language with `t`). */
export function longDate(d: string, shortDay = false, t: T = englishT) {
  const x = parse(d);
  if (t.locale !== DEFAULT_LOCALE) return new Intl.DateTimeFormat(t.intl, { weekday: shortDay ? "short" : "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(x);
  const day = DAYS[x.getUTCDay()];
  return `${shortDay ? day.slice(0, 3) : day}, ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}
/** "Today", "Tomorrow", "Yesterday", "In 5 days"… relative to the hotel day. */
export function dayWord(d: string, today: string, t: T = englishT) {
  const n = between(today, d);
  return n === 0 ? t("Today") : n === 1 ? t("Tomorrow") : n === -1 ? t("Yesterday") : n > 1 ? t("In {n} days", { n }) : t("{n} days ago", { n: -n });
}

/** Month cache shared by every picker on the page (free rooms per night). */
const cache = new Map<string, Record<string, Day>>();

/**
 * A date picker for stays: a large tile with the date in words ("Today ·
 * Sunday, 27 September 2026 · 14:00") that opens a month calendar. With
 * `availability`, each night shows how many guest rooms are free — rooms held
 * only by unpaid bookings count as still takeable; "Full" means paid bookings
 * fill the hotel.
 */
export function StayDatePicker({ label, value, onChange, min, max, today, time, range, availability = false, size = "lg", readOnly = false, hint }: {
  label: string; value: string; onChange?: (v: string) => void; min?: string; max?: string; today: string;
  /** Shown after the date, e.g. "14:00" (check-in) or "11:00" (check-out). */
  time?: string;
  /** The stay being chosen, lightly shaded in the calendar. */
  range?: { from: string; to: string } | null;
  availability?: boolean; size?: "lg" | "sm"; readOnly?: boolean;
  /** Small line under the date (e.g. "after 3 nights"). */
  hint?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value.slice(0, 7));
  const [fetched, setFetched] = useState<Record<string, Record<string, Day>>>({});
  const days = fetched[month] ?? cache.get(month) ?? null;
  const loading = open && availability && !days;

  // The 6-week grid for the month, starting on Monday.
  const grid = useMemo(() => {
    const first = parse(`${month}-01`);
    const start = add(`${month}-01`, -((first.getUTCDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => add(start, i));
  }, [month]);

  useEffect(() => {
    if (!open || !availability || cache.has(month)) return;
    let alive = true;
    calendarAvailabilityAction({ from: grid[0], to: grid[41] }).then((res) => {
      if (!alive || !res.ok) return;
      cache.set(month, res.data.days);
      setFetched((f) => ({ ...f, [month]: res.data.days }));
    });
    return () => { alive = false; };
  }, [open, availability, month, grid]);

  const [y, m] = month.split("-").map(Number);
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(iso(d).slice(0, 7)); };
  const canPrev = !min || `${month}-01` > min.slice(0, 7) + "-01";
  const off = (d: string) => (min && d < min) || (max && d > max);
  // Month and weekday names in this person's language (English exactly as before).
  const en = t.locale === DEFAULT_LOCALE;
  const monthShort = (d: string) => en ? MONTHS[parse(d).getUTCMonth()].slice(0, 3) : new Intl.DateTimeFormat(t.intl, { month: "short", timeZone: "UTC" }).format(parse(d));
  const monthTitle = en ? `${MONTHS[m - 1]} ${y}` : new Intl.DateTimeFormat(t.intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(parse(`${month}-01`));
  // 2024-01-01 was a Monday: the week's day names from Monday.
  const weekHead = (w: string, i: number) => en ? w.slice(0, 2) : new Intl.DateTimeFormat(t.intl, { weekday: "narrow", timeZone: "UTC" }).format(parse(add("2024-01-01", i)));

  const tile = (
    <span className={cn("group flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-muted/30 text-left transition-colors",
      size === "lg" ? "px-3.5 py-2.5" : "px-3 py-2", !readOnly && "hover:border-foreground/30 hover:bg-muted/50", open && "border-[oklch(0.75_0.13_80)] ring-2 ring-[oklch(0.75_0.13_80)]/25")}>
      <span className={cn("grid shrink-0 place-items-center rounded-xl bg-background text-center leading-none ring-1 ring-border/70", size === "lg" ? "size-11" : "size-10")}>
        <span className="block">
          <span className="block text-[9px] font-semibold uppercase tracking-wider text-[oklch(0.55_0.12_75)] dark:text-[#f0cf86]">{monthShort(value)}</span>
          <span className={cn("block font-bold tabular-nums", size === "lg" ? "text-lg" : "text-base")}>{parse(value).getUTCDate()}</span>
        </span>
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className={cn("block font-semibold leading-snug", size === "lg" ? "text-sm" : "text-[13px]")}>
          <span className="text-[oklch(0.55_0.12_75)] dark:text-[#f0cf86]">{dayWord(value, today, t)}</span> · {longDate(value, true, t)}{time && <span className="tabular-nums"> · {time}</span>}
        </span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {!readOnly && <CalendarDays className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />}
    </span>
  );
  if (readOnly || !onChange) return tile;

  return (
    <Popover open={open} onOpenChange={(o) => { if (o) setMonth(value.slice(0, 7)); setOpen(o); }}>
      <PopoverTrigger render={<button type="button" className="block w-full rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={t("{label}: {date} — change", { label, date: longDate(value, false, t) })} />}>
        {tile}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[19.5rem] gap-2 rounded-2xl p-2.5">
        <div className="flex items-center justify-between">
          <button type="button" disabled={!canPrev} onClick={() => shift(-1)} className="grid size-8 place-items-center rounded-lg hover:bg-muted disabled:opacity-30" aria-label={t("Previous month")}><ChevronLeft className="size-4" /></button>
          <p className="flex items-center gap-2 font-display text-base font-semibold">{monthTitle}{loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}</p>
          <button type="button" onClick={() => shift(1)} className="grid size-8 place-items-center rounded-lg hover:bg-muted" aria-label={t("Next month")}><ChevronRight className="size-4" /></button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {WEEK.map((w, i) => <span key={w} className="pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{weekHead(w, i)}</span>)}
          {grid.map((d) => {
            const inMonth = d.slice(0, 7) === month;
            const disabled = !!off(d);
            const a = availability ? days?.[d] : undefined;
            const full = a && a.free === 0 && a.unpaid === 0;
            const onlyUnpaid = a && a.free === 0 && a.unpaid > 0;
            const selected = d === value;
            const inRange = range && d >= range.from && d < range.to;
            return (
              <button key={d} type="button" disabled={disabled} onClick={() => { onChange(d); setOpen(false); }}
                title={a ? `${longDate(d, false, t)} — ${t.ctx("room", "{n} free", { n: a.free })}${a.unpaid ? ` · ${t("{n} held by unpaid bookings", { n: a.unpaid })}` : ""}${a.paid ? ` · ${t("{n} paid / confirmed", { n: a.paid })}` : ""}` : longDate(d, false, t)}
                className={cn("flex h-10 flex-col items-center justify-center rounded-lg text-[13px] transition-colors",
                  !inMonth && "opacity-40", disabled ? "cursor-not-allowed text-muted-foreground/40" : "hover:bg-muted",
                  inRange && !selected && "bg-[oklch(0.75_0.13_80)]/12",
                  selected && "bg-[oklch(0.75_0.13_80)] font-bold text-black hover:bg-[oklch(0.75_0.13_80)]",
                  d === today && !selected && "ring-1 ring-foreground/30")}>
                <span className="tabular-nums leading-none">{parse(d).getUTCDate()}</span>
                {availability && !disabled && a && (
                  <span className={cn("mt-0.5 text-[8px] font-semibold leading-none",
                    selected ? "text-black/70" : full ? "text-rose-600 dark:text-rose-400" : onlyUnpaid ? "text-amber-600 dark:text-amber-400" : a.free <= 3 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
                    {full ? t("Full") : onlyUnpaid ? t("Unpaid") : a.free}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {availability && (
          <p className="flex flex-wrap justify-center gap-x-2.5 gap-y-0.5 border-t border-border/70 pt-2 text-[10px] text-muted-foreground">
            <span><span className="text-emerald-600 dark:text-emerald-400">●</span> {t("rooms free")}</span>
            <span><span className="text-amber-600 dark:text-amber-400">●</span> {t("few / unpaid only")}</span>
            <span><span className="text-rose-600 dark:text-rose-400">●</span> {t("full (paid)")}</span>
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
