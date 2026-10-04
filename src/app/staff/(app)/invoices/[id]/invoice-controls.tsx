"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Banknote, Loader2, Send } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { PAYMENT_TERMS } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { cancelInvoiceAction, invoicePaymentAction, issueInvoiceAction, voidInvoiceAction } from "../actions";
import type { PayAccount } from "@/lib/pay-account";

function addDaysIso(days: number) {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoiceControls({ invoiceId, status, balance, linkedReservationId, canManage, canPay, methods, defaultTerms, canIssue = true }: {
  invoiceId: string; status: string; balance: number; linkedReservationId: string | null;
  canManage: boolean; canPay: boolean; methods: PayAccount[]; defaultTerms: number | null;
  /** False for a group's running bill: it is issued by finalizing the group. */
  canIssue?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [terms, setTerms] = useState<number | null>(defaultTerms);
  const [dueDate, setDueDate] = useState("");
  const [reason, setReason] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [accountId, setAccountId] = useState(methods[0]?.id ?? "");
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, done?: () => void) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(r.message ?? "Done"); done?.(); router.refresh(); } else toast.error(r.error, { duration: 8000 }); });
  const payable = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(status) && balance > 0;
  const due = dueDate || (terms != null ? addDaysIso(terms) : "");
  const chip = (on: boolean) => cn("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted");

  return (
    <>
      {canManage && canIssue && status === "DRAFT" && (
        <Dialog>
          <DialogTrigger render={<Button />}><Send /> Issue invoice</DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader icon={<Send />} eyebrow="Invoice" tone="emerald"><DialogTitle>Issue this invoice</DialogTitle><DialogDescription>The lines are frozen and the invoice gets its verify code. Changes after this appear as adjustment lines.</DialogDescription></DialogHeader>
            <div className="space-y-2">
              <Label>Pay within</Label>
              <div className="flex flex-wrap gap-1.5">
                {PAYMENT_TERMS.map((d) => (
                  <button key={d} type="button" className={chip(!dueDate && terms === d)} onClick={() => { setTerms(d); setDueDate(""); }}>{d === 0 ? "Due now" : `${d} days`}</button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Label htmlFor="due" className="shrink-0 text-xs text-muted-foreground">or a date</Label>
                <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
              </div>
              {due && <p className="text-sm">Due <strong>{formatBusinessDate(due)}</strong></p>}
            </div>
            <DialogFooter><Button disabled={pending} onClick={() => run(() => issueInvoiceAction({ invoiceId, dueDate: due || undefined }))}>{pending && <Loader2 className="animate-spin" />}Issue invoice</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {payable && canPay && (linkedReservationId ? (
        <Link href={`/staff/reservations/${linkedReservationId}`} className={buttonVariants()}><Banknote /> Receive payment on booking</Link>
      ) : (
        <Dialog open={payOpen} onOpenChange={setPayOpen}>
          <DialogTrigger render={<Button />}><Banknote /> Record payment</DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader icon={<Banknote />} eyebrow="Payments" tone="emerald"><DialogTitle>Payment received</DialogTitle><DialogDescription>Still owed: {formatTZS(balance)}. The invoice updates by itself — part payments are fine.</DialogDescription></DialogHeader>
            <ActionForm action={invoicePaymentAction} onSuccess={() => { setPayOpen(false); router.refresh(); }} className="space-y-3">
              {({ pending: p, fieldErrors: e }) => (
                <>
                  <input type="hidden" name="invoiceId" value={invoiceId} />
                  <input type="hidden" name="accountId" value={accountId} />
                  <div className="flex flex-wrap gap-1.5">
                    {methods.map((m) => <button key={m.id} type="button" className={chip(accountId === m.id)} onClick={() => setAccountId(m.id)}>{m.name}</button>)}
                  </div>
                  <div className="space-y-1"><Label htmlFor="amt">Amount (TZS)</Label><Input id="amt" name="amount" type="number" min={1} defaultValue={balance} className="h-10 text-base font-semibold tabular-nums" /><FieldError message={e?.amount} /></div>
                  <Input name="reference" placeholder="Bank ref, M-Pesa code, cheque no." />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label htmlFor="rcvd">Date received</Label><Input id="rcvd" name="receivedOn" type="date" className="h-10" /><p className="text-[11px] text-muted-foreground">Blank = today</p><FieldError message={e?.receivedOn} /></div>
                    <div className="space-y-1"><Label htmlFor="pnote">Note (optional)</Label><Input id="pnote" name="notes" placeholder="e.g. part payment" className="h-10" /></div>
                  </div>
                  <DialogFooter><Button type="submit" disabled={p}>{p && <Loader2 className="animate-spin" />}Save payment</Button></DialogFooter>
                </>
              )}
            </ActionForm>
          </DialogContent>
        </Dialog>
      ))}
      {canManage && !["CANCELLED", "VOID", "PAID"].includes(status) && (
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}><Ban /> {status === "DRAFT" || linkedReservationId ? "Cancel" : "Void"}</DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader icon={<Ban />} eyebrow="Invoice" tone="rose">
              <DialogTitle>{status === "DRAFT" || linkedReservationId ? "Cancel this invoice?" : "Void this invoice?"}</DialogTitle>
              <DialogDescription>It stays on record{status === "DRAFT" || linkedReservationId ? " as cancelled" : ", marked VOID"} and counts for nothing. Stays on it go back to owing those lines until they are billed again.</DialogDescription>
            </DialogHeader>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. wrong company, sent twice" />
            <DialogFooter>
              <Button variant="destructive" disabled={pending || !reason.trim()}
                onClick={() => run(() => (status === "DRAFT" || linkedReservationId ? cancelInvoiceAction({ invoiceId, reason }) : voidInvoiceAction({ invoiceId, reason })))}>
                {pending && <Loader2 className="animate-spin" />}{status === "DRAFT" || linkedReservationId ? "Cancel invoice" : "Void invoice"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
