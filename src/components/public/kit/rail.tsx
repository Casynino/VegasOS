"use client";

import { Children, useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WIDTH = {
  /** One large item with the next one peeking (rooms, stories). */
  lg: "w-[84%] sm:w-[58%] lg:w-[42%]",
  /** Medium items (services, gallery). */
  md: "w-[76%] sm:w-[44%] lg:w-[31%]",
  /** Small items (dishes, thumbnails). */
  sm: "w-[58%] sm:w-[34%] lg:w-[23%]",
} as const;

const GRID = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" } as const;

/**
 * Horizontal swipe rail: scroll-snap, the next item peeking on phones, a HUD counter ("02 / 05")
 * with a glowing hairline progress bar, and previous/next buttons on desktop. Scrolls sideways only (no nested vertical
 * scroll). Place it directly inside a page container: by default it bleeds to the screen
 * edge (`bleed`) so items slide under the gutter; pass bleed={false} anywhere else.
 * desktop="grid" turns it into a plain grid from 1024px — use it whenever the items fit in
 * one desktop row (≤ cols), so the desktop never shows a rail that does not scroll.
 */
export function Rail({
  label,
  size = "md",
  desktop = "rail",
  cols = 3,
  bleed = true,
  className,
  itemClassName,
  children,
}: {
  /** Accessible name of the list, e.g. "Room types". */
  label: string;
  size?: keyof typeof WIDTH;
  desktop?: "rail" | "grid";
  cols?: keyof typeof GRID;
  bleed?: boolean;
  className?: string;
  itemClassName?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  // Assume it scrolls until measured, so the controls row is in the first paint (no layout shift).
  const [edges, setEdges] = useState({ start: true, end: false, scrollable: true });
  const [active, setActive] = useState(0);
  const items = Children.toArray(children);

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const scrollable = max > 4;
    const progress = scrollable ? el.scrollLeft / max : 0;
    const ratio = scrollable ? el.clientWidth / el.scrollWidth : 1;
    if (barRef.current) {
      barRef.current.style.width = `${Math.max(ratio * 100, 12)}%`;
      barRef.current.style.left = `${progress * (100 - Math.max(ratio * 100, 12))}%`;
    }
    const next = { start: el.scrollLeft <= 4, end: el.scrollLeft >= max - 4, scrollable };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end && prev.scrollable === next.scrollable ? prev : next));
    // HUD counter: the item at the leading edge (the last one once the end is reached).
    const first = el.querySelector<HTMLElement>(":scope > li");
    const step = first ? first.offsetWidth + (parseFloat(getComputedStyle(el).columnGap) || 0) : 0;
    const count = el.children.length;
    const index = next.end ? count - 1 : step > 0 ? Math.min(count - 1, Math.round(el.scrollLeft / step)) : 0;
    setActive(index);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [measure, items.length]);

  function step(dir: 1 | -1) {
    const el = listRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(":scope > li");
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const by = first ? first.offsetWidth + gap : el.clientWidth * 0.8;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * by, behavior: reduce ? "auto" : "smooth" });
  }

  const grid = desktop === "grid";
  return (
    <div className={cn("relative", className)}>
      <ul
        ref={listRef}
        id={id}
        aria-label={label}
        className={cn(
          // py-2 with -my-1: room for item focus rings (up to 6px outside an item) without moving the layout.
          "relative -my-1 flex snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden overscroll-x-contain py-2 sm:gap-6 lg:snap-proximity",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          bleed && "-mx-4 scroll-px-4 px-4 sm:-mx-8 sm:scroll-px-8 sm:px-8",
          grid && cn("lg:mx-0 lg:grid lg:snap-none lg:gap-8 lg:overflow-visible lg:px-0", GRID[cols]),
        )}
      >
        {items.map((child, i) => (
          <li key={i} className={cn("min-w-0 shrink-0 snap-start", WIDTH[size], grid && "lg:w-auto", itemClassName)}>
            {child}
          </li>
        ))}
      </ul>

      {items.length > 1 && edges.scrollable && (
        <div className={cn("mt-6 flex items-center gap-4 sm:gap-5", grid && "lg:hidden")}>
          <span aria-hidden="true" className="shrink-0 font-mono text-[10px] font-medium tabular-nums tracking-[0.2em] text-pub-muted sm:text-[11px]">
            <span className="text-pub-eyebrow">{String(active + 1).padStart(2, "0")}</span> / {String(items.length).padStart(2, "0")}
          </span>
          {/* Owner, 2026-10-05: "hard to know you can scroll" — say it, until the first swipe. */}
          {edges.start && (
            <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-pub-eyebrow motion-safe:animate-pulse lg:hidden">
              Swipe<ChevronRight className="size-3.5" strokeWidth={1.8} />
            </span>
          )}
          <span aria-hidden="true" className="relative h-px flex-1 overflow-hidden bg-pub-line">
            <span
              ref={barRef}
              className="absolute inset-y-0 bg-gold shadow-[0_0_10px_1px_rgb(227_189_106/0.55)] transition-[left,width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: "12%", left: "0%" }}
            />
          </span>
          <div className="flex gap-2">
            <RailButton label="Previous" controls={id} disabled={edges.start} onClick={() => step(-1)}>
              <ChevronLeft className="size-4" strokeWidth={1.6} aria-hidden="true" />
            </RailButton>
            <RailButton label="Next" controls={id} disabled={edges.end} onClick={() => step(1)}>
              <ChevronRight className="size-4" strokeWidth={1.6} aria-hidden="true" />
            </RailButton>
          </div>
        </div>
      )}
    </div>
  );
}

function RailButton({
  label,
  controls,
  disabled,
  onClick,
  children,
}: {
  label: string;
  controls: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-controls={controls}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-full border border-pub-line text-pub-fg transition-colors duration-200 hover:border-pub-fg/60 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-gold disabled:opacity-35 motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}
