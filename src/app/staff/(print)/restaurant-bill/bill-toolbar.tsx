"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccountSelect } from "@/components/staff/finance/account-select";
import { SendToPhone } from "@/components/staff/mobile-pay";
import { BroughtBySelect } from "@/components/staff/brought-by-select";
import { ReceiptActions } from "@/components/ordering/receipt-actions";
import type { PayAccount } from "@/lib/pay-account";
import { cn } from "@/lib/utils";
import { logBillPrintedAction, payBillAction } from "@/app/staff/(app)/restaurant/actions";

/** Above the bill (never printed): which bill, print / download it, record the payment (the Restaurant Counter, reception). */
export function BillToolbar({ orderId, scope, can, place, room, count, fileName, due, onlineDue = 0, total, unpaid, pay, waiterId = null }: {
  orderId: string; scope: "order" | "table" | "room"; can: { table: boolean; room: boolean }; place: string; room: string | null; count: number; fileName: string;
  /** Still to pay here — without what the customer already paid online (onlineDue: confirmed once on the order, never paid again here). */
  due: number; onlineDue?: number; total: number; unpaid: string[]; pay: PayAccount[] | null;
  /** The order's waiter — prefilled as "Brought by" on the Restaurant Counter. */
  waiterId?: string | null;
}) {
  const router = useRouter();
  const [paying, setPaying] = useState(false);
  const [account, setAccount] = useState(pay?.[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [broughtBy, setBroughtBy] = useState("");
  const [pending, start] = useTransition();
  // The official payment: recorded by whoever is signed in (the Restaurant Counter, reception) — never under a waiter.
  const record = () => start(async () => {
    const res = await payBillAction({ ids: unpaid, accountId: account, reference: reference || undefined, handedOverById: broughtBy || null });
    if (res.ok) { toast.success(`Paid — ${res.data.count} order${res.data.count === 1 ? "" : "s"}, TZS ${res.data.total.toLocaleString("en-US")}.`); setPaying(false); setReference(""); setBroughtBy(""); router.refresh(); }
    else toast.error(res.error);
  });
  const scopes = [
    { key: "order", label: "This order", show: true },
    { key: "table", label: `Whole ${place.toLowerCase().startsWith("table") ? place : "table"}`, show: can.table },
    { key: "room", label: `Room ${room ?? ""} stay`, show: can.room },
  ].filter((x) => x.show);

  return (
    <div className="space-y-3 font-sans print:hidden">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => (history.length > 1 ? history.back() : router.push("/staff/restaurant"))} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-black/70 hover:bg-black/5"><ArrowLeft className="size-4" />Back</button>
        <p className="text-xs text-black/55">{count} order{count === 1 ? "" : "s"} on this bill</p>
      </div>
      {scopes.length > 1 && (
        <div className="grid gap-1 rounded-2xl bg-black/[0.06] p-1" style={{ gridTemplateColumns: `repeat(${scopes.length}, minmax(0, 1fr))` }}>
          {scopes.map((x) => (
            <Link key={x.key} href={`/staff/restaurant-bill?order=${orderId}&scope=${x.key}`} replace
              className={cn("truncate rounded-xl px-2 py-2 text-center text-xs font-semibold transition", scope === x.key ? "bg-white text-black shadow-sm" : "text-black/60 hover:text-black")}>{x.label}</Link>
          ))}
        </div>
      )}
      {/* Every printed / downloaded version is noted on the order (amount, who, when). */}
      <ReceiptActions fileName={fileName} onDone={(how) => { void logBillPrintedAction({ orderId, how, total, scope }); }} />
      {pay && due > 0 && (
        <Button onClick={() => setPaying(true)} className="h-11 w-full bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[15px] font-semibold text-[oklch(0.2_0.03_60)] hover:brightness-105">
          <Wallet />Record payment · TZS {due.toLocaleString("en-US")}
        </Button>
      )}
      {!pay && due > 0 && <p className="text-center text-xs text-black/55">The Restaurant Counter records the payment.</p>}
      {onlineDue > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-sky-500/10 px-3 py-2 text-xs leading-snug text-sky-900 ring-1 ring-inset ring-sky-600/20">
          <ShieldCheck className="mt-px size-3.5 shrink-0" />
          <span>Paid online · TZS {onlineDue.toLocaleString("en-US")} — {pay ? "confirm it once on the order, from the customer's proof" : "the Counter confirms it"}. It is never collected again.</span>
        </p>
      )}

      <Dialog open={paying} onOpenChange={setPaying}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Wallet />} eyebrow={place} tone="emerald">
            <DialogTitle>Payment · TZS {due.toLocaleString("en-US")}</DialogTitle>
            <DialogDescription>Pays {unpaid.length} unpaid order{unpaid.length === 1 ? "" : "s"} on this bill — recorded as restaurant and bar income into the account you choose.</DialogDescription>
          </DialogHeader>
          {pay && <AccountSelect accounts={pay} value={account} onChange={setAccount} />}
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference (M-Pesa code / card slip) — optional" />
          {paying && <BroughtBySelect value={broughtBy} onChange={setBroughtBy} prefill={waiterId} />}
          <Button disabled={pending || !account} onClick={record}>{pending && <Loader2 className="animate-spin" />}Record TZS {due.toLocaleString("en-US")}</Button>
          {/* Or a mobile-money prompt to the customer's phone for the whole bill — recorded by itself when they approve. */}
          {unpaid.length > 0 && due > 0 && <SendToPhone target={{ kind: "orders", orderIds: unpaid, handedOverById: broughtBy || null }} amount={due} onPaid={() => setPaying(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
