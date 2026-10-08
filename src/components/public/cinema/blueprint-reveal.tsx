"use client";

import { useId, useRef } from "react";
import Image from "next/image";
import { motion, useMotionTemplate, useScroll } from "motion/react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { blurFor } from "../blur-data";
import css from "../home/home.module.css";
import { useRamp } from "./ramp";

const mono = "font-mono text-[9px] uppercase leading-none tracking-[0.22em] sm:text-[10px]";

/**
 * "From drawing to building" — the home page's architectural set piece. The hotel's real
 * photograph is first shown as a gold line drawing (an SVG edge filter over the same photo) on
 * blueprint paper, with dimension lines, a survey cross-hair on the building and a drawing title
 * block. As the frame scrolls through the view, a scan line sweeps across it — "Drawing" on one
 * side, "Photograph" on the other — and the photograph takes over. It lives inside its own frame
 * (no pinned section, no scroll trap). With reduced motion it rests as a still half-and-half:
 * the drawing on the left, the photograph on the right.
 *
 * ratio / ratioSm / ratioLg: CSS aspect ratios for phones, from 640px and from 1024px.
 */
export function BlueprintReveal({
  src,
  alt,
  sizes,
  ratio = "4/5",
  ratioSm = ratio,
  ratioLg = ratioSm,
  focal = "50% 50%",
  title,
  place,
  coords,
  target = { x: 30, y: 38 },
  className,
}: {
  src: string;
  alt: string;
  sizes: string;
  ratio?: string;
  ratioSm?: string;
  ratioLg?: string;
  focal?: string;
  /** Drawing title block, first line (the hotel's name). */
  title: string;
  /** Drawing title block, second line (e.g. "Street elevation · Mlimani City"). */
  place: string;
  /** Coordinates printed by the cross-hair and in the title block. */
  coords: string;
  /** Where the survey cross-hair sits on the drawing (percent of the frame). */
  target?: { x: number; y: number };
  className?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  // One filter per instance; CSS url() needs a plain id.
  const filterId = `vlh-dwg-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // The drawing holds while the frame scrolls in; the scan runs while the whole frame is in view
  // (its top travelling from 42% to 5% of the viewport), so the visitor sees the drawing become the building.
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start 0.42", "start 0.05"] });

  // Nothing of the photograph shows until the scan line has faded in at the frame's edge (no sliver at rest).
  const cut = useRamp(p, [0.1, 0.96], [100, 0]);
  const clip = useMotionTemplate`inset(0 0 0 ${cut}%)`;
  const scanLeft = useMotionTemplate`${cut}%`;
  const scanOpacity = useRamp(p, [0.04, 0.12, 0.94, 1], [0, 1, 1, 0]);

  const style = { "--ar": ratio, "--ar-sm": ratioSm, "--ar-lg": ratioLg, "--focal": focal } as React.CSSProperties;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={ref}
        style={style}
        className="relative isolate aspect-[var(--ar)] overflow-hidden bg-night sm:aspect-[var(--ar-sm)] lg:aspect-[var(--ar-lg)]"
      >
        {/* Edge detection → a gold line drawing on near-black. */}
        <svg className="absolute size-0" aria-hidden="true" focusable="false">
          <filter id={filterId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" />
            <feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" />
            <feComponentTransfer>
              <feFuncR type="linear" slope="5" />
              <feFuncG type="linear" slope="5" />
              <feFuncB type="linear" slope="5" />
            </feComponentTransfer>
            <feColorMatrix type="matrix" values="0.96 0 0 0 0.02  0.8 0 0 0 0.015  0.5 0 0 0 0.01  0 0 0 1 0" />
          </filter>
        </svg>

        {/* ── The drawing ── */}
        <div aria-hidden="true" className="absolute inset-0">
          <div className={css.drawingGround} />
          <div className={css.drawingGrid} />
          <Image
            src={src}
            alt=""
            fill
            sizes={sizes}
            className="object-cover object-[var(--focal)] opacity-80 mix-blend-screen"
            // The building is drawn; wires, cars and the street fall away towards the edges.
            style={{
              filter: `url(#${filterId})`,
              maskImage: `radial-gradient(64% 74% at ${target.x + 16}% ${target.y + 12}%, #000 30%, rgb(0 0 0 / 0.45) 62%, transparent 92%)`,
              WebkitMaskImage: `radial-gradient(64% 74% at ${target.x + 16}% ${target.y + 12}%, #000 30%, rgb(0 0 0 / 0.45) 62%, transparent 92%)`,
            }}
          />
          {/* Dimension lines, a survey cross-hair and the sheet border (1px whatever the size). */}
          <svg className="absolute inset-0 size-full text-[rgb(240_214_160)]" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none">
            <g stroke="currentColor" vectorEffect="non-scaling-stroke" strokeWidth="1">
              <rect x="2.5" y="2.5" width="95" height="95" strokeOpacity="0.28" vectorEffect="non-scaling-stroke" />
              {/* top dimension */}
              <path d="M10 8.5H90M10 6.5V10.5M90 6.5V10.5" strokeOpacity="0.55" vectorEffect="non-scaling-stroke" />
              {/* left dimension */}
              <path d="M6.5 16V84M5 16H8M5 84H8" strokeOpacity="0.55" vectorEffect="non-scaling-stroke" />
              {/* cross-hair on the building */}
              <path
                d={`M${target.x} ${target.y - 7}V${target.y - 2.2}M${target.x} ${target.y + 2.2}V${target.y + 7}M${target.x - 5.5} ${target.y}H${target.x - 1.8}M${target.x + 1.8} ${target.y}H${target.x + 5.5}`}
                strokeOpacity="0.85"
                vectorEffect="non-scaling-stroke"
              />
              {/* leader from the cross-hair to its label */}
              <path d={`M${target.x + 2} ${target.y + 2}L${target.x + 9} ${target.y + 9}H${target.x + 26}`} strokeOpacity="0.5" vectorEffect="non-scaling-stroke" />
            </g>
          </svg>
          <span
            className="absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgb(240_214_160/0.8)] sm:size-9"
            style={{ left: `${target.x}%`, top: `${target.y}%` }}
          />
          <span className={cn(mono, "absolute bg-[#120f0b]/85 px-1.5 py-1 text-[rgb(240_214_160/0.95)]")} style={{ left: `${target.x + 10}%`, top: `calc(${target.y + 9}% - 1.5rem)` }}>
            {coords}
          </span>
          {/* Dimension labels (words only — no invented measurements) */}
          <span className={cn(mono, "absolute left-1/2 top-[8.5%] -translate-x-1/2 -translate-y-1/2 bg-[#120f0b] px-2 text-[rgb(240_214_160/0.85)]")}>{t("Elevation")}</span>
          {/* Title block */}
          <div className="absolute bottom-[5%] right-[5%] hidden border border-[rgb(240_214_160/0.35)] bg-[rgb(14_11_8/0.7)] sm:block">
            <p className={cn(mono, "border-b border-[rgb(240_214_160/0.25)] px-3 py-2 text-[rgb(240_214_160/0.95)]")}>{title}</p>
            <p className={cn(mono, "px-3 py-2 text-white/60")}>{place}</p>
          </div>
        </div>

        {/* ── The photograph, revealed behind the scan line ── */}
        <motion.div style={{ clipPath: clip }} className="absolute inset-0 motion-reduce:[clip-path:inset(0_0_0_46%)]!">
          <Image src={src} alt={alt} fill sizes={sizes} {...blurFor(src)} className="pub-grade object-cover object-[var(--focal)]" />
        </motion.div>

        {/* ── Scan line with its two readouts ── */}
        <motion.div
          aria-hidden="true"
          style={{ left: scanLeft, opacity: scanOpacity }}
          className={cn(css.scan, "motion-reduce:left-[46%]! motion-reduce:opacity-100!")}
        >
          <span className={cn(mono, "absolute right-3 top-[14%] whitespace-nowrap text-[rgb(240_214_160)]")}>◂ {t("Drawing")}</span>
          <span className={cn(mono, "absolute left-3 top-[14%] whitespace-nowrap rounded-full bg-black/45 px-2 py-1 text-white backdrop-blur-sm")}>{t("Photograph")} ▸</span>
          <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[rgb(255_236_196)] bg-night" />
        </motion.div>
      </div>
      {/* HUD brackets just outside the frame */}
      <span aria-hidden="true" className="pub-hud-corners" style={{ "--hud-o": "0.625rem", "--hud-l": "1.25rem" } as React.CSSProperties} />
    </div>
  );
}
