"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, CircleX, Loader2, Pencil, RotateCcw, Upload, X } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reinstateExpenseAction, reviewExpenseAction, saveExpenseAction, voidExpenseAction } from "@/app/staff/(app)/expenses/actions";
import { correctPaymentAction, reversePaymentAction, voidChargeAction } from "@/app/staff/(app)/reservations/actions";
import { correctSaleAccountAction, voidSaleAction } from "@/app/staff/(app)/sales/actions";
import { reverseMovementAction } from "@/app/staff/(app)/finance/accounts/actions";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

export type Option = { id: string; name: string };
export type AccountOption = { id: string; name: string; methodId: string | null };
export type EditableExpense = {
  id: string; number: string | null; categoryId: string; amount: number; description: string; payee: string; reference: string; notes: string;
  date: string; accountId: string; paymentMethodId: string; status: string;
};

const small = "h-8 gap-1 rounded-lg px-2.5 text-xs";

/** "Correct this record": fix any detail; a paid line is cancelled and a corrected one posted — both stay. */
export function ExpenseEditButton({ expense, categories, accounts, manager }: { expense: EditableExpense; categories: Option[]; accounts: AccountOption[]; manager: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(expense.accountId || accounts[0]?.id || "");
  const [file, setFile] = useState("");
  const router = useRouter();
  const acct = accounts.find((a) => a.id === accountId);
  return (
    <>
      <Button variant="outline" className={small} onClick={() => setOpen(true)}><Pencil className="size-3.5" />{t("Edit")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader icon={<Pencil />} eyebrow={t("Expenses")} tone="amber"><DialogTitle>{t("Correct this record")}</DialogTitle><DialogDescription>{expense.number ?? t("Expense")}</DialogDescription></DialogHeader>
          <ActionForm action={saveExpenseAction} onSuccess={() => { setOpen(false); router.refresh(); }} className="space-y-4">
            {({ pending, fieldErrors: e }) => (
              <>
                <input type="hidden" name="expenseId" value={expense.id} />
                <input type="hidden" name="accountId" value={accountId} />
                <input type="hidden" name="paymentMethodId" value={acct?.methodId ?? ""} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor={`c-${expense.id}`}>{t("Category")}</Label>
                    <select id={`c-${expense.id}`} name="categoryId" defaultValue={expense.categoryId} className="h-10 w-full rounded-xl border border-border bg-background px-2 text-sm">
                      {categories.map((c) => <option key={c.id} value={c.id}>{t(c.name)}</option>)}
                    </select><FieldError message={e?.categoryId} /></div>
                  <div className="space-y-1.5"><Label htmlFor={`a-${expense.id}`}>{t("Amount (TZS)")}</Label>
                    <Input id={`a-${expense.id}`} name="amount" type="number" min={1} step={100} defaultValue={expense.amount} className="h-10 tabular-nums" /><FieldError message={e?.amount} /></div>
                </div>
                <div className="space-y-1.5"><Label htmlFor={`d-${expense.id}`}>{t("What it was for")}</Label><Input id={`d-${expense.id}`} name="description" defaultValue={expense.description} className="h-10" /><FieldError message={e?.description} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor={`p-${expense.id}`}>{t("Paid to")}</Label><Input id={`p-${expense.id}`} name="payee" defaultValue={expense.payee} className="h-10" /></div>
                  <div className="space-y-1.5"><Label htmlFor={`t-${expense.id}`}>{t("Date incurred")}</Label><Input id={`t-${expense.id}`} name="spentAt" type="date" defaultValue={expense.date} className="h-10" /></div>
                </div>
                <div className="space-y-1.5"><Label htmlFor={`f-${expense.id}`}>{t("Paid from")}</Label>
                  <select id={`f-${expense.id}`} value={accountId} onChange={(ev) => setAccountId(ev.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-2 text-sm">
                    {accounts.map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}
                  </select>
                  {manager && expense.status !== "PENDING_APPROVAL" && <p className="text-[11px] text-amber-700 dark:text-amber-400">{t("Changing a cost that has already been paid cancels the old line and posts a corrected one — both stay on the register.")}</p>}
                </div>
                <div className="space-y-1.5"><Label htmlFor={`n-${expense.id}`}>{t("Note")}</Label><Input id={`n-${expense.id}`} name="notes" defaultValue={expense.notes} className="h-10" /></div>
                <div className="space-y-1.5"><Label>{t("Receipt")}</Label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[oklch(0.75_0.13_80)]/50 bg-[oklch(0.75_0.13_80)]/[0.06] px-3 py-2 text-sm">
                    <Upload className="size-4" /><span className="font-medium">{t("Proof")}</span><span className="truncate text-muted-foreground">{file || t("Photo or PDF (keeps the old one if empty)")}</span>
                    <input name="receipt" type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(ev) => setFile(ev.target.files?.[0]?.name ?? "")} />
                  </label><FieldError message={e?.receipt} /></div>
                <div className="space-y-1.5"><Label htmlFor={`r-${expense.id}`}>{t("What was wrong with the record?")}</Label>
                  <Textarea id={`r-${expense.id}`} name="reason" rows={2} placeholder={t("e.g. Corrected supplier receipt")} required /><FieldError message={e?.reason} /></div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Save the correction")}</Button>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("Leave it")}</Button>
                </div>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type EditablePayment = {
  id: string; reservationId: string | null; amount: number; refund: boolean; accountId: string; method: string; reference: string; who: string;
  booking: string | null; invoice: string | null; paidOn: string; recordedBy: string;
};
export type PaymentAccountOption = { id: string; name: string; number: string | null; holder: string | null };

/**
 * "Correct this record" for money received: which account it went into (e.g. NMB → CRDB)
 * and, for a manager, the reference. The amount never changes here — a wrong amount is
 * reversed and taken again. Every correction keeps the old and new account, who, when and why.
 */
export function PaymentEditButton({ payment, accounts, canReference }: { payment: EditablePayment; accounts: PaymentAccountOption[]; canReference: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(payment.accountId);
  const [reference, setReference] = useState(payment.reference);
  const [pending, start] = useTransition();
  const router = useRouter();
  const changed = accountId !== payment.accountId || (canReference && reference.trim() !== payment.reference);
  const from = accounts.find((a) => a.id === payment.accountId);
  const to = accounts.find((a) => a.id === accountId);
  const reset = () => { setAccountId(payment.accountId); setReference(payment.reference); };
  function save() {
    start(async () => {
      const res = await correctPaymentAction({ reservationId: payment.reservationId ?? undefined, paymentId: payment.id, accountId, reference: canReference ? reference.trim() || null : payment.reference || null });
      if (res.ok) { toast.success(res.message ?? t("Corrected.")); setOpen(false); router.refresh(); } else toast.error(res.error, { duration: 8000 });
    });
  }
  const facts: [string, string | null][] = [
    [payment.refund ? msg("Refund to") : msg("Paid by"), payment.who], [msg("Booking"), payment.booking], [msg("Invoice"), payment.invoice],
    [msg("Amount"), formatTZS(payment.amount)], [msg("Into"), from ? `${t(from.name)}${from.number ? ` · ${from.number}` : ""}` : null], [msg("Method"), t(payment.method)],
    [msg("Paid on"), payment.paidOn], [msg("Recorded by"), payment.recordedBy],
  ];
  return (
    <>
      <Button variant="outline" className={small} onClick={() => setOpen(true)}><Pencil className="size-3.5" />{t("Edit")}</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader icon={<Pencil />} eyebrow={t("Payments")} tone="emerald"><DialogTitle>{t("Correct this record")}</DialogTitle><DialogDescription>{payment.refund ? t("Refund") : t("Payment received")} · {formatTZS(payment.amount)}</DialogDescription></DialogHeader>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-2xl bg-muted/50 p-4 text-sm">
            {facts.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{t(k)}</dt><dd className={cn("truncate font-medium", k === "Amount" && "tabular-nums")}>{v}</dd></div>
            ))}
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">{canReference
            ? t.rich("The amount is not corrected here: a wrong amount is reversed by a manager and recorded again, so both stay on the books. You can fix <b>which account received it</b> and the reference.", { b: (c) => <strong className="text-foreground">{c}</strong> })
            : t.rich("The amount is not corrected here: a wrong amount is reversed by a manager and recorded again, so both stay on the books. You can fix <b>which account received it</b>.", { b: (c) => <strong className="text-foreground">{c}</strong> })}</p>
          <div className="space-y-2">
            <Label>{t("Received through")}</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {accounts.map((a) => (
                <button key={a.id} type="button" onClick={() => setAccountId(a.id)} aria-pressed={accountId === a.id}
                  className={cn("rounded-xl border px-3 py-2 text-left leading-tight transition", accountId === a.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                  <span className="block text-sm font-medium">{t(a.name)}</span><span className="text-[11px] opacity-70">{a.number ?? "—"}</span>
                </button>
              ))}
            </div>
            {to && (to.holder || to.number) && <p className="text-xs text-muted-foreground">{[to.holder, to.number].filter(Boolean).join(" · ")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ref-${payment.id}`}>{t("Transaction reference (M-Pesa code, bank ref)")}</Label>
            {canReference
              ? <Input id={`ref-${payment.id}`} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("Not recorded — type it in")} className="h-10 font-mono" />
              : <p className="rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">{payment.reference || t("Not recorded")} <span className="text-xs">· {t("only a manager can change it")}</span></p>}
          </div>
          {accountId !== payment.accountId && <p className="rounded-xl bg-violet-500/10 px-3 py-2 text-xs text-violet-800 dark:text-violet-300">{from ? t(from.name) : t("Old account")} → {to ? t(to.name) : ""} · {t("{amount} stays the same. Saved with your name and the time.", { amount: formatTZS(payment.amount) })}</p>}
          <div className="flex gap-2">
            <Button disabled={pending || !changed} onClick={save}>{pending && <Loader2 className="animate-spin" />}{t("Save the correction")}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("Leave it")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type EditableSale = { id: string; amount: number; accountId: string; what: string; soldOn: string; recordedBy: string };

/** "Correct this record" for a restaurant / bar sale: which account received it. The amount is locked. */
export function SaleEditButton({ sale, accounts }: { sale: EditableSale; accounts: PaymentAccountOption[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(sale.accountId);
  const [pending, start] = useTransition();
  const router = useRouter();
  const from = accounts.find((a) => a.id === sale.accountId);
  const to = accounts.find((a) => a.id === accountId);
  function save() {
    start(async () => {
      const res = await correctSaleAccountAction({ id: sale.id, accountId });
      if (res.ok) { toast.success(res.message ?? t("Corrected.")); setOpen(false); router.refresh(); } else toast.error(res.error, { duration: 8000 });
    });
  }
  return (
    <>
      <Button variant="outline" className={small} onClick={() => setOpen(true)}><Pencil className="size-3.5" />{t("Edit")}</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setAccountId(sale.accountId); }}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader icon={<Pencil />} eyebrow={t("Sales")} tone="emerald"><DialogTitle>{t("Correct this record")}</DialogTitle><DialogDescription>{sale.what} · {formatTZS(sale.amount)}</DialogDescription></DialogHeader>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-2xl bg-muted/50 p-4 text-sm">
            {([[msg("Sale"), sale.what], [msg("Amount"), formatTZS(sale.amount)], [msg("Into"), from ? `${t(from.name)}${from.number ? ` · ${from.number}` : ""}` : "—"], [msg("Sold on"), sale.soldOn], [msg("Recorded by"), sale.recordedBy]] as const).map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{t(k)}</dt><dd className="truncate font-medium">{v}</dd></div>
            ))}
          </dl>
          <div className="space-y-2">
            <Label>{t("Received through")}</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {accounts.map((a) => (
                <button key={a.id} type="button" onClick={() => setAccountId(a.id)} aria-pressed={accountId === a.id}
                  className={cn("rounded-xl border px-3 py-2 text-left leading-tight transition", accountId === a.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                  <span className="block text-sm font-medium">{t(a.name)}</span><span className="text-[11px] opacity-70">{a.number ?? "—"}</span>
                </button>
              ))}
            </div>
          </div>
          {accountId !== sale.accountId && <p className="rounded-xl bg-violet-500/10 px-3 py-2 text-xs text-violet-800 dark:text-violet-300">{from ? t(from.name) : t("Old account")} → {to ? t(to.name) : ""} · {t("{amount} stays the same. Saved with your name and the time.", { amount: formatTZS(sale.amount) })}</p>}
          <div className="flex gap-2">
            <Button disabled={pending || accountId === sale.accountId} onClick={save}>{pending && <Loader2 className="animate-spin" />}{t("Save the correction")}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("Leave it")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type CancelKind =
  | { kind: "expense"; id: string }
  | { kind: "payment"; id: string; reservationId: string }
  | { kind: "charge"; id: string; reservationId: string }
  | { kind: "sale"; id: string }
  | { kind: "movement"; id: string };
/** The small label on top of the cancel dialog: where the line lives. */
const CANCEL_AREA: Record<CancelKind["kind"], string> = { expense: msg("Expenses"), payment: msg("Payments"), charge: msg("Booking"), sale: msg("Sales"), movement: msg("Ledger") };

/** Cancel / reverse any money line with a reason. The original always stays, struck through. */
export function CancelButton(props: CancelKind & { label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const verb = props.kind === "payment" || props.kind === "movement" ? msg("Reverse") : msg("Cancel");
  function run() {
    start(async () => {
      const res =
        props.kind === "expense" ? await voidExpenseAction({ expenseId: props.id, reason })
          : props.kind === "payment" ? await reversePaymentAction({ reservationId: props.reservationId, paymentId: props.id, reason })
            : props.kind === "charge" ? await voidChargeAction({ reservationId: props.reservationId, chargeId: props.id, reason })
              : props.kind === "sale" ? await voidSaleAction({ id: props.id, reason })
                : await reverseMovementAction({ id: props.id, reason });
      if (res.ok) { toast.success(res.message ?? t("Done.")); setOpen(false); setReason(""); router.refresh(); } else toast.error(res.error, { duration: 8000 });
    });
  }
  return (
    <>
      <Button variant="outline" className={small} onClick={() => setOpen(true)}><Ban className="size-3.5" />{t(verb)}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Ban />} eyebrow={t(CANCEL_AREA[props.kind])} tone="rose"><DialogTitle>{t("{verb} {what}", { verb: t(verb), what: t(props.label ?? "this record") })}</DialogTitle>
            <DialogDescription>{t("It stays on the register, struck through and not counted, with your name and reason.")}</DialogDescription></DialogHeader>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why? e.g. Recorded twice")} autoFocus />
          <div className="flex gap-2">
            <Button variant="destructive" disabled={pending || !reason.trim()} onClick={run}>{pending && <Loader2 className="animate-spin" />}{verb === "Reverse" ? t("Reverse it") : t("Cancel it")}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("Leave it")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReinstateButton({ expenseId }: { expenseId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button variant="outline" className={small} disabled={pending} onClick={() => start(async () => {
      const res = await reinstateExpenseAction({ expenseId });
      if (res.ok) { toast.success(res.message ?? t("Reinstated.")); router.refresh(); } else toast.error(res.error, { duration: 8000 });
    })}>{pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}{t("Reinstate")}</Button>
  );
}

export function ApproveButtons({ expenseId }: { expenseId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [reject, setReject] = useState(false);
  const [note, setNote] = useState("");
  const router = useRouter();
  const go = (decision: "APPROVED" | "REJECTED") => start(async () => {
    const res = await reviewExpenseAction({ expenseId, decision, note });
    if (res.ok) { toast.success(res.message ?? t("Done.")); setReject(false); router.refresh(); } else toast.error(res.error, { duration: 8000 });
  });
  return (
    <>
      <Button className={cn(small, "bg-emerald-600 text-white hover:bg-emerald-500")} disabled={pending} onClick={() => go("APPROVED")}><Check className="size-3.5" />{t("Approve")}</Button>
      <Button variant="outline" className={small} disabled={pending} onClick={() => setReject(true)}><X className="size-3.5" />{t("Reject")}</Button>
      <Dialog open={reject} onOpenChange={setReject}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<CircleX />} eyebrow={t("Expenses")} tone="rose"><DialogTitle>{t("Reject this expense")}</DialogTitle><DialogDescription>{t("Tell the staff member why.")}</DialogDescription></DialogHeader>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. No receipt, too expensive")} />
          <Button variant="destructive" disabled={pending || !note.trim()} onClick={() => go("REJECTED")}>{pending && <Loader2 className="animate-spin" />}{t("Reject")}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
