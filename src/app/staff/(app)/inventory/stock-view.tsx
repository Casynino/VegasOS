"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, Search, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LEVEL_META, formatQty, type StockLevel } from "@/lib/inventory";
import type { InventoryRow } from "@/server/services/inventory";
import { ItemSheet, type Perms, type Tab } from "./item-sheet";
import type { Setup } from "./item-form";
import { field, tzs } from "./ui";

const LEVEL_ORDER: StockLevel[] = ["OUT", "LOW", "REORDER", "OVER", "OK"];

/** The stock, by category: level at a glance; tap an item to receive, use, report waste, move or see its history. */
export function StockView({ items, perms, setup, showDepartment }: { items: InventoryRow[]; perms: Perms; setup: Setup; showDepartment: boolean }) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<StockLevel | "ALL">("ALL");
  const [open, setOpen] = useState<{ id: string; tab?: Tab } | null>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((i) => (level === "ALL" || i.level === level) && (!t || `${i.name} ${i.sku ?? ""} ${i.category.name} ${i.location ?? ""}`.toLowerCase().includes(t)));
  }, [items, q, level]);
  const groups = useMemo(() => {
    const m = new Map<string, InventoryRow[]>();
    for (const i of shown) m.set(i.category.name, [...(m.get(i.category.name) ?? []), i]);
    // Categories in the order the MD set (Kitchen food, Beverages, Housekeeping…).
    const order = new Map(setup.categories.map((c, i) => [c.name, i]));
    return [...m.entries()].sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }, [shown, setup.categories]);
  const counts = useMemo(() => Object.fromEntries(LEVEL_ORDER.map((l) => [l, items.filter((i) => i.level === l).length])) as Record<StockLevel, number>, [items]);
  const current = open ? items.find((i) => i.id === open.id) ?? null : null;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3 sm:px-4">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item…" className={cn(field, "pl-9")} />
        </div>
        <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
          <LevelChip on={level === "ALL"} onClick={() => setLevel("ALL")} label="All" count={items.length} />
          {LEVEL_ORDER.filter((l) => counts[l] > 0).map((l) => <LevelChip key={l} on={level === l} onClick={() => setLevel(l)} label={LEVEL_META[l].label} count={counts[l]} dot={LEVEL_META[l].dot} />)}
        </div>
      </div>
      {groups.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">{items.length ? "Nothing matches." : "No stock items here yet."}</p> : groups.map(([cat, rows]) => (
        <div key={cat}>
          <p className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>{cat} · {rows.length}</span><span className="tabular-nums normal-case tracking-normal">{tzs(rows.reduce((t, r) => t + r.value, 0))}</span>
          </p>
          <ul className="divide-y divide-border/50">
            {rows.map((i) => {
              const lv = LEVEL_META[i.level];
              const cap = Math.max(i.maxStock ?? 0, (i.minStock ?? 0) * 2, (i.reorderLevel ?? 0) * 1.5, i.quantity, 1);
              return (
                <li key={i.id} className={cn(!i.isActive && "opacity-50")}>
                  <div className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40">
                    <button type="button" onClick={() => setOpen({ id: i.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className={cn("size-2.5 shrink-0 rounded-full", lv.dot)} title={lv.label} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{i.name}{!i.isActive && " · off"}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {[showDepartment ? i.department.name : null, i.location, i.minStock != null ? `min ${formatQty(i.minStock, i.unit)}` : null, i.level !== "OK" ? lv.label : null].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      <span className="hidden w-28 shrink-0 sm:block">
                        <span className="relative block h-1.5 overflow-hidden rounded-full bg-muted">
                          <span className={cn("absolute inset-y-0 left-0 rounded-full", lv.bar)} style={{ width: `${Math.min(100, (Math.max(0, i.quantity) / cap) * 100)}%` }} />
                          {i.minStock != null && <span className="absolute inset-y-0 w-px bg-foreground/60" style={{ left: `${Math.min(100, (i.minStock / cap) * 100)}%` }} />}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={cn("block text-sm font-semibold tabular-nums", i.level === "OUT" && "text-rose-600 dark:text-rose-400", i.level === "LOW" && "text-amber-600 dark:text-amber-400")}>{formatQty(i.quantity, i.unit)}</span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">{tzs(i.value)}</span>
                      </span>
                    </button>
                    {i.isActive && (perms.receive || perms.use || perms.approve) && (
                      <span className="flex shrink-0 gap-1">
                        {perms.receive && <QuickBtn label={`Receive ${i.name}`} onClick={() => setOpen({ id: i.id, tab: "receive" })}><ArrowDownToLine /></QuickBtn>}
                        {(perms.use || perms.approve) && <QuickBtn label={`Waste ${i.name}`} onClick={() => setOpen({ id: i.id, tab: "waste" })}><Trash2 /></QuickBtn>}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {current && <ItemSheet key={current.id + (open?.tab ?? "")} item={current} perms={perms} setup={setup} initial={open?.tab} onClose={() => setOpen(null)} />}
    </section>
  );
}

function LevelChip({ on, onClick, label, count, dot }: { on: boolean; onClick: () => void; label: string; count: number; dot?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors", on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      {dot && <span className={cn("size-1.5 rounded-full", dot)} />}{label}<span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function QuickBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4">{children}</button>
  );
}

/** Header button: pick an item, then receive it. */
export function ReceivePicker({ items, perms, setup }: { items: InventoryRow[]; perms: Perms; setup: Setup }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const t = q.trim().toLowerCase();
  const list = items.filter((i) => i.isActive && (!t || i.name.toLowerCase().includes(t))).slice(0, 40);
  const item = picked ? items.find((i) => i.id === picked) : null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-3 text-sm font-semibold text-[oklch(0.2_0.03_60)] hover:brightness-105"><ArrowDownToLine className="size-4" />Receive stock</button>
      {open && !item && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-h-[calc(100svh-1.5rem)] overflow-y-auto sm:max-w-md">
            <DialogHeader icon={<ArrowDownToLine />} eyebrow="Stock" tone="amber">
              <DialogTitle>Receive stock</DialogTitle>
              <DialogDescription>Which item came in?</DialogDescription>
            </DialogHeader>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Beef, water, soap…" className={field} />
            <ul className="max-h-80 divide-y divide-border/50 overflow-y-auto">
              {list.map((i) => (
                <li key={i.id}><button type="button" onClick={() => setPicked(i.id)} className="flex w-full items-center justify-between gap-3 px-1 py-2 text-left text-sm hover:bg-muted/50">
                  <span className="min-w-0"><span className="block truncate font-medium">{i.name}</span><span className="text-[11px] text-muted-foreground">{i.department.name}</span></span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatQty(i.quantity, i.unit)}</span>
                </button></li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      )}
      {item && <ItemSheet item={item} perms={perms} setup={setup} initial="receive" onClose={() => { setPicked(null); setOpen(false); setQ(""); }} />}
    </>
  );
}
