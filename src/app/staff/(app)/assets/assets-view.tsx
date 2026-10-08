"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, History, Loader2, MapPin, MoveRight, Pencil, Plus, Search, Sofa, Wrench } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ASSET_CATEGORIES, ASSET_CONDITIONS, ASSET_STATUSES } from "@/lib/inventory";
import { assetHistoryAction, assetStateAction, moveAssetAction, saveAssetAction } from "../inventory/actions";
import { Chip, GoldButton, Label, field, num, tzs, useRun } from "../inventory/ui";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

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
const KIND: Record<string, string> = { MOVED: msg("Moved"), CONDITION: msg("Condition"), STATUS: msg("Status"), ASSIGNED: msg("Assigned to") };
/** A place in the reader's words: "Room 305" (the page's own wording) or the hotel's place names (they fall back to themselves). */
const placeName = (v: string, t: T) => { const m = /^Room (\S+)$/.exec(v); return m ? t("Room {room}", { room: m[1] }) : t(v); };
/** A history value in the reader's words: a condition, a status or a place (a person's name stays as it is). */
const label = (kind: string, v: string | null, t: T) => (v == null ? "—" : kind === "CONDITION" ? t(COND.get(v) ?? v) : kind === "STATUS" ? t(STATUS.get(v)?.label ?? v) : kind === "MOVED" ? placeName(v, t) : v);

