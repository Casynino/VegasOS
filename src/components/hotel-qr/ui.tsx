"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronLeft, ChevronRight, Loader2, Minus, Phone, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { blurFor } from "@/components/public/blur-data";
import { NamedIcon } from "@/components/public/icon";
import { historyDepth, telHref } from "./lib";

/**
 * The Hotel QR app's building blocks — the restaurant app's look (warm cream, white cards, espresso ink, one gold
 * accent; the ".vr" colours), sized for one hand on a phone: 14–15px text, 22px serif titles, 44–48px buttons.
 */

export const card = "rounded-3xl bg-(--vr-card) ring-1 ring-(--vr-line)";
export const caps = "text-[10.5px] font-semibold uppercase tracking-[0.2em] text-(--vr-muted)";
export const input = "block h-12 w-full rounded-2xl border border-(--vr-line) bg-white px-4 text-[16px] outline-none transition placeholder:text-(--vr-muted)/60 focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15 sm:text-[15px] aria-invalid:border-rose-400";
export const darkButton = "inline-flex items-center justify-center gap-2 rounded-full bg-(--vr-dark) font-semibold text-white transition hover:bg-black disabled:opacity-45";
export const lightButton = "inline-flex items-center justify-center gap-2 rounded-full bg-(--vr-card) font-medium ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold) disabled:opacity-45";
/** The one gold button of a screen (See rooms · Pay now / Send booking). */
export const goldButton = "inline-flex items-center justify-center gap-2 rounded-full bg-(--vr-gold) font-semibold text-(--vr-ink) shadow-[0_14px_30px_-14px_rgba(212,163,69,0.8)] transition hover:brightness-105 active:brightness-95 disabled:opacity-50 disabled:shadow-none";

/**
 * The phone's Back closes an overlay (a room's sheet, the photo viewer) instead of leaving the step: `opened()` when it
 * opens adds one history entry (same address); Back takes it off and closes the overlay; `closed()` when it is closed
 * its own way (X, Escape, a tap outside) steps back over that entry. Leaving the overlay for another step replaces its
 * entry instead (the app's "replace"), so Back then returns to where the overlay was opened.
 */
