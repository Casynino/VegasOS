import type { Metadata } from "next";
import { ViewTransition } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MessageCircle, Phone } from "lucide-react";
import { getSettings } from "@/server/settings";
import { bookingWindow, getPublicRoomType, listPublicRoomTypes, websitePricer } from "@/server/services/public-booking";
import { addDays } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RoomBookDock } from "@/components/public/booking/room-book-dock";
import { telHref, whatsappHref } from "@/components/public/contact";
import {
  Actions, Atmosphere, Eyebrow, GlassPanel, HOTEL_COORDS, Heading, HudLabel, InfoList, LinkButton, MediaFrame, PriceTag, Rail, Reveal, Section,
  SectionIntro, TextLink, containers, measure, rhythm, typeScale,
} from "@/components/public/kit";
import { RoomCard, roomFacts } from "@/components/public/room-card";
import { guestsLine, pad2 } from "@/components/public/room-chapter";
import { RoomDetails } from "@/components/public/room-details";
import { RoomGallery } from "@/components/public/room-gallery";
import { RoomSpecSheet } from "@/components/public/room-spec";
import { photo } from "@/components/public/site-config";
import { StaySearchForm } from "@/components/public/stay-search-form";

const HIGHLIGHT = new Set(["WIFI", "BREAKFAST"]);

export async function generateMetadata({ params }: PageProps<"/rooms/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const room = await getPublicRoomType(slug);
  if (!room) return { title: "Room not found" };
  const settings = await getSettings();
  const price = (await websitePricer(settings))(room);
  const img = room.images[0] ? photo(room.images[0]) : null;
  return {
    title: room.name,
    description: `${room.name} at Vegas Luxury Hotel, Dar es Salaam — up to ${room.maxAdults} adult(s), free Wi-Fi and breakfast. From ${formatTZS(price.net)} per night when you book direct.`,
    alternates: { canonical: `/rooms/${room.slug}` },
    openGraph: img ? { images: [{ url: img.src, width: img.width, height: img.height, alt: `${room.name} at Vegas Luxury Hotel` }] } : undefined,
  };
}

/**
 * One room type: the photograph full-screen (it morphs from the room's card) under a calm HUD —
 * viewfinder, blueprint grid rising under the title, a floating glass price panel on desktop —
 * then the photos as an immersive mosaic (filmstrip on phones), the story with the booking
 * console (glass, sticky beside the details on desktop, right after the story on phones), the
 * room's technical spec sheet, and the other room types. Phones get a slim floating Book dock
 * that steps aside at the booking panel.
 */
