import Link from "next/link";
import { ArrowUpRight, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "sky" | "rose" | "emerald" | "violet" | "amber";
const TONE: Record<Tone, { icon: string; bar: string; glow: string; alert: string; solid: string }> = {
  sky: { icon: "bg-sky-500/15 text-sky-600 dark:text-sky-300", bar: "bg-sky-500", glow: "from-sky-500/[0.07]", alert: "from-sky-500/[0.16] ring-sky-400/70", solid: "bg-sky-500 text-white" },
  rose: { icon: "bg-rose-500/15 text-rose-600 dark:text-rose-300", bar: "bg-rose-500", glow: "from-rose-500/[0.07]", alert: "from-rose-500/[0.16] ring-rose-400/70", solid: "bg-rose-500 text-white" },
  emerald: { icon: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", bar: "bg-emerald-500", glow: "from-emerald-500/[0.07]", alert: "from-emerald-500/[0.16] ring-emerald-400/70", solid: "bg-emerald-500 text-white" },
  violet: { icon: "bg-violet-500/15 text-violet-600 dark:text-violet-300", bar: "bg-violet-500", glow: "from-violet-500/[0.07]", alert: "from-violet-500/[0.16] ring-violet-400/70", solid: "bg-violet-500 text-white" },
  amber: { icon: "bg-amber-500/15 text-amber-700 dark:text-amber-300", bar: "bg-amber-500", glow: "from-amber-500/[0.07]", alert: "from-amber-500/[0.16] ring-amber-400/70", solid: "bg-amber-500 text-black" },
};

export interface TodayPart {
  label: string; icon: React.ReactNode; tone: Tone; href: string;
  /** The headline number and what it counts ("to check in"). */
  value: number | string; unit: string;
  /** How far the day has got: `done` of `of` (the line fills up). */
  done: number; of: number;
  note: string;
  /** Something is waiting for this person (e.g. new orders for the cook): a ringing bell, a glow and "tap to open". */
  alert?: string | null;
}

/**
 * The desk today in one band: each part says what is left to do, with a line
 * that fills up as the day gets done — arrivals checked in, departures checked
 * out, rooms filled, rooms still free to sell.
 */
/** `compact`: smaller cards (the main restaurant screen, under its money band). */
export function TodayStrip({ parts, compact = false }: { parts: TodayPart[]; compact?: boolean }) {
  return (
    <section aria-label="Today" className="grid grid-cols-2 overflow-hidden rounded-3xl border border-border/70 bg-card lg:grid-cols-4">
      {parts.map((p, i) => {
        const t = TONE[p.tone];
        const pct = p.of > 0 ? Math.min(100, Math.round((p.done / p.of) * 100)) : 0;
        return (
          <Link key={p.label} href={p.href}
            className={cn("group relative flex flex-col bg-linear-to-b to-transparent transition-colors hover:bg-muted/40", compact ? "gap-2 px-4 py-3" : "gap-3 p-4 sm:p-5", p.alert ? cn(t.alert, "ring-2 ring-inset motion-safe:animate-[vlh-alert_2s_ease-in-out_infinite]") : t.glow,
              i % 2 === 1 && "border-l border-border/60", i >= 2 && "border-t border-border/60 lg:border-t-0", i === 2 && "lg:border-l")}>
            <div className="flex items-center gap-2">
              <span className={cn("relative grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5", p.alert ? t.solid : t.icon)}>
                {p.alert ? <BellRing className="origin-top motion-safe:animate-[vlh-bell_1.2s_ease-in-out_infinite]" /> : p.icon}
                {p.alert && <span className={cn("absolute -right-1 -top-1 size-2.5 rounded-full ring-2 ring-card motion-safe:animate-ping", t.bar)} />}
              </span>
              <span className={cn("truncate text-[11px] font-semibold uppercase tracking-[0.08em]", !compact && "sm:text-xs sm:tracking-[0.14em]", p.alert ? "text-foreground" : "text-muted-foreground")}>{p.label}</span>
              {/* Small cards: the ringing bell and the glow say it — no room for the badge. */}
              {p.alert
                ? !compact && <span className={cn("ml-auto hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:inline", t.solid)}>Tap to open</span>
                : !compact && <ArrowUpRight className="ml-auto hidden size-4 shrink-0 text-muted-foreground/60 sm:block transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />}
            </div>
            <p className="flex items-baseline gap-2">
              <span className={cn("font-semibold leading-none tracking-tight tabular-nums", compact ? "text-2xl" : "text-3xl")}>{p.value}</span>
              <span className="text-sm text-muted-foreground">{p.unit}</span>
            </p>
            <div>
              <div className={cn("overflow-hidden rounded-full bg-muted", compact ? "h-1" : "h-1.5")} role="progressbar" aria-valuemin={0} aria-valuemax={p.of} aria-valuenow={p.done} aria-label={p.note}>
                <div className={cn("h-full rounded-full", t.bar)} style={{ width: `${pct}%` }} />
              </div>
              <p className={cn("mt-1.5 truncate text-xs", p.alert ? "font-medium text-foreground/85" : "text-muted-foreground")}>{p.alert ?? p.note}</p>
            </div>
          </Link>
        );
      })}
    </section>
  );
}
