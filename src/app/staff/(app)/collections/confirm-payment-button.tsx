"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CircleX, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmOrderPaymentAction, markPaymentNotReceivedAction, recordOrderPaymentAction } from "@/app/staff/(app)/restaurant/actions";
import { useT } from "@/i18n/client";

/**
 * "Confirm" on a restaurant payment waiting for confirmation — the money is in the account. Sits
 * inside the payment line's <summary>, so it never opens or closes the line.
 */
export function ConfirmPaymentButton({ paymentId, label }: { paymentId: string; label: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={t("Confirm {label}", { label })}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(async () => {
          const res = await confirmOrderPaymentAction({ paymentId });
          if (res.ok) { toast.success(t("Confirmed — {label}.", { label })); router.refresh(); } else toast.error(res.error);
        });
      }}
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      {t("Confirm")}
    </button>
  );
}

/**
 * "Confirm" on an order the customer paid online (LIPA): the money is seen in the account — it is
 * recorded once from the customer's proof (their account and code). Only then can it be accepted.
 */
export function ConfirmOnlineButton({ orderId, accountId, reference, label }: { orderId: string; accountId: string; reference: string | null; label: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={t("Confirm {label} — the money is in the account", { label })}
      onClick={() => start(async () => {
        const res = await recordOrderPaymentAction({ id: orderId, accountId, reference: reference ?? undefined });
        if (res.ok) { toast.success(t("Confirmed — {label}. The order can be accepted now.", { label })); router.refresh(); } else toast.error(res.error);
      })}
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      {t("Confirm")}
    </button>
  );
}

/**
 * "Not received" on an online payment (recorded automatically): the money is not in the account — the payment is
 * taken off (not counted, no refund) and the order declined; the customer is told. Asks once before doing it.
 */
export function NotReceivedButton({ orderId, label, account }: { orderId: string; label: string; account: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    const res = await markPaymentNotReceivedAction({ id: orderId });
    if (res.ok) { toast.success(t("Not received — {label}. The order is declined.", { label })); setOpen(false); router.refresh(); } else toast.error(res.error);
  });
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-rose-500/35 px-2.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300"
      >
        <X className="size-3.5" />{t("Not received")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<CircleX />} eyebrow={t("Online payment")} tone="rose">
            <DialogTitle>{t("Payment not received?")}</DialogTitle>
            <DialogDescription>{t("{label} paid online to {account} is not in the account? It is taken off — not counted, no refund — and the order is declined. The customer is told.", { label, account })}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="destructive" disabled={pending} onClick={run}>{pending ? <Loader2 className="animate-spin" /> : <X />}{t("Not received — decline")}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("It is there")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
