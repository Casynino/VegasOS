"use client";

import { useRef } from "react";
import Image from "next/image";
import { useRamp } from "./ramp";
import { motion, useMotionTemplate, useScroll } from "motion/react";

export interface BlueprintNote { label: string; value: string; x: number; y: number; align?: "left" | "right" }

/**
 * "From blueprint to building": the hotel's real exterior photo is first drawn
 * as a glowing architectural line drawing (SVG edge-detection filter over the
 * same photo), with a blueprint grid, coordinates and annotated callouts. As
 * the visitor scrolls, a gold scan line sweeps across and the real photograph
 * takes over. Scroll-linked only — nothing moves on its own.
 */
export function BlueprintReveal({ image, alt, notes, eyebrow, title, finale }: {
  image: string;
  alt: string;
  notes: BlueprintNote[];
  eyebrow: string;
  title: React.ReactNode;
  finale: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });

  const cut = useRamp(p, [0.28, 0.78], [100, 0]);
  const clip = useMotionTemplate`inset(0 0 0 ${cut}%)`;
  const scanLeft = useMotionTemplate`${cut}%`;
  const scanOpacity = useRamp(p, [0.26, 0.3, 0.76, 0.8], [0, 1, 1, 0]);
  const notesOpacity = useRamp(p, [0.05, 0.14, 0.5, 0.62], [0, 1, 1, 0]);
  const titleOpacity = useRamp(p, [0, 0.08, 0.55, 0.65], [0, 1, 1, 0]);
  const titleY = useRamp(p, [0, 0.1], [30, 0]);
  const finaleOpacity = useRamp(p, [0.8, 0.9], [0, 1]);
  const finaleY = useRamp(p, [0.8, 0.92], [24, 0]);
  const zoom = useRamp(p, [0, 1], [1.12, 1]);
  const gridOpacity = useRamp(p, [0.5, 0.8], [1, 0.15]);

  return (
    <section ref={ref} className="relative h-[260vh] bg-[#050b14]" aria-label="The building">
      {/* Edge-detection → cyan line drawing */}
      <svg className="absolute size-0" aria-hidden="true" focusable="false">
        <filter id="vlh-blueprint" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="5" /><feFuncG type="linear" slope="5" /><feFuncB type="linear" slope="5" />
          </feComponentTransfer>
          <feColorMatrix type="matrix" values="0.35 0 0 0 0.02  0.7 0 0 0 0.05  0.95 0 0 0 0.1  0 0 0 1 0" />
        </filter>
      </svg>

      <div className="sticky top-0 h-svh overflow-hidden text-white">
        <motion.div style={{ scale: zoom }} className="absolute inset-0">
          {/* Blueprint layer */}
          <div className="absolute inset-0 bg-[#050b14]">
            <Image src={image} alt="" fill sizes="100vw" className="object-cover opacity-90" style={{ filter: "url(#vlh-blueprint)" }} />
          </div>
          {/* Real photograph, revealed behind the scan line */}
          <motion.div style={{ clipPath: clip }} className="absolute inset-0">
            <Image src={image} alt={alt} fill sizes="100vw" className="object-cover" />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(5,11,20,0.85),rgba(5,11,20,0.15)_45%,rgba(5,11,20,0.35))]" />
          </motion.div>
        </motion.div>

        {/* Blueprint grid + frame marks */}
        <motion.div style={{ opacity: gridOpacity }} aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 [background-image:linear-gradient(rgb(125_200_255/0.09)_1px,transparent_1px),linear-gradient(90deg,rgb(125_200_255/0.09)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="absolute inset-0 [background-image:linear-gradient(rgb(125_200_255/0.16)_1px,transparent_1px),linear-gradient(90deg,rgb(125_200_255/0.16)_1px,transparent_1px)] [background-size:240px_240px]" />
          <div className="absolute inset-6 border border-[#7dc8ff]/25 sm:inset-10" />
          <div className="absolute left-6 top-1/2 h-40 -translate-y-1/2 border-l border-[#7dc8ff]/40 sm:left-10">
            <span className="absolute -left-1 top-0 h-px w-2 bg-[#7dc8ff]/60" /><span className="absolute -left-1 bottom-0 h-px w-2 bg-[#7dc8ff]/60" />
          </div>
          <p className="absolute bottom-8 right-8 font-mono text-[10px] tracking-[0.2em] text-[#7dc8ff]/70 sm:bottom-12 sm:right-12">6.7726° S · 39.2310° E · N ↑</p>
          <p className="absolute right-8 top-24 hidden font-mono text-[10px] tracking-[0.2em] text-[#7dc8ff]/70 sm:right-12 sm:block">DWG 01 · VEGAS LUXURY HOTEL · MLIMANI CITY</p>
        </motion.div>

        {/* Scan line */}
        <motion.div style={{ left: scanLeft, opacity: scanOpacity }} aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-gold shadow-[0_0_24px_6px_oklch(0.78_0.13_80/0.55)]">
          <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold shadow-[0_0_20px_oklch(0.78_0.13_80)]" />
        </motion.div>

        {/* Annotated callouts */}
        <motion.ul style={{ opacity: notesOpacity }} className="pointer-events-none absolute inset-0 hidden sm:block" aria-label="About the building">
          {notes.map((n) => (
            <li key={n.label} style={{ position: "absolute", left: `${n.x}%`, top: `${n.y}%` }}>
              <span className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#7dc8ff] bg-[#050b14]" />
              <span className={n.align === "left" ? "absolute right-3 top-0 flex items-center gap-2" : "absolute left-3 top-0 flex items-center gap-2"} style={{ flexDirection: n.align === "left" ? "row-reverse" : "row" }}>
                <span className="block h-px w-10 bg-[#7dc8ff]/60 sm:w-16" />
                <span className="whitespace-nowrap rounded-lg border border-[#7dc8ff]/30 bg-[#050b14]/70 px-3 py-2 backdrop-blur-md">
                  <span className="block font-mono text-[9px] uppercase tracking-[0.24em] text-[#7dc8ff]">{n.label}</span>
                  <span className="block text-sm text-white">{n.value}</span>
                </span>
              </span>
            </li>
          ))}
        </motion.ul>

        {/* Opening title */}
        <motion.div style={{ opacity: titleOpacity, y: titleY }} className="absolute inset-x-0 top-24 px-6 sm:top-28 sm:px-12 lg:px-16">
          <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#7dc8ff]"><span className="h-px w-10 bg-[#7dc8ff]" />{eyebrow}</p>
          <h2 className="mt-5 max-w-2xl font-display text-[clamp(2.4rem,5vw,5rem)] font-medium leading-[0.98]">{title}</h2>
          {/* Phones: callouts as a compact row of blueprint chips */}
          <motion.ul style={{ opacity: notesOpacity }} className="mt-6 grid grid-cols-2 gap-2 sm:hidden" aria-label="About the building">
            {notes.map((n) => (
              <li key={n.label} className="rounded-lg border border-[#7dc8ff]/30 bg-[#050b14]/70 px-3 py-2 backdrop-blur-md">
                <span className="block font-mono text-[9px] uppercase tracking-[0.24em] text-[#7dc8ff]">{n.label}</span>
                <span className="block text-sm text-white">{n.value}</span>
              </li>
            ))}
          </motion.ul>
        </motion.div>

        {/* Finale */}
        <motion.div style={{ opacity: finaleOpacity, y: finaleY }} className="absolute inset-x-0 bottom-0 px-6 pb-14 sm:px-12 sm:pb-20 lg:px-16">
          {finale}
        </motion.div>
      </div>
    </section>
  );
}
