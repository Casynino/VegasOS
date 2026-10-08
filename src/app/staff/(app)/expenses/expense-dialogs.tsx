"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Check, ChevronDown, ClipboardList, Eye, Loader2, Pencil, Plus, Receipt, RotateCcw, X } from "lucide-react";
import { formatTZS } from "@/lib/format";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { saveExpenseAction, reviewExpenseAction, voidExpenseAction } from "./actions";
import { ExpenseTypePicker, type PickedType } from "./expense-type-picker";
import type { ExpenseTypes } from "@/server/services/expenses";
import { expenseLook } from "@/lib/expense-look";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

type Option = { id: string; name: string };
type Expense = {
  id: string; categoryId: string; amount: number; paymentMethodId: string; description: string; payee: string; reference: string;
  notes: string; receiptUrl: string | null; status: string; createdBy: string; voidReason: string | null;
  approvals: { id: string; action: string; note: string | null; actor: string; at: string }[];
  /** The stock purchase that made it (P-2026-0001) — it changes only from the purchase. */
  purchase?: string | null;
};

/** Stock bought through a request becomes its expense at the final approval — never typed in again. */
const PURCHASE_HINT = msg("Stock bought through a request is recorded by its approval — don't type it here.");
/** What happened to the expense, as the approval trail says it ("approved", "correction requested"). */
const ACTION_WORD: Record<string, string> = {
  SUBMITTED: msg("submitted"), APPROVED: msg("approved"), REJECTED: msg("rejected"), CORRECTION_REQUESTED: msg("correction requested"),
  RESUBMITTED: msg("resubmitted"), VOIDED: msg("voided"),
};

/**
 * On an expense a stock purchase made: where it came from, in place of Edit / Cancel / Review
 * (the stock and the money stay together, so it changes only from the purchase).
 */
export function PurchaseChip({ purchase, className }: { purchase: string; className?: string }) {
  const t = useT();
  return (
    <Link href="/staff/stock-requests" title={t("Made when purchase {purchase} was approved — it changes only from the purchase", { purchase })}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[oklch(0.75_0.12_80)]/40 bg-[oklch(0.75_0.12_80)]/10 px-2 py-0.5 text-[11px] font-medium text-[oklch(0.55_0.11_75)] transition-colors hover:bg-[oklch(0.75_0.12_80)]/20 dark:text-[oklch(0.82_0.1_82)]", className)}>
      <ClipboardList className="size-3" />{t("From purchase {purchase}", { purchase })}
    </Link>
  );
}

