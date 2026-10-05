"use client";

import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { CinematicHero, type HeroSlide } from "@/components/public/cinema/hero";
import { containers, HOTEL_COORDS } from "@/components/public/kit";
import { telHref } from "./lib";

/** The website's own opening (its photos, words, local time and weather), read on the server for the QR page. */
export interface QrHero {
  slides: HeroSlide[];
  /** "Mlimani City · Dar es Salaam" */
  eyebrow: string;
  /** "Your stay," + "elevated." */
  title: string;
  accent: string;
  place: string;
  initialTime: string;
  temp: string | null;
  /** "29°C · Partly cloudy" for the computer's readout. */
  weather: string | null;
}

/**
 * THE OPENING — exactly the website's landing (owner, 2026-10-05: "the same look as our landing page"): the hotel's
 * own photographs full screen with the cinematic grade, the plain local time and weather, and the words at the bottom.
 * The header is the website's wordmark with plain icons: the phone to call, "Book" in gold — no shapes around them.
 */
export function Opening({ hero, hotel, onBook, children }: {
  hero: QrHero; hotel: { name: string; phone: string | null }; onBook: (() => void) | null; children: React.ReactNode;
}) {
  const [first, ...rest] = hotel.name.split(" ");
  const quiet = "inline-flex h-10 items-center rounded-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none";
  return (
    <div className="relative">
      <header className="absolute inset-x-0 top-0 z-20 h-(--pub-header-h)">
        <div className={cn(containers.wide, "flex h-full items-center justify-between gap-3")}>
          <span className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- the tiny brand mark, same file as the website header */}
            <img src="/brand/logo-192.png" alt="" width={48} height={48} className="size-9 shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)] lg:size-11" />
            <span className="min-w-0 leading-none">
              <span className="block font-display text-[1.3rem] font-bold uppercase tracking-[0.16em] text-gold lg:text-[1.45rem]">{first}</span>
              {rest.length > 0 && (
                <span className="mt-1 block truncate text-[8.5px] font-semibold uppercase tracking-[0.38em] text-white/85 max-[359px]:hidden lg:text-[9.5px]">{rest.join(" ")}</span>
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 sm:gap-3">
            {hotel.phone && (
              <a href={telHref(hotel.phone)} aria-label={`Call ${hotel.name}`} className={cn(quiet, "w-9 justify-center text-white/90 hover:text-white")}>
                <Phone className="size-[18px]" strokeWidth={1.8} />
              </a>
            )}
            {onBook && (
              <button type="button" onClick={onBook} className={cn(quiet, "gap-1 whitespace-nowrap px-1 text-[14px] font-semibold text-gold hover:text-[#f0d6a0]")}>
                <span className="sm:hidden">Book</span><span className="hidden sm:inline">Book your stay</span>
              </button>
            )}
          </span>
        </div>
      </header>
      <CinematicHero labelledBy="qr-hero-title" slides={hero.slides}
        hud={{ place: hero.place, initialTime: hero.initialTime, temp: hero.temp, coords: HOTEL_COORDS.label }}>
        {children}
      </CinematicHero>
    </div>
  );
}
