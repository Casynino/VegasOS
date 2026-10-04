import type { Metadata } from "next";
import { Check } from "lucide-react";
import { getSettings } from "@/server/settings";
import { listPublicRoomTypes, websitePricer } from "@/server/services/public-booking";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { contentVars } from "@/components/public/contact";
import { fill } from "@/components/public/content";
import { getSiteContent } from "@/server/services/site-content";
import { NamedIcon } from "@/components/public/icon";
import { PageHero } from "@/components/public/page-hero";
import { PillLink } from "@/components/public/pill-link";
import { Reveal, Stagger, StaggerItem } from "@/components/public/reveal";
import { RoomCard } from "@/components/public/room-card";
import { SectionHeading } from "@/components/public/section-heading";
import { container, cream, espresso, type } from "@/components/public/ui";

export const metadata: Metadata = {
  title: "Rooms & suites",
  description:
    "Standard Single, Double Deluxe, Executive, Executive Suite and Twin rooms at Vegas Luxury Hotel, Dar es Salaam — all with free Wi-Fi and breakfast. Book direct online.",
  alternates: { canonical: "/rooms" },
};

export default async function RoomsPage() {
  const [settings, types, c] = await Promise.all([getSettings(), listPublicRoomTypes(), getSiteContent()]);
  const price = await websitePricer(settings);
  const p = c.pages.rooms;
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm }));
  const rooms = types.map((t) => {
    const p = price(t);
    return { ...t, image: t.images[0], net: p.net, baseRate: p.baseRate, promo: p.promoLabel };
  });
  const discount = rooms[0] ? rooms[0].baseRate - rooms[0].net : 0;
  // Amenities every public room type shares.
  const shared = rooms[0]?.amenities.filter((a) => rooms.every((r) => r.amenities.some((b) => b.code === a.code))) ?? [];

  return (
    <>
      <PageHero
        kicker={p.kicker}
        title={p.title}
        image={p.image.src}
        imageAlt={p.image.alt}
        intro={
          <p>
            {f(p.intro)}
            {discount > 0 && <> Online prices include our standard {formatTZS(discount)} per night discount.</>}
          </p>
        }
      />

      <section className={cn(cream, "py-16 sm:py-24")} aria-label="Room types">
        <div className={container}>
          {rooms.length === 0 ? (
            <p className="text-center text-tone/70">Room information is being updated — please contact us to book.</p>
          ) : (
            <Stagger as="ul" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((r, i) => (
                <StaggerItem as="li" key={r.slug} index={i}>
                  <RoomCard room={r} headingLevel={2} />
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </div>
      </section>

      {shared.length > 0 && (
        <section className={cn(espresso, "py-16 text-white sm:py-24")} aria-labelledby="included-title">
          <div className={cn(container, "grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:items-center")}>
            <Reveal>
              <SectionHeading align="left" tone="dark" kicker="In every room" title={p.includedTitle} />
              <p className="mt-6 max-w-md text-white/65">
                {f(p.includedNote)}
              </p>
            </Reveal>
            <Stagger as="ul" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {shared.map((a, i) => (
                <StaggerItem as="li" key={a.code} index={i} className="flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-4">
                  <NamedIcon name={a.icon} className="size-5 shrink-0 text-gold" />
                  <span className="text-sm text-white/85">{a.name}</span>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>
      )}

      <section className={cn(cream, "py-16 sm:py-24")} aria-labelledby="rooms-cta">
        <Reveal className={cn(container, "flex flex-col items-center text-center")}>
          <h2 id="rooms-cta" className={cn("max-w-2xl text-balance", type.h2)}>{p.helpTitle}</h2>
          <p className="mt-5 max-w-lg text-tone/70">
            {p.helpBody}
          </p>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-tone/70">
            {["Instant booking reference", "No card needed online", "Pay at the hotel"].map((t) => (
              <li key={t} className="inline-flex items-center gap-2"><Check className="size-4 text-accent-ink" aria-hidden="true" />{t}</li>
            ))}
          </ul>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <PillLink href="/book" variant="dark">Check availability</PillLink>
            <PillLink href="/contact?subject=booking" variant="outline" arrow={false}>Ask the front desk</PillLink>
          </div>
        </Reveal>
      </section>
    </>
  );
}
