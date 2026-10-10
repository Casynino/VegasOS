import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { businessToday, getSettings } from "@/server/settings";
import { ReportActions } from "@/app/staff/(app)/reports/report-actions";
import { InvoiceDocument } from "@/components/staff/invoices/invoice-document";
import { groupStatementDoc } from "@/components/staff/invoices/group-statement";
import { SendDocument } from "@/components/staff/invoices/send-document";
import { groupStatementMessage } from "@/lib/wa-messages";
import { prettyPhone } from "@/lib/guest-messages";
import { getT, getTFor } from "@/i18n/server";
import { DEFAULT_LOCALE, LOCALE_META } from "@/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Group statement") };
}

/** The group's charges so far, room by room — printable or sent to the contact, any time before the final invoice. */
export default async function GroupStatementPage({ params }: PageProps<"/staff/groups/[id]/statement">) {
  await requirePagePermission("reservations.view", "invoices.view");
  const { id } = await params;
  const [today, s] = await Promise.all([businessToday(), getSettings()]);
  const loaded = await groupStatementDoc(id, today);
  if (!loaded) notFound();
  const { group: g, doc } = loaded;
  const payer = g.corporateCustomer?.companyName ?? g.name;
  // The message in the group contact's language.
  const [t, rt] = await Promise.all([getT(), getTFor(g.contactGuest.preferredLanguage)]);

  return (
    <div className="w-full space-y-5 print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/staff/groups/${g.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t("Back to {name}", { name: g.name })}</Link>
        <div className="flex gap-2">
          <SendDocument
            entity={{ type: "BookingGroup", id: g.id }} what={`statement ${doc.number}`}
            to={{ name: payer, phone: g.contactGuest.phone, email: g.billingEmail ?? g.corporateCustomer?.email ?? g.contactGuest.email }}
            subject={rt("{hotel} — statement for {group}", { hotel: s.hotelName, group: g.name })}
            text={groupStatementMessage({
              hotel: { name: s.hotelName, phone: prettyPhone(s.whatsapp || s.phone) || null }, greet: g.contactGuest.fullName, group: g.name,
              number: doc.number, rooms: doc.group?.rooms ?? 0, money: { total: doc.net, paid: doc.paid, balance: doc.balance },
            }, rt)}
            label={rt.locale === DEFAULT_LOCALE ? undefined : t("Send ({language})", { language: LOCALE_META[rt.locale].short })}
          />
          <ReportActions target="invoice-doc" fileName={`${s.hotelName}-group-statement-${doc.number}`.replace(/[^\w]+/g, "-").toLowerCase()} />
        </div>
      </div>
      <p className="mx-auto max-w-[880px] rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 print:hidden dark:text-amber-300">
        {t("Statement only — printing or sending it records nothing and bills nothing. The final group invoice is made when you finalize the group after everyone has checked out.")}
      </p>
      <InvoiceDocument inv={doc} s={s} verifyUrl={null} proforma statement title={t("Group statement")} />
    </div>
  );
}
