"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Armchair, ArrowRightLeft, HandPlatter, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { endWaiterShiftAction, transferAllAction, transferOrderAction, transferTableAction } from "../waiter-actions";
import { ACCENT, shortNo } from "../portal/order-card";
import { cn } from "@/lib/utils";
import { plural, STATUS_WORD, tzs, type TransferRequest } from "./shared";

const URGENCY: Record<string, number> = { READY: 0, OUT_FOR_DELIVERY: 1, PREPARING: 2, ACCEPTED: 2, PENDING: 3, DELIVERED: 4 };
/** "Table 4 — Inside" → T4, "Room 305" → 305; anything else gets an icon. */
const placeCode = (place: string) => {
  const t = /^table\s+(\d{1,3})\b/i.exec(place);
  if (t) return `T${t[1]}`;
  return /^room\s+(\w{1,5})\b/i.exec(place)?.[1] ?? null;
};

/** What is still with the waiter: open orders and customers at their tables (these stop the shift closing). */
export type WorkLeft = {
  orders: { id: string; number: string; place: string; status: string; due: number }[];
  tables: { locationId: string; table: string; customer: string }[];
};

/**
 * Close my shift. While orders or customers at tables are still mine, it says plainly what is left —
 * transfer each one, or hand everything to one colleague — then the shift closes with an optional note.
 */
export function CloseShiftDialog({ open, onOpenChange, left, onTransfer }: {
  open: boolean; onOpenChange: (o: boolean) => void; left: WorkLeft;
  /** Opens the transfer dialog (this one closes meanwhile and comes back after). */
  onTransfer: (req: TransferRequest) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const blocking = left.orders.length + left.tables.length > 0;
  const summary = [left.orders.length && plural(left.orders.length, "order"), left.tables.length && plural(left.tables.length, "table")].filter(Boolean).join(" and ");

  const close = () => start(async () => {
    const r = await endWaiterShiftAction({ note: note.trim() || undefined });
    if (r.ok) { toast.success(r.message ?? "Your shift is closed.", { description: r.data.text }); setNote(""); onOpenChange(false); router.refresh(); }
    else toast.error(r.error, { duration: 10000 });
  });

  // Most urgent first: ready to serve, on the way, in the kitchen, new, then served and still to pay.
  const orders = [...left.orders].sort((a, b) => (URGENCY[a.status] ?? 9) - (URGENCY[b.status] ?? 9));
  const toPay = left.orders.reduce((t, o) => t + (o.due ?? 0), 0);
  const transferBtn = (onClick: () => void, label: string) => (
    <button type="button" onClick={onClick} aria-label={label}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/80 px-2.5 text-xs font-semibold text-muted-foreground transition hover:border-[oklch(0.75_0.12_80)] hover:bg-[oklch(0.72_0.12_80/0.12)] hover:text-foreground active:scale-[0.97]">
      <ArrowRightLeft className="size-3.5" /><span className="hidden sm:inline">Transfer</span>
    </button>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out. */}
        <DialogHeader icon={<LogOut />} eyebrow="Your shift" tone="gold" className="mx-0 mt-0">
          <DialogTitle>Close my shift</DialogTitle>
          <DialogDescription>
            {blocking
              ? "Hand these to a colleague on shift — or finish them — then close."
              : "Nothing is left with you. The tables and rooms given to you are freed when you close."}
          </DialogDescription>
          {blocking && (
            <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
              {left.orders.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 font-semibold"><HandPlatter className="size-3.5 text-white/60" />{plural(left.orders.length, "order")}</span>}
              {left.tables.length > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 font-semibold"><Armchair className="size-3.5 text-white/60" />{plural(left.tables.length, "table")}</span>}
              {toPay > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 px-2.5 py-1 font-semibold tabular-nums text-rose-200">{tzs(toPay)} to pay</span>}
            </div>
          )}
        </DialogHeader>

        {blocking ? (
          <div className="max-h-[55vh] space-y-4 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-width:thin]">
            {left.tables.length > 0 && (
              <section>
                <p className="mb-1.5 flex items-baseline justify-between gap-2 px-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <span>Tables · {left.tables.length}</span><span className="normal-case tracking-normal">A table goes with its orders</span>
                </p>
                <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/70 bg-muted/20">
                  {left.tables.map((t) => (
                    <li key={t.locationId} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="grid h-9 min-w-9 shrink-0 place-items-center rounded-lg bg-[oklch(0.72_0.12_80/0.16)] px-1 text-[11px] font-bold text-[oklch(0.5_0.12_75)] dark:text-[oklch(0.84_0.11_82)]">{placeCode(t.table) ?? <Armchair className="size-4" />}</span>
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate text-sm font-semibold">{t.table}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{t.customer} is still at the table</span>
                      </span>
                      {transferBtn(() => onTransfer({
                        title: `Transfer ${t.table}`, what: `${t.table} — ${t.customer} and their open orders`, back: true,
                        run: (toWaiterId, reason) => transferTableAction({ locationId: t.locationId, toWaiterId, reason }),
                      }), `Transfer ${t.table}`)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {orders.length > 0 && (
              <section>
                <p className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Orders · {orders.length}</p>
                <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/70 bg-muted/20">
                  {orders.map((o) => {
                    const a = ACCENT[o.status] ?? ACCENT.PENDING;
                    return (
                      <li key={o.id} className="flex items-center gap-3 px-3 py-2.5">
                        <span className={cn("grid h-9 min-w-9 shrink-0 place-items-center rounded-lg px-1 text-[11px] font-bold tabular-nums", a.tile)}>{placeCode(o.place) ?? <HandPlatter className="size-4" />}</span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-sm font-semibold"><span className="font-mono text-[11px] font-normal text-muted-foreground">{shortNo(o.number)}</span> {o.place}</span>
                          <span className="mt-1 flex min-w-0 items-center gap-1.5">
                            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", a.tile)}>{STATUS_WORD[o.status] ?? o.status}</span>
                            {o.due > 0 && <span className="truncate text-[11px] font-semibold tabular-nums text-rose-700 dark:text-rose-300">{tzs(o.due)} to pay</span>}
                          </span>
                        </span>
                        {transferBtn(() => onTransfer({
                          title: `Transfer order ${shortNo(o.number)}`, what: `Order ${shortNo(o.number)} · ${o.place}`, back: true,
                          run: (toWaiterId, reason) => transferOrderAction({ orderId: o.id, toWaiterId, reason }),
                        }), `Transfer order ${shortNo(o.number)}`)}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        ) : (
          <div className="space-y-1.5 px-5 py-4">
            <Label htmlFor="waiter-close-note">Note (optional)</Label>
            <Textarea id="waiter-close-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Table 4 asked to reserve for 20:00 tomorrow." />
          </div>
        )}

        <DialogFooter className="m-0 rounded-b-xl border-t border-border/60 px-5 py-3.5">
          {blocking ? (
            <Button onClick={() => onTransfer({
              title: "Hand everything over", what: `Everything with you — ${summary}`, back: true,
              run: (toWaiterId, reason) => transferAllAction({ toWaiterId, reason }),
            })} className="w-full sm:w-auto"><ArrowRightLeft />Hand everything to one colleague</Button>
          ) : (
            <Button disabled={pending} onClick={close}>{pending ? <Loader2 className="animate-spin" /> : <LogOut />}Close my shift</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
