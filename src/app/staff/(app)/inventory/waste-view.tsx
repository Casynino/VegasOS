"use client";

import { useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { formatQty, reasonLabel } from "@/lib/inventory";
import type { MovementRow } from "@/server/services/inventory";
import { decideWasteAction } from "./actions";
import { MovementList } from "./item-sheet";
import { field, tzs, useRun } from "./ui";
import { useT } from "@/i18n/client";

/** Waste waiting for a manager (approve → the stock drops; reject → nothing changes), then the recent decisions. */
export function WasteView({ pending, recent, approver }: { pending: MovementRow[]; recent: MovementRow[]; approver: boolean }) {
  const t = useT();
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="overflow-hidden rounded-3xl border border-amber-500/30 bg-card">
        <p className="flex items-center gap-2 border-b border-border/70 px-4 py-3 text-sm font-semibold"><Trash2 className="size-4 text-amber-500" />{t("Waiting for approval")} · {pending.length}
          {pending.length > 0 && <span className="ml-auto text-xs font-normal text-muted-foreground">{tzs(pending.reduce((sum, m) => sum + (m.totalCost ?? 0), 0))}</span>}
        </p>
        {pending.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("No waste waiting.")}</p> : (
          <ul className="divide-y divide-border/60">{pending.map((m) => <PendingRow key={m.id} m={m} approver={approver} />)}</ul>
        )}
      </section>
      <section className="rounded-3xl border border-border/70 bg-card px-4 py-3">
        <p className="mb-1 text-sm font-semibold">{t("Recent waste")}</p>
        {recent.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("Nothing wasted recently.")}</p> : <MovementList rows={recent} />}
      </section>
    </div>
  );
}

function PendingRow({ m, approver }: { m: MovementRow; approver: boolean }) {
  const t = useT();
  const { pending, run } = useRun();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{m.item.name} · <span className="text-rose-600 dark:text-rose-400">{formatQty(-m.change, m.unit, t)}</span></p>
          <p className="text-xs text-muted-foreground">{t(reasonLabel(m.reason))}{m.note ? ` — ${m.note}` : ""} · {t(m.where)}{m.totalCost ? ` · ${tzs(m.totalCost)}` : ""}</p>
          <p className="text-[11px] text-muted-foreground/80">{t("Reported by {name}", { name: m.by === "System" ? t("System") : m.by })}{m.byRole ? ` (${t(m.byRole)})` : ""} · {t.dateTime(m.at)}</p>
        </div>
        {approver && !rejecting && (
          <div className="flex shrink-0 gap-1.5">
            <button type="button" disabled={pending} onClick={() => run(() => decideWasteAction({ id: m.id, approve: true }), (d) => d.message)}
              className="inline-flex h-9 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Check className="size-3.5" />{t("Approve")}</button>
            <button type="button" disabled={pending} onClick={() => setRejecting(true)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted"><X className="size-3.5" />{t("Reject")}</button>
          </div>
        )}
      </div>
      {rejecting && (
        <div className="mt-2 flex gap-2">
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Why? e.g. it was used, not wasted")} className={field} />
          <button type="button" disabled={pending || !note.trim()} onClick={() => run(() => decideWasteAction({ id: m.id, approve: false, note }), (d) => d.message)}
            className="h-10 shrink-0 rounded-xl bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50">{t("Reject")}</button>
          <button type="button" onClick={() => setRejecting(false)} className="h-10 shrink-0 rounded-xl border border-border px-3 text-xs">{t("Back")}</button>
        </div>
      )}
    </li>
  );
}
