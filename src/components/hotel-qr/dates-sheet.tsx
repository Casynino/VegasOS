"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { CalendarDays, Moon, Phone, Search, X } from "lucide-react";
import { addDays, diffDays, isBusinessDate } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";
import type { QrLanding } from "@/server/services/hotel-qr";
import { caps, darkButton, lightButton, Stepper, useSheetBehaviour } from "./ui";
import { dayWeek, holdsText, nightsText, quickDates, telHref, type StayQuery } from "./lib";

type Window = QrLanding["window"];
/** A room type to pick, with how many it takes (picking one sets a party that fits it). */
type TypeChoice = { slug: string; name: string; maxAdults: number; maxChildren: number };

/**
 * "When are you staying?" — a sheet that slides up from the bottom of the phone (a small window on computers): the two
 * dates (the phone's own calendar), quick picks, adults and children, and a room type if they have one in mind (picking
 * one sets a number of guests it takes — a Standard Single, 1 adult). Only dates the hotel takes bookings for can be
 * chosen; the server checks everything again.
 */
export function DatesSheet({ open, onClose, onSubmit, initial, window: w, types, closed, phone }: {
  open: boolean; onClose: () => void;
  onSubmit: (stay: StayQuery, roomType: string | null) => void;
  initial: { stay: StayQuery | null; roomType: string | null };
  window: Window; types: TypeChoice[];
  /** Booking here is switched off: why (and the phone instead of the button). */
  closed: string | null; phone: string | null;
}) {
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const panel = useRef<HTMLDivElement>(null);
  useSheetBehaviour(open, onClose, panel);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1d1712]/55 backdrop-blur-[2px] sm:items-center sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div ref={panel} role="dialog" aria-modal="true" aria-labelledby="dates-title" onClick={(e) => e.stopPropagation()}
            drag={reduce ? false : "y"} dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, i) => { if (i.offset.y > 90 || i.velocity.y > 600) onClose(); }}
            initial={reduce ? { opacity: 0 } : { y: "100%" }} animate={reduce ? { opacity: 1 } : { y: 0 }} exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            className="vr relative max-h-[94svh] w-full overflow-y-auto overscroll-contain rounded-t-[28px] bg-(--vr-card) text-(--vr-ink) shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.5)] sm:max-w-[440px] sm:rounded-[28px]">
            <div onPointerDown={(e) => drag.start(e)} className="flex cursor-grab touch-none justify-center pb-1 pt-2.5 sm:hidden" aria-hidden>
              <span className="h-1.5 w-10 rounded-full bg-(--vr-line)" />
            </div>
            {/* Close — for everyone (the handle is for a swipe; a screen reader needs a button) */}
            <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3.5 top-3.5 z-10 grid size-9 place-items-center rounded-full bg-(--vr-bg) transition hover:bg-(--vr-line) sm:right-4 sm:top-4"><X className="size-4" /></button>
            <DatesForm initial={initial} w={w} types={types} closed={closed} phone={phone} onSubmit={onSubmit} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DatesForm({ initial, w, types, closed, phone, onSubmit }: {
  initial: { stay: StayQuery | null; roomType: string | null }; w: Window; types: TypeChoice[];
  closed: string | null; phone: string | null; onSubmit: (stay: StayQuery, roomType: string | null) => void;
}) {
  const fresh = initial.stay && initial.stay.checkIn >= w.today ? initial.stay : null;
  const typeOf = (slug: string | null) => types.find((t) => t.slug === slug) ?? null;
  // Opened for a room type (before any search): a party it takes. A party they already chose stays as it is.
  const opened = fresh ? null : typeOf(initial.roomType);
  const [checkIn, setCheckIn] = useState(fresh?.checkIn ?? w.today);
  const [checkOut, setCheckOut] = useState(fresh?.checkOut ?? addDays(w.today, 1));
  const [adults, setAdults] = useState(Math.max(1, Math.min(fresh?.adults ?? 2, w.maxAdults, opened?.maxAdults ?? w.maxAdults)));
  const [children, setChildren] = useState(Math.min(fresh?.children ?? 0, w.maxChildren, opened?.maxChildren ?? w.maxChildren));
  const [roomType, setRoomType] = useState<string | null>(initial.roomType);
  const chosen = typeOf(roomType);
  const pickType = (slug: string | null) => {
    setRoomType(slug);
    const t = typeOf(slug);
    if (!t) return;
    setAdults((a) => Math.max(1, Math.min(a, t.maxAdults)));
    setChildren((c) => Math.min(c, t.maxChildren));
  };
  const [tried, setTried] = useState(false);
  // The sheet takes the focus (keyboard and screen readers start inside it) — not a date field, which would open a calendar.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);

  const nights = diffDays(checkIn, checkOut);
  const maxOut = addDays(checkIn, w.maxNights);
  const error = checkIn < w.today ? "Check-in cannot be in the past."
    : checkIn > w.maxCheckIn ? `We take bookings here up to ${dayWeek(w.maxCheckIn)}.`
    : nights < 1 ? "Check-out must be after check-in."
    : nights > w.maxNights ? `Stays of up to ${w.maxNights} nights can be booked here.` : null;

  const pickIn = (v: string) => {
    if (!isBusinessDate(v)) return;
    setCheckIn(v);
    // Keep the same length of stay where we can; never a check-out on or before check-in.
    if (checkOut <= v || diffDays(v, checkOut) > w.maxNights) setCheckOut(addDays(v, Math.max(1, Math.min(nights, w.maxNights))));
  };
  const submit = () => {
    setTried(true);
    if (error) return;
    onSubmit({ checkIn, checkOut, adults, children }, roomType);
  };
  const quick = quickDates(w.today, w.maxCheckIn);

  return (
    <form className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 sm:px-7 sm:pb-7 sm:pt-7" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h2 ref={title} tabIndex={-1} id="dates-title" className="pr-10 font-display text-[26px] font-semibold leading-tight outline-none">When are you staying?</h2>
      <p className="mt-0.5 text-[13px] text-(--vr-muted)">We show only rooms that are really free.</p>

      {quick.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {quick.map((q) => {
            const on = q.checkIn === checkIn && q.checkOut === checkOut;
            return (
              <button key={q.label} type="button" onClick={() => { setCheckIn(q.checkIn); setCheckOut(q.checkOut); }} aria-pressed={on}
                className={cn("h-8 rounded-full px-3.5 text-[12.5px] font-medium ring-1 transition", on ? "bg-(--vr-dark) text-white ring-(--vr-dark)" : "bg-(--vr-bg) text-(--vr-ink)/80 ring-(--vr-line) hover:ring-(--vr-gold)")}>
                {q.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <DateTile label="Check-in" value={checkIn} min={w.today} max={w.maxCheckIn} onChange={pickIn} />
        <DateTile label="Check-out" value={checkOut} min={addDays(checkIn, 1)} max={maxOut} onChange={(v) => { if (isBusinessDate(v)) setCheckOut(v); }} />
      </div>
      <p className={cn("mt-2 flex items-center justify-center gap-1.5 text-[12.5px]", tried && error ? "font-medium text-rose-700" : "text-(--vr-muted)")} aria-live="polite">
        {tried && error ? error : <><Moon className="size-3.5 text-(--vr-gold-ink)" />{nights > 0 ? nightsText(nights) : "Choose your dates"}</>}
      </p>

      <div className="mt-3 divide-y divide-(--vr-line) border-y border-(--vr-line)">
        <Stepper label="Adults" hint={adults >= w.maxAdults ? "That's the most one room takes. More guests? Call us." : undefined} value={adults} min={1} max={w.maxAdults} onChange={setAdults} />
        {w.maxChildren > 0 && <Stepper label="Children" value={children} min={0} max={w.maxChildren} onChange={setChildren} />}
      </div>

      {types.length > 1 && (
        <div className="mt-4">
          <p className={caps}>Room type <span className="font-normal normal-case tracking-normal">· optional</span></p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Room type">
            {[{ slug: null as string | null, name: "Any room" }, ...types.map((t) => ({ slug: t.slug as string | null, name: t.name }))].map((t) => {
              const on = roomType === t.slug;
              return (
                <button key={t.slug ?? "any"} type="button" role="radio" aria-checked={on} onClick={() => pickType(t.slug)}
                  className={cn("h-8 rounded-full px-3.5 text-[12.5px] font-medium ring-1 transition", on ? "bg-(--vr-gold-soft) text-(--vr-ink) ring-(--vr-gold)/50" : "bg-(--vr-card) text-(--vr-ink)/75 ring-(--vr-line) hover:ring-(--vr-gold)")}>
                  {t.name}
                </button>
              );
            })}
          </div>
          {chosen && (adults > chosen.maxAdults || children > chosen.maxChildren) && (
            <p className="mt-2 text-[12px] leading-snug text-(--vr-muted)">A {chosen.name} takes {holdsText(chosen).toLowerCase()} — we&apos;ll show you the rooms that fit everyone.</p>
          )}
        </div>
      )}

      {closed ? (
        <div className="mt-5 rounded-2xl bg-(--vr-gold-soft) p-3.5 text-[13px] text-(--vr-ink)/85">
          <p>{closed}</p>
          {phone && <a href={telHref(phone)} className={cn(lightButton, "mt-3 h-11 w-full text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />Call {phone}</a>}
        </div>
      ) : (
        <button type="submit" className={cn(darkButton, "mt-5 h-12 w-full text-[14.5px]")}>
          <Search className="size-4 text-(--vr-gold)" />Check availability
        </button>
      )}
    </form>
  );
}

/** A date as a big tile ("Mon 12 Oct") that opens the phone's own calendar when tapped. */
function DateTile({ label, value, min, max, onChange }: { label: string; value: string; min: string; max: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="relative block cursor-pointer rounded-2xl bg-(--vr-bg) px-3.5 py-3 ring-1 ring-(--vr-line) transition focus-within:ring-2 focus-within:ring-(--vr-gold) hover:ring-(--vr-gold)">
      <span className={caps}>{label}</span>
      <span className="mt-1 flex items-center gap-2 text-[16px] font-semibold">
        <CalendarDays className="size-4 shrink-0 text-(--vr-gold-ink)" /><span className="truncate">{isBusinessDate(value) ? dayWeek(value) : "Choose"}</span>
      </span>
      <input ref={ref} type="date" value={value} min={min} max={max} required aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => { try { ref.current?.showPicker?.(); } catch { /* the browser opens its own */ } }}
        className="absolute inset-0 size-full cursor-pointer opacity-0 [color-scheme:light]" />
    </label>
  );
}
