import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { listPublicRoomTypes, websitePricer } from "@/server/services/public-booking";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { contentVars } from "@/components/public/contact";
import { fill } from "@/components/public/content";
import { getSiteContent } from "@/server/services/site-content";
import { NamedIcon } from "@/components/public/icon";
import { Actions, Eyebrow, LinkButton, Reveal, Section, SectionIntro, StaggerItem, TextLink, rhythm, typeScale } from "@/components/public/kit";
import { PageHero } from "@/components/public/page-hero";
import { RoomCard } from "@/components/public/room-card";

export const metadata: Metadata = {
  title: "Rooms & suites",
  description:
    "Standard Single, Double Deluxe, Executive, Executive Suite and Twin rooms at Vegas Luxury Hotel, Dar es Salaam — all with free Wi-Fi and breakfast. Book direct online.",
  alternates: { canonical: "/rooms" },
};

/**
 * Rooms: the photograph first, then one editorial row per room type (photo, name, one line,
 * facts, tonight's website price, Book / Explore), what every room includes, and a quiet
 * closing call to book. Room types only — never room numbers.
 */
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
  const lowest = rooms.length ? Math.min(...rooms.map((r) => r.net)) : null;

  return (
    <>
      <PageHero
        kicker={p.kicker}
        title={p.title}
        image={p.image.src}
        imageAlt={p.image.alt}
        focal="50% 45%"
        id="rooms-title"
        intro={
          <p>
            {f(p.intro)}
            {discount > 0 && <> Online prices include our standard {formatTZS(discount)} per night discount.</>}
          </p>
        }
      >
        <Actions className="mt-7 sm:mt-8">
          <LinkButton href="/book" icon="arrow">Check availability</LinkButton>
          {rooms.length > 0 && <TextLink href="#room-types">See the rooms</TextLink>}
        </Actions>
      </PageHero>

      <Section id="room-types" labelledBy="room-types-title" space="md" className={rooms.length > 0 ? "pb-4 sm:pb-6 lg:pb-8" : undefined}>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2 border-b border-pub-line pb-5">
          {/* A label, not a heading: each room type below is an h2 of its own. */}
          <Eyebrow rule>
            <span id="room-types-title">{rooms.length > 0 ? `${rooms.length} room type${rooms.length === 1 ? "" : "s"}` : "Room types"}</span>
          </Eyebrow>
          {lowest !== null && <p className={cn(typeScale.meta, "text-pub-muted")}>From {formatTZS(lowest)} per night · tonight’s website rates</p>}
        </div>

        {rooms.length === 0 ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <p className={cn(typeScale.lede, "text-pub-muted")}>Room information is being updated — please contact us to book.</p>
            <Actions align="center" className={rhythm.beforeActions}>
              <TextLink href="/contact?subject=booking">Contact the front desk</TextLink>
            </Actions>
          </div>
        ) : (
          <ol className="divide-y divide-pub-line">
            {rooms.map((r, i) => (
              <StaggerItem as="li" key={r.slug} className="py-8 sm:py-14 lg:py-16">
                <RoomCard room={r} headingLevel={2} variant="row" reverse={i % 2 === 1} />
              </StaggerItem>
            ))}
          </ol>
        )}
      </Section>

      {shared.length > 0 && (
        <Section tone="night" glow="top" space="md" labelledBy="included-title">
          <Reveal>
            <SectionIntro align="split" eyebrow="In every room" title={p.includedTitle} lede={f(p.includedNote)} id="included-title" />
          </Reveal>
          <ul className={cn(rhythm.afterIntro, "grid grid-cols-2 gap-x-6 border-t border-pub-line sm:gap-x-10 lg:grid-cols-4")}>
            {shared.map((a) => (
              <li key={a.code} className="flex min-w-0 items-center gap-3 border-b border-pub-line py-4 sm:py-5">
                <NamedIcon name={a.icon} className="size-5 shrink-0 text-pub-eyebrow" />
                <span className="min-w-0 text-[15px] leading-snug text-pub-fg">{a.name}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section tone="deep" space="md" labelledBy="rooms-cta" width="narrow">
        <Reveal>
          <SectionIntro
            align="center"
            eyebrow="Plan your stay"
            title={p.helpTitle}
            lede={p.helpBody}
            id="rooms-cta"
            actions={
              <>
                <LinkButton href="/book" icon="arrow">Check availability</LinkButton>
                <TextLink href="/contact?subject=booking">Ask the front desk</TextLink>
              </>
            }
          />
        </Reveal>
      </Section>
    </>
  );
}
