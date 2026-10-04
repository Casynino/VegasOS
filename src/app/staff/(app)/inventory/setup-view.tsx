"use client";

import { useState } from "react";
import { Building, FolderTree, Pencil, Plus, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { UNITS } from "@/lib/inventory";
import { saveCategoryAction, saveDepartmentAction, saveSupplierAction } from "./actions";
import type { Setup } from "./item-form";
import { GoldButton, field, useRun } from "./ui";

/** Inventory setup (the MD): departments, categories, suppliers — and the units stock can be counted in. Managers see it, the MD changes it. */
export function SetupView({ setup, counts, canManage }: { setup: Setup; counts: { dept: Record<string, number>; cat: Record<string, number> }; canManage: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel icon={Building} title="Departments" sub="Who holds stock">
        {setup.departments.map((d) => <NameRow key={d.id} name={d.name} active={d.isActive} meta={`${counts.dept[d.id] ?? 0} items`} disabled={!canManage}
          save={(name, isActive) => saveDepartmentAction({ id: d.id, name, isActive })} />)}
        {canManage && <AddRow placeholder="New department, e.g. Spa" save={(name) => saveDepartmentAction({ name })} />}
      </Panel>
      <Panel icon={FolderTree} title="Categories" sub="How stock is grouped">
        {setup.categories.map((c) => <CategoryRow key={c.id} c={c} setup={setup} count={counts.cat[c.id] ?? 0} disabled={!canManage} />)}
        {canManage && <AddRow placeholder="New category, e.g. Guest amenities" save={(name) => saveCategoryAction({ name })} />}
      </Panel>
      <Panel icon={Truck} title="Suppliers" sub="Who delivers">
        {setup.suppliers.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No suppliers yet.</p>}
        {setup.suppliers.map((s) => <SupplierRow key={s.id} s={s} canEdit={canManage} />)}
        {canManage && <SupplierRow canEdit />}
      </Panel>
      <section className="rounded-3xl border border-border/70 bg-card p-4 lg:col-span-3">
        <p className="text-sm font-semibold">Units stock can be counted in</p>
        <p className="mb-2 text-xs text-muted-foreground">Each item keeps its own unit. Recipes may use grams for kilograms and ml for litres — the system converts.</p>
        <div className="flex flex-wrap gap-1.5">{UNITS.map((u) => <span key={u.code} className="rounded-lg bg-muted px-2 py-1 text-[11px] font-semibold">{u.code} <span className="font-normal text-muted-foreground">{u.plural}</span></span>)}</div>
      </section>
    </div>
  );
}

function Panel({ icon: Icon, title, sub, children }: { icon: typeof Building; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <p className="flex items-center gap-2 border-b border-border/70 px-4 py-3 text-sm font-semibold"><Icon className="size-4 text-[oklch(0.7_0.12_78)]" />{title}<span className="font-normal text-muted-foreground">· {sub}</span></p>
      <ul className="divide-y divide-border/50">{children}</ul>
    </section>
  );
}

function NameRow({ name, active, meta, save, disabled }: { name: string; active: boolean; meta: string; save: (name: string, isActive: boolean) => Promise<{ ok: true; data: null } | { ok: false; error: string }>; disabled?: boolean }) {
  const { pending, run } = useRun();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(name);
  const [on, setOn] = useState(active);
  if (!edit) return (
    <li className={cn("flex items-center justify-between gap-3 px-4 py-2.5", !active && "opacity-50")}>
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{name}{!active && " · off"}</span><span className="text-[11px] text-muted-foreground">{meta}</span></span>
      {!disabled && <button type="button" aria-label={`Edit ${name}`} onClick={() => setEdit(true)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><Pencil className="size-3.5" /></button>}
    </li>
  );
  return (
    <li className="space-y-2 px-4 py-2.5">
      <input value={v} onChange={(e) => setV(e.target.value)} className={cn(field, "h-9")} autoFocus />
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="accent-[oklch(0.7_0.12_76)]" />In use</label>
        <span className="flex gap-1.5">
          <button type="button" onClick={() => setEdit(false)} className="h-8 rounded-lg border border-border px-2.5 text-xs">Cancel</button>
          <GoldButton pending={pending} disabled={!v.trim()} onClick={() => run(() => save(v, on), undefined, () => setEdit(false))} className="h-8 px-3 text-xs">Save</GoldButton>
        </span>
      </div>
    </li>
  );
}

function CategoryRow({ c, setup, count, disabled }: { c: Setup["categories"][number]; setup: Setup; count: number; disabled?: boolean }) {
  const { pending, run } = useRun();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: c.name, departmentId: c.departmentId ?? "", isActive: c.isActive });
  const dept = setup.departments.find((d) => d.id === c.departmentId)?.name;
  if (!edit) return (
    <li className={cn("flex items-center justify-between gap-3 px-4 py-2.5", !c.isActive && "opacity-50")}>
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{c.name}{!c.isActive && " · off"}</span><span className="text-[11px] text-muted-foreground">{count} items{dept ? ` · usually ${dept}` : ""}</span></span>
      {!disabled && <button type="button" aria-label={`Edit ${c.name}`} onClick={() => setEdit(true)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><Pencil className="size-3.5" /></button>}
    </li>
  );
  return (
    <li className="space-y-2 px-4 py-2.5">
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={cn(field, "h-9")} autoFocus />
      <select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} className={cn(field, "h-9")}>
        <option value="">Any department</option>
        {setup.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="accent-[oklch(0.7_0.12_76)]" />In use</label>
        <span className="flex gap-1.5">
          <button type="button" onClick={() => setEdit(false)} className="h-8 rounded-lg border border-border px-2.5 text-xs">Cancel</button>
          <GoldButton pending={pending} disabled={!f.name.trim()} onClick={() => run(() => saveCategoryAction({ id: c.id, ...f }), undefined, () => setEdit(false))} className="h-8 px-3 text-xs">Save</GoldButton>
        </span>
      </div>
    </li>
  );
}

function AddRow({ placeholder, save }: { placeholder: string; save: (name: string) => Promise<{ ok: true; data: null } | { ok: false; error: string }> }) {
  const { pending, run } = useRun();
  const [v, setV] = useState("");
  return (
    <li className="flex gap-2 px-4 py-2.5">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className={cn(field, "h-9")} />
      <button type="button" disabled={pending || !v.trim()} onClick={() => run(() => save(v), undefined, () => setV(""))} aria-label="Add" className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground text-background disabled:opacity-40"><Plus className="size-4" /></button>
    </li>
  );
}

function SupplierRow({ s, canEdit }: { s?: Setup["suppliers"][number]; canEdit: boolean }) {
  const { pending, run } = useRun();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: s?.name ?? "", contactName: s?.contactName ?? "", phone: s?.phone ?? "", email: s?.email ?? "", notes: s?.notes ?? "", isActive: s?.isActive ?? true });
  if (!edit) return s ? (
    <li className={cn("flex items-center justify-between gap-3 px-4 py-2.5", !s.isActive && "opacity-50")}>
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{s.name}</span><span className="block truncate text-[11px] text-muted-foreground">{[s.contactName, s.phone].filter(Boolean).join(" · ") || "—"}</span></span>
      {canEdit && <button type="button" aria-label={`Edit ${s.name}`} onClick={() => setEdit(true)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><Pencil className="size-3.5" /></button>}
    </li>
  ) : (
    <li className="px-4 py-2.5"><button type="button" onClick={() => setEdit(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[oklch(0.6_0.12_78)] dark:text-[oklch(0.8_0.1_82)]"><Plus className="size-4" />Add a supplier</button></li>
  );
  return (
    <li className="space-y-2 px-4 py-2.5">
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Supplier name" className={cn(field, "h-9")} autoFocus />
      <div className="grid grid-cols-2 gap-2">
        <input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} placeholder="Contact person" className={cn(field, "h-9")} />
        <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Phone" inputMode="tel" className={cn(field, "h-9")} />
      </div>
      <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Email (optional)" className={cn(field, "h-9")} />
      <div className="flex items-center justify-between gap-2">
        {s ? <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="accent-[oklch(0.7_0.12_76)]" />In use</label> : <span />}
        <span className="flex gap-1.5">
          <button type="button" onClick={() => setEdit(false)} className="h-8 rounded-lg border border-border px-2.5 text-xs">Cancel</button>
          <GoldButton pending={pending} disabled={!f.name.trim()} onClick={() => run(() => saveSupplierAction({ id: s?.id ?? null, ...f }), undefined, () => { setEdit(false); if (!s) setF({ name: "", contactName: "", phone: "", email: "", notes: "", isActive: true }); })} className="h-8 px-3 text-xs">Save</GoldButton>
        </span>
      </div>
    </li>
  );
}
