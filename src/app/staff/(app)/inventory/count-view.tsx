"use client";

import { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { COUNT_REASONS, formatQty, round3, unitOf } from "@/lib/inventory";
import type { InventoryRow } from "@/server/services/inventory";
import { countStockAction } from "./actions";
import { GoldButton, field, num, tzs, useRun } from "./ui";
import { useT } from "@/i18n/client";

type Line = { counted: string; reason: string; note: string };

/**
 * Physical count (manager / MD): type what is really on the shelf; the difference is worked out and
 * needs a reason. Items left blank are not changed. Every correction is audited.
 */
export function CountView({ items }: { items: InventoryRow[] }) {
  const t = useT();
  const { pending, run } = useRun();
  const [lines, setLines] = useState<Record<string, Line>>({});
  const active = items.filter((i) => i.isActive);
  const blank: Line = { counted: "", reason: "", note: "" };
  const set = (id: string, patch: Partial<Line>) => setLines((x) => ({ ...x, [id]: { ...blank, ...x[id], ...patch } }));
  const diffs = useMemo(() => active.map((i) => {
    const l = lines[i.id]; const c = l ? num(l.counted) : null;
    return { i, l, diff: c == null || !Number.isFinite(c) ? null : round3(c - i.quantity) };
  }), [active, lines]);
  const changed = diffs.filter((d) => d.diff != null && d.diff !== 0);
  const missing = changed.filter((d) => !d.l?.reason || (d.l.reason === "OTHER" && !d.l.note.trim()));
  const valueDiff = changed.reduce((sum, d) => sum + (d.diff ?? 0) * d.i.costPerUnit, 0);
  const entered = diffs.filter((d) => d.diff != null).length;
  const go = () => run(() => countStockAction({ lines: diffs.filter((d) => d.diff != null).map((d) => ({ itemId: d.i.id, counted: num(d.l!.counted)!, reason: d.l!.reason || null, note: d.l!.note || null })) }),
    (r) => (r.corrected ? t.plural(r.corrected, "Count saved — {n} item corrected.", "Count saved — {n} items corrected.") : t("Count saved — everything matched.")), () => setLines({}));

  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="size-4 text-[oklch(0.7_0.12_78)]" />{t("Stock count")}<span className="font-normal text-muted-foreground">· {t("type what is on the shelf; blanks stay as they are")}</span></p>
        <p className="text-xs text-muted-foreground">{t("{counted} counted · {different} different", { counted: entered, different: changed.length })}{changed.length ? ` · ${valueDiff >= 0 ? "+" : "−"}${tzs(Math.abs(valueDiff))}` : ""}</p>
      </div>
      <ul className="divide-y divide-border/50">
        {diffs.map(({ i, l, diff }) => (
          <li key={i.id} className={cn("grid gap-2 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_9rem_7rem] sm:items-center", diff != null && diff !== 0 && "bg-amber-500/[0.04]")}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{i.name}</p>
              <p className="text-[11px] text-muted-foreground">{t("System says {qty}", { qty: formatQty(i.quantity, i.unit, t) })}{i.location ? ` · ${t(i.location)}` : ""}</p>
            </div>
            <div className="relative">
              <input inputMode="decimal" value={l?.counted ?? ""} onChange={(e) => set(i.id, { counted: e.target.value.replace(/[^\d.]/g, "") })} placeholder={t("Counted")} aria-label={t("Counted {item}", { item: i.name })} className={cn(field, "h-9 pr-14 tabular-nums")} />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-muted-foreground">{t(unitOf(i.unit).plural)}</span>
            </div>
            <p className={cn("text-right text-sm font-semibold tabular-nums", diff == null ? "text-muted-foreground/50" : diff === 0 ? "text-emerald-600 dark:text-emerald-400" : diff < 0 ? "text-rose-600 dark:text-rose-400" : "text-sky-600 dark:text-sky-400")}>
              {diff == null ? "—" : diff === 0 ? t("Matches") : `${diff > 0 ? "+" : "−"}${formatQty(Math.abs(diff), i.unit, t)}`}
            </p>
            {diff != null && diff !== 0 && (
              <div className="flex flex-wrap gap-1.5 sm:col-span-3">
                {COUNT_REASONS.map((r) => (
                  <button key={r.code} type="button" onClick={() => set(i.id, { reason: r.code })} aria-pressed={l?.reason === r.code}
                    className={cn("h-7 rounded-lg border px-2.5 text-[11px] font-semibold", l?.reason === r.code ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.75_0.12_80/0.18)]" : "border-border/70 hover:bg-muted")}>{t(r.label)}</button>
                ))}
                <input value={l?.note ?? ""} onChange={(e) => set(i.id, { note: e.target.value })} placeholder={l?.reason === "OTHER" ? t("Describe (required)") : t("Note (optional)")} className={cn(field, "h-7 min-w-40 flex-1 text-xs")} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-card/95 px-4 py-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">{missing.length ? t.plural(missing.length, "Give a reason for {n} difference.", "Give a reason for {n} differences.") : t("Differences are recorded with your name, the reason and the time.")}</p>
        <GoldButton pending={pending} disabled={!entered || missing.length > 0} onClick={go}>{t("Save count")}{changed.length ? ` · ${t.plural(changed.length, "{n} correction", "{n} corrections")}` : ""}</GoldButton>
      </div>
    </section>
  );
}
