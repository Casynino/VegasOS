"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BadgeCheck, CircleCheck, CornerUpLeft, ExternalLink, Loader2, PackageCheck, Receipt, TriangleAlert, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatTZS } from "@/lib/format";
import { formatQty } from "@/lib/inventory";
import { person, when, type PurchaseOptionsView, type StockReqView, type Viewer } from "@/lib/stock-requests";
import { approvePurchaseAction, sendBackPurchaseAction } from "./actions";
import { LinesTable } from "./lines-table";
import { ReasonBox } from "./parts";
import { useT } from "@/i18n/client";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/** Where it was bought, the receipt, the account and who bought it — for the final check and afterwards. */
export function PurchaseFacts({ r }: { r: StockReqView }) {
  const t = useT();
  const p = r.purchase;
  if (!p) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-border/70 bg-background/40 p-3 sm:grid-cols-3">
      <Fact label={t("Purchase")}>{p.number ?? "—"}</Fact>
      <Fact label={t("Bought from")}>{p.supplier ?? <span className="text-muted-foreground">—</span>}</Fact>
      <Fact label={t("Paid from")}>{p.account ? t(p.account) : <span className="text-muted-foreground">—</span>}</Fact>
      <Fact label={t("Bought by")}>{r.boughtBy ? person(r.boughtBy) : "—"}{p.on && <span className="block text-xs text-muted-foreground">{t.date(p.on)}</span>}</Fact>
      <Fact label={t("Receipt")}>
        {p.receiptNumber && <span className="block">{t("No. {number}", { number: p.receiptNumber })}</span>}
        {p.receiptFileId
          ? <a href={`/api/files/${p.receiptFileId}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold text-amber-600 hover:underline dark:text-amber-300"><ExternalLink className="size-3.5" />{p.receiptIsPdf ? t("Open the PDF") : t("Open the photo")}</a>
          : p.noReceiptReason ? <span className="text-rose-600 dark:text-rose-300">{t("No receipt: {reason}", { reason: p.noReceiptReason })}</span> : !p.receiptNumber && <span className="text-muted-foreground">—</span>}
      </Fact>
      {p.note && <Fact label={t("Buyer's note")}>{p.note}</Fact>}
    </dl>
  );
}

/**
 * The final check: what was asked, approved and bought with the prices, the supplier, the receipt
 * and the account. Approving adds the stock and records ONE expense in one step; or it goes back
 * to the buyer for correction.
 */
export function FinalCheck({ r, options, me, onDone, extra }: { r: StockReqView; options: PurchaseOptionsView; me: Viewer; onDone: () => void; extra?: React.ReactNode }) {
  const t = useT();
  const p = r.purchase;
  const code = options.expenseGroup[r.department] ?? "OTHER";
  const fallback = options.categories.find((c) => c.code === code) ?? options.categories.find((c) => c.code === "OTHER") ?? options.categories[0];
  const [categoryId, setCategoryId] = useState(fallback?.id ?? "");
  const [step, setStep] = useState<"idle" | "confirm" | "back">("idle");
  const [pending, start] = useTransition();
  const total = p?.total ?? r.lines.reduce((sum, l) => sum + ((l.purchasedQty ?? 0) > 0 ? l.lineTotal ?? 0 : 0), 0);
  const mine = !!r.boughtById && r.boughtById === me.id;
  const blocked = mine && me.approverMustDiffer;

  const approve = () => start(async () => {
    const res = await approvePurchaseAction({ id: r.id, categoryId: categoryId || null });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(t.plural(res.data.received, "{expense} recorded · {n} item into stock", "{expense} recorded · {n} items into stock", { expense: res.data.expenseNumber ?? t("Expense") }));
    onDone();
  });
  const sendBack = (reason: string) => start(async () => {
    const res = await sendBackPurchaseAction({ id: r.id, reason });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.message ?? t("Sent back for correction."));
    onDone();
  });

  return (
    <div className="space-y-3">
      <LinesTable lines={r.lines} money />
      <PurchaseFacts r={r} />
      {mine && (
        <p className={blocked
          ? "flex items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300"
          : "flex items-center gap-2 rounded-xl bg-amber-500/12 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-300"}>
          {blocked ? <TriangleAlert className="size-4 shrink-0" /> : <UserCheck className="size-4 shrink-0" />}
          {blocked ? t("You bought this — another manager (or the MD) gives the final approval.") : t("You bought this — you are also approving it.")}
        </p>
      )}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">{t("Kind of expense")}</span>
        <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-10" disabled={blocked}>
          {options.categories.map((c) => <option key={c.id} value={c.id}>{t(c.name)}</option>)}
        </NativeSelect>
      </label>
      {extra}

      <div className="sticky bottom-0 -mx-5 space-y-2 border-t border-border/70 bg-popover/95 px-5 py-3 backdrop-blur">
        {step === "confirm" ? (
          <div className="space-y-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.07] p-3">
            <p className="text-sm">
              {t.rich("Adds the stock and records <b>ONE expense of {amount}</b> paid from <b>{account}</b> — this cannot be undone here.", {
                b: (c) => <span className="font-semibold">{c}</span>,
              }, { amount: formatTZS(total), account: p?.account ? t(p.account) : t("the account chosen") })}
            </p>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="ghost" className="h-11" disabled={pending} onClick={() => setStep("idle")}>{t("Go back")}</Button>
              <Button className="h-11" disabled={pending} onClick={approve}>{pending ? <Loader2 className="animate-spin" /> : <BadgeCheck />}{t("Yes, approve the purchase")}</Button>
            </div>
          </div>
        ) : step === "back" ? (
          <ReasonBox placeholder={t("What to correct? e.g. The receipt shows 8 kg, not 9.5")} action={t("Send back")} pending={pending}
            onConfirm={sendBack} onCancel={() => setStep("idle")} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button className="h-11" disabled={pending || blocked} onClick={() => setStep("confirm")}><CircleCheck />{t("Approve purchase · {amount}", { amount: formatTZS(total) })}</Button>
            <Button variant="outline" className="h-11" disabled={pending} onClick={() => setStep("back")}><CornerUpLeft />{t("Send back for correction")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** What happened to a finished request: the stock that went in and — for buyers and approvers — the expense. */
export function CompletedSummary({ r, money }: { r: StockReqView; money: boolean }) {
  const t = useT();
  if (!r.purchaseNumber) {
    return (
      <div className="flex gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm">
        <PackageCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
        <p>{!r.decidedBy ? t("Received before purchases were recorded.")
          : r.decidedAt ? t("Received before purchases were recorded · marked by {name} · {when}.", { name: person(r.decidedBy), when: when(r.decidedAt, t) })
          : t("Received before purchases were recorded · marked by {name}.", { name: person(r.decidedBy) })}</p>
      </div>
    );
  }
  const inStock = r.lines.filter((l) => l.stockItem && (l.purchasedQty ?? 0) > 0);
  const outside = r.lines.filter((l) => !l.stockItem && (l.purchasedQty ?? 0) > 0);
  const same = !!r.boughtById && r.boughtById === r.finalById;
  const e = r.purchase?.expense;
  return (
    <div className="space-y-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm">
      {inStock.length > 0 && (
        <p className="flex gap-2"><PackageCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <span><span className="font-semibold">{t("In stock:")}</span> {inStock.map((l) => `${t(l.stockItem!.name)} +${formatQty(l.purchasedQty!, l.stockItem!.unit, t)}`).join(" · ")}</span>
        </p>
      )}
      {outside.length > 0 && <p className="pl-6 text-muted-foreground">{t("Bought, not kept in stock: {items}", { items: outside.map((l) => t(l.name)).join(", ") })}</p>}
      {money && e && (
        <p className="flex gap-2"><Receipt className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <span>{t("Expense")} <span className="font-mono font-semibold">{e.number ?? t("recorded")}</span> · {formatTZS(e.amount)}{r.purchase?.account && ` · ${t("paid from {account}", { account: t(r.purchase.account) })}`}</span>
        </p>
      )}
      <p className="pl-6 text-xs text-muted-foreground">
        {r.boughtBy && <>{r.purchase?.on ? t("Bought by {name} on {date}", { name: person(r.boughtBy), date: t.date(r.purchase.on) }) : t("Bought by {name}", { name: person(r.boughtBy) })}</>}
        {r.finalBy && <> · {t("approved by {name}", { name: person(r.finalBy) })}{r.finalAt && ` · ${when(r.finalAt, t)}`}</>}
        {same && <> — {t("the same person bought and approved it")}</>}
      </p>
    </div>
  );
}
