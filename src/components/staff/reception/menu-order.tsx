"use client";

import { Plus, Trash2 } from "lucide-react";
import { formatTZS } from "@/lib/format";
import type { BillMenu } from "@/server/services/restaurant";
import { MenuPicker, type MenuEntry } from "./menu-picker";
import { useT } from "@/i18n/client";

export type MenuPick = { item: MenuEntry; qty: number };

/** Add one of a menu item (or one more if it is already picked). */
export function addPick(picks: MenuPick[], item: MenuEntry): MenuPick[] {
  return picks.some((p) => p.item.id === item.id)
    ? picks.map((p) => (p.item.id === item.id ? { ...p, qty: Math.min(99, p.qty + 1) } : p))
    : [...picks, { item, qty: 1 }];
}
export const picksTotal = (picks: MenuPick[]) => picks.reduce((t, p) => t + p.qty * p.item.price, 0);
/** What the server needs — the item and how many; prices come from the menu there. */
export const picksPayload = (picks: MenuPick[]) => picks.map((p) => ({ menuItemId: p.item.id, quantity: p.qty }));

/**
 * Food & drinks from the menu for a booking: the picker (photos, popular,
 * sections, search) and the picked items with their photo, quantity and price.
 * Used by New booking and when confirming an online booking.
 */
export function MenuOrder({ menu, picks, onChange, extraLine }: {
  menu: BillMenu; picks: MenuPick[]; onChange: (picks: MenuPick[]) => void;
  /** e.g. the room-service delivery fee. */
  extraLine?: { label: string; amount: number } | null;
}) {
  const t = useT();
  const setQty = (id: string, qty: number) => onChange(qty <= 0 ? picks.filter((p) => p.item.id !== id) : picks.map((p) => (p.item.id === id ? { ...p, qty } : p)));
  return (
    <div className="space-y-3">
      <MenuPicker menu={menu} counts={Object.fromEntries(picks.map((p) => [p.item.id, p.qty]))} onAdd={(item) => onChange(addPick(picks, item))} />
      {picks.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
          {picks.map((p) => (
            <li key={p.item.id} className="flex items-center gap-3 px-3 py-2">
              {p.item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.item.image} alt="" className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-border/60" />
              ) : <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted"><Plus className="size-4 text-muted-foreground" /></span>}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-medium">{t(p.item.name)}</span>
                <span className="block text-[11px] tabular-nums text-muted-foreground">{t("{amount} each", { amount: formatTZS(p.item.price) })}</span>
              </span>
              <div className="flex h-7 items-center rounded-lg border border-border bg-card">
                <button type="button" className="px-1.5" onClick={() => setQty(p.item.id, p.qty - 1)} aria-label={t("One less {item}", { item: t(p.item.name) })}>−</button>
                <span className="w-5 text-center text-xs font-semibold tabular-nums">{p.qty}</span>
                <button type="button" className="px-1.5 disabled:opacity-30" disabled={p.qty >= 99} onClick={() => setQty(p.item.id, p.qty + 1)} aria-label={t("One more {item}", { item: t(p.item.name) })}>+</button>
              </div>
              <span className="w-24 text-right text-sm font-semibold tabular-nums">{formatTZS(p.qty * p.item.price)}</span>
              <button type="button" aria-label={t("Remove {item}", { item: t(p.item.name) })} onClick={() => setQty(p.item.id, 0)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-rose-600"><Trash2 className="size-4" /></button>
            </li>
          ))}
          {extraLine && extraLine.amount > 0 && <li className="flex justify-between px-3 py-2 text-xs"><span className="text-muted-foreground">{t(extraLine.label)}</span><span className="tabular-nums">{formatTZS(extraLine.amount)}</span></li>}
          <li className="flex justify-between px-3 py-2 text-sm"><span className="text-muted-foreground">{t("Food & drinks")}</span><strong className="tabular-nums">{formatTZS(picksTotal(picks) + (extraLine?.amount ?? 0))}</strong></li>
        </ul>
      )}
    </div>
  );
}
