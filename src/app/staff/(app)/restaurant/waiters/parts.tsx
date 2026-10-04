import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatTime, formatTZS } from "@/lib/format";
import type { MoneyCount, PayState } from "@/server/services/waiter-performance";

/** What the Waiters page's parts share. */

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "?";

/** 0.4 → "under 1 min", 7.6 → "8 min", 95 → "1 h 35 min"; nothing timed → "—". */
export function mins(m: number | null | undefined) {
  if (m == null) return "—";
  if (m < 1) return "under 1 min";
  const r = Math.round(m);
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ""}`;
}
/** Minutes on shift → "7 h 30 min", none → "—". */
export const hours = (m: number) => (m <= 0 ? "—" : mins(m));

/** The colours used for the facts — calm, never a verdict. */
export const TONE = {
  emerald: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  sky: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  rose: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  muted: "bg-muted text-muted-foreground",
} as const;
export const GOLD = "text-[oklch(0.72_0.11_80)]";

export function Pill({ tone, children, className }: { tone: keyof typeof TONE; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap", TONE[tone], className)}>{children}</span>;
}

/** On shift now (since when) — or not. */
export function ShiftPill({ since }: { since: Date | null }) {
  return since
    ? <Pill tone="emerald"><span className="size-1.5 rounded-full bg-emerald-500" />On shift · since {formatTime(since)}</Pill>
    : <Pill tone="muted">Off shift</Pill>;
}

/** A small figure: label, value, an optional line under it. */
export function Fact({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate text-sm font-semibold tabular-nums", tone)}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

type Settle = { paid: MoneyCount; toConfirm: MoneyCount; onRoom: MoneyCount; unpaid: MoneyCount };
const SETTLE_PARTS = [
  { key: "paid", label: "Paid", bar: "bg-emerald-500/70", tone: "text-emerald-700 dark:text-emerald-300" },
  { key: "toConfirm", label: "Paid · to confirm", bar: "bg-amber-400/80", tone: "text-amber-800 dark:text-amber-300" },
  { key: "onRoom", label: "On room bills", bar: "bg-violet-500/60", tone: "text-violet-700 dark:text-violet-300" },
  { key: "unpaid", label: "Still to pay", bar: "bg-rose-500/60", tone: "text-rose-700 dark:text-rose-300" },
] as const;

/** How the served orders were settled: a thin bar (by number of orders) and the counts and values. */
export function SettleBar({ s, compact }: { s: Settle; compact?: boolean }) {
  const n = s.paid.count + s.toConfirm.count + s.onRoom.count + s.unpaid.count;
  if (!n) return <p className="text-[11px] text-muted-foreground">No served orders to settle.</p>;
  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {SETTLE_PARTS.map((p) => s[p.key].count > 0 && <span key={p.key} className={p.bar} style={{ width: `${(s[p.key].count / n) * 100}%` }} />)}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {SETTLE_PARTS.filter((p) => s[p.key].count > 0).map((p) => (
          <span key={p.key} className="tabular-nums">
            <span className={cn("font-semibold", p.tone)}>{p.label}</span> {s[p.key].count}{compact ? "" : ` · ${formatTZS(s[p.key].value)}`}
          </span>
        ))}
      </p>
    </div>
  );
}

/** An order's payment state, in plain words. */
export function payLabel(p: PayState | null, o: { due: number; served: boolean }): { label: string; tone: keyof typeof TONE } {
  switch (p) {
    case "PAID": return { label: "Paid", tone: "emerald" };
    case "TO_CONFIRM": return { label: "Paid · to confirm", tone: "amber" };
    case "ROOM": return { label: "On the room bill", tone: "violet" };
    case "PART": return { label: `Part paid · ${formatTZS(o.due)} due`, tone: "amber" };
    case "REFUNDED": return { label: "Refunded", tone: "muted" };
    case "UNPAID": return o.served ? { label: `Not paid · ${formatTZS(o.due)}`, tone: "rose" } : { label: "Not paid yet", tone: "muted" };
    default: return { label: "—", tone: "muted" };
  }
}
