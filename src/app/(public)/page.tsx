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
import { fill, GALLERY, ILLUSTRATIVE, photo } from "@/components/public/content";
import { HotelJsonLd } from "@/components/public/hotel-jsonld";
import { MAP_LINK_URL } from "@/components/public/site-config";
import {
  Accent,
  Actions,
  Atmosphere,
  Display,
  Eyebrow,
  GlassPanel,
  HOTEL_COORDS,
  Heading,
  HudFrame,
  HudLabel,
  InfoList,
  Lede,
  LinkButton,
  Marquee,
  MediaFrame,
  Reveal,
  Section,
  SectionIndex,
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
import { DiningDepth } from "@/components/public/home/dining-depth";
import { DiningList } from "@/components/public/home/dining-list";
import { LocationDive } from "@/components/public/home/location-dive";
import { RoomsShowcase, type ShowcaseRoom } from "@/components/public/home/rooms-showcase";
import css from "@/components/public/home/home.module.css";

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
  "/images/room-red/room-red-08.webp",
  "/images/amenity/amenity-02.webp",
  "/images/bath/bath-08.webp",
  "/images/exterior/exterior-04.webp",
  "/images/room-red/room-red-10.webp",
  "/images/lobby/lobby-01.webp",
  "/images/amenity/amenity-03.webp",
  "/images/room-blue/room-blue-04.webp",
  "/images/bath/bath-18.webp",
];

/** Small dish and drink photos for the dining rows — free-licence (CC0) menu photos, labelled illustrative. */
const DINING_PHOTOS = {
  restaurant: "/images/menu/mi_local_favorites_nyama_choma_beef.webp",
  roomService: "/images/menu/mi_breakfast_vegas_english_breakfast.webp",
  drinks: "/images/menu/mi_wines_robertson_red.webp",
};

/** The hotel's street entrance (its own photograph) — where the location dive lands. */
const STREET_PHOTO = { src: "/images/exterior/exterior-02.webp", alt: "Street entrance of Vegas Luxury Hotel with its gold arch gate" };

/** The suite has the strongest photography, so it leads; the other types keep their order. */
const LEAD_SLUG = "executive-suite";

