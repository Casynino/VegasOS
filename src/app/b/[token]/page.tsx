import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { qrLanding } from "@/server/services/hotel-qr";
import { HotelQrApp } from "@/components/hotel-qr/app";
import { QrMessage } from "@/components/hotel-qr/inactive";

export const metadata: Metadata = { title: "Book your stay", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const viewport: Viewport = { themeColor: "#1d1712" };
export const dynamic = "force-dynamic";

/**
 * THE HOTEL BOOKING QR (/b/<token>) — the printed "Scan to book your stay" codes open the hotel's own booking app here:
 * the hotel, its rooms, what is free, the room, the guest's details, paying (nTZS) or paying at the hotel. The token is
 * found again on the server; a switched-off, replaced or unknown code shows the hotel's phone and the website instead.
 */
export default async function HotelQrPage({ params }: PageProps<"/b/[token]">) {
  const { token } = await params;
  const landing = await qrLanding(token);
  if (!landing.active) {
    return <QrMessage hotel={landing.hotel} title="This QR code is no longer active" message={landing.message} />;
  }
  // Only what the app shows, not the whole gallery: room photos (for room types with none of their own yet), then a
  // short look around — outside, the lobby, a bathroom, a detail.
  const pick = (category: string, n: number) => landing.hotel.photos.filter((p) => p.category === category).slice(0, n);
  const photos = [...pick("rooms", 6), ...pick("exterior", 2), ...pick("lobby", 3), ...pick("bath", 2), ...pick("amenity", 1)];
  return (
    <Suspense>
      <HotelQrApp token={token} landing={{ ...landing, hotel: { ...landing.hotel, photos } }} />
    </Suspense>
  );
}
