import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { getSettings } from "@/server/settings";
import { prettyPhone } from "@/lib/guest-messages";
import { qrConfirmation } from "@/server/services/hotel-qr";
import { QrConfirmationView } from "@/components/hotel-qr/confirmation";
import { QrMessage } from "@/components/hotel-qr/inactive";

export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const viewport: Viewport = { themeColor: "#1d1712" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * THE CONFIRMATION (/b/<token>/done?ref=…&key=…) — where a Hotel QR booking lands: after paying online (the payment
 * page sends the guest back here), or straight after "Pay at the hotel". The reference and its private key open it;
 * "paid" shows only once nTZS has confirmed the money. A booking that is not from this QR (or a QR no longer in use)
 * opens on the booking's own page instead.
 */
export default async function QrDonePage({ params, searchParams }: PageProps<"/b/[token]/done">) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const ref = one(sp.ref).trim().toUpperCase(), key = one(sp.key).trim();
  const found = /^VLH-[A-Z0-9]{4,12}$/.test(ref) && key.length >= 16 && key.length <= 200 ? await qrConfirmation(token, ref, key) : { state: "not_found" as const };
  if (found.state === "moved") redirect(found.href);
  if (found.state === "not_found") {
    const s = await getSettings();
    return (
      <QrMessage hotel={{ name: s.hotelName, phone: s.phone ? prettyPhone(s.phone) : null, whatsapp: s.whatsapp ? prettyPhone(s.whatsapp) : null }}
        title="We could not find this booking" message="The link may be incomplete. Open it again from your message — or call us with your booking reference." />
    );
  }
  return <QrConfirmationView token={token} link={{ ref, key }} initial={found.booking} />;
}
