"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { addDays, isBusinessDate } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";
import { ArrowBadge } from "./pill-link";
import { glass, pillGold } from "./ui";

export interface StaySearchDefaults {
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  type?: string;
}

/**
 * Date & guests search. A plain GET form to /book, so it works without
 * JavaScript and produces a shareable URL; JS only keeps check-out after check-in.
 */
export function StaySearchForm({
  defaults,
  minDate,
  maxDate,
  maxNights,
  variant = "hero",
  errors,
  roomTypes,
  stacked = false,
  submitLabel = "Search availability",
  bare = false,
}: {
  defaults: StaySearchDefaults;
  minDate: string;
  maxDate: string;
  maxNights: number;
  variant?: "hero" | "panel";
  errors?: Record<string, string>;
  /** When given, shows a room-type picker; otherwise a preselected type is kept hidden. */
  roomTypes?: { slug: string; name: string }[];
  submitLabel?: string;
  /** Always two columns (for narrow side panels). */
  stacked?: boolean;
  /** No container styling (when embedded in another card). */
  bare?: boolean;
}) {
  const [checkIn, setCheckIn] = useState(defaults.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(defaults.checkOut ?? "");
  const validIn = isBusinessDate(checkIn);
  const minOut = validIn ? addDays(checkIn, 1) : addDays(minDate, 1);
  const maxOut = validIn ? addDays(checkIn, maxNights) : undefined;

  function onCheckIn(value: string) {
    setCheckIn(value);
    if (isBusinessDate(value) && (!isBusinessDate(checkOut) || checkOut <= value)) setCheckOut(addDays(value, 1));
  }

  const hero = variant === "hero";
  const label = cn("mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em]", hero ? "text-white/70" : "text-tone/70");
  const input = cn(
    "block h-12 w-full min-w-0 rounded-xl border px-3 text-base transition-colors focus:outline-none focus:ring-2 focus:ring-gold/70 [color-scheme:light]",
    hero
      ? "border-white/25 bg-white/95 text-tone focus:border-gold"
      : "border-tone/20 bg-panel text-tone focus:border-tone",
    "aria-invalid:border-red-700",
  );
  const err = cn("mt-1.5 text-sm", hero ? "text-red-200" : "text-red-700");

  return (
    <form
      action="/book"
      method="get"
      role="search"
      aria-label="Check room availability"
      className={cn(
        "grid grid-cols-2 gap-3 sm:gap-4 lg:items-end",
        stacked ? "" : roomTypes ? "lg:grid-cols-[1.15fr_1.15fr_0.7fr_0.7fr_1.2fr_auto]" : "lg:grid-cols-[1.2fr_1.2fr_0.8fr_0.8fr_auto]",
        bare ? "" : hero ? cn(glass, "rounded-3xl bg-[#15120e]/55 p-4 sm:p-5") : stacked ? "" : "rounded-3xl bg-panel p-5 shadow-[0_20px_60px_-30px_rgba(21,18,14,0.35)] ring-1 ring-tone/10 sm:p-6",
      )}
    >
      {defaults.type && !roomTypes && <input type="hidden" name="type" value={defaults.type} />}
      <div className="min-w-0">
        <label htmlFor={`${variant}-checkIn`} className={label}>Check-in</label>
        <input
          id={`${variant}-checkIn`}
          name="checkIn"
          type="date"
          required
          min={minDate}
          max={maxDate}
          value={checkIn}
          onChange={(e) => onCheckIn(e.target.value)}
          aria-invalid={errors?.checkIn ? true : undefined}
          aria-describedby={errors?.checkIn ? `${variant}-checkIn-error` : undefined}
          className={input}
        />
        {errors?.checkIn && <p id={`${variant}-checkIn-error`} className={err}>{errors.checkIn}</p>}
      </div>
      <div className="min-w-0">
        <label htmlFor={`${variant}-checkOut`} className={label}>Check-out</label>
        <input
          id={`${variant}-checkOut`}
          name="checkOut"
          type="date"
          required
          min={minOut}
          max={maxOut}
          value={checkOut}
          onChange={(e) => setCheckOut(e.target.value)}
          aria-invalid={errors?.checkOut ? true : undefined}
          aria-describedby={errors?.checkOut ? `${variant}-checkOut-error` : undefined}
          className={input}
        />
        {errors?.checkOut && <p id={`${variant}-checkOut-error`} className={err}>{errors.checkOut}</p>}
      </div>
      <div>
        <label htmlFor={`${variant}-adults`} className={label}>Adults</label>
        <select id={`${variant}-adults`} name="adults" defaultValue={String(defaults.adults ?? 2)} className={cn(input, "appearance-auto")}
          aria-invalid={errors?.adults ? true : undefined}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {errors?.adults && <p className={err}>{errors.adults}</p>}
      </div>
      <div>
        <label htmlFor={`${variant}-children`} className={label}>Children</label>
        <select id={`${variant}-children`} name="children" defaultValue={String(defaults.children ?? 0)} className={cn(input, "appearance-auto")}
          aria-invalid={errors?.children ? true : undefined}>
          {Array.from({ length: 7 }, (_, i) => i).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {errors?.children && <p className={err}>{errors.children}</p>}
      </div>
      {roomTypes && (
        <div className={cn("col-span-2", !stacked && "lg:col-span-1")}>
          <label htmlFor={`${variant}-type`} className={label}>Room type</label>
          <select id={`${variant}-type`} name="type" defaultValue={defaults.type ?? ""} className={cn(input, "appearance-auto")}>
            <option value="">Any room type</option>
            {roomTypes.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
          </select>
        </div>
      )}
      <button type="submit" className={cn(pillGold, "col-span-2 h-12 w-full justify-between py-1.5 pl-6 pr-1.5", !stacked && "lg:col-span-1 lg:w-auto")}>
        <span className="relative inline-flex items-center gap-2">
          <Search className="size-4" aria-hidden="true" />
          {submitLabel}
        </span>
        <ArrowBadge />
      </button>
    </form>
  );
}
