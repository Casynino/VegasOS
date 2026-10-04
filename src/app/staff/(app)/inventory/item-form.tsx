"use client";

import { useState } from "react";
import { PackagePlus, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UNITS, unitOf } from "@/lib/inventory";
import type { InventoryRow } from "@/server/services/inventory";
import { saveItemAction } from "./actions";
import { GoldButton, Label, field, num, useRun } from "./ui";

export type Setup = {
  departments: { id: string; code: string; name: string; isActive: boolean }[];
  categories: { id: string; name: string; departmentId: string | null; isActive: boolean }[];
  suppliers: { id: string; name: string; isActive: boolean; contactName: string | null; phone: string | null; email: string | null; notes: string | null }[];
  locations: string[];
};

/** Create or edit a stock item (the MD). Levels drive the alerts; a new item can start with what is on the shelf. */
export function ItemForm({ setup, item, onDone, inline, defaultDepartmentId }: { setup: Setup; item?: InventoryRow | null; onDone: () => void; inline?: boolean; defaultDepartmentId?: string | null }) {
  const { pending, run } = useRun();
  const firstCat = setup.categories.find((c) => c.isActive && (!defaultDepartmentId || c.departmentId === defaultDepartmentId)) ?? setup.categories.find((c) => c.isActive);
  const [f, setF] = useState({
    name: item?.name ?? "", sku: item?.sku ?? "", categoryId: item?.category.id ?? firstCat?.id ?? "",
    departmentId: item?.department.id ?? defaultDepartmentId ?? firstCat?.departmentId ?? setup.departments[0]?.id ?? "",
    unit: item?.unit ?? "KG", minStock: item?.minStock?.toString() ?? "", reorderLevel: item?.reorderLevel?.toString() ?? "", maxStock: item?.maxStock?.toString() ?? "",
    costPerUnit: item?.costPerUnit ? String(item.costPerUnit) : "", supplierId: item?.supplier?.id ?? "", location: item?.location ?? "",
    tracksExpiry: item?.tracksExpiry ?? false, isActive: item?.isActive ?? true, notes: item?.notes ?? "", openingQuantity: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const u = unitOf(f.unit).plural;
  const go = () => run(() => saveItemAction({
    ...f, id: item?.id ?? null, minStock: num(f.minStock), reorderLevel: num(f.reorderLevel), maxStock: num(f.maxStock), costPerUnit: num(f.costPerUnit),
    openingQuantity: item ? null : num(f.openingQuantity),
  }), () => (item ? `${f.name} saved.` : `${f.name} added.`), onDone);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Item name" className="sm:col-span-2"><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Beef" className={field} autoFocus={!inline} /></Label>
        <Label label="Category">
          <select value={f.categoryId} onChange={(e) => { const c = setup.categories.find((x) => x.id === e.target.value); setF((x) => ({ ...x, categoryId: e.target.value, departmentId: !item && c?.departmentId ? c.departmentId : x.departmentId })); }} className={field}>
            {setup.categories.filter((c) => c.isActive || c.id === f.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Label>
        <Label label="Department">
          <select value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)} className={field}>
            {setup.departments.filter((d) => d.isActive || d.id === f.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Label>
        <Label label="Counted in" hint={item ? "fixed once stock moves" : undefined}>
          <select value={f.unit} onChange={(e) => set("unit", e.target.value)} className={field}>
            {UNITS.map((x) => <option key={x.code} value={x.code}>{x.code} — {x.plural}</option>)}
          </select>
        </Label>
        <Label label="SKU / reference" hint="optional"><input value={f.sku} onChange={(e) => set("sku", e.target.value)} placeholder="e.g. KIT-BEEF" className={field} /></Label>
        <Label label="Minimum" hint={u}><input inputMode="decimal" value={f.minStock} onChange={(e) => set("minStock", e.target.value)} placeholder="low-stock alert below" className={field} /></Label>
        <Label label="Reorder level" hint={u}><input inputMode="decimal" value={f.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value)} placeholder="time to buy at" className={field} /></Label>
        <Label label="Maximum" hint={u}><input inputMode="decimal" value={f.maxStock} onChange={(e) => set("maxStock", e.target.value)} placeholder="overstock above" className={field} /></Label>
        <Label label={`Cost per ${unitOf(f.unit).label}`} hint="TZS"><input inputMode="numeric" value={f.costPerUnit} onChange={(e) => set("costPerUnit", e.target.value.replace(/\D/g, ""))} className={field} /></Label>
        <Label label="Supplier">
          <select value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)} className={field}>
            <option value="">—</option>
            {setup.suppliers.filter((s) => s.isActive || s.id === f.supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Label>
        <Label label="Storage location"><input list="inv-locations" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Main store, Cold room" className={field} /></Label>
        {!item && <Label label="On the shelf now" hint={u}><input inputMode="decimal" value={f.openingQuantity} onChange={(e) => set("openingQuantity", e.target.value)} placeholder="opening stock" className={field} /></Label>}
        <Label label="Notes" className="sm:col-span-2"><input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" className={field} /></Label>
      </div>
      <datalist id="inv-locations">{setup.locations.map((l) => <option key={l} value={l} />)}</datalist>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.tracksExpiry} onChange={(e) => set("tracksExpiry", e.target.checked)} className="size-4 accent-[oklch(0.7_0.12_76)]" />Track expiry dates on deliveries</label>
        {item && <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 accent-[oklch(0.7_0.12_76)]" />In use (switch off to hide it)</label>}
      </div>
      <GoldButton pending={pending} disabled={!f.name.trim() || !f.categoryId || !f.departmentId} onClick={go} className="w-full">{item ? "Save changes" : "Add item"}</GoldButton>
      {item && <p className="text-[11px] text-muted-foreground">Every change is kept in the audit history with the old and new value.</p>}
    </div>
  );
}

export function NewItemButton({ setup, defaultDepartmentId }: { setup: Setup; defaultDepartmentId?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3 text-sm font-semibold hover:bg-muted"><Plus className="size-4" />New item</button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-h-[calc(100svh-1.5rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader icon={<PackagePlus />} eyebrow="Stock" tone="amber">
              <DialogTitle>New stock item</DialogTitle>
              <DialogDescription>Anything the hotel keeps and uses up — food, drinks, soap, bulbs, paper.</DialogDescription>
            </DialogHeader>
            <ItemForm setup={setup} onDone={() => setOpen(false)} defaultDepartmentId={defaultDepartmentId} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
