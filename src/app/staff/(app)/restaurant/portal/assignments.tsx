"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Loader2, UserRoundCheck, UserRoundSearch } from "lucide-react";
import { Initials } from "@/components/dashboard/kit";
import { useIsRestaurantDevice, useWaiterPin } from "@/components/staff/waiter-pin";
import { cn } from "@/lib/utils";
import { takeChargeAction } from "../waiter-actions";
import { ACCENT, placeText, shortNo, since, tileText } from "./order-card";
import type { PortalOrder } from "./types";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

const DONE = ["COMPLETED", "COLLECTED", "CANCELLED"];
const WORD: Record<string, string> = {
  PENDING: msg("New"), ACCEPTED: msg("Accepted"), PREPARING: msg("Preparing"), READY: msg("Ready to serve"), OUT_FOR_DELIVERY: msg("Serving"), DELIVERED: msg("Served · to pay"),
};
const first = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/)[0];
const age = (o: PortalOrder, now: number, t: T) => since(Math.max(0, Math.round((now - Date.parse(o.createdAt)) / 60000)), t);
const oldestFirst = (a: PortalOrder, b: PortalOrder) => a.createdAt.localeCompare(b.createdAt);
/** Open orders nobody is serving yet, oldest first. */
// Delivered and paid online: nothing left for a waiter (reception records the customer's payment).
export const unassigned = (orders: PortalOrder[]) => orders.filter((o) => !DONE.includes(o.status) && !o.assignedTo && !(o.status === "DELIVERED" && o.proof)).sort(oldestFirst);

/** Most urgent first: food that is ready, then on the way, in the kitchen, new, delivered and still to pay — oldest first within each. */
const URGENCY: Record<string, number> = { READY: 0, OUT_FOR_DELIVERY: 1, PREPARING: 2, ACCEPTED: 2, PENDING: 3, DELIVERED: 4 };
const mostUrgent = (a: PortalOrder, b: PortalOrder) => (URGENCY[a.status] ?? 5) - (URGENCY[b.status] ?? 5) || oldestFirst(a, b);
/** Rows shown before "Show all". */
const SHOW = 5;

/**
 * Orders that have no waiter yet — one compact card between the day band and the board: the five most
 * urgent, the rest behind "Show all". A waiter takes charge of one (on the shared screen: their name
 * tile and PIN); managers see them and hand them from the card; reception sees who is still waiting
 * for a waiter. The kitchen never sees this.
 */