export function useBackClose(close: () => void) {
  const entry = useRef<string | null>(null);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const onPop = () => {
      const key = entry.current;
      if (key && (window.history.state as { vqrOverlay?: string } | null)?.vqrOverlay !== key) { entry.current = null; closeRef.current(); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const opened = useCallback(() => {
    if (entry.current) return;
    const key = Math.random().toString(36).slice(2);
    entry.current = key;
    window.history.pushState({ vqr: historyDepth() + 1, vqrOverlay: key }, "");
  }, []);
  const closed = useCallback(() => {
    const key = entry.current;
    entry.current = null;
    if (key && (window.history.state as { vqrOverlay?: string } | null)?.vqrOverlay === key) window.history.back();
  }, []);
  return useMemo(() => ({ opened, closed }), [opened, closed]);
}

/** The hotel's mark: the logo on espresso with a thin gold ring. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) ring-[1.5px] ring-(--vr-gold)/60", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-192.png" alt="" className="size-[78%] rounded-full" />
    </span>
  );
}

/** Computers: the hotel above every step (phones keep the space for the step itself). */
export function BrandBar({ hotel, phone, className }: { hotel: string; phone: string | null; className?: string }) {
  return (
    <div className={cn("items-center justify-between gap-3 pt-6", className)}>
      <span className="flex min-w-0 items-center gap-2.5">
        <BrandMark className="size-9" />
        <span className="min-w-0 leading-none">
          <span className="block truncate font-display text-[17px] font-semibold tracking-wide">{hotel}</span>
          <span className="mt-0.5 block text-[10px] uppercase tracking-[0.2em] text-(--vr-muted)">Book your stay</span>
        </span>
      </span>
      {phone && <a href={telHref(phone)} className={cn(lightButton, "h-10 px-4 text-[13px]")}><Phone className="size-4 text-(--vr-gold-ink)" />{phone}</a>}
    </div>
  );
}

/**
 * A photo that never shows an empty box: a soft copy first (the tiny blurred version, or the cream tint), then the
 * sharp photo fades in. Lazy unless it is the first thing on the screen — that one shows as it arrives (no waiting for
 * the page's script), so the first screen is quick.
 */
export function Photo({ src, alt, sizes, eager, className, imgClassName }: {
  src: string; alt: string; sizes: string; eager?: boolean; className?: string; imgClassName?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const blur = blurFor(src);
  const fade = !eager && !("placeholder" in blur);
  return (
    <span className={cn("absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,#efe5d4,#e2d3ba)]", className)}>
      <Image src={src} alt={alt} fill sizes={sizes} loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : undefined} {...blur}
        onLoad={fade ? () => setLoaded(true) : undefined}
        className={cn("object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none", !fade || loaded ? "opacity-100" : "opacity-0", imgClassName)} />
    </span>
  );
}

/** Photos that slide sideways (a swipe on phones, arrows on computers) with small dots — no words over the photos. */
export function Gallery({ images, alt, sizes, eager, className, round = "rounded-3xl" }: {
  images: string[]; alt: string; sizes: string; eager?: boolean; className?: string; round?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  }, []);
  const go = (d: 1 | -1) => { const el = ref.current; if (el) el.scrollBy({ left: d * el.clientWidth, behavior: "smooth" }); };
  const many = images.length > 1;
  return (
    <div className={cn("group relative isolate overflow-hidden bg-(--vr-line)", round, className)}>
      <div ref={ref} onScroll={onScroll} className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {images.map((src, k) => (
          <div key={`${src}-${k}`} className="relative h-full w-full shrink-0 snap-center snap-always">
            <Photo src={src} alt={k === 0 ? alt : `${alt} — photo ${k + 1}`} sizes={sizes} eager={eager && k === 0}
              imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100" />
          </div>
        ))}
      </div>
      {many && (
        <>
          <span aria-hidden className="pointer-events-none absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/35 px-2 py-1 backdrop-blur-sm">
            {images.slice(0, 8).map((src, k) => <span key={`${src}-${k}`} className={cn("h-1.5 rounded-full transition-all", k === Math.min(at, 7) ? "w-3.5 bg-white" : "w-1.5 bg-white/55")} />)}
          </span>
          <button type="button" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous photo"
            className="absolute left-2.5 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-(--vr-ink) opacity-0 shadow transition group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden sm:grid [@media(hover:none)]:opacity-100"><ChevronLeft className="size-4" /></button>
          <button type="button" onClick={() => go(1)} disabled={at >= images.length - 1} aria-label="Next photo"
            className="absolute right-2.5 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-(--vr-ink) opacity-0 shadow transition group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden sm:grid [@media(hover:none)]:opacity-100"><ChevronRight className="size-4" /></button>
        </>
      )}
    </div>
  );
}

/** A number with − and + (guests). */
export function Stepper({ label, hint, value, min, max, onChange }: { label: string; hint?: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const btn = "grid size-10 place-items-center rounded-full bg-(--vr-card) ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold) disabled:opacity-30 disabled:hover:ring-(--vr-line)";
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0 leading-tight">
        <p className="text-[14.5px] font-semibold">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] text-(--vr-muted)">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`} className={btn}><Minus className="size-4" /></button>
        <span className="w-6 text-center text-[17px] font-semibold tabular-nums" aria-live="polite">{value}</span>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`} className={btn}><Plus className="size-4" /></button>
      </div>
    </div>
  );
}

/** A few of the room's amenities as small icon chips ("Free Wi-Fi", "Breakfast"…). */
export function Amenities({ list, max = 4, className }: { list: { code: string; name: string; icon: string | null }[]; max?: number; className?: string }) {
  if (!list.length) return null;
  const shown = list.slice(0, max);
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {shown.map((a) => (
        <li key={a.code} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-(--vr-bg) px-2.5 text-[12px] text-(--vr-ink)/80 ring-1 ring-(--vr-line)">
          <NamedIcon name={a.icon} className="size-3.5 text-(--vr-gold-ink)" />{a.name}
        </li>
      ))}
      {list.length > max && <li className="inline-flex h-7 items-center px-1.5 text-[12px] text-(--vr-muted)">+{list.length - max} more</li>}
    </ul>
  );
}

/**
 * The top of a step: back, where you are, and a thin gold line for how far along the booking is. Phones: it stays at
 * the top while the step scrolls.
 */
/** The booking's steps: 1 dates & guests (the sheet), 2 choose your room, 3 your details & pay. */
export const STEPS = 3;

export function StepHeader({ title, sub, onBack, step }: { title: string; sub?: React.ReactNode; onBack: () => void; /** 2–3: room, details & pay. */ step?: number }) {
  return (
    <div className="sticky top-0 z-30 -mx-4 bg-(--vr-bg)/92 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:pt-7 lg:backdrop-blur-none">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back" className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-card) ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold)">
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="font-display text-[24px] font-semibold leading-[1.1] text-balance lg:text-[30px]">{title}</h1>
          {sub && <div className="mt-0.5 text-[12.5px] leading-snug text-(--vr-muted)">{sub}</div>}
        </div>
        {step && <span className="shrink-0 self-start pt-1.5 text-[11px] font-medium tabular-nums text-(--vr-muted)" aria-label={`Step ${step} of ${STEPS}`}>Step {step} of {STEPS}</span>}
      </div>
      {step && (
        <div aria-hidden className="mt-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${STEPS}, minmax(0, 1fr))` }}>
          {Array.from({ length: STEPS }, (_, k) => (
            <span key={k} className={cn("h-[3px] rounded-full transition-colors duration-500", k < step ? "bg-(--vr-gold)" : "bg-(--vr-line)")} />
          ))}
        </div>
      )}
    </div>
  );
}

