"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, History, Loader2, MinusCircle, Package, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { KIND_LABEL, LEVEL_META, PURCHASE_REASON, USE_REASONS, WASTE_REASONS, formatQty, reasonLabel, round3, unitOf, usageReasonFor, type MovementKind } from "@/lib/inventory";
import type { InventoryRow, MovementRow } from "@/server/services/inventory";
import { itemDetailAction, receiveStockAction, reportWasteAction, transferStockAction, takeStockAction } from "./actions";
import { Chip, GoldButton, Label, field, num, tzs, useRun } from "./ui";
import { ItemForm, type Setup } from "./item-form";

export type Perms = { receive: boolean; use: boolean; approve: boolean; manage: boolean };
export type Tab = "receive" | "use" | "waste" | "transfer" | "edit" | "history";

/** One stock item: its level, what can be done with it (by role) and its history. */
export function ItemSheet({ item, perms, setup, onClose, initial }: { item: InventoryRow; perms: Perms; setup: Setup; onClose: () => void; initial?: Tab }) {
  const tabs: { key: Tab; label: string; icon: typeof History; show: boolean }[] = [
    { key: "receive", label: "Receive", icon: ArrowDownToLine, show: perms.receive },
    { key: "use", label: "Use", icon: MinusCircle, show: perms.use || perms.approve },
    { key: "waste", label: "Waste", icon: Trash2, show: perms.use || perms.approve },
    { key: "transfer", label: "Transfer", icon: ArrowRightLeft, show: perms.approve },
    { key: "history", label: "History", icon: History, show: true },
    { key: "edit", label: "Edit", icon: Pencil, show: perms.manage },
  ];
  const shown = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(initial && shown.some((t) => t.key === initial) ? initial : shown[0]?.key ?? "history");
  const lv = LEVEL_META[item.level];
  const cap = Math.max(item.maxStock ?? 0, (item.minStock ?? 0) * 2, (item.reorderLevel ?? 0) * 1.5, item.quantity, 1);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100svh-1.5rem)] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out.
            The tile sits at the top so the stock level below can run the band's full width. */}
        <DialogHeader icon={<Package />} eyebrow={`${item.department.name} · ${item.category.name}${item.sku ? ` · ${item.sku}` : ""}`} tone="amber" className="mx-0 mt-0 [&>div:last-child]:items-start">
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription className="sr-only">Stock level, actions and history</DialogDescription>
          {/* Pulled back under the tile (size-11 / sm:size-12 + gap-3.5) and over the close button's room (pr-8). */}
          <div className="relative -mr-8 -ml-[3.625rem] sm:-ml-[3.875rem]">
            {/* `dark`: on the dark band the level chip takes its night-mode colours. */}
            <div className="dark mt-2 flex items-end justify-between gap-3">
              <p className="text-3xl font-semibold tabular-nums tracking-tight">{formatQty(item.quantity, item.unit)}</p>
              <span className={cn("mb-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", lv.chip)}><span className={cn("size-1.5 rounded-full", lv.dot)} />{lv.label}</span>
            </div>
            <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-white/12">
              <span className={cn("absolute inset-y-0 left-0 rounded-full", lv.bar)} style={{ width: `${Math.min(100, (Math.max(0, item.quantity) / cap) * 100)}%` }} />
              {item.minStock != null && <span className="absolute inset-y-0 w-0.5 bg-white/60" style={{ left: `${Math.min(100, (item.minStock / cap) * 100)}%` }} title="Minimum" />}
            </div>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/60">
              {item.minStock != null && <span>Minimum {formatQty(item.minStock, item.unit)}</span>}
              {item.reorderLevel != null && <span>Reorder at {formatQty(item.reorderLevel, item.unit)}</span>}
              {item.maxStock != null && <span>Maximum {formatQty(item.maxStock, item.unit)}</span>}
              <span>{tzs(item.costPerUnit)} / {unitOf(item.unit).label}</span>
              <span>Worth {tzs(item.value)}</span>
              {item.location && <span>At {item.location}</span>}
              {item.supplier && <span>From {item.supplier.name}</span>}
            </p>
          </div>
        </DialogHeader>
        <div className="-mx-px overflow-x-auto border-b border-border/70 px-4 py-2 [scrollbar-width:none]">
          <div className="flex w-max gap-1">
            {shown.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors", tab === t.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <t.icon className="size-3.5" />{t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          {!item.isActive && tab !== "edit" && tab !== "history" ? <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">This item is switched off. The MD can switch it on under Edit.</p> : (
            <>
              {tab === "receive" && <ReceiveForm item={item} setup={setup} onDone={onClose} />}
              {tab === "use" && <UseForm item={item} onDone={onClose} />}
              {tab === "waste" && <WasteForm item={item} approver={perms.approve} onDone={onClose} />}
              {tab === "transfer" && <TransferForm item={item} setup={setup} onDone={onClose} />}
            </>
          )}
          {tab === "history" && <ItemHistory id={item.id} />}
          {tab === "edit" && <ItemForm setup={setup} item={item} onDone={onClose} inline />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Preview({ before, change, unit, label }: { before: number; change: number; unit: string; label: string }) {
  const after = round3(before + change);
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/60 text-center">
      {([["Now", formatQty(before, unit), ""], [label, `${change >= 0 ? "+" : "−"}${formatQty(Math.abs(change), unit)}`, change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"], ["Becomes", formatQty(after, unit), after < 0 ? "text-rose-600" : ""]] as const).map(([k, v, c]) => (
        <div key={k} className="bg-card px-2 py-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p><p className={cn("truncate text-sm font-semibold tabular-nums", c)}>{v}</p></div>
      ))}
    </div>
  );
}

function QtyInput({ unit, value, onChange, autoFocus }: { unit: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <input inputMode="decimal" autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={cn(field, "pr-20 text-base font-semibold tabular-nums")} />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unitOf(unit).plural}</span>
    </div>
  );
}

