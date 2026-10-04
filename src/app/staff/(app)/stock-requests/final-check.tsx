"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BadgeCheck, CircleCheck, CornerUpLeft, ExternalLink, Loader2, PackageCheck, Receipt, TriangleAlert, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { formatQty } from "@/lib/inventory";
import { person, when, type PurchaseOptionsView, type StockReqView, type Viewer } from "@/lib/stock-requests";
import { approvePurchaseAction, sendBackPurchaseAction } from "./actions";
import { LinesTable } from "./lines-table";
import { ReasonBox } from "./parts";

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
  const p = r.purchase;
  if (!p) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-border/70 bg-background/40 p-3 sm:grid-cols-3">
      <Fact label="Purchase">{p.number ?? "—"}</Fact>
      <Fact label="Bought from">{p.supplier ?? <span className="text-muted-foreground">—</span>}</Fact>
      <Fact label="Paid from">{p.account ?? <span className="text-muted-foreground">—</span>}</Fact>
      <Fact label="Bought by">{r.boughtBy ? person(r.boughtBy) : "—"}{p.on && <span className="block text-xs text-muted-foreground">{formatBusinessDate(p.on)}</span>}</Fact>
      <Fact label="Receipt">
        {p.receiptNumber && <span className="block">No. {p.receiptNumber}</span>}
        {p.receiptFileId
          ? <a href={`/api/files/${p.receiptFileId}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold text-amber-600 hover:underline dark:text-amber-300"><ExternalLink className="size-3.5" />Open the {p.receiptIsPdf ? "PDF" : "photo"}</a>
          : p.noReceiptReason ? <span className="text-rose-600 dark:text-rose-300">No receipt: {p.noReceiptReason}</span> : !p.receiptNumber && <span className="text-muted-foreground">—</span>}
      </Fact>
      {p.note && <Fact label="Buyer's note">{p.note}</Fact>}
    </dl>
  );
}

/**
 * The final check: what was asked, approved and bought with the prices, the supplier, the receipt
 * and the account. Approving adds the stock and records ONE expense in one step; or it goes back
 * to the buyer for correction.
 */
export function FinalCheck({ r, options, me, onDone, extra }: { r: StockReqView; options: PurchaseOptionsView; me: Viewer; onDone: () => void; extra?: React.ReactNode }) {
  const p = r.purchase;
  const code = options.expenseGroup[r.department] ?? "OTHER";
  const fallback = options.categories.find((c) => c.code === code) ?? options.categories.find((c) => c.code === "OTHER") ?? options.categories[0];
  const [categoryId, setCategoryId] = useState(fallback?.id ?? "");
  const [step, setStep] = useState<"idle" | "confirm" | "back">("idle");
  const [pending, start] = useTransition();
  const total = p?.total ?? r.lines.reduce((t, l) => t + ((l.purchasedQty ?? 0) > 0 ? l.lineTotal ?? 0 : 0), 0);
  const mine = !!r.boughtById && r.boughtById === me.id;
  const blocked = mine && me.approverMustDiffer;

  const approve = () => start(async () => {
    const res = await approvePurchaseAction({ id: r.id, categoryId: categoryId || null });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`${res.data.expenseNumber ?? "Expense"} recorded · ${res.data.received} item${res.data.received === 1 ? "" : "s"} into stock`);
    onDone();
  });
  const sendBack = (reason: string) => start(async () => {
    const res = await sendBackPurchaseAction({ id: r.id, reason });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.message ?? "Sent back for correction.");
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
          {blocked ? "You bought this — another manager (or the MD) gives the final approval." : "You bought this — you are also approving it."}
        </p>
      )}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-muted-foreground">Kind of expense</span>
        <NativeSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-10" disabled={blocked}>
          {options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </label>
      {extra}

      <div className="sticky bottom-0 -mx-5 space-y-2 border-t border-border/70 bg-popover/95 px-5 py-3 backdrop-blur">
        {step === "confirm" ? (
          <div className="space-y-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.07] p-3">
            <p className="text-sm">
              Adds the stock and records <span className="font-semibold">ONE expense of {formatTZS(total)}</span> paid from <span className="font-semibold">{p?.account ?? "the account chosen"}</span> — this cannot be undone here.
            </p>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="ghost" className="h-11" disabled={pending} onClick={() => setStep("idle")}>Go back</Button>
              <Button className="h-11" disabled={pending} onClick={approve}>{pending ? <Loader2 className="animate-spin" /> : <BadgeCheck />}Yes, approve the purchase</Button>
            </div>
          </div>
        ) : step === "back" ? (
          <ReasonBox placeholder="What to correct? e.g. The receipt shows 8 kg, not 9.5" action="Send back" pending={pending}
            onConfirm={sendBack} onCancel={() => setStep("idle")} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button className="h-11" disabled={pending || blocked} onClick={() => setStep("confirm")}><CircleCheck />Approve purchase · {formatTZS(total)}</Button>
            <Button variant="outline" className="h-11" disabled={pending} onClick={() => setStep("back")}><CornerUpLeft />Send back for correction</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** What happened to a finished request: the stock that went in and — for buyers and approvers — the expense. */
export function CompletedSummary({ r, money }: { r: StockReqView; money: boolean }) {
  if (!r.purchaseNumber) {
    return (
      <div className="flex gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm">
        <PackageCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
        <p>Received before purchases were recorded{r.decidedBy && <> · marked by {person(r.decidedBy)}{r.decidedAt && ` · ${when(r.decidedAt)}`}</>}.</p>
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
          <span><span className="font-semibold">In stock:</span> {inStock.map((l) => `${l.stockItem!.name} +${formatQty(l.purchasedQty!, l.stockItem!.unit)}`).join(" · ")}</span>
        </p>
      )}
      {outside.length > 0 && <p className="pl-6 text-muted-foreground">Bought, not kept in stock: {outside.map((l) => l.name).join(", ")}</p>}
      {money && e && (
        <p className="flex gap-2"><Receipt className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <span>Expense <span className="font-mono font-semibold">{e.number ?? "recorded"}</span> · {formatTZS(e.amount)}{r.purchase?.account && ` · paid from ${r.purchase.account}`}</span>
        </p>
      )}
      <p className="pl-6 text-xs text-muted-foreground">
        {r.boughtBy && <>Bought by {person(r.boughtBy)}{r.purchase?.on && ` on ${formatBusinessDate(r.purchase.on)}`}</>}
        {r.finalBy && <> · approved by {person(r.finalBy)}{r.finalAt && ` · ${when(r.finalAt)}`}</>}
        {same && " — the same person bought and approved it"}
      </p>
    </div>
  );
}
