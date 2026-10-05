import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { bookingWindow, listPublicRoomTypes, parseImages, publicStats, tonightAvailability, websitePricer } from "@/server/services/public-booking";
import { publicMeetingRoom } from "@/server/services/booking-requests";
import { getSiteContent } from "@/server/services/site-content";
import { transportServices } from "@/server/services/transport";
import { getHotelWeather } from "@/server/services/weather";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { contentVars, telHref, whatsappHref } from "@/components/public/contact";
import { fill, ILLUSTRATIVE, photo } from "@/components/public/content";
import { HotelJsonLd } from "@/components/public/hotel-jsonld";
import {
  Accent,
  Actions,
  Display,
  EditorialSplit,
  Eyebrow,
  Heading,
  InfoList,
  Lede,
  LinkButton,
  MediaFrame,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  containers,
  focusRing,
  measure,
  rhythm,
  typeScale,
  type InfoItem,
} from "@/components/public/kit";
import { BlueprintReveal } from "@/components/public/cinema/blueprint-reveal";
import { BookingSheet, HeroBookingBar } from "@/components/public/cinema/booking-bar";
import { GalleryRail } from "@/components/public/cinema/gallery-rail";
import { CinematicHero } from "@/components/public/cinema/hero";
import { LocalTime } from "@/components/public/cinema/local-time";
import { DiningList } from "@/components/public/home/dining-list";
import { RoomsShowcase, type ShowcaseRoom } from "@/components/public/home/rooms-showcase";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getSiteContent();
  const og = c.seo.ogImage;
  return {
    title: { absolute: c.seo.homeTitle },
    description: c.seo.homeDescription,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      title: c.seo.homeTitle,
      description: c.seo.homeDescription,
      images: [{ url: og.src, width: og.width, height: og.height, alt: og.alt }],
    },
  };
}

/** The hotel's own photographs for the home gallery rail (never stock). */
const GALLERY_PHOTOS = [
  "/images/room-blue/room-blue-04.webp",
  "/images/bath/bath-08.webp",
  "/images/room-red/room-red-07.webp",
  "/images/lobby/lobby-01.webp",
  "/images/amenity/amenity-01.webp",
  "/images/room-blue/room-blue-06.webp",
  "/images/bath/bath-02.webp",
  "/images/room-red/room-red-03.webp",
];

/** Small dish and drink photos for the dining rows — free-licence (CC0) menu photos, labelled illustrative. */
const DINING_PHOTOS = {
  restaurant: "/images/menu/mi_local_favorites_nyama_choma_beef.webp",
  roomService: "/images/menu/mi_breakfast_vegas_english_breakfast.webp",
  drinks: "/images/menu/mi_wines_robertson_red.webp",
};

/** The suite has the strongest photography, so it leads; the other types keep their order. */
const LEAD_SLUG = "executive-suite";

/**
 * Home — one story, about nine phone screens: the hotel (cinematic hero, then a short story with
 * the building drawn and revealed), rooms (one featured type, the others in a rail), the
 * experience beyond the room (dining), services (meeting room, airport pickup), a look inside
 * and a closing invitation to book. Live data only: tonight's availability and website prices,
 * room facts, meeting room and pickup prices, local time and weather — never invented numbers.
 */
