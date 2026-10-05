"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Expand, MapPin, MessageCircle, Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { lightButton, Photo, useSheetBehaviour } from "@/components/hotel-qr/ui";

/**
 * YOUR ROOM — the guest's page from the room's QR card or their stay link, in the Hotel QR app's calm look: a quiet
 * header on cream, ONE dark card (the room's photos, a few words, one gold button), then plain hairline rows. These are
 * its small building blocks.
 */

export const card = "rounded-3xl bg-(--vr-card) ring-1 ring-(--vr-line)";
export const caps = "text-[10.5px] font-semibold uppercase tracking-[0.2em] text-(--vr-muted)";
export const sectionTitle = "font-display text-[24px] font-semibold leading-none lg:text-[28px]";
/** The one gold button of a card (the Hotel QR's "Check availability"). */
export const goldButton =
  "flex h-[52px] w-full items-center justify-between rounded-full bg-(--vr-gold) pl-6 pr-2 text-[15px] font-semibold text-(--vr-ink) shadow-[0_14px_30px_-14px_rgba(212,163,69,0.75)] transition hover:brightness-105 active:scale-[0.99] motion-reduce:active:scale-100";
export const goldDot = "grid size-9 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)";

/** The dark card every state of the page opens with: photos on top (beside the words on computers), the words below. */
export function RoomCard({ photos, title, onPhotos, children }: { photos: string[]; title: string; onPhotos: (i: number) => void; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="relative mt-3 overflow-hidden rounded-3xl bg-(--vr-dark) text-white shadow-[0_24px_50px_-34px_rgba(29,23,18,0.9)] sm:mt-4 lg:grid lg:min-h-[420px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-(--vr-gold)/10 blur-3xl" />
      <Slideshow photos={photos} alt={title} onOpen={onPhotos} className="lg:order-last" />
      <div className="relative min-w-0 px-5 pb-5 pt-4 sm:px-7 sm:pb-7 lg:self-center lg:px-10 lg:py-10 motion-safe:animate-[vlh-fade_0.7s_ease-out_both]">{children}</div>
    </section>
  );
}

/**
 * The room's real photos one after another — a slow crossfade and a gentle zoom (still for people who prefer less
 * motion); tap to see them all. The words never sit on a photo.
 */
