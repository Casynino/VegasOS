import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { bookingWindow, parseImages, publicStats } from "@/server/services/public-booking";
import { publicMeetingRoom } from "@/server/services/booking-requests";
import { transportServices } from "@/server/services/transport";
import { getSiteContent } from "@/server/services/site-content";
import { formatTZS } from "@/lib/format";
import { isFromPrice } from "@/lib/transport-meta";
import { cn } from "@/lib/utils";
import { contentVars } from "@/components/public/contact";
import { fill, ILLUSTRATIVE, photo } from "@/components/public/content";
import {
  Accent,
  Actions,
  Display,
  EditorialSplit,
  Eyebrow,
  FeatureList,
  Heading,
  InfoList,
  LinkButton,
  Rail,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  rhythm,
  typeScale,
} from "@/components/public/kit";
import { PageHero } from "@/components/public/page-hero";
import { ExperienceTile } from "@/components/public/services/experience-tile";
import { FeatureMoment } from "@/components/public/services/feature-moment";
import { StoryMedia } from "@/components/public/services/story-media";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getSiteContent();
  const img = c.pages.hotel.image;
  return {
    title: "The hotel & services",
    description: `About Vegas Luxury Hotel at Mlimani City, Dar es Salaam: ${c.services.map((s) => s.name.toLowerCase()).join(", ")}.`,
    alternates: { canonical: "/hotel" },
    openGraph: { images: [{ url: img.src, alt: img.alt }] },
  };
}

