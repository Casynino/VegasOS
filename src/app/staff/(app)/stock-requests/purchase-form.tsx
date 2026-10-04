"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CornerUpLeft, ExternalLink, Loader2, Paperclip, Save, Send, Store, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import { unitOf } from "@/lib/inventory";
import { num, toBuyQty, unitWord, type PurchaseOptionsView, type StockLineView, type StockReqView } from "@/lib/stock-requests";
import { savePurchaseAction } from "./actions";

type PL = {
  id: string; name: string; asked: number; approved: number; unit: string;
  itemId: string; qty: string; price: string; total: string; touched: boolean; expiresOn: string;
  /** Linked to a stock item that has since been switched off (shown, so the buyer sees why it fails). */
  offName: string | null;
};
const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const OTHER = "__other";
const digits = (v: string) => v.replace(/[^\d]/g, "");
const decimal = (v: string) => v.replace(/[^\d.]/g, "");

/** Counted the same way as the stock item? (3 crates asked are not 3 bottles into stock.) */
const sameUnit = (stockUnit: string | null | undefined, asked: string) => !stockUnit || unitWord(stockUnit) === asked;

function initLine(l: StockLineView, active: Set<string>): PL {
  // The approved amount fills in only when it is in the stock item's unit; otherwise the buyer enters it.
  const qty = l.purchasedQty ?? (sameUnit(l.stockItem?.unit, l.unit) ? toBuyQty(l) : null);
  const auto = qty != null && l.unitPrice != null ? Math.round(qty * l.unitPrice) : null;
  return {
    id: l.id, name: l.name, asked: l.quantity, approved: toBuyQty(l), unit: l.unit, itemId: l.stockItem?.id ?? "",
    qty: qty != null ? num(qty) : "", price: l.unitPrice != null ? String(l.unitPrice) : "", total: l.lineTotal != null ? String(l.lineTotal) : "",
    touched: l.lineTotal != null && auto != null && l.lineTotal !== auto, expiresOn: l.expiresOn ?? "",
    offName: l.stockItem && !active.has(l.stockItem.id) ? l.stockItem.name : null,
  };
}
/** The line's total: what the receipt says when typed in, else quantity × price. 0 when nothing was bought. */
function totalOf(p: PL) {
  const q = Number(p.qty) || 0;
  if (q <= 0) return 0;
  return p.touched ? Math.round(Number(p.total) || 0) : Math.round(q * (Number(p.price) || 0));
}

/**
 * Record what was actually bought — per line the stock item, the quantity, the price and the
 * total from the receipt (never the amounts asked for); then the supplier, the receipt, the day
 * and the company account that paid. Save while buying; send it for the final approval when done.
 */
