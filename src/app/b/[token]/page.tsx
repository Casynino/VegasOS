import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { qrLanding } from "@/server/services/hotel-qr";
import { qrExplore } from "@/server/services/hotel-qr-explore";
import { getSettings } from "@/server/settings";
import { publicStats } from "@/server/services/public-booking";
import { getSiteContent } from "@/server/services/site-content";
import { getHotelWeather } from "@/server/services/weather";
import { contentVars } from "@/components/public/contact";
import { fill } from "@/components/public/content";
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
  const [explore, settings, c, stats, weather] = await Promise.all([qrExplore(), getSettings(), getSiteContent(), publicStats(), getHotelWeather()]);
  // The opening is the website's own (owner, 2026-10-05: "the same look as our landing page"): its photos and words.
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm, rooms: stats.rooms, roomTypes: stats.roomTypes }));
  const hero = {
    slides: c.home.hero.slides,
    eyebrow: c.facts.locationLine,
    title: f(c.home.hero.title),
    accent: f(c.home.hero.titleAccent),
    place: settings.city ?? "Dar es Salaam",
    initialTime: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date()),
    temp: weather ? `${weather.temp}°C` : null,
    weather: weather ? `${weather.temp}°C · ${weather.label}` : null,
  };
  // The gallery is only needed for room types with no photos of their own yet (the hotel's room photos stand in).
  const photos = landing.hotel.photos.filter((p) => p.category === "rooms").slice(0, 6);
  return (
    <Suspense>
      <HotelQrApp token={token} landing={{ ...landing, hotel: { ...landing.hotel, photos } }} explore={explore} hero={hero} />
    </Suspense>
  );
}
