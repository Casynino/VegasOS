"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Minus, Plus, X } from "lucide-react";
import { addDays, isBusinessDate } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { buttonClass } from "../kit/button";
import { field, typeScale } from "../kit/tokens";
import { useBackToClose } from "../use-back-to-close";

/**
 * The home page's "Check availability" search — a plain GET form to /book (the one booking
 * flow), so it works before hydration and gives a shareable URL. Field names are the /book
 * contract: checkIn, checkOut, adults, children, type.
 * - Desktop (lg+): HeroBookingBar, one slim glass bar at the foot of the hero.
 * - Phones and tablets: BookingSheet, a slim button that opens the same search in a bottom
 *   sheet (without JS it is a link to /book, which has its own search).
 */
export interface StaySearchProps {
  minDate: string;
  maxDate: string;
  maxNights: number;
  roomTypes: { slug: string; name: string }[];
  defaultCheckIn: string;
}

const LIMITS = { adults: [1, 12], children: [0, 6] } as const;

function useStay({ defaultCheckIn, minDate, maxNights }: StaySearchProps) {
  const t = useT();
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(addDays(defaultCheckIn, 1));
  const [adults, setAdults] = useState(2);
  const [kids, setKids] = useState(0);

  const validIn = isBusinessDate(checkIn);
  const minOut = validIn ? addDays(checkIn, 1) : addDays(minDate, 1);
  const maxOut = validIn ? addDays(checkIn, maxNights) : undefined;

  function onCheckIn(v: string) {
    setCheckIn(v);
    if (isBusinessDate(v) && (!isBusinessDate(checkOut) || checkOut <= v)) setCheckOut(addDays(v, 1));
  }

  const adultsLabel = t.plural(adults, "{n} adult", "{n} adults");
  const guestsLabel = kids ? t("{adults}, {children}", { adults: adultsLabel, children: t.plural(kids, "{n} child", "{n} children") }) : adultsLabel;
  return { checkIn, checkOut, setCheckOut, onCheckIn, minOut, maxOut, adults, setAdults, kids, setKids, guestsLabel };
}

