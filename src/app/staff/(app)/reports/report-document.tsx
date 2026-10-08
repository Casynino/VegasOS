import Image from "next/image";
import { Info } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Block, Cell, Column, Figure, Report, Tone } from "@/lib/report-types";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";
import { localizeReport } from "@/lib/report-i18n";

/** Ink on paper — the document is always light, on screen and in print. */
const INK: Record<Tone, string> = {
  gold: "text-[#8a6a25]", emerald: "text-[#047857]", rose: "text-[#be123c]", amber: "text-[#b45309]", sky: "text-[#0369a1]", violet: "text-[#6d28d9]", slate: "text-[#475569]",
};
const n = (v: number) => formatNumber(v);
const money = (v: number) => (v < 0 ? `(${n(-v)})` : n(v || 0));

type Hotel = { name: string; tagline?: string | null; address: string; contact: string };

/**
 * A report as a document: the hotel's letterhead, the headline figures, then each part numbered —
 * bars, charts, a statement or a table — and lines to sign. Prints on A4 (Print) and is the same
 * page that becomes the PDF or picture to send.
 */
export async function ReportDocument({ report: original, hotel, preparedBy, preparedAt, number, eyebrow, signoff }: {
  report: Report; hotel: Hotel; preparedBy: string; preparedAt: string; number: string;
  /** The small word above the title on paper ("Report", "Shift report"). */
  eyebrow?: string;
  /** The lines to sign at the end (label, name already written) — default: prepared, checked, approved by the MD. */
  signoff?: [string, string][];
}) {
  // In the reader's language — the same figures (the report itself is kept as it was made).
  const t = await getT();
  const report = localizeReport(original, t);
  // Two half-width blocks side by side; the rest full width.
  const rows: Block[][] = [];
  for (const b of report.blocks) {
    const half = "half" in b && b.half;
    const last = rows.at(-1);
    if (half && last && last.length === 1 && "half" in last[0] && last[0].half) last.push(b);
    else rows.push([b]);
  }
  let no = 0;
  return (
    <article id="report" className="report-sheet group/report relative w-full overflow-hidden rounded-[28px] bg-white text-[#1d1a16] shadow-[0_2px_6px_rgba(15,23,42,0.05),0_40px_80px_-40px_rgba(0,0,0,0.7)] print:max-w-none print:rounded-none print:shadow-none"
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
      {/* Letterhead — only on paper (Print, PDF): on screen the page header already says what this is */}
      <header className="relative hidden overflow-hidden bg-[#15110c] px-6 pb-6 pt-6 text-white group-data-[paper=true]/report:block print:block sm:px-9 xl:px-12">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-[#c9a24a]/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 size-72 rounded-full bg-[#c9a24a]/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
              <Image src="/brand/logo-192.png" alt="" width={44} height={44} />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{hotel.name}</p>
              {hotel.tagline && <p className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[#f0cf86]/80">{hotel.tagline}</p>}
              <p className="mt-1.5 max-w-sm text-[11px] leading-relaxed text-white/55">{hotel.address}<br />{hotel.contact}</p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[#f0cf86]">{eyebrow ?? t("Report")}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{report.title}</h2>
            <p className="mt-1 text-sm text-white/80">{report.period}</p>
            <p className="mt-1 font-mono text-[10px] text-white/45">{number} · {t("prepared {at}", { at: preparedAt })}</p>
          </div>
        </div>
        <p className="relative mt-4 max-w-3xl text-xs leading-relaxed text-white/60">{report.blurb} {t("All amounts in TZS · hotel days run 04:00 → 04:00.")}</p>
      </header>
      <div className="hidden h-1 bg-linear-to-r from-[#8a6a25] via-[#f0cf86] to-[#8a6a25] group-data-[paper=true]/report:block print:block" />

      {/* Headline figures — every row full: up to 6 on a row, more in two even rows; a shorter last row stretches */}
      <section className="flex flex-wrap gap-px border-b border-[#eee4d2] bg-[#eee4d2]" data-break
        style={{ "--cols": report.figures.length <= 6 ? report.figures.length : Math.min(6, Math.ceil(report.figures.length / 2)) } as React.CSSProperties}>
        {report.figures.map((f) => <FigureCell key={f.label} f={f} t={t} />)}
      </section>

      {/* The report, part by part */}
      <div className="space-y-8 px-5 py-7 sm:px-9 xl:px-12">
        {rows.map((row, i) => (
          <div key={i} className={cn("grid gap-8", row.length === 2 && "md:grid-cols-2")}>
            {row.map((b, j) => {
              if (b.kind !== "note" && b.kind !== "section" && b.kind !== "list") no += 1;
              return <BlockView key={j} b={b} no={no} t={t} />;
            })}
          </div>
        ))}
      </div>

      {/* Sign-off */}
      <footer className="hidden border-t border-[#eee4d2] bg-[#fbf8f2] px-5 py-6 group-data-[paper=true]/report:block print:block sm:px-9 xl:px-12" data-break>
        <div className="grid gap-6 sm:grid-cols-3">
          {(signoff ?? [[t("Prepared by"), preparedBy], [t("Checked by"), ""], [t("Approved by (MD)"), ""]]).map(([k, v]) => (
            <div key={k}>
              <p className="h-6 truncate text-sm font-medium">{v}</p>
              <div className="border-b border-dashed border-[#b8a88a]" />
              <p className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-[#8c8173]">{k} · {t("date & signature")}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-[10px] text-[#8c8173]">{hotel.name} · {report.title} · {report.period} · {number} · {t("figures from the hotel system")}</p>
      </footer>
    </article>
  );
}

function FigureCell({ f, t }: { f: Figure; t: T }) {
  const good = f.delta == null ? null : f.invert ? f.delta <= 0 : f.delta >= 0;
  return (
    <div className="min-w-0 grow basis-[calc(50%_-_1px)] bg-white px-4 py-4 sm:basis-[calc(33.34%_-_1px)] lg:basis-[calc(100%/var(--cols)_-_1px)]">
      <p className="line-clamp-2 text-[10px] font-semibold uppercase leading-snug tracking-[0.12em] text-[#8c8173]">{f.label}</p>
      <p className={cn("mt-1 break-words text-[17px] font-semibold leading-tight tracking-tight tabular-nums", f.tone ? INK[f.tone] : "text-[#1d1a16]")}>{f.value}</p>
      <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-snug text-[#6f665b]">
        {f.delta != null && (
          <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums", good ? "bg-[#10b981]/12 text-[#047857]" : "bg-[#f43f5e]/12 text-[#be123c]")}>
            {f.delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(f.delta))}%
          </span>
        )}
        {f.sub && <span className="line-clamp-2">{f.sub}</span>}
        {f.delta != null && !f.sub && <span>{t("vs before")}</span>}
      </p>
    </div>
  );
}

function Heading({ no, title, subtitle }: { no: number; title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3 border-b border-[#eee4d2] pb-2">
      <span className="font-mono text-[11px] font-semibold text-[#b08a3a]">{String(no).padStart(2, "0")}</span>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-[#8c8173]">{subtitle}</p>}
      </div>
    </div>
  );
}

function BlockView({ b, no, t }: { b: Block; no: number; t: T }) {
  switch (b.kind) {
    case "section":
      return (
        <div className="break-after-avoid pt-2" data-break>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#b08a3a]">{t("Section")}</p>
          <h2 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">{b.title}</h2>
          {b.subtitle && <p className="mt-0.5 text-xs text-[#8c8173]">{b.subtitle}</p>}
          <div className="mt-2 h-px bg-linear-to-r from-[#c9a24a] via-[#eee4d2] to-transparent" />
        </div>
      );

    case "list":
      return (
        <section className={cn("min-w-0 break-inside-avoid rounded-2xl px-4 py-3.5", b.tone === "attention" ? "border border-[#f59e0b]/40 bg-[#fff8eb]" : "border border-[#eee4d2] bg-[#fbf8f2]")} data-break>
          <p className={cn("mb-2 text-[11px] font-semibold uppercase tracking-[0.16em]", b.tone === "attention" ? "text-[#b45309]" : "text-[#8a6a25]")}>{b.title}{b.tone === "attention" ? ` · ${b.items.length}` : ""}</p>
          <ul className="space-y-1.5 text-[13px] leading-snug">
            {b.items.map((x) => (
              <li key={x} className="flex gap-2.5"><span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", b.tone === "attention" ? "bg-[#f59e0b]" : "bg-[#c9a24a]")} /><span>{x}</span></li>
            ))}
          </ul>
        </section>
      );

    case "note":
      return <p className="flex gap-2 rounded-2xl bg-[#f6f1e7] px-4 py-3 text-[11px] leading-relaxed text-[#6f665b]" data-break><Info className="mt-px size-3.5 shrink-0 text-[#b08a3a]" />{b.text}</p>;

    case "bars": {
      const max = Math.max(1, ...b.items.map((x) => Math.abs(x.value)));
      const total = b.items.reduce((t, x) => t + x.value, 0);
      const shown = b.items.filter((x) => x.value !== 0), zero = b.items.filter((x) => x.value === 0);
      return (
        <section className="min-w-0 break-inside-avoid" data-break>
          <Heading no={no} title={b.title} subtitle={b.subtitle} />
          {shown.length === 0 ? <Empty text={b.empty ?? t("Nothing in this period.")} /> : (
            <ul className="space-y-2.5">
              {shown.map((x) => (
                <li key={x.label} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ background: x.color ?? "#c9a24a" }} /><span className="truncate">{x.label}</span>{x.sub && <span className="hidden shrink-0 text-[11px] text-[#8c8173] sm:inline">{x.sub}</span>}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{b.money ? money(x.value) : n(x.value)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f1ebdf]"><div className="h-full rounded-full" style={{ width: `${(Math.max(0, x.value) / max) * 100}%`, background: x.color ?? "#c9a24a" }} /></div>
                  {x.sub && <p className="mt-0.5 text-[10px] text-[#8c8173] sm:hidden">{x.sub}</p>}
                </li>
              ))}
              {shown.length > 1 && !b.noTotal && (
                <li className="flex justify-between border-t border-[#eee4d2] pt-2 text-[13px] font-semibold"><span>{t("Total")}</span><span className="tabular-nums">{b.money ? money(total) : n(total)}</span></li>
              )}
              {zero.length > 0 && <li className="text-[11px] text-[#8c8173]">{t("Nothing from {list}.", { list: zero.map((x) => (t.locale === "en" ? x.label.toLowerCase() : x.label)).join(t.locale === "en" ? ", " : "、") })}</li>}
            </ul>
          )}
        </section>
      );
    }

    case "columns": {
      const totals = b.points.map((p) => p.parts.reduce((t, x) => t + x.value, 0));
      const max = Math.max(1, ...totals);
      const legend = b.points[0]?.parts ?? [];
      const every = b.points.length > 16 ? Math.ceil(b.points.length / 12) : 1;
      return (
        <section className="min-w-0 break-inside-avoid" data-break>
          <Heading no={no} title={b.title} subtitle={b.subtitle} />
          {b.points.length === 0 || totals.every((x) => x === 0) ? <Empty text={b.empty ?? t("Nothing in this period.")} /> : (
            <>
              <div className="relative">
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-[#e8dfcd]" />
                <p className="absolute -top-2 right-0 bg-white pl-1 text-[10px] tabular-nums text-[#8c8173]">{b.money ? money(max) : n(max)}</p>
                <div className="flex h-40 items-end gap-[3px] pt-3">
                  {b.points.map((p, i) => (
                    <div key={`${p.label}-${i}`} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${p.label}: ${p.parts.map((x) => `${x.name} ${b.money ? money(x.value) : n(x.value)}`).join(" · ")}`}>
                      <div className="flex flex-col-reverse overflow-hidden rounded-t-[5px]" style={{ height: `${(totals[i] / max) * 100}%` }}>
                        {p.parts.map((x) => x.value > 0 && <div key={x.name} style={{ height: `${(x.value / Math.max(1, totals[i])) * 100}%`, background: x.color }} />)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex gap-[3px] border-t border-[#e8dfcd] pt-1">
                  {b.points.map((p, i) => <span key={`${p.label}-${i}`} className="min-w-0 flex-1 truncate text-center text-[9px] tabular-nums text-[#8c8173]">{i % every === 0 ? p.label : ""}</span>)}
                </div>
              </div>
              {legend.length > 1 && (
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#6f665b]">
                  {legend.map((x) => (
                    <span key={x.name} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: x.color }} />{x.name} <strong className="font-semibold tabular-nums text-[#1d1a16]">{(() => { const sum = b.points.reduce((s, p) => s + (p.parts.find((y) => y.name === x.name)?.value ?? 0), 0); return b.money ? money(sum) : n(sum); })()}</strong></span>
                  ))}
                </p>
              )}
            </>
          )}
        </section>
      );
    }

    case "statement":
      return (
        <section className="min-w-0 break-inside-avoid" data-break>
          <Heading no={no} title={b.title} subtitle={b.subtitle} />
          <dl className="text-[13px]">
            {b.rows.map((r) => (
              <div key={r.label} className={cn("flex justify-between gap-4 py-1.5",
                r.style === "sub" && "border-t border-[#eee4d2] font-medium",
                r.style === "total" && "border-t border-[#d9ccb2] font-semibold",
                r.style === "grand" && "mt-1 border-t-2 border-double border-[#b8a88a] pt-2 text-[15px] font-bold",
                r.style === "grand" && (r.value >= 0 ? "text-[#047857]" : "text-[#be123c]"))}>
                <dt className={cn(!r.style && "text-[#5b534a]", r.style === "less" && "pl-3 text-[#8c8173]")}>{r.label}</dt>
                <dd className={cn("tabular-nums", r.style === "less" && "text-[#8c8173]")}>{money(r.value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      );

    case "highlights":
      return (
        <section className="min-w-0 break-inside-avoid" data-break>
          <Heading no={no} title={b.title} />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:[grid-template-columns:repeat(var(--n),minmax(0,1fr))]" style={{ "--n": b.items.length > 6 ? 4 : b.items.length } as React.CSSProperties}>
            {b.items.map((x) => (
              <div key={x.label} className="min-w-0 rounded-2xl border border-[#eee4d2] bg-[#fbf8f2] px-3.5 py-3">
                <p className="truncate text-[10px] uppercase tracking-[0.12em] text-[#8c8173]">{x.label}</p>
                <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">{x.value}</p>
                {x.sub && <p className="mt-0.5 line-clamp-2 text-[11px] text-[#6f665b]">{x.sub}</p>}
              </div>
            ))}
          </div>
        </section>
      );

    case "table":
      return (
        <section className="min-w-0" data-break>
          <Heading no={no} title={b.title} subtitle={b.subtitle} />
          {b.rows.length === 0 ? <Empty text={b.empty ?? t("Nothing in this period.")} /> : (
            <div className="report-scroll -mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-max border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-[#d9ccb2]">
                    {b.columns.map((c) => <th key={c.label} className={cn("whitespace-nowrap px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8c8173] first:pl-0 last:pr-0", c.align === "right" ? "text-right" : "text-left")}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, i) => (
                    <tr key={i} className="break-inside-avoid border-b border-[#f1ebdf] even:bg-[#fcfaf6]" data-break>
                      {r.map((v, j) => <td key={j} className={cellClass(b.columns[j])}>{fmt(v, b.columns[j])}</td>)}
                    </tr>
                  ))}
                </tbody>
                {b.foot && (
                  <tfoot>
                    <tr className="border-t-2 border-[#d9ccb2] font-semibold">
                      {b.foot.map((v, j) => <td key={j} className={cn(cellClass(b.columns[j]), "pt-2 text-[#1d1a16]")}>{fmt(v, b.columns[j])}</td>)}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          {!!b.more && <p className="mt-2 text-[11px] text-[#8c8173]">{t("…and {n} more ({note}).", { n: n(b.more), note: b.moreNote ?? t("the CSV has every line") })}</p>}
        </section>
      );
  }
}

const cellClass = (c?: Column) => cn("whitespace-nowrap px-2 py-1.5 align-top first:pl-0 last:pr-0", c?.align === "right" && "text-right tabular-nums", c?.muted && "text-[#8c8173]");
const fmt = (v: Cell, c?: Column) => (v == null || v === "" ? (v === "" ? "" : "—") : typeof v === "number" ? (c?.money ? money(v) : n(v)) : v);

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-[#e3d8c4] px-4 py-6 text-center text-[13px] text-[#8c8173]">{text}</p>;
}