export type CtaProps = {
  label: React.ReactNode; onClick: () => void; disabled?: boolean; pending?: boolean;
  icon?: React.ReactNode;
  /** Beside the button on phones, above it on computers: "Total", "TZS 240,000". */
  amount?: { label: string; value: string } | null;
  /** The gold button (the last step's Pay / Send booking); dark otherwise. */
  gold?: boolean;
  /** A small line under the button ("Secure payment by NTZS"). */
  note?: React.ReactNode;
};

/** The step's main button: stuck to the bottom of the phone (above the home bar); in the side card on computers. */
function CtaButton({ label, onClick, disabled, pending, icon, wide, gold }: CtaProps & { wide?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || pending}
      className={cn(gold ? goldButton : cn(darkButton, "shadow-[0_14px_30px_-18px_rgba(29,23,18,0.9)]"), "h-[52px] min-w-0 px-6 text-[15px]", wide ? "w-full" : "flex-1")}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      <span className="truncate">{label}</span>
      {!pending && (icon ?? <ArrowRight className={cn("size-4 shrink-0", gold ? "text-(--vr-ink)" : "text-(--vr-gold)")} />)}
    </button>
  );
}

/**
 * A step: its header and body; on computers a side card ("Your stay") with the button; on phones the button stuck to
 * the bottom. One column on phones and tablets (centred, not stretched), two on computers.
 */
