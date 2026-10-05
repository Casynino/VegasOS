"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, LoaderCircle } from "lucide-react";
import { addDays, isBusinessDate } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";
import { field } from "../kit/tokens";
import fx from "../room-fx.module.css";

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
// Native date pickers follow the page: light on paper, dark in the dark theme.
const scheme = "[color-scheme:light] pub-dark:[color-scheme:dark]";

/**
 * YOUR STAY, right on Book & pay (owner, 2026-10-05: "it should be easy to modify or add dates from here"): check-in,
 * check-out and guests, changed in place — the page prices it again for the new stay (and says so if the room is not
 * free then). What the guest already typed below stays.
 */
export function StayEditor({ stay, type, rooms, minDate, maxDate, maxNights, maxAdults, maxChildren, className }: {
  stay: { checkIn: string; checkOut: string; adults: number; children: number };
  type: string; rooms: number;
  minDate: string; maxDate: string; maxNights: number;
  /** For one room of this type (times the rooms booked). */
  maxAdults: number; maxChildren: number;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(stay);
  const nights = nightsBetween(v.checkIn, v.checkOut);

  function go(next: typeof stay) {
    setV(next);
    if (!isBusinessDate(next.checkIn) || !isBusinessDate(next.checkOut) || next.checkOut <= next.checkIn) return;
    const q = new URLSearchParams({ checkIn: next.checkIn, checkOut: next.checkOut, adults: String(next.adults), children: String(next.children), type, rooms: String(rooms) });
    start(() => router.replace(`/book?${q}`, { scroll: false }));
  }
  function onCheckIn(value: string) {
    if (!isBusinessDate(value)) { setV((x) => ({ ...x, checkIn: value })); return; }
    // Keep the same number of nights when the arrival moves (at least one).
    const keep = Math.min(Math.max(1, nightsBetween(v.checkIn, v.checkOut) || 1), maxNights);
    go({ ...v, checkIn: value, checkOut: v.checkOut > value && nightsBetween(value, v.checkOut) <= maxNights ? v.checkOut : addDays(value, keep) });
  }

  const adultsMax = Math.max(1, maxAdults * rooms);
  const childrenMax = Math.max(0, maxChildren * rooms);
  const label = "mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-pub-muted sm:text-[11px]";
  const input = cn(field.input, "min-w-0 px-3 sm:px-4", scheme);

  return (
    <div className={cn(fx.card, "relative p-5 sm:p-6", className)} aria-busy={pending || undefined}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[15px] font-medium"><CalendarDays className="size-4 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />Your stay</p>
        <span className="flex items-center gap-2 text-[13px] text-pub-muted" aria-live="polite">
          {pending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
          {pending ? "Updating the price…" : nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : "Choose the dates"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4 sm:gap-x-4">
        <label className="min-w-0">
          <span className={label}>Check-in</span>
          <input type="date" value={v.checkIn} min={minDate} max={maxDate} onChange={(e) => onCheckIn(e.target.value)} className={input} />
        </label>
        <label className="min-w-0">
          <span className={label}>Check-out</span>
          <input type="date" value={v.checkOut} min={isBusinessDate(v.checkIn) ? addDays(v.checkIn, 1) : addDays(minDate, 1)}
            max={isBusinessDate(v.checkIn) ? addDays(v.checkIn, maxNights) : undefined}
            onChange={(e) => go({ ...v, checkOut: e.target.value })} className={input} />
        </label>
        <label className="min-w-0">
          <span className={label}>Adults</span>
          <select value={v.adults} onChange={(e) => go({ ...v, adults: Number(e.target.value) })} className={cn(input, "appearance-auto pr-2")}>
            {Array.from({ length: adultsMax }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          <span className={label}>Children</span>
          <select value={v.children} disabled={childrenMax === 0} onChange={(e) => go({ ...v, children: Number(e.target.value) })} className={cn(input, "appearance-auto pr-2 disabled:opacity-60")}>
            {Array.from({ length: childrenMax + 1 }, (_, i) => i).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
