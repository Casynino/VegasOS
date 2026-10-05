"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Image, { getImageProps } from "next/image";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { containers } from "../kit/tokens";

export interface HeroSlide {
  src: string;
  alt: string;
  /** Short caption shown with the slide index on desktop, e.g. "Executive Suite". */
  caption: string;
  /** Portrait photo for phones (art direction); falls back to `src`. */
  mobileSrc?: string;
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
      <img {...wide} className="object-cover object-[50%_42%] md:object-center" />
    </picture>
  );
}

/**
 * Full-screen cinematic hero. Phones get one portrait photograph that settles once — no
 * slideshow. On desktop (and only with motion allowed) the other real photographs mount after
 * load and cross-fade slowly, with a quiet index and a pause button. Foreground content is
 * passed in as children (server-rendered); `footer` sits at the foot (the desktop search bar).
 */
export function CinematicHero({
  slides,
  children,
  footer,
  labelledBy,
  className,
}: {
  slides: HeroSlide[];
  children: React.ReactNode;
  footer?: React.ReactNode;
  labelledBy: string;
  className?: string;
}) {
  const desktop = useMedia("(min-width: 1024px)");
  const reduce = useMedia("(prefers-reduced-motion: reduce)");
  const [active, setActive] = useState(0);
  // Furthest slide shown so far: only the photo after it is mounted (fetched) ahead of time.
  const [reached, setReached] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const rotate = desktop && !reduce && slides.length > 1;
  const current = rotate ? active : 0;

  useEffect(() => {
    if (!rotate || paused || hidden) return;
    const next = (active + 1) % slides.length;
    const t = window.setTimeout(() => {
      setActive(next);
      setReached((r) => Math.max(r, next));
    }, SLIDE_MS);
    return () => window.clearTimeout(t);
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
  const layer = "absolute inset-0 transition-opacity duration-[1600ms] ease-in-out motion-reduce:transition-none";

  return (
    <section
      aria-labelledby={labelledBy}
      data-tone="night"
      className={cn("relative isolate flex min-h-svh flex-col overflow-hidden bg-night text-pub-fg", className)}
    >
      {/* Photographs */}
      <div className="absolute inset-0 -z-10 bg-night">
        {first && (
          <div className={cn(layer, current === 0 ? "opacity-100" : "opacity-0")} aria-hidden={current !== 0 || undefined}>
            <div className={cn("absolute inset-0", current === 0 && "pub-settle")}>
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
                <div className={cn("absolute inset-0", on && "pub-settle")}>
                  <Image src={s.src} alt={on ? s.alt : ""} fill sizes="100vw" className="object-cover" />
                </div>
              </div>
            );
          })}

        {/* Scrims: phones read bottom-up; larger screens shade from the text side. A light veil at the top for the header. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(to_top,rgb(12_10_7/0.95)_0%,rgb(12_10_7/0.82)_30%,rgb(12_10_7/0.3)_58%,rgb(12_10_7/0.15)_78%,rgb(12_10_7/0.55)_100%)] md:hidden"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden bg-[linear-gradient(90deg,rgb(12_10_7/0.9)_0%,rgb(12_10_7/0.62)_36%,rgb(12_10_7/0.12)_68%,rgb(12_10_7/0.2)_100%)] md:block"
        />
        <div aria-hidden="true" className="absolute inset-0 hidden bg-[linear-gradient(to_top,rgb(12_10_7/0.92)_0%,rgb(12_10_7/0.35)_30%,transparent_55%)] md:block" />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 hidden h-40 bg-linear-to-b from-[rgb(12_10_7/0.55)] to-transparent md:block" />
      </div>

      <div className="relative flex flex-1 flex-col">{children}</div>
      {footer && <div className="relative z-10">{footer}</div>}

      {/* Desktop slide index: number, caption, segments, pause (WCAG 2.2.2) */}
      {rotate && (
        <div className={cn(containers.wide, "pointer-events-none absolute inset-x-0 top-[calc(var(--pub-header-h)+1.5rem)] flex justify-end")}>
          <div className="pointer-events-auto flex items-center gap-4 text-white">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/75">
              <span className="tabular-nums text-gold">{String(current + 1).padStart(2, "0")}</span>
              <span className="mx-2 text-white/40">/</span>
              <span className="tabular-nums">{String(slides.length).padStart(2, "0")}</span>
              <span className="ml-3">{slides[current]?.caption}</span>
            </p>
            <div className="flex">
              {slides.map((s, i) => (
                <button
                  key={s.src}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Show photo ${i + 1}: ${s.caption}`}
                  aria-current={i === current ? "true" : undefined}
                  className="group relative flex h-11 w-9 items-center px-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold"
                >
                  <span className={cn("h-px w-full transition-colors duration-300", i === current ? "bg-gold" : "bg-white/30 group-hover:bg-white/70")} />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Play the slideshow" : "Pause the slideshow"}
              className="grid size-11 place-items-center rounded-full border border-white/25 text-white/85 transition-colors duration-200 hover:border-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              {paused ? <Play className="size-3.5" strokeWidth={1.6} aria-hidden="true" /> : <Pause className="size-3.5" strokeWidth={1.6} aria-hidden="true" />}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
