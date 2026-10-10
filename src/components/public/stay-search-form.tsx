"use client";

import { useState } from "react";
import { addDays, isBusinessDate } from "@/lib/time/business-date";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Button } from "./kit/button";
import { field } from "./kit/tokens";

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
 * Fields follow the surrounding tone (paper or night) and the visitor's light/dark choice.
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
  submitLabel = "Check availability",
  bare = false,
  direct = false,
}: {
  defaults: StaySearchDefaults;
  minDate: string;
  maxDate: string;
  maxNights: number;
  /** "hero": on a night (dark) band; "panel": on paper. Also prefixes the field ids. */
  variant?: "hero" | "panel";
  /** Messages per field (English keys or already translated). */
  errors?: Record<string, string>;
  /** When given, shows a room-type picker; otherwise a preselected type is kept hidden. */
  roomTypes?: { slug: string; name: string }[];
  /** An English key or already translated. */
  submitLabel?: string;
  /** Always two columns (for narrow side panels). */
  stacked?: boolean;
  /** Kept for older callers: the form never draws its own box now (the page frames it). */
  bare?: boolean;
  /** With a room type chosen, go straight to Book & pay (one room) instead of the list of free rooms. */
  direct?: boolean;
}) {
  const t = useT();
  const [checkIn, setCheckIn] = useState(defaults.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(defaults.checkOut ?? "");
  const validIn = isBusinessDate(checkIn);
  const minOut = validIn ? addDays(checkIn, 1) : addDays(minDate, 1);
  const maxOut = validIn ? addDays(checkIn, maxNights) : undefined;
  void bare;

  function onCheckIn(value: string) {
    setCheckIn(value);
    if (isBusinessDate(value) && (!isBusinessDate(checkOut) || checkOut <= value)) setCheckOut(addDays(value, 1));
  }

  const hero = variant === "hero";
  // Native date pickers and select menus follow the surface: dark on night bands and in the dark theme.
  const scheme = hero ? "[color-scheme:dark]" : "[color-scheme:light] pub-dark:[color-scheme:dark]";
  const input = cn(field.input, "min-w-0 px-3 sm:px-4", scheme);
  const select = cn(input, "appearance-auto pr-2");
  const wide = !stacked;

  return (
    <form
      action="/book"
      method="get"
      role="search"
      aria-label={t("Check room availability")}
      {...(hero ? { "data-tone": "night" } : {})}
      className={cn("grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4", wide && "sm:grid-cols-4 sm:items-end")}
    >
      {defaults.type && !roomTypes && <input type="hidden" name="type" value={defaults.type} />}
      {direct && <input type="hidden" name="rooms" value="1" />}
      <div className="min-w-0">
        <label htmlFor={`${variant}-checkIn`} className={field.label}>{t("Check-in")}</label>
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
        {errors?.checkIn && <p id={`${variant}-checkIn-error`} className={field.error}>{t(errors.checkIn)}</p>}
      </div>
      <div className="min-w-0">
        <label htmlFor={`${variant}-checkOut`} className={field.label}>{t("Check-out")}</label>
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
        {errors?.checkOut && <p id={`${variant}-checkOut-error`} className={field.error}>{t(errors.checkOut)}</p>}
      </div>
      <div className="min-w-0">
        <label htmlFor={`${variant}-adults`} className={field.label}>{t("Adults")}</label>
        <select id={`${variant}-adults`} name="adults" defaultValue={String(defaults.adults ?? 2)} className={select}
          aria-invalid={errors?.adults ? true : undefined} aria-describedby={errors?.adults ? `${variant}-adults-error` : undefined}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {errors?.adults && <p id={`${variant}-adults-error`} className={field.error}>{t(errors.adults)}</p>}
      </div>
      <div className="min-w-0">
        <label htmlFor={`${variant}-children`} className={field.label}>{t("Children")}</label>
        <select id={`${variant}-children`} name="children" defaultValue={String(defaults.children ?? 0)} className={select}
          aria-invalid={errors?.children ? true : undefined} aria-describedby={errors?.children ? `${variant}-children-error` : undefined}>
          {Array.from({ length: 7 }, (_, i) => i).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {errors?.children && <p id={`${variant}-children-error`} className={field.error}>{t(errors.children)}</p>}
      </div>
      {roomTypes && (
        <div className="col-span-2 min-w-0">
          <label htmlFor={`${variant}-type`} className={field.label}>{t("Room type")}</label>
          <select id={`${variant}-type`} name="type" defaultValue={defaults.type ?? ""} className={select}>
            <option value="">{t("Any room type")}</option>
            {roomTypes.map((rt) => <option key={rt.slug} value={rt.slug}>{t(rt.name)}</option>)}
          </select>
        </div>
      )}
      <Button type="submit" icon="arrow" full className={cn("col-span-2", wide && !roomTypes && "sm:col-span-4 lg:col-span-2 lg:col-start-3", "mt-1 sm:mt-0")}>
        {t(submitLabel)}
      </Button>
    </form>
  );
}
