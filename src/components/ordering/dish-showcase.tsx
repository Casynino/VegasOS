"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { GOLD, GOLD_GRADIENT, tzs, useBasketContext } from "./menu-picker";
import type { ShowcasePick } from "./place-hero";

const SLIDE_MS = 5200;

/** "✓ Nyama Choma added" — a short gold note above the basket bar after a tap. */
function useAddedNote() {
  const [note, setNote] = useState<{ name: string; n: number } | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 1800);
    return () => clearTimeout(t);
  }, [note]);
  const flash = (name: string) => setNote((x) => ({ name, n: (x?.n ?? 0) + 1 }));
  const view = (
    <AnimatePresence>
      {note && (
        <motion.div key={note.n} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
          <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-[#0f1530]/95 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)] ring-1 ring-[#e3bd6a]/50 backdrop-blur-xl">
            <span className="grid size-5 shrink-0 place-items-center rounded-full text-[#1a1206]" style={{ background: GOLD_GRADIENT }}><Check className="size-3" strokeWidth={3} /></span>
            <span className="truncate">{note.name} added</span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return { flash, view };
}

/**
 * The top of every ordering page: dishes and drinks from the menu, one at a time, sliding by
 * themselves (story bars show when the next one comes; swipe or tap the sides to move; it
 * waits while you look). Each has a gold "Add" that puts it straight into the order.
 */
export function DishShowcase({ picks, canOrder = true }: { picks: ShowcasePick[]; canOrder?: boolean }) {
  const shared = useBasketContext();
  const basket = canOrder ? shared : null;
  const { flash, view } = useAddedNote();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [paused, setPaused] = useState(false);
  // A finger on it (or a tap on Add) holds the slide for a moment, so the dish never changes under the tap.
  const [held, setHeld] = useState(0);
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHeld(0), 6000);
    return () => clearTimeout(t);
  }, [held]);
  const hold = () => setHeld(Date.now());
  const n = picks.length;
  if (!n) return null;
  const p = picks[i % n];
  const qty = basket?.basket[p.id] ?? 0;
  const go = (to: number, d: number) => { setDir(d); setI(((to % n) + n) % n); };
  const add = () => { basket?.setQty(p.id, qty + 1); flash(p.name); hold(); };

  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-6 rounded-[2.5rem] bg-[radial-gradient(closest-side,rgba(227,189,106,0.2),transparent)] blur-2xl" />
      <div className="relative aspect-[5/4] overflow-hidden rounded-[1.75rem] bg-white/5 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.95)] ring-1 ring-white/10 sm:aspect-[16/10] lg:aspect-auto lg:h-[440px]"
        onPointerEnter={(e) => { if (e.pointerType === "mouse") setPaused(true); }} onPointerLeave={() => setPaused(false)} onPointerDown={hold}>
        {/* The photo: slides in, then slowly settles (a gentle zoom) */}
        <AnimatePresence initial={false} custom={dir}>
          <motion.div key={p.id} custom={dir} className="absolute inset-0 touch-pan-y"
            initial={{ opacity: 0, x: dir * 60, scale: 1.1 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: dir * -60 }}
            transition={{ x: { type: "spring", stiffness: 260, damping: 32 }, opacity: { duration: 0.5 }, scale: { duration: SLIDE_MS / 1000 + 1, ease: "easeOut" } }}
            drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.25}
            onDragEnd={(_, info) => { if (info.offset.x < -60) go(i + 1, 1); else if (info.offset.x > 60) go(i - 1, -1); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.name} draggable={false} className="size-full select-none object-cover" />
          </motion.div>
        </AnimatePresence>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(7,11,28,0.55)_0%,transparent_22%,transparent_45%,rgba(7,11,28,0.92)_100%)]" />

        {/* Story bars: the current one fills, then the next dish comes */}
        <div className="absolute inset-x-3.5 top-3.5 flex gap-1.5">
          {picks.map((x, k) => (
            <span key={x.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
              {k < i && <span className="block h-full bg-white" />}
              {k === i && (
                <span key={`${i}-${x.id}`} onAnimationEnd={() => go(i + 1, 1)}
                  className="block h-full origin-left bg-white motion-safe:animate-[vlh-fill_linear_forwards] motion-reduce:scale-x-100"
                  style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused || held ? "paused" : "running" }} />
              )}
            </span>
          ))}
        </div>
        <span className="absolute left-3.5 top-7 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/90 ring-1 ring-white/15 backdrop-blur">From our kitchen & bar</span>

        {/* Tap the sides to move (phones), arrows on hover (computers) */}
        <button type="button" aria-label="Previous" onClick={() => go(i - 1, -1)} className="group absolute inset-y-12 left-0 w-1/4 lg:w-16">
          <span className="absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white opacity-0 ring-1 ring-white/20 backdrop-blur transition group-hover:opacity-100 lg:grid"><ChevronLeft className="size-5" /></span>
        </button>
        <button type="button" aria-label="Next" onClick={() => go(i + 1, 1)} className="group absolute inset-y-12 right-0 w-1/4 lg:w-16">
          <span className="absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white opacity-0 ring-1 ring-white/20 backdrop-blur transition group-hover:opacity-100 lg:grid"><ChevronRight className="size-5" /></span>
        </button>

        {/* The dish: name, price, Add */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={p.id} className="min-w-0" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35 }}>
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: GOLD }}>{p.category}</p>
              <p className="mt-0.5 line-clamp-2 font-display text-[26px] leading-[1.02] text-white sm:text-[34px]">{p.name}</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-white/85">{tzs(p.price)}</p>
            </motion.div>
          </AnimatePresence>
          {basket && (qty === 0 ? (
            <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={add} aria-label={`Add ${p.name}`}
              className="relative z-10 inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full px-5 text-sm font-bold text-[#1a1206] shadow-[0_14px_30px_-10px_rgba(227,189,106,0.9)]" style={{ background: GOLD_GRADIENT }}>
              <Plus className="size-4" strokeWidth={3} />Add
            </motion.button>
          ) : (
            <div className="relative z-10 flex h-12 shrink-0 items-center rounded-full bg-black/55 ring-1 ring-[#e3bd6a]/60 backdrop-blur-xl">
              <button type="button" onClick={() => basket.setQty(p.id, qty - 1)} aria-label={`One less ${p.name}`} className="grid size-12 place-items-center text-white"><Minus className="size-4" /></button>
              <span key={qty} className="w-6 text-center text-base font-bold tabular-nums text-white motion-safe:animate-[vlh-pop_0.3s_ease-out]">{qty}</span>
              <button type="button" onClick={add} aria-label={`One more ${p.name}`} className="grid size-12 place-items-center" style={{ color: GOLD }}><Plus className="size-4" strokeWidth={3} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Every dish in the showcase, small — tap one to see it */}
      <div className="relative mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {picks.map((x, k) => (
          <button key={x.id} type="button" onClick={() => go(k, k >= i ? 1 : -1)} aria-label={x.name} aria-current={k === i}
            className={cn("relative size-14 shrink-0 overflow-hidden rounded-2xl ring-2 transition sm:size-16", k === i ? "ring-[#e3bd6a]" : "opacity-60 ring-transparent hover:opacity-100")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={x.src} alt="" className="size-full object-cover" />
            {(basket?.basket[x.id] ?? 0) > 0 && <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full text-[9px] font-bold text-[#1a1206]" style={{ background: GOLD_GRADIENT }}>{basket!.basket[x.id]}</span>}
          </button>
        ))}
      </div>
      {view}
    </div>
  );
}

