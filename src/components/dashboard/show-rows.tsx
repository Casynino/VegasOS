"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shows the first `show` rows (elements marked `data-row`) of the list or table
 * inside it; the rest are a scroll away. The height is measured from the real
 * rows, so it fits exactly on every screen size. `data-head` (a sticky header)
 * and `data-foot` (a sticky total row) stay in view around the rows. A bar
 * underneath says how many more there are and brings them up when tapped.
 */
/** Until the rows are measured (first paint, before the page is interactive) only the first rows show — no jump. */
const HIDE_AFTER: Record<number, string> = {
  1: "[&_[data-row]:nth-child(n+2)]:hidden", 2: "[&_[data-row]:nth-child(n+3)]:hidden", 3: "[&_[data-row]:nth-child(n+4)]:hidden",
  4: "[&_[data-row]:nth-child(n+5)]:hidden", 5: "[&_[data-row]:nth-child(n+6)]:hidden",
};

export function ShowRows({ show = 3, total, children, className }: { show?: number; total: number; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState<number | null>(null);
  const [foot, setFoot] = useState(0);
  const [below, setBelow] = useState(total - show);
  const extra = total - show;

  const parts = useCallback(() => {
    const el = box.current!;
    const rect = el.getBoundingClientRect();
    const head = el.querySelector<HTMLElement>("[data-head]")?.getBoundingClientRect().height ?? 0;
    const f = el.querySelector<HTMLElement>("[data-foot]")?.getBoundingClientRect().height ?? 0;
    const rows = [...el.querySelectorAll<HTMLElement>("[data-row]")];
    const visibleBottom = rect.top + el.clientHeight - f;
    return { el, rect, head, f, rows, hidden: rows.filter((r) => r.getBoundingClientRect().bottom > visibleBottom + 1) };
  }, []);

  useLayoutEffect(() => {
    if (!box.current || extra <= 0) return;
    const measure = () => {
      const { el, rect, f, rows } = parts();
      const last = rows[show - 1];
      if (!last) return;
      setFoot(f);
      setMax(Math.ceil(last.getBoundingClientRect().bottom - (rect.top - el.scrollTop) + f));
      requestAnimationFrame(() => box.current && setBelow(parts().hidden.length));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [show, extra, parts]);

  if (extra <= 0) return <div className={className}>{children}</div>;
  const step = () => {
    const { el, rect, head, hidden } = parts();
    if (!hidden.length) { el.scrollTo({ top: 0, behavior: "smooth" }); return; }
    el.scrollTo({ top: el.scrollTop + hidden[0].getBoundingClientRect().top - rect.top - head, behavior: "smooth" });
  };
  return (
    <div>
      <div className="relative">
        <div ref={box} className={cn("relative overflow-auto overscroll-contain [scrollbar-width:thin]", max === null && HIDE_AFTER[show], className)}
          style={max === null ? undefined : { maxHeight: max }}
          onScroll={() => setBelow(parts().hidden.length)}>
          {children}
        </div>
        {/* a soft edge that says "the list goes on" without hiding the last row */}
        <div aria-hidden style={{ bottom: foot }} className={cn("pointer-events-none absolute inset-x-0 h-4 bg-gradient-to-t from-black/25 to-transparent transition-opacity dark:from-black/50", !below && "opacity-0")} />
      </div>
      <button type="button" onClick={step}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border/60 bg-muted/30 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        {below ? <><ChevronDown className="size-3.5" />Scroll for {below} more</> : <><ChevronUp className="size-3.5" />Back to the top</>}
      </button>
    </div>
  );
}