/** The asset register: by category, with where each thing is, its condition and status; tap one to move it or update it. */
export function AssetsView({ assets, opts, perms }: { assets: AssetRow[]; opts: Opts; perms: Perms }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("ACTIVE");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const t = useT();
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => assets.filter((a) =>
    (status === "ALL" || (status === "ACTIVE" ? !["DISPOSED", "LOST"].includes(a.status) : status === "ATTENTION" ? ["UNDER_REPAIR", "OUT_OF_ORDER"].includes(a.status) || ["POOR", "DAMAGED"].includes(a.condition) : a.status === status))
    && (!needle || `${a.code} ${a.name} ${a.category} ${t(a.category)} ${a.location ?? ""} ${a.location ? placeName(a.location, t) : ""} ${a.serialNumber ?? ""} ${a.assignedTo ?? ""}`.toLowerCase().includes(needle))), [assets, status, needle, t]);
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find: chair, TV, room 305, serial…")} className={cn(field, "pl-9")} />
        </div>
        <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
          {[["ACTIVE", t.ctx("asset", "In the hotel")], ["ATTENTION", attention ? t("Needs attention · {n}", { n: attention }) : t("Needs attention")], ["IN_USE", t("In use")], ["IN_STORE", t("In store")], ["UNDER_REPAIR", t("Under repair")], ["DISPOSED", t("Disposed")], ["ALL", t("All")]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStatus(k)} aria-pressed={status === k} className={cn("h-9 shrink-0 rounded-xl px-3 text-xs font-semibold transition-colors", status === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{l}</button>
          ))}
        </div>
        {perms.manage && <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-3 text-sm font-semibold text-[oklch(0.2_0.03_60)] hover:brightness-105"><Plus className="size-4" />{t("New asset")}</button>}
      </div>
      {groups.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">{assets.length ? t("Nothing matches.") : t("No assets recorded yet — add the beds, TVs, air conditioners, kitchen equipment…")}</p> : groups.map(([cat, rows]) => (
        <div key={cat}>
          <p className="flex justify-between gap-3 bg-muted/40 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>{t(cat)} · {rows.reduce((sum, r) => sum + r.quantity, 0)}</span><span className="tabular-nums normal-case tracking-normal">{tzs(rows.reduce((sum, r) => sum + (r.purchaseCost ?? 0), 0))}</span>
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
                      <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground"><MapPin className="size-3 shrink-0" />{a.location ? placeName(a.location, t) : t("no place set")}{a.assignedTo ? ` · ${a.assignedTo}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", st?.chip)}>{st ? t(st.label) : a.status}</span>
                      <span className={cn("block text-[11px]", condTone(a.condition))}>{t(COND.get(a.condition) ?? a.condition)}</span>
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
            <DialogHeader icon={<Sofa />} eyebrow={t("Assets")} tone="amber">
              <DialogTitle>{t("New asset")}</DialogTitle>
              <DialogDescription>{t("Long-term things the hotel owns — furniture, equipment, electronics. Not food or supplies (those are inventory).")}</DialogDescription>
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
  const t = useT();
  const tabs: { key: SheetTab; label: string; icon: typeof History; show: boolean }[] = [
    { key: "move", label: t.ctx("asset", "Move"), icon: MoveRight, show: perms.move },
    { key: "state", label: t("Condition"), icon: Wrench, show: perms.move },
    { key: "history", label: t("History"), icon: History, show: true },
    { key: "edit", label: t("Edit"), icon: Pencil, show: perms.manage },
  ];
  const shown = tabs.filter((x) => x.show);
  const cond = COND.get(a.condition);
  const [tab, setTab] = useState<SheetTab>(shown[0].key);
  const st = STATUS.get(a.status);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100svh-1.5rem)] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out.
            The tile sits at the top so the details below can run the band's full width. */}
        <DialogHeader icon={<Sofa />} eyebrow={`${a.code} · ${t(a.category)}`} tone="amber" className="mx-0 mt-0 [&>div:last-child]:items-start">
          <DialogTitle>{a.quantity > 1 ? `${a.quantity} × ` : ""}{a.name}</DialogTitle>
          {/* `dark`: on the dark band the status chip and condition take their night-mode colours. */}
          <DialogDescription className="dark mt-0.5 flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 font-semibold", st?.chip)}>{st ? t(st.label) : null}</span>
            <span className={condTone(a.condition)}>{cond ? t(cond) : null}</span>
            <span className="inline-flex items-center gap-1 text-white/60"><MapPin className="size-3" />{a.location ? placeName(a.location, t) : t("no place set")}</span>
          </DialogDescription>
          {/* Pulled back under the tile (size-11 / sm:size-12 + gap-3.5) and over the close button's room (pr-8). */}
          <div className="relative -mr-8 -ml-[3.625rem] sm:-ml-[3.875rem]">
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {([[t("Department"), a.department ? t(a.department.name) : null], [t("Responsible"), a.assignedTo], [t("Bought"), a.purchaseDate ? t.shortDate(a.purchaseDate) : null], [t("Cost"), a.purchaseCost ? tzs(a.purchaseCost) : null], [t("Supplier"), a.supplier?.name], [t("Serial no."), a.serialNumber]] as const)
                .filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-white/55">{k}</dt><dd className="truncate font-medium text-white/90">{v}</dd></div>)}
            </dl>
            {a.notes && <p className="mt-1 text-xs text-white/60">{a.notes}</p>}
          </div>
        </DialogHeader>
        <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-4 py-2 [scrollbar-width:none]">
          {shown.map((x) => (
            <button key={x.key} type="button" onClick={() => setTab(x.key)} aria-pressed={tab === x.key} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", tab === x.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}><x.icon className="size-3.5" />{x.label}</button>
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
  const t = useT();
  const { pending, run } = useRun();
  const [to, setTo] = useState("");
  const [qty, setQty] = useState(String(a.quantity));
  const [note, setNote] = useState("");
  const n = Math.min(a.quantity, Math.max(1, Number(qty) || 1));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm"><span className="truncate">{a.location ? placeName(a.location, t) : "—"}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground" /><span className="truncate font-semibold">{to || "…"}</span></div>
      <div className={cn("grid gap-3", a.quantity > 1 && "sm:grid-cols-[minmax(0,1fr)_7rem]")}>
        <Label label={t.ctx("asset", "To")}><input list="asset-places" autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder={t("e.g. Meeting room, Room 305, Store")} className={field} /></Label>
        {a.quantity > 1 && <Label label={t("How many (of {n})", { n: a.quantity })}><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} className={field} /></Label>}
      </div>
      <datalist id="asset-places">{opts.locations.map((l) => <option key={l} value={l} label={placeName(l, t)} />)}</datalist>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Why? (optional) e.g. conference tomorrow")} className={field} />
      <GoldButton pending={pending} disabled={!to.trim()} onClick={() => run(() => moveAssetAction({ assetId: a.id, to, quantity: n, note }), (d) => d.message, onDone)} className="w-full">
        {a.quantity > 1 ? t("Move {n} to {place}", { n, place: to || "…" }) : t.ctx("asset", "Move to {place}", { place: to || "…" })}
      </GoldButton>
      <p className="text-[11px] text-muted-foreground">{t("Recorded with your name, from → to and the time.")}{a.quantity > 1 ? ` ${t("Moving part of the line makes its own record at the new place.")}` : ""}</p>
    </div>
  );
}

function StateForm({ a, onDone }: { a: AssetRow; onDone: () => void }) {
  const t = useT();
  const { pending, run } = useRun();
  const [condition, setCondition] = useState(a.condition);
  const [status, setStatus] = useState(a.status);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">{t("Condition")}</p>
      <div className="flex flex-wrap gap-1.5">{ASSET_CONDITIONS.map((c) => <Chip key={c.code} on={condition === c.code} onClick={() => setCondition(c.code)}>{t(c.label)}</Chip>)}</div>
      <p className="text-xs font-medium">{t("Status")}</p>
      <div className="flex flex-wrap gap-1.5">{ASSET_STATUSES.map((s) => <Chip key={s.code} on={status === s.code} onClick={() => setStatus(s.code)}>{t(s.label)}</Chip>)}</div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("What happened? e.g. screen cracked, technician called")} className={field} />
      <GoldButton pending={pending} disabled={condition === a.condition && status === a.status} onClick={() => run(() => assetStateAction({ assetId: a.id, condition, status, note }), undefined, onDone)} className="w-full">{t("Save")}</GoldButton>
    </div>
  );
}

