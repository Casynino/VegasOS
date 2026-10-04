"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, History, Loader2, MapPin, MoveRight, Pencil, Plus, Search, Sofa, Wrench } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDateTime, formatShortDate } from "@/lib/format";
import { ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_STATUSES } from "@/lib/inventory";
import { assetHistoryAction, assetStateAction, moveAssetAction, saveAssetAction } from "../inventory/actions";
import { Chip, GoldButton, Label, field, num, tzs, useRun } from "../inventory/ui";

export type AssetRow = {
  id: string; code: string; name: string; category: string; location: string | null; quantity: number; purchaseDate: string | null; purchaseCost: number | null;
  condition: string; status: string; serialNumber: string | null; assignedTo: string | null; notes: string | null;
  department: { id: string; name: string } | null; supplier: { id: string; name: string } | null;
};
type Opts = { departments: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; locations: string[]; categories: string[] };
type Perms = { manage: boolean; move: boolean };

const STATUS = new Map<string, (typeof ASSET_STATUSES)[number]>(ASSET_STATUSES.map((s) => [s.code, s]));
const COND = new Map<string, string>(ASSET_CONDITIONS.map((c) => [c.code, c.label]));
const condTone = (c: string) => (c === "DAMAGED" || c === "POOR" ? "text-rose-600 dark:text-rose-400" : c === "FAIR" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground");
const KIND: Record<string, string> = { MOVED: "Moved", CONDITION: "Condition", STATUS: "Status", ASSIGNED: "Assigned to" };
const label = (kind: string, v: string | null) => (v == null ? "—" : kind === "CONDITION" ? COND.get(v) ?? v : kind === "STATUS" ? STATUS.get(v)?.label ?? v : v);

/** The asset register: by category, with where each thing is, its condition and status; tap one to move it or update it. */
export function AssetsView({ assets, opts, perms }: { assets: AssetRow[]; opts: Opts; perms: Perms }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("ACTIVE");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const t = q.trim().toLowerCase();
  const shown = useMemo(() => assets.filter((a) =>
    (status === "ALL" || (status === "ACTIVE" ? !["DISPOSED", "LOST"].includes(a.status) : status === "ATTENTION" ? ["UNDER_REPAIR", "OUT_OF_ORDER"].includes(a.status) || ["POOR", "DAMAGED"].includes(a.condition) : a.status === status))
    && (!t || `${a.code} ${a.name} ${a.category} ${a.location ?? ""} ${a.serialNumber ?? ""} ${a.assignedTo ?? ""}`.toLowerCase().includes(t))), [assets, status, t]);
  const groups = useMemo(() => {
    const m = new Map<string, AssetRow[]>();
    for (const a of shown) m.set(a.category, [...(m.get(a.category) ?? []), a]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shown]);
  const current = open ? assets.find((a) => a.id === open) : null;
  const attention = assets.filter((a) => ["UNDER_REPAIR", "OUT_OF_ORDER"].includes(a.status) || ["POOR", "DAMAGED"].includes(a.condition)).length;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3 sm:px-4">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find: chair, TV, room 305, serial…" className={cn(field, "pl-9")} />
        </div>
        <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
          {[["ACTIVE", "In the hotel"], ["ATTENTION", `Needs attention${attention ? ` · ${attention}` : ""}`], ["IN_USE", "In use"], ["IN_STORE", "In store"], ["UNDER_REPAIR", "Under repair"], ["DISPOSED", "Disposed"], ["ALL", "All"]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k} className={cn("h-9 shrink-0 rounded-xl px-3 text-xs font-semibold transition-colors", status === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{l}</button>
          ))}
        </div>
        {perms.manage && <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-3 text-sm font-semibold text-[oklch(0.2_0.03_60)] hover:brightness-105"><Plus className="size-4" />New asset</button>}
      </div>
      {groups.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">{assets.length ? "Nothing matches." : "No assets recorded yet — add the beds, TVs, air conditioners, kitchen equipment…"}</p> : groups.map(([cat, rows]) => (
        <div key={cat}>
          <p className="flex justify-between gap-3 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>{cat} · {rows.reduce((t, r) => t + r.quantity, 0)}</span><span className="tabular-nums normal-case tracking-normal">{tzs(rows.reduce((t, r) => t + (r.purchaseCost ?? 0), 0))}</span>
          </p>
          <ul className="divide-y divide-border/50">
            {rows.map((a) => {
              const st = STATUS.get(a.status);
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => setOpen(a.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40">
                    <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">{a.code}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.quantity > 1 && <span className="tabular-nums">{a.quantity} × </span>}{a.name}</span>
                      <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground"><MapPin className="size-3 shrink-0" />{a.location ?? "no place set"}{a.assignedTo ? ` · ${a.assignedTo}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", st?.chip)}>{st?.label ?? a.status}</span>
                      <span className={cn("block text-[11px]", condTone(a.condition))}>{COND.get(a.condition) ?? a.condition}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {current && <AssetSheet key={current.id} a={current} opts={opts} perms={perms} onClose={() => setOpen(null)} />}
      {adding && (
        <Dialog open onOpenChange={(o) => !o && setAdding(false)}>
          <DialogContent className="max-h-[calc(100svh-1.5rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader icon={<Sofa />} eyebrow="Assets" tone="amber">
              <DialogTitle>New asset</DialogTitle>
              <DialogDescription>Long-term things the hotel owns — furniture, equipment, electronics. Not food or supplies (those are inventory).</DialogDescription>
            </DialogHeader>
            <AssetForm opts={opts} onDone={() => setAdding(false)} />
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

type SheetTab = "move" | "state" | "edit" | "history";

function AssetSheet({ a, opts, perms, onClose }: { a: AssetRow; opts: Opts; perms: Perms; onClose: () => void }) {
  const tabs: { key: SheetTab; label: string; icon: typeof History; show: boolean }[] = [
    { key: "move", label: "Move", icon: MoveRight, show: perms.move },
    { key: "state", label: "Condition", icon: Wrench, show: perms.move },
    { key: "history", label: "History", icon: History, show: true },
    { key: "edit", label: "Edit", icon: Pencil, show: perms.manage },
  ];
  const shown = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<SheetTab>(shown[0].key);
  const st = STATUS.get(a.status);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100svh-1.5rem)] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out.
            The tile sits at the top so the details below can run the band's full width. */}
        <DialogHeader icon={<Sofa />} eyebrow={`${a.code} · ${a.category}`} tone="amber" className="mx-0 mt-0 [&>div:last-child]:items-start">
          <DialogTitle>{a.quantity > 1 ? `${a.quantity} × ` : ""}{a.name}</DialogTitle>
          {/* `dark`: on the dark band the status chip and condition take their night-mode colours. */}
          <DialogDescription className="dark mt-0.5 flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 font-semibold", st?.chip)}>{st?.label}</span>
            <span className={condTone(a.condition)}>{COND.get(a.condition)}</span>
            <span className="inline-flex items-center gap-1 text-white/60"><MapPin className="size-3" />{a.location ?? "no place set"}</span>
          </DialogDescription>
          {/* Pulled back under the tile (size-11 / sm:size-12 + gap-3.5) and over the close button's room (pr-8). */}
          <div className="relative -mr-8 -ml-[3.625rem] sm:-ml-[3.875rem]">
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {([["Department", a.department?.name], ["Responsible", a.assignedTo], ["Bought", a.purchaseDate ? formatShortDate(a.purchaseDate) : null], ["Cost", a.purchaseCost ? tzs(a.purchaseCost) : null], ["Supplier", a.supplier?.name], ["Serial no.", a.serialNumber]] as const)
                .filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-white/55">{k}</dt><dd className="truncate font-medium text-white/90">{v}</dd></div>)}
            </dl>
            {a.notes && <p className="mt-1 text-xs text-white/60">{a.notes}</p>}
          </div>
        </DialogHeader>
        <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-4 py-2 [scrollbar-width:none]">
          {shown.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", tab === t.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}><t.icon className="size-3.5" />{t.label}</button>
          ))}
        </div>
        <div className="p-5">
          {tab === "move" && <MoveForm a={a} opts={opts} onDone={onClose} />}
          {tab === "state" && <StateForm a={a} onDone={onClose} />}
          {tab === "history" && <AssetHistory id={a.id} />}
          {tab === "edit" && <AssetForm opts={opts} a={a} onDone={onClose} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({ a, opts, onDone }: { a: AssetRow; opts: Opts; onDone: () => void }) {
  const { pending, run } = useRun();
  const [to, setTo] = useState("");
  const [qty, setQty] = useState(String(a.quantity));
  const [note, setNote] = useState("");
  const n = Math.min(a.quantity, Math.max(1, Number(qty) || 1));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm"><span className="truncate">{a.location ?? "—"}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground" /><span className="truncate font-semibold">{to || "…"}</span></div>
      <div className={cn("grid gap-3", a.quantity > 1 && "sm:grid-cols-[minmax(0,1fr)_7rem]")}>
        <Label label="To"><input list="asset-places" autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. Meeting room, Room 305, Store" className={field} /></Label>
        {a.quantity > 1 && <Label label={`How many (of ${a.quantity})`}><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} className={field} /></Label>}
      </div>
      <datalist id="asset-places">{opts.locations.map((l) => <option key={l} value={l} />)}</datalist>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? (optional) e.g. conference tomorrow" className={field} />
      <GoldButton pending={pending} disabled={!to.trim()} onClick={() => run(() => moveAssetAction({ assetId: a.id, to, quantity: n, note }), (d) => d.message, onDone)} className="w-full">
        Move {a.quantity > 1 ? `${n} ` : ""}to {to || "…"}
      </GoldButton>
      <p className="text-[11px] text-muted-foreground">Recorded with your name, from → to and the time.{a.quantity > 1 ? " Moving part of the line makes its own record at the new place." : ""}</p>
    </div>
  );
}

function StateForm({ a, onDone }: { a: AssetRow; onDone: () => void }) {
  const { pending, run } = useRun();
  const [condition, setCondition] = useState(a.condition);
  const [status, setStatus] = useState(a.status);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">Condition</p>
      <div className="flex flex-wrap gap-1.5">{ASSET_CONDITIONS.map((c) => <Chip key={c.code} on={condition === c.code} onClick={() => setCondition(c.code)}>{c.label}</Chip>)}</div>
      <p className="text-xs font-medium">Status</p>
      <div className="flex flex-wrap gap-1.5">{ASSET_STATUSES.map((s) => <Chip key={s.code} on={status === s.code} onClick={() => setStatus(s.code)}>{s.label}</Chip>)}</div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened? e.g. screen cracked, technician called" className={field} />
      <GoldButton pending={pending} disabled={condition === a.condition && status === a.status} onClick={() => run(() => assetStateAction({ assetId: a.id, condition, status, note }), undefined, onDone)} className="w-full">Save</GoldButton>
    </div>
  );
}

function AssetHistory({ id }: { id: string }) {
  const [rows, setRows] = useState<{ id: string; kind: string; from: string | null; to: string | null; quantity: number | null; note: string | null; at: string; by: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { assetHistoryAction({ id }).then((r) => (r.ok ? setRows(r.data) : setError(r.error))); }, [id]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!rows) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No moves or changes yet.</p>;
  return <MoveList rows={rows} />;
}

export function MoveList({ rows, withAsset }: { rows: { id: string; kind: string; from: string | null; to: string | null; quantity: number | null; note: string | null; at: string; by: string; asset?: { code: string; name: string } }[]; withAsset?: boolean }) {
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((m) => (
        <li key={m.id} className="py-2.5 text-sm">
          <p className="flex flex-wrap items-center gap-x-1.5">
            {withAsset && m.asset && <span className="font-medium">{m.asset.name} <span className="font-mono text-[11px] text-muted-foreground">{m.asset.code}</span> ·</span>}
            <span className="text-muted-foreground">{KIND[m.kind] ?? m.kind}{m.quantity && m.kind === "MOVED" ? ` (${m.quantity})` : ""}:</span>
            <span>{label(m.kind, m.from)}</span><ArrowRight className="size-3.5 text-muted-foreground" /><span className="font-semibold">{label(m.kind, m.to)}</span>
          </p>
          {m.note && <p className="text-xs text-muted-foreground">{m.note}</p>}
          <p className="text-[11px] text-muted-foreground/80">{formatDateTime(m.at)} · {m.by}</p>
        </li>
      ))}
    </ul>
  );
}

function AssetForm({ opts, a, onDone }: { opts: Opts; a?: AssetRow; onDone: () => void }) {
  const { pending, run } = useRun();
  const [f, setF] = useState({
    code: a?.code ?? "", name: a?.name ?? "", category: a?.category ?? ASSET_CATEGORIES[0], location: a?.location ?? "", departmentId: a?.department?.id ?? "",
    quantity: String(a?.quantity ?? 1), purchaseDate: a?.purchaseDate ?? "", purchaseCost: a?.purchaseCost ? String(a.purchaseCost) : "", condition: a?.condition ?? "GOOD",
    status: a?.status ?? "IN_USE", supplierId: a?.supplier?.id ?? "", serialNumber: a?.serialNumber ?? "", assignedTo: a?.assignedTo ?? "", notes: a?.notes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const cats = [...new Set([...ASSET_CATEGORIES, ...opts.categories])].sort();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Name" className="sm:col-span-2"><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Samsung 43″ TV" className={field} autoFocus={!a} /></Label>
        <Label label="Category"><input list="asset-cats" value={f.category} onChange={(e) => set("category", e.target.value)} className={field} /></Label>
        <Label label="Asset ID" hint={a ? undefined : "blank = next number"}><input value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="AST-0001 or TV-012" className={cn(field, "font-mono")} /></Label>
        <Label label="Location"><input list="asset-places" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Room 305, Restaurant…" className={field} /></Label>
        <Label label="Department">
          <select value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)} className={field}><option value="">—</option>{opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </Label>
        <Label label="Quantity"><input inputMode="numeric" value={f.quantity} onChange={(e) => set("quantity", e.target.value.replace(/\D/g, ""))} className={field} /></Label>
        <Label label="Responsible" hint="person or department"><input value={f.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} className={field} /></Label>
        <Label label="Bought on"><input type="date" value={f.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} className={field} /></Label>
        <Label label="Cost (all)" hint="TZS"><input inputMode="numeric" value={f.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value.replace(/\D/g, ""))} className={field} /></Label>
        <Label label="Supplier">
          <select value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)} className={field}><option value="">—</option>{opts.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Label>
        <Label label="Serial number"><input value={f.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} className={field} /></Label>
      </div>
      <p className="text-xs font-medium">Condition</p>
      <div className="flex flex-wrap gap-1.5">{ASSET_CONDITIONS.map((c) => <Chip key={c.code} on={f.condition === c.code} onClick={() => set("condition", c.code)}>{c.label}</Chip>)}</div>
      <p className="text-xs font-medium">Status</p>
      <div className="flex flex-wrap gap-1.5">{ASSET_STATUSES.map((s) => <Chip key={s.code} on={f.status === s.code} onClick={() => set("status", s.code)}>{s.label}</Chip>)}</div>
      <input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Notes (optional)" className={field} />
      <datalist id="asset-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="asset-places">{opts.locations.map((l) => <option key={l} value={l} />)}</datalist>
      <GoldButton pending={pending} disabled={!f.name.trim() || !f.category.trim()} onClick={() => run(() => saveAssetAction({ ...f, id: a?.id ?? null, quantity: num(f.quantity) ?? 1, purchaseCost: num(f.purchaseCost), purchaseDate: f.purchaseDate || null }), (d) => (a ? "Saved." : `${d.code} added.`), onDone)} className="w-full">
        {a ? "Save changes" : "Add asset"}
      </GoldButton>
    </div>
  );
}
