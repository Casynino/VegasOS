import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, BedDouble, CalendarPlus, FilePlus2, FileText, Mail, Phone, Receipt, Users } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { accountOptions } from "@/server/services/payment-accounts";
import { businessToday } from "@/server/settings";
import { companyAccount } from "@/server/services/company-billing";
import { fromDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { billToLabel, termsLabel, type BillTo } from "@/lib/billing";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { INVOICE_STATUS_META } from "@/lib/invoice-status";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Panel } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { CompanyPaymentButton, EditCompanyButton } from "../company-actions";
import { Employees } from "./employees";

export const metadata: Metadata = { title: "Company account" };

export default async function CorporateDetail({ params }: PageProps<"/staff/corporate/[id]">) {
  const user = await requirePagePermission("corporate.view");
  const { id } = await params;
  const today = await businessToday();
  const [c, acct, methods] = await Promise.all([
    db.corporateCustomer.findUnique({
      where: { id },
      include: {
        reservations: {
          where: { status: { not: "INQUIRY" } }, orderBy: { arrivalDate: "desc" }, take: 40,
          include: { guest: { select: { fullName: true } }, rooms: { select: { room: { select: { number: true } } } } },
        },
        invoices: { where: { reservationId: null }, orderBy: { createdAt: "desc" }, take: 40 },
        guests: {
          orderBy: { fullName: "asc" },
          select: { id: true, fullName: true, phone: true, idType: true, idNumber: true, _count: { select: { reservations: { where: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] } } } } } },
        },
      },
    }),
    companyAccount(id, today),
    accountOptions("payments"),
  ]);
  if (!c || !acct) notFound();

  const due = (d: Date | null) => (d ? fromDbDate(d) : null);
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  const open = c.invoices
    .filter((i) => ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status) && i.balanceAmount > 0)
    .sort((a, b) => (due(a.dueDate) ?? "9").localeCompare(due(b.dueDate) ?? "9"));
  const guests = [...new Set(c.reservations.map((r) => r.guest.fullName))];
  const limitUsed = c.creditLimit ? Math.min(100, Math.round((acct.committed / c.creditLimit) * 100)) : 0;
  const canManage = can(user, "corporate.manage");

  return (
    <div className="w-full space-y-5">
      <Link href="/staff/corporate" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> Companies</Link>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-[#15110c] p-6 text-white sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-[#c9a24a]/25 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">Company account</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{c.companyName}</h1>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/60">
              {c.contactPerson && <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" />{c.contactPerson}</span>}
              {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-white"><Phone className="size-3.5" />{c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-white"><Mail className="size-3.5" />{c.email}</a>}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-medium">
              <span className={cn("rounded-full px-2.5 py-1", c.status === "ACTIVE" ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200")}>{c.status === "ACTIVE" ? "Active" : c.status === "ON_HOLD" ? "Suspended" : "Inactive"}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1">{billToLabel(c.defaultBillTo as BillTo, c.defaultCovers)}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1">{termsLabel(c.paymentTermDays)}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1">{c.consolidateInvoices ? "One invoice for many stays" : "One invoice per stay"}</span>
              {c.taxId && <span className="rounded-full bg-white/10 px-2.5 py-1">TIN {c.taxId}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can(user, "payments.record") && <CompanyPaymentButton companyId={c.id} methods={methods} open={open.map((i) => ({ id: i.id, number: i.number, balance: i.balanceAmount, due: due(i.dueDate) }))} />}
            {can(user, "reservations.create") && c.status === "ACTIVE" && <Link href={`/staff/reservations/new?company=${c.id}`} className={cn(buttonVariants({ variant: "outline" }), "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white")}><CalendarPlus />Book for them</Link>}
            <Link href={`/staff/corporate/${c.id}/statement`} className={cn(buttonVariants({ variant: "outline" }), "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white")}><FileText />Statement</Link>
            {canManage && (
              <EditCompanyButton c={{
                id: c.id, companyName: c.companyName, contactPerson: c.contactPerson ?? "", phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "",
                billingAddress: c.billingAddress ?? "", taxId: c.taxId ?? "", vrn: c.vrn ?? "", registrationNo: c.registrationNo ?? "", creditLimit: c.creditLimit ?? "", paymentTermDays: c.paymentTermDays,
                billingNotes: c.billingNotes ?? "", status: c.status, defaultBillTo: c.defaultBillTo === "SPLIT" ? "SPLIT" : "COMPANY", defaultCovers: c.defaultCovers,
                consolidateInvoices: c.consolidateInvoices,
              }} />
            )}
          </div>
        </div>

        {/* Money */}
        <div className="relative mt-7 grid gap-px overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/10 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Owes now" value={formatTZS(acct.balance)} note={acct.overdueAmount > 0 ? `${formatTZS(acct.overdueAmount)} overdue` : acct.unpaidCount ? `${acct.unpaidCount} unpaid invoice${acct.unpaidCount === 1 ? "" : "s"}` : "All invoices paid"} gold warn={acct.overdueAmount > 0} />
          <Figure label="Not invoiced yet" value={formatTZS(acct.unbilled + acct.draftTotal)} note={acct.draftTotal ? `${formatTZS(acct.draftTotal)} waiting on a draft invoice` : "Stays in progress or coming"} />
          <div className="bg-[#15110c]/70 px-5 py-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Credit</p>
            {c.creditLimit == null ? <p className="mt-1 text-lg font-semibold">No limit</p> : (
              <>
                <p className={cn("mt-1 text-lg font-semibold tabular-nums", (acct.available ?? 0) < 0 && "text-rose-300")}>{formatTZS(acct.available ?? 0)} <span className="text-xs font-normal text-white/45">left</span></p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={cn("h-full rounded-full", limitUsed >= 90 ? "bg-rose-400" : limitUsed >= 70 ? "bg-amber-300" : "bg-[#f0cf86]")} style={{ width: `${limitUsed}%` }} /></div>
                <p className="mt-1 text-[11px] text-white/45">of {formatTZS(c.creditLimit)} limit</p>
              </>
            )}
          </div>
          <Figure label="Invoiced · paid" value={formatTZS(acct.totalInvoiced)} note={`${formatTZS(acct.totalPaid)} paid · ${acct.reservations} stay${acct.reservations === 1 ? "" : "s"}`} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Panel title="Unpaid invoices" subtitle="Oldest due first" action={can(user, "invoices.manage") && <Link href={`/staff/invoices/new?company=${c.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary"><FilePlus2 className="size-3.5" />Other invoice</Link>}>
          {open.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nothing unpaid. 🎉</p> : (
            <ul className="divide-y divide-border/60">
              {open.map((i) => {
                const d = due(i.dueDate);
                const n = d ? days(d) : null;
                return (
                  <li key={i.id}>
                    <Link href={`/staff/invoices/${i.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40">
                      <span>
                        <span className="font-mono font-semibold">{i.number}</span>
                        <span className="block text-[11px] text-muted-foreground">of {formatTZS(i.netAmount)}{i.paidAmount ? ` · ${formatTZS(i.paidAmount)} paid` : ""}{d ? ` · due ${formatBusinessDate(d)}` : ""}</span>
                      </span>
                      <span className="text-right">
                        <span className="block font-semibold tabular-nums">{formatTZS(i.balanceAmount)}</span>
                        {n != null && <DueChip days={n} />}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="All invoices" subtitle={`${acct.invoiceCount} issued · ${acct.paidCount} paid · ${acct.unpaidCount} unpaid · ${acct.overdueCount} overdue`}>
          {c.invoices.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No invoices yet — they are made when a company-paid guest checks out.</p> : (
            <ul className="divide-y divide-border/60 text-sm">
              {c.invoices.map((i) => (
                <li key={i.id}>
                  <Link href={`/staff/invoices/${i.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-muted/40">
                    <span className="font-mono">{i.number}<span className="ml-2 font-sans text-[11px] text-muted-foreground">{i.issueDate ? formatBusinessDate(fromDbDate(i.issueDate)) : "draft"}</span></span>
                    <span className="flex items-center gap-2"><Badge variant="outline" className={INVOICE_STATUS_META[i.status].className}>{INVOICE_STATUS_META[i.status].label}</Badge><span className="w-24 text-right tabular-nums">{formatTZS(i.netAmount)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="People" subtitle={`${c.guests.length} ${c.guests.length === 1 ? "person" : "people"} from ${c.companyName} — tap one when booking`}>
        <Employees companyId={c.id} canEdit={canManage || can(user, "reservations.create") || can(user, "guests.manage")} canBook={can(user, "reservations.create")}
          staff={c.guests.map((g) => ({ id: g.id, fullName: g.fullName, phone: g.phone, idType: g.idType, idNumber: g.idNumber, stays: g._count.reservations }))} />
      </Panel>

      <Panel title="Stays" subtitle={`${guests.length} guest${guests.length === 1 ? "" : "s"} sent by ${c.companyName}`} action={<span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><BedDouble className="size-3.5" />latest first</span>}>
        {c.reservations.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No stays yet. Use “Book for them”, or choose the company under “Who pays” when booking.</p> : (
          <div className="overflow-x-auto">
            <table data-stack className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 font-medium">Guest</th><th className="py-2 font-medium">Room</th><th className="py-2 font-medium">Stay</th><th className="hidden py-2 font-medium md:table-cell">Who pays</th>
                <th className="py-2 font-medium">Status</th><th className="py-2 text-right font-medium">Stay total</th><th className="py-2 text-right font-medium">On invoice</th>
              </tr></thead>
              <tbody>
                {c.reservations.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-muted/40">
                    <td className="py-2.5"><Link href={`/staff/reservations/${r.id}`} className="inline-flex items-center gap-1 font-medium hover:underline">{r.guest.fullName}<ArrowUpRight className="size-3 opacity-50" /></Link><span className="block font-mono text-[11px] text-muted-foreground">{r.reference}</span></td>
                    <td className="py-2.5 tabular-nums">{r.rooms.map((x) => x.room.number).join(", ") || "—"}</td>
                    <td className="py-2.5 text-xs">{formatBusinessDate(fromDbDate(r.arrivalDate))} → {formatBusinessDate(fromDbDate(r.departureDate))}</td>
                    <td className="hidden py-2.5 text-xs text-muted-foreground md:table-cell">{billToLabel(r.billTo as BillTo, r.companyCovers)}</td>
                    <td className="py-2.5"><Badge variant="outline" className={RESERVATION_STATUS_META[r.status].className}>{RESERVATION_STATUS_META[r.status].label}</Badge></td>
                    <td className="py-2.5 text-right tabular-nums">{formatTZS(r.netAmount)}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.companyBilledAmount ? formatTZS(r.companyBilledAmount) : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {(c.billingNotes || c.billingAddress || c.address || c.vrn || c.taxId || c.registrationNo) && (
        <Panel title="Billing details" subtitle="Printed on every invoice">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Billing address</dt><dd className="whitespace-pre-line">{c.billingAddress || c.address || "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Tax</dt><dd>{[c.taxId && `TIN ${c.taxId}`, c.vrn && `VRN ${c.vrn}`, c.registrationNo && `Reg. No. ${c.registrationNo}`].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Notes</dt><dd className="whitespace-pre-line">{c.billingNotes || "—"}</dd></div>
          </dl>
        </Panel>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Receipt className="size-3.5" />Income from these stays is counted once, night by night. Invoices and company payments only move what is owed — they never add income again.</p>
    </div>
  );
}

function Figure({ label, value, note, gold, warn }: { label: string; value: string; note: string; gold?: boolean; warn?: boolean }) {
  return (
    <div className={cn("bg-[#15110c]/70 px-5 py-4", gold && "bg-[#c9a24a]/15")}>
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", gold && "text-2xl text-[#f0cf86]")}>{value}</p>
      <p className={cn("mt-0.5 text-[11px]", warn ? "font-medium text-rose-300" : "text-white/45")}>{note}</p>
    </div>
  );
}

function DueChip({ days }: { days: number }) {
  return (
    <span className={cn("mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold",
      days < 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : days <= 7 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
      {days < 0 ? `Overdue ${-days} day${days === -1 ? "" : "s"}` : days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`}
    </span>
  );
}
