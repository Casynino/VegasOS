import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, FileText, Users } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { accountOptions } from "@/server/services/payment-accounts";
import { getSettings } from "@/server/settings";
import { siteOrigin } from "@/server/site-origin";
import { INVOICE_STATUS_META } from "@/lib/invoice-status";
import { ReportActions } from "@/app/staff/(app)/reports/report-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { InvoiceDocument } from "@/components/staff/invoices/invoice-document";
import { loadInvoiceDoc } from "@/components/staff/invoices/load-invoice";
import { InvoiceControls } from "./invoice-controls";
import { SendDocument } from "@/components/staff/invoices/send-document";
import { formatBusinessDate } from "@/lib/format";
import { invoiceMessage, payToLine } from "@/lib/invoice-message";
import { AutoPrint } from "@/components/staff/invoices/auto-print";
import { getT, getTFor } from "@/i18n/server";
import { DEFAULT_LOCALE, LOCALE_META } from "@/i18n/config";
import { langLink } from "@/lib/wa-messages";
import { db } from "@/server/db";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Invoice") };
}

export default async function InvoicePage({ params, searchParams }: PageProps<"/staff/invoices/[id]">) {
  const user = await requirePagePermission("invoices.view");
  const { id } = await params;
  const print = (await searchParams).print === "1";
  const [loaded, s, methods] = await Promise.all([
    loadInvoiceDoc({ id }),
    getSettings(),
    accountOptions("payments"),
  ]);
  if (!loaded) notFound();
  const { inv, doc } = loaded;
  const c = inv.corporateCustomer;
  const meta = INVOICE_STATUS_META[inv.status];
  const verifyUrl = inv.verifyToken ? `${await siteOrigin()}/verify/${inv.verifyToken}` : null;
  const g = inv.group;
  // The message in the recipient's language: the group's contact or the guest (a company has none — English).
  const contactLanguage = g ? (await db.guest.findUnique({ where: { id: g.contactGuestId }, select: { preferredLanguage: true } }))?.preferredLanguage
    : c ? null : inv.guest?.preferredLanguage;
  const [t, rt] = await Promise.all([getT(), getTFor(contactLanguage)]);
  // Who it goes to: the group's / company's billing contact, or the guest.
  const to = g ? { name: doc.billTo.name, phone: g.contactGuest.phone ?? c?.phone, email: g.billingEmail ?? c?.email ?? g.contactGuest.email }
    : c ? { name: c.companyName, phone: c.phone, email: c.email } : { name: inv.guest?.fullName ?? t("Guest"), phone: inv.guest?.phone, email: inv.guest?.email };
  const sendText = invoiceMessage({
    hotelName: s.hotelName, hotelPhone: s.phone, greet: doc.billTo.person?.name ?? doc.billTo.attn ?? doc.billTo.name, number: inv.number, final: doc.group?.final,
    group: g ? { name: g.name, rooms: doc.group?.rooms ?? 0 } : null, net: inv.netAmount, paid: inv.paidAmount, balance: inv.balanceAmount,
    due: doc.dueDate ? (rt.locale === DEFAULT_LOCALE ? formatBusinessDate(doc.dueDate) : rt.date(doc.dueDate)) : null, payTo: payToLine(s, rt), verifyUrl: langLink(verifyUrl, rt),
  }, rt);

  return (
    <div className="w-full space-y-5 print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/staff/invoices" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> {t("Invoices")}</Link>
          <Badge variant="outline" className={meta.className}>{t(meta.label)}</Badge>
          {c && <Link href={`/staff/corporate/${c.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><Building2 /> {c.companyName}</Link>}
          {c && <Link href={`/staff/corporate/${c.id}/statement`} className={buttonVariants({ variant: "ghost", size: "sm" })}><FileText /> {t("Statement")}</Link>}
          {g && <Link href={`/staff/groups/${g.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><Users /> {g.name}</Link>}
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.status !== "DRAFT" && inv.status !== "CANCELLED" && inv.status !== "VOID" && (
            <SendDocument
              entity={{ type: "Invoice", id: inv.id }} what={`invoice ${inv.number}`} to={to} subject={rt("{hotel} — invoice {number}", { hotel: s.hotelName, number: inv.number })} text={sendText}
              label={rt.locale === DEFAULT_LOCALE ? undefined : t("Send ({language})", { language: LOCALE_META[rt.locale].short })}
            />
          )}
          <ReportActions target="invoice-doc" fileName={`${s.hotelName}-invoice-${inv.number}`.replace(/[^\w]+/g, "-").toLowerCase()} />
          <InvoiceControls
            invoiceId={inv.id} status={inv.status} balance={inv.balanceAmount} linkedReservationId={inv.reservationId}
            canManage={can(user, "invoices.manage")} canPay={can(user, "payments.record")} methods={methods} canIssue={!(inv.status === "DRAFT" && g)}
            defaultTerms={doc.terms}
          />
        </div>
      </div>
      {inv.status === "DRAFT" && (g ? (
        <p className="mx-auto max-w-[880px] rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-800 print:hidden dark:text-violet-300">
          {t.rich("This is <b>{group}</b>'s running bill: each room joins it when it checks out. It becomes the final group invoice when you <link>finalize the group</link> after everyone has left.", {
            b: (x) => <strong>{x}</strong>,
            link: (x) => <Link href={`/staff/groups/${g.id}`} className="font-semibold underline underline-offset-2">{x}</Link>,
          }, { group: g.name })}
        </p>
      ) : (
        <p className="mx-auto max-w-[880px] rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 print:hidden dark:text-amber-300">
          {c?.consolidateInvoices
            ? t("This is a draft — this company's stays are collected here until you issue it. Issue it to send it; the due date comes from the payment terms.")
            : t("This is a draft. Issue it to send it; the due date comes from the payment terms.")}
        </p>
      ))}
      <InvoiceDocument inv={doc} s={s} verifyUrl={verifyUrl} />
      {print && <AutoPrint />}
    </div>
  );
}
