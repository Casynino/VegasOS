"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, CalendarCheck, ChevronRight, Clock, Coffee, ConciergeBell, DoorOpen, Lock, MapPin, MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { NetworkMarks } from "@/components/payments/networks";
import type { QrLanding, QrRoomType } from "@/server/services/hotel-qr";
import { BrandMark, card, darkButton, lightButton, Photo } from "./ui";
import { dayShort, telHref, tzs, waHref, type LastBooking } from "./lib";

/** Wide screens: one row of room types when they fit (5 types → 5 columns, never a lone tile on a second row). */
const XL_COLS: Record<number, string> = { 3: "xl:grid-cols-3", 5: "xl:grid-cols-5", 6: "xl:grid-cols-3" };
const PLACE: Record<string, string> = { exterior: "The hotel", lobby: "Lobby", rooms: "Rooms", bath: "Bathrooms", amenity: "Details" };

/**
 * THE FIRST SCREEN after the scan — the hotel, not a form: real photos sliding slowly on the espresso band (the words
 * never sit on a photo), "Your stay starts here.", Explore rooms / Check availability; then the rooms with tonight's
 * real price, a few photos of the hotel, the times that matter and how to reach reception.
 */
export function Landing({ landing, imagesOf, last, onExplore, onCheck, onType }: {
  landing: QrLanding; imagesOf: (t: { images: string[] }) => string[]; last: LastBooking | null;
  onExplore: () => void; onCheck: () => void; onType: (slug: string) => void;
}) {
  const { hotel, roomTypes, booking } = landing;
  const from = roomTypes.length ? Math.min(...roomTypes.map((t) => t.fromPerNight)) : null;
  const strip = hotel.photos.filter((p) => p.category !== "rooms").slice(0, 8);

  // Phones: once the two buttons scroll away, "Check availability" waits at the bottom.
  const buttons = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState(false);
  useEffect(() => {
    const el = buttons.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setBar(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const facts = [`Check-in from ${hotel.checkInTime}`, ...hotel.highlights.slice(0, 2)];
  return (
    <div className="pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-14">
      {/* ── The hotel, the restaurant app's way (owner, 2026-10-05: "too many shapes"): a quiet header on cream, then ONE
          dark card — the photos, a few words, one button. No pills, no chips. ── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5 lg:px-8">
        <span className="flex min-w-0 items-center gap-2.5">
          <BrandMark className="size-9" />
          <span className="min-w-0 leading-none">
            <span className="block truncate font-display text-[17px] font-semibold tracking-wide">{hotel.name}</span>
            <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.2em] text-(--vr-muted)">{hotel.tagline ?? "Rooms & suites"}</span>
          </span>
        </span>
        {hotel.phone && (
          <a href={telHref(hotel.phone)} aria-label={`Call ${hotel.name}`}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-(--vr-card) px-3 text-[13px] font-medium ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold) sm:px-3.5">
            <Phone className="size-4 text-(--vr-gold-ink)" /><span className="hidden sm:inline">Call us</span>
          </a>
        )}
      </header>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <section className="relative mt-3 overflow-hidden rounded-3xl bg-(--vr-dark) text-white shadow-[0_24px_50px_-34px_rgba(29,23,18,0.9)] sm:mt-4 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-(--vr-gold)/10 blur-3xl" />
          <Slideshow slides={hotel.slides.length ? hotel.slides : [{ src: hotel.hero.src, mobileSrc: null, alt: hotel.hero.alt, caption: null }]} className="lg:order-last" />
          <div className="relative min-w-0 px-5 pb-6 pt-5 sm:px-7 sm:pb-7 lg:self-center lg:px-10 lg:py-12 motion-safe:animate-[vlh-fade_0.7s_ease-out_both]">
            <h1 className="font-display text-[34px] font-semibold leading-[1.02] tracking-tight sm:text-[40px] lg:text-[50px]">
              Your stay<br /><span className="text-(--vr-gold)">starts here.</span>
            </h1>
            <p className="mt-2.5 text-[12px] leading-relaxed text-white/55">{facts.join("  ·  ")}</p>

            <div ref={buttons} className="mt-5 max-w-sm">
              <button type="button" onClick={onCheck}
                className="flex h-[52px] w-full items-center justify-between rounded-full bg-(--vr-gold) pl-6 pr-2 text-[15px] font-semibold text-(--vr-ink) shadow-[0_14px_30px_-14px_rgba(212,163,69,0.75)] transition hover:brightness-105">
                Check availability
                <span className="grid size-9 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><ArrowRight className="size-4" /></span>
              </button>
              <button type="button" onClick={onExplore} className="mt-3 inline-flex items-center gap-1.5 px-1 text-[13.5px] font-medium text-white/80 transition hover:text-white">
                Explore our rooms{from !== null && <span className="text-white/50">· from <span className="tabular-nums text-(--vr-gold)">{tzs(from)}</span></span>}<ChevronRight className="size-4 text-(--vr-gold)" />
              </button>
            </div>
            {booking.message && <p className="mt-4 max-w-sm text-[12.5px] leading-snug text-white/70">{booking.message}</p>}
          </div>
        </section>
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* ── A booking made a moment ago in this tab ── */}
        {last && (
          <Link href={last.confirmUrl} className={cn(card, "mt-4 flex items-center gap-3 p-3.5 transition hover:ring-(--vr-gold)")}>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><CalendarCheck className="size-[18px]" /></span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[14px] font-semibold">Your booking {last.reference}</span>
              <span className="mt-0.5 block truncate text-[12.5px] text-(--vr-muted)">Room {last.room} · {dayShort(last.checkIn)} → {dayShort(last.checkOut)}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-(--vr-gold-ink)">View<ChevronRight className="size-4" /></span>
          </Link>
        )}

        {/* ── The rooms ── */}
        {roomTypes.length > 0 && (
          <section aria-labelledby="rooms-title" className="mt-7 lg:mt-10">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="rooms-title" className="font-display text-[24px] font-semibold leading-none lg:text-[28px]">Our rooms</h2>
              <button type="button" onClick={onExplore} className="inline-flex items-center gap-1 text-[13px] font-medium text-(--vr-gold-ink) hover:underline">See all<ChevronRight className="size-4" /></button>
            </div>
            <div className={cn("-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 lg:grid-cols-3 lg:gap-5", XL_COLS[roomTypes.length] ?? "xl:grid-cols-4")}>
              {roomTypes.map((t) => <RoomTile key={t.slug} t={t} image={imagesOf(t)[0] ?? null} onOpen={() => onType(t.slug)} />)}
            </div>
          </section>
        )}

        {/* ── A look around ── */}
        {strip.length > 0 && (
          <section aria-labelledby="look-title" className="mt-8 lg:mt-12">
            <h2 id="look-title" className="mb-3 font-display text-[24px] font-semibold leading-none lg:text-[28px]">A look around</h2>
            {/* Phones and tablets swipe; computers see them all (a mouse cannot swipe). */}
            <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-3 lg:overflow-visible lg:px-0 xl:grid-cols-8">
              {strip.map((p) => (
                <figure key={p.src} className="w-[150px] shrink-0 snap-start sm:w-[180px] lg:w-auto">
                  <div className="relative aspect-[3/4] overflow-hidden rounded-2xl lg:aspect-[4/3] xl:aspect-[3/4]"><Photo src={p.src} alt={p.alt} sizes="(min-width:1024px) 260px, 180px" /></div>
                  <figcaption className="mt-1.5 text-[12px] text-(--vr-muted)">{PLACE[p.category] ?? "The hotel"}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* ── Good to know, and reception ── */}
        <div className="mt-8 grid gap-3 lg:mt-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-5">
          <section aria-labelledby="know-title" className={cn(card, "p-4 sm:p-5")}>
            <h2 id="know-title" className="font-display text-[22px] font-semibold leading-none">Good to know</h2>
            <dl className="mt-2 divide-y divide-(--vr-line)">
              <Fact icon={Clock} label="Check-in" value={`from ${hotel.checkInTime}`} />
              <Fact icon={DoorOpen} label="Check-out" value={`by ${hotel.checkoutTime}`} />
              {hotel.breakfastHours && <Fact icon={Coffee} label="Breakfast" value={hotel.breakfastHours} />}
              <Fact icon={ConciergeBell} label="Reception" value={hotel.receptionHours || "24 hours"} />
            </dl>
            {landing.policies.length > 0 && (
              <ul className="mt-3.5 space-y-1.5 border-t border-(--vr-line) pt-3.5 text-[12.5px] leading-snug text-(--vr-muted)">
                {landing.policies.filter((p) => !p.startsWith("Check-in from")).map((p) => <li key={p} className="flex gap-2"><span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-(--vr-gold)" />{p}</li>)}
              </ul>
            )}
          </section>
          <section aria-labelledby="talk-title" className={cn(card, "flex flex-col p-4 sm:p-5")}>
            <h2 id="talk-title" className="font-display text-[22px] font-semibold leading-none">Talk to reception</h2>
            <p className="mt-1.5 text-[13px] text-(--vr-muted)">A bigger group, a question, a special date — we are happy to help.</p>
            <div className="mt-3.5 grid grid-cols-2 gap-2">
              {hotel.phone && <a href={telHref(hotel.phone)} className={cn(lightButton, "h-11 text-[13.5px]")}><Phone className="size-4 text-(--vr-gold-ink)" />Call</a>}
              {hotel.whatsapp && <a href={waHref(hotel.whatsapp, `Hello ${hotel.name}, I would like to book a room.`)} target="_blank" rel="noopener" className={cn(lightButton, "h-11 text-[13.5px]")}><MessageCircle className="size-4 text-(--vr-gold-ink)" />WhatsApp</a>}
            </div>
            {hotel.address && <p className="mt-3 flex items-start gap-2 text-[12.5px] text-(--vr-muted)"><MapPin className="mt-px size-3.5 shrink-0 text-(--vr-gold-ink)" />{hotel.address}</p>}
            {booking.online && (
              <div className="mt-auto pt-4">
                <div className="space-y-1.5 border-t border-(--vr-line) pt-3.5">
                  <NetworkMarks label="Pay with" />
                  <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-(--vr-muted)"><Lock className="size-3 text-(--vr-gold-ink)" />Secure payment by <span className="font-semibold tracking-wide text-(--vr-ink)/80">NTZS</span></p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Phones: "Check availability" once the hero's buttons are gone */}
      <AnimatePresence>
        {bar && (
          <motion.div initial={{ y: 90 }} animate={{ y: 0 }} exit={{ y: 90 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
            <button type="button" onClick={onCheck} className={cn(darkButton, "mx-auto flex h-14 w-full max-w-md justify-between pl-5 pr-4 shadow-[0_16px_40px_-14px_rgba(29,23,18,0.85)]")}>
              <span className="text-[14.5px]">Check availability</span>
              <span className="inline-flex items-center gap-2 text-[13px] font-medium text-white/70">
                {from !== null && <>from <span className="font-semibold tabular-nums text-(--vr-gold)">{tzs(from)}</span></>}
                <ArrowRight className="size-4 text-(--vr-gold)" />
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A room type on the first screen: its photo, name and tonight's price; tap to see it. */
function RoomTile({ t, image, onOpen }: { t: QrRoomType; image: string | null; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group w-[232px] shrink-0 snap-start text-left sm:w-[260px] md:w-auto">
      <span className="relative block aspect-[4/3] overflow-hidden rounded-2xl bg-(--vr-line)">
        {image && <Photo src={image} alt={t.name} sizes="(min-width:1024px) 280px, 260px" imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-105 motion-reduce:group-hover:scale-100" />}
      </span>
      <span className="mt-2 block min-w-0">
        <span className="line-clamp-2 block text-[15px] font-semibold leading-tight">{t.name}</span>
        <span className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[12.5px] tabular-nums text-(--vr-muted)">from <strong className="font-semibold text-(--vr-ink)">{tzs(t.fromPerNight)}</strong> / night</span>
          <FreeTonight n={t.freeTonight} />
        </span>
      </span>
    </button>
  );
}

/** "3 free tonight" — or that the type is full tonight (other nights may be free). */
export function FreeTonight({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium", n > 0 ? "text-emerald-700" : "text-(--vr-muted)", className)}>
      <span className={cn("size-1.5 rounded-full", n > 0 ? "bg-emerald-500" : "bg-(--vr-muted)/50")} />
      {n > 0 ? `${n} free tonight` : "Full tonight"}
    </span>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex items-center gap-2 text-[13px] text-(--vr-muted)"><Icon className="size-4 text-(--vr-gold-ink)" />{label}</dt>
      <dd className="text-[13.5px] font-semibold">{value}</dd>
    </div>
  );
}

/**
 * The hotel's real photos, one after another — a slow crossfade and a gentle zoom (still for people who prefer less
 * motion). The caption sits under the photo, never on it.
 */
function Slideshow({ slides, className }: { slides: { src: string; alt: string; caption: string | null }[]; className?: string }) {
  const reduce = useReducedMotion();
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (reduce || slides.length < 2) return;
    const t = setInterval(() => setAt((x) => (x + 1) % slides.length), 6500);
    return () => clearInterval(t);
  }, [reduce, slides.length]);
  const slide = slides[at] ?? slides[0];
  const next = slides[(at + 1) % slides.length];
  return (
    <figure className={cn("relative min-w-0", className)}>
      <div className="relative aspect-[4/3] overflow-hidden bg-white/5 sm:aspect-[16/9] lg:aspect-auto lg:h-full lg:min-h-[440px]">
        <AnimatePresence initial={false}>
          <motion.div key={slide.src} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 1.2, ease: "easeInOut" }}>
            <Photo src={slide.src} alt={slide.alt} eager={at === 0} sizes="(min-width:1024px) 640px, 100vw"
              imgClassName="motion-safe:animate-[vlh-kb-a_14s_cubic-bezier(0.25,0.1,0.25,1)_both]" />
          </motion.div>
        </AnimatePresence>
        {/* The next photo, loading quietly so the change is smooth */}
        {next && next.src !== slide.src && <span aria-hidden className="invisible absolute inset-0"><Photo src={next.src} alt="" sizes="(min-width:1024px) 640px, 100vw" /></span>}
        {/* Melts the photo into the card (phones: into the words below it) */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-(--vr-dark) to-transparent lg:hidden" />
      </div>
      {slides.length > 1 && (
        <figcaption className="absolute bottom-3 right-4 flex items-center gap-1.5" aria-label={`Photo ${at + 1} of ${slides.length}: ${slide.caption ?? slide.alt}`}>
          {slides.map((s, k) => (
            <button key={s.src} type="button" onClick={() => setAt(k)} aria-label={`Show photo ${k + 1}`}
              className={cn("h-1.5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-all", k === at ? "w-5 bg-(--vr-gold)" : "w-1.5 bg-white/55 hover:bg-white/80")} />
          ))}
        </figcaption>
      )}
    </figure>
  );
}
