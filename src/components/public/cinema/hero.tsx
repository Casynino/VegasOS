"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image, { getImageProps } from "next/image";
import { motion, useMotionTemplate, useScroll } from "motion/react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { Atmosphere } from "../kit/atmosphere";
import { HudLabel } from "../kit/hud";
import { containers } from "../kit/tokens";
import css from "../home/home.module.css";
import { LocalTime } from "./local-time";
import { useRamp } from "./ramp";

export interface HeroSlide {
  src: string;
  alt: string;
  /** Short caption shown with the slide index on desktop, e.g. "Executive Suite". */
  caption: string;
  /** Portrait photo for phones (art direction); falls back to `src`. */
  mobileSrc?: string;
}

/** Live readouts for the hero HUD — real data only (local time, current weather, coordinates). */
export interface HeroHud {
  /** "Dar es Salaam" */
  place: string;
  /** Server-rendered local time ("09:02"); kept current on the client. */
  initialTime: string;
  /** Current temperature, e.g. "26°C", or null when the weather service is unavailable. */
  temp: string | null;
  /** The hotel's coordinates label. */
  coords: string;
}

const SLIDE_MS = 8000;

function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The first photograph, art-directed: the portrait crop on phones, the landscape on larger
 * screens — each device downloads only its own. It is the page's LCP, so it loads eagerly
 * with high priority (no `preload`: that would fetch both crops).
 */
function FirstPicture({ s, hidden }: { s: HeroSlide; hidden: boolean }) {
  const common = { alt: hidden ? "" : s.alt, fill: true, sizes: "100vw", loading: "eager", fetchPriority: "high" } as const;
  const { props: wide } = getImageProps({ ...common, src: s.src });
  const { props: tall } = getImageProps({ ...common, src: s.mobileSrc ?? s.src });
  return (
    <picture>
      <source media="(max-width: 767px)" srcSet={tall.srcSet} sizes="100vw" />
      <source media="(min-width: 768px)" srcSet={wide.srcSet} sizes="100vw" />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- alt and src come from getImageProps */}
      <img {...wide} className="pub-grade max-md:origin-[50%_72%] max-md:scale-[1.28] object-cover object-[50%_42%] md:object-center" />
    </picture>
  );
}

/**
 * Full-screen cinematic hero. Layers, back to front: the photograph (a slow settle per slide, a
 * warm cinematic grade, and a scroll-linked drift so it sinks slower than the page), a calm
 * blueprint atmosphere rising under the title, the HUD (viewfinder brackets, a fine ruler, live
 * local time + weather + coordinates, one scan of light on open) and the content, which lifts
 * and fades as the visitor scrolls on. Phones get one portrait photograph and a single live
 * readout chip; the desktop cross-fades the other real photographs with an index and a pause
 * button. Everything that moves is transform/opacity and stands still with reduced motion.
 */
