"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, MapPin, MessageCircle, Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { lightButton, Photo, useSheetBehaviour } from "@/components/hotel-qr/ui";
import { useT } from "@/i18n/client";

/**
 * YOUR ROOM — the guest's page from the room's QR card or their stay link, in the Hotel QR app's calm look: a quiet
 * header on cream, ONE dark card (the room's photos, a few words, one gold button), then plain hairline rows. These are
 * its small building blocks.
 */

export const card = "rounded-3xl bg-(--vr-card) ring-1 ring-(--vr-line)";
export const caps = "text-[10.5px] font-semibold uppercase tracking-[0.2em] text-(--vr-muted)";
export const sectionTitle = "font-display text-[24px] font-semibold leading-none lg:text-[28px]";
/** The one gold button of the card — the restaurant banner's pill: a dark dot with the arrow, then the words. */
export const goldButton =
  "inline-flex max-w-full items-center gap-2 rounded-full bg-(--vr-gold) py-1 pl-1 pr-3.5 text-[13px] font-semibold text-(--vr-ink) shadow-[0_10px_24px_-14px_rgba(212,163,69,0.8)] transition hover:brightness-105 active:scale-[0.99] motion-reduce:active:scale-100";
export const goldDot = "grid size-7 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)";

/**
 * The banner every state of the page opens with — the restaurant banner's look (owner, 2026-10-05: "the same look as
 * the restaurant one, but better"): a compact dark card, the words on the left, the room on a round photo on the
 * right (three on computers), never words over a photo. Tap a photo to see them all.
 */
export function RoomCard({ photos, title, onPhotos, children }: { photos: string[]; title: string; onPhotos: (i: number) => void; children: React.ReactNode }) {
  const t = useT();
  const three = photos.slice(0, 3);
  return (
    <section aria-label={title} className="relative mt-3 overflow-hidden rounded-3xl bg-(--vr-dark) text-white shadow-[0_24px_50px_-34px_rgba(29,23,18,0.9)] sm:mt-4">
      <div aria-hidden className="pointer-events-none absolute -left-10 -top-16 size-52 rounded-full bg-(--vr-gold)/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 right-1/4 hidden size-72 rounded-full bg-(--vr-gold)/[0.07] blur-3xl lg:block" />
      {photos[0] && (
        <button type="button" onClick={() => onPhotos(0)} aria-label={t("{title} — see the photos", { title })}
          className={cn("absolute -right-8 top-1/2 size-[150px] -translate-y-1/2 overflow-hidden rounded-full shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] ring-4 ring-white/10 transition hover:ring-(--vr-gold)/50 sm:right-8 sm:size-[190px]", three.length >= 3 && "lg:hidden")}>
          <Photo src={photos[0]} alt={title} eager sizes="190px" />
        </button>
      )}
      {/* Computers: three of the room's photos side by side, the middle one larger */}
      {three.length >= 3 && (
        <div className="absolute right-10 top-1/2 hidden -translate-y-1/2 items-center lg:flex xl:right-14">
          {three.map((src, i) => (
            <button key={src} type="button" onClick={() => onPhotos(i)} aria-label={t("{title} — photo {n}", { title, n: i + 1 })}
              className={cn("relative shrink-0 overflow-hidden rounded-full shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)] ring-4 ring-(--vr-dark) transition hover:ring-(--vr-gold)/50",
                i === 1 ? "z-10 -mx-7 size-[200px] xl:size-[220px]" : "size-[150px] opacity-90 xl:size-[165px]")}>
              <Photo src={src} alt="" eager={i === 1} sizes="220px" />
            </button>
          ))}
        </div>
      )}
      <div className="relative max-w-[64%] p-4 sm:max-w-[60%] sm:p-6 lg:max-w-[46%] lg:px-8 lg:py-7 motion-safe:animate-[vlh-fade_0.7s_ease-out_both]">{children}</div>
    </section>
  );
}

/** One quiet action in the row under the banner: an icon and a word, never a pill. */
export function QuickLink({ icon: Icon, label, onClick, href, external }: {
  icon: typeof Phone; label: string; onClick?: () => void; href?: string; external?: boolean;
}) {
  const cls = "flex min-h-12 min-w-0 items-center justify-center gap-2 px-2 text-[13px] font-medium text-(--vr-ink)/80 transition hover:text-(--vr-ink)";
  const inner = <><Icon className="size-[17px] shrink-0 text-(--vr-gold-ink)" /><span className="truncate">{label}</span></>;
  if (href) return <a href={href} className={cls} {...(external ? { target: "_blank", rel: "noopener" } : {})}>{inner}</a>;
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

/** The row of quiet actions right under the banner: one light strip, hairlines between. */
export function QuickRow({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <nav aria-label={t("Quick links")} className="mt-2.5 grid grid-flow-col auto-cols-fr divide-x divide-(--vr-line) rounded-2xl bg-(--vr-card) ring-1 ring-(--vr-line) lg:max-w-xl">
      {children}
    </nav>
  );
}

/**
 * A sheet that slides up from the bottom of the phone (a small window on computers): swipe it down, tap outside, the ✕
 * or Escape to close; the page behind stays still and the keyboard stays inside.
 */
export function BottomSheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  const t = useT();
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
            <button type="button" onClick={onClose} aria-label={t("Close")} className="absolute right-3 top-3 z-10 grid size-10 place-items-center rounded-full bg-(--vr-bg) transition hover:bg-(--vr-line) sm:right-4 sm:top-4">
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
  /** English labels and values (shown translated); `i18n`: a value with words in it ("from 14:00"), to translate with its values. */
  hours: { label: string; value: string; i18n?: { key: string; vars: Record<string, string> } }[];
  address: string | null; mapHref: string | null;
  callHref: string | null; waHref: string | null; phoneLabel: string | null;
};

