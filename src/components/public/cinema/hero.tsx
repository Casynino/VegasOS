"use client";

import { useEffect, useRef, useState } from "react";
import { getImageProps } from "next/image";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { useRamp } from "./ramp";

export interface HeroSlide {
  src: string;
  alt: string;
  /** Short caption shown with the slide counter, e.g. "Executive Suite". */
  caption: string;
  /** Portrait photo for phones (art direction); falls back to `src`. */
  mobileSrc?: string;
}

/** One photo, art-directed: portrait on phones, landscape on larger screens. Each device downloads only its own. */
function SlidePicture({ s, on, priority }: { s: HeroSlide; on: boolean; priority: boolean }) {
  const common = { alt: on ? s.alt : "", fill: true, priority, quality: 75 } as const;
  const { props: wide } = getImageProps({ ...common, src: s.src, sizes: "100vw" });
  const { props: tall } = getImageProps({ ...common, src: s.mobileSrc ?? s.src, sizes: "100vw" });
  return (
    <picture>
      <source media="(max-width: 767px)" srcSet={tall.srcSet} sizes="100vw" />
      <source media="(min-width: 768px)" srcSet={wide.srcSet} sizes="100vw" />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- alt comes from getImageProps */}
      <img {...wide} className="object-cover" />
    </picture>
  );
}

const SLIDE_MS = 7000;

/**
 * Full-screen cinematic hero. Real hotel photographs cross-fade slowly, each
 * with its own Ken Burns drift; the whole stage has a gentle scroll parallax
 * and (on desktop, fine pointers) a few pixels of cursor depth. Foreground
 * content is passed in as children so it stays server-rendered.
 */
export function CinematicHero({ slides, children, footer, labelledBy }: {
  slides: HeroSlide[];
  children: React.ReactNode;
  /** Rendered at the bottom of the hero (booking bar). */
  footer?: React.ReactNode;
  labelledBy: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);

  // Slow, calm rotation; pauses when the tab is hidden or motion is reduced.
  useEffect(() => {
    if (reduce || paused || slides.length < 2) return;
    const t = window.setTimeout(() => {
      setActive((i) => (i + 1) % slides.length);
      setCycle((c) => c + 1);
    }, SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [active, reduce, paused, slides.length]);

  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Cursor depth: the photo drifts a few pixels against the pointer (rAF-throttled, CSS vars only).
  useEffect(() => {
    const el = ref.current;
    const stage = stageRef.current;
    if (!el || !stage || reduce || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        stage.style.transform = `translate3d(${(-x * 14).toFixed(1)}px, ${(-y * 10).toFixed(1)}px, 0)`;
      });
    };
    el.addEventListener("pointermove", onMove);
    return () => { el.removeEventListener("pointermove", onMove); cancelAnimationFrame(frame); };
  }, [reduce]);

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "16%"]);
  const fade = useRamp(scrollYProgress, [0, 0.7], [1, reduce ? 1 : 0.2]);

  function go(i: number) {
    setActive(i);
    setCycle((c) => c + 1);
  }

  return (
    <section ref={ref} aria-labelledby={labelledBy} className="relative isolate flex min-h-svh flex-col overflow-hidden bg-[#0d0b08] text-white">
      {/* Background: photographs */}
      <motion.div style={{ y }} className="absolute inset-0 -z-20" aria-hidden={false}>
        <div ref={stageRef} className="absolute -inset-4 transition-transform duration-700 ease-out will-change-transform">
          {slides.map((s, i) => {
            const on = i === active;
            return (
              <div
                key={s.src}
                className={cn("absolute inset-0 transition-opacity duration-[1800ms] ease-in-out", on ? "opacity-100" : "opacity-0")}
                aria-hidden={!on}
              >
                <div key={on ? `on-${cycle}` : "off"} className={cn("absolute inset-0 will-change-transform", on && (cycle % 2 === 0 ? "vlh-kb-a" : "vlh-kb-b"))}>
                  <SlidePicture s={s} on={on} priority={i === 0} />
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Midground: cinematic grade, warm light, grain */}
      <div aria-hidden="true" className="vlh-grain absolute inset-0 -z-10">
        {/* Phones: shade top-to-bottom so the photo reads in the upper half. Larger screens: shade from the text side. */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,11,8,0.6)_0%,rgba(13,11,8,0.15)_30%,rgba(13,11,8,0.7)_58%,#0d0b08_88%)] md:hidden" />
        <div className="absolute inset-0 hidden bg-[linear-gradient(95deg,rgba(13,11,8,0.94)_0%,rgba(13,11,8,0.72)_38%,rgba(13,11,8,0.28)_70%,rgba(13,11,8,0.45)_100%)] md:block" />
        <div className="absolute inset-0 hidden bg-[linear-gradient(0deg,#0d0b08_0%,rgba(13,11,8,0.55)_22%,transparent_48%)] md:block" />
        <div className="absolute inset-x-0 top-0 h-40 bg-linear-to-b from-[#0d0b08]/70 to-transparent" />
        <div className="vlh-glow absolute -left-40 top-1/4 size-[42rem] rounded-full bg-[radial-gradient(circle,oklch(0.78_0.12_80/0.22),transparent_62%)]" />
      </div>

      {/* Foreground */}
      <motion.div style={{ opacity: fade }} className="relative flex flex-1 flex-col">
        {children}
      </motion.div>

      {/* Slide index: a slim vertical rail at the left edge (desktop) */}
      {slides.length > 1 && (
        <div className="absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 flex-col items-center gap-3 xl:flex 2xl:left-6">
          <span className="text-[10px] tabular-nums tracking-[0.2em] text-gold" aria-hidden="true">{String(active + 1).padStart(2, "0")}</span>
          {slides.map((s, i) => (
            <button
              key={s.src}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show photo ${i + 1}: ${s.caption}`}
              aria-current={i === active ? "true" : undefined}
              className="group relative flex h-10 w-4 justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <span className="h-full w-px bg-white/25 transition-colors group-hover:bg-white/60" />
              {i === active && (
                <span key={cycle} className="vlh-progress-y absolute inset-y-0 w-px bg-gold shadow-[0_0_8px_oklch(0.78_0.12_80)]"
                  style={{ animationDuration: reduce || paused ? "0s" : `${SLIDE_MS}ms` }} />
              )}
            </button>
          ))}
          <span className="text-[10px] tabular-nums tracking-[0.2em] text-white/50" aria-hidden="true">{String(slides.length).padStart(2, "0")}</span>
          <span className="sr-only" aria-live="polite">{slides[active].caption}</span>
        </div>
      )}

      {footer && <div className="relative z-10">{footer}</div>}
    </section>
  );
}
