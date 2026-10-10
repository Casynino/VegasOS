"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Calculator, Check, Loader2, Pencil, Plus, Undo2, Wallet } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NativeCheckbox } from "@/components/ui/native-select";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import { postMovementAction, recordCashCountAction, reverseMovementAction, reviewCashCountAction, savePaymentAccountAction } from "./actions";

type Account = { id: string; name: string; balance: number };
const KINDS = [
  { v: "TRANSFER", l: msg("Transfer"), hint: msg("Move money between accounts (e.g. cash to bank)") },
  { v: "OWNER_CONTRIBUTION", l: msg("Owner put in"), hint: msg("The owner adds money to the hotel") },
  { v: "OWNER_WITHDRAWAL", l: msg("Owner took out"), hint: msg("The owner takes money from the hotel") },
  { v: "OTHER_INCOME", l: msg("Other income"), hint: msg("Income that is not rooms, food, drinks or services") },
  { v: "ADJUSTMENT_IN", l: msg("Correction +"), hint: msg("Correct an account upwards (explain why)") },
  { v: "ADJUSTMENT_OUT", l: msg("Correction −"), hint: msg("Correct an account downwards (explain why)") },
] as const;

/** Record a money movement — Admin only. */
export function MovementButton({ accounts }: { accounts: Account[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]["v"]>("TRANSFER");
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus />{t("Money movement")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader icon={<ArrowLeftRight />} eyebrow={t("Ledger")} tone="emerald"><DialogTitle>{t("Record a money movement")}</DialogTitle>
            <DialogDescription>{t("Goes straight to the general ledger with your name. It can be reversed later, never deleted.")}</DialogDescription></DialogHeader>
          <ActionForm action={postMovementAction} onSuccess={() => { setOpen(false); router.refresh(); }} className="space-y-4">
            {({ pending, fieldErrors: e }) => (
              <>
                <input type="hidden" name="kind" value={kind} />
                <div className="grid grid-cols-3 gap-1.5">
                  {KINDS.map((k) => (
                    <button key={k.v} type="button" onClick={() => setKind(k.v)} title={t(k.hint)}
                      className={cn("rounded-xl border px-2 py-2 text-xs font-medium", kind === k.v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{t.ctx("money", k.l)}</button>
                  ))}
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">{t(KINDS.find((k) => k.v === kind)?.hint ?? "")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="mv-acc">{kind === "TRANSFER" ? t("From account") : t("Account")}</Label>
                    <select id="mv-acc" name="accountId" className="h-10 w-full rounded-xl border border-border bg-background px-2 text-sm">
                      {accounts.map((a) => <option key={a.id} value={a.id}>{t(a.name)} · {formatTZS(a.balance)}</option>)}
                    </select><FieldError message={e?.accountId} /></div>
                  {kind === "TRANSFER" && (
                    <div className="space-y-1.5"><Label htmlFor="mv-to">{t("To account")}</Label>
                      <select id="mv-to" name="toAccountId" defaultValue={accounts[1]?.id} className="h-10 w-full rounded-xl border border-border bg-background px-2 text-sm">
                        {accounts.map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}
                      </select><FieldError message={e?.toAccountId} /></div>
                  )}
                  <div className="space-y-1.5"><Label htmlFor="mv-amt">{t("Amount (TZS)")}</Label><Input id="mv-amt" name="amount" type="number" min={1} step={1000} className="h-10 tabular-nums" /><FieldError message={e?.amount} /></div>
                  <div className="space-y-1.5"><Label htmlFor="mv-ref">{t("Reference")}</Label><Input id="mv-ref" name="reference" placeholder={t("Bank slip, M-Pesa code…")} className="h-10" /></div>
                </div>
                <div className="space-y-1.5"><Label htmlFor="mv-desc">{t("What is it for?")}</Label><Input id="mv-desc" name="description" placeholder={t("e.g. Banked yesterday's cash")} /><FieldError message={e?.description} /></div>
                <div className="space-y-1.5"><Label htmlFor="mv-doc">{t("Document (photo or PDF, optional)")}</Label><Input id="mv-doc" name="attachment" type="file" accept="image/*,application/pdf" capture="environment" /><FieldError message={e?.attachment} /></div>
                <Button type="submit" className="w-full" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />}{t("Save to the ledger")}</Button>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Count the cash (or check any account) against what the system expects. */
export function CashCountButton({ account }: { account: Account }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const router = useRouter();
  const diff = counted === "" ? null : Math.round(Number(counted)) - account.balance;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Calculator />{t.ctx("cash", "Count")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Calculator />} eyebrow={t("Accounts")} tone="emerald"><DialogTitle>{t("Count · {account}", { account: t(account.name) })}</DialogTitle>
            <DialogDescription>{t("Count what is really there. The system compares it with what it expects.")}</DialogDescription></DialogHeader>
          <ActionForm action={recordCashCountAction} onSuccess={() => { setOpen(false); setCounted(""); router.refresh(); }} className="space-y-4">
            {({ pending, fieldErrors: e }) => (
              <>
                <input type="hidden" name="accountId" value={account.id} />
                <div className="rounded-2xl bg-muted/60 px-4 py-3 text-sm"><p className="text-xs text-muted-foreground">{t("The system expects")}</p><p className="text-2xl font-semibold tabular-nums">{formatTZS(account.balance)}</p></div>
                <div className="space-y-1.5"><Label htmlFor="cc-amt">{t("Counted (TZS)")}</Label>
                  <Input id="cc-amt" name="counted" type="number" min={0} step={500} value={counted} onChange={(ev) => setCounted(ev.target.value)} className="h-11 text-lg font-semibold tabular-nums" autoFocus /><FieldError message={e?.counted} /></div>
                {diff !== null && (
                  <p className={cn("rounded-xl px-3 py-2 text-sm font-semibold", diff === 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300")}>
                    {diff === 0 ? t("Matches exactly") : diff > 0 ? t("Over by {amount}", { amount: formatTZS(Math.abs(diff)) }) : t("Short by {amount}", { amount: formatTZS(Math.abs(diff)) })}
                  </p>
                )}
                {diff !== null && diff !== 0 && (
                  <div className="space-y-1.5"><Label htmlFor="cc-note">{t("Explain the difference")}</Label><Textarea id="cc-note" name="note" rows={2} placeholder={t("e.g. change given without a receipt")} /><FieldError message={e?.note} /></div>
                )}
                <Button type="submit" className="w-full" disabled={pending || counted === ""}>{pending && <Loader2 className="animate-spin" />}{t("Save count")}</Button>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReverseButton({ id, label }: { id: string; label: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Undo2 />{t("Reverse")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Undo2 />} eyebrow={t("Ledger")} tone="rose"><DialogTitle>{t("Reverse {what}", { what: label })}</DialogTitle><DialogDescription>{t("The entry stays on the ledger, struck through, with your reason. Post the correct one afterwards.")}</DialogDescription></DialogHeader>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why? e.g. wrong amount typed")} />
          <Button disabled={pending || !reason.trim()} onClick={() => start(async () => {
            const res = await reverseMovementAction({ id, reason });
            if (res.ok) { toast.success(res.message ?? t("Reversed.")); setOpen(false); router.refresh(); } else toast.error(res.error);
          })}>{pending && <Loader2 className="animate-spin" />}{t("Reverse it")}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SettleCountButtons({ id }: { id: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (postCorrection: boolean) => start(async () => {
    const res = await reviewCashCountAction({ id, postCorrection });
    if (res.ok) { toast.success(res.message ?? t("Done.")); router.refresh(); } else toast.error(res.error);
  });
  return (
    <div className="flex gap-1.5">
      <Button size="sm" disabled={pending} onClick={() => go(true)}>{pending ? <Loader2 className="animate-spin" /> : <Check />}{t("Accept & correct books")}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(false)}>{t("Accept only")}</Button>
    </div>
  );
}

const ACCOUNT_KINDS = [
  { v: "CASH", l: msg("Cash") }, { v: "BANK", l: msg("Bank") }, { v: "MOBILE_MONEY", l: msg("Mobile money") },
  { v: "CARD", l: msg("Card") }, { v: "PETTY_CASH", l: msg("Petty cash") }, { v: "OTHER", l: msg("Other") },
] as const;
export type EditableAccount = { id: string; name: string; kind: string; accountNumber: string | null; holderName: string | null; acceptsPayments: boolean; acceptsExpenses: boolean; isActive: boolean };

/** Admin: add or edit a payment account. There is no delete — an account with history is deactivated. */
export function PaymentAccountButton({ account }: { account?: EditableAccount }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(account?.kind ?? "BANK");
  const router = useRouter();
  const key = account?.id ?? "new";
  return (
    <>
      {account
        ? <Button variant="outline" size="sm" className="h-8 gap-1 rounded-lg px-2.5 text-xs" onClick={() => setOpen(true)}><Pencil className="size-3.5" />{t("Edit")}</Button>
        : <Button onClick={() => setOpen(true)}><Plus />{t("Add account")}</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Wallet />} eyebrow={t("Payment accounts")} tone="emerald">
            <DialogTitle>{account ? t("Edit {name}", { name: account.name }) : t("Add payment account")}</DialogTitle>
            <DialogDescription>{t("Staff pick this account when money is received or paid out — they never type these details.")}</DialogDescription>
          </DialogHeader>
          <ActionForm action={savePaymentAccountAction} onSuccess={() => { setOpen(false); router.refresh(); }} className="space-y-4">
            {({ pending, fieldErrors: e }) => (
              <>
                {account && <input type="hidden" name="id" value={account.id} />}
                <input type="hidden" name="kind" value={kind} />
                <div className="space-y-1.5"><Label htmlFor={`an-${key}`}>{t("Display name")}</Label>
                  <Input id={`an-${key}`} name="name" defaultValue={account?.name} placeholder={t("e.g. CRDB Bank")} required /><FieldError message={e?.name} /></div>
                <div className="space-y-1.5"><Label>{t("Type")}</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ACCOUNT_KINDS.map((k) => (
                      <button key={k.v} type="button" onClick={() => setKind(k.v)} aria-pressed={kind === k.v}
                        className={cn("rounded-xl border px-2 py-1.5 text-xs font-medium", kind === k.v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{t(k.l)}</button>
                    ))}
                  </div></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor={`ano-${key}`}>{t("Account number")}</Label><Input id={`ano-${key}`} name="accountNumber" defaultValue={account?.accountNumber ?? ""} placeholder={kind === "CASH" ? t("N/A") : t("e.g. {example}", { example: "015C799490700" })} className="font-mono" /></div>
                  <div className="space-y-1.5"><Label htmlFor={`ah-${key}`}>{t("Account holder")}</Label><Input id={`ah-${key}`} name="holderName" defaultValue={account?.holderName ?? ""} placeholder={t("e.g. {example}", { example: "VEGAS LUXURY HOTEL" })} /></div>
                </div>
                <div className="space-y-2 rounded-2xl border border-border/70 p-3">
                  <NativeCheckbox name="acceptsPayments" defaultChecked={account?.acceptsPayments ?? true} label={t.rich("<b>Receives payments</b> — shown in “Received through”", { b: (c) => <strong>{c}</strong> })} />
                  <NativeCheckbox name="acceptsExpenses" defaultChecked={account?.acceptsExpenses ?? true} label={t.rich("<b>Pays expenses</b> — shown in “Paid from”", { b: (c) => <strong>{c}</strong> })} />
                  <NativeCheckbox name="isActive" defaultChecked={account?.isActive ?? true} label={t.rich("<b>Active</b> — inactive accounts keep their history but cannot be chosen", { b: (c) => <strong>{c}</strong> })} />
                </div>
                <Button type="submit" className="w-full" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{account ? t("Save changes") : t("Add account")}</Button>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
