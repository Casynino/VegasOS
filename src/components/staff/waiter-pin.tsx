"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, HandPlatter, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Initials } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { colleaguesAction } from "@/app/staff/(app)/restaurant/waiter-actions";

/**
 * "Who serves it?" on the shared Restaurant Counter. Service work there (a new order, Accept / Serve on
 * an order nobody has, seating…) is done for a waiter picked from the list of waiters on shift — tap a
 * name, that waiter serves it. No code or password: waiters never handle money (the Counter records it).
 * On anyone's own account (a waiter's phone, reception, a manager) nothing is asked: `ask()` resolves
 * `undefined` at once.
 *
 *   const askPin = useWaiterPin();
 *   const pin = await askPin("#12 · Table 4");
 *   if (pin === null) return;                    // they closed the list
 *   await someAction({ ..., pin });              // undefined off the Counter
 */

export type WaiterPinValue = { waiterId: string };
type Ask = (what: string) => Promise<WaiterPinValue | null | undefined>;
type Waiter = { id: string; name: string; number?: string | null; onShiftSince: string | null };

const Ctx = createContext<{ device: boolean; ask: Ask }>({ device: false, ask: async () => undefined });

/** Is this the shared Restaurant Counter? */
export const useIsRestaurantDevice = () => useContext(Ctx).device;
/** Ask who serves it (only on the shared Restaurant Counter). */
export const useWaiterPin = () => useContext(Ctx).ask;

export function WaiterPinProvider({ device, children }: { device: boolean; children: ReactNode }) {
  const [request, setRequest] = useState<{ what: string; resolve: (v: WaiterPinValue | null) => void } | null>(null);
  const [n, setN] = useState(0);
  const ask = useCallback<Ask>((what) => {
    if (!device) return Promise.resolve(undefined);
    return new Promise((resolve) => { setN((x) => x + 1); setRequest({ what, resolve }); });
  }, [device]);
  const finish = (v: WaiterPinValue | null) => { request?.resolve(v); setRequest(null); };
  return (
    <Ctx.Provider value={{ device, ask }}>
      {children}
      {/* A fresh list for every ask (keyed). */}
      {device && <WhoServes key={n} open={!!request} what={request?.what ?? ""} onDone={finish} />}
    </Ctx.Provider>
  );
}

const first = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/)[0];

/**
 * The waiters on shift as one clean list — initials, name, since when they are on shift — one tap and it
 * is done (nobody on shift: every waiter, and their shift starts with it).
 */
function WhoServes({ open, what, onDone }: { open: boolean; what: string; onDone: (v: WaiterPinValue | null) => void }) {
  const t = useT();
  const [waiters, setWaiters] = useState<Waiter[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    colleaguesAction().then((r) => {
      if (!live) return;
      if (r.ok) setWaiters(r.data);
      else toast.error(r.error);
    });
    return () => { live = false; };
  }, [open]);

  // Only the waiters on shift take work.
  const onShift = waiters?.filter((w) => w.onShiftSince) ?? [];
  const list = onShift;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDone(null)}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out. */}
        <DialogHeader icon={<HandPlatter />} eyebrow={t("Restaurant")} tone="gold" className="mx-0 mt-0">
          <DialogTitle>{t("Who serves it?")}</DialogTitle>
          <DialogDescription className="truncate">{what}</DialogDescription>
          {waiters && (
            <p className="mt-2 flex items-center gap-2 text-xs text-white/70">
              <span className={cn("size-1.5 rounded-full", onShift.length ? "bg-emerald-500" : "bg-amber-500")} />
              {onShift.length
                ? t.plural(onShift.length, "{n} waiter on shift — tap the one who serves it", "{n} waiters on shift — tap the one who serves it")
                : t("Nobody is on shift yet")}
            </p>
          )}
        </DialogHeader>

        {!waiters ? (
          <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
        ) : !list.length ? (
          <p className="m-4 rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{waiters.length ? t("No waiter is on shift. A waiter taps “Start my shift” on their phone — then they show here.") : t("No waiters yet — the MD adds them in Staff & roles.")}</p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto p-2 pt-3">
            {list.map((w) => (
              <li key={w.id}>
                <button type="button" onClick={() => onDone({ waiterId: w.id })}
                  className="group flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-left transition hover:border-[oklch(0.75_0.12_80/0.4)] hover:bg-[oklch(0.72_0.12_80/0.07)] focus-visible:border-[oklch(0.75_0.12_80/0.6)] focus-visible:outline-none active:scale-[0.99]">
                  <span className="relative shrink-0">
                    <Initials name={w.name} className="size-11 text-sm" />
                    {w.onShiftSince && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-popover bg-emerald-500" aria-label={t("On shift")} />}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex min-w-0 items-baseline gap-2"><span className="truncate text-[15px] font-semibold">{first(w.name)}</span>{w.number && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{w.number}</span>}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{w.onShiftSince ? t("On shift · since {time}", { time: t.time(w.onShiftSince) }) : t("Not on shift")}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/60 transition group-hover:translate-x-0.5 group-hover:text-[oklch(0.84_0.11_82)]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
