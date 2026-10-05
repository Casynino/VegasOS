import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSettings } from "@/server/settings";
import { orderBillByTrackToken } from "@/server/services/restaurant";
import { OrderReceipt } from "@/components/ordering/order-receipt";
import { ReceiptActions } from "@/components/ordering/receipt-actions";

export const metadata: Metadata = { title: "Your receipt", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** The customer's receipt for their order — print it or keep it as a PDF / picture. */
export default async function OrderReceiptPage({ params }: PageProps<"/order/[token]/receipt">) {
  const { token } = await params;
  const [found, settings] = await Promise.all([orderBillByTrackToken(token), getSettings()]);
  if (!found) notFound();
  const { bill, id } = found;
  return (
    <main className="min-h-svh bg-[#e9e6e1] px-3 py-6 sm:px-4 text-[#1b1611] print:bg-white print:p-0">
      <style>{`@media print { @page { margin: 6mm; } body { background: #fff !important; } }`}</style>
      <div className="mx-auto max-w-[680px] space-y-4">
        <div className="flex items-center justify-between gap-2 print:hidden">
          <Link href={`/order/${token}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-black/70 hover:bg-black/5"><ArrowLeft className="size-4" />Your order</Link>
          <p className="text-xs text-black/55">Your receipt</p>
        </div>
        <ReceiptActions fileName={`${settings.hotelName.replace(/\s+/g, "-")}-${bill.orders[0].number}`} />
        <OrderReceipt bill={bill} leadId={id} payTo={[]}
          hotel={{ name: settings.hotelName, address: settings.addressLine, phone: settings.phone, whatsapp: settings.whatsapp, email: settings.email, website: settings.website }} />
      </div>
    </main>
  );
}
