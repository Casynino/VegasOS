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
import { formatTZS } from "@/lib/format";
import { billToLabel, termsLabel, type BillTo } from "@/lib/billing";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { INVOICE_STATUS_META } from "@/lib/invoice-status";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Panel } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { CompanyPaymentButton, EditCompanyButton } from "../company-actions";
import { Employees } from "./employees";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Company account") };
}

export default async function CorporateDetail({ params }: PageProps<"/staff/corporate/[id]">) {
  const user = await requirePagePermission("corporate.view");
  const { id } = await params;
  const today = await businessToday();
  const t = await getT();
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
      <Link href="/staff/corporate" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> {t("Companies")}</Link>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-[#15110c] p-6 text-white sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-[#c9a24a]/25 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">{t("Company account")}</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{c.companyName}</h1>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/60">
              {c.contactPerson && <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" />{c.contactPerson}</span>}
              {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-white"><Phone className="size-3.5" />{c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-white"><Mail className="size-3.5" />{c.email}</a>}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-medium">
              <span className={cn("rounded-full px-2.5 py-1", c.status === "ACTIVE" ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200")}>{c.status === "ACTIVE" ? t("Active") : c.status === "ON_HOLD" ? t("Suspended") : t("Inactive")}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1">{billToLabel(c.defaultBillTo as BillTo, c.defaultCovers, t)}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1">{termsLabel(c.paymentTermDays, t)}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1">{c.consolidateInvoices ? t("One invoice for many stays") : t("One invoice per stay")}</span>
              {c.taxId && <span className="rounded-full bg-white/10 px-2.5 py-1">{t("TIN {tin}", { tin: c.taxId })}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can(user, "payments.record") && <CompanyPaymentButton companyId={c.id} methods={methods} open={open.map((i) => ({ id: i.id, number: i.number, balance: i.balanceAmount, due: due(i.dueDate) }))} />}
            {can(user, "reservations.create") && c.status === "ACTIVE" && <Link href={`/staff/reservations/new?company=${c.id}`} className={cn(buttonVariants({ variant: "outline" }), "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white")}><CalendarPlus />{t("Book for them")}</Link>}
            <Link href={`/staff/corporate/${c.id}/statement`} className={cn(buttonVariants({ variant: "outline" }), "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white")}><FileText />{t("Statement")}</Link>
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
          <Figure label={t("Owes now")} value={formatTZS(acct.balance)} note={acct.overdueAmount > 0 ? t("{amount} overdue", { amount: formatTZS(acct.overdueAmount) }) : acct.unpaidCount ? t.plural(acct.unpaidCount, "{n} unpaid invoice", "{n} unpaid invoices") : t("All invoices paid")} gold warn={acct.overdueAmount > 0} />
          <Figure label={t("Not invoiced yet")} value={formatTZS(acct.unbilled + acct.draftTotal)} note={acct.draftTotal ? t("{amount} waiting on a draft invoice", { amount: formatTZS(acct.draftTotal) }) : t("Stays in progress or coming")} />
          <div className="bg-[#15110c]/70 px-5 py-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">{t("Credit")}</p>
            {c.creditLimit == null ? <p className="mt-1 text-lg font-semibold">{t("No limit")}</p> : (
              <>
                <p className={cn("mt-1 text-lg font-semibold tabular-nums", (acct.available ?? 0) < 0 && "text-rose-300")}>{formatTZS(acct.available ?? 0)} <span className="text-xs font-normal text-white/45">{t("left")}</span></p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={cn("h-full rounded-full", limitUsed >= 90 ? "bg-rose-400" : limitUsed >= 70 ? "bg-amber-300" : "bg-[#f0cf86]")} style={{ width: `${limitUsed}%` }} /></div>
                <p className="mt-1 text-[11px] text-white/45">{t("of {amount} limit", { amount: formatTZS(c.creditLimit) })}</p>
              </>
            )}
          </div>
          <Figure label={t("Invoiced · paid")} value={formatTZS(acct.totalInvoiced)} note={`${t("{amount} paid", { amount: formatTZS(acct.totalPaid) })} · ${t.plural(acct.reservations, "{n} stay", "{n} stays")}`} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Panel title={t("Unpaid invoices")} subtitle={t("Oldest due first")} action={can(user, "invoices.manage") && <Link href={`/staff/invoices/new?company=${c.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary"><FilePlus2 className="size-3.5" />{t("Other invoice")}</Link>}>
          {open.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t("Nothing unpaid. 🎉")}</p> : (
            <ul className="divide-y divide-border/60">
              {open.map((i) => {
                const d = due(i.dueDate);
                const n = d ? days(d) : null;
                return (
                  <li key={i.id}>
                    <Link href={`/staff/invoices/${i.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40">
                      <span>
                        <span className="font-mono font-semibold">{i.number}</span>
                        <span className="block text-[11px] text-muted-foreground">{t("of {amount}", { amount: formatTZS(i.netAmount) })}{i.paidAmount ? ` · ${t("{amount} paid", { amount: formatTZS(i.paidAmount) })}` : ""}{d ? ` · ${t("due {date}", { date: t.date(d) })}` : ""}</span>
                      </span>
                      <span className="text-right">
                        <span className="block font-semibold tabular-nums">{formatTZS(i.balanceAmount)}</span>
                        {n != null && <DueChip days={n} t={t} />}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title={t("All invoices")} subtitle={t("{issued} issued · {paid} paid · {unpaid} unpaid · {overdue} overdue", { issued: acct.invoiceCount, paid: acct.paidCount, unpaid: acct.unpaidCount, overdue: acct.overdueCount })}>
          {c.invoices.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t("No invoices yet — they are made when a company-paid guest checks out.")}</p> : (
            <ul className="divide-y divide-border/60 text-sm">
              {c.invoices.map((i) => (
                <li key={i.id}>
                  <Link href={`/staff/invoices/${i.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-muted/40">
                    <span className="font-mono">{i.number}<span className="ml-2 font-sans text-[11px] text-muted-foreground">{i.issueDate ? t.date(fromDbDate(i.issueDate)) : t("draft")}</span></span>
                    <span className="flex items-center gap-2"><Badge variant="outline" className={INVOICE_STATUS_META[i.status].className}>{t(INVOICE_STATUS_META[i.status].label)}</Badge><span className="w-24 text-right tabular-nums">{formatTZS(i.netAmount)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={t("People")} subtitle={t.plural(c.guests.length, "{n} person from {company} — tap one when booking", "{n} people from {company} — tap one when booking", { company: c.companyName })}>
        <Employees companyId={c.id} canEdit={canManage || can(user, "reservations.create") || can(user, "guests.manage")} canBook={can(user, "reservations.create")}
          staff={c.guests.map((g) => ({ id: g.id, fullName: g.fullName, phone: g.phone, idType: g.idType, idNumber: g.idNumber, stays: g._count.reservations }))} />
      </Panel>

      <Panel title={t("Stays")} subtitle={t.plural(guests.length, "{n} guest sent by {company}", "{n} guests sent by {company}", { company: c.companyName })} action={<span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><BedDouble className="size-3.5" />{t("latest first")}</span>}>
        {c.reservations.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{t("No stays yet. Use “Book for them”, or choose the company under “Who pays” when booking.")}</p> : (
          <div className="overflow-x-auto">
            <table data-stack className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 font-medium">{t("Guest")}</th><th className="py-2 font-medium">{t("Room")}</th><th className="py-2 font-medium">{t("Stay")}</th><th className="hidden py-2 font-medium md:table-cell">{t("Who pays")}</th>
                <th className="py-2 font-medium">{t("Status")}</th><th className="py-2 text-right font-medium">{t("Stay total")}</th><th className="py-2 text-right font-medium">{t("On invoice")}</th>
              </tr></thead>
              <tbody>
                {c.reservations.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-muted/40">
                    <td className="py-2.5"><Link href={`/staff/reservations/${r.id}`} className="inline-flex items-center gap-1 font-medium hover:underline">{r.guest.fullName}<ArrowUpRight className="size-3 opacity-50" /></Link><span className="block font-mono text-[11px] text-muted-foreground">{r.reference}</span></td>
                    <td className="py-2.5 tabular-nums">{r.rooms.map((x) => x.room.number).join(", ") || "—"}</td>
                    <td className="py-2.5 text-xs">{t.date(fromDbDate(r.arrivalDate))} → {t.date(fromDbDate(r.departureDate))}</td>
                    <td className="hidden py-2.5 text-xs text-muted-foreground md:table-cell">{billToLabel(r.billTo as BillTo, r.companyCovers, t)}</td>
                    <td className="py-2.5"><Badge variant="outline" className={RESERVATION_STATUS_META[r.status].className}>{t(RESERVATION_STATUS_META[r.status].label)}</Badge></td>
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
        <Panel title={t("Billing details")} subtitle={t("Printed on every invoice")}>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">{t("Billing address")}</dt><dd className="whitespace-pre-line">{c.billingAddress || c.address || "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("Tax")}</dt><dd>{[c.taxId && t("TIN {tin}", { tin: c.taxId }), c.vrn && t("VRN {vrn}", { vrn: c.vrn }), c.registrationNo && t("Reg. No. {number}", { number: c.registrationNo })].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("Notes")}</dt><dd className="whitespace-pre-line">{c.billingNotes || "—"}</dd></div>
          </dl>
        </Panel>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Receipt className="size-3.5" />{t("Income from these stays is counted once, night by night. Invoices and company payments only move what is owed — they never add income again.")}</p>
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

function DueChip({ days, t }: { days: number; t: T }) {
  return (
    <span className={cn("mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold",
      days < 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : days <= 7 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
      {days < 0 ? t.plural(-days, "Overdue {n} day", "Overdue {n} days") : days === 0 ? t("Due today") : t.plural(days, "Due in {n} day", "Due in {n} days")}
    </span>
  );
}