export function CinematicHero({
  slides,
  children,
  footer,
  hud,
  labelledBy,
  className,
}: {
  slides: HeroSlide[];
  children: React.ReactNode;
  footer?: React.ReactNode;
  hud?: HeroHud;
  labelledBy: string;
  className?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const desktop = useMedia("(min-width: 1024px)");
  const reduce = useMedia("(prefers-reduced-motion: reduce)");
  const [active, setActive] = useState(0);
  // Furthest slide shown so far: only the photo after it is mounted (fetched) ahead of time.
  const [reached, setReached] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const rotate = desktop && !reduce && slides.length > 1;
  const current = rotate ? active : 0;

  // Depth on scroll: the photo sinks at a third of the page speed and grows a touch; the words lift and fade.
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const photoY = useMotionTemplate`${useRamp(p, [0, 1], [0, 30])}%`;
  const photoScale = useRamp(p, [0, 1], [1, 1.07]);
  const shade = useRamp(p, [0, 0.8], [0, 0.6]);
  const textY = useMotionTemplate`${useRamp(p, [0, 1], [0, -90])}px`;
  const textOpacity = useRamp(p, [0.05, 0.6], [1, 0]);

  useEffect(() => {
    if (!rotate || paused || hidden) return;
    const next = (active + 1) % slides.length;
    const timer = window.setTimeout(() => {
      setActive(next);
      setReached((r) => Math.max(r, next));
    }, SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [rotate, paused, hidden, active, slides.length]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  function go(i: number) {
    setActive(i);
    setReached((r) => Math.max(r, i));
  }

  const first = slides[0];
  const layer = "absolute inset-0 transition-opacity duration-[1800ms] ease-in-out motion-reduce:transition-none";

  return (
    <section
      ref={ref}
      aria-labelledby={labelledBy}
      data-tone="night"
      className={cn("relative isolate flex min-h-svh flex-col overflow-hidden bg-night text-pub-fg", className)}
    >
      {/* Photographs (they drift with the scroll) */}
      <motion.div style={{ y: photoY, scale: photoScale }} className="absolute inset-0 -z-10 origin-top bg-night will-change-transform motion-reduce:transform-none!">
        {first && (
          <div className={cn(layer, current === 0 ? "opacity-100" : "opacity-0")} aria-hidden={current !== 0 || undefined}>
            <div className={cn("absolute inset-0", current === 0 && css.kenburns)}>
              <FirstPicture s={first} hidden={current !== 0} />
            </div>
          </div>
        )}
        {rotate &&
          slides.slice(1).map((s, k) => {
            const on = current === k + 1;
            if (k + 1 > reached + 1) return null;
            return (
              <div key={s.src} className={cn(layer, on ? "opacity-100" : "opacity-0")} aria-hidden={!on || undefined}>
                <div className={cn("absolute inset-0", on && css.kenburns)}>
                  <Image src={s.src} alt={on ? s.alt : ""} fill sizes="100vw" className="pub-grade object-cover" />
                </div>
              </div>
            );
          })}
        <div aria-hidden="true" className="pub-grade-tint" />
        <div aria-hidden="true" className={css.grade} />
        <div aria-hidden="true" className={css.vignette} />
      </motion.div>

      {/* Scrims: phones read bottom-up; larger screens shade from the text side. A light veil at the top for the header. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(12_10_7/0.96)_0%,rgb(12_10_7/0.84)_30%,rgb(12_10_7/0.5)_58%,rgb(12_10_7/0.16)_76%,rgb(12_10_7/0.62)_100%)] md:hidden" />
        <div className="absolute inset-0 hidden bg-[linear-gradient(90deg,rgb(12_10_7/0.92)_0%,rgb(12_10_7/0.72)_34%,rgb(12_10_7/0.2)_64%,rgb(12_10_7/0.22)_100%)] md:block" />
        {/* The bright window and wall at the top right never outshine the title. */}
        <div className="absolute inset-0 hidden bg-[radial-gradient(42%_52%_at_86%_16%,rgb(12_10_7/0.6),transparent)] md:block" />
        <div className="absolute inset-0 hidden bg-[linear-gradient(to_top,rgb(12_10_7/0.94)_0%,rgb(12_10_7/0.4)_30%,transparent_55%)] md:block" />
        <div className="absolute inset-x-0 top-0 hidden h-40 bg-linear-to-b from-[rgb(12_10_7/0.6)] to-transparent md:block" />
        {/* Desktop: a soft pool of shade under the live readout (bottom right). */}
        <div className="absolute inset-0 hidden bg-[radial-gradient(34%_40%_at_94%_76%,rgb(12_10_7/0.72),transparent_75%)] lg:block" />
        {/* Darkens as the hero scrolls away, so the next band rises out of the night. */}
        <motion.div style={{ opacity: shade }} className="absolute inset-0 bg-night motion-reduce:opacity-0!" />
      </div>

      {/* Blueprint grid rising under the title, warm light, grain. */}
      <Atmosphere tone="night" atmosphere="calm" pattern="grid" edges="top" className="pub-atmo--hero" />

      {/* HUD: viewfinder, ruler, one scan of light on open (≥640px). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden sm:block">
        <span
          className="pub-hud-corners"
          style={{ inset: "calc(var(--pub-header-h) + 0.75rem) 1.25rem 1.25rem", "--hud-l": "1.375rem", "--hud-c": "rgb(240 214 160 / 0.6)" } as React.CSSProperties}
        />
        <span className={cn(css.heroRuler, "inset-x-[14%] bottom-[1.25rem] hidden lg:block")} />
        <span className="pub-hero-scan" />
      </div>

      {/* Phones and tablets: one live readout under the header — local time and the temperature at the hotel, as plain
          text (owner, 2026-10-05: no box around it). */}
      {hud && (
        <div className={cn(containers.wide, "relative pt-[calc(var(--pub-header-h)+0.75rem)] sm:pt-[calc(var(--pub-header-h)+2rem)] lg:hidden")}>
          <p className="inline-flex max-w-full items-center [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]">
            <HudLabel live className="text-white/80">
              <span className="sr-only">{t("Local time in")} </span>
              {hud.place}
              <LocalTime initial={hud.initialTime} className="ml-2 text-white tabular-nums" />
              {hud.temp && <span className="ml-2 text-white/80">{hud.temp}</span>}
            </HudLabel>
          </p>
        </div>
      )}

      <motion.div style={{ y: textY, opacity: textOpacity }} className="relative flex flex-1 flex-col motion-reduce:transform-none! motion-reduce:opacity-100!">
        {children}
      </motion.div>
      {footer && <div className="relative z-10">{footer}</div>}

      {/* Desktop HUD, top row: coordinates (left), slide index + pause (right). */}
      {(hud || rotate) && (
        <div className={cn(containers.wide, "pointer-events-none absolute inset-x-0 top-[calc(var(--pub-header-h)+1.75rem)] hidden items-center justify-between gap-6 lg:flex")}>
          {hud ? <HudLabel className="pl-5 text-white/70">{hud.coords}</HudLabel> : <span />}
          {rotate && (
            <div className="pointer-events-auto flex items-center gap-4 pr-3 text-white">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-white/75">
                <span className="tabular-nums text-gold">{String(current + 1).padStart(2, "0")}</span>
                <span className="mx-2 text-white/40">/</span>
                <span className="tabular-nums">{String(slides.length).padStart(2, "0")}</span>
                <span className="ml-3 font-sans tracking-[0.22em]">{slides[current]?.caption}</span>
              </p>
              <div className="flex">
                {slides.map((s, i) => (
                  <button
                    key={s.src}
                    type="button"
                    onClick={() => go(i)}
                    aria-label={t("Show photo {n}: {caption}", { n: i + 1, caption: s.caption })}
                    aria-current={i === current ? "true" : undefined}
                    className="group relative flex h-11 w-9 items-center px-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold"
                  >
                    <span className="relative h-px w-full overflow-hidden bg-white/25 transition-colors duration-300 group-hover:bg-white/60">
                      {i === current && (
                        <span
                          key={`${current}-${paused}`}
                          className={cn("absolute inset-0 origin-left bg-gold", !paused && !hidden && "motion-safe:animate-[pub-progress_8s_linear_both]")}
                        />
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPaused((v) => !v)}
                aria-label={paused ? t("Play the slideshow") : t("Pause the slideshow")}
                className="grid size-11 place-items-center rounded-full border border-white/25 bg-black/10 text-white/85 backdrop-blur-sm transition-colors duration-200 hover:border-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                {paused ? <Play className="size-3.5" strokeWidth={1.6} aria-hidden="true" /> : <Pause className="size-3.5" strokeWidth={1.6} aria-hidden="true" />}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
