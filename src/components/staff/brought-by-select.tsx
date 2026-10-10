"use client";

import { useEffect, useEffectEvent, useId, useState } from "react";
import { HandCoins } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { useIsRestaurantDevice } from "@/components/staff/waiter-pin";
import { colleaguesAction } from "@/app/staff/(app)/restaurant/waiter-actions";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/**
 * "Brought by" — only on the shared Restaurant Counter. The Counter records every official restaurant
 * payment (it is "Restaurant Counter" on the record, never a person); a waiter may have carried the money
 * from the table, and this notes who — optional, and never the waiter's own collection. Prefilled with the
 * order's waiter once the list is in (only someone who can serve). Off the Counter it renders nothing,
 * so the value stays "" and nothing is sent.
 *
 *   const [broughtBy, setBroughtBy] = useState("");
 *   <BroughtBySelect value={broughtBy} onChange={setBroughtBy} prefill={o.assignedTo?.id} />
 *   await recordOrderPaymentAction({ ..., handedOverById: broughtBy || null });
 */

type Waiter = { id: string; name: string; onShift: boolean };

// One list for every payment form on the screen — asked again at most once a minute.
let cache: { at: number; list: Promise<Waiter[]> } | null = null;
function loadWaiters(): Promise<Waiter[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.list;
  const list = colleaguesAction()
    .then((r) => (r.ok ? r.data.map((w) => ({ id: w.id, name: w.name.replace(/\s*\(.*\)/, ""), onShift: !!w.onShiftSince })) : Promise.reject(new Error(r.error))))
    .catch(() => { cache = null; return [] as Waiter[]; });
  cache = { at: Date.now(), list };
  return list;
}

export function BroughtBySelect({ value, onChange, prefill, className }: {
  /** The chosen waiter's id ("" = nobody: the customer paid at the Counter). */
  value: string;
  onChange: (id: string) => void;
  /** The order's (or table's) waiter — picked once the list is in, when nothing is picked yet. */
  prefill?: string | null;
  className?: string;
}) {
  const t = useT();
  const device = useIsRestaurantDevice();
  const id = useId();
  const [waiters, setWaiters] = useState<Waiter[] | null>(null);
  const loaded = useEffectEvent((list: Waiter[]) => {
    setWaiters(list);
    if (!value && prefill && list.some((w) => w.id === prefill)) onChange(prefill);
  });
  useEffect(() => {
    if (!device) return;
    let live = true;
    void loadWaiters().then((list) => { if (live) loaded(list); });
    return () => { live = false; };
  }, [device]);

  if (!device) return null;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <HandCoins className="size-3.5" />{t("Brought by")}<span className="font-normal text-muted-foreground/80">{t("— optional")}</span>
      </label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={!waiters} className="h-10 rounded-xl">
        <option value="">{t("Nobody — the customer paid at the Counter")}</option>
        {waiters?.map((w) => <option key={w.id} value={w.id}>{w.name}{w.onShift ? "" : ` · ${t("off shift")}`}</option>)}
      </NativeSelect>
      <p className="text-[11px] leading-snug text-muted-foreground">{t("Recorded by the Restaurant Counter — this only notes the waiter who brought the money.")}</p>
    </div>
  );
}
