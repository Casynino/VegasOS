import { cn } from "@/lib/utils";
import fx from "./fx.module.css";

/**
 * A verification seal: a fine ring of ticks that turns very slowly while on screen, a dashed inner
 * ring and the verdict's icon at the centre. Gold when the document checks out, muted when it does not.
 */
export function Seal({ ok = true, children, className }: { ok?: boolean; children: React.ReactNode; className?: string }) {
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i * 6 * Math.PI) / 180;
    const r2 = i % 5 === 0 ? 41 : 43;
    const f = (n: number) => n.toFixed(2);
    return `M${f(50 + 46 * Math.sin(a))} ${f(50 - 46 * Math.cos(a))}L${f(50 + r2 * Math.sin(a))} ${f(50 - r2 * Math.cos(a))}`;
  }).join("");
  return (
    <span data-live-watch="" suppressHydrationWarning className={cn(fx.seal, ok ? "text-gold" : "text-pub-muted", className)}>
      <svg aria-hidden="true" viewBox="0 0 100 100" fill="none" stroke="currentColor">
        <g className={fx.sealSpin}>
          <circle cx="50" cy="50" r="48" strokeOpacity="0.35" strokeWidth="0.6" />
          <path d={ticks} strokeOpacity="0.55" strokeWidth="0.6" />
        </g>
        <circle cx="50" cy="50" r="34" strokeOpacity="0.5" strokeWidth="0.6" strokeDasharray="1.5 2.5" />
        <circle cx="50" cy="50" r="27" strokeOpacity="0.8" strokeWidth="0.8" />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}