export function NoWaiterYet({ orders, now, canTake, watch }: { orders: PortalOrder[]; now: number; canTake: boolean; watch?: boolean }) {
  const router = useRouter();
  const t = useT();
  const askPin = useWaiterPin();
  const device = useIsRestaurantDevice();
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const list = unassigned(orders).sort(mostUrgent);
  if (!list.length) return null;
  const hidden = list.length - SHOW;
  const shown = all ? list : list.slice(0, SHOW);

  const take = async (o: PortalOrder) => {
    const pin = await askPin(t("Serve {no}", { no: shortNo(o.number) }));
    if (pin === null) return;
    setBusy(o.id);
    const res = await takeChargeAction({ orderId: o.id, pin }).finally(() => setBusy(null));
    if (res.ok) {
      const no = shortNo(res.data.number);
      const table = res.data.table ? t(res.data.table) : null;
      toast.success(pin && res.data.waiter
        ? table ? t("{name} is serving {no} (and {table}).", { name: first(res.data.waiter), no, table }) : t("{name} is serving {no}.", { name: first(res.data.waiter), no })
        : table ? t("You're serving {no} (and {table}).", { no, table }) : t("You're serving {no}.", { no }));
      router.refresh();
    } else toast.error(res.error);
  };
  const hint = canTake
    ? device ? t("Tap Serve, then choose the waiter.") : t("Tap Serve and you will hear when it is ready.")
    : watch ? t("Give each one to a waiter from its card.") : t("A waiter will serve each one.");

  return (
    <section id="no-waiter" aria-label={t("Orders with no waiter yet")} className="scroll-mt-24 overflow-hidden rounded-3xl border border-amber-500/30 bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 sm:px-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 [&_svg]:size-4"><UserRoundSearch /></span>
          {t("No waiter yet")}
          <span className="text-muted-foreground">·</span>
          <span className="tabular-nums text-amber-700 dark:text-amber-300">{list.length}</span>
        </h2>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground sm:text-right">{hint}</p>
      </div>
      <ul className={cn("divide-y divide-border/50", all && hidden > 0 && "max-h-[22rem] overflow-y-auto overscroll-contain [scrollbar-width:thin]")}>
        {shown.map((o) => {
          const a = ACCENT[o.status] ?? ACCENT.PENDING;
          const word = t(WORD[o.status] ?? o.status);
          return (
            <li key={o.id} className="flex min-w-0 items-center gap-3 px-3 py-2 sm:px-4">
              <span className={cn("grid h-9 min-w-9 shrink-0 place-items-center rounded-lg px-1 text-[11px] font-bold tabular-nums [&_svg]:size-4", a.tile)}>{tileText(o)}</span>
              <a href={`#order-${o.id}`} className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-semibold"><span className="font-mono text-[11px] font-normal text-muted-foreground">{shortNo(o.number)}</span> {placeText(o, t)}</span>
                {/* On a phone the step and the age go under the place; wider, they get their own columns. */}
                <span className="block truncate text-[11px] text-muted-foreground sm:hidden">
                  <span className={cn(o.status === "READY" && "font-semibold text-emerald-700 dark:text-emerald-300")}>{word}</span> · <span suppressHydrationWarning>{age(o, now, t)}</span>
                </span>
              </a>
              <span className="hidden w-32 shrink-0 sm:block"><span className={cn("inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-semibold", a.tile)}>{word}</span></span>
              <span suppressHydrationWarning className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">{age(o, now, t)}</span>
              {canTake && (
                <button type="button" disabled={!!busy} onClick={() => void take(o)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-3 text-xs font-semibold text-[oklch(0.2_0.03_60)] shadow-[0_8px_18px_-12px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 transition hover:brightness-105 active:scale-[0.97] disabled:opacity-60">
                  {busy === o.id ? <Loader2 className="size-3.5 animate-spin" /> : <UserRoundCheck className="size-3.5" />}{t("Serve")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border/60 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
          {all ? t("Show less") : t("Show all {n}", { n: list.length })}
          <ChevronDown className={cn("size-3.5 transition-transform", all && "rotate-180")} />
        </button>
      )}
    </section>
  );
}

/**
 * The shared screen and managers: every open order under the waiter responsible for it — the ones
 * with no waiter yet first. From the board itself (no extra query); each group folds away.
 */
export function Assignments({ orders, now }: { orders: PortalOrder[]; now: number }) {
  // "No waiter yet" starts folded: the compact list above already shows those orders, most urgent first.
  const t = useT();
  const [closed, setClosed] = useState<Set<string>>(() => new Set(["none"]));
  const open = orders.filter((o) => !DONE.includes(o.status)).sort(oldestFirst);
  const byWaiter = new Map<string, { id: string; name: string; orders: PortalOrder[] }>();
  for (const o of open) {
    if (!o.assignedTo) continue;
    const g = byWaiter.get(o.assignedTo.id) ?? { id: o.assignedTo.id, name: o.assignedTo.name, orders: [] };
    g.orders.push(o); byWaiter.set(g.id, g);
  }
  const none = open.filter((o) => !o.assignedTo);
  const groups = [
    ...(none.length ? [{ id: "none", name: "No waiter yet", orders: none }] : []),
    ...[...byWaiter.values()].sort((a, b) => a.name.localeCompare(b.name)),
  ];
  const toggle = (id: string) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <h2 className="text-base font-semibold">{t("Who serves what")}</h2>
          <p className="text-xs text-muted-foreground">{t("Every open order and the waiter responsible for it")}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{t("{n} open", { n: open.length })}</span>
      </div>
      {groups.length === 0 ? <p className="px-5 py-6 text-center text-xs text-muted-foreground">{t("No open orders right now.")}</p> : (
        <div className="mt-3 max-h-[20rem] divide-y divide-border/50 overflow-y-auto overscroll-contain border-t border-border/70 [scrollbar-width:thin]">
          {groups.map((g) => {
            const isNone = g.id === "none";
            const shut = closed.has(g.id);
            return (
              <div key={g.id}>
                <button type="button" onClick={() => toggle(g.id)} aria-expanded={!shut}
                  className={cn("flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-muted/40 sm:px-5", isNone && "bg-amber-500/[0.06]")}>
                  {isNone
                    ? <span className="grid size-7 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300"><UserRoundSearch className="size-3.5" /></span>
                    : <Initials name={first(g.name)} className="size-7 text-[10px]" />}
                  <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", isNone && "text-amber-800 dark:text-amber-200")}>{isNone ? t(g.name) : t("Waiter · {name}", { name: first(g.name) })}</span>
                  <span className={cn("min-w-6 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums", isNone ? "bg-amber-400 text-[#1b1611]" : "bg-muted text-muted-foreground")}>{g.orders.length}</span>
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", shut && "-rotate-90")} />
                </button>
                {!shut && (
                  <ul className="pb-1.5">
                    {g.orders.map((o) => (
                      <li key={o.id}>
                        <a href={`#order-${o.id}`} className="flex items-center gap-2 py-1 pl-[3.25rem] pr-4 text-xs transition-colors hover:bg-muted/40 sm:pl-14 sm:pr-5">
                          <span className="w-9 shrink-0 font-mono text-[11px] text-muted-foreground">{shortNo(o.number)}</span>
                          <span className="min-w-0 flex-1 truncate font-medium">{placeText(o, t)}</span>
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", (ACCENT[o.status] ?? ACCENT.PENDING).tile)}>{t(WORD[o.status] ?? o.status)}</span>
                          <span suppressHydrationWarning className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{age(o, now, t)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