export function StepLayout({ header, aside, cta, hotel, phone, children }: {
  header: React.ReactNode; aside: React.ReactNode; cta: CtaProps | null; hotel: string; phone: string | null; children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-[calc(8.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-16">
      <BrandBar hotel={hotel} phone={phone} className="hidden lg:flex" />
      <div className="mx-auto max-w-xl lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-10 xl:gap-14">
        <div className="min-w-0">{header}{children}</div>
        <aside className="hidden lg:sticky lg:top-6 lg:mt-7 lg:block">
          {aside}
          {cta && (
            <div className="mt-3">
              {cta.amount && <p className="mb-2 flex items-baseline justify-between px-1 text-[13px] text-(--vr-muted)">{cta.amount.label}<span className="text-[17px] font-semibold tabular-nums text-(--vr-ink)">{cta.amount.value}</span></p>}
              <CtaButton {...cta} wide />
              {cta.note && <div className="mt-2.5 flex justify-center">{cta.note}</div>}
            </div>
          )}
        </aside>
      </div>
      {cta && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-(--vr-line) bg-(--vr-card)/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md lg:hidden">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            {cta.amount && (
              <div className="min-w-0 shrink-0 leading-tight">
                <p className="text-[11px] text-(--vr-muted)">{cta.amount.label}</p>
                <p className="text-[15.5px] font-semibold tabular-nums">{cta.amount.value}</p>
              </div>
            )}
            <CtaButton {...cta} />
          </div>
          {cta.note && <div className="mx-auto mt-1.5 flex max-w-xl justify-center">{cta.note}</div>}
        </div>
      )}
    </div>
  );
}

/** Computers: "Your stay" beside the step — a photo, the dates, the room, the total so far. */
export function StaySummary({ photo, title, sub, rows, total }: {
  photo: string | null; title: string; sub?: string | null; rows: { label: string; value: React.ReactNode }[]; total?: { label: string; value: string } | null;
}) {
  return (
    <section aria-label="Your stay" className={cn(card, "overflow-hidden shadow-[0_24px_50px_-40px_rgba(29,23,18,0.55)]")}>
      {photo && <div className="relative aspect-[16/9]"><Photo src={photo} alt="" sizes="360px" eager /></div>}
      <div className="p-5">
        <p className={caps}>Your stay</p>
        <h2 className="mt-1.5 font-display text-[22px] font-semibold leading-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-[12.5px] text-(--vr-muted)">{sub}</p>}
        {rows.length > 0 && (
          <dl className="mt-3.5 space-y-2 border-t border-(--vr-line) pt-3.5 text-[13px]">
            {rows.map((r) => <div key={r.label} className="flex items-baseline justify-between gap-3"><dt className="text-(--vr-muted)">{r.label}</dt><dd className="text-right font-medium">{r.value}</dd></div>)}
          </dl>
        )}
        {total && <p className="mt-3 flex items-baseline justify-between border-t border-(--vr-line) pt-3 text-[13px] font-semibold">{total.label}<span className="text-[18px] tabular-nums">{total.value}</span></p>}
      </div>
    </section>
  );
}

/** A soft block while something loads. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("vlh-shimmer block rounded-2xl bg-(--vr-line)/70", className)} />;
}

/** Something went wrong (no connection, booking switched off…): what happened and what to do. */
export function Problem({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className={cn(card, "mt-4 px-5 py-8 text-center")} role="alert">
      <p className="font-display text-[22px] font-semibold leading-tight">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-(--vr-muted)">{text}</p>
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Lock the page behind an open sheet; Escape closes it. With the sheet's box: Tab stays inside it (the page behind is
 * not reachable), and when it closes the focus goes back to the button that opened it.
 */
export function useSheetBehaviour(open: boolean, onClose: () => void, box?: React.RefObject<HTMLElement | null>) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close.current(); return; }
      const el = box?.current;
      if (e.key !== "Tab" || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const inside = el.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, box]);
}

/**
 * A sheet that slides up from the bottom of the phone (a window in the middle on computers): a handle to swipe it
 * down, X, Escape, the phone's Back (the caller's useBackClose), a tap outside. `footer` stays at its bottom.
 */
