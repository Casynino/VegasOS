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
import { fill, ILLUSTRATIVE, photo, portraitFor } from "@/components/public/content";
import {
  Accent,
  Actions,
  Display,
  Eyebrow,
  HOTEL_COORDS,
  Heading,
  HudFrame,
  HudLabel,
  LinkButton,
  QuietList,
  containers,
  MediaFrame,
  Rail,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  rhythm,
  typeScale,
} from "@/components/public/kit";
import { ClosingBand } from "@/components/public/closing-band";
import { PageHero } from "@/components/public/page-hero";
import { BlueprintElevation, TitleBlock } from "@/components/public/services/blueprint-elevation";
import { ExperienceTile } from "@/components/public/services/experience-tile";
import { FeatureMoment } from "@/components/public/services/feature-moment";
import { ServiceMatrix } from "@/components/public/services/service-matrix";

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
 * the photograph · 01 the story beside the street entrance "drawn, then built" (a gold elevation that
 * a scan line turns into the photograph) with the real facts as the drawing's title block, then the
 * story photos · 02 Experiences (#experiences: the restaurant in glass over its photo, then the bar,
 * room service, the Meeting Room and airport pickup; a slow band of the hotel's offer) · 03 Services
 * (#services: every service from Staff → Website as a drafting-sheet index, linked where it has a
 * page) · a quiet closing call to book. The header's Experiences / Services links land on the anchors.
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
  const city = settings.city || "Dar es Salaam";

  // The drawing's title block: only real figures (rooms and types from the database, times from settings).
  const ledger = [
    stats.rooms > 0 && { label: "Rooms", value: String(stats.rooms) },
    stats.roomTypes > 0 && { label: "Room types", value: String(stats.roomTypes) },
    { label: "Check-in", value: `From ${w.checkInTime}` },
    { label: "Check-out", value: `By ${w.checkoutTime}` },
    { label: "Airport", value: f("About {airportKm} km") },
    settings.receptionHours && { label: "Reception", value: settings.receptionHours },
    c.services.length > 0 && { label: "Services", value: String(c.services.length) },
    { label: "City", value: city },
  ].filter((x): x is { label: string; value: string } => Boolean(x));
  const gate = photo("/images/exterior/exterior-02.webp");

  // The Meeting Room: its own first photo from the database, else the hotel's boardroom photograph.
  const meetingPhoto = (meeting ? parseImages(meeting.images)[0] : undefined) ?? "/images/meeting/meeting-01.webp";
  const pickup = transport.find((t) => t.type === "AIRPORT_PICKUP");
  const roomService = photo("/images/room-red/room-red-06.webp");
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
      image: { src: meetingPhoto, alt: `${meeting?.name ?? "Meeting Room"} at ${settings.hotelName}` },
      title: meeting?.name ?? c.pages.meeting.fallbackName,
      body: f(c.pages.meeting.fallbackDescription),
      fact: meeting ? `Up to ${meeting.maxAdults} people · ${formatTZS(meeting.baseRate)}` : undefined,
      cta: "Book the Meeting Room",
    },
    {
      href: "/transport",
      image: ILLUSTRATIVE.darCoastAerial,
      title: "Airport pickup",
      body: f(service("transfer", "airporttransfer")?.description || "Pickup by the hotel’s own drivers — about {airportKm} km from JNIA."),
      fact: pickup ? `${isFromPrice(pickup.type, pickup.options.length) ? "From " : ""}${formatTZS(pickup.price)}` : undefined,
      cta: "Request airport pickup",
    },
  ];
  // The slow band: only what the hotel really offers.
  const offer = ["Rooms & suites", "Restaurant", "Bar", "Room service", meeting?.name ?? "Meeting Room", "Airport pickup"];

  return (
    <>
      <PageHero
        kicker={p.kicker}
        title={p.title}
        image={p.image.src}
        imageAlt={p.image.alt}
        mobileImage={portraitFor(p.image.src)}
        focal="50% 40%"
        id="hotel-title"
        intro={<p>{f(p.intro)}</p>}
      >
        <Actions className="mt-7 sm:mt-8">
          <LinkButton href="/book" icon="arrow">Book your stay</LinkButton>
          <TextLink href="#about">Discover Vegas</TextLink>
        </Actions>
      </PageHero>

      {/* 01 · The story beside the entrance, drawn then built, with the facts as its title block. */}
      <Section
        id="about"
        labelledBy="about-title"
        marker={{ index: 1, label: "The hotel", aside: <HudLabel tick={false}>{HOTEL_COORDS.label}</HudLabel> }}
      >
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-10">
          <Reveal className="min-w-0 lg:col-span-4 lg:pt-2">
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
            <Actions className={rhythm.beforeActions}>
              <TextLink href="/gallery">See the gallery</TextLink>
            </Actions>
          </Reveal>

          <div className="min-w-0 lg:col-span-7 lg:col-start-6">
            <HudFrame offset="sm" size="lg">
              <BlueprintElevation src={gate.src} alt={gate.alt} coords={HOTEL_COORDS.label} />
            </HudFrame>
            <TitleBlock
              className="mt-6 sm:mt-8"
              heading={settings.hotelName}
              aside={`Mlimani City · ${city}`}
              items={ledger}
            />
          </div>
        </div>

        {p.images.length > 0 && (
          <Reveal className="mt-14 sm:mt-16 lg:mt-24">
            <Rail label="Inside the hotel" size="md" desktop={p.images.length <= 4 ? "grid" : "rail"} cols={p.images.length === 4 ? 4 : 3}>
              {p.images.map((img, i) => (
                <figure key={img.src} className="min-w-0">
                  <MediaFrame src={img.src} alt={img.alt} ratio="4/5" zoom reveal="left" sizes="(min-width: 1024px) 24vw, (min-width: 640px) 44vw, 76vw" />
                  <figcaption className="mt-3 flex items-baseline gap-3">
                    <span className="font-mono text-[10px] font-medium tracking-[0.2em] text-pub-eyebrow">FIG. {String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 text-[13px] leading-snug text-pub-muted">{img.alt}</span>
                  </figcaption>
                </figure>
              ))}
            </Rail>
          </Reveal>
        )}
      </Section>

      {/* 02 · Experiences: the restaurant in glass over its photo, the rest in a rail, then the offer as a slow band. */}
      <Section
        id="experiences"
        tone="night"
        glow="sky"
        labelledBy="experiences-title"
        className="pb-12 sm:pb-14 lg:pb-16"
        marker={{ index: 2, label: "Experiences", aside: <HudLabel tick={false}>{String(experiences.length + 1).padStart(2, "0")} to discover</HudLabel> }}
      >
        <Reveal>
          <SectionIntro
            align="split"
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
            hud={`01 / ${String(experiences.length + 1).padStart(2, "0")} · On site`}
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
            {experiences.map((x, i) => (
              <ExperienceTile key={x.href} {...x} index={i + 2} total={experiences.length + 1} />
            ))}
          </Rail>
        </Reveal>
      </Section>

      {/* The hotel's offer as a slow outline band, between the night of Experiences and the drafting sheet of Services. */}
      <Section tone="night" width="bleed" space="none" atmosphere="calm" pattern="none" as="div" className="pb-10 sm:pb-14">
        <div className={cn(containers.default, "border-y border-pub-line py-6 sm:py-7")}><QuietList items={offer} label="What the hotel offers" /></div>
      </Section>

      {/* 03 · Services: the full list from Staff → Website → Services, as a drafting-sheet index. */}
      <Section
        id="services"
        tone="deep"
        pattern="grid"
        labelledBy="services-title"
        marker={{ index: 3, label: "Services", aside: <HudLabel tick={false}>{String(c.services.length).padStart(2, "0")} services</HudLabel> }}
      >
        <Reveal>
          <SectionIntro
            align="split"
            id="services-title"
            title={p.servicesTitle}
            lede="The everyday things that make a stay easy — and where to find them."
          />
        </Reveal>
        <Reveal className={rhythm.afterIntro}>
          <ServiceMatrix
            items={c.services.map((s) => ({
              icon: s.icon,
              title: s.name,
              body: s.description ? f(s.description) : undefined,
              href: SERVICE_PAGES[codeOf(s.key)],
            }))}
          />
        </Reveal>
      </Section>

      {/* What next: the closing moment over the hotel's own facade. */}
      <ClosingBand image="/images/exterior/exterior-04.webp" focal="50% 45%" labelledBy="hotel-cta">
        <Eyebrow>Book direct</Eyebrow>
        <Display as="h2" id="hotel-cta" className={cn(rhythm.afterEyebrow, "mx-auto max-w-2xl")}>
          Your room <Accent>is waiting.</Accent>
        </Display>
        <p className={cn(typeScale.lede, "mx-auto mt-5 max-w-md text-pub-muted")}>Choose your dates to see live prices for every room type.</p>
        <Actions align="center" className={rhythm.beforeActions}>
          <LinkButton href="/book" icon="arrow">Check availability</LinkButton>
          <TextLink href="/rooms">Explore rooms</TextLink>
        </Actions>
      </ClosingBand>
    </>
  );
}