/** Call and WhatsApp, side by side. */
export function ContactButtons({ info, className }: { info: Pick<HotelInfo, "callHref" | "waHref">; className?: string }) {
  const t = useT();
  if (!info.callHref && !info.waHref) return null;
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      {info.callHref && <a href={info.callHref} className={cn(lightButton, "h-12 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />{t("Call")}</a>}
      {info.waHref && <a href={info.waHref} target="_blank" rel="noopener" className={cn(lightButton, "h-12 text-[14px]")}><MessageCircle className="size-4 text-(--vr-gold-ink)" />WhatsApp</a>}
    </div>
  );
}

/** Hours as hairline rows: "Restaurant ……… 07:00–22:00". */
export function HoursList({ hours, className }: { hours: HotelInfo["hours"]; className?: string }) {
  const t = useT();
  if (!hours.length) return null;
  return (
    <dl className={cn("divide-y divide-(--vr-line)", className)}>
      {hours.map((h) => (
        <div key={h.label} className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className="text-[13px] text-(--vr-muted)">{t(h.label)}</dt>
          <dd className="text-right text-[13.5px] font-semibold">{h.i18n ? t(h.i18n.key, h.i18n.vars) : t(h.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The hotel, compact, at the very bottom: the hours, reception, the address. */
export function HotelFooter({ info, note }: { info: HotelInfo; note: string }) {
  const t = useT();
  return (
    <div className="mt-12 lg:mt-16">
      <section aria-labelledby="hotel-title" className={cn(card, "grid gap-x-10 p-5 sm:p-6 lg:grid-cols-2")}>
        <div>
          <h2 id="hotel-title" className="font-display text-[22px] font-semibold leading-none">{t("Good to know")}</h2>
          <HoursList hours={info.hours} className="mt-2" />
        </div>
        <div className="mt-5 border-t border-(--vr-line) pt-5 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <h2 className="font-display text-[22px] font-semibold leading-none">{t("Reception")}</h2>
          <p className="mt-1.5 text-[13px] text-(--vr-muted)">{t("Here for you, day and night.")}{info.phoneLabel && <> <span className="whitespace-nowrap font-medium text-(--vr-ink)">{info.phoneLabel}</span></>}</p>
          <ContactButtons info={info} className="mt-3.5" />
          {info.address && (
            <p className="mt-3.5 flex items-start gap-2 text-[13px] text-(--vr-muted)">
              <MapPin className="mt-0.5 size-4 shrink-0 text-(--vr-gold-ink)" />
              <span>{info.address}{info.mapHref && <> · <a href={info.mapHref} target="_blank" rel="noopener" className="font-semibold text-(--vr-gold-ink) hover:underline">{t("Directions")}</a></>}</span>
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
  const t = useT();
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
    <motion.div ref={box} role="dialog" aria-modal="true" aria-label={t("{title} — photos", { title })} className="fixed inset-0 z-[70] flex flex-col bg-[#0c0a08] text-white"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6">
        <p className="min-w-0 truncate font-display text-[20px] lining-nums">{title} <span className="ml-2 font-sans text-[12px] text-white/55">{i + 1} / {photos.length}</span></p>
        <button type="button" onClick={onClose} aria-label={t("Close")} className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X className="size-5" /></button>
      </div>
      <div className="relative min-h-0 flex-1" onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); touch.current = null; }}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div key={photos[i]} className="absolute inset-0 mx-auto max-w-6xl px-2 sm:px-16" initial={{ opacity: 0, scale: reduce ? 1 : 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.25 }}>
            <div className="relative size-full"><Image src={photos[i]} alt={t("{title} — photo {n}", { title, n: i + 1 })} fill sizes="100vw" className="object-contain" priority /></div>
          </motion.div>
        </AnimatePresence>
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label={t("Previous photo")} className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:grid"><ChevronLeft className="size-5" /></button>
            <button type="button" onClick={() => go(1)} aria-label={t("Next photo")} className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:grid"><ChevronRight className="size-5" /></button>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 [scrollbar-width:none]">
          {photos.map((src, k) => (
            <button key={`${src}-${k}`} type="button" onClick={() => setI(k)} aria-label={t("Photo {n}", { n: k + 1 })} aria-current={k === i || undefined}
              className={cn("relative h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 transition", k === i ? "ring-(--vr-gold)" : "opacity-55 ring-transparent hover:opacity-90")}>
              <Image src={src} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
