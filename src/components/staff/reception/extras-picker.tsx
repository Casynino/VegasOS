"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { formatTZS } from "@/lib/format";
import { CHARGE_TYPES, type ChargeTypeCode } from "@/lib/charge-types";
import { Input } from "@/components/ui/input";
import type { BillMenu } from "@/server/services/restaurant";
import { MenuOrder, picksPayload, picksTotal, type MenuPick } from "./menu-order";

/** An item typed in by hand (not on the menu): laundry, transport, extra bed… */
export type ExtraLine = { key: number; type: ChargeTypeCode; item: string; qty: number; unitPrice: string };

export const extrasTotal = (picks: MenuPick[], extras: ExtraLine[]) => picksTotal(picks) + extras.reduce((t, x) => t + x.qty * (Number(x.unitPrice) || 0), 0);
/** What the server needs: menu items by id (priced from the menu there) and typed-in charges. */
export const extrasPayload = (picks: MenuPick[], extras: ExtraLine[]) => ({
  menuItems: picks.length ? picksPayload(picks) : null,
  charges: extras.length ? extras.map((x) => ({ type: x.type, item: x.item.trim(), qty: x.qty, unitPrice: Math.round(Number(x.unitPrice)) })) : null,
});
export const extrasIncomplete = (extras: ExtraLine[]) => extras.some((x) => !x.item.trim() || !(Number(x.unitPrice) > 0));

let nextKey = 1;

/**
 * Food & drinks from the menu (photos, popular, sections, search) and anything
 * else typed in by hand — the same picker as a single booking, used per room
 * in a group booking.
 */
export function ExtrasPicker({ menu, picks, onPicks, extras, onExtras }: {
  menu: BillMenu | null; picks: MenuPick[]; onPicks: (p: MenuPick[]) => void; extras: ExtraLine[]; onExtras: (x: ExtraLine[]) => void;
}) {
  const set = (key: number, patch: Partial<ExtraLine>) => onExtras(extras.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const total = extrasTotal(picks, extras);
  return (
    <div className="space-y-5">
      {menu && menu.categories.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Food &amp; drinks from the menu</p>
          <MenuOrder menu={menu} picks={picks} onChange={onPicks} />
        </div>
      )}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{menu ? "Not on the menu? Type it in" : "Add an item"}</p>
        <div className="flex flex-wrap gap-1.5">
          {CHARGE_TYPES.map((c) => (
            <button key={c.code} type="button" onClick={() => onExtras([...extras, { key: nextKey++, type: c.code, item: c.label, qty: 1, unitPrice: "" }])}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-[oklch(0.75_0.13_80)]/70 hover:bg-[oklch(0.75_0.13_80)]/10">
              <Plus className="size-3" />{c.label}
            </button>
          ))}
        </div>
        {extras.length > 0 && (
          <ul className="space-y-2">
            {extras.map((x) => (
              <li key={x.key} className="grid grid-cols-[1fr_auto_7.5rem_auto] items-end gap-2 rounded-xl bg-muted/40 p-2.5">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{CHARGE_TYPES.find((c) => c.code === x.type)?.label}</p>
                  <Input value={x.item} onChange={(e) => set(x.key, { item: e.target.value })} placeholder="e.g. Dinner, 2 sodas" className="h-9" aria-label="Item" />
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground">Qty</p>
                  <div className="flex h-9 items-center rounded-lg border border-border bg-card">
                    <button type="button" className="px-1.5 disabled:opacity-30" disabled={x.qty <= 1} onClick={() => set(x.key, { qty: x.qty - 1 })} aria-label="One less"><Minus className="size-3" /></button>
                    <span className="w-5 text-center text-xs font-semibold tabular-nums">{x.qty}</span>
                    <button type="button" className="px-1.5 disabled:opacity-30" disabled={x.qty >= 99} onClick={() => set(x.key, { qty: x.qty + 1 })} aria-label="One more"><Plus className="size-3" /></button>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">Price each (TZS)</p>
                  <Input type="number" min={0} step={500} value={x.unitPrice} onChange={(e) => set(x.key, { unitPrice: e.target.value })} className="h-9 tabular-nums" aria-label="Price each" autoFocus={!x.unitPrice} />
                </div>
                <button type="button" aria-label="Remove item" onClick={() => onExtras(extras.filter((y) => y.key !== x.key))} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-rose-600"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {total > 0 && <p className="flex justify-between border-t border-dashed border-border pt-2 text-sm"><span className="text-muted-foreground">Food, drinks &amp; extras</span><strong className="tabular-nums">{formatTZS(total)}</strong></p>}
    </div>
  );
}
