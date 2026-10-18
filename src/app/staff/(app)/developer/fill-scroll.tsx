import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A panel's scrolling list or table (owner, 2026-10-18: "lines of 5 or 6, not more, we can scroll for more", and no empty space beside a panel).
 * On a phone it is `maxH` tall and scrolls. On a wide screen it takes the height the other panels of its row give it (the panel must be a flex
 * column and this its `flex-1` part) and scrolls inside, so the cards of one row end together instead of leaving a blank area. It can be reached
 * and scrolled with the keyboard (a region with a label and a visible focus ring).
 */
export function FillScroll({ label, children, maxH = "max-h-[21.5rem]", minH = "lg:min-h-[21.5rem]", className }: {
  label: string; children: ReactNode; maxH?: string; minH?: string; className?: string;
}) {
  return (
    <div className={cn("relative lg:flex-1", minH)}>
      <div
        tabIndex={0} role="region" aria-label={label}
        className={cn("overflow-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold lg:absolute lg:inset-0 lg:max-h-none", maxH, className)}
      >
        {children}
      </div>
    </div>
  );
}
