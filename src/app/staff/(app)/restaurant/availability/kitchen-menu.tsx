"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, CircleSlash, Loader2, Search, UtensilsCrossed, Wine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderMenuSection } from "@/components/ordering/menu-picker";
import { setDishAvailableAction } from "../portal-actions";

/**
 * The kitchen's menu: all dishes and drinks with their photos. "Sold out" hides the
 * Add button for customers (room QR, website) and staff at once; "Available" brings it back.
 */
export function KitchenMenu({ sections }: { sections: OrderMenuSection[] }) {
  const [active, setActive] = useState("all");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const soldOut = sections.flatMap((s) => s.items).filter((i) => !i.available).length;
  const shown = sections
    .filter((s) => active === "all" || s.id === active || (active === "out" && s.items.some((i) => !i.available)))
    .map((s) => ({ ...s, items: s.items.filter((i) => (active !== "out" || !i.available) && (!needle || `${i.name} ${i.description ?? ""}`.toLowerCase().includes(needle))) }))
    .filter((s) => s.items.length);
  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-linear-to-r from-[#2a1d10] via-[#1c1610] to-[#141a24] p-5 text-white">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-300"><BookOpen className="size-4" />Kitchen & bar</p>
        <h1 className="mt-1 font-display text-3xl font-semibold">Our menu</h1>
        <p className="mt-1 text-sm text-white/70">Run out of something? Tap <strong className="text-white">Sold out</strong> — customers and waiters can&apos;t order it until you tap <strong className="text-white">Available</strong> again.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/50" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dish or drink" className="h-10 w-64 rounded-xl bg-white/10 pl-9 pr-3 text-sm text-white outline-none ring-1 ring-white/15 placeholder:text-white/40 focus:ring-amber-300/60" />
          </label>
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", soldOut ? "bg-rose-500/20 text-rose-200" : "bg-emerald-500/15 text-emerald-200")}>{soldOut ? `${soldOut} sold out` : "Everything available"}</span>
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {[{ id: "all", name: "Everything" }, ...(soldOut ? [{ id: "out", name: "Sold out" }] : []), ...sections].map((s) => (
          <button key={s.id} type="button" onClick={() => setActive(s.id)}
            className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors", active === s.id ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>{s.name}</button>
        ))}
      </div>

      {shown.map((s) => (
        <section key={s.id}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{s.drink ? <Wine className="size-4" /> : <UtensilsCrossed className="size-4" />}{s.name}</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
            {s.items.map((i) => <Dish key={i.id} item={i} drink={s.drink} />)}
          </ul>
        </section>
      ))}
      {shown.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches.</p>}
    </div>
  );
}

function Dish({ item, drink }: { item: OrderMenuSection["items"][number]; drink: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const toggle = () => start(async () => {
    const res = await setDishAvailableAction({ id: item.id, isAvailable: !item.available });
    if (res.ok) { toast.success(res.message ?? "Saved."); router.refresh(); } else toast.error(res.error);
  });
  return (
    <li className={cn("overflow-hidden rounded-2xl border bg-card transition", item.available ? "border-border/70" : "border-rose-500/40")}>
      <div className="relative aspect-[16/10] bg-muted">
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt="" loading="lazy" className={cn("size-full object-cover", !item.available && "grayscale")} />
        ) : <span className="grid size-full place-items-center">{drink ? <Wine className="size-7 text-muted-foreground" /> : <UtensilsCrossed className="size-7 text-muted-foreground" />}</span>}
        {!item.available && <span className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1 rounded-full bg-rose-600 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-white"><CircleSlash className="size-3.5" />Sold out</span>}
      </div>
      <div className="space-y-2 p-3">
        <p className="font-semibold leading-tight">{item.name}</p>
        {item.description && <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}
        <button type="button" onClick={toggle} disabled={pending}
          className={cn("flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition disabled:opacity-60",
            item.available ? "border border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-300" : "bg-emerald-600 text-white hover:bg-emerald-700")}>
          {pending && <Loader2 className="size-4 animate-spin" />}{item.available ? "Sold out" : "Available again"}
        </button>
      </div>
    </li>
  );
}