/**
 * Home — one story in about ten phone screens, each band with one cinematic device: the hero
 * (layered parallax photo, live HUD, glass search), the hotel's offer as a slow outline band and
 * its building drawn then revealed, the lead room type with its spec sheet in glass over the
 * photograph, dining in depth, the Meeting Room, a short satellite dive to the hotel's street with
 * the arrival facts, a look inside in HUD frames, and a closing invitation to book under moving
 * light. Live data only: tonight's availability and website prices, room facts, meeting room and
 * pickup prices, local time, weather and the hotel's real coordinates — never invented numbers.
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
  const city = settings.city ?? "Dar es Salaam";

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

  // Meeting Room: the room type's own first photo, else the hotel's boardroom photograph (stock stays tagged).
  const meetingPhoto = (meeting ? parseImages(meeting.images)[0] : undefined) ?? "/images/meeting/meeting-01.webp";
  const meetingAlt =
    [...Object.values(ILLUSTRATIVE), ...GALLERY].find((i) => i.src === meetingPhoto)?.alt ?? `The Meeting Room at ${settings.hotelName}`;

  // Airport pickup price from the transport services shown on the website.
  const pickup = transport.find((s) => s.type === "AIRPORT_PICKUP");
  const pickupPrices = pickup ? [pickup.price, ...pickup.options.map((o) => o.price)].filter((p) => p > 0) : [];
  const arrivalFacts: InfoItem[] = [
    ...(pickupPrices.length ? [{ label: "Airport pickup", value: `${pickupPrices.length > 1 ? "From " : ""}${formatTZS(Math.min(...pickupPrices))}` }] : []),
    { label: "From the airport", value: `About ${c.facts.airportKm} km` },
  ];

  // The hotel's offer, as words for the outline band (CMS features without payment promises + real services).
  const offer = [
    ...h.experience.features.filter((x) => x.icon !== "Wallet" && !/\bpay/i.test(x.title)).map((x) => x.title),
    "Restaurant & bar",
    ...(meeting ? ["Meeting Room"] : []),
    ...(pickup ? ["Airport pickup"] : []),
  ].filter((w, i, all) => all.indexOf(w) === i);

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
            variant={settings.phone ? "text" : "primary"}
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

      {/* ═════════════ 1. Hero — the hotel, one line, Check availability, live HUD ═════════════ */}
      <CinematicHero
        labelledBy="hero-title"
        slides={h.hero.slides}
        hud={{ place: city, initialTime, temp: weather ? `${weather.temp}°C` : null, coords: HOTEL_COORDS.label }}
        footer={
          bw.enabled ? (
            // Desktop: the slim glass search bar. Phones and tablets use the sheet behind the hero button.
            <div id="availability" className={cn(containers.wide, "hidden scroll-mt-header pb-10 lg:block")}>
              <HeroBookingBar {...search} />
            </div>
          ) : undefined
        }
      >
        <div
          className={cn(
            containers.wide,
            "flex flex-1 flex-col justify-end pb-[calc(2.75rem+env(safe-area-inset-bottom))] pt-8 sm:pb-16 lg:pb-12 lg:pt-[calc(var(--pub-header-h)+3rem)]",
          )}
        >
          <div className="lg:flex lg:items-end lg:justify-between lg:gap-12">
            <div className="max-w-3xl">
              {/* One line down to 320px: tighter tracking and no rule on the smallest phones. */}
              <Eyebrow rule className="whitespace-nowrap max-[359px]:text-[10px] max-[359px]:tracking-[0.16em] max-[359px]:before:hidden">
                {c.facts.locationLine}
              </Eyebrow>
              <Display id="hero-title" className={cn("mt-5 sm:mt-6", css.sheen)}>
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
                <HudLabel as="p" live className="mt-6 text-pub-muted lg:mt-5">
                  Tonight from <span className="ml-1 text-pub-fg">{formatTZS(tonight.fromNet)}</span>
                </HudLabel>
              )}
            </div>

            {/* Desktop: the hotel's live local time and weather, as a HUD readout. */}
            <div className="hidden shrink-0 flex-col items-end gap-3 pb-1 text-right lg:flex">
              <HudLabel live className="text-white/75">
                Local time · {city}
              </HudLabel>
              <LocalTime initial={initialTime} className="block font-display text-[3.25rem] leading-none text-pub-fg tabular-nums" />
              <HudLabel tick={false} className="text-white/75">
                {weather ? `${weather.temp}°C · ${weather.label}` : `Check-in from ${bw.checkInTime}`}
              </HudLabel>
              <span aria-hidden="true" className="mt-1 h-px w-36 bg-linear-to-l from-gold/80 to-transparent" />
            </div>
          </div>
        </div>
      </CinematicHero>

      {/* ═════════════ 2. The hotel — its offer in a slow band, then the building drawn and revealed ═════════════ */}
      <Section tone="paper" id="hotel" labelledBy="intro-title" width="bleed" space="none" className="pb-12 sm:pb-20 lg:pb-28">
        <Marquee items={offer} size="md" duration={70} label={offer.join(", ")} className="border-b border-pub-line py-4 sm:py-6" />
        <div className={cn(containers.default, "pt-10 sm:pt-16 lg:pt-24")}>
          <SectionIndex index={1} label="The hotel" aside={<HudLabel>{HOTEL_COORDS.label}</HudLabel>} className="mb-8 sm:mb-10 lg:mb-14" />
          <div className="grid gap-10 sm:gap-12 lg:grid-cols-12 lg:items-center lg:gap-x-10">
            <Reveal className="min-w-0 lg:col-span-5">
              <Eyebrow>{h.intro.kicker}</Eyebrow>
              <Heading id="intro-title" className={rhythm.afterEyebrow}>
                {h.intro.title} <Accent>{h.intro.titleAccent}</Accent>
              </Heading>
              <div className={cn(rhythm.afterHeading, measure.body, typeScale.body, "space-y-3 text-pub-muted")}>
                {h.intro.paragraphs.map((p, i) => (
                  <p key={p} className={cn(i > 0 && "hidden sm:block")}>
                    {f(p)}
                  </p>
                ))}
              </div>
              <InfoList items={storyFacts} className="mt-6" />
              <Actions className={rhythm.beforeActions}>
                <TextLink href="/hotel">Discover Vegas</TextLink>
              </Actions>
            </Reveal>
            <BlueprintReveal
              className="min-w-0 lg:col-span-7"
              src={h.intro.insetImage.src}
              alt={h.intro.insetImage.alt}
              sizes="(min-width: 1280px) 760px, (min-width: 1024px) 56vw, 100vw"
              ratio="4/5"
              ratioSm="4/3"
              ratioLg="5/4"
              focal="50% 40%"
              target={{ x: 46, y: 44 }}
              title={settings.hotelName}
              place={`Street elevation · ${c.facts.locationLine.split(" · ")[0] ?? city}`}
              coords={HOTEL_COORDS.label}
            />
          </div>
        </div>
      </Section>

      {/* ═════════════ 3. Rooms — the lead type with its spec sheet in glass, the others in a rail ═════════════ */}
      <Section
        tone="deep"
        id="rooms"
        labelledBy="rooms-title"
        className="py-12 sm:py-20 lg:py-28"
        marker={{ index: 2, label: h.rooms.kicker, aside: stats.roomTypes > 1 ? <HudLabel>{stats.roomTypes} room types</HudLabel> : undefined }}
      >
        <Reveal>
          <SectionIntro align="split" title={h.rooms.title} id="rooms-title" lede={f(h.rooms.intro)} actions={<TextLink href="/rooms">Compare all rooms</TextLink>} />
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

      {/* ═════════════ 4. More than a room — dining in depth: restaurant, room service, drinks ═════════════ */}
      <Section tone="night" id="dining" labelledBy="dining-title" className="py-12 sm:py-20 lg:py-28" marker={{ index: 3, label: "Dining", aside: <HudLabel>Restaurant · Bar · Room service</HudLabel> }}>
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
        <div className={cn(rhythm.afterIntro, "grid gap-12 sm:gap-14 lg:grid-cols-12 lg:items-center lg:gap-x-10")}>
          <DiningDepth
            className="min-w-0 lg:col-span-6"
            main={{ src: ILLUSTRATIVE.restaurantWarm.src, alt: ILLUSTRATIVE.restaurantWarm.alt }}
            inset={{ src: ILLUSTRATIVE.barMartini.src, alt: ILLUSTRATIVE.barMartini.alt }}
          />
          <Reveal className="min-w-0 lg:col-span-5 lg:col-start-8">
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
        </div>
      </Section>

      {/* ═════════════ 5. The Meeting Room ═════════════ */}
      <Section
        tone="paper"
        labelledBy="meeting-title"
        className="py-12 sm:py-20 lg:py-28"
        marker={{ index: 4, label: h.meeting.kicker, aside: meeting ? <HudLabel>Up to {meeting.maxAdults} people</HudLabel> : undefined }}
      >
        <div className="grid gap-10 sm:gap-12 lg:grid-cols-12 lg:items-center lg:gap-x-10">
          <HudFrame className="min-w-0 lg:col-span-6 lg:col-start-7 lg:row-start-1" offset="sm">
            <MediaFrame src={meetingPhoto} alt={meetingAlt} ratio="3/2" ratioLg="5/4" sizes="(min-width: 1024px) 46vw, 100vw" reveal="left" zoom />
          </HudFrame>
          <Reveal className="min-w-0 lg:col-span-5 lg:row-start-1">
            <Eyebrow>{h.meeting.title}</Eyebrow>
            <Heading id="meeting-title" className={rhythm.afterEyebrow}>
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
        </div>
      </Section>

      {/* ═════════════ 6. Where we are — a short satellite dive to the hotel's street, arrival facts ═════════════ */}
      <section aria-labelledby="location-title" data-tone="night" className="relative isolate bg-night text-pub-fg">
        <Atmosphere tone="night" pattern="contour" />
        <LocationDive
          aerial={{ src: ILLUSTRATIVE.darCityAerial.src, alt: ILLUSTRATIVE.darCityAerial.alt }}
          street={STREET_PHOTO}
          places={[city, c.facts.locationLine.split(" · ")[0] ?? "Mlimani City", settings.hotelName]}
          coords={HOTEL_COORDS.label}
        >
          <GlassPanel variant="dense" padding="md">
            <SectionIndex index={5} label="Location" />
            <Heading id="location-title" size="subheading" className="mt-5">
              {f(h.location.title)}
            </Heading>
            <InfoList variant="rows" items={arrivalFacts} className="mt-5 hidden sm:block" />
            <InfoList items={arrivalFacts.map((x) => ({ label: <>{x.label} <span className="text-pub-fg">{x.value}</span></> }))} className="mt-4 sm:hidden" />
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 sm:mt-6">
              <LinkButton href="/transport#request" icon="arrow" size="sm">
                Request airport pickup
              </LinkButton>
              <TextLink href={MAP_LINK_URL} target="_blank" rel="noopener noreferrer">
                Directions<span className="sr-only"> (opens Google Maps in a new tab)</span>
              </TextLink>
            </div>
          </GlassPanel>
        </LocationDive>
      </section>

      {/* ═════════════ 7. A look inside — the hotel's own photographs ═════════════ */}
      <Section tone="deep" labelledBy="gallery-title" className="py-12 sm:py-20 lg:py-28" marker={{ index: 6, label: h.gallery.kicker, aside: <HudLabel>{gallery.length} photographs</HudLabel> }}>
        <Reveal>
          <SectionIntro
            align="split"
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

      {/* ═════════════ 8. Book — the closing moment, under moving light ═════════════ */}
      <section aria-labelledby="cta-title" data-tone="night" className="relative isolate overflow-hidden bg-night text-pub-fg">
        <MediaFrame src={h.cta.image.src} alt={h.cta.image.alt} ratio="fill" focal="50% 55%" sizes="100vw" parallax={8} className="-z-10" imgClassName="opacity-35 saturate-[0.6]" />
        <div aria-hidden="true" className="absolute inset-0 -z-[5] bg-[radial-gradient(110%_85%_at_50%_50%,rgb(12_10_7/0.4),rgb(12_10_7/0.94))]" />
        <div aria-hidden="true" data-live-watch="" suppressHydrationWarning className={cn(css.aurora, "-z-[4]")} />
        {/* No line work over the photograph: light and star dust only. */}
        <Atmosphere tone="night" pattern="none" stars />
        <span
          aria-hidden="true"
          className="pub-hud-corners hidden sm:block"
          style={{ inset: "1.5rem", "--hud-l": "1.375rem", "--hud-c": "rgb(240 214 160 / 0.5)" } as React.CSSProperties}
        />
        <Reveal className={cn(containers.narrow, "relative flex flex-col items-center py-24 text-center sm:py-32 lg:py-40")}>
          {/* "Live" only when it is: rooms really are free tonight. */}
          {bw.enabled && tonight.totalFree > 0 ? (
            <HudLabel live className="text-white/75">
              Rooms available tonight
            </HudLabel>
          ) : (
            <Eyebrow>{h.cta.kicker}</Eyebrow>
          )}
          <Display as="h2" id="cta-title" className="mt-6">
            {h.cta.title} <Accent>{h.cta.titleAccent}</Accent>
          </Display>
          <Lede className={rhythm.afterHeading}>Choose your dates to see live availability and prices.</Lede>
          <Actions align="center" className={rhythm.beforeActions}>
            <LinkButton href="/book" icon="arrow">
              Book your stay
            </LinkButton>
            <TextLink href="/contact">Contact the hotel</TextLink>
          </Actions>
          {(settings.phone || settings.whatsapp) && (
            <p className={cn(typeScale.meta, "mt-6 flex flex-wrap items-center justify-center gap-x-5 text-pub-muted")}>
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
