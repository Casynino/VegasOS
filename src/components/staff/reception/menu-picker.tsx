"use client";

import { useMemo, useState } from "react";
import { Flame, Search, UtensilsCrossed, Wine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BillMenu } from "@/server/services/restaurant";

export type MenuEntry = BillMenu["categories"][number]["items"][number];

/**
 * Pick from the restaurant & bar menu: search, "Popular" (most ordered lately)
 * and one chip per menu section; every item is a card with its photo and price.
 * `drinksOnly` keeps it to the bar. Tapping an item adds one; the badge shows how many.
 */
export function MenuPicker({ menu, drinksOnly = false, counts, onAdd }: {
  menu: BillMenu; drinksOnly?: boolean; counts: Record<string, number>; onAdd: (item: MenuEntry) => void;
}) {
  const cats = useMemo(() => menu.categories.filter((c) => !drinksOnly || c.type === "DRINK"), [menu.categories, drinksOnly]);
  const all = useMemo(() => cats.flatMap((c) => c.items.map((i) => ({ ...i, category: c.name }))), [cats]);
  const popular = useMemo(() => menu.popular.map((id) => all.find((i) => i.id === id)).filter((i): i is (typeof all)[number] => !!i).slice(0, 12), [menu.popular, all]);
  const [chip, setChip] = useState<string>(popular.length ? "popular" : cats[0]?.id ?? "");
  const [q, setQ] = useState("");
  const on = chip === "popular" && !popular.length ? cats[0]?.id ?? "" : chip;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? all.filter((i) => i.name.toLowerCase().includes(needle) || i.category.toLowerCase().includes(needle))
    : on === "popular" ? popular : all.filter((i) => cats.find((c) => c.id === on)?.items.some((x) => x.id === i.id));

  return (
    // A size container: columns follow the space the picker really has (narrow check-out panel vs wide dialog),
    // and nothing inside can stretch the dialog or panel around it.
    <div className="@container space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the menu"
          placeholder={drinksOnly ? "Search drinks — Safari, Hennessy, soda…" : "Search the menu — biryani, chips, Safari…"}
          className="h-10 w-full rounded-xl border border-border bg-muted/40 pl-9 pr-9 text-sm outline-none transition focus:border-foreground/30 focus:bg-background" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
      </div>

      {!needle && (
        <div className="flex flex-wrap gap-1.5">
          {popular.length > 0 && (
            <button type="button" onClick={() => setChip("popular")} aria-pressed={on === "popular"}
              className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition", on === "popular" ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
              <Flame className="size-3.5" />Popular
            </button>
          )}
          {cats.map((c) => (
            <button key={c.id} type="button" onClick={() => setChip(c.id)} aria-pressed={on === c.id}
              className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition", on === c.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
              {c.type === "DRINK" ? <Wine className="size-3.5" /> : <UtensilsCrossed className="size-3.5" />}{c.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid max-h-[21rem] auto-rows-min grid-cols-1 gap-1.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:thin] @[17rem]:grid-cols-2 @[30rem]:grid-cols-3">
        {shown.map((i) => {
          const qty = counts[i.id] ?? 0;
          return (
            <button key={i.id} type="button" disabled={!i.isAvailable} onClick={() => onAdd(i)} title={i.description ?? i.name}
              className={cn("group relative flex items-center gap-2.5 rounded-xl border p-1.5 pr-2 text-left transition",
                !i.isAvailable ? "cursor-not-allowed border-dashed border-border opacity-50"
                  : qty ? "border-emerald-500/70 bg-emerald-500/[0.07]" : "border-border/70 bg-card hover:border-foreground/30 hover:bg-muted/40")}>
              {i.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={i.image} alt="" loading="lazy" decoding="async" className="size-11 shrink-0 rounded-lg object-cover" />
                : <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{i.type === "DRINK" ? <Wine className="size-4" /> : <UtensilsCrossed className="size-4" />}</span>}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="line-clamp-2 text-[12.5px] font-medium">{i.name}</span>
                <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">{i.isAvailable ? i.price.toLocaleString("en-US") : "Not available"}</span>
              </span>
              {qty > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-emerald-600 text-[10px] font-bold text-white ring-2 ring-card">{qty}</span>}
            </button>
          );
        })}
        {shown.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">{needle ? `Nothing on the menu matches “${q}”.` : "Nothing here yet."}</p>}
      </div>
    </div>
  );
}