function AssetHistory({ id }: { id: string }) {
  const t = useT();
  const [rows, setRows] = useState<{ id: string; kind: string; from: string | null; to: string | null; quantity: number | null; note: string | null; at: string; by: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { assetHistoryAction({ id }).then((r) => (r.ok ? setRows(r.data) : setError(r.error))); }, [id]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!rows) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…")}</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t("No moves or changes yet.")}</p>;
  return <MoveList rows={rows} />;
}

export function MoveList({ rows, withAsset }: { rows: { id: string; kind: string; from: string | null; to: string | null; quantity: number | null; note: string | null; at: string; by: string; asset?: { code: string; name: string } }[]; withAsset?: boolean }) {
  const t = useT();
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((m) => (
        <li key={m.id} className="py-2.5 text-sm">
          <p className="flex flex-wrap items-center gap-x-1.5">
            {withAsset && m.asset && <span className="font-medium">{m.asset.name} <span className="font-mono text-[11px] text-muted-foreground">{m.asset.code}</span> ·</span>}
            <span className="text-muted-foreground">{KIND[m.kind] ? t(KIND[m.kind]) : m.kind}{m.quantity && m.kind === "MOVED" ? ` (${m.quantity})` : ""}:</span>
            <span>{label(m.kind, m.from, t)}</span><ArrowRight className="size-3.5 text-muted-foreground" /><span className="font-semibold">{label(m.kind, m.to, t)}</span>
          </p>
          {m.note && <p className="text-xs text-muted-foreground">{m.note}</p>}
          <p className="text-[11px] text-muted-foreground/80">{t.dateTime(m.at)} · {m.by}</p>
        </li>
      ))}
    </ul>
  );
}

function AssetForm({ opts, a, onDone }: { opts: Opts; a?: AssetRow; onDone: () => void }) {
  const t = useT();
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
        <Label label={t("Name")} className="sm:col-span-2"><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("e.g. Samsung 43″ TV")} className={field} autoFocus={!a} /></Label>
        <Label label={t("Category")}><input list="asset-cats" value={f.category} onChange={(e) => set("category", e.target.value)} className={field} /></Label>
        <Label label={t("Asset ID")} hint={a ? undefined : t("blank = next number")}><input value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder={t("AST-0001 or TV-012")} className={cn(field, "font-mono")} /></Label>
        <Label label={t("Location")}><input list="asset-places" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder={t("Room 305, Restaurant…")} className={field} /></Label>
        <Label label={t("Department")}>
          <select value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)} className={field}><option value="">—</option>{opts.departments.map((d) => <option key={d.id} value={d.id}>{t(d.name)}</option>)}</select>
        </Label>
        <Label label={t("Quantity")}><input inputMode="numeric" value={f.quantity} onChange={(e) => set("quantity", e.target.value.replace(/\D/g, ""))} className={field} /></Label>
        <Label label={t("Responsible")} hint={t("person or department")}><input value={f.assignedTo} onChange={(e) => set("assignedTo", e.target.value)} className={field} /></Label>
        <Label label={t("Bought on")}><input type="date" value={f.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} className={field} /></Label>
        <Label label={t("Cost (all)")} hint="TZS"><input inputMode="numeric" value={f.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value.replace(/\D/g, ""))} className={field} /></Label>
        <Label label={t("Supplier")}>
          <select value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)} className={field}><option value="">—</option>{opts.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </Label>
        <Label label={t("Serial number")}><input value={f.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} className={field} /></Label>
      </div>
      <p className="text-xs font-medium">{t("Condition")}</p>
      <div className="flex flex-wrap gap-1.5">{ASSET_CONDITIONS.map((c) => <Chip key={c.code} on={f.condition === c.code} onClick={() => set("condition", c.code)}>{t(c.label)}</Chip>)}</div>
      <p className="text-xs font-medium">{t("Status")}</p>
      <div className="flex flex-wrap gap-1.5">{ASSET_STATUSES.map((s) => <Chip key={s.code} on={f.status === s.code} onClick={() => set("status", s.code)}>{t(s.label)}</Chip>)}</div>
      <input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("Notes (optional)")} className={field} />
      <datalist id="asset-cats">{cats.map((c) => <option key={c} value={c} label={t(c)} />)}</datalist>
      <datalist id="asset-places">{opts.locations.map((l) => <option key={l} value={l} label={placeName(l, t)} />)}</datalist>
      <GoldButton pending={pending} disabled={!f.name.trim() || !f.category.trim()} onClick={() => run(() => saveAssetAction({ ...f, id: a?.id ?? null, quantity: num(f.quantity) ?? 1, purchaseCost: num(f.purchaseCost), purchaseDate: f.purchaseDate || null }), (d) => (a ? t("Saved.") : t("{code} added.", { code: d.code })), onDone)} className="w-full">
        {a ? t("Save changes") : t("Add asset")}
      </GoldButton>
    </div>
  );
}