function Slideshow({ photos, alt, onOpen, className }: { photos: string[]; alt: string; onOpen: (i: number) => void; className?: string }) {
  const reduce = useReducedMotion();
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (reduce || paused || photos.length < 2) return;
    const t = setInterval(() => setAt((x) => (x + 1) % photos.length), 6000);
    return () => clearInterval(t);
  }, [reduce, paused, photos.length]);
  const src = photos[at] ?? photos[0];
  const next = photos[(at + 1) % photos.length];
  return (
    <figure className={cn("relative min-w-0", className)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <button type="button" onClick={() => onOpen(at)} aria-label={`${alt} — see the photos`}
        className="group relative block aspect-[4/3] w-full overflow-hidden bg-white/5 sm:aspect-[16/9] lg:aspect-auto lg:h-full lg:min-h-[420px]">
        <AnimatePresence initial={false}>
          <motion.span key={src} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 1.2, ease: "easeInOut" }}>
            <Photo src={src} alt={at === 0 ? alt : `${alt} — photo ${at + 1}`} eager={at === 0} sizes="(min-width:1024px) 760px, 100vw"
              imgClassName="motion-safe:animate-[vlh-kb-a_14s_cubic-bezier(0.25,0.1,0.25,1)_both]" />
          </motion.span>
        </AnimatePresence>
        {next && next !== src && <span aria-hidden className="invisible absolute inset-0"><Photo src={next} alt="" sizes="(min-width:1024px) 760px, 100vw" /></span>}
        {/* Melts the photo into the card (phones: into the words below it) */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-(--vr-dark) to-transparent lg:hidden" />
        <span aria-hidden className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-black/35 text-white/90 opacity-0 backdrop-blur-sm transition group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
          <Expand className="size-4" />
        </span>
      </button>
      {photos.length > 1 && (
        <figcaption className="absolute bottom-2 right-3 flex items-center" aria-label={`Photo ${at + 1} of ${photos.length}`}>
          {photos.slice(0, 8).map((p, k) => (
            <button key={`${p}-${k}`} type="button" onClick={() => setAt(k)} aria-label={`Show photo ${k + 1}`} className="grid h-7 w-5 place-items-center">
              <span className={cn("block h-1.5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-all", k === at ? "w-4 bg-(--vr-gold)" : "w-1.5 bg-white/55")} />
            </button>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

/** One quiet action under the gold button: an icon and a word, never a pill. */
export function QuickLink({ icon: Icon, label, onClick, href, external }: {
  icon: typeof Phone; label: string; onClick?: () => void; href?: string; external?: boolean;
}) {
  const cls = "flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 px-1 text-center text-[12.5px] font-medium text-white/80 transition hover:text-white lg:min-h-11 lg:flex-row lg:justify-start lg:gap-2 lg:px-0 lg:text-[13.5px]";
  const inner = <><Icon className="size-[18px] shrink-0 text-(--vr-gold)" /><span className="truncate">{label}</span></>;
  if (href) return <a href={href} className={cls} {...(external ? { target: "_blank", rel: "noopener" } : {})}>{inner}</a>;
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

/** The row of quiet actions at the bottom of the dark card. */
export function QuickRow({ children }: { children: React.ReactNode }) {
  return (
    <nav aria-label="Quick links" className="mt-4 grid grid-flow-col auto-cols-fr divide-x divide-white/10 border-t border-white/10 pt-1.5 lg:mt-6 lg:flex lg:gap-7 lg:divide-x-0 lg:pt-3">
      {children}
    </nav>
  );
}

/**
 * A sheet that slides up from the bottom of the phone (a small window on computers): swipe it down, tap outside, the ✕
 * or Escape to close; the page behind stays still and the keyboard stays inside.
 */
export function BottomSheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const panel = useRef<HTMLDivElement>(null);
  useSheetBehaviour(open, onClose, panel);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1d1712]/55 backdrop-blur-[2px] sm:items-center sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div ref={panel} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
            drag={reduce ? false : "y"} dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, i) => { if (i.offset.y > 90 || i.velocity.y > 600) onClose(); }}
            initial={reduce ? { opacity: 0 } : { y: "100%" }} animate={reduce ? { opacity: 1 } : { y: 0 }} exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            className="vr relative max-h-[92svh] w-full overflow-y-auto overscroll-contain rounded-t-[28px] bg-(--vr-card) text-(--vr-ink) shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.5)] sm:max-w-[440px] sm:rounded-[28px]">
            <div onPointerDown={(e) => drag.start(e)} className="flex cursor-grab touch-none justify-center pb-1 pt-2.5 sm:hidden" aria-hidden>
              <span className="h-1.5 w-10 rounded-full bg-(--vr-line)" />
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 grid size-10 place-items-center rounded-full bg-(--vr-bg) transition hover:bg-(--vr-line) sm:right-4 sm:top-4">
              <X className="size-4" />
            </button>
            <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:px-7 sm:pb-7 sm:pt-7">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A sheet's title and one line under it. */
export function SheetHead({ title, text }: { title: string; text?: React.ReactNode }) {
  return (
    <div className="pr-10">
      <h2 className="font-display text-[26px] font-semibold leading-[1.1]">{title}</h2>
      {text && <p className="mt-1.5 text-[13.5px] leading-relaxed text-(--vr-muted)">{text}</p>}
    </div>
  );
}

export type HotelInfo = {
  hours: { label: string; value: string }[];
  address: string | null; mapHref: string | null;
  callHref: string | null; waHref: string | null; phoneLabel: string | null;
};

/** Call and WhatsApp, side by side. */
export function ContactButtons({ info, className }: { info: Pick<HotelInfo, "callHref" | "waHref">; className?: string }) {
  if (!info.callHref && !info.waHref) return null;
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      {info.callHref && <a href={info.callHref} className={cn(lightButton, "h-12 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />Call</a>}
      {info.waHref && <a href={info.waHref} target="_blank" rel="noopener" className={cn(lightButton, "h-12 text-[14px]")}><MessageCircle className="size-4 text-(--vr-gold-ink)" />WhatsApp</a>}
    </div>
  );
}

/** Hours as hairline rows: "Restaurant ……… 07:00–22:00". */
export function HoursList({ hours, className }: { hours: HotelInfo["hours"]; className?: string }) {
  if (!hours.length) return null;
  return (
    <dl className={cn("divide-y divide-(--vr-line)", className)}>
      {hours.map((h) => (
        <div key={h.label} className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-[13px] text-(--vr-muted)">{h.label}</dt>
          <dd className="text-right text-[13.5px] font-semibold">{h.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The hotel, compact, at the very bottom: the hours, reception, the address. */
export function HotelFooter({ info, note }: { info: HotelInfo; note: string }) {
  return (
    <div className="mt-12 lg:mt-16">
      <section aria-labelledby="hotel-title" className={cn(card, "grid gap-x-10 p-5 sm:p-6 lg:grid-cols-2")}>
        <div>
          <h2 id="hotel-title" className="font-display text-[22px] font-semibold leading-none">Good to know</h2>
          <HoursList hours={info.hours} className="mt-2" />
        </div>
        <div className="mt-5 border-t border-(--vr-line) pt-5 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <h2 className="font-display text-[22px] font-semibold leading-none">Reception</h2>
          <p className="mt-1.5 text-[13px] text-(--vr-muted)">Here for you, day and night.{info.phoneLabel && <> <span className="whitespace-nowrap font-medium text-(--vr-ink)">{info.phoneLabel}</span></>}</p>
          <ContactButtons info={info} className="mt-3.5" />
          {info.address && (
            <p className="mt-3.5 flex items-start gap-2 text-[13px] text-(--vr-muted)">
              <MapPin className="mt-0.5 size-4 shrink-0 text-(--vr-gold-ink)" />
              <span>{info.address}{info.mapHref && <> · <a href={info.mapHref} target="_blank" rel="noopener" className="font-semibold text-(--vr-gold-ink) hover:underline">Directions</a></>}</span>
            </p>
          )}
        </div>
      </section>
      <p className="mt-6 text-center text-[11.5px] text-(--vr-muted)">{note}</p>
    </div>
  );
}

/** The room's photos, full screen: swipe or use the arrows, Escape closes. */
export function PhotoViewer({ photos, start, title, onClose }: { photos: string[]; start: number | null; title: string; onClose: () => void }) {
  return (
    <AnimatePresence>
      {start !== null && <Viewer key={start} photos={photos} start={start} title={title} onClose={onClose} />}
    </AnimatePresence>
  );
}
function Viewer({ photos, start, title, onClose }: { photos: string[]; start: number; title: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const reduce = useReducedMotion();
  const touch = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useSheetBehaviour(true, onClose, box);
  const go = (d: number) => setI((x) => (x + d + photos.length) % photos.length);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowRight") setI((x) => (x + 1) % photos.length); if (e.key === "ArrowLeft") setI((x) => (x - 1 + photos.length) % photos.length); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [photos.length]);
  return (
    <motion.div ref={box} role="dialog" aria-modal="true" aria-label={`${title} — photos`} className="fixed inset-0 z-[70] flex flex-col bg-[#0c0a08] text-white"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6">
        <p className="min-w-0 truncate font-display text-[20px] lining-nums">{title} <span className="ml-2 font-sans text-[12px] text-white/55">{i + 1} / {photos.length}</span></p>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X className="size-5" /></button>
      </div>
      <div className="relative min-h-0 flex-1" onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); touch.current = null; }}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div key={photos[i]} className="absolute inset-0 mx-auto max-w-6xl px-2 sm:px-16" initial={{ opacity: 0, scale: reduce ? 1 : 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.25 }}>
            <div className="relative size-full"><Image src={photos[i]} alt={`${title} — photo ${i + 1}`} fill sizes="100vw" className="object-contain" priority /></div>
          </motion.div>
        </AnimatePresence>
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:grid"><ChevronLeft className="size-5" /></button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:grid"><ChevronRight className="size-5" /></button>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 [scrollbar-width:none]">
          {photos.map((src, k) => (
            <button key={`${src}-${k}`} type="button" onClick={() => setI(k)} aria-label={`Photo ${k + 1}`} aria-current={k === i || undefined}
              className={cn("relative h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 transition", k === i ? "ring-(--vr-gold)" : "opacity-55 ring-transparent hover:opacity-90")}>
              <Image src={src} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
