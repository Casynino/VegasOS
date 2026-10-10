"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Building2, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatTZS } from "@/lib/format";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { companyPaymentAction } from "@/app/staff/(app)/invoices/actions";
import { CorporateForm, type CorporateDefaults } from "./corporate-form";
import type { PayAccount } from "@/lib/pay-account";

export function EditCompanyButton({ c }: { c: CorporateDefaults }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white" />}><Pencil />{t("Edit")}</DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader icon={<Building2 />} eyebrow={t("Corporate")} tone="sky"><DialogTitle>{c.companyName}</DialogTitle><DialogDescription>{t("Details, billing arrangement, terms and credit limit.")}</DialogDescription></DialogHeader>
        <CorporateForm c={c} canEdit onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

type OpenInvoice = { id: string; number: string; balance: number; due: string | null };

/** The company pays: money goes to its oldest invoices first (or only the ones ticked). */
export function CompanyPaymentButton({ companyId, open: invoices, methods }: { companyId: string; open: OpenInvoice[]; methods: PayAccount[] }) {
  const t = useT();
  const [show, setShow] = useState(false);
  const owed = invoices.reduce((s, i) => s + i.balance, 0);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(methods.find((m) => /bank/i.test(m.name))?.id ?? methods[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();
  const pool = picked.length ? invoices.filter((i) => picked.includes(i.id)) : invoices;
  const max = pool.reduce((s, i) => s + i.balance, 0);
  const value = amount === "" ? max : Math.round(Number(amount) || 0);
  // Oldest first: each invoice takes what is left after the ones before it.
  const plan = pool.map((i, k) => {
    const before = pool.slice(0, k).reduce((s, x) => s + x.balance, 0);
    return { ...i, part: Math.max(0, Math.min(i.balance, value - before)) };
  });

  function save() {
    start(async () => {
      const res = await companyPaymentAction({ companyId, amount: value, accountId, reference: reference || undefined, invoiceIds: picked.length ? picked : undefined });
      if (res.ok) {
        toast.success(t("{amount} recorded", { amount: formatTZS(value) }), { description: res.data.applied.map((a) => `${a.invoice}: ${formatTZS(a.amount)}`).join(" · ") });
        setShow(false); setAmount(""); setReference(""); setPicked([]); router.refresh();
      } else toast.error(res.error, { duration: 8000 });
    });
  }

  return (
    <Dialog open={show} onOpenChange={setShow}>
      <DialogTrigger render={<Button disabled={owed === 0} className="bg-[#f0cf86] text-[#15110c] hover:bg-[#f5dca3]" />}><Banknote />{t("Record payment")}</DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader icon={<Banknote />} eyebrow={t("Corporate")} tone="emerald"><DialogTitle>{t("Company payment")}</DialogTitle><DialogDescription>{t("The company owes {amount}. The money goes to the oldest invoices first — or tick the invoices it is for.", { amount: formatTZS(owed) })}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {methods.map((m) => (
              <button key={m.id} type="button" onClick={() => setAccountId(m.id)} aria-pressed={accountId === m.id}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", accountId === m.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{t(m.name)}</button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="space-y-1"><Label htmlFor="cp-amt">{t("Amount received (TZS)")}</Label>
              <Input id="cp-amt" type="number" min={1} step={1000} value={amount === "" ? String(max) : amount} onChange={(e) => setAmount(e.target.value)} className="h-11 text-lg font-semibold tabular-nums" /></div>
            <button type="button" onClick={() => setAmount("")} className={cn("mt-6 rounded-lg border px-3 text-xs font-medium", amount === "" ? "border-emerald-600 text-emerald-700 dark:text-emerald-300" : "border-border hover:bg-muted")}>{t("All")}</button>
          </div>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("Bank reference, cheque or M-Pesa code")} />
          <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
            {plan.length === 0 && <li className="p-3 text-sm text-muted-foreground">{t("No unpaid invoices.")}</li>}
            {invoices.map((i) => {
              const p = plan.find((x) => x.id === i.id);
              const on = picked.includes(i.id);
              return (
                <li key={i.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                    <input type="checkbox" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== i.id) : [...picked, i.id])} />
                    <span className="min-w-0 flex-1">
                      <span className="font-mono font-medium">{i.number}</span>
                      <span className="block text-[11px] text-muted-foreground">{t("owes {amount}", { amount: formatTZS(i.balance) })}{i.due ? ` · ${t("due {date}", { date: t.date(i.due) })}` : ""}</span>
                    </span>
                    <span className={cn("text-right text-xs font-semibold tabular-nums", p?.part ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                      {p?.part ? `+ ${formatTZS(p.part)}` : "—"}
                      {p?.part === i.balance && <span className="block text-[10px] font-medium">{t("paid off")}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {value > max && <p className="text-xs font-medium text-rose-600">{picked.length ? t("That is more than these invoices owe ({amount}).", { amount: formatTZS(max) }) : t("That is more than the company owes ({amount}).", { amount: formatTZS(max) })}</p>}
          <Button className="h-11 w-full" disabled={pending || value <= 0 || value > max || !accountId} onClick={save}>
            {pending && <Loader2 className="animate-spin" />}{t("Record {amount}", { amount: formatTZS(value) })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
