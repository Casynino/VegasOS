import { Fragment } from "react";
import { cn } from "@/lib/utils";

const SIZE = {
  md: "text-[clamp(2.25rem,1.6rem+3vw,4.5rem)]",
  lg: "text-[clamp(3rem,2rem+5vw,7.5rem)]",
} as const;

/**
 * A slow band of words in outline serif (Cormorant, a gold 1px stroke) — e.g. the hotel's own
 * offer: "Rooms · Restaurant · Bar · Meeting Room". Pure CSS: it runs only while on screen
 * (PubRuntime sets data-live) and stands still with reduced motion. Decorative by default
 * (hidden from screen readers); pass `label` to have it read once. Max one per page.
 */
export function Marquee({
  items,
  size = "lg",
  duration = 60,
  direction = "left",
  outline = true,
  label,
  className,
}: {
  items: string[];
  size?: keyof typeof SIZE;
  /** Seconds per loop (slower = calmer; 45–90). */
  duration?: number;
  direction?: "left" | "right";
  /** Outline letters (default) or solid faint letters. */
  outline?: boolean;
  /** Read by screen readers once (otherwise decorative). */
  label?: string;
  className?: string;
}) {
  const run = (
    <span className="flex shrink-0 items-center">
      {items.map((t, i) => (
        <Fragment key={`${t}-${i}`}>
          <span className={cn("px-[0.35em] font-display font-medium leading-[1.05] whitespace-nowrap", outline ? "pub-outline" : "text-pub-fg/10")}>{t}</span>
          <span aria-hidden="true" className="mx-[0.2em] inline-block size-[0.12em] shrink-0 rotate-45 bg-pub-eyebrow/60" />
        </Fragment>
      ))}
    </span>
  );
  return (
    <div
      data-live-watch="" suppressHydrationWarning
      data-dir={direction}
      aria-hidden={label ? undefined : true}
      className={cn("pub-marquee select-none py-2", SIZE[size], className)}
      style={{ "--marquee-d": `${duration}s` } as React.CSSProperties}
    >
      {label && <span className="sr-only">{label}</span>}
      <div className="pub-marquee__track" aria-hidden="true">
        {run}
        {run}
      </div>
    </div>
  );
}