export function Sheet({ open, onClose, label, footer, children, wide }: {
  open: boolean; onClose: () => void; label: string; footer?: React.ReactNode; children: React.ReactNode; /** Computers: a wider window. */ wide?: boolean;
}) {
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const panel = useRef<HTMLDivElement>(null);
  useSheetBehaviour(open, onClose, panel);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1d1712]/60 backdrop-blur-[2px] sm:items-center sm:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div ref={panel} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
            drag={reduce ? false : "y"} dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, i) => { if (i.offset.y > 90 || i.velocity.y > 600) onClose(); }}
            initial={reduce ? { opacity: 0 } : { y: "100%" }} animate={reduce ? { opacity: 1 } : { y: 0 }} exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            className={cn("vr relative flex max-h-[94svh] w-full flex-col overflow-hidden rounded-t-[28px] bg-(--vr-card) text-[14.5px] text-(--vr-ink) shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.5)] sm:rounded-[28px]", wide ? "sm:max-w-[620px]" : "sm:max-w-[440px]")}>
            <div onPointerDown={(e) => drag.start(e)} className="absolute inset-x-0 top-0 z-20 flex cursor-grab touch-none justify-center pb-3 pt-2.5 sm:hidden" aria-hidden>
              <span className="h-1.5 w-10 rounded-full bg-white/80 shadow-[0_1px_4px_rgba(0,0,0,0.35)]" />
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3.5 top-3.5 z-20 grid size-9 place-items-center rounded-full bg-white/90 text-(--vr-ink) shadow-[0_2px_10px_rgba(0,0,0,0.18)] transition hover:bg-white"><X className="size-4" /></button>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
            {footer && <div className="border-t border-(--vr-line) bg-(--vr-card) px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-5">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A section's title: a small word above, the serif title, an optional line, and a link on the right. */
export function SectionHead({ id, eyebrow, title, line, action, dark, className }: {
  id: string; eyebrow?: string; title: string; line?: React.ReactNode; action?: React.ReactNode; dark?: boolean; className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className={cn("text-[10.5px] font-semibold uppercase tracking-[0.24em]", dark ? "text-(--vr-gold)" : "text-(--vr-gold-ink)")}>{eyebrow}</p>}
        <h2 id={id} className="mt-1.5 font-display text-[30px] font-semibold leading-[1.02] tracking-tight sm:text-[34px] lg:text-[40px]">{title}</h2>
        {line && <p className={cn("mt-1.5 max-w-xl text-[13.5px] leading-relaxed", dark ? "text-white/60" : "text-(--vr-muted)")}>{line}</p>}
      </div>
      {action && <div className="shrink-0 pb-1">{action}</div>}
    </div>
  );
}

/** A section that rises in gently as it comes into view (still for people who prefer less motion). */
export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

/**
 * A row that slides sideways: a swipe on phones (the next item peeks in; the row runs to the screen's edges), arrows on
 * computers once there is more than fits.
 */
export function Rail({ children, label, className, dark }: { children: React.ReactNode; label: string; className?: string; dark?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setEdge({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  const go = (d: 1 | -1) => { const el = ref.current; if (el) el.scrollBy({ left: d * Math.max(240, el.clientWidth * 0.8), behavior: "smooth" }); };
  const arrow = cn("pointer-events-auto grid size-10 place-items-center rounded-full shadow-[0_8px_24px_-10px_rgba(0,0,0,0.5)] ring-1 transition disabled:pointer-events-none disabled:opacity-0",
    dark ? "bg-white/10 text-white ring-white/20 backdrop-blur-md hover:bg-white/20" : "bg-(--vr-card) text-(--vr-ink) ring-(--vr-line) hover:ring-(--vr-gold)");
  return (
    <div className={cn("group/rail relative", className)}>
      <div ref={ref} onScroll={measure} role="group" aria-label={label}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
      {!(edge.start && edge.end) && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] hidden -translate-y-1/2 justify-between px-2 lg:flex">
          <button type="button" onClick={() => go(-1)} disabled={edge.start} aria-label="Scroll back" className={cn(arrow, "-ml-5")}><ChevronLeft className="size-5" /></button>
          <button type="button" onClick={() => go(1)} disabled={edge.end} aria-label="Scroll on" className={cn(arrow, "-mr-5")}><ChevronRight className="size-5" /></button>
        </div>
      )}
    </div>
  );
}
