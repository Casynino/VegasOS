"use client";

import { useId, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Ban, Banknote, CheckCircle2, ClipboardCheck, FilePlus2, Loader2, PackageCheck, ReceiptText, RotateCcw, ScrollText, Send, Truck } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, type DialogTone } from "@/components/ui/dialog";
import type { ActionResult } from "@/server/errors";
import { formatTZS } from "@/lib/format";
import { useT } from "@/i18n/client";
import {
  authorizeQuoteAction, cancelInvoiceAction, cancelOrderAction, closeDeliveryAction, issueOrderAction, paySupplierAction, proposeQuoteAction, recordDeliveryAction, recordInvoiceAction,
  recordQuoteAction, reportDeliveryAction, verifyInvoiceAction,
} from "./actions";

type Action = (prev: unknown, formData: FormData) => Promise<ActionResult<unknown>>;

/** A button that opens a dialog; `children` is the form (it gets `done`, which closes the dialog and reloads the page's data). */
function Modal({ label, icon, variant = "default", size = "sm", title, intro, eyebrow, tone = "gold", wide, children }: {
  label: string; icon: ReactNode; variant?: "default" | "outline" | "destructive"; size?: "sm" | "default"; title: string; intro?: string; eyebrow: string; tone?: DialogTone; wide?: boolean;
  children: (done: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button type="button" size={size} variant={variant} onClick={() => setOpen(true)}>{icon}{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={wide ? "max-h-[92dvh] overflow-y-auto sm:max-w-2xl" : "max-h-[92dvh] overflow-y-auto sm:max-w-md"}>
          <DialogHeader icon={icon} eyebrow={eyebrow} tone={tone}>
            <DialogTitle>{title}</DialogTitle>
            {intro && <DialogDescription>{intro}</DialogDescription>}
          </DialogHeader>
          {children(() => { setOpen(false); router.refresh(); })}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Submit({ pending, icon, children }: { pending: boolean; icon: ReactNode; children: ReactNode }) {
  return <Button type="submit" className="w-full" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : icon}{children}</Button>;
}

/** A note or reason, then one tap: used for every "say why" step. */
export function ReasonDialog({ action, fields, label, icon, variant = "outline", title, intro, question, button, required, optional, eyebrow, tone = "amber" }: {
  action: Action; fields: Record<string, string>; label: string; icon: ReactNode; variant?: "default" | "outline" | "destructive"; title: string; intro?: string; question: string; button: string;
  required?: boolean; optional?: boolean; eyebrow: string; tone?: DialogTone;
}) {
  const t = useT();
  return (
    <Modal label={label} icon={icon} variant={variant} title={title} intro={intro} eyebrow={eyebrow} tone={tone}>
      {(done) => (
        <ActionForm action={action} onSuccess={done} className="space-y-4">
          {({ pending, fieldErrors: e }) => (
            <>
              {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <div className="space-y-1.5">
                <Label htmlFor={`why-${button}`}>{question}{optional && <span className="text-muted-foreground"> · {t("optional")}</span>}</Label>
                <Textarea id={`why-${button}`} name={required || optional ? (fields.decision ? "note" : "reason") : "reason"} rows={3} maxLength={300} />
                <FieldError message={e?.reason ?? e?.note} />
              </div>
              <Submit pending={pending} icon={icon}>{button}</Submit>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

// ───────────────────────── Quotations ─────────────────────────

type QuoteItem = { id: string; name: string; unit: string; qty: number };

/** The Accountant records one supplier's quotation: who, line by line what they charge, how long it holds, and their document. */
export function QuoteDialog({ id, items, suppliers }: { id: string; items: QuoteItem[]; suppliers: { id: string; name: string }[] }) {
  const t = useT();
  const [supplierId, setSupplierId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState(() => items.map((i) => ({ itemId: i.id, on: true, qty: String(i.qty), price: "" })));
  const priced = rows.filter((r) => r.on && Number(r.price) > 0);
  const total = priced.reduce((s, r) => s + Math.round(Number(r.qty) * Number(r.price)), 0);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((all) => all.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const payload = JSON.stringify({
    id, supplierId: supplierId === "new" ? null : supplierId || null,
    newSupplier: supplierId === "new" ? { name: newName, phone: newPhone || undefined } : null,
    validUntil: validUntil || null, deliveryDays: days === "" ? null : Number(days), note: note || undefined,
    lines: priced.map((r) => ({ itemId: r.itemId, quantity: Number(r.qty), unitPrice: Math.round(Number(r.price)) })),
  });
  return (
    <Modal label={t("Add a quotation")} icon={<ScrollText />} title={t("Supplier quotation")} eyebrow={t("Procurement")} tone="sky" wide
      intro={t("What one supplier would charge for this purchase. Nothing is bought by recording it.")}>
      {(done) => (
        <ActionForm action={recordQuoteAction as Action} onSuccess={done} className="space-y-4">
          {({ pending, fieldErrors: e }) => (
            <>
              <input type="hidden" name="payload" value={payload} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="q-supplier">{t("Supplier")}</Label>
                  <NativeSelect id="q-supplier" value={supplierId} onChange={(ev) => setSupplierId(ev.target.value)}>
                    <option value="">{t("Choose…")}</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    <option value="new">{t("A new supplier…")}</option>
                  </NativeSelect>
                  <FieldError message={e?.supplier} />
                </div>
                {supplierId === "new" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="q-new">{t("New supplier's name")}</Label>
                    <Input id="q-new" value={newName} onChange={(ev) => setNewName(ev.target.value)} maxLength={80} />
                    <Input value={newPhone} onChange={(ev) => setNewPhone(ev.target.value)} maxLength={40} placeholder={t("Phone (optional)")} aria-label={t("Phone (optional)")} />
                  </div>
                )}
              </div>
              <div className="overflow-x-auto rounded-2xl border border-border/60">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead><tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{t("Item")}</th><th className="px-2 py-2 font-medium">{t("Quantity")}</th><th className="px-2 py-2 font-medium">{t("Price each (TZS)")}</th><th className="px-3 py-2 text-right font-medium">{t("Line total")}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border/50">
                    {items.map((it, i) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2"><label className="flex items-center gap-2"><input type="checkbox" checked={rows[i].on} onChange={(ev) => set(i, { on: ev.target.checked })} className="size-4 accent-[var(--primary)]" />{it.name}</label></td>
                        <td className="px-2 py-2"><Input type="number" min={0} step="any" inputMode="decimal" value={rows[i].qty} onChange={(ev) => set(i, { qty: ev.target.value })} className="h-9 w-20 tabular-nums" aria-label={t("Quantity")} /><span className="ml-1 text-[11px] text-muted-foreground">{it.unit}</span></td>
                        <td className="px-2 py-2"><Input type="number" min={0} step={1} inputMode="numeric" value={rows[i].price} onChange={(ev) => set(i, { price: ev.target.value })} className="h-9 w-28 tabular-nums" aria-label={t("Price each (TZS)")} disabled={!rows[i].on} /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{rows[i].on && Number(rows[i].price) > 0 ? formatTZS(Math.round(Number(rows[i].qty) * Number(rows[i].price))) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t border-border/60"><td colSpan={3} className="px-3 py-2 text-right font-medium">{t("Quotation total")}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{formatTZS(total)}</td></tr></tfoot>
                </table>
              </div>
              <FieldError message={e?.lines} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="q-valid">{t("Price holds until")}</Label><Input id="q-valid" type="date" value={validUntil} onChange={(ev) => setValidUntil(ev.target.value)} /><FieldError message={e?.validUntil} /></div>
                <div className="space-y-1.5"><Label htmlFor="q-days">{t("Delivery takes (days)")}</Label><Input id="q-days" type="number" min={0} max={365} inputMode="numeric" value={days} onChange={(ev) => setDays(ev.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="q-note">{t("Note")} <span className="text-muted-foreground">· {t("optional")}</span></Label><Textarea id="q-note" rows={2} maxLength={300} value={note} onChange={(ev) => setNote(ev.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="q-doc">{t("The supplier's quotation (photo or PDF)")} <span className="text-muted-foreground">· {t("optional")}</span></Label><Input id="q-doc" name="document" type="file" accept="image/*,application/pdf" /></div>
              <Submit pending={pending} icon={<FilePlus2 />}>{t("Record the quotation")}</Submit>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

/** The Accountant proposes one quotation. Within the budget it is authorized at once; above it, Finance is asked. */
export function ProposeButton({ id, quoteId }: { id: string; quoteId: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <ActionForm action={proposeQuoteAction as Action} onSuccess={() => router.refresh()}>
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} /><input type="hidden" name="quoteId" value={quoteId} />
          <Button type="submit" size="sm" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{t("Propose this one")}</Button>
        </>
      )}
    </ActionForm>
  );
}

/** Finance's answer when the price is above the budget. */
export function AuthorizeButtons({ id }: { id: string }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      <ReasonDialog action={authorizeQuoteAction as Action} fields={{ id, decision: "AUTHORIZE" }} label={t("Authorize this price")} icon={<BadgeCheck />} variant="default" eyebrow={t("Finance")} tone="emerald"
        title={t("Authorize this price")} intro={t("The purchase may then be ordered at this price. Your name and the time are kept.")} question={t("Note")} optional button={t("Authorize")} />
      <ReasonDialog action={authorizeQuoteAction as Action} fields={{ id, decision: "RETURN" }} label={t("Send back")} icon={<RotateCcw />} eyebrow={t("Finance")}
        title={t("Send back to the Accountant")} intro={t("Nothing is ordered. The Accountant sees your reason and can get a better price.")} question={t("What should the Accountant do?")} required button={t("Send back")} />
    </div>
  );
}

// ───────────────────────── Order and delivery ─────────────────────────

export function OrderDialog({ id, defaultDate, supplier, total }: { id: string; defaultDate: string; supplier: string; total: number }) {
  const t = useT();
  return (
    <Modal label={t("Issue the purchase order")} icon={<ClipboardCheck />} title={t("Purchase order")} eyebrow={t("Procurement")} tone="violet"
      intro={t("To {supplier} for {amount}. Nothing has arrived and nothing is paid yet.", { supplier, amount: formatTZS(total) })}>
      {(done) => (
        <ActionForm action={issueOrderAction as Action} onSuccess={done} className="space-y-4">
          {({ pending, fieldErrors: e }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5"><Label htmlFor="o-date">{t("Expected delivery")}</Label><Input id="o-date" name="expectedDeliveryOn" type="date" defaultValue={defaultDate} /><FieldError message={e?.expectedDeliveryOn} /></div>
              <div className="space-y-1.5"><Label htmlFor="o-note">{t("Note for the supplier")} <span className="text-muted-foreground">· {t("optional")}</span></Label><Textarea id="o-note" name="note" rows={2} maxLength={300} /></div>
              <Submit pending={pending} icon={<ClipboardCheck />}>{t("Issue the order")}</Submit>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

type DeliveryLine = { itemId: string; name: string; unit: string; outstanding: number; tracksExpiry: boolean; stock: boolean };

/** What arrived. Only what is accepted goes into stock, once; anything not accepted is recorded with the problem. */
export function DeliveryDialog({ id, lines }: { id: string; lines: DeliveryLine[] }) {
  const t = useT();
  const [rows, setRows] = useState(() => lines.map((l) => ({ itemId: l.itemId, qty: String(l.outstanding), rejected: "", problem: "DAMAGED", note: "", expiresOn: "" })));
  const [note, setNote] = useState("");
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((all) => all.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const payload = JSON.stringify({
    id, note: note || undefined,
    lines: rows.filter((r) => Number(r.qty) > 0 || Number(r.rejected) > 0).map((r) => ({
      itemId: r.itemId, quantity: Number(r.qty) || 0, rejectedQty: Number(r.rejected) || 0, problem: Number(r.rejected) > 0 ? r.problem : null, note: r.note || undefined, expiresOn: r.expiresOn || null,
    })),
  });
  return (
    <Modal label={t("Record a delivery")} icon={<Truck />} title={t("Goods received")} eyebrow={t("Procurement")} tone="sky" wide
      intro={t("Count what really arrived. What you accept goes into stock now; what you do not accept stays owed by the supplier.")}>
      {(done) => (
        <ActionForm action={recordDeliveryAction as Action} onSuccess={done} className="space-y-4">
          {({ pending, fieldErrors: e }) => (
            <>
              <input type="hidden" name="payload" value={payload} />
              <div className="space-y-3">
                {lines.map((l, i) => (
                  <div key={l.itemId} className="rounded-2xl border border-border/60 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-[11px] text-muted-foreground">{t("still to come: {qty}", { qty: `${l.outstanding} ${l.unit}` })}{!l.stock && ` · ${t("not kept in stock")}`}</p>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="space-y-1"><Label className="text-[11px]" htmlFor={`d-q-${i}`}>{t("Quantity accepted")}</Label><Input id={`d-q-${i}`} type="number" min={0} step="any" inputMode="decimal" value={rows[i].qty} onChange={(ev) => set(i, { qty: ev.target.value })} className="h-9 tabular-nums" /></div>
                      <div className="space-y-1"><Label className="text-[11px]" htmlFor={`d-r-${i}`}>{t("Not accepted")}</Label><Input id={`d-r-${i}`} type="number" min={0} step="any" inputMode="decimal" value={rows[i].rejected} onChange={(ev) => set(i, { rejected: ev.target.value })} className="h-9 tabular-nums" /></div>
                      {Number(rows[i].rejected) > 0 && (
                        <div className="col-span-2 space-y-1"><Label className="text-[11px]" htmlFor={`d-p-${i}`}>{t("What is wrong")}</Label>
                          <NativeSelect id={`d-p-${i}`} value={rows[i].problem} onChange={(ev) => set(i, { problem: ev.target.value })}>
                            <option value="DAMAGED">{t("Damaged")}</option><option value="WRONG">{t("Not what was ordered")}</option><option value="OTHER">{t("Other")}</option>
                          </NativeSelect></div>
                      )}
                      {l.tracksExpiry && Number(rows[i].qty) > 0 && <div className="col-span-2 space-y-1"><Label className="text-[11px]" htmlFor={`d-e-${i}`}>{t("Expires on")}</Label><Input id={`d-e-${i}`} type="date" value={rows[i].expiresOn} onChange={(ev) => set(i, { expiresOn: ev.target.value })} className="h-9" /></div>}
                    </div>
                    {Number(rows[i].rejected) > 0 && <Input className="mt-2 h-9" placeholder={t("Describe the problem")} aria-label={t("Describe the problem")} maxLength={200} value={rows[i].note} onChange={(ev) => set(i, { note: ev.target.value })} />}
                  </div>
                ))}
              </div>
              <FieldError message={e?.lines} />
              <div className="space-y-1.5"><Label htmlFor="d-note">{t("Note")} <span className="text-muted-foreground">· {t("optional")}</span></Label><Textarea id="d-note" rows={2} maxLength={300} value={note} onChange={(ev) => setNote(ev.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="d-doc">{t("Delivery note (photo or PDF)")} <span className="text-muted-foreground">· {t("optional")}</span></Label><Input id="d-doc" name="document" type="file" accept="image/*,application/pdf" /></div>
              <Submit pending={pending} icon={<PackageCheck />}>{t("Record the delivery")}</Submit>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

export function CloseShortButton({ id }: { id: string }) {
  const t = useT();
  return <ReasonDialog action={closeDeliveryAction as Action} fields={{ id }} label={t("Close — the rest is not coming")} icon={<CheckCircle2 />} eyebrow={t("Procurement")}
    title={t("Close the delivery")} intro={t("The order is closed with what arrived. The supplier's invoice should cover only that.")} question={t("Why is the rest not coming?")} required button={t("Close the delivery")} />;
}
export function CancelOrderButton({ id }: { id: string }) {
  const t = useT();
  return <ReasonDialog action={cancelOrderAction as Action} fields={{ id }} label={t("Cancel the order")} icon={<Ban />} eyebrow={t("Procurement")}
    title={t("Cancel the order")} intro={t("Nothing was delivered. The purchase is closed and nothing is paid.")} question={t("Why is it cancelled?")} required button={t("Cancel the order")} />;
}

/** The person who asked says whether what arrived is right. */
export function DeliveryReport({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <ActionForm action={reportDeliveryAction as Action} onSuccess={() => router.refresh()} className="space-y-2">
      {({ pending, fieldErrors: e }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <Textarea name="note" rows={2} maxLength={300} placeholder={t("What is missing, damaged or wrong? (leave empty if all is right)")} aria-label={t("What is wrong with the delivery")} />
          <FieldError message={e?.note} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="correct" value="yes" size="sm" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}{t("It is all right")}</Button>
            <Button type="submit" name="correct" value="no" size="sm" variant="outline" disabled={pending}><Ban />{t("Report a problem")}</Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

// ───────────────────────── Invoices and payment ─────────────────────────

export function InvoiceDialog({ id, suggested, today }: { id: string; suggested: number; today: string }) {
  const t = useT();
  return (
    <Modal label={t("Record an invoice")} icon={<ReceiptText />} title={t("Supplier invoice")} eyebrow={t("Procurement")} tone="amber"
      intro={t("Keep the supplier's invoice with this purchase. It is not a payment and not an expense — Finance checks it and pays it.")}>
      {(done) => (
        <ActionForm action={recordInvoiceAction as Action} onSuccess={done} className="space-y-4">
          {({ pending, fieldErrors: e }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="i-no">{t("Invoice number")}</Label><Input id="i-no" name="number" maxLength={60} /><FieldError message={e?.number} /></div>
                <div className="space-y-1.5"><Label htmlFor="i-amount">{t("Amount (TZS)")}</Label><Input id="i-amount" name="amount" type="number" min={1} step={1} inputMode="numeric" defaultValue={suggested || undefined} className="tabular-nums" /><FieldError message={e?.amount} /></div>
                <div className="space-y-1.5"><Label htmlFor="i-date">{t("Invoice date")}</Label><Input id="i-date" name="invoiceDate" type="date" max={today} defaultValue={today} /><FieldError message={e?.invoiceDate} /></div>
                <div className="space-y-1.5"><Label htmlFor="i-due">{t("Due on")} <span className="text-muted-foreground">· {t("optional")}</span></Label><Input id="i-due" name="dueOn" type="date" /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="i-note">{t("Note")} <span className="text-muted-foreground">· {t("optional")}</span></Label><Textarea id="i-note" name="note" rows={2} maxLength={300} /></div>
              <div className="space-y-1.5"><Label htmlFor="i-doc">{t("The invoice (photo or PDF)")}</Label><Input id="i-doc" name="document" type="file" accept="image/*,application/pdf" /></div>
              <Submit pending={pending} icon={<ReceiptText />}>{t("Record the invoice")}</Submit>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}

/** Finance checks an invoice: verified (it may be paid) or disputed (with what is wrong). */
export function VerifyButtons({ invoiceId, requestId, above }: { invoiceId: string; requestId: string; above: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      <ReasonDialog action={verifyInvoiceAction as Action} fields={{ id: invoiceId, requestId, decision: "VERIFY" }} label={t("Verify")} icon={<BadgeCheck />} variant="default" eyebrow={t("Finance")} tone="emerald"
        title={t("Verify the invoice")} intro={above ? t("This invoice is more than what was delivered. Say why you accept it, or dispute it.") : t("It matches the order and what arrived. It can now be paid.")}
        question={above ? t("Why do you accept it?") : t("Note")} required={above} optional={!above} button={t("Verify")} />
      <ReasonDialog action={verifyInvoiceAction as Action} fields={{ id: invoiceId, requestId, decision: "DISPUTE" }} label={t("Dispute")} icon={<Ban />} eyebrow={t("Finance")}
        title={t("Dispute the invoice")} intro={t("It cannot be paid until the supplier corrects it or you verify it.")} question={t("What is wrong with it?")} required button={t("Dispute")} />
    </div>
  );
}

export function CancelInvoiceButton({ invoiceId, requestId }: { invoiceId: string; requestId: string }) {
  const t = useT();
  return <ReasonDialog action={cancelInvoiceAction as Action} fields={{ id: invoiceId, requestId }} label={t("Cancel invoice")} icon={<Ban />} eyebrow={t("Procurement")}
    title={t("Cancel the invoice")} intro={t("It stays on the record, cancelled, with your reason. Not possible once money was paid against it.")} question={t("Why is it cancelled?")} required button={t("Cancel invoice")} />;
}

/** Finance records the payment — only when the money has really been paid. */
export function PayDialog({ invoiceId, requestId, number, balance, accounts, today }: { invoiceId: string; requestId: string; number: string; balance: number; accounts: { id: string; name: string }[]; today: string }) {
  const t = useT();
  const key = useId().replace(/[^a-zA-Z0-9]/g, "") + String(today).replace(/-/g, "");
  return (
    <Modal label={t("Record payment")} icon={<Banknote />} variant="default" title={t("Pay the supplier")} eyebrow={number} tone="emerald"
      intro={t("Record this only when the money has really left the account. It becomes the expense of this purchase. Still owed: {amount}.", { amount: formatTZS(balance) })}>
      {(done) => (
        <ActionForm action={paySupplierAction as Action} onSuccess={done} className="space-y-4">
          {({ pending, fieldErrors: e }) => (
            <>
              <input type="hidden" name="id" value={invoiceId} /><input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="clientKey" value={`${key}${invoiceId.slice(-8)}${balance}`} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="p-amount">{t("Amount paid (TZS)")}</Label><Input id="p-amount" name="amount" type="number" min={1} max={balance} step={1} inputMode="numeric" defaultValue={balance} className="h-11 text-lg tabular-nums" /><FieldError message={e?.amount} /></div>
                <div className="space-y-1.5"><Label htmlFor="p-date">{t("Paid on")}</Label><Input id="p-date" name="paidOn" type="date" max={today} defaultValue={today} className="h-11" /><FieldError message={e?.paidOn} /></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-account">{t("Paid from")}</Label>
                <NativeSelect id="p-account" name="accountId" defaultValue=""><option value="">{t("Choose the account…")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}</NativeSelect>
                <FieldError message={e?.accountId} />
              </div>
              <div className="space-y-1.5"><Label htmlFor="p-ref">{t("Reference")} <span className="text-muted-foreground">· {t("optional")}</span></Label><Input id="p-ref" name="reference" maxLength={80} placeholder={t("Transfer or receipt number")} /></div>
              <div className="space-y-1.5"><Label htmlFor="p-note">{t("Note")} <span className="text-muted-foreground">· {t("optional")}</span></Label><Textarea id="p-note" name="note" rows={2} maxLength={300} /></div>
              <Submit pending={pending} icon={<Banknote />}>{t("Record the payment")}</Submit>
            </>
          )}
        </ActionForm>
      )}
    </Modal>
  );
}
