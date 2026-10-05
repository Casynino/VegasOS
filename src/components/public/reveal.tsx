"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Reveal on scroll, once: a soft fade and rise as a block enters the viewport (CSS in the
 * public block of globals.css, [data-rv]). Only blocks that start BELOW the fold are hidden,
 * and only after hydration — without JS, with reduced motion, or for anything already on
 * screen, content is simply there (no flash, no hidden hero).
 */
type Tag = "div" | "li" | "ul" | "ol" | "section" | "article" | "figure" | "span";

const observers: { fade?: IntersectionObserver; mask?: IntersectionObserver } = {};

/** How long a mask reveal (wipe + scan) takes before its clip is dropped (focus rings stay visible). */
const MASK_MS = 1500;

/**
 * One shared observer per kind. Mask reveals clip their CHILD while they wait (the observer
 * measures a target's own clip-path, so the observed element itself stays unclipped); threshold 0.
 */
function getObserver(kind: "fade" | "mask") {
  let io = observers[kind];
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          io?.unobserve(el);
          if (kind === "mask") {
            el.style.setProperty("--scan-h", `${el.offsetHeight + 32}px`);
            const step = Math.min(Number(el.style.getPropertyValue("--reveal-i")) || 0, 6);
            window.setTimeout(() => {
              if (el.dataset.rv === "in") el.dataset.rv = "done";
            }, MASK_MS + step * 70);
          }
          el.dataset.rv = "in";
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: kind === "mask" ? 0 : 0.01 },
    );
    observers[kind] = io;
  }
  return io;
}

function useReveal(kind: "fade" | "mask" = "fade") {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.94) return; // already on screen
    el.dataset.rv = "wait";
    const io = getObserver(kind);
    io.observe(el);
    return () => {
      io.unobserve(el);
      delete el.dataset.rv;
    };
  }, [kind]);
  return ref;
}

export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /** Small stagger, in tenths: 0.1 → one 70 ms step. */
  delay?: number;
  as?: Tag;
}) {
  const ref = useReveal();
  const T = as as React.ElementType;
  return (
    <T ref={ref} className={className} style={delay ? ({ "--reveal-i": Math.round(delay * 10) } as React.CSSProperties) : undefined}>
      {children}
    </T>
  );
}

/** Plain wrapper kept for older pages (the stagger lives on each StaggerItem). */
export function Stagger({ children, className, as = "div" }: { children: React.ReactNode; className?: string; as?: Tag }) {
  const T = as as React.ElementType;
  return <T className={className}>{children}</T>;
}

/** One item of a staggered group: items reveal one after another (index % 6 steps of 70 ms). */
export function StaggerItem({ children, className, as = "div", index = 0 }: { children: React.ReactNode; className?: string; as?: Tag; index?: number }) {
  const ref = useReveal();
  const T = as as React.ElementType;
  return (
    <T ref={ref} className={className} style={{ "--reveal-i": index % 6 } as React.CSSProperties}>
      {children}
    </T>
  );
}

/**
 * Mask reveal, once: the block is wiped open with a clip-path as it enters (opening downward by
 * default; the wipe clips the direct child, so pass one element), photos inside settle from a slight zoom, and with `sweep` a fine gold scan line runs
 * down with the wipe. Same rules as Reveal: only below the fold, only with JS and motion allowed —
 * otherwise simply visible. Use it on photos and big headings, not on body text. The clip is
 * removed when the reveal ends, so focus rings inside are never cut.
 */
export function MaskReveal({
  children,
  className,
  direction = "up",
  sweep = false,
  index = 0,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /** "up" opens downward from the top edge, "left"/"right" wipe sideways, "center" opens from the middle. */
  direction?: "up" | "left" | "right" | "center";
  /** A gold scan line follows the wipe (photos). */
  sweep?: boolean;
  /** Stagger step (70 ms each, max 6). */
  index?: number;
  as?: Tag;
}) {
  const ref = useReveal("mask");
  const T = as as React.ElementType;
  return (
    <T
      ref={ref}
      data-rv-mask={direction}
      data-rv-sweep={sweep ? "" : undefined}
      className={cn(sweep && "relative", className)}
      style={index ? ({ "--reveal-i": index % 6 } as React.CSSProperties) : undefined}
    >
      {children}
    </T>
  );
}
