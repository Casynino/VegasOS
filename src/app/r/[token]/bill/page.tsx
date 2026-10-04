import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@/server/settings";
import { accountOptions } from "@/server/services/payment-accounts";
import { guestStayBill } from "@/server/services/stay-bill";
import { GuestBillPage } from "@/components/ordering/guest-bill-page";

export const metadata: Metadata = { title: "Your bill", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** The guest's room bill — print it or keep it as a PDF / picture. */
export default async function GuestStayBillPage({ params }: PageProps<"/r/[token]/bill">) {
  const { token } = await params;
  const [bill, settings, accounts] = await Promise.all([guestStayBill({ roomQrToken: token }), getSettings(), accountOptions("payments")]);
  if (!bill) notFound();
  return <GuestBillPage bill={bill} settings={settings} payTo={accounts.filter((a) => a.number && a.kind !== "CASH")} back={`/r/${token}?view=guest`} />;
}