/** − 2 + : a guest count with 44px buttons. `fewer` / `more` name the two buttons ("Fewer adults"). */
function Stepper({
  label,
  fewer,
  more,
  value,
  onChange,
  min,
  max,
  tone = "sheet",
}: {
  label: string;
  fewer: string;
  more: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  tone?: "sheet" | "bar";
}) {
  const btn = cn(
    "grid size-11 place-items-center rounded-full border transition-colors duration-200 disabled:opacity-30 motion-reduce:transition-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
    tone === "bar" ? "border-white/20 hover:border-gold" : "border-pub-line hover:border-pub-fg/50",
  );
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-[15px]">{label}</span>
      <span className="flex items-center gap-3">
        <button type="button" className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={fewer}>
          <Minus className="size-4" strokeWidth={1.6} aria-hidden="true" />
        </button>
        <span className="w-5 text-center text-base tabular-nums" aria-live="polite">
          {value}
        </span>
        <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={more}>
          <Plus className="size-4" strokeWidth={1.6} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

/**
 * Desktop: one slim glass bar — dates, guests, room type and a slim "Check availability" button.
 * The guests panel opens upward (the bar sits at the foot of the hero).
 */
export function HeroBookingBar({ className, submitLabel, ...search }: StaySearchProps & { className?: string; submitLabel?: string }) {
  const t = useT();
  const s = useStay(search);
  const id = useId();
  const [guestsOpen, setGuestsOpen] = useState(false);
  const guestsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!guestsOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !guestsRef.current?.contains(e.target as Node)) setGuestsOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [guestsOpen]);

  const cell =
    "relative flex min-w-0 flex-col justify-center rounded-full px-5 py-2 transition-colors duration-200 hover:bg-white/[0.06] focus-within:bg-white/[0.08] motion-reduce:transition-none";
  const divider = "before:absolute before:inset-y-3 before:left-0 before:w-px before:bg-white/15";
  const label = "text-[10px] font-medium uppercase tracking-[0.22em] text-white/65";
  const value = "mt-1 w-full min-w-0 truncate bg-transparent text-[15px] text-white outline-none [color-scheme:dark]";

  return (
    <form
      action="/book"
      method="get"
      role="search"
      aria-label={t("Check availability")}
      className={cn(
        // Smoked glass with a light edge and a gold hairline on top (kit .pub-glass).
        "pub-glass grid grid-cols-[1fr_1fr_1fr_1.1fr_auto] items-stretch gap-1 rounded-full p-1.5 pl-2 text-white",
        className,
      )}
    >
      <div className={cell}>
        <label htmlFor={`${id}-in`} className={label}>
          {t("Check-in")}
        </label>
        <input id={`${id}-in`} name="checkIn" type="date" required min={search.minDate} max={search.maxDate} value={s.checkIn} onChange={(e) => s.onCheckIn(e.target.value)} className={value} />
      </div>
      <div className={cn(cell, divider)}>
        <label htmlFor={`${id}-out`} className={label}>
          {t("Check-out")}
        </label>
        <input id={`${id}-out`} name="checkOut" type="date" required min={s.minOut} max={s.maxOut} value={s.checkOut} onChange={(e) => s.setCheckOut(e.target.value)} className={value} />
      </div>

      <div ref={guestsRef} className={cn(cell, divider)}>
        <span id={`${id}-gl`} className={label}>
          {t("Guests")}
        </span>
        <button
          type="button"
          aria-labelledby={`${id}-gl ${id}-gv`}
          aria-expanded={guestsOpen}
          aria-controls={`${id}-gp`}
          onClick={() => setGuestsOpen((o) => !o)}
          className={cn(value, "text-left after:absolute after:inset-0 after:rounded-full focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-gold")}
        >
          <span id={`${id}-gv`}>{s.guestsLabel}</span>
        </button>
        <input type="hidden" name="adults" value={s.adults} />
        <input type="hidden" name="children" value={s.kids} />
        {guestsOpen && (
          <div
            id={`${id}-gp`}
            role="group"
            aria-label={t("Guests")}
            className="absolute bottom-full left-0 z-30 mb-3 w-72 rounded-[1rem] border border-white/10 bg-night-raised/95 p-4 text-white shadow-[0_30px_60px_-20px_rgb(0_0_0/0.9)] backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
          >
            <Stepper tone="bar" label={t("Adults")} fewer={t("Fewer adults")} more={t("More adults")} value={s.adults} onChange={s.setAdults} min={LIMITS.adults[0]} max={LIMITS.adults[1]} />
            <Stepper tone="bar" label={t("Children")} fewer={t("Fewer children")} more={t("More children")} value={s.kids} onChange={s.setKids} min={LIMITS.children[0]} max={LIMITS.children[1]} />
            <button type="button" onClick={() => setGuestsOpen(false)} className={buttonClass({ variant: "glass", size: "sm", full: true, className: "mt-2" })}>
              {t("Done")}
            </button>
          </div>
        )}
      </div>

      <div className={cn(cell, divider)}>
        <label htmlFor={`${id}-type`} className={label}>
          {t("Room")}
        </label>
        <select id={`${id}-type`} name="type" defaultValue="" className={cn(value, "cursor-pointer appearance-none [&>option]:bg-night-raised")}>
          <option value="">{t("Any room type")}</option>
          {search.roomTypes.map((rt) => (
            <option key={rt.slug} value={rt.slug}>
              {t(rt.name)}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" className={buttonClass({ className: "mx-1 self-center px-5" })}>
        {submitLabel ? t(submitLabel) : t("Check availability")}
        <ArrowRight className="size-3.5 transition-transform duration-300 ease-pub group-hover/btn:translate-x-0.5 motion-reduce:transition-none" strokeWidth={1.6} aria-hidden="true" />
      </button>
    </form>
  );
}

/**
 * Phones and tablets: the slim "Check availability" button opens the search in a bottom sheet
 * (native <dialog>: focus stays inside, Escape, a tap outside and the phone's Back close it).
 * A visit to /#availability opens it too. Without JS the button is a plain link to /book.
 */
export function BookingSheet({ label, className, ...search }: StaySearchProps & { label: string; className?: string }) {
  const t = useT();
  const s = useStay(search);
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const { opened, closed } = useBackToClose(() => ref.current?.close());

  const open = useCallback(() => {
    const d = ref.current;
    if (!d || d.open) return;
    d.showModal();
    document.documentElement.style.overflow = "hidden";
    opened();
  }, [opened]);

  // Deep link: /#availability on a phone or tablet opens the sheet.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === "#availability" && window.matchMedia("(max-width: 1023.98px)").matches) open();
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [open]);

  // Never leave the page locked if the sheet unmounts while open.
  useEffect(
    () => () => {
      document.documentElement.style.overflow = "";
    },
    [],
  );

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a plain link on purpose: it opens the sheet, and goes to /book only without JS */}
      <a
        href="/book"
        aria-haspopup="dialog"
        onClick={(e) => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          open();
        }}
        className={cn(buttonClass({ size: "md" }), className)}
      >
        <span>{t(label)}</span>
      </a>

      <dialog
        ref={ref}
        aria-labelledby={`${id}-title`}
        data-tone="night"
        onClose={() => {
          document.documentElement.style.overflow = "";
          closed();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className={cn(
          "fixed inset-x-0 bottom-0 top-auto m-0 max-h-[92svh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[1.25rem] border-t border-white/10 bg-night-raised p-0 text-pub-fg",
          "shadow-[0_-30px_80px_-20px_rgb(0_0_0/0.85)] backdrop:bg-black/65",
          "sm:bottom-6 sm:mx-auto sm:max-w-lg sm:rounded-[1.25rem] sm:border",
          "open:motion-safe:animate-in open:motion-safe:fade-in open:motion-safe:slide-in-from-bottom-6 open:motion-safe:duration-300",
        )}
      >
        <div className="px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 sm:px-7 sm:pb-7 sm:pt-6">
          <span aria-hidden="true" className="mx-auto block h-1 w-10 rounded-full bg-white/20 sm:hidden" />
          <div className="mt-3 flex items-start justify-between gap-4 sm:mt-0">
            <div>
              <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>{t("Book direct")}</p>
              <h2 id={`${id}-title`} className={cn(typeScale.subheading, "mt-3")}>
                {t("Check availability")}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label={t("Close")}
              className="-mr-1 grid size-11 shrink-0 place-items-center rounded-full border border-pub-line text-pub-fg transition-colors duration-200 hover:border-pub-fg/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none"
            >
              <X className="size-4" strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>

          <form action="/book" method="get" role="search" aria-labelledby={`${id}-title`} className="mt-6 grid gap-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label htmlFor={`${id}-in`} className={field.label}>
                  {t("Check-in")}
                </label>
                <input
                  id={`${id}-in`}
                  name="checkIn"
                  type="date"
                  required
                  min={search.minDate}
                  max={search.maxDate}
                  value={s.checkIn}
                  onChange={(e) => s.onCheckIn(e.target.value)}
                  className={cn(field.input, "min-w-0 appearance-none px-3 text-left [color-scheme:dark]")}
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`${id}-out`} className={field.label}>
                  {t("Check-out")}
                </label>
                <input
                  id={`${id}-out`}
                  name="checkOut"
                  type="date"
                  required
                  min={s.minOut}
                  max={s.maxOut}
                  value={s.checkOut}
                  onChange={(e) => s.setCheckOut(e.target.value)}
                  className={cn(field.input, "min-w-0 appearance-none px-3 text-left [color-scheme:dark]")}
                />
              </div>
            </div>

            <fieldset className="min-w-0">
              <legend className={field.label}>{t("Guests")}</legend>
              <div className="divide-y divide-pub-line border-y border-pub-line">
                <Stepper label={t("Adults")} fewer={t("Fewer adults")} more={t("More adults")} value={s.adults} onChange={s.setAdults} min={LIMITS.adults[0]} max={LIMITS.adults[1]} />
                <Stepper label={t("Children")} fewer={t("Fewer children")} more={t("More children")} value={s.kids} onChange={s.setKids} min={LIMITS.children[0]} max={LIMITS.children[1]} />
              </div>
              <input type="hidden" name="adults" value={s.adults} />
              <input type="hidden" name="children" value={s.kids} />
            </fieldset>

            <div className="min-w-0">
              <label htmlFor={`${id}-type`} className={field.label}>
                {t("Room type")}
              </label>
              <select id={`${id}-type`} name="type" defaultValue="" className={cn(field.input, "cursor-pointer appearance-none [&>option]:bg-night-raised")}>
                <option value="">{t("Any room type")}</option>
                {search.roomTypes.map((rt) => (
                  <option key={rt.slug} value={rt.slug}>
                    {t(rt.name)}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" className={buttonClass({ full: true, className: "mt-1" })}>
              <span>{t("See available rooms")}</span>
              <ArrowRight className="size-4" strokeWidth={1.6} aria-hidden="true" />
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
