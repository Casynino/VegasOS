"use client";

import { useMemo, useState } from "react";
import { ChefHat, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { compatibleUnits, convertQty, unitOf } from "@/lib/inventory";
import { saveRecipeAction } from "./actions";
import { GoldButton, field, tzs, useRun } from "./ui";

type Dish = { id: string; name: string; price: number; type: string; category: { name: string }; recipe: { itemId: string; quantity: number; unit: string }[] };
type Stock = { id: string; name: string; unit: string; costPerUnit: number; department: { name: string } };

const costOf = (lines: { itemId: string; quantity: number; unit: string }[], stock: Map<string, Stock>) =>
  lines.reduce((t, l) => { const s = stock.get(l.itemId); const q = s ? convertQty(l.quantity, l.unit, s.unit) : null; return t + (s && q != null ? q * s.costPerUnit : 0); }, 0);

/**
 * Recipes (the MD): what one of each dish or drink takes from the stores. When the order is ready,
 * the system takes it off stock — 10 Beef Burgers × 150 g = 1.5 kg of Beef. Dishes without a recipe
 * take nothing.
 */
export function RecipesView({ menu, items }: { menu: Dish[]; items: Stock[] }) {
  const stock = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(menu.find((d) => d.recipe.length)?.id ?? menu[0]?.id ?? null);
  const t = q.trim().toLowerCase();
  const list = menu.filter((d) => !t || `${d.name} ${d.category.name}`.toLowerCase().includes(t));
  const dish = menu.find((d) => d.id === sel) ?? null;
  const withRecipe = menu.filter((d) => d.recipe.length).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div className="border-b border-border/70 p-3">
          <p className="mb-2 px-1 text-xs text-muted-foreground">{withRecipe} of {menu.length} dishes and drinks take stock when they are made.</p>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dish or drink…" className={cn(field, "pl-9")} /></div>
        </div>
        <ul className="max-h-[32rem] divide-y divide-border/50 overflow-y-auto">
          {list.map((d) => {
            const cost = costOf(d.recipe, stock);
            return (
              <li key={d.id}>
                <button type="button" onClick={() => setSel(d.id)} aria-pressed={sel === d.id} className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors", sel === d.id ? "bg-[oklch(0.75_0.12_80/0.12)]" : "hover:bg-muted/40")}>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{d.name}</span><span className="block truncate text-[11px] text-muted-foreground">{d.category.name} · {tzs(d.price)}</span></span>
                  {d.recipe.length ? (
                    <span className="shrink-0 text-right text-[11px]"><span className="block font-semibold">{d.recipe.length} item{d.recipe.length === 1 ? "" : "s"}</span>{cost > 0 && <span className="text-muted-foreground">cost {Math.round((cost / Math.max(1, d.price)) * 100)}%</span>}</span>
                  ) : <span className="shrink-0 text-[11px] text-muted-foreground/70">no recipe</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {dish ? <RecipeEditor key={dish.id} dish={dish} items={items} stock={stock} /> : <p className="text-sm text-muted-foreground">Choose a dish.</p>}
    </div>
  );
}

function RecipeEditor({ dish, items, stock }: { dish: Dish; items: Stock[]; stock: Map<string, Stock> }) {
  const { pending, run } = useRun();
  const [lines, setLines] = useState(dish.recipe.map((l) => ({ ...l, qty: String(l.quantity) })));
  const [adding, setAdding] = useState("");
  const clean = lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.qty) || 0, unit: l.unit }));
  const cost = costOf(clean, stock);
  const add = (id: string) => {
    const s = stock.get(id); if (!s || lines.some((l) => l.itemId === id)) return;
    const unit = s.unit === "KG" ? "G" : s.unit === "L" ? "ML" : s.unit;
    setLines((x) => [...x, { itemId: id, quantity: 0, unit, qty: "" }]); setAdding("");
  };
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><ChefHat className="size-4 text-[oklch(0.7_0.12_78)]" />Recipe · one {dish.type === "DRINK" ? "drink" : "portion"}</p>
      <h3 className="mt-1 text-lg font-semibold">{dish.name}</h3>
      <p className="text-xs text-muted-foreground">Sells for {tzs(dish.price)}{cost > 0 ? ` · stock cost ${tzs(cost)} (${Math.round((cost / Math.max(1, dish.price)) * 100)}%)` : ""}</p>
      <ul className="mt-4 space-y-2">
        {lines.map((l, idx) => {
          const s = stock.get(l.itemId);
          const q = Number(l.qty) || 0;
          const inStock = s ? convertQty(q, l.unit, s.unit) : null;
          return (
            <li key={l.itemId} className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto] items-center gap-2">
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{s?.name ?? "?"}</span><span className="block truncate text-[11px] text-muted-foreground">{s ? `${s.department.name}${inStock != null && q > 0 && l.unit !== s.unit ? ` · ${inStock} ${unitOf(s.unit).plural}` : ""}` : "switched off"}</span></span>
              <input inputMode="decimal" value={l.qty} onChange={(e) => setLines((x) => x.map((y, i) => (i === idx ? { ...y, qty: e.target.value.replace(/[^\d.]/g, "") } : y)))} placeholder="0" aria-label={`Amount of ${s?.name}`} className={cn(field, "h-9 tabular-nums")} />
              <select value={l.unit} onChange={(e) => setLines((x) => x.map((y, i) => (i === idx ? { ...y, unit: e.target.value } : y)))} className={cn(field, "h-9 px-2")} aria-label="Unit">
                {(s ? compatibleUnits(s.unit) : [l.unit]).map((u) => <option key={u} value={u}>{unitOf(u).plural}</option>)}
              </select>
              <button type="button" aria-label={`Remove ${s?.name}`} onClick={() => setLines((x) => x.filter((_, i) => i !== idx))} className="grid size-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <select value={adding} onChange={(e) => add(e.target.value)} className={field} aria-label="Add a stock item">
          <option value="">Add a stock item…</option>
          {items.filter((i) => !lines.some((l) => l.itemId === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name} · {i.department.name}</option>)}
        </select>
      </div>
      <GoldButton pending={pending} disabled={clean.some((l) => l.quantity <= 0)} onClick={() => run(() => saveRecipeAction({ menuItemId: dish.id, lines: clean }))} className="mt-4 w-full">
        {clean.length ? "Save recipe" : "Save — no stock for this dish"}
      </GoldButton>
      <p className="mt-2 text-[11px] text-muted-foreground">Taken off stock when the order is marked ready (or closes). Changes are recorded in the audit history.</p>
    </section>
  );
}
