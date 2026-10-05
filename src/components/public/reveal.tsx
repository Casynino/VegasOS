"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Reveal on scroll, once: a soft fade and rise as a block enters the viewport (CSS in the
 * public block of globals.css, [data-rv]). Only blocks that start BELOW the fold are hidden,
 * and only after hydration — without JS, with reduced motion, or for anything already on
 * screen, content is simply there (no flash, no hidden hero).
 */
type Tag = "div" | "li" | "ul" | "ol" | "section" | "article";

let observer: IntersectionObserver | null = null;

function getObserver() {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.rv = "in";
          observer?.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );
  }
  return observer;
}

function useReveal() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.94) return; // already on screen
    el.dataset.rv = "wait";
    const io = getObserver();
    io.observe(el);
    return () => {
      io.unobserve(el);
      delete el.dataset.rv;
    };
  }, []);
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