function ExpenseFields({ categories, methods, accounts, expense, errors }: { categories: Option[]; methods: Option[]; accounts?: { id: string; name: string; methodId: string | null }[]; expense?: Expense; errors?: Record<string, string> }) {
  const t = useT();
  const [accountId, setAccountId] = useState(accounts?.[0]?.id ?? "");
  const acct = accounts?.find((a) => a.id === accountId);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {expense && <input type="hidden" name="expenseId" value={expense.id} />}
      <div className="space-y-1.5"><Label htmlFor="categoryId">{t("Category")}</Label>
        <NativeSelect id="categoryId" name="categoryId" defaultValue={expense?.categoryId ?? ""} required>
          <option value="" disabled>{t("Choose…")}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{t(c.name)}</option>)}
        </NativeSelect><FieldError message={errors?.categoryId} /></div>
      <div className="space-y-1.5"><Label htmlFor="amount">{t("Amount (TZS)")}</Label>
        <Input id="amount" name="amount" type="number" inputMode="numeric" min={1} step={100} defaultValue={expense?.amount} required /><FieldError message={errors?.amount} /></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="description">{t("What was it for?")}</Label>
        <Input id="description" name="description" defaultValue={expense?.description} placeholder={t("e.g. Cleaning detergent, 5 litres")} required /><FieldError message={errors?.description} /></div>
      {accounts?.length ? (
        <div className="space-y-1.5"><Label htmlFor="accountId">{t("Paid from")}</Label>
          <input type="hidden" name="accountId" value={accountId} />
          <input type="hidden" name="paymentMethodId" value={acct?.methodId ?? ""} />
          <NativeSelect id="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}
          </NativeSelect></div>
      ) : (
        <div className="space-y-1.5"><Label htmlFor="paymentMethodId">{t("Paid with")}</Label>
          <NativeSelect id="paymentMethodId" name="paymentMethodId" defaultValue={expense?.paymentMethodId || methods[0]?.id}>
            {methods.map((m) => <option key={m.id} value={m.id}>{t(m.name)}</option>)}
          </NativeSelect></div>
      )}
      <div className="space-y-1.5"><Label htmlFor="payee">{t("Supplier / paid to")}</Label><Input id="payee" name="payee" defaultValue={expense?.payee} /></div>
      <div className="space-y-1.5"><Label htmlFor="reference">{t("Receipt no. / reference")}</Label><Input id="reference" name="reference" defaultValue={expense?.reference} />
        <p className="text-xs text-muted-foreground">{t(PURCHASE_HINT)}</p></div>
      {!expense && <div className="space-y-1.5"><Label htmlFor="spentAt">{t("When (leave blank for now)")}</Label><Input id="spentAt" name="spentAt" type="datetime-local" /></div>}
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="receipt">{t("Receipt photo (optional, max 5 MB)")}</Label>
        <Input id="receipt" name="receipt" type="file" accept="image/*,application/pdf" capture="environment" className="py-1.5" /><FieldError message={errors?.receipt} /></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="notes">{t("Notes")}</Label><Textarea id="notes" name="notes" rows={2} defaultValue={expense?.notes} /></div>
    </div>
  );
}

