"use client";

import { useEffect, useRef, useState } from "react";
import { getImageProps } from "next/image";
import { useReducedMotion } from "motion/react";
import { ArrowRight, CalendarDays, Phone, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpeningSlide } from "@/server/services/hotel-qr-explore";
import { BrandMark, goldButton } from "./ui";
import { usePhotoViewer } from "./viewer";
import { datesShort, datesText, dayWeek, guestsText, nightsOf, nightsText, telHref, type StayQuery } from "./lib";

const EVERY = 6500;

/**
 * THE OPENING — the hotel full screen, one place after another (the building, a room, the bathroom, reception, the
 * meeting room…): a slow crossfade, a swipe to move on, a tap to see it big. Phones get upright photos, computers wide
 * ones. The words and the booking bar sit on the dark band the photo melts into — never on the busy photo itself.
 */
export function Opening({ slides, hotel, children }: {
  slides: OpeningSlide[]; hotel: { name: string; tagline: string | null; phone: string | null }; children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const view = usePhotoViewer();
  const [at, setAt] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [reach, setReach] = useState(1);
  const [touched, setTouched] = useState(0);
  const n = slides.length;
  const show = (k: number) => {
    const next = ((k % n) + n) % n;
    setPrev(at); setAt(next); setReach((r) => Math.max(r, next + 1));
  };

  // On by itself, slowly; a swipe or a tap on the marks starts the wait again. Still for people who prefer less motion.
  useEffect(() => {
    if (reduce || n < 2) return;
    const t = setTimeout(() => { setPrev(at); setAt((at + 1) % n); setReach((r) => Math.max(r, ((at + 1) % n) + 1)); }, EVERY);
    return () => clearTimeout(t);
  }, [at, n, reduce, touched]);

  const start = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { show(at + (dx < 0 ? 1 : -1)); setTouched((t) => t + 1); return; }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) view(slides.map((x) => ({ src: x.tall.src, alt: x.tall.alt, label: x.label })), at);
  };

  const slide = slides[at];
  return (
    <section aria-label={hotel.name} className="relative isolate overflow-hidden bg-(--vr-dark) text-white">
      <div className="relative h-[61svh] min-h-[380px] max-h-[640px] touch-pan-y select-none sm:h-[62svh] lg:h-[min(90svh,880px)] lg:max-h-none"
        onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { start.current = null; }}>
        {slides.map((s, k) => (
          <div key={s.tall.src + s.wide.src} aria-hidden={k !== at}
            className={cn("absolute inset-0 overflow-hidden transition-opacity duration-[1400ms] ease-in-out motion-reduce:transition-none", k === at ? "opacity-100" : "opacity-0")}>
            {k < reach + 1 && <SlidePicture s={s} hotel={hotel.name} eager={k === 0} moving={!reduce && (k === at || k === prev)} />}
          </div>
        ))}
        {/* Dark at the top for the name, and the photo melting into the band below (phones) / to the left (computers). */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-linear-to-b from-black/60 via-black/25 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] bg-linear-to-t from-(--vr-dark) via-(--vr-dark)/70 to-transparent lg:h-[62%] lg:via-(--vr-dark)/55" />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 hidden w-[64%] bg-linear-to-r from-(--vr-dark)/90 via-(--vr-dark)/45 to-transparent lg:block" />
      </div>

      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:pt-7">
          <span className="flex min-w-0 items-center gap-2.5">
            <BrandMark className="size-10 shadow-[0_4px_14px_rgba(0,0,0,0.35)]" />
            <span className="min-w-0 leading-none [text-shadow:0_1px_8px_rgba(0,0,0,0.45)]">
              <span className="block truncate font-display text-[18px] font-semibold tracking-wide">{hotel.name}</span>
              <span className="mt-1 block truncate text-[10px] uppercase tracking-[0.22em] text-white/75">{hotel.tagline ?? "Rooms & suites"}</span>
            </span>
          </span>
          {hotel.phone && (
            <a href={telHref(hotel.phone)} aria-label={`Call ${hotel.name}`}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-black/25 px-3 text-[13px] font-medium ring-1 ring-white/25 backdrop-blur-md transition hover:bg-black/40 sm:px-4">
              <Phone className="size-4 text-(--vr-gold)" /><span className="hidden sm:inline">{hotel.phone}</span>
            </a>
          )}
        </div>
      </header>

      <div className="relative z-10 -mt-[132px] px-4 pb-7 sm:px-6 lg:absolute lg:inset-x-0 lg:bottom-0 lg:mt-0 lg:px-0 lg:pb-14">
        <div className="mx-auto max-w-7xl lg:px-10">
          {/* Where the photo is: the place, and one mark per photo (tap to go there). */}
          {n > 1 && (
            <div className="flex items-center gap-3">
              <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.24em] text-(--vr-gold) [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]" aria-live="polite">
                <span className="tabular-nums text-white/70">{String(at + 1).padStart(2, "0")}</span>
                <span className="mx-2 text-white/35">/</span>{slide.label}
              </p>
              <span className="flex flex-1 items-center gap-1.5 lg:max-w-[260px]">
                {slides.map((s, k) => (
                  <button key={s.label + k} type="button" onClick={() => { show(k); setTouched((t) => t + 1); }} aria-label={`Show ${s.label}`}
                    className="group relative h-6 flex-1">
                    <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
                      {k === at && <span key={`${at}-${touched}`} className={cn("absolute inset-0 origin-left bg-(--vr-gold)", !reduce && "animate-[vlh-progress_6.5s_linear_both]")} />}
                      {k < at && <span className="absolute inset-0 bg-white/60" />}
                    </span>
                  </button>
                ))}
              </span>
            </div>
          )}
          {children}
        </div>
      </div>
    </section>
  );
}

