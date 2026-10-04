import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getSettings } from "@/server/settings";
import { customerPaymentByToken } from "@/server/services/online-pay";
import { PayStatus } from "./pay-status";

export const metadata: Metadata = { title: "Payment", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * THE CUSTOMER'S PAYMENT PAGE — one for every online payment at the hotel (an order, room service, a bill, a booking,
 * transport…): waiting for them to approve it on their phone, paid (only once nTZS has confirmed it), or not
 * completed with "Try again". The link is private (random) and shows only this payment.
 */
export default async function PayPage({ params }: PageProps<"/pay/[token]">) {
  const { token } = await params;
  const [view, s] = await Promise.all([customerPaymentByToken(token, { check: true }), getSettings()]);
  if (!view) notFound();
  return (
    <main className="vr min-h-svh bg-(--vr-bg) px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] text-(--vr-ink)">
      <div className="mx-auto max-w-md">
        <header className="flex items-center gap-3 py-3">
          <Image src="/brand/logo-192.png" alt="" width={40} height={40} className="rounded-full ring-1 ring-(--vr-line)" />
          <div className="leading-tight">
            <p className="font-display text-lg font-semibold">{s.hotelName}</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-(--vr-muted)">Payment</p>
          </div>
        </header>
        <PayStatus initial={view} />
      </div>
    </main>
  );
}