function ReceiveForm({ item, setup, onDone }: { item: InventoryRow; setup: Setup; onDone: () => void }) {
  const { pending, run } = useRun();
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState(item.costPerUnit ? String(item.costPerUnit) : "");
  const [supplierId, setSupplierId] = useState(item.supplier?.id ?? "");
  const [reference, setReference] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [note, setNote] = useState("");
  const q = num(qty) ?? 0, c = num(cost) ?? 0;
  const go = () => run(() => receiveStockAction({ itemId: item.id, quantity: q, unitCost: c || null, supplierId, reference, expiresOn: expiresOn || null, note }), (d) => d.message, onDone);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Received"><QtyInput unit={item.unit} value={qty} onChange={setQty} autoFocus /></Label>
        <Label label={`Cost per ${unitOf(item.unit).label}`} hint="TZS"><input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ""))} className={field} /></Label>
        <Label label="Supplier">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={field}>
            <option value="">—</option>
            {setup.suppliers.filter((s) => s.isActive || s.id === supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Label>
        <Label label="Delivery note / invoice"><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" className={field} /></Label>
        <Label label="Expires on" hint={item.tracksExpiry ? "required" : "optional"}><input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className={field} /></Label>
        <Label label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={field} /></Label>
      </div>
      {q > 0 && <Preview before={item.quantity} change={q} unit={item.unit} label="Received" />}
      <GoldButton pending={pending} disabled={q <= 0 || (item.tracksExpiry && !expiresOn)} onClick={go} className="w-full">
        Receive {q > 0 ? formatQty(q, item.unit) : ""}{q > 0 && c > 0 ? ` · ${tzs(q * c)}` : ""}
      </GoldButton>
    </div>
  );
}

function UseForm({ item, onDone }: { item: InventoryRow; onDone: () => void }) {
  const { pending, run } = useRun();
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(usageReasonFor(item.department.code));
  const [note, setNote] = useState("");
  const q = num(qty) ?? 0;
  const go = () => run(() => takeStockAction({ itemId: item.id, quantity: q, reason, note }), (d) => d.message, onDone);
  return (
    <div className="space-y-3">
      <Label label="Used"><QtyInput unit={item.unit} value={qty} onChange={setQty} autoFocus /></Label>
      <div className="flex flex-wrap gap-1.5">{USE_REASONS.filter((r) => r.code !== "TRANSFER").map((r) => <Chip key={r.code} on={reason === r.code} onClick={() => setReason(r.code)}>{r.label}</Chip>)}</div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. for tonight's buffet" className={field} />
      {q > 0 && <Preview before={item.quantity} change={-q} unit={item.unit} label="Used" />}
      <GoldButton pending={pending} disabled={q <= 0 || q > item.quantity} onClick={go} className="w-full">{q > item.quantity ? `Only ${formatQty(item.quantity, item.unit)} on the books` : `Take out ${q > 0 ? formatQty(q, item.unit) : ""}`}</GoldButton>
    </div>
  );
}

