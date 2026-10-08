import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { chargeGroup, companyPays, type BillingGroup } from "@/lib/billing";
import { addDays, fromDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { ReportActions } from "@/app/staff/(app)/reports/report-actions";
import { InvoiceDocument, type InvoiceDoc } from "@/components/staff/invoices/invoice-document";
import { companyBillTo } from "@/components/staff/invoices/bill-to";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Proforma invoice") };
}

/**
 * Proforma / booking invoice — what a stay will cost, for a company (or guest) to
 * approve or pay before arrival. It is only a document: no invoice number is used,
 * no payment is recorded and nothing is owed until the stay happens. The final
 * invoice is made at checkout from the real bill.
 */
export default async function ProformaPage({ params }: PageProps<"/staff/reservations/[id]/proforma">) {
  await requirePagePermission("invoices.view", "reservations.view");
  const t = await getT();
  const { id } = await params;
  const [r, s, today] = await Promise.all([
    db.reservation.findUnique({
      where: { id },
      include: {
        guest: true, corporateCustomer: true,
        rooms: { include: { room: { select: { number: true } }, roomType: { select: { name: true } }, nightsLedger: { orderBy: { businessDate: "asc" } } } },
        charges: { where: { isVoided: false }, orderBy: { businessDate: "asc" } },
        payments: { where: { status: "POSTED" }, include: { method: true }, orderBy: { receivedAt: "asc" } },
      },
    }),
    getSettings(),
    businessToday(),
  ]);
  if (!r) notFound();
  const c = r.billTo !== "GUEST" ? r.corporateCustomer : null;
  // A company is billed only for what it covers (all of it, or the split groups).
  const covers = (group: BillingGroup) => !c || companyPays(r.billTo, r.companyCovers, group);
  const iso = (d: Date) => fromDbDate(d);

  const items: InvoiceDoc["items"] = [];
  for (const rr of r.rooms.filter((x) => x.status !== "CANCELLED")) {
    if (!covers("ROOM")) continue;
    const nights = rr.nightsLedger;
    if (!nights.length) continue;
    const gross = nights.reduce((t, n) => t + n.grossAmount, 0);
    const net = nights.reduce((t, n) => t + n.netAmount, 0);
    const rates = new Set(nights.map((n) => n.grossAmount));
    items.push({
      id: rr.id, description: `${t.plural(nights.length, "{type} — {n} night", "{type} — {n} nights", { type: t(rr.roomType.name) })}${rates.size === 1 ? ` × ${formatTZS(nights[0].grossAmount)}` : ` ${t("(dated prices)")}`}`,
      quantity: nights.length, unitAmount: Math.round(gross / nights.length), discountAmount: gross - net, netAmount: net,
      reservationId: r.id, guestName: r.guest.fullName, roomNumber: rr.room?.number ?? null,
      from: iso(nights[0].businessDate), to: addDays(iso(nights.at(-1)!.businessDate), 1), reference: r.reference, isRoom: true,
    });
  }
  for (const ch of r.charges) {
    if (!covers(chargeGroup(ch.category))) continue;
    items.push({
      id: ch.id, description: ch.description, quantity: 1, unitAmount: ch.amount, discountAmount: 0, netAmount: ch.amount,
      reservationId: r.id, guestName: r.guest.fullName, roomNumber: null, from: iso(ch.businessDate), to: null, reference: r.reference, isRoom: false,
    });
  }
  const gross = items.reduce((t, i) => t + i.unitAmount * i.quantity, 0);
  const net = items.reduce((t, i) => t + i.netAmount, 0);
  const payments = c ? [] : r.payments; // a company proforma shows what the company is asked to pay
  const paid = payments.reduce((t, p) => t + (p.kind === "REFUND" ? -p.amount : p.amount), 0);
  const terms = r.paymentTermDays ?? c?.paymentTermDays ?? 0;

  const doc: InvoiceDoc = {
    number: `PRO-${r.reference}`, status: "ISSUED", issueDate: today, dueDate: null, terms,
    billTo: c ? companyBillTo(c) : { name: r.guest.fullName, lines: r.guest.address ? [r.guest.address] : [], contact: [r.guest.phone, r.guest.email].filter(Boolean).join("  ·  ") || null },
    bookings: [r.reference], items, gross, discount: gross - net, net, paid, balance: Math.max(0, net - paid),
    payments: payments.map((p) => ({ id: p.id, at: p.receivedAt, method: p.method.name, reference: p.reference, amount: p.amount, refund: p.kind === "REFUND" })),
    notes: t("Proforma for booking {reference}. This is a quotation / request for payment — not a tax invoice and not a receipt. No payment has been recorded by issuing it. The final invoice is prepared at checkout from the actual bill (restaurant, bar and other charges included).", { reference: r.reference }),
    cancelReason: null,
  };

  return (
    <div className="w-full space-y-5 print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/staff/reservations/${r.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t("Back to {name}", { name: r.reference })}</Link>
        <div className="flex gap-2">
          {c && <Link href={`/staff/corporate/${c.id}`} className={buttonVariants({ variant: "outline" })}>{c.companyName}</Link>}
          <ReportActions target="invoice-doc" fileName={`${s.hotelName}-proforma-${doc.number}`.replace(/[^\w]+/g, "-").toLowerCase()} />
        </div>
      </div>
      <p className="mx-auto max-w-[880px] rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 print:hidden dark:text-amber-300">
        {t("Proforma only — nothing is recorded as paid or owed by printing it. Payments are recorded on the booking (or on the company invoice after checkout).")}
      </p>
      <InvoiceDocument inv={doc} s={s} verifyUrl={null} proforma />
    </div>
  );
}
