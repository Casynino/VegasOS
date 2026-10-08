"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, FileText, Loader2, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { billToLabel, PAYMENT_TERMS, termsLabel, type BillTo } from "@/lib/billing";
import { formatTZS } from "@/lib/format";
import { INVOICE_STATUS_META } from "@/lib/invoice-status";
import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { changeBillingAction } from "../actions";
import { billCompanyNowAction } from "../../invoices/actions";
import { useT } from "@/i18n/client";

type Company = { id: string; companyName: string; terms: number; billTo: BillTo; covers: string[] };

export function BillingPanel(p: {
  reservationId: string;
  /** A group booking's room: paid by the group (its company or contact) or by the guest ("own bill"). */
  group?: { id: string; name: string; reference: string; payer: string } | null;
  company: { id: string; name: string; terms: number } | null;
  billTo: BillTo; covers: string[]; terms: number | null;
  billed: number; unbilled: number;
  invoices: { id: string; number: string; status: InvoiceStatus; amount: number }[];
  companies: Company[];
  canEdit: boolean; canBill: boolean; closed: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const bill = () => start(async () => {
    const res = await billCompanyNowAction({ reservationId: p.reservationId });
    if (res.ok) {
      const vars = { amount: formatTZS(res.data.amount), number: res.data.number };
      toast.success(res.data.issued ? t("{amount} invoiced · {number}", vars) : t("{amount} added to the open invoice · {number}", vars)); router.refresh();
    }
    else toast.error(res.error, { duration: 8000 });
  });

  if (p.group) return <GroupBilling {...p} group={p.group} />;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl", p.company ? "bg-[#15110c] text-[#f0cf86]" : "bg-muted text-muted-foreground")}><Building2 className="size-4" /></span>
        <div className="min-w-0 flex-1">
          {p.company && p.billTo !== "GUEST" ? (
            <>
              <Link href={`/staff/corporate/${p.company.id}`} className="font-semibold hover:underline">{p.company.name}</Link>
              <p className="text-xs text-muted-foreground">{billToLabel(p.billTo, p.covers, t)} · {termsLabel(p.terms ?? p.company.terms, t)}</p>
            </>
          ) : (
            <><p className="font-semibold">{t("Guest pays")}</p><p className="text-xs text-muted-foreground">{t("The guest settles the bill at the desk.")}</p></>
          )}
        </div>
        {p.canEdit && !p.closed && <BillingDialog {...p} />}
      </div>
      {p.company && p.billTo !== "GUEST" && (
        <div className="space-y-2 rounded-2xl bg-muted/50 p-3">
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">{t("On the company's invoice")}</span><strong className="tabular-nums">{formatTZS(p.billed)}</strong></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">{t("Company part not invoiced yet")}</span><strong className="tabular-nums">{formatTZS(p.unbilled)}</strong></div>
          {p.invoices.map((i) => (
            <Link key={i.id} href={`/staff/invoices/${i.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-card px-2.5 py-2 text-xs hover:bg-muted">
              <span className="inline-flex items-center gap-1.5 font-mono font-medium"><FileText className="size-3.5" />{i.number}</span>
              <span className="flex items-center gap-2"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", INVOICE_STATUS_META[i.status].className)}>{t(INVOICE_STATUS_META[i.status].label)}</span><span className="tabular-nums">{formatTZS(i.amount)}</span></span>
            </Link>
          ))}
          {p.canBill && p.unbilled !== 0 && (
            <Button size="sm" variant="outline" className="w-full" disabled={pending} onClick={bill}>
              {pending ? <Loader2 className="animate-spin" /> : <Send />}{t("Bill the company now ({amount})", { amount: formatTZS(p.unbilled) })}
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">{t("It is billed automatically at checkout (“Check out & issue invoice”).")}</p>
        </div>
      )}
    </div>
  );
}

function BillingDialog(p: Parameters<typeof BillingPanel>[0]) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(p.company?.id ?? "");
  const [terms, setTerms] = useState<number | null>(p.terms);
  const [pending, start] = useTransition();
  const router = useRouter();
  const guest = !companyId;
  const company = p.companies.find((c) => c.id === companyId);
  const chip = (on: boolean) => cn("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted");

  function save() {
    start(async () => {
      const res = await changeBillingAction({
        reservationId: p.reservationId, corporateCustomerId: companyId || null, billTo: guest ? "GUEST" : "COMPANY",
        covers: [], paymentTermDays: guest ? null : terms,
      });
      if (res.ok) { toast.success(t("Who pays is updated.")); setOpen(false); router.refresh(); } else toast.error(res.error, { duration: 8000 });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}><Pencil />{t("Change")}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader icon={<Building2 />} eyebrow={t("Billing")} tone="sky"><DialogTitle>{t("Who pays for this stay?")}</DialogTitle><DialogDescription>{t("Anything already on a company invoice is corrected the next time the company is billed.")}</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <NativeSelect aria-label={t("Who pays")} value={companyId} onChange={(e) => {
            setCompanyId(e.target.value);
            const c = p.companies.find((x) => x.id === e.target.value);
            if (c) setTerms(null);
          }}>
            <option value="">{t("The guest pays")}</option>
            {p.companies.map((c) => <option key={c.id} value={c.id}>{c.companyName} — {t("company invoice")}</option>)}
          </NativeSelect>
          {!guest && (
            <>
              <p className="text-xs text-muted-foreground">{t("The company pays the whole bill — room, food, drinks and extras.")}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t("Pay within")}</span>
                {PAYMENT_TERMS.map((d) => <button key={d} type="button" className={chip((terms ?? company?.terms) === d)} onClick={() => setTerms(d)}>{d === 0 ? t("Now") : t("{days} days", { days: d })}</button>)}
              </div>
            </>
          )}
          <Button className="w-full" disabled={pending} onClick={save}>{pending && <Loader2 className="animate-spin" />}{t("Save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Who pays for a group room: the group (one bill with the other rooms) or the guest (own bill). */
function GroupBilling(p: Parameters<typeof BillingPanel>[0] & { group: NonNullable<Parameters<typeof BillingPanel>[0]["group"]> }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const groupPays = p.billTo === "GROUP";
  const set = (billTo: "GROUP" | "GUEST") => start(async () => {
    const res = await changeBillingAction({ reservationId: p.reservationId, corporateCustomerId: null, billTo, covers: [], paymentTermDays: null });
    if (res.ok) { toast.success(billTo === "GROUP" ? t("The group pays this room.") : t("This room now pays its own bill.")); router.refresh(); } else toast.error(res.error, { duration: 8000 });
  });
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-500/12 text-violet-700 dark:text-violet-300"><Building2 className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{groupPays ? t("Paid by the group — {payer}", { payer: p.group.payer }) : t("Pays own bill")}</p>
          <p className="text-xs text-muted-foreground">
            {t.rich("Part of <link>{name}</link> · {reference}", {
              link: (c) => <Link href={`/staff/groups/${p.group.id}`} className="font-medium text-foreground hover:underline">{c}</Link>,
            }, { name: p.group.name, reference: p.group.reference })}
          </p>
        </div>
      </div>
      {groupPays && (
        <div className="space-y-1.5 rounded-2xl bg-muted/50 p-3 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">{t("On the group's invoice")}</span><strong className="tabular-nums">{formatTZS(p.billed)}</strong></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{t("Not invoiced yet")}</span><strong className="tabular-nums">{formatTZS(p.unbilled)}</strong></div>
          {p.invoices.map((i) => (
            <Link key={i.id} href={`/staff/invoices/${i.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-card px-2.5 py-2 hover:bg-muted">
              <span className="inline-flex items-center gap-1.5 font-mono font-medium"><FileText className="size-3.5" />{i.number}</span>
              <span className="flex items-center gap-2"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", INVOICE_STATUS_META[i.status].className)}>{t(INVOICE_STATUS_META[i.status].label)}</span><span className="tabular-nums">{formatTZS(i.amount)}</span></span>
            </Link>
          ))}
          <p className="text-[11px] text-muted-foreground">{t("At checkout this room's whole bill moves to the group's invoice — the guest pays nothing at the desk.")}</p>
        </div>
      )}
      {p.canEdit && !p.closed && (
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant={groupPays ? "default" : "outline"} disabled={pending || groupPays} onClick={() => set("GROUP")}>{t("The group pays")}</Button>
          <Button size="sm" variant={!groupPays ? "default" : "outline"} disabled={pending || !groupPays || p.billed !== 0} onClick={() => set("GUEST")}>{t("Own bill")}</Button>
        </div>
      )}
    </div>
  );
}