function WasteForm({ item, approver, onDone }: { item: InventoryRow; approver: boolean; onDone: () => void }) {
  const { pending, run } = useRun();
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<string>("SPOILED");
  const [note, setNote] = useState("");
  const q = num(qty) ?? 0;
  const go = () => run(() => reportWasteAction({ itemId: item.id, quantity: q, reason, note }), (d) => d.message, onDone);
  return (
    <div className="space-y-3">
      <Label label="Wasted"><QtyInput unit={item.unit} value={qty} onChange={setQty} autoFocus /></Label>
      <div className="flex flex-wrap gap-1.5">{WASTE_REASONS.map((r) => <Chip key={r.code} tone="rose" on={reason === r.code} onClick={() => setReason(r.code)}>{r.label}</Chip>)}</div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened? e.g. fridge off overnight" className={field} />
      {q > 0 && <Preview before={item.quantity} change={-q} unit={item.unit} label="Waste" />}
      {!approver && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">A manager approves waste — the stock drops once it is approved.</p>}
      <GoldButton pending={pending} disabled={q <= 0 || q > item.quantity} onClick={go} className="w-full">{approver ? "Record waste" : "Send to the manager"}</GoldButton>
    </div>
  );
}

function TransferForm({ item, setup, onDone }: { item: InventoryRow; setup: Setup; onDone: () => void }) {
  const { pending, run } = useRun();
  const others = setup.departments.filter((d) => d.isActive && d.id !== item.department.id);
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const q = num(qty) ?? 0;
  const go = () => run(() => transferStockAction({ itemId: item.id, toDepartmentId: to, quantity: q, note }), (d) => d.message, onDone);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Move"><QtyInput unit={item.unit} value={qty} onChange={setQty} autoFocus /></Label>
        <Label label={`From ${item.department.name} to`}>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={field}>{others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </Label>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={field} />
      {q > 0 && <Preview before={item.quantity} change={-q} unit={item.unit} label="Moved out" />}
      <GoldButton pending={pending} disabled={q <= 0 || !to || q > item.quantity} onClick={go} className="w-full">Move {q > 0 ? formatQty(q, item.unit) : ""} to {others.find((d) => d.id === to)?.name ?? "…"}</GoldButton>
    </div>
  );
}

function ItemHistory({ id }: { id: string }) {
  const [data, setData] = useState<{ moves: MovementRow[]; recipes: { dish: string; qty: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { itemDetailAction({ id }).then((r) => (r.ok ? setData(r.data) : setError(r.error))); }, [id]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</p>;
  return (
    <div className="space-y-4">
      {data.recipes.length > 0 && (
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">Used in {data.recipes.map((r) => `${r.dish} (${r.qty})`).join(", ")} — taken off when the dish is ready.</p>
      )}
      {data.moves.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : <MovementList rows={data.moves} compact />}
    </div>
  );
}

/** A list of stock movements (also used on the page). */
export function MovementList({ rows, compact }: { rows: MovementRow[]; compact?: boolean }) {
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((m) => {
        const plus = m.change > 0;
        // Received at a stock purchase's final approval: the reference holds "P-… · SR-…".
        const bought = m.kind === "RECEIVE" && m.reason === PURCHASE_REASON;
        const purchase = bought ? m.reference?.match(/\bP-\d{4}-\d+/)?.[0] : null;
        const request = bought ? m.reference?.match(/\bSR-\d{4}-\d+/)?.[0] : null;
        const why = bought ? `Bought — purchase${purchase ? ` ${purchase}` : ""}` : reasonLabel(m.reason);
        const ref = bought ? (request ? `request ${request}` : null) : m.reference;
        return (
          <li key={m.id} className="flex items-start gap-3 py-2.5">
            <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl text-[11px] font-bold",
              m.status === "PENDING" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : m.status === "REJECTED" ? "bg-muted text-muted-foreground" : plus ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300")}>
              {plus ? "+" : "−"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="truncate text-sm font-medium">{compact ? KIND_LABEL[m.kind as MovementKind] ?? m.kind : m.item.name}</span>
                <span className={cn("text-sm font-semibold tabular-nums", m.status !== "POSTED" ? "text-muted-foreground" : plus ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                  {plus ? "+" : "−"}{formatQty(Math.abs(m.change), m.unit)}
                </span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {compact || bought || KIND_LABEL[m.kind as MovementKind] === why ? why : `${KIND_LABEL[m.kind as MovementKind] ?? m.kind} · ${why}`} · {m.where}
                {m.before != null && m.after != null && <> · {formatQty(m.before, m.unit)} → {formatQty(m.after, m.unit)}</>}
                {m.totalCost ? ` · ${tzs(m.totalCost)}` : ""}
              </p>
              {(m.note || m.supplier || ref) && <p className="truncate text-xs text-muted-foreground">{[m.supplier, ref, m.note].filter(Boolean).join(" · ")}</p>}
              <p className="text-[11px] text-muted-foreground/80">
                {formatDateTime(m.at)} · {m.by}{m.byRole ? ` (${m.byRole})` : ""}
                {m.status === "PENDING" && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-px font-semibold text-amber-700 dark:text-amber-300">waiting for approval</span>}
                {m.status === "REJECTED" && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px font-semibold">rejected by {m.approvedBy}{m.decisionNote ? ` — ${m.decisionNote}` : ""}</span>}
                {m.status === "POSTED" && (m.kind === "WASTE" || m.kind === "RECEIVE") && m.approvedBy && <span> · {bought ? "final approval by" : "approved by"} {m.approvedBy}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
