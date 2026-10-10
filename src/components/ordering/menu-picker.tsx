"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { ChefHat, Minus, Plus, Search, ShoppingBag, UtensilsCrossed, Wine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

export type OrderMenuItem = { id: string; name: string; description: string | null; price: number; available: boolean; image: string | null };
export type OrderMenuSection = { id: string; name: string; drink: boolean; items: OrderMenuItem[] };

export const GOLD = "#e3bd6a";
export const GOLD_GRADIENT = "linear-gradient(120deg,#f6dc9c,#e3bd6a 55%,#c89a43)";
export const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The basket: menu item id → how many. */
export function useBasket(sections: OrderMenuSection[]) {
  const [basket, setBasket] = useState<Record<string, number>>({});
  const all = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const lines = Object.entries(basket).map(([id, qty]) => ({ item: all.find((i) => i.id === id)!, qty })).filter((l) => l.item);
  const setQty = (id: string, qty: number) => setBasket((b) => {
    const next = { ...b };
    if (qty <= 0) delete next[id]; else next[id] = Math.min(20, qty);
    return next;
  });
  return {
    basket, lines, setQty, clear: () => setBasket({}),
    count: lines.reduce((t, l) => t + l.qty, 0),
    subtotal: lines.reduce((t, l) => t + l.qty * l.item.price, 0),
    payload: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.qty })),
  };
}

export type Basket = ReturnType<typeof useBasket>;
const BasketContext = createContext<Basket | null>(null);

/**
 * One basket for a whole page — the moving dish showcase at the top, the sliding strip and the
 * menu below all add to the same order. Pages without it (just browsing) show no Add buttons up top.
 */
export function BasketProvider({ sections, children }: { sections: OrderMenuSection[]; children: React.ReactNode }) {
  const b = useBasket(sections);
  return <BasketContext.Provider value={b}>{children}</BasketContext.Provider>;
}
/** The page's shared basket (null when the page has none). */
export const useBasketContext = () => useContext(BasketContext);
/** The page's shared basket if there is one, else this component's own. */
export function useSharedBasket(sections: OrderMenuSection[]) {
  const own = useBasket(sections);
  return useContext(BasketContext) ?? own;
}

/**
 * The live menu for ordering: search, sections, dishes and drinks as photo cards
 * with a gold "Add" and a quantity stepper. Prices come from the hotel's menu —
 * "Currently unavailable" items cannot be added.
 */
