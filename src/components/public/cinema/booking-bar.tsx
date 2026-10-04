"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BedDouble, CalendarDays, Minus, Plus, Users } from "lucide-react";
import { addDays, isBusinessDate } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";

/**
 * The hero's floating glass booking bar. A plain GET form to /book (the one
 * booking-request flow), so it works before hydration and produces a shareable
 * URL. Desktop: one slim bar. Phone: a compact two-row control.
 */
export function HeroBookingBar({ minDate, maxDate, maxNights, roomTypes, defaultCheckIn }: {
  minDate: string;
  maxDate: string;
  maxNights: number;
  roomTypes: { slug: string; name: string }[];
  defaultCheckIn: string;
}) {
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(addDays(defaultCheckIn, 1));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const guestsRef = useRef<HTMLDivElement>(null);

  const validIn = isBusinessDate(checkIn);
  const minOut = validIn ? addDays(checkIn, 1) : addDays(minDate, 1);
  const maxOut = validIn ? addDays(checkIn, maxNights) : undefined;

  useEffect(() => {
    if (!guestsOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !guestsRef.current?.contains(e.target as Node)) setGuestsOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [guestsOpen]);

  function onCheckIn(v: string) {
    setCheckIn(v);
    if (isBusinessDate(v) && (!isBusinessDate(checkOut) || checkOut <= v)) setCheckOut(addDays(v, 1));
  }

  const cell = "group/cell relative flex min-w-0 flex-col justify-center rounded-2xl px-4 py-3 transition-colors hover:bg-white/[0.06] focus-within:bg-white/[0.08]";
  const label = "flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55";
  const value = "mt-1 w-full min-w-0 bg-transparent text-[15px] font-medium text-white outline-none [color-scheme:dark] placeholder:text-white/40";
  const guestsLabel = `${adults} adult${adults === 1 ? "" : "s"}${children ? `, ${children} child${children === 1 ? "" : "ren"}` : ""}`;

  return (
    <form action="/book" method="get" role="search" aria-label="Check availability"
      className="vlh-glass vlh-sweep grid grid-cols-2 gap-1 rounded-[1.75rem] p-2 text-white md:grid-cols-4 lg:grid-cols-[1fr_1fr_1.05fr_1.15fr_auto] lg:items-stretch">
      <div className={cell}>
        <label htmlFor="bb-in" className={label}><CalendarDays className="size-3 text-gold" aria-hidden="true" />Check-in</label>
        <input id="bb-in" name="checkIn" type="date" required min={minDate} max={maxDate} value={checkIn} onChange={(e) => onCheckIn(e.target.value)} className={value} />
      </div>
      <div className={cn(cell, "lg:before:absolute lg:before:inset-y-3 lg:before:left-0 lg:before:w-px lg:before:bg-white/12")}>
        <label htmlFor="bb-out" className={label}><CalendarDays className="size-3 text-gold" aria-hidden="true" />Check-out</label>
        <input id="bb-out" name="checkOut" type="date" required min={minOut} max={maxOut} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={value} />
      </div>

      <div ref={guestsRef} className={cn(cell, "lg:before:absolute lg:before:inset-y-3 lg:before:left-0 lg:before:w-px lg:before:bg-white/12")}>
        <span id="bb-guests-label" className={label}><Users className="size-3 text-gold" aria-hidden="true" />Guests</span>
        <button type="button" aria-labelledby="bb-guests-label bb-guests-value" aria-expanded={guestsOpen} aria-controls="bb-guests-panel"
          onClick={() => setGuestsOpen((o) => !o)} className={cn(value, "text-left focus-visible:outline-none")}>
          <span id="bb-guests-value" className="block truncate">{guestsLabel}</span>
        </button>
        <input type="hidden" name="adults" value={adults} />
        <input type="hidden" name="children" value={children} />
        {guestsOpen && (
          <div id="bb-guests-panel" role="group" aria-label="Guests"
            className="absolute bottom-full left-0 z-30 mb-3 w-64 rounded-2xl border border-white/10 bg-[#1a1510]/95 p-4 shadow-2xl backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 lg:bottom-auto lg:top-full lg:mb-0 lg:mt-3 lg:motion-safe:slide-in-from-top-2">
            {([["Adults", adults, setAdults, 1, 12], ["Children", children, setChildren, 0, 6]] as const).map(([name, v, set, min, max]) => (
              <div key={name} className="flex items-center justify-between py-2">
                <span className="text-sm">{name}</span>
                <span className="flex items-center gap-3">
                  <button type="button" onClick={() => set(Math.max(min, v - 1))} disabled={v <= min} aria-label={`Fewer ${name.toLowerCase()}`}
                    className="grid size-8 place-items-center rounded-full border border-white/20 transition-colors hover:border-gold disabled:opacity-30"><Minus className="size-3.5" /></button>
                  <span className="w-4 text-center tabular-nums" aria-live="polite">{v}</span>
                  <button type="button" onClick={() => set(Math.min(max, v + 1))} disabled={v >= max} aria-label={`More ${name.toLowerCase()}`}
                    className="grid size-8 place-items-center rounded-full border border-white/20 transition-colors hover:border-gold disabled:opacity-30"><Plus className="size-3.5" /></button>
                </span>
              </div>
            ))}
            <button type="button" onClick={() => setGuestsOpen(false)} className="mt-2 w-full rounded-full bg-white/10 py-2 text-sm hover:bg-white/15">Done</button>
          </div>
        )}
      </div>

      <div className={cn(cell, "lg:before:absolute lg:before:inset-y-3 lg:before:left-0 lg:before:w-px lg:before:bg-white/12")}>
        <label htmlFor="bb-type" className={label}><BedDouble className="size-3 text-gold" aria-hidden="true" />Room</label>
        <select id="bb-type" name="type" defaultValue="" className={cn(value, "cursor-pointer appearance-none [&>option]:bg-[#1a1510]")}>
          <option value="">Any room type</option>
          {roomTypes.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
        </select>
      </div>

      <button type="submit"
        className="group col-span-2 inline-flex h-14 md:col-span-4 items-center justify-center gap-3 rounded-[1.25rem] bg-gold px-7 text-sm font-semibold uppercase tracking-[0.14em] text-[#15120e] shadow-[0_14px_40px_-12px_oklch(0.72_0.12_80/0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white lg:col-span-1 lg:h-auto">
        Search rooms
        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
      </button>
    </form>
  );
}
