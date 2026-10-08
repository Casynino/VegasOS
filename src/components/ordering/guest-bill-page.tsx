import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { StayBill } from "@/server/services/stay-bill";
import type { getSettings } from "@/server/settings";
import { StayBillDoc } from "@/components/staff/bills/stay-bill-doc";
import { ReceiptActions } from "./receipt-actions";
import { BillPayOnline } from "./bill-pay-online";
import type { ActionResult } from "@/server/errors";
import { getT } from "@/i18n/server";

/**
 * The guest's room bill page (from their stay link or the room's QR card): print or download it. Paying online is only
 * mobile money (nTZS, the card at the top) — the bill never lists the hotel's account numbers to pay into (owner,
 * 2026-10-05: "any online payment is nTZS, nothing more").
 */
export async function GuestBillPage({ bill, settings, back, pay }: {
  bill: StayBill; settings: Awaited<ReturnType<typeof getSettings>>; back: string;
  /** Pay online (nTZS) for what is owed — when offered. */
  pay?: { due: number; live: string | null; action: (input: { phone: string; clientKey: string }) => Promise<ActionResult<{ pay: string }>> } | null;
}) {
  const t = await getT();
  return (
    <main className="min-h-svh bg-[#e9e6e1] px-3 py-6 text-[#1b1611] print:bg-white print:p-0 sm:px-4">
      <style>{`@media print { @page { margin: 6mm; } body { background: #fff !important; } }`}</style>
      <div className="mx-auto max-w-[680px] space-y-4">
        <div className="flex items-center justify-between gap-2 font-sans print:hidden">
          <Link href={back} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-black/70 hover:bg-black/5"><ArrowLeft className="size-4" />{t("Your stay")}</Link>
          <p className="text-xs text-black/55">{t("Your bill · {reference}", { reference: bill.reference })}</p>
        </div>
        {pay && <BillPayOnline due={pay.due} live={pay.live} action={pay.action} />}
        <ReceiptActions fileName={`${settings.hotelName.replace(/\s+/g, "-")}-${bill.reference}-bill`} />
        <StayBillDoc bill={bill} payTo={[]}
          hotel={{ name: settings.hotelName, address: settings.addressLine, phone: settings.phone, whatsapp: settings.whatsapp, email: settings.email, website: settings.website }} />
      </div>
    </main>
  );
}