export function MenuPicker({ sections, basket, setQty, canOrder, title, subtitle, notice }: {
  sections: OrderMenuSection[]; basket: Record<string, number>; setQty: (id: string, qty: number) => void; canOrder: boolean;
  title: string; subtitle: React.ReactNode; notice?: React.ReactNode;
}) {
  const t = useT();
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [q, setQ] = useState("");
  const needle = norm(q.trim());
  // Found by the English AND by what this person reads (their language).
  const finds = (i: OrderMenuItem, s: OrderMenuSection) => norm(`${i.name} ${i.description ?? ""} ${s.name} ${t(i.name)} ${i.description ? t(i.description) : ""} ${t(s.name)}`).includes(needle);
  const shown = needle
    ? sections.map((s) => ({ ...s, items: s.items.filter((i) => finds(i, s)) })).filter((s) => s.items.length)
    : sections.filter((s) => s.id === active);

  return (
    <section id="menu" className="scroll-mt-4 overflow-hidden rounded-3xl border border-white/10 bg-[#111833]/90 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.8)]">
      <div className="relative overflow-hidden px-4 pb-3 pt-5 sm:px-5">
        <div aria-hidden className="absolute -right-12 -top-16 size-48 rounded-full bg-[#e3bd6a]/12 blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: GOLD }}>{t("Restaurant & bar")}</p>
            <h2 className="font-display text-3xl leading-tight">{title}</h2>
            <p className="mt-1 text-sm text-white/65">{subtitle}</p>
          </div>
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#e3bd6a]/15 ring-1 ring-[#e3bd6a]/40"><ChefHat className="size-6" style={{ color: GOLD }} /></span>
        </div>
        {notice}
        <label className="relative mt-4 block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/45" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search — chips, juice, beer, chicken…")} aria-label={t("Search the menu")}
            className="h-12 w-full rounded-2xl bg-white/[0.07] pl-10 pr-9 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus:ring-[#e3bd6a]/70" />
          {q && <button type="button" onClick={() => setQ("")} aria-label={t("Clear search")} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50"><X className="size-4" /></button>}
        </label>
      </div>

      {!needle && (
        <div className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-y border-white/10 bg-[#111833]/95 px-4 py-2.5 backdrop-blur sm:px-5 [scrollbar-width:none]">
          {sections.map((s) => (
            <button key={s.id} type="button" onClick={() => setActive(s.id)}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors",
                active === s.id ? "text-[#1a1206]" : "bg-white/[0.06] text-white/75 hover:bg-white/10")}
              style={active === s.id ? { background: GOLD } : undefined}>
              {s.drink ? <Wine className="size-3.5" /> : <UtensilsCrossed className="size-3.5" />}{t(s.name)}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 pb-5 pt-4 sm:px-5">
        {shown.length === 0 && <p className="py-10 text-center text-sm text-white/55">{t("Nothing found for “{q}”.", { q })}</p>}
        {shown.map((s) => (
          <div key={s.id} className="mb-4 last:mb-0">
            {needle && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: GOLD }}>{t(s.name)}</p>}
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {s.items.map((i) => {
                const qty = basket[i.id] ?? 0;
                return (
                  <li key={i.id} className={cn("group flex overflow-hidden rounded-2xl border bg-white/[0.04] transition duration-300 sm:flex-col sm:hover:-translate-y-0.5 sm:hover:border-white/25 sm:hover:shadow-[0_24px_50px_-30px_rgba(0,0,0,0.9)]",
                    qty ? "border-[#e3bd6a]/70" : "border-white/10", !i.available && "opacity-55")}>
                    <div className="relative w-28 shrink-0 overflow-hidden sm:aspect-[4/3] sm:w-full">
                      {i.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.image} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition duration-700 group-hover:scale-105 motion-reduce:transition-none" />
                      ) : (
                        <span className="absolute inset-0 grid place-items-center bg-linear-to-br from-[#1b2550] to-[#0d1430]">{s.drink ? <Wine className="size-7 text-white/30" /> : <UtensilsCrossed className="size-7 text-white/30" />}</span>
                      )}
                      {qty > 0 && <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-full text-xs font-bold text-[#1a1206] shadow" style={{ background: GOLD }}>{qty}</span>}
                      {!i.available && <span className="absolute inset-x-2 bottom-2 rounded-full bg-black/70 px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wider">{t("Currently unavailable")}</span>}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col p-3">
                      <p className="text-[15px] font-semibold leading-snug">{t(i.name)}</p>
                      {i.description && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-white/55">{t(i.description)}</p>}
                      <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
                        <span className="whitespace-nowrap text-[15px] font-semibold tabular-nums" style={{ color: GOLD }}>{tzs(i.price)}</span>
                        {!i.available ? <span className="text-xs text-white/50">{t("Not now")}</span>
                          : canOrder && (qty === 0 ? (
                            <button type="button" onClick={() => setQty(i.id, 1)} aria-label={t("Add {name}", { name: t(i.name) })}
                              className="inline-flex h-9 items-center gap-1 rounded-full px-4 text-sm font-semibold text-[#1a1206] shadow-[0_8px_20px_-8px_rgba(227,189,106,0.9)] active:scale-95" style={{ background: GOLD }}>
                              <Plus className="size-4" />{t("Add")}
                            </button>
                          ) : <Stepper qty={qty} name={t(i.name)} onChange={(v) => setQty(i.id, v)} />)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The gold bar at the bottom once something is in the basket. */
export function BasketBar({ count, total, sub, onOpen, className }: { count: number; total: number; sub: string; onOpen: () => void; className?: string }) {
  const t = useT();
  if (!count) return null;
  return (
    <div className={cn("fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-4", className)}>
      <button type="button" onClick={onOpen}
        className="mx-auto flex h-16 w-full max-w-xl items-center gap-3 rounded-2xl px-4 text-[#1a1206] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)]" style={{ background: GOLD_GRADIENT }}>
        <span className="relative"><ShoppingBag className="size-6" /><span className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-[#0b1026] text-[10px] font-bold text-white">{count}</span></span>
        <span className="flex-1 text-left leading-tight"><span className="block text-[15px] font-bold">{t("View your order")}</span><span className="text-xs opacity-75">{t.plural(count, "{n} item", "{n} items")} · {sub}</span></span>
        <span className="text-base font-bold tabular-nums">{tzs(total)}</span>
      </button>
    </div>
  );
}

/** The basket lines with steppers, the delivery fee and the total (inside the review sheet). */
export function BasketLines({ lines, setQty, fee }: { lines: { item: OrderMenuItem; qty: number }[]; setQty: (id: string, qty: number) => void; fee: number }) {
  const t = useT();
  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.item.price, 0);
  return (
    <ul className="divide-y divide-white/10 rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
      {lines.map((l) => (
        <li key={l.item.id} className="flex items-center gap-3 px-3 py-2.5">
          {l.item.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={l.item.image} alt="" className="size-11 shrink-0 rounded-xl object-cover" />
            : <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/[0.06]"><UtensilsCrossed className="size-4 text-white/40" /></span>}
          <span className="min-w-0 flex-1 leading-tight"><span className="line-clamp-2 text-sm font-medium">{t(l.item.name)}</span><span className="text-xs tabular-nums text-white/50">{t("{price} each", { price: tzs(l.item.price) })} · {tzs(l.item.price * l.qty)}</span></span>
          <Stepper qty={l.qty} name={t(l.item.name)} onChange={(v) => setQty(l.item.id, v)} />
        </li>
      ))}
      {fee > 0 && <li className="flex justify-between px-3 py-2 text-sm text-white/60"><span>{t("Room service delivery")}</span><span className="tabular-nums">{fee.toLocaleString("en-US")}</span></li>}
      <li className="flex justify-between px-3 py-3 text-lg font-semibold"><span>{t("Total")}</span><span className="tabular-nums" style={{ color: GOLD }}>{tzs(subtotal + fee)}</span></li>
    </ul>
  );
}

/** Bottom sheet on phones, centred card on larger screens. */
export function Sheet({ title, eyebrow, onClose, children, busy }: { title: string; eyebrow?: string; onClose: () => void; children: React.ReactNode; busy?: boolean }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in-0 sm:items-center" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="max-h-[92svh] w-full max-w-xl overflow-y-auto rounded-t-[1.75rem] border border-white/10 bg-[#111833] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white animate-in slide-in-from-bottom-8 sm:rounded-[1.75rem]">
        <div className="flex items-center justify-between">
          <div>
            {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: GOLD }}>{eyebrow}</p>}
            <h3 className="font-display text-2xl">{title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="grid size-9 place-items-center rounded-full bg-white/10"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stepper({ qty, name, onChange }: { qty: number; name: string; onChange: (qty: number) => void }) {
  const t = useT();
  return (
    <div className="flex h-9 shrink-0 items-center rounded-full bg-white/10 ring-1 ring-[#e3bd6a]/50">
      <button type="button" onClick={() => onChange(qty - 1)} aria-label={t("One less {name}", { name })} className="grid size-9 place-items-center"><Minus className="size-3.5" /></button>
      <span className="w-5 text-center text-sm font-bold tabular-nums">{qty}</span>
      <button type="button" disabled={qty >= 20} onClick={() => onChange(qty + 1)} aria-label={t("One more {name}", { name })} className="grid size-9 place-items-center disabled:opacity-40"><Plus className="size-3.5" /></button>
    </div>
  );
}

/** A fresh idempotency key for one submit (kept while retrying, so a second tap never makes a second order). */
export function newClientKey() {
  // getRandomValues works on plain-http pages too (randomUUID does not).
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
