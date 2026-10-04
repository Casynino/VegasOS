"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wallet } from "lucide-react";
import { recordPaymentAction } from "@/app/staff/(app)/reservations/actions";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { AccountSelect } from "@/components/staff/finance/account-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatTZS } from "@/lib/format";
import type { PayAccount } from "@/lib/pay-account";
import { OtherWays, SendToPhone } from "@/components/staff/mobile-pay";

/**
 * COLLECT, right where the guest is listed: a small window with the amount owed already filled in, how it was received
 * and a reference — saved on the guest's bill without leaving the page (the same payment as at checkout).
 */
export function CollectButton({ reservationId, guest, rooms, outstanding, owedSoFar, methods, phone = null }: {
  reservationId: string; guest: string; rooms: string; outstanding: number; owedSoFar: number; methods: PayAccount[];
  /** The guest's phone on file — for a mobile-money prompt. */
  phone?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1 text-xs font-semibold text-background hover:opacity-90"><Wallet className="size-3.5" />Collect</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Wallet />} eyebrow="Collect payment" tone="emerald">
            <DialogTitle>{guest}</DialogTitle>
            <DialogDescription>Room {rooms} · owes {formatTZS(outstanding)}{owedSoFar !== outstanding ? ` (${formatTZS(owedSoFar)} for the nights so far)` : ""}</DialogDescription>
          </DialogHeader>
          {/* The main way: a prompt to the guest's phone (nTZS) — recorded by itself; cash, LIPA or bank folded below. */}
          <SendToPhone target={{ kind: "stay", reservationId }} amount={outstanding} editableAmount phone={phone} who={guest} onPaid={() => setOpen(false)} primary />
          <OtherWays>
          <ActionForm action={recordPaymentAction} resetOnSuccess onSuccess={() => { setOpen(false); router.refresh(); }} className="space-y-3">
            {({ pending, fieldErrors: e }) => (
              <>
                <input type="hidden" name="reservationId" value={reservationId} />
                <div className="space-y-1">
                  <Label htmlFor={`collect-amt-${reservationId}`} className="text-xs">Amount (TZS)</Label>
                  <Input id={`collect-amt-${reservationId}`} name="amount" type="number" min={1} step={1000} defaultValue={outstanding} className="h-11 text-base font-semibold tabular-nums" autoFocus />
                  <FieldError message={e?.amount} />
                  {owedSoFar !== outstanding && owedSoFar > 0 && <p className="text-[11px] text-muted-foreground">The whole bill is filled in — change it to {owedSoFar.toLocaleString("en-US")} to take only the nights so far.</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`collect-acc-${reservationId}`} className="text-xs">Received through</Label>
                  <AccountSelect id={`collect-acc-${reservationId}`} name="accountId" accounts={methods} />
                </div>
                <Input name="reference" placeholder="Reference (M-Pesa code, receipt…)" className="h-10" />
                <Button type="submit" className="h-11 w-full" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Wallet />}Save payment</Button>
              </>
            )}
          </ActionForm>
          </OtherWays>
        </DialogContent>
      </Dialog>
    </>
  );
}
