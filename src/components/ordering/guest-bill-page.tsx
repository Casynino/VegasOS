import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { StayBill } from "@/server/services/stay-bill";
import type { getSettings } from "@/server/settings";
import { StayBillDoc } from "@/components/staff/bills/stay-bill-doc";
import { ReceiptActions } from "./receipt-actions";
import type { PayTo } from "./folio";

/** The guest's room bill page (from their stay link or the room's QR card): print or download it. */
export function GuestBillPage({ bill, settings, payTo, back }: { bill: StayBill; settings: Awaited<ReturnType<typeof getSettings>>; payTo: PayTo[]; back: string }) {
  return (
    <main className="min-h-svh bg-[#e9e6e1] px-3 py-6 text-[#1b1611] print:bg-white print:p-0 sm:px-4">
      <style>{`@media print { @page { margin: 6mm; } body { background: #fff !important; } }`}</style>
      <div className="mx-auto max-w-[680px] space-y-4">
        <div className="flex items-center justify-between gap-2 font-sans print:hidden">
          <Link href={back} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-black/70 hover:bg-black/5"><ArrowLeft className="size-4" />Your stay</Link>
          <p className="text-xs text-black/55">Your bill · {bill.reference}</p>
        </div>
        <ReceiptActions fileName={`${settings.hotelName.replace(/\s+/g, "-")}-${bill.reference}-bill`} />
        <StayBillDoc bill={bill} payTo={payTo}
          hotel={{ name: settings.hotelName, address: settings.addressLine, phone: settings.phone, whatsapp: settings.whatsapp, email: settings.email, website: settings.website }} />
      </div>
    </main>
  );
}
