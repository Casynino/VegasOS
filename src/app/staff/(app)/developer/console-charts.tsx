import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { num } from "./console-ui";

/**
 * The console's charts, drawn on the server as plain HTML and CSS (no chart library, nothing to download).
 * Every chart has: a title and a one-line explanation (given by its card), readable labels, a legend when there is more than one
 * series, the exact numbers in each bar's `title` (hover), and ALL of them in a table under the chart that anyone can open ("Show the
 * numbers" — it works on a phone, with a keyboard and with a screen reader; a hover cannot).
 * Colours come from the caller: mid tones that read on the light and the dark card. On a phone the charts simply get narrower.
 */

export interface BarSeries { key: string; label: string; color: string }
export interface BarColumn {
  key: string;
  /** What is written under the bar ("" = nothing; every other bar is usually left blank so labels never touch). */
  tick: string;
  /** The full name of the column for the exact numbers ("17 Oct"). */
  name: string;
  values: Record<string, number>;
  /** Today's column is written in bold. */
  emphasise?: boolean;
}

/** The top of the scale: a whole number that four equal steps reach (so every grid line says a whole number). */
export function niceMax(max: number): number {
  if (max <= 4) return Math.max(1, Math.ceil(max));
  return Math.ceil(max / 4) * 4;
}

/** The top of the scale for money: four equal steps of 1, 2, 2.5 or 5 (times a power of ten), so the lines say 250,000 and 500,000, not 308,642. */
export function niceRoundMax(max: number): number {
  if (max <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max / 4));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s * 4 >= max) ?? 10 * magnitude;
  return step * 4;
}

const HEIGHT = 168; // px, the plot area

/**
 * Bars: one column per day (or hour). Stacked by default (one coloured part per series, the column is their sum); `grouped` puts the
 * series side by side instead, for figures that must not be added together (income and money received).
 * `format` writes an exact number (a TZS amount, a percent) in the hover text, the legend and the table; `axis` writes the scale
 * (the number alone, in full); `top` fixes the top of the scale (100 for a percent). Without them it is the plain count chart.
 */
