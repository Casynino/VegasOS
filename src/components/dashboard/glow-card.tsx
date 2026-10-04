import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Accent colours for the command-centre cards (dark surface). */
export const GLOW = {
  blue: "#2f7cf6",
  green: "#22c55e",
  amber: "#f5b301",
  red: "#ef4444",
  violet: "#8b5cf6",
  teal: "#14b8a6",
  orange: "#f97316",
  gold: "#d4a64a",
  slate: "#94a3b8",
} as const;
export type GlowTone = keyof typeof GLOW;

/**
 * Command-centre KPI card from the Vegas dashboard design: tinted glass body,
 * glowing coloured edge, bright icon medallion, large figure and a curved
 * accent sweep. `href` turns the card into a drill-down link.
 */
export function GlowCard({ label, value, icon, tone = "slate", href, sub, delta, deltaUnit = "%", size = "md", className }: {
  label: string; value: ReactNode; icon: ReactNode; tone?: GlowTone; href?: string; sub?: ReactNode;
  delta?: number | null; deltaUnit?: string; size?: "md" | "lg"; className?: string;
}) {
  const c = GLOW[tone];
  const style = { "--c": c } as CSSProperties;
  const body = (
    <div style={style} className={cn(
      "group relative isolate h-full overflow-hidden rounded-2xl border p-4 text-white transition-[transform,box-shadow] duration-300 sm:p-5",
      "border-[color-mix(in_oklch,var(--c)_70%,transparent)]",
      "bg-[linear-gradient(135deg,color-mix(in_oklch,var(--c)_38%,#070b16)_0%,#0a0f1d_62%)]",
      "shadow-[0_0_0_1px_color-mix(in_oklch,var(--c)_25%,transparent),0_12px_40px_-14px_color-mix(in_oklch,var(--c)_70%,transparent)]",
      href && "hover:-translate-y-1 hover:shadow-[0_0_0_1px_color-mix(in_oklch,var(--c)_45%,transparent),0_18px_50px_-12px_color-mix(in_oklch,var(--c)_85%,transparent)] motion-reduce:hover:translate-y-0",
      className,
    )}>
      {/* curved accent sweep (bottom-right), like the brand mockup */}
      <svg aria-hidden viewBox="0 0 200 120" preserveAspectRatio="none" className="pointer-events-none absolute -bottom-px -right-px -z-10 h-[62%] w-[58%] opacity-90 transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none">
        <defs>
          <linearGradient id={`sweep-${tone}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c} stopOpacity="0" />
            <stop offset="1" stopColor={c} stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <path d="M200 0 C 185 70, 120 108, 0 120 L 200 120 Z" fill={`url(#sweep-${tone})`} />
      </svg>
      <div aria-hidden className="pointer-events-none absolute -left-10 -top-10 -z-10 size-32 rounded-full bg-[color-mix(in_oklch,var(--c)_35%,transparent)] blur-3xl" />

      {size === "lg" ? (
        <div className="flex items-center gap-4">
          <Medallion size="lg">{icon}</Medallion>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase leading-tight tracking-[0.14em] text-white/80">{label}</p>
            <p className="font-bold leading-tight tabular-nums tracking-tight drop-shadow-sm text-[clamp(1.6rem,2.6vw,2.25rem)]">{value}</p>
          </div>
          {href && <ChevronRight className="size-5 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white/80" />}
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <Medallion size="md">{icon}</Medallion>
            {href && <ChevronRight className="size-4 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white/80" />}
          </div>
          <p className="mt-3 text-[11px] font-bold uppercase leading-tight tracking-[0.12em] text-white/80">{label}</p>
          <p className="mt-0.5 font-bold leading-tight tabular-nums tracking-tight drop-shadow-sm text-[clamp(1.4rem,2.2vw,1.9rem)]">{value}</p>
        </>
      )}
      {(sub || delta !== undefined) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/70">
          {delta !== undefined && delta !== null && (
            <span className={cn("rounded-full px-2 py-0.5 font-semibold tabular-nums", delta >= 0 ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300")}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}{deltaUnit}
            </span>
          )}
          {sub && <span className="min-w-0">{sub}</span>}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-white/70">{body}</Link> : body;
}

function Medallion({ size, children }: { size: "md" | "lg"; children: ReactNode }) {
  return (
    <span className={cn(
      "grid shrink-0 place-items-center rounded-full text-white shadow-[0_0_24px_-2px_var(--c)] ring-2 ring-white/15",
      "bg-[radial-gradient(circle_at_35%_30%,color-mix(in_oklch,var(--c)_70%,white),var(--c)_55%,color-mix(in_oklch,var(--c)_70%,black))]",
      size === "lg" ? "size-14 sm:size-16 [&_svg]:size-7 sm:[&_svg]:size-8" : "size-10 [&_svg]:size-5",
    )}>{children}</span>
  );
}

/** Money figure with a small currency prefix so large amounts never wrap awkwardly. */
export function Money({ amount }: { amount: number }) {
  return (
    <span className="whitespace-nowrap">
      <span className="mr-1 align-top text-[0.45em] font-semibold tracking-wider text-white/70">TZS</span>
      {Math.round(amount).toLocaleString("en-TZ")}
    </span>
  );
}

/** Dark glass panel used for charts and tables in the command centre. */
export function Panel({ title, action, children, className, subtitle }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset] sm:p-5", className)}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-white">{title}</h2>
          {subtitle && <p className="text-xs text-white/50">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
