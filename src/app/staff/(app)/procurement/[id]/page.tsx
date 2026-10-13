import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { eventVerb, num, procurementStatus } from "@/lib/stock-requests";
import { calendarToday, payingAccounts, procurementWorkspace } from "@/server/services/procurement-desk";
import {
  AuthorizeButtons, CancelInvoiceButton, CancelOrderButton, CloseShortButton, DeliveryDialog, DeliveryReport, InvoiceDialog, OrderDialog, PayDialog, ProposeButton, QuoteDialog, VerifyButtons,
} from "../workspace-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Purchase") };
}
export const dynamic = "force-dynamic";

const INVOICE_STATUS: Record<string, { label: string; tone: string }> = {
  RECEIVED: { label: msg("To verify"), tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  VERIFIED: { label: msg("Verified — to pay"), tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  DISPUTED: { label: msg("Disputed"), tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  PART_PAID: { label: msg("Partly paid"), tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300" },
  PAID: { label: msg("Paid"), tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  CANCELLED: { label: msg("Cancelled"), tone: "bg-muted text-muted-foreground" },
};
const DOC_KIND: Record<string, string> = { REQUEST_PHOTO: msg("Photo with the request"), QUOTATION: msg("Quotation"), DELIVERY_NOTE: msg("Delivery note"), INVOICE: msg("Invoice"), OTHER: msg("Document") };
const PROBLEM: Record<string, string> = { DAMAGED: msg("damaged"), WRONG: msg("not what was ordered"), OTHER: msg("other problem") };
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;

/**
 * One purchase from start to finish: what was asked and approved, the quotations side by side, the price Finance authorized,
 * the purchase order, each delivery (and what went into stock), each invoice and each payment — and who did every step.
 */
export default async function PurchasePage({ params }: PageProps<"/staff/procurement/[id]">) {
  const user = await requirePagePermission("dashboard.procurement", "procurement.manage", "purchases.authorize", "purchases.pay");
  const t = await getT();
  const { id } = await params;
  const r = await procurementWorkspace(id).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const buyer = can(user, "procurement.manage"), authorizer = can(user, "purchases.authorize"), payer = can(user, "purchases.pay");
  const today = calendarToday();
  const [suppliers, accounts] = await Promise.all([
    buyer ? db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    payer ? payingAccounts() : [],
  ]);

  const chosen = r.quotes.find((q) => q.id === r.chosenQuoteId) ?? null;
  const budget = r.approvedBudget;
  const live = r.invoices.filter((i) => i.status !== "CANCELLED");
  const invoiced = live.reduce((s, i) => s + i.amount, 0);
  const paid = live.reduce((s, i) => s + i.paidAmount, 0);
  const owed = live.reduce((s, i) => s + (i.amount - i.paidAmount), 0);
  const deliveredValue = r.items.reduce((s, i) => s + Math.round(i.receivedQty * (i.orderedUnitPrice ?? 0)), 0);
  const ordered = r.items.filter((i) => i.orderedQty != null);
  const lowest = r.quotes.length ? Math.min(...r.quotes.map((q) => q.total)) : null;
  const docFor = (kind: string, refId: string) => r.documents.find((d) => d.kind === kind && d.refId === refId);
  const quoteReady = r.status === "APPROVED" && !r.chosenQuoteId;
  const readyToOrder = r.status === "APPROVED" && !!r.chosenQuoteId && !!r.authorizedAt;
  const canReceive = ["ORDERED", "PART_DELIVERED"].includes(r.status);
  const departmentName = r.inventoryDepartment?.name ?? r.department;
  const meta = procurementStatus(r.status, readyToOrder);
  const returned = r.status === "APPROVED" && !r.chosenQuoteId && r.authorizationNote;

  return (
    <div className="w-full space-y-4">
      <Link href="/staff/procurement" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t("Procurement")}</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{r.orderNumber ? `${r.orderNumber} · ` : ""}{r.number}</p>
          <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{r.title ?? r.number}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t(departmentName)} · {t("asked by {name}", { name: r.requestedBy.fullName })} · {t.dateTime(r.createdAt.toISOString())}</p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-xs font-medium", meta.tone)}>{t(meta.label)}</span>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label={t("Their estimate")} value={r.estimatedTotal != null ? `~${formatTZS(r.estimatedTotal)}` : "—"} sub={t("not an expense")} />
        <Tile label={t("Approved budget")} value={budget != null ? formatTZS(budget) : "—"} sub={r.decidedBy ? t("by {name}", { name: r.decidedBy.fullName }) : undefined} />
        <Tile label={t("Quotation")} value={chosen ? formatTZS(chosen.total) : "—"} sub={chosen ? (chosen.supplier?.name ?? chosen.supplierName ?? "") : undefined} />
        <Tile label={t("Ordered")} value={r.orderTotal != null ? formatTZS(r.orderTotal) : "—"} sub={r.orderTotal != null ? t("committed") : t("nothing committed")} />
        <Tile label={t("Invoiced / paid")} value={`${formatTZS(invoiced)} / ${formatTZS(paid)}`} sub={owed > 0 ? t("{amount} still owed", { amount: formatTZS(owed) }) : undefined} tone={owed > 0 ? "warn" : undefined} />
        <Tile label={t("Delivered")} value={r.orderTotal != null ? formatTZS(deliveredValue) : "—"} sub={r.orderTotal != null ? t("at the ordered prices") : undefined} />
      </dl>

      {r.reason && <p className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm"><span className="text-muted-foreground">{t("Why it is needed")}: </span>{r.reason}{r.neededBy && <span className="text-muted-foreground"> · {t("needed by {date}", { date: t.date(day(r.neededBy)!) })}</span>}</p>}
      {r.decisionNote && <p className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm"><span className="text-muted-foreground">{t("Finance said")}: </span>{r.decisionNote}</p>}

      <Section title={t("What is wanted")} hint={t("Check the stock before you buy: what is already there is not bought again.")}>
        <Table head={[t("Item"), t("Asked"), t("Approved"), t("In stock now"), t("Ordered"), t("Received")]} right={[1, 2, 3, 4, 5]}>
          {r.items.map((i) => {
            const stock = i.inventoryItem;
            const low = stock && stock.reorderLevel != null && stock.quantity <= stock.reorderLevel;
            return (
              <tr key={i.id}>
                <td className="px-4 py-2">{i.name}{i.note && <span className="block text-[11px] text-muted-foreground">{i.note}</span>}</td>
                <td className="px-2 py-2 text-right tabular-nums">{num(i.quantity)} {i.unit}</td>
                <td className="px-2 py-2 text-right tabular-nums">{num(i.approvedQty ?? i.quantity)} {i.unit}</td>
                <td className={cn("px-2 py-2 text-right tabular-nums", low && "font-medium text-amber-700 dark:text-amber-300")}>{stock ? `${num(stock.quantity)} ${stock.unit.toLowerCase()}${low ? ` · ${t("low")}` : ""}` : <span className="text-muted-foreground">{t("not a stock item")}</span>}</td>
                <td className="px-2 py-2 text-right tabular-nums">{i.orderedQty != null ? `${num(i.orderedQty)} × ${formatTZS(i.orderedUnitPrice)}` : "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{i.orderedQty != null ? `${num(i.receivedQty)} / ${num(i.orderedQty)}` : "—"}</td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <Section title={t("Supplier quotations")} hint={r.quotes.length > 1 ? t("Side by side. The cheapest total is marked — the Accountant proposes the one that is best for the hotel.") : undefined}
        action={buyer && quoteReady ? <QuoteDialog id={r.id} suppliers={suppliers} items={r.items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, qty: i.approvedQty ?? i.quantity }))} /> : null}>
        {returned && <p className="mb-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{t("Finance sent the last quotation back")}: {r.authorizationNote}</p>}
        {r.quotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("No quotation yet. Ask suppliers for their prices and record each one here.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/60">
            <table className="w-full min-w-[34rem] text-sm">
              <thead><tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("Item")}</th>
                {r.quotes.map((q) => <th key={q.id} className="px-2 py-2 text-right font-medium normal-case tracking-normal"><span className="block text-xs text-foreground">{q.supplier?.name ?? q.supplierName}</span></th>)}
              </tr></thead>
              <tbody className="divide-y divide-border/50">
                {r.items.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2">{i.name}</td>
                    {r.quotes.map((q) => { const l = q.lines.find((x) => x.itemId === i.id); return <td key={q.id} className="px-2 py-2 text-right tabular-nums">{l ? <>{formatTZS(l.unitPrice)}<span className="block text-[11px] text-muted-foreground">× {num(l.quantity)}</span></> : <span className="text-muted-foreground">—</span>}</td>; })}
                  </tr>
                ))}
                <tr className="bg-muted/30 font-medium">
                  <td className="px-4 py-2">{t("Total")}</td>
                  {r.quotes.map((q) => <td key={q.id} className="px-2 py-2 text-right tabular-nums">{formatTZS(q.total)}{q.total === lowest && r.quotes.length > 1 && <span className="block text-[11px] font-normal text-emerald-700 dark:text-emerald-300">{t("lowest")}</span>}</td>)}
                </tr>
                <tr className="text-[11px] text-muted-foreground">
                  <td className="px-4 py-2">{t("Quotation terms")}</td>
                  {r.quotes.map((q) => {
                    const expired = !!q.validUntil && day(q.validUntil)! < today;
                    const doc = docFor("QUOTATION", q.id);
                    return (
                      <td key={q.id} className="px-2 py-2 text-right">
                        {q.deliveryDays != null && <span className="block">{t.plural(q.deliveryDays, "{n} day to deliver", "{n} days to deliver")}</span>}
                        {q.validUntil && <span className={cn("block", expired && "font-medium text-rose-700 dark:text-rose-300")}>{expired ? t("expired {date}", { date: t.date(day(q.validUntil)!) }) : t("holds until {date}", { date: t.date(day(q.validUntil)!) })}</span>}
                        <span className="block">{t("by {name}", { name: q.recordedBy.fullName })}</span>
                        {doc && <a href={`/api/files/${doc.fileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline"><FileText className="size-3" />{t("document")}</a>}
                      </td>
                    );
                  })}
                </tr>
                {buyer && quoteReady && (
                  <tr>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">{budget != null ? t("Budget {amount}", { amount: formatTZS(budget) }) : t("No budget set")}</td>
                    {r.quotes.map((q) => (
                      <td key={q.id} className="px-2 py-2 text-right">
                        {q.validUntil && day(q.validUntil)! < today ? <span className="text-[11px] text-muted-foreground">—</span> : <div className="flex flex-col items-end gap-1"><ProposeButton id={r.id} quoteId={q.id} />{budget == null || q.total > budget ? <span className="text-[11px] text-amber-700 dark:text-amber-300">{t("Finance must authorize")}</span> : null}</div>}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {r.status === "AWAITING_AUTHORIZATION" && chosen && (
        <Section title={t("Waiting for Finance")} tone="amber">
          <p className="text-sm">
            {t("The Accountant proposes {supplier} at {total}.", { supplier: chosen.supplier?.name ?? chosen.supplierName ?? "", total: formatTZS(chosen.total) })}{" "}
            {budget != null ? t("The approved budget is {budget} — this is {over} above it.", { budget: formatTZS(budget), over: formatTZS(chosen.total - budget) }) : t("No budget was approved for this request.")}
          </p>
          <div className="mt-3">{authorizer ? <AuthorizeButtons id={r.id} /> : <p className="text-sm text-muted-foreground">{t("Nothing can be ordered until Finance authorizes this price.")}</p>}</div>
        </Section>
      )}

      {(readyToOrder || r.orderNumber) && (
        <Section title={t("Purchase order")}
          action={
            <div className="flex flex-wrap gap-2">
              {buyer && readyToOrder && chosen && <OrderDialog id={r.id} supplier={chosen.supplier?.name ?? chosen.supplierName ?? ""} total={chosen.total} defaultDate={new Date(new Date(`${today}T00:00:00Z`).getTime() + (chosen.deliveryDays ?? 7) * 86_400_000).toISOString().slice(0, 10)} />}
              {(buyer || authorizer) && r.status === "ORDERED" && live.length === 0 && <CancelOrderButton id={r.id} />}
            </div>
          }>
          {readyToOrder && chosen ? (
            <p className="text-sm">
              {chosen.total > (budget ?? 0) ? t("Finance authorized {supplier} at {total}.", { supplier: chosen.supplier?.name ?? chosen.supplierName ?? "", total: formatTZS(chosen.total) }) : t("{supplier} at {total} is within the approved budget.", { supplier: chosen.supplier?.name ?? chosen.supplierName ?? "", total: formatTZS(chosen.total) })}{" "}
              {buyer ? t("You can issue the purchase order.") : t("The Accountant issues the purchase order.")}
            </p>
          ) : (
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              <Row k={t("Order")} v={r.orderNumber ?? ""} />
              <Row k={t("Supplier")} v={r.supplier?.name ?? r.supplierName ?? "—"} />
              <Row k={t("Committed")} v={r.orderTotal != null ? formatTZS(r.orderTotal) : "—"} />
              <Row k={t("Expected delivery")} v={r.expectedDeliveryOn ? t.date(day(r.expectedDeliveryOn)!) : "—"} />
              <Row k={t("Issued by")} v={`${r.orderedBy?.fullName ?? "—"}${r.orderedAt ? ` · ${t.dateTime(r.orderedAt.toISOString())}` : ""}`} />
              <Row k={t("Price authorized by")} v={r.authorizedBy?.fullName ?? t("within the approved budget")} />
              {r.orderNote && <Row k={t("Note")} v={r.orderNote} />}
            </dl>
          )}
        </Section>
      )}

      {r.orderNumber && (
        <Section title={t("Deliveries")}
          action={
            <div className="flex flex-wrap gap-2">
              {(buyer || can(user, "inventory.receive")) && canReceive && (
                <DeliveryDialog id={r.id} lines={ordered.filter((i) => i.orderedQty! - i.receivedQty > 0.0005).map((i) => ({ itemId: i.id, name: i.name, unit: i.unit, outstanding: Math.round((i.orderedQty! - i.receivedQty) * 1000) / 1000, tracksExpiry: false, stock: !!i.inventoryItemId }))} />
              )}
              {buyer && r.status === "PART_DELIVERED" && <CloseShortButton id={r.id} />}
            </div>
          }>
          {r.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing has arrived yet.")}</p> : (
            <ul className="space-y-2">
              {r.deliveries.map((d) => {
                const doc = docFor("DELIVERY_NOTE", d.id);
                return (
                  <li key={d.id} className="rounded-2xl border border-border/60 px-4 py-3 text-sm">
                    <p className="text-xs text-muted-foreground">{t.dateTime(d.receivedAt.toISOString())} · {d.receivedBy.fullName}{doc && <> · <a href={`/api/files/${doc.fileId}`} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{t("delivery note")}</a></>}</p>
                    <ul className="mt-1 space-y-0.5">
                      {d.lines.map((l) => {
                        const item = r.items.find((i) => i.id === l.itemId);
                        return (
                          <li key={l.id}>
                            {item?.name}: <span className="tabular-nums">{num(l.quantity)} {item?.unit}</span> {t("accepted")}{l.movementId && <span className="text-muted-foreground"> · {t("in stock")}</span>}
                            {l.rejectedQty > 0 && <span className="text-rose-700 dark:text-rose-300"> · {num(l.rejectedQty)} {t("not accepted")} ({t(PROBLEM[l.problem ?? "OTHER"] ?? "other problem")}{l.note ? `: ${l.note}` : ""})</span>}
                          </li>
                        );
                      })}
                    </ul>
                    {d.note && <p className="mt-1 text-xs text-muted-foreground">{d.note}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          {r.requestedById === user.id && ["ORDERED", "PART_DELIVERED", "DELIVERED"].includes(r.status) && (
            <div className="mt-3 rounded-2xl border border-border/60 p-3"><p className="mb-2 text-sm font-medium">{t("Is what arrived right?")}</p><DeliveryReport id={r.id} /></div>
          )}
        </Section>
      )}

      {r.orderNumber && (
        <Section title={t("Invoices and payment")} hint={t("An invoice is not a payment. Finance verifies it, then pays it — the payment is the expense.")}
          action={buyer && ["ORDERED", "PART_DELIVERED", "DELIVERED"].includes(r.status) ? <InvoiceDialog id={r.id} today={today} suggested={Math.max(0, deliveredValue - invoiced)} /> : null}>
          {r.invoices.length === 0 ? <p className="text-sm text-muted-foreground">{t("No invoice yet.")}</p> : (
            <ul className="space-y-2">
              {r.invoices.map((inv) => {
                const st = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.RECEIVED;
                const doc = docFor("INVOICE", inv.id);
                const balance = inv.amount - inv.paidAmount;
                const above = inv.amount > deliveredValue;
                return (
                  <li key={inv.id} className="rounded-2xl border border-border/60 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{inv.number} · <span className="tabular-nums">{formatTZS(inv.amount)}</span></p>
                        <p className="text-xs text-muted-foreground">{t("dated {date}", { date: t.date(day(inv.invoiceDate)!) })}{inv.dueOn && ` · ${t("due {date}", { date: t.date(day(inv.dueOn)!) })}`} · {t("recorded by {name}", { name: inv.recordedBy.fullName })}{doc && <> · <a href={`/api/files/${doc.fileId}`} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{t("document")}</a></>}</p>
                      </div>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.tone)}>{t(st.label)}</span>
                    </div>
                    {inv.verifiedBy && <p className="mt-1 text-xs text-muted-foreground">{inv.status === "DISPUTED" ? t("Disputed by {name}", { name: inv.verifiedBy.fullName }) : t("Verified by {name}", { name: inv.verifiedBy.fullName })}{inv.verifyNote ? `: ${inv.verifyNote}` : ""}</p>}
                    {above && ["RECEIVED", "DISPUTED"].includes(inv.status) && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{t("More than what was delivered ({amount}).", { amount: formatTZS(deliveredValue) })}</p>}
                    {inv.payments.length > 0 && (
                      <ul className="mt-2 divide-y divide-border/50 rounded-xl bg-muted/30 px-3 text-xs">
                        {inv.payments.map((p) => (
                          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                            <span>{t.date(day(p.paidOn)!)} · {t(p.account.name)}{p.reference ? ` · ${p.reference}` : ""} · {t("by {name}", { name: p.paidBy.fullName })}</span>
                            <span className="tabular-nums">{formatTZS(p.amount)} · {p.expense.number}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {payer && ["RECEIVED", "DISPUTED"].includes(inv.status) && <VerifyButtons invoiceId={inv.id} requestId={r.id} above={above} />}
                      {payer && ["VERIFIED", "PART_PAID"].includes(inv.status) && <PayDialog invoiceId={inv.id} requestId={r.id} number={inv.number} balance={balance} accounts={accounts} today={today} />}
                      {(buyer || payer) && ["RECEIVED", "DISPUTED", "VERIFIED"].includes(inv.status) && inv.paidAmount === 0 && (inv.status !== "VERIFIED" || payer) && <CancelInvoiceButton invoiceId={inv.id} requestId={r.id} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      <Section title={t("Documents")}>
        {r.documents.length === 0 ? <p className="text-sm text-muted-foreground">{t("No documents kept yet.")}</p> : (
          <ul className="divide-y divide-border/50 text-sm">
            {r.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a href={`/api/files/${d.fileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"><FileText className="size-4 text-muted-foreground" />{t(DOC_KIND[d.kind] ?? "Document")}{d.note ? ` · ${d.note}` : ""}</a>
                <span className="text-xs text-muted-foreground">{d.uploadedBy.fullName} · {t.dateTime(d.createdAt.toISOString())}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("History")}>
        <ol className="space-y-2 text-sm">
          {[...r.events].reverse().map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span><span className="font-medium">{(e.byLabel ?? "").replace(/\s*\(.*\)/, "")}</span> {t(eventVerb({ action: e.action, from: e.fromStatus }))}{e.reason && <span className="text-muted-foreground"> — {e.reason}</span>}</span>
              <span className="text-xs text-muted-foreground">{t.dateTime(e.at.toISOString())}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

function Section({ title, hint, action, tone, children }: { title: string; hint?: string; action?: React.ReactNode; tone?: "amber"; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-3xl border bg-card p-4 sm:p-5", tone === "amber" ? "border-amber-500/40" : "border-border/70")}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h2 className="text-base font-semibold">{title}</h2>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Table({ head, right, children }: { head: string[]; right: number[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60">
      <table className="w-full min-w-[36rem] text-sm">
        <thead><tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          {head.map((h, i) => <th key={h} className={cn("py-2 font-medium", i === 0 ? "px-4" : "px-2", right.includes(i) && "text-right", i === head.length - 1 && "pr-4")}>{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-border/50">{children}</tbody>
      </table>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3 border-b border-border/40 py-1"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-3 py-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm font-semibold tabular-nums sm:text-base", tone === "warn" && "text-amber-700 dark:text-amber-300")}>{value}</dd>
      {sub && <dd className="truncate text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}