/**
 * A slow, endless strip of more dishes and drinks sliding across the page; tap + to add one.
 * It stops while a finger or the mouse is on it; with reduced motion it simply scrolls.
 */
export function DishMarquee({ picks, title = "Tap + to add", canOrder = true }: { picks: ShowcasePick[]; title?: string; canOrder?: boolean }) {
  const shared = useBasketContext();
  const basket = canOrder ? shared : null;
  const { flash, view } = useAddedNote();
  if (picks.length < 4) return null;
  const loop = [...picks, ...picks];
  return (
    <section aria-label="More from our menu" className="relative">
      <div className="mx-auto mb-2 flex max-w-6xl items-center gap-3 px-4 sm:px-6">
        <span className="text-[11px] font-semibold uppercase tracking-[0.28em]" style={{ color: GOLD }}>Popular now</span>
        <span className="h-px flex-1 bg-linear-to-r from-[#e3bd6a]/40 to-transparent" />
        {basket && <span className="text-[11px] text-white/50">{title}</span>}
      </div>
      <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)] motion-reduce:overflow-x-auto">
        <div className="flex w-max gap-3 px-3 py-1 hover:[animation-play-state:paused] active:[animation-play-state:paused] motion-safe:animate-[vlh-marquee_60s_linear_infinite]">
          {loop.map((x, k) => {
            const qty = basket?.basket[x.id] ?? 0;
            return (
              <div key={`${x.id}-${k}`} aria-hidden={k >= picks.length || undefined}
                className="flex shrink-0 items-center gap-2.5 rounded-full bg-white/[0.06] py-1.5 pl-1.5 pr-1.5 ring-1 ring-white/10 backdrop-blur">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={x.src} alt="" className="size-11 rounded-full object-cover ring-1 ring-white/15" />
                <span className="leading-tight">
                  <span className="block max-w-[150px] truncate text-[13px] font-medium text-white">{x.name}</span>
                  <span className="text-[11px] tabular-nums" style={{ color: GOLD }}>{tzs(x.price)}</span>
                </span>
                {basket ? (
                  <button type="button" tabIndex={k >= picks.length ? -1 : undefined} onClick={() => { basket.setQty(x.id, qty + 1); flash(x.name); }} aria-label={`Add ${x.name}`}
                    className="relative ml-1 grid size-9 shrink-0 place-items-center rounded-full text-[#1a1206] transition active:scale-90" style={{ background: GOLD_GRADIENT }}>
                    <Plus className="size-4" strokeWidth={3} />
                    {qty > 0 && <span key={qty} className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-white text-[9px] font-bold text-[#1a1206] motion-safe:animate-[vlh-pop_0.3s_ease-out]">{qty}</span>}
                  </button>
                ) : <span className="w-2" />}
              </div>
            );
          })}
        </div>
      </div>
      {view}
    </section>
  );
}