/** Service codes (Staff → Website → Services, or the defaults) that have a page of their own. */
const SERVICE_PAGES: Record<string, string> = {
  restaurant: "/restaurant",
  breakfast: "/restaurant",
  bar: "/bar",
  roomservice: "/menu",
  meeting: "/meeting-room",
  meetingroom: "/meeting-room",
  transfer: "/transport",
  airporttransfer: "/transport",
  hoteltransport: "/transport",
  reception: "/contact",
  reception24h: "/contact",
};
const codeOf = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * About Vegas — the hotel's home for "who we are" and "what is here":
 * the photograph · a short story with real facts · Experiences (#experiences: the restaurant as
 * the lead story, then the bar, room service, the Meeting Room and airport pickup in a rail) ·
 * Services (#services: every service from Staff → Website, linked where it has a page) · a quiet
 * closing call to book. The header's Experiences / Services links land on these anchors.
 */
export default async function HotelPage() {
  const [settings, stats, c, meeting, transport] = await Promise.all([
    getSettings(),
    publicStats(),
    getSiteContent(),
    publicMeetingRoom(),
    transportServices({ publicOnly: true }),
  ]);
  const p = c.pages.hotel;
  const w = bookingWindow(settings);
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm, rooms: stats.rooms, roomTypes: stats.roomTypes }));
  const service = (...codes: string[]) => c.services.find((s) => codes.includes(codeOf(s.key)));

  const facts = [
    stats.rooms > 0 && { label: "Rooms", value: String(stats.rooms) },
    stats.roomTypes > 0 && { label: "Room types", value: String(stats.roomTypes) },
    { label: "Check-in", value: `From ${w.checkInTime}` },
    { label: "Check-out", value: `By ${w.checkoutTime}` },
  ].filter((x): x is { label: string; value: string } => Boolean(x));
  const [storyMain, storyInset] = p.images;

  const meetingPhoto = meeting ? parseImages(meeting.images)[0] : undefined;
  const pickup = transport.find((t) => t.type === "AIRPORT_PICKUP");
  const roomService = photo("/images/room-red/room-red-06.webp");
  const gate = photo("/images/exterior/exterior-02.webp");
  const experiences = [
    {
      href: "/bar",
      image: ILLUSTRATIVE.barPour,
      title: "The bar",
      body: `${c.home.bar.title} ${c.home.bar.titleAccent}.`,
      cta: "Visit the bar",
    },
    {
      href: "/menu",
      image: { src: roomService.src, alt: roomService.alt },
      title: "Room service",
      body: f(service("roomservice")?.description || "Food and drinks brought to your room."),
      cta: "Explore the menu",
      focal: "40% 50%",
    },
    {
      href: "/meeting-room",
      image: meetingPhoto ? { src: meetingPhoto, alt: `${meeting?.name ?? "Meeting Room"} at ${settings.hotelName}` } : ILLUSTRATIVE.meetingRoom,
      title: meeting?.name ?? c.pages.meeting.fallbackName,
      body: f(c.pages.meeting.fallbackDescription),
      fact: meeting ? `Up to ${meeting.maxAdults} people · ${formatTZS(meeting.baseRate)}` : undefined,
      cta: "Book the Meeting Room",
    },
    {
      href: "/transport",
      image: { src: gate.src, alt: gate.alt },
      title: "Airport pickup",
      body: f(service("transfer", "airporttransfer")?.description || "Pickup by the hotel’s own drivers — about {airportKm} km from JNIA."),
      fact: pickup ? `${isFromPrice(pickup.type, pickup.options.length) ? "From " : ""}${formatTZS(pickup.price)}` : undefined,
      cta: "Request airport pickup",
      focal: "62% 50%",
    },
  ];

  return (
    <>
      <PageHero
        kicker={p.kicker}
        title={p.title}
        image={p.image.src}
        imageAlt={p.image.alt}
        focal="50% 40%"
        id="hotel-title"
        intro={<p>{f(p.intro)}</p>}
      >
        <Actions className="mt-7 sm:mt-8">
          <LinkButton href="/book" icon="arrow">Book your stay</LinkButton>
          <TextLink href="#about">Discover Vegas</TextLink>
        </Actions>
      </PageHero>

      {/* The story: one photograph, a few sentences, real numbers. */}
      <Section id="about" labelledBy="about-title">
        <Reveal>
          <EditorialSplit
            layout="media-wide"
            media={storyMain ? <StoryMedia main={storyMain} inset={storyInset} /> : null}
            textClassName="lg:pt-6"
          >
            <Eyebrow>{p.aboutKicker}</Eyebrow>
            <Heading id="about-title" className={rhythm.afterEyebrow}>
              {p.aboutTitle}
            </Heading>
            <div className={cn(rhythm.afterHeading, "space-y-4")}>
              {p.about.map((para, i) => (
                <p key={i} className={i === 0 ? cn(typeScale.lede, "text-pub-fg") : cn(typeScale.body, "text-pub-muted")}>
                  {f(para)}
                </p>
              ))}
            </div>
            <InfoList variant="grid" cols={2} items={facts} className="mt-9" />
            <Actions className={rhythm.beforeActions}>
              <TextLink href="/gallery">See the gallery</TextLink>
            </Actions>
          </EditorialSplit>
        </Reveal>
      </Section>

      {/* Experiences: the restaurant leads, the rest follow in a rail (a grid on desktop). */}
      <Section id="experiences" tone="night" glow="sky" labelledBy="experiences-title">
        <Reveal>
          <SectionIntro
            align="split"
            eyebrow="Experiences"
            id="experiences-title"
            title={
              <>
                More than <Accent>a room</Accent>
              </>
            }
            lede="Dinner in our restaurant, a drink at the bar, a room for your meeting and a driver waiting at the airport."
          />
        </Reveal>
        <Reveal className={rhythm.afterIntro}>
          <FeatureMoment
            id="dining-title"
            image={ILLUSTRATIVE.restaurantWarm}
            focal="50% 55%"
            eyebrow={c.home.restaurant.kicker}
            title={c.pages.restaurant.title}
            body={f(c.home.restaurant.body)}
            actions={
              <>
                <LinkButton href="/menu" icon="arrow">Explore the menu</LinkButton>
                <TextLink href="/restaurant">The restaurant</TextLink>
              </>
            }
          />
        </Reveal>
        <Reveal className="mt-14 sm:mt-16 lg:mt-20">
          <Rail label="More experiences" size="md" desktop="grid" cols={4}>
            {experiences.map((x) => (
              <ExperienceTile key={x.href} {...x} />
            ))}
          </Rail>
        </Reveal>
      </Section>

      {/* Services: the full list from Staff → Website → Services, linked where there is a page. */}
      <Section id="services" labelledBy="services-title">
        <Reveal>
          <SectionIntro
            align="split"
            eyebrow="Services"
            id="services-title"
            title={p.servicesTitle}
            lede="The everyday things that make a stay easy — and where to find them."
          />
        </Reveal>
        <Reveal className={rhythm.afterIntro}>
          <FeatureList
            cols={3}
            items={c.services.map((s) => ({
              icon: s.icon,
              title: s.name,
              body: s.description ? f(s.description) : undefined,
              href: SERVICE_PAGES[codeOf(s.key)],
            }))}
          />
        </Reveal>
      </Section>

      {/* What next: one quiet closing moment. */}
      <Section tone="night" glow="top" width="narrow" labelledBy="hotel-cta" containerClassName="text-center">
        <Reveal>
          <Eyebrow>Book direct</Eyebrow>
          <Display as="h2" id="hotel-cta" className={cn(rhythm.afterEyebrow, "mx-auto max-w-2xl")}>
            Your room <Accent>is waiting.</Accent>
          </Display>
          <p className={cn(typeScale.lede, "mx-auto mt-5 max-w-md text-pub-muted")}>Choose your dates to see live prices for every room type.</p>
          <Actions align="center" className={rhythm.beforeActions}>
            <LinkButton href="/book" icon="arrow">Check availability</LinkButton>
            <TextLink href="/rooms">Explore rooms</TextLink>
          </Actions>
        </Reveal>
      </Section>
    </>
  );
}