/** One place: the upright photo on phones, the wide one on computers (one image element; the browser picks). */
function SlidePicture({ s, hotel, eager, moving }: { s: OpeningSlide; hotel: string; eager: boolean; moving: boolean }) {
  const alt = s.tall.src === s.wide.src ? s.tall.alt : `${s.label} — ${hotel}`;
  const common = { alt, fill: true, sizes: "100vw", loading: eager ? "eager" : "lazy", fetchPriority: eager ? "high" : undefined } as const;
  const { props: { srcSet: wide } } = getImageProps({ ...common, src: s.wide.src });
  const { props: { srcSet: tall, ...rest } } = getImageProps({ ...common, src: s.tall.src });
  return (
    <picture>
      <source media="(min-width: 1024px)" srcSet={wide} sizes="100vw" />
      <img {...rest} alt={alt} srcSet={tall} className={cn("object-cover", moving && "animate-[vlh-kb-a_16s_ease-in-out_infinite_alternate]")} />
    </picture>
  );
}

/**
 * THE BOOKING BAR — right under the words: the dates and the guests (one tap opens the dates sheet) and the gold
 * "See rooms" — tonight → tomorrow already chosen, so one tap shows what is free.
 */
export function BookingBar({ stay, onDates, onSee, closed, phone, className }: {
  stay: StayQuery; onDates: () => void; onSee: () => void; closed: string | null; phone: string | null; className?: string;
}) {
  const nights = nightsOf(stay);
  const cell = "flex min-w-0 items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-left transition hover:bg-(--vr-bg) focus-visible:outline-2 focus-visible:outline-(--vr-gold)";
  const small = "block text-[10px] font-semibold uppercase tracking-[0.18em] text-(--vr-muted)";
  return (
    <div className={cn("rounded-[26px] bg-(--vr-card) p-1.5 text-(--vr-ink) shadow-[0_30px_60px_-30px_rgba(0,0,0,0.75)] lg:flex lg:items-center lg:gap-1.5 lg:rounded-full lg:p-2", className)}>
      {/* Phones: dates | guests, the button under them. Computers: check-in | check-out | guests | button, in one row. */}
      <div className="flex items-stretch lg:flex-1">
        <button type="button" onClick={onDates} className={cn(cell, "flex-1 lg:hidden")} aria-label={`Dates: ${datesText(stay)}, ${nightsText(nights)}. Change`}>
          <CalendarDays className="size-[18px] shrink-0 text-(--vr-gold-ink)" />
          <span className="min-w-0 leading-tight">
            <span className={small}>Dates · {nightsText(nights)}</span>
            <span className="mt-1 block truncate text-[15px] font-semibold">
              <span className="min-[360px]:hidden">{datesShort(stay)}</span><span className="hidden min-[360px]:inline">{datesText(stay)}</span>
            </span>
          </span>
        </button>
        <button type="button" onClick={onDates} className={cn(cell, "hidden flex-1 lg:flex lg:rounded-full lg:px-5")}>
          <CalendarDays className="size-[18px] shrink-0 text-(--vr-gold-ink)" />
          <span className="min-w-0 leading-tight"><span className={small}>Check-in</span><span className="mt-1 block truncate text-[15px] font-semibold">{dayWeek(stay.checkIn)}</span></span>
        </button>
        <span aria-hidden className="my-3 hidden w-px shrink-0 bg-(--vr-line) lg:block" />
        <button type="button" onClick={onDates} className={cn(cell, "hidden flex-1 lg:flex lg:rounded-full lg:px-5")}>
          <span className="min-w-0 leading-tight"><span className={small}>Check-out · {nightsText(nights)}</span><span className="mt-1 block truncate text-[15px] font-semibold">{dayWeek(stay.checkOut)}</span></span>
        </button>
        <span aria-hidden className="my-3 w-px shrink-0 bg-(--vr-line)" />
        <button type="button" onClick={onDates} className={cn(cell, "lg:rounded-full lg:px-5")} aria-label={`Guests: ${guestsText(stay.adults, stay.children)}. Change`}>
          <Users className="size-[18px] shrink-0 text-(--vr-gold-ink)" />
          <span className="min-w-0 leading-tight">
            <span className={small}>Guests</span>
            <span className="mt-1 block whitespace-nowrap text-[15px] font-semibold">{stay.adults + stay.children}</span>
          </span>
        </button>
      </div>
      {closed ? (
        <div className="mt-1.5 rounded-[20px] bg-(--vr-gold-soft) px-4 py-3 text-[12.5px] leading-snug lg:mt-0 lg:max-w-xs lg:rounded-full">
          {closed}{phone && <> <a href={telHref(phone)} className="font-semibold underline underline-offset-2">Call {phone}</a></>}
        </div>
      ) : (
        <button type="button" onClick={onSee} className={cn(goldButton, "mt-1.5 h-[54px] w-full text-[15.5px] lg:mt-0 lg:h-[60px] lg:w-auto lg:px-9")}>
          See rooms<ArrowRight className="size-[18px]" />
        </button>
      )}
    </div>
  );
}
