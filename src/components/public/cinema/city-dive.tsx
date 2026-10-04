"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRamp } from "./ramp";
import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DiveStage { src: string; alt: string; label: string; sub: string; illustrative?: boolean }

/**
 * "Dive to the hotel": a scroll-driven descent from the coastline, through the
 * city, onto the hotel itself — with a targeting reticle, live coordinates, a
 * zoom gauge and a pin that lands at the end. The last stage is the hotel's
 * own photograph; earlier city views are labelled illustrative.
 */
export function CityDive({ stages, finale }: { stages: [DiveStage, DiveStage, DiveStage]; finale: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [stage, setStage] = useState(0);
  useMotionValueEvent(p, "change", (v) => setStage(v < 0.38 ? 0 : v < 0.72 ? 1 : 2));

  const s0 = { scale: useRamp(p, [0, 0.42], [1, 2.6]), opacity: useRamp(p, [0.3, 0.42], [1, 0]) };
  const s1 = { scale: useRamp(p, [0.3, 0.78], [1.15, 2.8]), opacity: useRamp(p, [0.3, 0.42, 0.66, 0.78], [0, 1, 1, 0]) };
  const s2 = { scale: useRamp(p, [0.66, 1], [1.35, 1]), opacity: useRamp(p, [0.66, 0.78], [0, 1]) };
  const layers = [s0, s1, s2];

  const reticle = useRamp(p, [0, 1], [0, 180]);
  const reticleOpacity = useRamp(p, [0.74, 0.82], [1, 0]);
  const gaugeN = useRamp(p, [0, 0.85], [0, 100]);
  const gauge = useTransform(gaugeN, (v) => `${v}%`);
  const pinY = useRamp(p, [0.8, 0.9], [-60, 0]);
  const pinOpacity = useRamp(p, [0.8, 0.86], [0, 1]);
  const finaleOpacity = useRamp(p, [0.86, 0.95], [0, 1]);
  const hudOpacity = useRamp(p, [0.84, 0.9], [1, 0]);
  const finaleY = useRamp(p, [0.86, 0.96], [30, 0]);
  const lat = useRamp(p, [0, 0.85], [6.81, 6.7726]);
  const lon = useRamp(p, [0, 0.85], [39.29, 39.231]);
  const latText = useTransform(lat, (v) => `${v.toFixed(4)}° S`);
  const lonText = useTransform(lon, (v) => `${v.toFixed(4)}° E`);

  return (
    <section ref={ref} className="relative h-[320vh] bg-[#050b14]" aria-label="Where we are">
      <div className="vlh-grain sticky top-0 h-svh overflow-hidden text-white">
        {stages.map((s, i) => (
          <motion.div key={s.src} style={{ scale: layers[i].scale, opacity: layers[i].opacity }} className="absolute inset-0 will-change-transform">
            <Image src={s.src} alt={i === stage ? s.alt : ""} fill sizes="100vw" className="object-cover" />
          </motion.div>
        ))}
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(5,11,20,0.75)_100%)]" />
        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(0deg,rgba(5,11,20,0.9),transparent_40%,rgba(5,11,20,0.5))]" />

        {/* Reticle */}
        <motion.div style={{ opacity: reticleOpacity }} aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <motion.svg style={{ rotate: reticle }} viewBox="0 0 200 200" className="size-56 text-gold sm:size-72">
            <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeDasharray="2 8" />
            <circle cx="100" cy="100" r="60" fill="none" stroke="currentColor" strokeOpacity="0.7" />
            <path d="M100 0v28M100 172v28M0 100h28M172 100h28" stroke="currentColor" strokeOpacity="0.8" />
          </motion.svg>
          <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold shadow-[0_0_16px_oklch(0.78_0.13_80)]" />
        </motion.div>

        {/* Pin landing on the hotel */}
        <motion.div style={{ y: pinY, opacity: pinOpacity }} aria-hidden="true" className="absolute left-1/2 top-[18%] -translate-x-1/2 sm:top-[38%]">
          <span className="relative grid size-14 place-items-center rounded-full bg-gold text-[#15120e] shadow-[0_0_40px_oklch(0.78_0.13_80/0.9)]">
            <MapPin className="size-6" />
            <span className="absolute inset-0 rounded-full border-2 border-gold motion-safe:animate-ping" />
          </span>
        </motion.div>

        {/* HUD: stages + coordinates + gauge */}
        <motion.div style={{ opacity: hudOpacity }} className="absolute left-6 top-24 sm:left-12 sm:top-28 lg:left-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-gold">Where we are</p>
          <ol className="mt-5 space-y-3">
            {stages.map((s, i) => (
              <li key={s.label} className={cn("flex items-center gap-3 transition-all duration-500", i === stage ? "opacity-100" : "opacity-40")}>
                <span className={cn("h-px transition-all duration-500", i === stage ? "w-10 bg-gold" : "w-4 bg-white/60")} />
                <span>
                  <span className={cn("block font-display leading-none transition-all duration-500", i === stage ? "text-3xl sm:text-4xl" : "text-xl")}>{s.label}</span>
                  {i === stage && <span className="mt-1 block text-sm text-white/65">{s.sub}</span>}
                </span>
              </li>
            ))}
          </ol>
        </motion.div>
        <div className="vlh-glass vlh-hud absolute right-6 top-24 hidden rounded-2xl px-4 py-3 font-mono text-xs sm:right-12 sm:top-28 sm:block lg:right-16" aria-hidden="true">
          <p className="text-[10px] uppercase tracking-[0.25em] text-white/55">Target</p>
          <motion.p className="mt-1 tabular-nums text-gold">{latText}</motion.p>
          <motion.p className="tabular-nums text-gold">{lonText}</motion.p>
          <div className="mt-3 h-1 w-36 overflow-hidden rounded-full bg-white/15"><motion.div style={{ width: gauge }} className="h-full bg-gold" /></div>
          <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/45">Zoom</p>
        </div>
        {stages[stage].illustrative && (
          <p className="absolute bottom-4 right-4 rounded-full bg-black/40 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/60 backdrop-blur">Illustrative city view</p>
        )}

        <motion.div style={{ opacity: finaleOpacity, y: finaleY }} className="absolute inset-x-0 bottom-0 px-6 pb-12 sm:px-12 sm:pb-16 lg:px-16">
          {finale}
        </motion.div>
      </div>
    </section>
  );
}