export default async function HomePage() {
  const [settings, roomTypes, stats, c, meeting, transport] = await Promise.all([
    getSettings(),
    listPublicRoomTypes(),
    publicStats(),
    getSiteContent(),
    publicMeetingRoom(),
    transportServices({ publicOnly: true }),
  ]);
  const price = await websitePricer(settings);
  // tonightAvailability() refreshes booking holds first — it stays here, in the server render.
  const [tonight, weather] = await Promise.all([tonightAvailability(settings), getHotelWeather()]);
  const h = c.home;
  const bw = bookingWindow(settings);
  const vars = contentVars(settings, { airportKm: c.facts.airportKm, rooms: stats.rooms, roomTypes: stats.roomTypes });
  const f = (s: string) => fill(s, vars);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.vegasluxuryhotel.co.tz";
  const initialTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

  // Rooms: types only, priced by the website engine, with tonight's live count per type.
  const freeTonight = new Map(tonight.types.map((t) => [t.slug, t.free]));
  const rooms: ShowcaseRoom[] = roomTypes
    .map((t) => {
      const p = price(t);
      return {
        slug: t.slug,
        name: t.name,
        shortDescription: t.shortDescription ?? t.description,
        image: t.images[0],
        maxAdults: t.maxAdults,
        maxChildren: t.maxChildren,
        bedType: t.bedType,
        sizeSqm: t.sizeSqm,
        baseRate: p.baseRate,
        net: p.net,
        promo: p.promoLabel,
        amenities: t.amenities,
        tonightFree: bw.enabled ? (freeTonight.get(t.slug) ?? 0) : null,
      };
    })
    .sort((a, b) => Number(b.slug === LEAD_SLUG) - Number(a.slug === LEAD_SLUG));
  const search = {
    minDate: bw.today,
    maxDate: bw.maxArrival,
    maxNights: bw.maxNights,
    defaultCheckIn: bw.today,
    roomTypes: roomTypes.map((t) => ({ slug: t.slug, name: t.name })),
  };

  const storyFacts: InfoItem[] = [
    ...(stats.rooms > 0 ? [{ label: `${stats.rooms} rooms` }] : []),
    ...(stats.roomTypes > 1 ? [{ label: `${stats.roomTypes} room types` }] : []),
    ...(settings.receptionHours ? [{ label: `Reception ${settings.receptionHours}` }] : []),
  ];

  // Meeting Room: the room type's own photo once the hotel adds one (stock until then, tagged).
  const meetingPhoto = (meeting ? parseImages(meeting.images)[0] : undefined) ?? ILLUSTRATIVE.meetingRoom.src;
  const meetingAlt = Object.values(ILLUSTRATIVE).find((i) => i.src === meetingPhoto)?.alt ?? `The Meeting Room at ${settings.hotelName}`;

  // Airport pickup price from the transport services shown on the website.
  const pickup = transport.find((s) => s.type === "AIRPORT_PICKUP");
  const pickupPrices = pickup ? [pickup.price, ...pickup.options.map((o) => o.price)].filter((p) => p > 0) : [];
  const arrivalFacts: InfoItem[] = [
    ...(pickupPrices.length ? [{ label: "Airport pickup", value: `${pickupPrices.length > 1 ? "From " : ""}${formatTZS(Math.min(...pickupPrices))}` }] : []),
    { label: "From the airport", value: `About ${c.facts.airportKm} km` },
    { label: "Find us", value: f(h.location.title) },
  ];

  // What every stay includes (CMS title and features), without payment promises — the booking flow explains paying.
  const included = h.experience.features
    .filter((x) => x.icon !== "Wallet" && !/\bpay/i.test(x.title))
    .slice(0, 4)
    .map((x) => ({ label: x.title }));

  const gallery = GALLERY_PHOTOS.map((src) => {
    const g = photo(src);
    return { src: g.src, alt: g.alt, width: g.width, height: g.height };
  });

  const paused = (
    <div id="availability" className="mt-8 max-w-md scroll-mt-header">
      <p className="text-[15px] leading-relaxed text-pub-muted">Online requests are paused — our front desk will book your room directly.</p>
      <Actions className="mt-5">
        {settings.phone && <LinkButton href={telHref(settings.phone)}>Call to book</LinkButton>}
        {settings.whatsapp && (
          <LinkButton
            href={whatsappHref(settings.whatsapp, "Hello, I would like to book a room.")}
            variant={settings.phone ? "glass" : "primary"}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp<span className="sr-only"> (opens in a new tab)</span>
          </LinkButton>
        )}
        {!settings.phone && !settings.whatsapp && <LinkButton href="/contact?subject=booking">Contact the hotel</LinkButton>}
      </Actions>
    </div>
  );

  return (
    <>
      <HotelJsonLd settings={settings} baseUrl={baseUrl} content={c} />

      {/* ═════════════ 1. Hero — the hotel, one line, Check availability ═════════════ */}
      <CinematicHero
        labelledBy="hero-title"
        slides={h.hero.slides}
        footer={
          bw.enabled ? (
            // Desktop: the slim search bar. Phones and tablets use the sheet behind the hero button.
            <div id="availability" className={cn(containers.wide, "hidden scroll-mt-header pb-10 lg:block")}>
              <HeroBookingBar {...search} />
            </div>
          ) : undefined
        }
      >
        <div
          className={cn(
            containers.wide,
            "flex flex-1 flex-col justify-end pb-[calc(2.75rem+env(safe-area-inset-bottom))] pt-[calc(var(--pub-header-h)+3rem)] sm:pb-16 lg:pb-12",
          )}
        >
          <div className="lg:flex lg:items-end lg:justify-between lg:gap-12">
            <div className="max-w-3xl">
              <Eyebrow rule>{c.facts.locationLine}</Eyebrow>
              <Display id="hero-title" className="mt-5 sm:mt-6">
                {settings.hotelName}
              </Display>
              <p className={cn(typeScale.subheading, "mt-4 text-pub-fg")}>
                {f(h.hero.title)} <Accent>{f(h.hero.titleAccent)}</Accent>
              </p>
              <p className={cn(typeScale.lede, "mt-4 hidden max-w-md text-pub-muted sm:block")}>{f(h.hero.intro)}</p>

              {bw.enabled ? (
                <Actions className="mt-8">
                  <BookingSheet label={h.hero.primaryCta.label || "Check availability"} className="lg:hidden" {...search} />
                  <TextLink href="#rooms">{h.hero.secondaryCta.label || "Explore rooms"}</TextLink>
                </Actions>
              ) : (
                paused
              )}

              {bw.enabled && tonight.fromNet !== null && tonight.totalFree > 0 && (
                <p className={cn(typeScale.meta, "mt-6 flex items-center gap-2.5 text-pub-muted lg:mt-5")}>
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
                  Tonight from <span className="text-pub-fg">{formatTZS(tonight.fromNet)}</span>
                </p>
              )}
            </div>

            {/* Desktop: the hotel's local time and weather, quietly. */}
            <div className="hidden shrink-0 pb-1 text-right lg:block">
              <p className={cn(typeScale.meta, "text-pub-muted")}>Dar es Salaam</p>
              <LocalTime initial={initialTime} className="mt-2 block font-display text-[2.25rem] leading-none text-pub-fg tabular-nums" />
              <p className={cn(typeScale.meta, "mt-3 text-pub-muted")}>
                {weather ? `${weather.temp}°C · ${weather.label}` : `Check-in from ${bw.checkInTime}`}
              </p>
            </div>
          </div>
        </div>
      </CinematicHero>

      {/* ═════════════ 2. The hotel — a short story; the building drawn, then revealed ═════════════ */}
      <Section tone="paper" id="hotel" labelledBy="intro-title">
        <EditorialSplit
          layout="text-wide"
          reverse
          textFirst
          media={
            <BlueprintReveal
              src={h.intro.insetImage.src}
              alt={h.intro.insetImage.alt}
              sizes="(min-width: 1024px) 40vw, 100vw"
              ratio="4/3"
              ratioLg="4/5"
              focal="55% 50%"
              label="Elevation · Mlimani City"
              coords="6.7726° S · 39.2310° E"
            />
          }
        >
          <Reveal>
            <Eyebrow>{h.intro.kicker}</Eyebrow>
            <Heading id="intro-title" className={rhythm.afterEyebrow}>
              {h.intro.title} <Accent>{h.intro.titleAccent}</Accent>
            </Heading>
            <div className={cn(rhythm.afterHeading, measure.body, typeScale.body, "space-y-3 text-pub-muted")}>
              {h.intro.paragraphs.map((p) => (
                <p key={p}>{f(p)}</p>
              ))}
            </div>
            <InfoList items={storyFacts} className="mt-6" />
            <Actions className={rhythm.beforeActions}>
              <TextLink href="/hotel">Discover Vegas</TextLink>
            </Actions>
          </Reveal>
        </EditorialSplit>
      </Section>

      {/* ═════════════ 3. Rooms — one type large, the others in a rail ═════════════ */}
      <Section tone="deep" id="rooms" labelledBy="rooms-title">
        <Reveal>
          <SectionIntro
            align="split"
            eyebrow={h.rooms.kicker}
            title={h.rooms.title}
            id="rooms-title"
            lede={f(h.rooms.intro)}
            actions={<TextLink href="/rooms">Compare all rooms</TextLink>}
          />
        </Reveal>
        {rooms.length > 0 ? (
          <div className={rhythm.afterIntro}>
            <RoomsShowcase rooms={rooms} />
          </div>
        ) : (
          <div className={rhythm.afterIntro}>
            <Lede>Room information is being updated — please contact us to book.</Lede>
            <Actions className="mt-5">
              <TextLink href="/contact?subject=booking">Contact the front desk</TextLink>
            </Actions>
          </div>
        )}
      </Section>

      {/* ═════════════ 4. More than a room — dining: restaurant, room service, drinks ═════════════ */}
      <Section tone="night" id="dining" glow="top" labelledBy="dining-title">
        <Reveal>
          <SectionIntro
            align="split"
            eyebrow={h.stay.kicker}
            title={
              <>
                More than <Accent>a room</Accent>
              </>
            }
            id="dining-title"
            lede={`${f(h.stay.title)} ${f(h.stay.titleAccent)}`}
          />
        </Reveal>
        <EditorialSplit
          className={rhythm.afterIntro}
          layout="media-wide"
          media={
            <MediaFrame
              src={ILLUSTRATIVE.restaurantWarm.src}
              alt={ILLUSTRATIVE.restaurantWarm.alt}
              ratio="3/2"
              ratioLg="5/4"
              sizes="(min-width: 1024px) 56vw, 100vw"
              zoom
            />
          }
        >
          <Reveal>
            <Eyebrow>{h.restaurant.kicker}</Eyebrow>
            <Heading as="h3" size="subheading" className={rhythm.afterEyebrow}>
              {h.restaurant.title} <Accent>{h.restaurant.titleAccent}</Accent>
            </Heading>
            <p className={cn(typeScale.body, "mt-3 text-pub-muted")}>{f(h.restaurant.body)}</p>
            <DiningList
              className="mt-7"
              note="Dish photos are illustrative"
              items={[
                {
                  title: "Restaurant",
                  body: "Breakfast to dinner, African favourites to the grill.",
                  href: h.restaurant.cta.href,
                  image: DINING_PHOTOS.restaurant,
                  hours: settings.restaurantHours,
                },
                {
                  title: "Room service",
                  body: "Staying with us? Order from the QR card in your room.",
                  href: "/restaurant#room-service",
                  image: DINING_PHOTOS.roomService,
                },
                {
                  title: "Drinks",
                  body: f(h.bar.body),
                  href: h.bar.cta.href,
                  image: DINING_PHOTOS.drinks,
                  hours: settings.barHours,
                },
              ]}
            />
            <Actions className={rhythm.beforeActions}>
              <LinkButton href="/menu" icon="arrow">
                Explore the menu
              </LinkButton>
            </Actions>
          </Reveal>
        </EditorialSplit>
      </Section>

      {/* ═════════════ 5. Services — the Meeting Room, airport pickup ═════════════ */}
      <Section tone="paper" labelledBy="services-title">
        <div className="border-b border-pub-line pb-5">
          <Eyebrow as="h2" rule>
            <span id="services-title">At your service</span>
          </Eyebrow>
        </div>

        <EditorialSplit
          className="mt-10 sm:mt-12 lg:mt-16"
          layout="balanced"
          media={<MediaFrame src={meetingPhoto} alt={meetingAlt} ratio="3/2" ratioLg="5/4" sizes="(min-width: 1024px) 48vw, 100vw" zoom />}
        >
          <Reveal>
            <Eyebrow>{h.meeting.title}</Eyebrow>
            <Heading as="h3" className={rhythm.afterEyebrow}>
              Meet <Accent>differently</Accent>
            </Heading>
            <Lede className={rhythm.afterHeading}>{f(h.meeting.body)}</Lede>
            {meeting && (
              <InfoList
                variant="rows"
                className="mt-7"
                items={[
                  { label: "Capacity", value: `Up to ${meeting.maxAdults} people` },
                  { label: "Price", value: `${formatTZS(meeting.baseRate)} per booking` },
                ]}
              />
            )}
            <InfoList items={h.meeting.events.map((e) => ({ label: e }))} className="mt-5" />
            <Actions className={rhythm.beforeActions}>
              <LinkButton href={h.meeting.primaryCta.href} icon="arrow">
                Book the Meeting Room
              </LinkButton>
            </Actions>
          </Reveal>
        </EditorialSplit>

        {/* Arrival: one quiet row — the gate (small), the facts and the pickup request. Not another story. */}
        <Reveal className="mt-14 grid gap-6 border-t border-pub-line pt-8 sm:mt-16 lg:mt-20 lg:grid-cols-12 lg:items-center lg:gap-x-10 lg:pt-10">
          <div className="flex min-w-0 items-center gap-4 sm:gap-5 lg:col-span-4">
            <MediaFrame src={h.location.image.src} alt={h.location.image.alt} ratio="1/1" focal="72% 55%" sizes="96px" className="w-20 shrink-0 sm:w-24" />
            <div className="min-w-0">
              <Eyebrow>Airport transport</Eyebrow>
              <Heading as="h3" size="item" className="mt-2">
                Arrive without <Accent>the stress</Accent>
              </Heading>
            </div>
          </div>
          <InfoList variant="rows" items={arrivalFacts} className="lg:col-span-5" />
          <div className="lg:col-span-3 lg:justify-self-end">
            <LinkButton href="/transport#request" variant="secondary" icon="arrow">
              Request airport pickup
            </LinkButton>
          </div>
        </Reveal>
      </Section>

      {/* ═════════════ 6. A look inside — the hotel's own photographs ═════════════ */}
      <Section tone="deep" labelledBy="gallery-title">
        <Reveal>
          <SectionIntro
            align="split"
            eyebrow={h.gallery.kicker}
            title={h.gallery.title}
            id="gallery-title"
            lede="Every photograph here is of our hotel."
            actions={<TextLink href="/gallery">Open the gallery</TextLink>}
          />
        </Reveal>
        <div className={rhythm.afterIntro}>
          <GalleryRail images={gallery} label="Photographs of the hotel" />
        </div>
      </Section>

      {/* ═════════════ 7. Book — the closing moment ═════════════ */}
      <section aria-labelledby="cta-title" data-tone="night" className="relative isolate overflow-hidden bg-night text-pub-fg">
        <MediaFrame src={h.cta.image.src} alt={h.cta.image.alt} ratio="fill" focal="50% 55%" sizes="100vw" />
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_55%,rgb(12_10_7/0.58),rgb(12_10_7/0.88))]" />
        <Reveal className={cn(containers.narrow, "relative flex flex-col items-center py-24 text-center sm:py-32 lg:py-40")}>
          <Eyebrow>{h.cta.kicker}</Eyebrow>
          <Display as="h2" id="cta-title" className={rhythm.afterEyebrow}>
            {h.cta.title} <Accent>{h.cta.titleAccent}</Accent>
          </Display>
          <Lede className={rhythm.afterHeading}>Choose your dates to see live availability and prices.</Lede>
          <Actions align="center" className={rhythm.beforeActions}>
            <LinkButton href="/book" size="lg" icon="arrow">
              Book your stay
            </LinkButton>
            <LinkButton href="/contact" variant="glass" size="lg">
              Contact the hotel
            </LinkButton>
          </Actions>
          {included.length > 0 && (
            <div className="mt-10">
              {h.experience.title && <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>{h.experience.title}</p>}
              <InfoList items={included} className="mt-3 justify-center" />
            </div>
          )}
          {(settings.phone || settings.whatsapp) && (
            <p className={cn(typeScale.meta, "mt-2 flex flex-wrap items-center justify-center gap-x-5 text-pub-muted")}>
              {settings.phone && (
                <a href={telHref(settings.phone)} className={cn("inline-flex min-h-11 items-center rounded-sm transition-colors duration-200 hover:text-pub-eyebrow motion-reduce:transition-none", focusRing)}>
                  Call {settings.phone}
                </a>
              )}
              {settings.whatsapp && (
                <a
                  href={whatsappHref(settings.whatsapp, "Hello, I would like to book a room.")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("inline-flex min-h-11 items-center rounded-sm transition-colors duration-200 hover:text-pub-eyebrow motion-reduce:transition-none", focusRing)}
                >
                  WhatsApp<span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </p>
          )}
        </Reveal>
      </section>
    </>
  );
}