export function PurchaseForm({ r, options, today, onDone, onCancel }: {
  r: StockReqView; options: PurchaseOptionsView; today: string; onDone: () => void; onCancel: () => void;
}) {
  const p = r.purchase;
  const [lines, setLines] = useState<PL[]>(() => { const active = new Set(options.items.map((i) => i.id)); return r.lines.map((l) => initLine(l, active)); });
  const [supplier, setSupplier] = useState(p?.supplierId ?? (p?.supplierName ? OTHER : ""));
  const [supplierName, setSupplierName] = useState(p?.supplierName ?? "");
  const [receiptNumber, setReceiptNumber] = useState(p?.receiptNumber ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [noReceipt, setNoReceipt] = useState(!!p?.noReceiptReason && !p?.receiptFileId);
  const [noReceiptReason, setNoReceiptReason] = useState(p?.noReceiptReason ?? "");
  const [on, setOn] = useState(p?.on ?? today);
  const [accountId, setAccountId] = useState(p?.accountId ?? (options.accounts.length === 1 ? options.accounts[0].id : ""));
  const [note, setNote] = useState(p?.note ?? "");
  const [pending, start] = useTransition();
  const [sending, setSending] = useState<"save" | "submit" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const itemById = new Map(options.items.map((i) => [i.id, i]));
  const own = options.items.filter((i) => i.departmentId === r.departmentId);
  const rest = options.items.filter((i) => i.departmentId !== r.departmentId);
  const set = (id: string, patch: Partial<PL>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const total = lines.reduce((t, l) => t + totalOf(l), 0);
  const bought = lines.filter((l) => (Number(l.qty) || 0) > 0).length;
  // What the approved list would cost at the last prices paid — only where the units match.
  const est = lines.map((l) => {
    const it = l.itemId ? itemById.get(l.itemId) : null;
    return it && it.costPerUnit > 0 && unitWord(it.unit) === l.unit ? it.costPerUnit * l.approved : null;
  });
  const estKnown = est.filter((x): x is number => x != null);
  const estimate = estKnown.reduce((t, x) => t + x, 0);

  const pick = (f: File | null) => {
    if (!f) { setFile(null); return; }
    if (!RECEIPT_TYPES.includes(f.type)) { toast.error("The receipt must be a photo (JPG, PNG, WebP, HEIC) or a PDF."); return; }
    if (f.size > 5 * 1024 * 1024) { toast.error("The receipt is larger than 5 MB — take a smaller photo."); return; }
    setFile(f); setNoReceipt(false);
  };

  const send = (submit: boolean) => start(async () => {
    setSending(submit ? "submit" : "save");
    const data = {
      lines: lines.map((l) => ({
        id: l.id, inventoryItemId: l.itemId || null, purchasedQty: Number(l.qty) || 0, unitPrice: Math.round(Number(l.price) || 0),
        lineTotal: l.touched ? Math.round(Number(l.total) || 0) : null, expiresOn: l.expiresOn || null,
      })),
      supplierId: supplier && supplier !== OTHER ? supplier : null, supplierName: supplier === OTHER ? supplierName.trim() || null : null,
      receiptNumber: receiptNumber.trim() || null, noReceiptReason: noReceipt ? noReceiptReason.trim() || null : null,
      purchasedOn: on, accountId: accountId || null, note: note.trim() || null, submit,
    };
    const fd = new FormData();
    fd.set("id", r.id);
    fd.set("data", JSON.stringify(data));
    if (file) fd.set("receipt", file);
    const res = await savePurchaseAction(fd);
    setSending(null);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(submit
      ? `${res.data.purchaseNumber} sent for final approval · ${formatTZS(res.data.total)}`
      : `${res.data.purchaseNumber} saved — finish it when you have the receipt.`);
    onDone();
  });

  return (
    <div className="space-y-4 px-5 pb-5">
      {p?.correctionNote && (
        <div className="flex gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/[0.08] px-4 py-3">
          <CornerUpLeft className="mt-0.5 size-4 shrink-0 text-rose-500" />
          <p className="text-sm"><span className="font-semibold text-rose-600 dark:text-rose-300">Sent back for correction:</span> {p.correctionNote}</p>
        </div>
      )}

      {/* ── What was bought, line by line ── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">What was bought</h3>
        <p className="-mt-1 text-xs text-muted-foreground">Enter what the receipt says. Put 0 for anything not bought.</p>
        <ul className="space-y-2">
          {lines.map((l) => {
            const it = l.itemId ? itemById.get(l.itemId) : null;
            const unit = it ? unitOf(it.unit).plural : l.unit;
            const lineTotal = totalOf(l);
            const auto = Math.round((Number(l.qty) || 0) * (Number(l.price) || 0));
            const none = (Number(l.qty) || 0) <= 0;
            return (
              <li key={l.id} className={cn("rounded-2xl border p-3", none ? "border-dashed border-border bg-muted/20" : "border-border/70 bg-background/40")}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-sm font-semibold">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Asked {num(l.asked)} {l.unit}{l.approved !== l.asked && <> · <span className="font-medium text-foreground">approved {num(l.approved)} {l.unit}</span></>}
                  </p>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
                  <label className="col-span-2 space-y-1 sm:col-span-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Stock item</span>
                    <NativeSelect value={l.itemId} className="h-10" onChange={(e) => {
                      const next = e.target.value ? itemById.get(e.target.value) : null;
                      // A prefilled approved amount in another unit is not what goes into stock: ask again.
                      set(l.id, { itemId: e.target.value, offName: null, ...(l.qty === num(l.approved) && !sameUnit(next?.unit, l.unit) ? { qty: "" } : {}) });
                    }}>
                      <option value="">Not kept in stock</option>
                      {l.offName && <option value={l.itemId} disabled>{l.offName} (switched off — choose another)</option>}
                      {own.length > 0 && <optgroup label={`${r.departmentName} stores`}>{own.map((i) => <option key={i.id} value={i.id}>{i.name} ({unitOf(i.unit).label})</option>)}</optgroup>}
                      {rest.length > 0 && <optgroup label="Other stores">{rest.map((i) => <option key={i.id} value={i.id}>{i.name} ({unitOf(i.unit).label})</option>)}</optgroup>}
                    </NativeSelect>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Bought ({unit})</span>
                    <Input value={l.qty} onChange={(e) => set(l.id, { qty: decimal(e.target.value) })} inputMode="decimal" className="h-10 tabular-nums"
                      placeholder={it && !sameUnit(it.unit, l.unit) ? `asked ${num(l.approved)} ${l.unit}` : "0"} />
                    {it && !sameUnit(it.unit, l.unit) && <span className="block text-[10.5px] text-amber-600 dark:text-amber-300">Asked in {l.unit} — enter how many {unitOf(it.unit).plural}</span>}
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Price per {it ? unitOf(it.unit).label : "unit"} (TZS)</span>
                    <Input value={l.price} onChange={(e) => set(l.id, { price: digits(e.target.value) })} inputMode="numeric" disabled={none}
                      placeholder={it?.costPerUnit ? `last ${it.costPerUnit.toLocaleString("en-US")}` : "0"} className="h-10 tabular-nums" />
                  </label>
                  <div className="col-span-2 space-y-1 sm:col-span-1">
                    <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
                      <label htmlFor={`total-${l.id}`}>Line total (TZS)</label>
                      {l.touched && lineTotal !== auto && !none && (
                        <button type="button" onClick={() => set(l.id, { touched: false, total: "" })} className="font-semibold text-amber-600 hover:underline dark:text-amber-300">= qty × price</button>
                      )}
                    </span>
                    <Input id={`total-${l.id}`} value={none ? "0" : l.touched ? l.total : String(auto)} disabled={none} inputMode="numeric"
                      onChange={(e) => set(l.id, { total: digits(e.target.value), touched: true })} className="h-10 font-semibold tabular-nums" />
                  </div>
                  {it?.tracksExpiry && !none && (
                    <label className="col-span-2 space-y-1 sm:col-span-4 sm:flex sm:items-center sm:gap-3 sm:space-y-0">
                      <span className="text-[11px] font-medium text-muted-foreground">Expiry date on the pack</span>
                      <Input type="date" value={l.expiresOn} min={on} onChange={(e) => set(l.id, { expiresOn: e.target.value })} className="h-10 sm:w-48" />
                    </label>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Where, the receipt, the day and the account ── */}
      <section className="grid gap-3 rounded-2xl border border-border/70 bg-background/40 p-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Store className="size-3.5" />Bought from</span>
          <NativeSelect value={supplier} onChange={(e) => setSupplier(e.target.value)} className="h-10">
            <option value="">Choose the supplier…</option>
            {options.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value={OTHER}>Someone else — type the name</option>
          </NativeSelect>
          {supplier === OTHER && <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} maxLength={120} placeholder="e.g. Mama Asha, Kariakoo market" className="mt-1.5 h-10" autoFocus />}
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Receipt number</span>
          <Input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} maxLength={60} placeholder="As printed on the receipt" className="h-10" />
        </label>
        <div className="space-y-1 sm:col-span-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Paperclip className="size-3.5" />Receipt photo or PDF</span>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept={RECEIPT_TYPES.join(",")} className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <Button type="button" variant="outline" className="h-10" onClick={() => fileRef.current?.click()}><Paperclip />{file ? "Change the file" : p?.receiptFileId ? "Replace the receipt" : "Add the receipt"}</Button>
            {file && (
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <span className="truncate">{file.name}</span>
                <button type="button" aria-label="Remove the file" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}><X className="size-3.5" /></button>
              </span>
            )}
            {!file && p?.receiptFileId && (
              <a href={`/api/files/${p.receiptFileId}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:underline dark:text-amber-300">
                <ExternalLink className="size-3.5" />Open the receipt on file
              </a>
            )}
            {!file && !p?.receiptFileId && (
              <button type="button" onClick={() => setNoReceipt((v) => !v)} aria-pressed={noReceipt}
                className={cn("text-xs font-medium hover:underline", noReceipt ? "text-foreground" : "text-muted-foreground")}>
                {noReceipt ? "I have a receipt after all" : "There is no receipt"}
              </button>
            )}
          </div>
          {noReceipt && !file && !p?.receiptFileId && (
            <Input value={noReceiptReason} onChange={(e) => setNoReceiptReason(e.target.value)} maxLength={200} autoFocus
              placeholder="No receipt because… e.g. market seller gives no receipts" className="mt-1.5 h-10" />
          )}
        </div>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Bought on</span>
          <Input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} className="h-10" />
        </label>
        <label className="space-y-1">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Wallet className="size-3.5" />Paid from</span>
          <NativeSelect value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-10">
            <option value="">Which company account paid?</option>
            {options.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </NativeSelect>
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[11px] font-medium text-muted-foreground">Notes (optional)</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Tomatoes were cheaper at the market" className="h-10" />
        </label>
      </section>

      {/* ── The total, and sending it ── */}
      <div className="sticky bottom-0 -mx-5 space-y-3 border-t border-border/70 bg-popover/95 px-5 pb-1 pt-3 backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="leading-tight">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Actually paid</p>
            <p className="text-[22px] font-semibold tabular-nums">{formatTZS(total)}</p>
          </div>
          <p className="text-right text-xs text-muted-foreground">
            {bought} of {lines.length} item{lines.length === 1 ? "" : "s"} bought
            {estKnown.length > 0 && (
              <span className="block">
                At the last prices, what was approved ≈ {formatTZS(estimate)}{estKnown.length < lines.length ? ` (${estKnown.length} of ${lines.length} items)` : ""}
              </span>
            )}
          </p>
        </div>
        <div className="grid grid-cols-[auto_auto_1fr] gap-2">
          <Button variant="ghost" className="h-11" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button variant="outline" className="h-11" onClick={() => send(false)} disabled={pending}>{sending === "save" ? <Loader2 className="animate-spin" /> : <Save />}Save</Button>
          <Button className="h-11" onClick={() => send(true)} disabled={pending || bought === 0}>{sending === "submit" ? <Loader2 className="animate-spin" /> : <Send />}Send for final approval</Button>
        </div>
      </div>
    </div>
  );
}