export function BarChart({ t, columns, series, caption, empty, format, axis, grouped, top: fixedTop, negative, height: plotHeight = HEIGHT }: {
  t: T; columns: BarColumn[]; series: BarSeries[]; caption: string; empty: string;
  format?: (n: number) => string; axis?: (n: number) => string; grouped?: boolean; top?: number;
  /** The height of the plot area in pixels (a shorter chart for a panel that shares a row). */
  height?: number;
  /** The word for a part below zero ("refund"), written in the spoken summary and the hover text: "Cash refund −TZS 2,000". */
  negative?: string;
}) {
  const fmt = format ?? ((v: number) => num(t, v));
  const axisFmt = axis ?? fmt;
  const valueOf = (c: BarColumn, key: string) => c.values[key] ?? 0;
  const totalOf = (c: BarColumn) => series.reduce((n, s) => n + valueOf(c, s.key), 0);
  const max = grouped ? Math.max(0, ...columns.flatMap((c) => series.map((s) => valueOf(c, s.key)))) : Math.max(0, ...columns.map(totalOf));
  const top = fixedTop ?? (format ? niceRoundMax(max) : niceMax(max));
  const ticks = top <= 4 ? Array.from({ length: top + 1 }, (_, i) => i) : [0, 1, 2, 3, 4].map((i) => (top * i) / 4);
  const seriesTotals = series.map((s) => columns.reduce((n, c) => n + valueOf(c, s.key), 0));
  const everything = seriesTotals.reduce((a, b) => a + b, 0);
  // A scale written in full needs room: as wide as its longest label (the plain count chart keeps its narrow one).
  const scaleWidth = format || axis ? `${Math.max(...ticks.map((v) => axisFmt(v).length)) + 0.5}ch` : undefined;
  // Every part that is not nothing, so a day that is only a refund does not read as 0.
  const detailOf = (c: BarColumn) => series.filter((s) => valueOf(c, s.key) !== 0).map((s) => `${s.label}${valueOf(c, s.key) < 0 && negative ? ` ${negative}` : ""} ${fmt(valueOf(c, s.key))}`).join(" · ");
  // The picture's spoken summary: a chart of several series says each part of every column, not only its sum.
  const spoken = (c: BarColumn) => {
    const detail = detailOf(c);
    if (grouped || (format && series.length === 1)) return `${c.name} ${detail || fmt(0)}`;
    if (series.length > 1) return `${c.name} ${fmt(totalOf(c))}${detail ? ` (${detail})` : ""}`;
    return `${c.name} ${format ? fmt(totalOf(c)) : totalOf(c)}`;
  };

  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="flex gap-2" role="img" aria-label={`${caption}: ${columns.map(spoken).join(", ")}`}>
        {/* the scale */}
        <div aria-hidden className={cn("relative shrink-0 text-right text-[10px] tabular-nums text-muted-foreground", !scaleWidth && "w-7")} style={{ height: plotHeight, width: scaleWidth }}>
          {ticks.map((v) => <span key={v} className="absolute right-0 -translate-y-1/2 leading-none" style={{ bottom: `${(v / top) * 100}%` }}>{axis || format ? axisFmt(v) : num(t, v)}</span>)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: plotHeight }}>
            {ticks.map((v) => <span key={v} aria-hidden className="absolute inset-x-0 border-t border-dashed border-border/70" style={{ bottom: `${(v / top) * 100}%` }} />)}
            <div className="absolute inset-0 flex items-end gap-[3px] sm:gap-1.5">
              {columns.map((c) => {
                const total = totalOf(c);
                const detail = detailOf(c);
                if (grouped) {
                  return (
                    <div key={c.key} className="flex h-full min-w-0 flex-1 items-end gap-px" title={`${c.name}: ${detail || fmt(0)}`}>
                      {series.map((s) => valueOf(c, s.key) > 0 && <span key={s.key} className="min-w-0 flex-1 rounded-t-[2px]" style={{ height: `${Math.min(100, (valueOf(c, s.key) / top) * 100)}%`, minHeight: 3, background: s.color }} />)}
                    </div>
                  );
                }
                return (
                  <div key={c.key} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${c.name}: ${fmt(total)}${series.length > 1 && detail ? ` — ${detail}` : ""}`}>
                    {total > 0 && (
                      <div className="flex flex-col-reverse overflow-hidden rounded-t-[3px]" style={{ height: `${Math.min(100, (total / top) * 100)}%`, minHeight: 3 }}>
                        {series.map((s) => valueOf(c, s.key) > 0 && <span key={s.key} className="min-h-[2px] border-t border-card first:border-t-0" style={{ flex: `${c.values[s.key]} 1 0%`, background: s.color }} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div aria-hidden className="mt-1.5 flex gap-[3px] sm:gap-1.5">
            {columns.map((c) => (
              <span key={c.key} className="relative h-3.5 min-w-0 flex-1">
                {c.tick && <span className={cn("absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] leading-none tabular-nums", c.emphasise ? "font-bold text-foreground" : "text-muted-foreground")}>{c.tick}</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
      {everything === 0 && <p className="mt-2 text-center text-xs text-muted-foreground">{empty}</p>}
      {series.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />{s.label}<span className="font-semibold tabular-nums text-foreground">{fmt(seriesTotals[i])}</span></li>
          ))}
        </ul>
      )}
      {/* the same numbers as a table, for everyone: a phone has no hover, and a screen reader cannot read a tooltip */}
      <details className="group mt-3 text-xs">
        <summary className="inline-flex cursor-pointer list-none items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">{t("Show the numbers")}</span>
          <span className="hidden group-open:inline">{t("Hide the numbers")}</span>
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-border/60">
          <table className="w-full min-w-max text-left tabular-nums">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr className="border-b border-border/70"><th scope="col" className="px-3 py-1.5 font-medium">{t("When")}</th>{series.map((s) => <th scope="col" key={s.key} className="px-3 py-1.5 text-right font-medium">{s.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {columns.map((c) => <tr key={c.key}><th scope="row" className="px-3 py-1.5 font-medium">{c.name}</th>{series.map((s) => <td key={s.key} className="whitespace-nowrap px-3 py-1.5 text-right">{fmt(valueOf(c, s.key))}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Horizontal bars, one row per name, the biggest first. */
export function RankBars({ t, rows, color, caption, empty, format }: { t: T; rows: { key: string; label: string; value: number; note?: string; color?: string }[]; color: string; caption: string; empty: string; format?: (n: number) => string }) {
  const fmt = format ?? ((v: number) => num(t, v));
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="rounded-2xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} title={`${r.label}: ${fmt(r.value)}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-foreground">{r.label}{r.note && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{r.note}</span>}</span>
              <span className="shrink-0 font-semibold tabular-nums">{fmt(r.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: r.color ?? color }} />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