export function ExpenseDialog({ types, methods, accounts }: { types: ExpenseTypes; methods: Option[]; accounts?: { id: string; name: string; methodId: string | null }[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedType | null>(null);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts?.[0]?.id ?? "");
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const acct = accounts?.find((a) => a.id === accountId);
  const router = useRouter();
  const choose = (v: PickedType) => { setPicked(v); setAmount(v.kind === "item" && v.amount ? String(v.amount) : ""); };
  const reset = () => { setPicked(null); setAmount(""); };
  const value = Number(amount) || 0;
  const look = picked ? expenseLook(picked.icon) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger render={<Button />}><Plus /> {t("Record expense")}</DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader icon={<Receipt />} eyebrow={t("Expenses")} tone="amber">
          <DialogTitle>{picked ? t("How much was paid?") : t("What did you pay for?")}</DialogTitle>
          <DialogDescription>{picked ? t("Large amounts go to a manager for approval automatically.") : t("Search, or pick from a group. Anything new is saved for next time.")}</DialogDescription>
          {/* The two steps, on the dark band under the title. */}
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
            <span className={cn("rounded-full px-2 py-0.5", !picked ? "bg-white text-[#15110c]" : "bg-white/10")}>{t("1 What")}</span>
            <span className="h-px w-4 bg-white/20" />
            <span className={cn("rounded-full px-2 py-0.5", picked ? "bg-white text-[#15110c]" : "bg-white/10")}>{t("2 How much")}</span>
          </div>
        </DialogHeader>
        {!picked ? <ExpenseTypePicker types={types} onPick={choose} /> : (
          <ActionForm action={saveExpenseAction} onSuccess={() => { setOpen(false); reset(); router.refresh(); }} className="space-y-5">
            {({ pending, fieldErrors: errors }) => (
              <>
                {picked.kind === "item" ? <input type="hidden" name="itemId" value={picked.id} /> : <>
                  <input type="hidden" name="newItemName" value={picked.name} /><input type="hidden" name="newItemCategoryId" value={picked.groupId} />
                  <input type="hidden" name="newItemFrequency" value={picked.frequency} />
                </>}
                <input type="hidden" name="categoryId" value={picked.groupId} />

                <div className="flex items-center gap-3 rounded-2xl border border-border/80 bg-muted/30 p-3">
                  {look && <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", look.tone)}><look.icon className="size-5" /></span>}
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate font-semibold">{picked.kind === "item" ? t(picked.name) : picked.name}</p>
                    <p className="text-xs text-muted-foreground">{t(picked.group)}{picked.kind === "new" && ` · ${t("new — saved for next time")}`}</p>
                  </div>
                  <button type="button" onClick={reset} className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">{t("Change")}</button>
                </div>
                <FieldError message={errors?.categoryId ?? errors?.itemId} />

                <div className="space-y-1.5">
                  <Label htmlFor="amount">{t("Amount")}</Label>
                  <div className="flex items-center rounded-2xl border border-border bg-background px-4 focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-foreground/10">
                    <span className="text-sm font-semibold text-muted-foreground">TZS</span>
                    <input id="amount" name="amount" type="number" inputMode="numeric" min={1} step={1} required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
                      className="h-16 w-full min-w-0 bg-transparent px-3 text-3xl font-semibold tabular-nums tracking-tight outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                  </div>
                  {value > 0 && <p className="text-xs text-muted-foreground">{formatTZS(value)}</p>}
                  <FieldError message={errors?.amount} />
                </div>

                <div className="space-y-1.5">
                  <Label>{accounts?.length ? t("Paid from") : t("Paid with")}</Label>
                  {accounts?.length ? <><input type="hidden" name="accountId" value={accountId} /><input type="hidden" name="paymentMethodId" value={acct?.methodId ?? ""} /></>
                    : <input type="hidden" name="paymentMethodId" value={methodId} />}
                  <div className="flex flex-wrap gap-1.5">
                    {(accounts?.length ? accounts : methods).map((o) => {
                      const on = accounts?.length ? accountId === o.id : methodId === o.id;
                      return (
                        <button key={o.id} type="button" aria-pressed={on} onClick={() => (accounts?.length ? setAccountId(o.id) : setMethodId(o.id))}
                          className={cn("inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                          {on && <Check className="size-3.5" />}{t(o.name)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="payee">{t("Paid to")}</Label><Input id="payee" name="payee" defaultValue={picked.kind === "item" ? picked.payee ?? "" : ""} placeholder={t("Supplier or person")} className="h-11" /></div>
                  <div className="space-y-1.5"><Label htmlFor="description">{t("Details")} <span className="font-normal text-muted-foreground">{t("(optional)")}</span></Label>
                    <Input id="description" name="description" placeholder={t("e.g. for {month}", { month: new Date().toLocaleDateString(t.intl, { month: "long" }) })} className="h-11" /><FieldError message={errors?.description} /></div>
                </div>

                <details className="group rounded-2xl border border-border/80 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
                    <span>{t("Receipt, reference, date & notes")} <span className="font-normal text-muted-foreground">{t("— optional")}</span></span>
                    <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
                  </summary>
                  <div className="grid gap-3 border-t border-border/70 p-4 sm:grid-cols-2">
                    <div className="space-y-1.5"><Label htmlFor="reference">{t("Receipt no. / reference")}</Label><Input id="reference" name="reference" />
                      <p className="text-xs text-muted-foreground">{t(PURCHASE_HINT)}</p></div>
                    <div className="space-y-1.5"><Label htmlFor="spentAt">{t("When (blank = now)")}</Label><Input id="spentAt" name="spentAt" type="datetime-local" /></div>
                    <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="receipt">{t("Receipt photo (max 5 MB)")}</Label>
                      <Input id="receipt" name="receipt" type="file" accept="image/*,application/pdf" capture="environment" className="py-1.5" /><FieldError message={errors?.receipt} /></div>
                    <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="notes">{t("Notes")}</Label><Textarea id="notes" name="notes" rows={2} /></div>
                  </div>
                </details>

                <Button type="submit" className="h-12 w-full rounded-2xl text-base" disabled={pending || value <= 0}>
                  {pending && <Loader2 className="animate-spin" />}{value > 0 ? t("Save expense · {amount}", { amount: formatTZS(value) }) : t("Enter the amount")}
                </Button>
              </>
            )}
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ExpenseRowActions({ expense, categories, methods, canEdit: mayEdit, canReview: mayReview, canVoid: mayVoid }: {
  expense: Expense; categories: Option[]; methods: Option[]; canEdit: boolean; canReview: boolean; canVoid: boolean;
}) {
  // A purchase's expense is only looked at here: it changes from the purchase (the server refuses the rest anyway).
  const canEdit = mayEdit && !expense.purchase;
  const canReview = mayReview && !expense.purchase;
  const canVoid = mayVoid && !expense.purchase;
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(res.message ?? t("Done.")); setOpen(false); router.refresh(); }
      else toast.error(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(false); setNote(""); } }}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("Open expense")} />}>{canReview ? <Check /> : <Eye />}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader icon={<Receipt />} eyebrow={t("Expenses")} tone="amber">
          <DialogTitle>{formatTZS(expense.amount)} — {expense.description}</DialogTitle>
          <DialogDescription>{t("Recorded by {name}", { name: expense.createdBy })}</DialogDescription>
        </DialogHeader>
        {editing ? (
          <ActionForm action={saveExpenseAction} onSuccess={() => { setOpen(false); setEditing(false); router.refresh(); }} className="space-y-4">
            {({ pending: saving, fieldErrors }) => (
              <>
                <ExpenseFields categories={categories} methods={methods} expense={expense} errors={fieldErrors} />
                <DialogFooter><Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}{t("Save correction")}</Button></DialogFooter>
              </>
            )}
          </ActionForm>
        ) : (
          <div className="space-y-4 text-sm">
            {expense.purchase && <PurchaseChip purchase={expense.purchase} />}
            {expense.payee && <p>{t("Paid to: {payee}", { payee: expense.payee })}</p>}
            {expense.reference && <p>{t("Reference: {reference}", { reference: expense.reference })}</p>}
            {expense.notes && <p className="rounded-md bg-muted p-2">{expense.notes}</p>}
            {expense.receiptUrl && <a href={expense.receiptUrl} target="_blank" rel="noopener" className="inline-block font-medium text-primary underline-offset-4 hover:underline">{t("View receipt")}</a>}
            {expense.voidReason && <p className="text-destructive">{t("Voided: {reason}", { reason: expense.voidReason })}</p>}
            {expense.approvals.length > 0 && (
              <ol className="space-y-1 border-l pl-3">
                {expense.approvals.map((a) => (
                  <li key={a.id}><span className="text-muted-foreground">{t.dateTime(a.at)}</span> — {a.actor}: {t(ACTION_WORD[a.action] ?? a.action.toLowerCase().replace("_", " "))}{a.note && ` — “${a.note}”`}</li>
                ))}
              </ol>
            )}
            {(canReview || canVoid) && (
              <div className="space-y-1.5">
                <Label htmlFor="review-note">{canReview ? t("Note (required to reject or request correction)") : t("Note (reason, required to void)")}</Label>
                <Textarea id="review-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            )}
            <DialogFooter className="flex-wrap gap-2">
              {canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> {expense.status === "CORRECTION_REQUESTED" ? t("Correct & resubmit") : t("Edit")}</Button>}
              {canVoid && <Button variant="destructive" disabled={pending || !note.trim()} onClick={() => act(() => voidExpenseAction({ expenseId: expense.id, reason: note }))}><Ban /> {t("Void")}</Button>}
              {canReview && (
                <>
                  <Button variant="outline" disabled={pending || !note.trim()} onClick={() => act(() => reviewExpenseAction({ expenseId: expense.id, decision: "CORRECTION_REQUESTED", note }))}><RotateCcw /> {t("Needs correction")}</Button>
                  <Button variant="destructive" disabled={pending || !note.trim()} onClick={() => act(() => reviewExpenseAction({ expenseId: expense.id, decision: "REJECTED", note }))}><X /> {t("Reject")}</Button>
                  <Button disabled={pending} onClick={() => act(() => reviewExpenseAction({ expenseId: expense.id, decision: "APPROVED", note }))}>{pending ? <Loader2 className="animate-spin" /> : <Check />} {t("Approve")}</Button>
                </>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
