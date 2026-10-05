import { cn } from "@/lib/utils";
import { HOTEL_COORDS } from "../kit/hud";
import fx from "./fx.module.css";

/** Degree ticks for the compass dial (every 5°, longer every 30°). */
const TICKS = Array.from({ length: 72 }, (_, i) => {
  const a = (i * 5 * Math.PI) / 180;
  const long = i % 6 === 0;
  const r1 = 196;
  const r2 = long ? 178 : 188;
  const f = (n: number) => n.toFixed(1);
  return `M${f(200 + r1 * Math.sin(a))} ${f(200 - r1 * Math.cos(a))}L${f(200 + r2 * Math.sin(a))} ${f(200 - r2 * Math.cos(a))}`;
}).join("");

/**
 * A large, faint survey compass behind a lost / error moment (404, error): fine rings and degree
 * ticks that drift slowly as if searching for a bearing, and a needle that swings — only while on
 * screen and never with reduced motion. `y` places its centre (default 40% of the block, behind the
 * numerals rather than the words). Decorative: place it inside a `relative isolate overflow-hidden` block.
 */
export function LostCompass({ y = "40%", className }: { y?: string; className?: string }) {
  return (
    <div aria-hidden="true" data-live-watch="" suppressHydrationWarning className={cn(fx.lost, "pointer-events-none absolute inset-0 -z-[1] overflow-hidden", className)}>
      <div className={fx.compass} style={{ top: y }}>
        {/* Dial and needle are separate layers, so each turns as a whole (composited, no repaint). */}
        <svg viewBox="0 0 400 400" fill="none" stroke="currentColor" className={fx.compassDial}>
          <circle cx="200" cy="200" r="198" strokeOpacity="0.28" />
          <path d={TICKS} strokeOpacity="0.32" />
          <circle cx="200" cy="200" r="150" strokeOpacity="0.16" strokeDasharray="2 6" />
          <circle cx="200" cy="200" r="96" strokeOpacity="0.2" />
          <path d="M200 8v34M200 358v34M8 200h34M358 200h34" strokeOpacity="0.45" />
          <text x="200" y="64" textAnchor="middle" fill="currentColor" stroke="none" fillOpacity="0.5" fontSize="12" fontFamily="ui-monospace, monospace" letterSpacing="3">
            N
          </text>
        </svg>
        <svg viewBox="0 0 400 400" fill="none" stroke="currentColor" className={fx.compassNeedle}>
          <path d="M200 132L206 200L200 268L194 200Z" strokeOpacity="0.3" />
          <path d="M200 132L206 200H194Z" fill="currentColor" fillOpacity="0.14" stroke="none" />
          <circle cx="200" cy="200" r="4" strokeOpacity="0.5" />
        </svg>
      </div>
    </div>
  );
}

/** Huge outline numerals ("404") in the flow, above the words — decorative. */
export function OutlineNumerals({ children, className }: { children: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        fx.outline,
        "block select-none text-center font-display text-[clamp(7.5rem,4rem+15vw,15rem)] font-medium leading-[0.8] tracking-[-0.02em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** "The way back · 06°46′S · 39°14′E" between two hairlines (two centred lines on phones). */
export function WayBack({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-4", className)}>
      <span aria-hidden="true" className="h-px w-8 bg-linear-to-r from-transparent to-pub-line sm:w-16" />
      <p className="flex flex-col items-center gap-1.5 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.2em] text-pub-muted sm:flex-row sm:gap-2 sm:text-[11px]">
        <span>The way back</span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span className="text-pub-eyebrow">{HOTEL_COORDS.label}</span>
      </p>
      <span aria-hidden="true" className="h-px w-8 bg-linear-to-l from-transparent to-pub-line sm:w-16" />
    </div>
  );
}
