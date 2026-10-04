"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Check, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEVEL_META, formatQty, type StockLevel } from "@/lib/inventory";
import { formatShortDate } from "@/lib/format";
import type { InventoryRow } from "@/server/services/inventory";
import { clearExpiryAction } from "./actions";
import { ItemSheet, type Perms } from "./item-sheet";
import type { Setup } from "./item-form";
import { useRun } from "./ui";

type Expiring = { id: string; item: { id: string; name: string; unit: string; quantity: number; department: { name: string } }; received: number; expiresOn: string; expired: boolean };

/** What needs doing in the stores — tap an item to act on it (receive, count, report waste). */
export function AlertsPanel({ items, expiring, pendingWaste, wasteHref, perms, setup }: { items: InventoryRow[]; expiring: Expiring[]; pendingWaste: number; wasteHref: string; perms: Perms; setup: Setup }) {
  const [open, setOpen] = useState<string | null>(null);
  const { pending, run } = useRun();
  const by = (l: StockLevel) => items.filter((i) => i.isActive && i.level === l);
  const groups: { level: StockLevel; rows: InventoryRow[]; why: (i: InventoryRow) => string }[] = [
    { level: "OUT", rows: by("OUT"), why: () => "nothing left" },
    { level: "LOW", rows: by("LOW"), why: (i) => `minimum ${formatQty(i.minStock ?? 0, i.unit)}` },
    { level: "REORDER", rows: by("REORDER"), why: (i) => `reorder at ${formatQty(i.reorderLevel ?? 0, i.unit)}` },
    { level: "OVER", rows: by("OVER"), why: (i) => `maximum ${formatQty(i.maxStock ?? 0, i.unit)}` },
  ];
  const total = groups.reduce((t, g) => t + g.rows.length, 0) + expiring.length + (pendingWaste ? 1 : 0);
  const current = open ? items.find((i) => i.id === open) : null;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <p className="flex items-center gap-2 border-b border-border/70 px-4 py-3 text-sm font-semibold">
        <AlertTriangle className={cn("size-4", total ? "text-amber-500" : "text-emerald-500")} />Needs attention<span className="font-normal text-muted-foreground">· {total || "all good"}</span>
      </p>
      {total === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Every item is between its minimum and maximum.</p>}
      <ul className="divide-y divide-border/50">
        {pendingWaste > 0 && (
          <li><Link href={wasteHref} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40">
            <span className="grid size-8 place-items-center rounded-xl bg-amber-500/15 text-amber-600"><Trash2 className="size-4" /></span>
            <span className="min-w-0 flex-1 text-sm font-medium">Waste waiting for approval<span className="block text-[11px] font-normal text-muted-foreground">{pendingWaste} report{pendingWaste === 1 ? "" : "s"} — the stock drops when approved</span></span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link></li>
        )}
        {groups.flatMap((g) => g.rows.map((i) => (
          <li key={i.id}><button type="button" onClick={() => setOpen(i.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40">
            <span className={cn("size-2.5 shrink-0 rounded-full", LEVEL_META[g.level].dot)} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{i.name}</span><span className="block truncate text-[11px] text-muted-foreground">{LEVEL_META[g.level].label} · {g.why(i)} · {i.department.name}</span></span>
            <span className={cn("shrink-0 text-sm font-semibold tabular-nums", g.level === "OUT" ? "text-rose-600 dark:text-rose-400" : g.level === "LOW" ? "text-amber-600 dark:text-amber-400" : "")}>{formatQty(i.quantity, i.unit)}</span>
          </button></li>
        )))}
        {expiring.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", e.expired ? "bg-rose-500/12 text-rose-600" : "bg-amber-500/15 text-amber-600")}><CalendarClock className="size-4" /></span>
            <button type="button" onClick={() => setOpen(e.item.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium">{e.item.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{e.expired ? "Expired" : "Expires"} {formatShortDate(e.expiresOn)} · delivery of {formatQty(e.received, e.item.unit)} · {e.item.department.name}</span>
            </button>
            {(perms.use || perms.approve) && (
              <button type="button" disabled={pending} onClick={() => run(() => clearExpiryAction({ id: e.id }))} title="Used up or thrown away" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-semibold hover:bg-muted"><Check className="size-3.5" />Dealt with</button>
            )}
          </li>
        ))}
      </ul>
      {current && <ItemSheet item={current} perms={perms} setup={setup} onClose={() => setOpen(null)} initial={current.level === "OVER" ? "history" : perms.receive ? "receive" : "history"} />}
    </section>
  );
}
