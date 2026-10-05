"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useMotionTemplate, useScroll, useTransform, type MotionValue } from "motion/react";
import { cn } from "@/lib/utils";
import { blurFor } from "../blur-data";
import { IllustrativeTag } from "../kit/media-frame";
import { useRamp } from "../cinema/ramp";
import css from "./home.module.css";

interface Photo {
  src: string;
  alt: string;
}

const mono = "font-mono text-[10px] font-medium uppercase leading-none tracking-[0.2em] sm:text-[11px]";

/**
 * "Where we are" — a short satellite-style dive. A window onto an (illustrative) aerial view of
 * Dar es Salaam holds on screen for half a screen of scrolling while it zooms towards a survey
 * reticle and the place names step down (city → district → the hotel); then the hotel's own
 * street photograph opens from the reticle like an iris, with a fine gold rim. About 150vh of
 * scroll in total, never a trap. The content (heading, arrival facts, actions) is passed in and
 * floats in glass in the window. With reduced motion it
 * is a still: the street photograph, no pin, no zoom.
 *
 * The zoom target is set per breakpoint with --tx / --ty (phones aim higher, above the panel).
 */
export function LocationDive({
  aerial,
  street,
  places,
  coords,
  children,
}: {
  aerial: Photo;
  street: Photo;
  /** City → district → hotel, lit in turn as the view descends. */
  places: [string, string, string];
  coords: string;
  /** Glass panel content (server-rendered). */
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start 0.55", "end end"] });

  const zoom = useRamp(p, [0, 0.66], [1.04, 2.3]);
  const satFade = useRamp(p, [0, 0.6], [1, 0.3]);
  const iris = useRamp(p, [0.56, 0.9], [0, 115]);
  const streetClip = useMotionTemplate`circle(${iris}% at var(--tx) var(--ty))`;
  const rimClip = useMotionTemplate`circle(calc(${iris}% + 3px) at var(--tx) var(--ty))`;
  const rimOpacity = useRamp(p, [0.56, 0.6, 0.86, 0.92], [0, 1, 1, 0]);
  const ring = useRamp(p, [0, 0.56, 0.75], [1.7, 1, 3.2]);
  const ringOpacity = useRamp(p, [0, 0.1, 0.56, 0.72], [0.35, 1, 1, 0]);
  // The coordinates chip leaves before the iris opens (they repeat in the panel and the HUD).
  const coordsOpacity = useRamp(p, [0, 0.1, 0.48, 0.56], [0.35, 1, 1, 0]);
  const tagOpacity = useRamp(p, [0.62, 0.74], [1, 0]);
  const stage = useTransform(p, (v): number => (v < 0.28 ? 0 : v < 0.56 ? 1 : 2));
  const barW = useMotionTemplate`${useRamp(p, [0, 0.9], [0, 100])}%`;

  return (
    <div ref={ref} className={cn(css.diveTrack, "relative")}>
      <div
        className={cn(
          "sticky top-0 flex h-svh flex-col px-4 pt-[calc(var(--pub-header-h)+0.75rem)] sm:px-8",
          "pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-8",
          "motion-reduce:relative motion-reduce:h-auto motion-reduce:min-h-[46rem] motion-reduce:pb-16",
        )}
      >
        <div className="relative mx-auto w-full max-w-[86rem] flex-1 [--tx:50%] [--ty:31%] sm:[--tx:60%] sm:[--ty:42%]">
          {/* The window */}
          <div className="absolute inset-0 overflow-hidden bg-[#0d0b08] shadow-[0_40px_120px_-40px_rgb(0_0_0/0.9)]">
            {/* Aerial (illustrative), zooming in */}
            <motion.div style={{ scale: zoom, transformOrigin: "var(--tx) var(--ty)" }} className="absolute inset-0 will-change-transform motion-reduce:hidden">
              <Image src={aerial.src} alt="" fill sizes="(min-width: 1440px) 1376px, (min-width: 640px) 100vw, 160vw" className="object-cover saturate-[0.6]" />
              <motion.div style={{ opacity: satFade }} className={css.satGrade} />
              <div className={css.satGrid} />
            </motion.div>

            {/* Gold rim of the iris, then the hotel's street opening from the reticle */}
            <motion.div aria-hidden="true" style={{ clipPath: rimClip, opacity: rimOpacity }} className="absolute inset-0 bg-[rgb(244_218_160)] motion-reduce:hidden" />
            <motion.div style={{ clipPath: streetClip }} className="absolute inset-0 motion-reduce:[clip-path:none]!">
              <Image src={street.src} alt={street.alt} fill sizes="(min-width: 1440px) 1376px, 100vw" {...blurFor(street.src)} className="pub-grade pub-grade--dusk object-cover object-[86%_50%] sm:object-[62%_50%]" />
              <div aria-hidden="true" className="pub-grade-tint" />
              <div aria-hidden="true" className={css.grade} />
              <div aria-hidden="true" className={css.vignette} />
            </motion.div>

            {/* Scrim for the glass panel and the labels */}
            <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(to_top,rgb(10_8_6/0.7),rgb(10_8_6/0.1)_45%,rgb(10_8_6/0.4))]" />

            {/* Survey reticle at the target: tightens on the way down, opens out with the iris */}
            <motion.div
              aria-hidden="true"
              style={{ scale: ring, opacity: ringOpacity }}
              className="absolute left-[var(--tx)] top-[var(--ty)] size-36 -translate-x-1/2 -translate-y-1/2 sm:size-56 motion-reduce:hidden"
            >
              <svg viewBox="0 0 200 200" className="size-full text-[rgb(244_218_160)]" fill="none" stroke="currentColor">
                <circle cx="100" cy="100" r="98" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" />
                <circle cx="100" cy="100" r="62" strokeOpacity="0.7" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
                <circle cx="100" cy="100" r="18" strokeOpacity="0.95" vectorEffect="non-scaling-stroke" />
                <path d="M100 0v40M100 160v40M0 100h40M160 100h40" strokeOpacity="0.8" vectorEffect="non-scaling-stroke" />
              </svg>
            </motion.div>
            <motion.span
              aria-hidden="true"
              style={{ opacity: coordsOpacity }}
              className={cn(
                mono,
                "absolute left-[var(--tx)] top-[calc(var(--ty)+5.25rem)] -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-2.5 py-1.5 text-[rgb(244_218_160)] sm:top-[calc(var(--ty)+7.5rem)] motion-reduce:hidden",
              )}
            >
              {coords}
            </motion.span>

            {/* Top HUD: illustrative tag (left, while the aerial shows), place steps (right) */}
            <motion.div style={{ opacity: tagOpacity }} className="absolute left-3 top-3 z-10 sm:left-4 sm:top-4 motion-reduce:hidden">
              <IllustrativeTag />
            </motion.div>
            <ol aria-hidden="true" className="absolute right-3 top-3 flex flex-col items-end gap-1.5 sm:right-5 sm:top-5 sm:gap-2 motion-reduce:hidden">
              {places.map((name, i) => (
                <Step key={name} i={i} stage={stage} name={name} />
              ))}
              <li className="mt-1 h-px w-24 overflow-hidden bg-white/20 sm:w-32">
                <motion.span style={{ width: barW }} className="block h-full bg-gold" />
              </li>
            </ol>
          </div>

          {/* Brackets just outside the window */}
          <span aria-hidden="true" className="pub-hud-corners" style={{ "--hud-o": "0.5rem", "--hud-l": "1.25rem" } as React.CSSProperties} />

          {/* Content in glass at the foot */}
          <div className="absolute inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-6 sm:left-6 sm:max-w-[30rem] lg:bottom-8 lg:left-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Step({ i, stage, name }: { i: number; stage: MotionValue<number>; name: string }) {
  const opacity = useTransform(stage, (s) => (s === i ? 1 : s > i ? 0.5 : 0.32));
  const dot = useTransform(stage, (s) => (s >= i ? 1 : 0.25));
  return (
    <motion.li style={{ opacity }} className={cn(mono, "flex items-center gap-2 rounded-full bg-black/50 px-2.5 py-1.5 text-white")}>
      <span className="tabular-nums text-gold">{String(i + 1).padStart(2, "0")}</span>
      {name}
      <motion.span style={{ opacity: dot }} className="size-1.5 rounded-full bg-gold" />
    </motion.li>
  );
}
