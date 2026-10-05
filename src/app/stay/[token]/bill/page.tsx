import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@/server/settings";
import { guestStayBill } from "@/server/services/stay-bill";
import { GuestBillPage } from "@/components/ordering/guest-bill-page";
import { stayBillPayOnline } from "@/server/services/online-pay";
import { payStayBillOnlineAction } from "@/app/stay/[token]/actions";

export const metadata: Metadata = { title: "Your bill", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** The guest's room bill — print it or keep it as a PDF / picture. */
export default async function GuestStayBillPage({ params }: PageProps<"/stay/[token]/bill">) {
  const { token } = await params;
  const [bill, settings, online] = await Promise.all([guestStayBill({ guestToken: token }), getSettings(), stayBillPayOnline({ guestToken: token })]);
  if (!bill) notFound();
  return <GuestBillPage bill={bill} settings={settings} pay={online.offered || online.live ? { due: online.due, live: online.live, action: payStayBillOnlineAction.bind(null, token) } : null} back={`/stay/${token}`} />;
}
