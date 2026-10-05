import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { qrLanding } from "@/server/services/hotel-qr";
import { qrExplore } from "@/server/services/hotel-qr-explore";
import { HotelQrApp } from "@/components/hotel-qr/app";
import { QrMessage } from "@/components/hotel-qr/inactive";

export const metadata: Metadata = { title: "Book your stay", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const viewport: Viewport = { themeColor: "#1d1712" };
export const dynamic = "force-dynamic";

/**
 * THE HOTEL BOOKING QR (/b/<token>) — the printed "Scan to book your stay" codes open the hotel's own app here: the
 * hotel to explore (its photos, rooms, food & drinks, the meeting room), then booking in three steps — dates, a room,
 * details & pay (nTZS) or pay later. The token is found again on the server; a switched-off, replaced or unknown code
 * shows the hotel's phone and the website instead.
 */
export default async function HotelQrPage({ params }: PageProps<"/b/[token]">) {
  const { token } = await params;
  const landing = await qrLanding(token);
  if (!landing.active) {
    return <QrMessage hotel={landing.hotel} title="This QR code is no longer active" message={landing.message} />;
  }
  const explore = await qrExplore();
  // The gallery is only needed for room types with no photos of their own yet (the hotel's room photos stand in).
  const photos = landing.hotel.photos.filter((p) => p.category === "rooms").slice(0, 6);
  return (
    <Suspense>
      <HotelQrApp token={token} landing={{ ...landing, hotel: { ...landing.hotel, photos } }} explore={explore} />
    </Suspense>
  );
}
