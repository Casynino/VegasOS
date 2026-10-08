"use client";

import { useState } from "react";
import { PackagePlus, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UNITS, unitOf } from "@/lib/inventory";
import type { InventoryRow } from "@/server/services/inventory";
import { saveItemAction } from "./actions";
import { GoldButton, Label, field, num, useRun } from "./ui";
import { useT } from "@/i18n/client";

export type Setup = {
  departments: { id: string; code: string; name: string; isActive: boolean }[];
  categories: { id: string; name: string; departmentId: string | null; isActive: boolean }[];
  suppliers: { id: string; name: string; isActive: boolean; contactName: string | null; phone: string | null; email: string | null; notes: string | null }[];
  locations: string[];
};

/** Create or edit a stock item (the MD). Levels drive the alerts; a new item can start with what is on the shelf. */
export function ItemForm({ setup, item, onDone, inline, defaultDepartmentId }: { setup: Setup; item?: InventoryRow | null; onDone: () => void; inline?: boolean; defaultDepartmentId?: string | null }) {
  const t = useT();
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
  const u = t(unitOf(f.unit).plural);
  const go = () => run(() => saveItemAction({
    ...f, id: item?.id ?? null, minStock: num(f.minStock), reorderLevel: num(f.reorderLevel), maxStock: num(f.maxStock), costPerUnit: num(f.costPerUnit),
    openingQuantity: item ? null : num(f.openingQuantity),
  }), () => (item ? t("{name} saved.", { name: f.name }) : t("{name} added.", { name: f.name })), onDone);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label={t("Item name")} className="sm:col-span-2"><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("e.g. Beef")} className={field} autoFocus={!inline} /></Label>
        <Label label={t("Category")}>
          <select value={f.categoryId} onChange={(e) => { const c = setup.categories.find((x) => x.id === e.target.value); setF((x) => ({ ...x, categoryId: e.target.value, departmentId: !item && c?.departmentId ? c.departmentId : x.departmentId })); }} className={field}>
            {setup.categories.filter((c) => c.isActive || c.id === f.categoryId).map((c) => <option key={c.id} value={c.id}>{t(c.name)}</option>)}
          </select>
        </Label>
        <Label label={t("Department")}>
          <select value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)} className={field}>
            {setup.departments.filter((d) => d.isActive || d.id === f.departmentId).map((d) => <option key={d.id} value={d.id}>{t(d.name)}</option>)}
          </select>
        </Label>
        <Label label={t("Counted in")} hint={item ? t("fixed once stock moves") : undefined}>
          <select value={f.unit} onChange={(e) => set("unit", e.target.value)} className={field}>
            {UNITS.map((x) => <option key={x.code} value={x.code}>{x.code} — {t(x.plural)}</option>)}
          </select>
        </Label>
        <Label label={t("SKU / reference")} hint={t("optional")}><input value={f.sku} onChange={(e) => set("sku", e.target.value)} placeholder={t("e.g. KIT-BEEF")} className={field} /></Label>
        <Label label={t("Minimum")} hint={u}><input inputMode="decimal" value={f.minStock} onChange={(e) => set("minStock", e.target.value)} placeholder={t("low-stock alert below")} className={field} /></Label>
        <Label label={t("Reorder level")} hint={u}><input inputMode="decimal" value={f.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value)} placeholder={t("time to buy at")} className={field} /></Label>
        <Label label={t("Maximum")} hint={u}><input inputMode="decimal" value={f.maxStock} onChange={(e) => set("maxStock", e.target.value)} placeholder={t("overstock above")} className={field} /></Label>
        <Label label={t("Cost per {unit}", { unit: t(unitOf(f.unit).label) })} hint="TZS"><input inputMode="numeric" value={f.costPerUnit} onChange={(e) => set("costPerUnit", e.target.value.replace(/\D/g, ""))} className={field} /></Label>
        <Label label={t("Supplier")}>
          <select value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)} className={field}>
            <option value="">—</option>
            {setup.suppliers.filter((s) => s.isActive || s.id === f.supplierId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Label>
        <Label label={t("Storage location")}><input list="inv-locations" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder={t("e.g. Main store, Cold room")} className={field} /></Label>
        {!item && <Label label={t("On the shelf now")} hint={u}><input inputMode="decimal" value={f.openingQuantity} onChange={(e) => set("openingQuantity", e.target.value)} placeholder={t("opening stock")} className={field} /></Label>}
        <Label label={t("Notes")} className="sm:col-span-2"><input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder={t("optional")} className={field} /></Label>
      </div>
      <datalist id="inv-locations">{setup.locations.map((l) => <option key={l} value={l} />)}</datalist>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.tracksExpiry} onChange={(e) => set("tracksExpiry", e.target.checked)} className="size-4 accent-[oklch(0.7_0.12_76)]" />{t("Track expiry dates on deliveries")}</label>
        {item && <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-4 accent-[oklch(0.7_0.12_76)]" />{t("In use (switch off to hide it)")}</label>}
      </div>
      <GoldButton pending={pending} disabled={!f.name.trim() || !f.categoryId || !f.departmentId} onClick={go} className="w-full">{item ? t("Save changes") : t.ctx("stock", "Add item")}</GoldButton>
      {item && <p className="text-[11px] text-muted-foreground">{t("Every change is kept in the audit history with the old and new value.")}</p>}
    </div>
  );
}

export function NewItemButton({ setup, defaultDepartmentId }: { setup: Setup; defaultDepartmentId?: string | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3 text-sm font-semibold hover:bg-muted"><Plus className="size-4" />{t("New item")}</button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-h-[calc(100svh-1.5rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader icon={<PackagePlus />} eyebrow={t("Stock")} tone="amber">
              <DialogTitle>{t("New stock item")}</DialogTitle>
              <DialogDescription>{t("Anything the hotel keeps and uses up — food, drinks, soap, bulbs, paper.")}</DialogDescription>
            </DialogHeader>
            <ItemForm setup={setup} onDone={() => setOpen(false)} defaultDepartmentId={defaultDepartmentId} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
