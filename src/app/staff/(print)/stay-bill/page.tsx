import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { accountOptions } from "@/server/services/payment-accounts";
import { stayBill } from "@/server/services/stay-bill";
import { StayBillDoc } from "@/components/staff/bills/stay-bill-doc";
import { ReceiptActions } from "@/components/ordering/receipt-actions";
import { BackButton } from "./back-button";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Room bill"), robots: { index: false, follow: false } };
}
export const dynamic = "force-dynamic";

/** A stay's room bill — view it with the guest, print it or download it (PDF / image). */
export default async function StayBillPage({ searchParams }: PageProps<"/staff/stay-bill">) {
  const user = await requirePagePermission("reservations.view", "rooms.view", "restaurant.orders", "payments.record");
  const sp = await searchParams;
  const id = typeof sp.reservation === "string" ? sp.reservation : "";
  const [bill, settings, accounts, t] = await Promise.all([stayBill(id), getSettings(), accountOptions("payments"), getT()]);
  if (!bill) notFound();
  const payTo = accounts.filter((a) => a.number && a.kind !== "CASH");
  const fileName = `${settings.hotelName.replace(/\s+/g, "-")}-${bill.reference}-bill`;
  return (
    <main className="min-h-svh bg-[#e9e6e1] px-3 py-6 text-[#1b1611] print:bg-white print:p-0 sm:px-4">
      <style>{`@media print { @page { margin: 6mm; } body { background: #fff !important; } }`}</style>
      <div className="mx-auto max-w-[680px] space-y-4">
        <div className="flex items-center justify-between gap-2 font-sans print:hidden">
          <BackButton fallback={`/staff/reservations/${bill.id}`} />
          {can(user, "reservations.view") && <Link href={`/staff/reservations/${bill.id}`} className="text-xs font-medium text-black/60 hover:text-black">{t("Booking {reference} →", { reference: bill.reference })}</Link>}
        </div>
        <ReceiptActions fileName={fileName} />
        {bill.totals.balance > 0 && can(user, "payments.record") && bill.status === "CHECKED_IN" && (
          <Link href={`/staff/check-out?id=${bill.id}#workspace`} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] font-sans text-[15px] font-semibold text-[oklch(0.2_0.03_60)] hover:brightness-105 print:hidden">
            <Wallet className="size-4" />{t("Receive payment · settle the bill")}
          </Link>
        )}
        <StayBillDoc bill={bill} payTo={payTo}
          hotel={{ name: settings.hotelName, address: settings.addressLine, phone: settings.phone, whatsapp: settings.whatsapp, email: settings.email, website: settings.website }} />
      </div>
    </main>
  );
}
