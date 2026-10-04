import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Status accents — used only for the icon chip and hairline, never as full-card fills. */
const ACCENTS = {
  blue: { chip: "bg-blue-500/12 text-blue-700 dark:text-blue-300", bar: "bg-blue-500" },
  green: { chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500" },
  amber: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", bar: "bg-amber-500" },
  red: { chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300", bar: "bg-rose-500" },
  violet: { chip: "bg-violet-500/12 text-violet-700 dark:text-violet-300", bar: "bg-violet-500" },
  orange: { chip: "bg-orange-500/12 text-orange-700 dark:text-orange-300", bar: "bg-orange-500" },
  slate: { chip: "bg-slate-500/12 text-slate-700 dark:text-slate-300", bar: "bg-slate-500" },
  gold: { chip: "bg-gold/20 text-[oklch(0.5_0.1_75)] dark:text-gold", bar: "bg-gold" },
} as const;

export type StatTone = keyof typeof ACCENTS;

/**
 * KPI card in the Vegas staff design system.
 *  - variant "feature": ink card with gold hairline for level-1 metrics (revenue, profit, occupancy…)
 *  - variant "status":  light card with a status accent for level-2 metrics
 * Cards with `href` act as navigation into the underlying list. Values always come from the database.
 */
export function StatCard({ label, value, icon, tone = "slate", href, sub, variant = "status", className }: {
  label: string; value: ReactNode; icon: ReactNode; tone?: StatTone; href?: string; sub?: ReactNode;
  variant?: "status" | "feature"; className?: string;
}) {
  const accent = ACCENTS[tone];
  const feature = variant === "feature";
  const body = (
    <div className={cn(
      "group relative isolate h-full overflow-hidden rounded-xl p-4 transition-[transform,box-shadow,border-color] duration-300 motion-reduce:transition-none",
      feature
        ? "bg-ink text-white shadow-[0_1px_0_0_oklch(1_0_0/6%)_inset,0_10px_30px_-12px_oklch(0.16_0.02_265/60%)]"
        : "border border-border/80 bg-card shadow-[0_1px_2px_oklch(0_0_0/4%)]",
      href && "hover:-translate-y-0.5 hover:shadow-lg motion-reduce:hover:translate-y-0",
      href && !feature && "hover:border-foreground/15",
      className,
    )}>
      {feature ? (
        <>
          <span aria-hidden className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-gold to-transparent opacity-80" />
          <span aria-hidden className="absolute -right-16 -top-16 -z-10 size-40 rounded-full bg-gold/10 blur-2xl transition-opacity duration-500 group-hover:opacity-100 opacity-60" />
        </>
      ) : (
        <span aria-hidden className={cn("absolute left-0 top-4 h-6 w-[3px] rounded-r-full", accent.bar)} />
      )}
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", feature ? "text-white/60" : "text-muted-foreground")}>{label}</p>
        <span className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4",
          feature ? "bg-white/8 text-gold ring-1 ring-white/10" : accent.chip,
        )}>{icon}</span>
      </div>
      <p className={cn("mt-2 font-semibold leading-none tabular-nums tracking-tight", feature ? "text-[clamp(1.5rem,2.4vw,2rem)]" : "text-[clamp(1.5rem,2.2vw,1.875rem)]")}>{value}</p>
      {(sub || href) && (
        <div className={cn("mt-3 flex items-center justify-between gap-2 text-xs", feature ? "text-white/60" : "text-muted-foreground")}>
          <span className="min-w-0 truncate">{sub}</span>
          {href && <ArrowUpRight className="size-3.5 shrink-0 opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100 motion-reduce:transition-none" />}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/60">{body}</Link> : body;
}
