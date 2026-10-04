import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type MoneySplit = { label: string; value: number; color: string };
export type MoneyCell = { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn"; bar?: number; href?: string; icon?: React.ReactNode; tint?: string };

const TONE = { good: "text-emerald-600 dark:text-emerald-400", bad: "text-rose-600 dark:text-rose-400", warn: "text-amber-600 dark:text-amber-300" };
const n = (v: number) => v.toLocaleString("en-US");
/** "TZS 112,000" → a small, quiet "TZS" and the number in full. */
function Amount({ value, unit = "text-[0.55em]" }: { value: string; unit?: string }) {
  const m = /^TZS\s(.+)$/.exec(value);
  return m ? <><span className={cn("mr-1 align-baseline font-medium tracking-normal text-muted-foreground", unit)}>TZS</span>{m[1]}</> : <>{value}</>;
}

/**
 * Today's money in one calm card (next to a glance ring): the headline figure against yesterday,
 * where it came from as one split bar, then six small figures in a grid — no stack of tiles
 * repeating the ring. Reads well on a phone (two columns) and a computer (three).
 */
export function MoneyCard({ title, href, linkLabel, headline, split, cells }: {
  title: string; href?: string; linkLabel?: string;
  headline: { value: string; label: string; delta?: number | null; deltaLabel?: string };
  split: MoneySplit[];
  cells: MoneyCell[];
}) {
  const total = split.reduce((t, s) => t + s.value, 0);
  const d = headline.delta;
  return (
    <section className="relative flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-60 rounded-full bg-[oklch(0.75_0.12_80/0.09)] blur-3xl" />
      <div className="relative flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-50" /><span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" /></span>{title}
        </p>
        {href && <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.11_82)]">{linkLabel}<ArrowUpRight className="size-3.5" /></Link>}
      </div>

      <div className="relative mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-[clamp(1.75rem,7vw,2.25rem)] font-semibold leading-none tracking-tight tabular-nums"><Amount value={headline.value} unit="text-[0.45em]" /></p>
        {d != null && (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", d >= 0 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/12 text-rose-600 dark:text-rose-400")}>
            {d >= 0 ? "▲" : "▼"} {Math.abs(Math.round(d))}% {headline.deltaLabel ?? "vs yesterday"}
          </span>
        )}
      </div>
      <p className="relative mt-1.5 text-xs text-muted-foreground">{headline.label}</p>

      {/* Where it came from — one bar, and only what earned something */}
      <div className="relative mt-3.5 flex h-2.5 gap-[3px] overflow-hidden rounded-full bg-muted">
        {total > 0 && split.filter((s) => s.value > 0).map((s) => <span key={s.label} className="h-full rounded-full" style={{ width: `${(s.value / total) * 100}%`, background: s.color }} title={`${s.label}: ${n(s.value)}`} />)}
      </div>
      <ul className="relative mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs min-[440px]:grid-cols-2 sm:flex sm:flex-wrap sm:gap-x-5 sm:text-[11px]">
        {split.filter((s) => s.value > 0 || total === 0).map((s) => (
          <li key={s.label} className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="truncate">{s.label}</span>
            <strong className="ml-auto font-semibold tabular-nums text-foreground sm:ml-1">{n(s.value)}</strong>
            {total > 0 && <span className="tabular-nums text-muted-foreground/70">{Math.round((s.value / total) * 100)}%</span>}
          </li>
        ))}
      </ul>

      {/* Six small figures */}
      <div className="relative mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60 sm:grid-cols-3 lg:mt-auto">
        {cells.map((c) => {
          const body = (
            <>
              <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                {c.icon && <span className={cn("grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3", c.tint ?? "bg-muted text-muted-foreground")}>{c.icon}</span>}
                <span className="truncate">{c.label}</span>
              </p>
              <p className={cn("mt-1 truncate text-[17px] font-semibold tabular-nums sm:text-lg", c.tone && TONE[c.tone])}><Amount value={c.value} /></p>
              {c.bar != null && <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, Math.max(0, c.bar))}%` }} /></span>}
              {c.sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.sub}</p>}
            </>
          );
          return c.href
            ? <Link key={c.label} href={c.href} className="min-w-0 bg-card px-3 py-3 transition-colors hover:bg-muted/40 active:bg-muted/60">{body}</Link>
            : <div key={c.label} className="min-w-0 bg-card px-3 py-3">{body}</div>;
        })}
      </div>
    </section>
  );
}
