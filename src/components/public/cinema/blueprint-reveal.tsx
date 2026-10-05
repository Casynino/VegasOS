"use client";

import { useId, useRef } from "react";
import Image from "next/image";
import { motion, useMotionTemplate, useScroll } from "motion/react";
import { cn } from "@/lib/utils";
import { blurFor } from "../blur-data";
import { useRamp } from "./ramp";

/**
 * "From drawing to building" — the home page's one futuristic moment, kept short. The hotel's
 * real photograph is first drawn as a gold architectural line drawing (an SVG edge filter over
 * the same photo, on a fine grid); as the frame scrolls into view a gold scan line sweeps
 * across and the photograph takes over. It lives inside its own frame — no pinned section, no
 * extra scrolling — and with reduced motion it is simply the photograph.
 *
 * ratio / ratioLg: CSS aspect ratios for phones and from 1024px, like MediaFrame.
 */
export function BlueprintReveal({
  src,
  alt,
  sizes,
  ratio = "4/3",
  ratioLg = ratio,
  focal = "50% 50%",
  label,
  coords,
  className,
}: {
  src: string;
  alt: string;
  sizes: string;
  ratio?: string;
  ratioLg?: string;
  focal?: string;
  /** Small drawing label, top left (e.g. "Elevation · Mlimani City"). */
  label?: string;
  /** Small drawing label, bottom right (coordinates). */
  coords?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // One filter per instance; CSS url() needs a plain id.
  const filterId = `vlh-dwg-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start 0.92", "end 0.5"] });

  const cut = useRamp(p, [0.18, 0.86], [100, 0]);
  const clip = useMotionTemplate`inset(0 0 0 ${cut}%)`;
  const scanLeft = useMotionTemplate`${cut}%`;
  const scanOpacity = useRamp(p, [0.14, 0.22, 0.8, 0.88], [0, 1, 1, 0]);

  return (
    <div
      ref={ref}
      style={{ "--ar": ratio, "--ar-lg": ratioLg, "--focal": focal } as React.CSSProperties}
      className={cn("relative isolate aspect-[var(--ar)] overflow-hidden bg-night lg:aspect-[var(--ar-lg)]", className)}
    >
      {/* Edge detection → a gold line drawing on near-black. */}
      <svg className="absolute size-0" aria-hidden="true" focusable="false">
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="4.5" />
            <feFuncG type="linear" slope="4.5" />
            <feFuncB type="linear" slope="4.5" />
          </feComponentTransfer>
          <feColorMatrix type="matrix" values="0.94 0 0 0 0.02  0.78 0 0 0 0.015  0.48 0 0 0 0.01  0 0 0 1 0" />
        </filter>
      </svg>

      {/* The drawing (skipped with reduced motion: the photograph is simply there). */}
      <div aria-hidden="true" className="absolute inset-0 motion-reduce:hidden">
        <Image src={src} alt="" fill sizes={sizes} className="object-cover object-[var(--focal)] opacity-90" style={{ filter: `url(#${filterId})` }} />
        <div className="absolute inset-0 [background-image:linear-gradient(rgb(240_214_160/0.07)_1px,transparent_1px),linear-gradient(90deg,rgb(240_214_160/0.07)_1px,transparent_1px)] [background-size:28px_28px] sm:[background-size:36px_36px]" />
        <div className="absolute inset-3 border border-[rgb(240_214_160/0.22)] sm:inset-4" />
        {label && <p className="absolute left-6 top-6 font-mono text-[10px] uppercase tracking-[0.2em] text-gold/85 sm:left-8 sm:top-8">{label}</p>}
        {coords && <p className="absolute bottom-6 right-6 font-mono text-[10px] tracking-[0.16em] text-gold/70 sm:bottom-8 sm:right-8">{coords}</p>}
      </div>

      {/* The photograph, revealed behind the scan line. */}
      <motion.div style={{ clipPath: clip }} className="absolute inset-0 motion-reduce:[clip-path:none]!">
        <Image src={src} alt={alt} fill sizes={sizes} {...blurFor(src)} className="object-cover object-[var(--focal)]" />
      </motion.div>

      {/* Scan line */}
      <motion.div
        aria-hidden="true"
        style={{ left: scanLeft, opacity: scanOpacity }}
        className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-gold shadow-[0_0_18px_3px_oklch(0.78_0.13_80/0.5)] motion-reduce:hidden"
      />
    </div>
  );
}
