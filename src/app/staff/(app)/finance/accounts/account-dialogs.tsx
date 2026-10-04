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
import { postMovementAction, recordCashCountAction, reverseMovementAction, reviewCashCountAction, savePaymentAccountAction } from "./actions";

type Account = { id: string; name: string; balance: number };
const KINDS = [
  { v: "TRANSFER", l: "Transfer", hint: "Move money between accounts (e.g. cash to bank)" },
  { v: "OWNER_CONTRIBUTION", l: "Owner put in", hint: "The owner adds money to the hotel" },
  { v: "OWNER_WITHDRAWAL", l: "Owner took out", hint: "The owner takes money from the hotel" },
  { v: "OTHER_INCOME", l: "Other income", hint: "Income that is not rooms, food, drinks or services" },
  { v: "ADJUSTMENT_IN", l: "Correction +", hint: "Correct an account upwards (explain why)" },
  { v: "ADJUSTMENT_OUT", l: "Correction −", hint: "Correct an account downwards (explain why)" },
] as const;

/** Record a money movement — Admin only. */
export function MovementButton({ accounts }: { accounts: Account[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]["v"]>("TRANSFER");
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus />Money movement</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader icon={<ArrowLeftRight />} eyebrow="Ledger" tone="emerald"><DialogTitle>Record a money movement</DialogTitle>
            <DialogDescription>Goes straight to the general ledger with your name. It can be reversed later, never deleted.</DialogDescription></DialogHeader>
          <ActionForm action={postMovementAction} onSuccess={() => { setOpen(false); router.refresh(); }} className="space-y-4">
            {({ pending, fieldErrors: e }) => (
              <>
                <input type="hidden" name="kind" value={kind} />
                <div className="grid grid-cols-3 gap-1.5">
                  {KINDS.map((k) => (
                    <button key={k.v} type="button" onClick={() => setKind(k.v)} title={k.hint}
                      className={cn("rounded-xl border px-2 py-2 text-xs font-medium", kind === k.v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{k.l}</button>
                  ))}
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">{KINDS.find((k) => k.v === kind)?.hint}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="mv-acc">{kind === "TRANSFER" ? "From account" : "Account"}</Label>
                    <select id="mv-acc" name="accountId" className="h-10 w-full rounded-xl border border-border bg-background px-2 text-sm">
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatTZS(a.balance)}</option>)}
                    </select><FieldError message={e?.accountId} /></div>
                  {kind === "TRANSFER" && (
                    <div className="space-y-1.5"><Label htmlFor="mv-to">To account</Label>
                      <select id="mv-to" name="toAccountId" defaultValue={accounts[1]?.id} className="h-10 w-full rounded-xl border border-border bg-background px-2 text-sm">
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select><FieldError message={e?.toAccountId} /></div>
                  )}
                  <div className="space-y-1.5"><Label htmlFor="mv-amt">Amount (TZS)</Label><Input id="mv-amt" name="amount" type="number" min={1} step={1000} className="h-10 tabular-nums" /><FieldError message={e?.amount} /></div>
                  <div className="space-y-1.5"><Label htmlFor="mv-ref">Reference</Label><Input id="mv-ref" name="reference" placeholder="Bank slip, M-Pesa code…" className="h-10" /></div>
                </div>
                <div className="space-y-1.5"><Label htmlFor="mv-desc">What is it for?</Label><Input id="mv-desc" name="description" placeholder="e.g. Banked yesterday's cash" /><FieldError message={e?.description} /></div>
                <div className="space-y-1.5"><Label htmlFor="mv-doc">Document (photo or PDF, optional)</Label><Input id="mv-doc" name="attachment" type="file" accept="image/*,application/pdf" capture="environment" /><FieldError message={e?.attachment} /></div>
                <Button type="submit" className="w-full" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />}Save to the ledger</Button>
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
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const router = useRouter();
  const diff = counted === "" ? null : Math.round(Number(counted)) - account.balance;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Calculator />Count</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Calculator />} eyebrow="Accounts" tone="emerald"><DialogTitle>Count · {account.name}</DialogTitle>
            <DialogDescription>Count what is really there. The system compares it with what it expects.</DialogDescription></DialogHeader>
          <ActionForm action={recordCashCountAction} onSuccess={() => { setOpen(false); setCounted(""); router.refresh(); }} className="space-y-4">
            {({ pending, fieldErrors: e }) => (
              <>
                <input type="hidden" name="accountId" value={account.id} />
                <div className="rounded-2xl bg-muted/60 px-4 py-3 text-sm"><p className="text-xs text-muted-foreground">The system expects</p><p className="text-2xl font-semibold tabular-nums">{formatTZS(account.balance)}</p></div>
                <div className="space-y-1.5"><Label htmlFor="cc-amt">Counted (TZS)</Label>
                  <Input id="cc-amt" name="counted" type="number" min={0} step={500} value={counted} onChange={(ev) => setCounted(ev.target.value)} className="h-11 text-lg font-semibold tabular-nums" autoFocus /><FieldError message={e?.counted} /></div>
                {diff !== null && (
                  <p className={cn("rounded-xl px-3 py-2 text-sm font-semibold", diff === 0 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300")}>
                    {diff === 0 ? "Matches exactly" : `${diff > 0 ? "Over" : "Short"} by ${formatTZS(Math.abs(diff))}`}
                  </p>
                )}
                {diff !== null && diff !== 0 && (
                  <div className="space-y-1.5"><Label htmlFor="cc-note">Explain the difference</Label><Textarea id="cc-note" name="note" rows={2} placeholder="e.g. change given without a receipt" /><FieldError message={e?.note} /></div>
                )}
                <Button type="submit" className="w-full" disabled={pending || counted === ""}>{pending && <Loader2 className="animate-spin" />}Save count</Button>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReverseButton({ id, label }: { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Undo2 />Reverse</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Undo2 />} eyebrow="Ledger" tone="rose"><DialogTitle>Reverse {label}</DialogTitle><DialogDescription>The entry stays on the ledger, struck through, with your reason. Post the correct one afterwards.</DialogDescription></DialogHeader>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. wrong amount typed" />
          <Button disabled={pending || !reason.trim()} onClick={() => start(async () => {
            const res = await reverseMovementAction({ id, reason });
            if (res.ok) { toast.success(res.message ?? "Reversed."); setOpen(false); router.refresh(); } else toast.error(res.error);
          })}>{pending && <Loader2 className="animate-spin" />}Reverse it</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SettleCountButtons({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (postCorrection: boolean) => start(async () => {
    const res = await reviewCashCountAction({ id, postCorrection });
    if (res.ok) { toast.success(res.message ?? "Done."); router.refresh(); } else toast.error(res.error);
  });
  return (
    <div className="flex gap-1.5">
      <Button size="sm" disabled={pending} onClick={() => go(true)}>{pending ? <Loader2 className="animate-spin" /> : <Check />}Accept & correct books</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(false)}>Accept only</Button>
    </div>
  );
}

const ACCOUNT_KINDS = [
  { v: "CASH", l: "Cash" }, { v: "BANK", l: "Bank" }, { v: "MOBILE_MONEY", l: "Mobile money" },
  { v: "CARD", l: "Card" }, { v: "PETTY_CASH", l: "Petty cash" }, { v: "OTHER", l: "Other" },
] as const;
export type EditableAccount = { id: string; name: string; kind: string; accountNumber: string | null; holderName: string | null; acceptsPayments: boolean; acceptsExpenses: boolean; isActive: boolean };

/** Admin: add or edit a payment account. There is no delete — an account with history is deactivated. */
export function PaymentAccountButton({ account }: { account?: EditableAccount }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(account?.kind ?? "BANK");
  const router = useRouter();
  const key = account?.id ?? "new";
  return (
    <>
      {account
        ? <Button variant="outline" size="sm" className="h-8 gap-1 rounded-lg px-2.5 text-xs" onClick={() => setOpen(true)}><Pencil className="size-3.5" />Edit</Button>
        : <Button onClick={() => setOpen(true)}><Plus />Add account</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Wallet />} eyebrow="Payment accounts" tone="emerald">
            <DialogTitle>{account ? `Edit ${account.name}` : "Add payment account"}</DialogTitle>
            <DialogDescription>Staff pick this account when money is received or paid out — they never type these details.</DialogDescription>
          </DialogHeader>
          <ActionForm action={savePaymentAccountAction} onSuccess={() => { setOpen(false); router.refresh(); }} className="space-y-4">
            {({ pending, fieldErrors: e }) => (
              <>
                {account && <input type="hidden" name="id" value={account.id} />}
                <input type="hidden" name="kind" value={kind} />
                <div className="space-y-1.5"><Label htmlFor={`an-${key}`}>Display name</Label>
                  <Input id={`an-${key}`} name="name" defaultValue={account?.name} placeholder="e.g. CRDB Bank" required /><FieldError message={e?.name} /></div>
                <div className="space-y-1.5"><Label>Type</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ACCOUNT_KINDS.map((k) => (
                      <button key={k.v} type="button" onClick={() => setKind(k.v)} aria-pressed={kind === k.v}
                        className={cn("rounded-xl border px-2 py-1.5 text-xs font-medium", kind === k.v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{k.l}</button>
                    ))}
                  </div></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor={`ano-${key}`}>Account number</Label><Input id={`ano-${key}`} name="accountNumber" defaultValue={account?.accountNumber ?? ""} placeholder={kind === "CASH" ? "N/A" : "e.g. 015C799490700"} className="font-mono" /></div>
                  <div className="space-y-1.5"><Label htmlFor={`ah-${key}`}>Account holder</Label><Input id={`ah-${key}`} name="holderName" defaultValue={account?.holderName ?? ""} placeholder="e.g. VEGAS LUXURY HOTEL" /></div>
                </div>
                <div className="space-y-2 rounded-2xl border border-border/70 p-3">
                  <NativeCheckbox name="acceptsPayments" defaultChecked={account?.acceptsPayments ?? true} label={<><strong>Receives payments</strong> — shown in “Received through”</>} />
                  <NativeCheckbox name="acceptsExpenses" defaultChecked={account?.acceptsExpenses ?? true} label={<><strong>Pays expenses</strong> — shown in “Paid from”</>} />
                  <NativeCheckbox name="isActive" defaultChecked={account?.isActive ?? true} label={<><strong>Active</strong> — inactive accounts keep their history but cannot be chosen</>} />
                </div>
                <Button type="submit" className="w-full" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{account ? "Save changes" : "Add account"}</Button>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