export default async function RoomPage({ params }: PageProps<"/rooms/[slug]">) {
  const { slug } = await params;
  const [room, settings, all] = await Promise.all([getPublicRoomType(slug), getSettings(), listPublicRoomTypes()]);
  if (!room) notFound();
  const stay = bookingWindow(settings);
  const priceOf = await websitePricer(settings);
  const price = priceOf(room);
  const images = room.images.map((src) => ({ ...photo(src), alt: `${room.name}: ${photo(src).alt.toLowerCase()}` }));
  const hero = images[0];
  const amenities = [...room.amenities].sort((a, b) => Number(HIGHLIGHT.has(b.code)) - Number(HIGHLIGHT.has(a.code)));
  const codes = new Set(room.amenities.map((a) => a.code));
  const included = [codes.has("BREAKFAST") && "Breakfast", codes.has("WIFI") && "Wi-Fi"].filter(Boolean) as string[];
  const others = all.filter((t) => t.slug !== room.slug).slice(0, 3).map((t) => {
    const p = priceOf(t);
    return { ...t, image: t.images[0], net: p.net, baseRate: p.baseRate, promo: p.promoLabel };
  });
  const facts = roomFacts(room);
  const bookHref = stay.enabled ? "#book" : "/contact?subject=booking";
  const position = all.findIndex((t) => t.slug === room.slug) + 1;
  const includedNote = included.length > 0 ? `${included.join(" and ")} included` : undefined;
  const spec = [
    { term: "Adults", value: `Up to ${room.maxAdults}` },
    room.maxChildren > 0 ? { term: "Children", value: `Up to ${room.maxChildren}` } : null,
    room.bedType ? { term: "Bed", value: room.bedType } : null,
    room.sizeSqm ? { term: "Size", value: `${room.sizeSqm} m²` } : null,
    { term: "Check-in", value: `From ${stay.checkInTime}` },
    { term: "Check-out", value: `By ${stay.checkoutTime}` },
    settings.receptionHours ? { term: "Reception", value: settings.receptionHours } : null,
  ].filter((f): f is { term: string; value: string } => f !== null);

  return (
    <>
      {/* Hero: the room's first photograph under a calm HUD, its name, facts and price. */}
      <section
        data-tone="night"
        aria-labelledby="room-title"
        className="relative isolate flex min-h-[80svh] overflow-hidden bg-night text-pub-fg sm:min-h-[66svh] lg:min-h-[88vh]"
      >
        {hero ? (
          <ViewTransition name={`room-${room.slug}`} share="vlh-morph" default="none">
            <MediaFrame src={hero.src} alt={hero.alt} ratio="fill" sizes="100vw" preload overlay="hero" imgClassName="pub-settle" className="-z-10" />
          </ViewTransition>
        ) : (
          <div aria-hidden="true" className="pub-sky absolute inset-0 -z-10" />
        )}
        <Atmosphere tone="night" atmosphere="calm" pattern="grid" edges="top" className="pub-atmo--hero" />
        <span
          aria-hidden="true"
          className="pub-hud-corners hidden sm:block"
          style={{ inset: "calc(var(--pub-header-h) + 0.75rem) 1.25rem 1.25rem", "--hud-l": "1.25rem", "--hud-c": "rgb(240 214 160 / 0.55)" } as React.CSSProperties}
        />
        <span aria-hidden="true" className="pub-hero-scan" />
        <HudLabel tick={false} className="absolute right-10 top-[calc(var(--pub-header-h)+2rem)] hidden text-white/70 lg:inline-flex">
          {HOTEL_COORDS.label}
        </HudLabel>

        <div
          className={cn(
            containers.wide,
            "relative flex w-full flex-col justify-end pb-10 pt-[calc(var(--pub-header-h)+3rem)] sm:pb-14 lg:flex-row lg:items-end lg:justify-between lg:gap-12 lg:pb-20",
          )}
        >
          <div className="min-w-0 max-w-4xl">
            <Link
              href="/rooms"
              className={cn(
                typeScale.eyebrow,
                "-ml-1 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm px-1 text-gold transition-colors duration-200 hover:text-white focus-visible:outline-2 focus-visible:outline-gold motion-reduce:transition-none",
              )}
            >
              <ChevronLeft className="size-3.5" strokeWidth={1.8} aria-hidden="true" /> All rooms
            </Link>
            {position > 0 && (
              <HudLabel className="mt-3 flex text-white/70 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700">
                Room type {pad2(position)} / {pad2(all.length)}
              </HudLabel>
            )}
            <h1
              id="room-title"
              className={cn(
                "mt-3 max-w-4xl",
                typeScale.display,
                "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-pub",
              )}
            >
              {room.name}
            </h1>
            {room.shortDescription && <p className={cn("mt-4 text-white/80 sm:mt-5", typeScale.lede, measure.lede)}>{room.shortDescription}</p>}
            <InfoList items={facts} className="mt-5 text-white/75" />
            <PriceTag amount={price.net} from was={price.discount > 0 ? price.baseRate : null} className="mt-5 lg:hidden" />
            <Actions className="mt-7 sm:mt-8">
              <LinkButton href={bookHref} icon="arrow" className="lg:hidden">
                {stay.enabled ? "Book this room" : "Ask to book"}
              </LinkButton>
              {images.length > 1 && <TextLink href="#photos">View photos</TextLink>}
            </Actions>
          </div>

          {/* Desktop: the price floats on glass over the photograph. */}
          <GlassPanel padding="md" rounded="lg" hud spotlight className="hidden w-[22rem] shrink-0 lg:block xl:w-[24rem]">
            <div className="flex items-center justify-between gap-4">
              <HudLabel>Website rate</HudLabel>
              <span aria-hidden="true" className="font-mono text-[11px] tracking-[0.2em] text-pub-muted">TONIGHT</span>
            </div>
            <PriceTag amount={price.net} from size="lg" was={price.discount > 0 ? price.baseRate : null} note={includedNote} className="mt-5" />
            {price.discount > 0 && (
              <p className="mt-2 text-[13px] leading-snug text-pub-eyebrow">
                {price.promotion ?? "Website rate"} · save {formatTZS(price.discount)} per night
              </p>
            )}
            <dl className="mt-5 space-y-2 border-t border-pub-line pt-4 text-[13.5px]">
              {[{ term: "Guests", value: guestsLine(room) }, ...(room.bedType ? [{ term: "Bed", value: room.bedType }] : []), ...(room.sizeSqm ? [{ term: "Size", value: `${room.sizeSqm} m²` }] : [])].map((s) => (
                <div key={s.term} className="flex items-baseline gap-3">
                  <dt className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.16em] text-pub-muted">{s.term}</dt>
                  <span aria-hidden="true" className="min-w-3 flex-1 translate-y-[-3px] border-b border-dotted border-pub-line" />
                  <dd className="text-right">{s.value}</dd>
                </div>
              ))}
            </dl>
            <LinkButton href={bookHref} icon="arrow" full className="mt-6">
              {stay.enabled ? "Book this room" : "Ask to book"}
            </LinkButton>
          </GlassPanel>
        </div>
      </section>

      {/* The other photographs (the hero already shows the first), then details from across the hotel's rooms. */}
      <Section
        tone="night"
        id="photos"
        labelledBy={images.length > 1 ? "photos-title" : "room-details-title"}
        space="sm"
        width="wide"
        aurora={false}
        className="pt-10 sm:pt-14 lg:pt-16"
      >
        {images.length > 1 && (
          <>
            <Eyebrow as="h2" rule className="mb-6 lg:mb-8">
              <span id="photos-title">Inside the {room.name}</span>
            </Eyebrow>
            <RoomGallery images={images} roomName={room.name} from={1} />
          </>
        )}
        <RoomDetails
          id="room-details-title"
          title={images.length > 1 ? "More from our rooms" : "From our rooms"}
          exclude={room.images}
          className={images.length > 1 ? "mt-14 sm:mt-16 lg:mt-20" : undefined}
        />
      </Section>

      {/* Story, booking console and spec sheet. Phones: story → console → spec. */}
      <Section space="md" width="wide" pattern="grid" labelledBy="about-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-16">
          <Reveal className="min-w-0 lg:col-span-7">
            <Eyebrow as="h2" rule>
              <span id="about-title">About this room</span>
            </Eyebrow>
            <p className={cn("mt-6 text-pub-fg/85", typeScale.lede, "lg:text-[1.1875rem] lg:leading-[1.7]", "max-w-[38rem]")}>
              {room.description ?? room.shortDescription ?? `${room.name} at Vegas Luxury Hotel.`}
            </p>
          </Reveal>

          <aside
            id="book"
            aria-label={`Book the ${room.name}`}
            className="min-w-0 scroll-mt-[calc(var(--pub-header-h)+1rem)] lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1"
          >
            <GlassPanel variant="paper" padding="md" rounded="lg" hud className="lg:sticky lg:top-24">
              <div className="flex items-center justify-between gap-4">
                <HudLabel live={stay.enabled}>{stay.enabled ? "Live availability" : "Reservations"}</HudLabel>
                <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.2em] text-pub-muted sm:text-[11px]">
                  {pad2(position)}/{pad2(all.length)}
                </span>
              </div>
              <PriceTag
                amount={price.net}
                from
                size="lg"
                was={price.discount > 0 ? price.baseRate : null}
                note={includedNote}
                className="mt-5"
              />
              {price.discount > 0 && (
                <p className="mt-3 text-[13px] leading-snug text-pub-eyebrow">
                  {price.promotion ?? "Website rate"} · save {formatTZS(price.discount)} per night
                </p>
              )}
              <div className="my-6 h-px bg-pub-line" />
              {stay.enabled ? (
                <>
                  <Heading as="h2" size="subheading">Choose your dates</Heading>
                  <div className="mt-5">
                    <StaySearchForm
                      variant="panel"
                      defaults={{ checkIn: stay.today, checkOut: addDays(stay.today, 1), adults: Math.min(2, room.maxAdults), children: 0, type: room.slug }}
                      minDate={stay.today}
                      maxDate={stay.maxArrival}
                      maxNights={stay.maxNights}
                      submitLabel="Check availability"
                      stacked
                    />
                  </div>
                </>
              ) : (
                <div>
                  <Heading as="h2" size="subheading">Book with us directly</Heading>
                  <p className={cn(typeScale.small, "mt-2 text-pub-muted")}>Online booking is paused — contact us and we’ll reserve this room for you.</p>
                  <div className="mt-5 grid gap-3">
                    {settings.phone && (
                      <LinkButton href={telHref(settings.phone)} full icon={<Phone className="size-4" strokeWidth={1.6} aria-hidden="true" />}>
                        Call {settings.phone}
                      </LinkButton>
                    )}
                    {settings.whatsapp && (
                      <LinkButton
                        href={whatsappHref(settings.whatsapp, `Hello, I would like to book a ${room.name}.`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="secondary"
                        full
                        icon={<MessageCircle className="size-4" strokeWidth={1.6} aria-hidden="true" />}
                      >
                        WhatsApp
                      </LinkButton>
                    )}
                  </div>
                </div>
              )}
            </GlassPanel>
          </aside>

          <Reveal className="min-w-0 lg:col-span-7 lg:row-start-2">
            <RoomSpecSheet name={room.name} index={position} total={all.length} facts={spec} amenities={amenities} included={HIGHLIGHT} />
          </Reveal>
        </div>
      </Section>

      {others.length > 0 && (
        <Section
          tone="night"
          space="md"
          width="wide"
          labelledBy="other-rooms"
          marker={{ label: "Room types", aside: <HudLabel tick={false}>{pad2(all.length)} to choose from</HudLabel> }}
        >
          <SectionIntro align="split" eyebrow="Stay your way" title="Other rooms" id="other-rooms" actions={<TextLink href="/rooms">All rooms</TextLink>} />
          <Rail label="Other room types" desktop="grid" cols={3} className={rhythm.afterIntro}>
            {others.map((r) => (
              <RoomCard key={r.slug} room={r} />
            ))}
          </Rail>
        </Section>
      )}

      {/* Phones: a slim floating Book dock (steps aside at the booking panel). */}
      <RoomBookDock name={room.name} price={formatTZS(price.net)} href={bookHref} label={stay.enabled ? "Book" : "Ask us"} />
    </>
  );
}
