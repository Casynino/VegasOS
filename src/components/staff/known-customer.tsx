"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Crown, Loader2, UserPlus } from "lucide-react";
import { validPhone } from "@/lib/guest-messages";
import { formatBusinessDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { KnownCustomer } from "@/server/services/guests";
import { customerByPhoneAction } from "./customer-actions";

export type CustomerLookup = { customer: KnownCustomer | null; looking: boolean; checked: boolean; failed?: boolean };

/**
 * The phone number is the customer's key: as staff type it, find who it belongs to (after a
 * short pause). `onFound` runs once for each customer found — e.g. to fill in their name.
 */
export function useKnownCustomer(phone: string, onFound?: (c: KnownCustomer) => void): CustomerLookup {
  const [found, setFound] = useState<{ phone: string; customer: KnownCustomer | null; failed?: boolean } | null>(null);
  const cb = useRef(onFound);
  useEffect(() => { cb.current = onFound; });
  const valid = validPhone(phone);
  useEffect(() => {
    if (!valid) return;
    let stop = false;
    const t = setTimeout(async () => {
      const res = await customerByPhoneAction(phone).catch(() => null);
      if (stop) return;
      if (!res?.ok) { setFound({ phone, customer: null, failed: true }); return; }
      setFound({ phone, customer: res.data });
      if (res.data) cb.current?.(res.data);
    }, 350);
    return () => { stop = true; clearTimeout(t); };
  }, [phone, valid]);
  const now = valid && found?.phone === phone ? found : null;
  return { customer: now?.customer ?? null, checked: !!now && !now.failed, looking: valid && !now, failed: !!now?.failed };
}

/** Under the phone field: who this number is — or that a new customer will be saved with it. */
export function KnownCustomerNote({ phone, lookup, className, action }: { phone: string; lookup: CustomerLookup; className?: string; /** e.g. "Someone else", at the right of a found customer. */ action?: React.ReactNode }) {
  if (!validPhone(phone) || lookup.failed) return null;
  if (lookup.looking) return <p className={cn("flex items-center gap-1.5 px-1 text-xs text-muted-foreground", className)}><Loader2 className="size-3.5 animate-spin" />Checking the number…</p>;
  const c = lookup.customer;
  if (!c) return <p className={cn("flex items-center gap-1.5 px-1 text-xs text-muted-foreground", className)}><UserPlus className="size-3.5" />New customer — saved with this number.</p>;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const facts = [
    c.room ? `in room ${c.room}` : null,
    c.table ? `at ${c.table} now` : null,
    c.stays ? plural(c.stays, "stay") : null,
    c.orders ? plural(c.orders, "order") : null,
    c.lastVisit ? `last ${formatBusinessDate(c.lastVisit).replace(/^\w+,?\s*/, "")}` : null,
  ].filter(Boolean);
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2", className)}>
      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="truncate">{c.name}</span>
          {c.vip && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[oklch(0.75_0.13_80)]/20 px-1.5 text-[9px] font-bold text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]"><Crown className="size-2.5" />VIP</span>}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">Known customer{facts.length ? ` · ${facts.join(" · ")}` : ""}{c.reference ? ` · ${c.reference}` : ""}</span>
      </span>
      {action}
    </div>
  );
}
