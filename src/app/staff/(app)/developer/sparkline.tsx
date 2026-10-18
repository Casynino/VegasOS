import { cn } from "@/lib/utils";

/**
 * The little pictures on the health card (copied from the owner's Target console): a line with a soft fill under it for a count per
 * day, and a row of bars for the six quick answers of the database. Plain SVG drawn on the server: no script, no library. They carry no
 * numbers of their own (the number is written above them); a screen reader gets one short sentence from `label`.
 */

/** A count per day as a line with a soft fill. A flat line (all zero) is drawn along the bottom. */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  const W = 100, H = 32, PAD = 2;
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(2)} ${H} L${x(0).toFixed(2)} ${H} Z`;
  const id = `spark-${label.length}-${values.join("-").slice(0, 40)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={cn("h-10 w-full text-foreground/70", className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Six quick answers of the database as bars (a shorter bar is faster). */
export function MiniBars({ values, label, className }: { values: number[]; label: string; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={label} className={cn("flex h-10 items-end gap-2", className)}>
      {values.map((v, i) => (
        <span key={i} className="min-w-0 flex-1 rounded-sm bg-emerald-500" style={{ height: `${Math.max(14, Math.round((v / max) * 100))}%` }} />
      ))}
    </div>
  );
}
