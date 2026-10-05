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
import { NamedIcon } from "@/components/public/icon";
import {
  Actions, Eyebrow, Heading, InfoList, LinkButton, MediaFrame, PriceTag, Rail, Reveal, Section, SectionIntro, TextLink,
  containers, measure, rhythm, surface, typeScale,
} from "@/components/public/kit";
import { RoomCard, roomFacts } from "@/components/public/room-card";
import { RoomGallery } from "@/components/public/room-gallery";
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
 * One room type: the photograph (it morphs from the room's card), a filmstrip of its photos,
 * the story, the booking panel (sticky beside the details on desktop, right after the story on
 * phones), amenities as a quiet list, the times, and the other room types. Phones get a slim
 * floating Book dock that steps aside at the panel.
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

  return (
    <>
      {/* Hero: the room's first photograph, its name and facts. */}
      <section data-tone="night" aria-labelledby="room-title" className="relative isolate flex min-h-[74svh] overflow-hidden bg-night text-pub-fg sm:min-h-[64svh] lg:min-h-[78vh]">
        {hero ? (
          <ViewTransition name={`room-${room.slug}`} share="vlh-morph" default="none">
            <MediaFrame src={hero.src} alt={hero.alt} ratio="fill" sizes="100vw" preload overlay="hero" imgClassName="pub-settle" className="-z-10" />
          </ViewTransition>
        ) : (
          <div aria-hidden="true" className="pub-sky absolute inset-0 -z-10" />
        )}
        <div className={cn(containers.wide, "flex w-full flex-col justify-end pb-10 pt-[calc(var(--pub-header-h)+3rem)] sm:pb-14 lg:pb-20")}>
          <Link
            href="/rooms"
            className={cn(typeScale.eyebrow, "-ml-1 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm px-1 text-gold transition-colors duration-200 hover:text-white focus-visible:outline-2 focus-visible:outline-gold motion-reduce:transition-none")}
          >
            <ChevronLeft className="size-3.5" strokeWidth={1.8} aria-hidden="true" /> All rooms
          </Link>
          <h1
            id="room-title"
            className={cn(
              "mt-2 max-w-4xl",
              typeScale.title,
              "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-pub",
            )}
          >
            {room.name}
          </h1>
          {room.shortDescription && <p className={cn("mt-4 text-white/80 sm:mt-5", typeScale.lede, measure.lede)}>{room.shortDescription}</p>}
          <InfoList items={facts} className="mt-5" />
          <Actions className="mt-7 sm:mt-8">
            <LinkButton href={bookHref} icon="arrow">{stay.enabled ? "Book this room" : "Ask to book"}</LinkButton>
            {images.length > 1 && <TextLink href="#photos">View photos</TextLink>}
          </Actions>
        </div>
      </section>

      {/* The other photographs (the hero already shows the first). */}
      {images.length > 1 && (
        <Section id="photos" labelledBy="photos-title" space="sm" width="wide" className="pb-6 sm:pb-8 lg:pb-10">
          <Eyebrow rule className="mb-6">
            <span id="photos-title">Inside the {room.name}</span>
          </Eyebrow>
          <RoomGallery images={images} roomName={room.name} from={1} />
        </Section>
      )}

      {/* Story, booking panel, amenities and times. Phones: story → panel → details. */}
      <Section space="md" width="wide" labelledBy="about-title" className={images.length > 1 ? "pt-10 sm:pt-12 lg:pt-16" : undefined}>
        <div className="grid gap-12 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-16">
          <Reveal className="min-w-0 lg:col-span-7">
            <Eyebrow as="h2" rule>
              <span id="about-title">About this room</span>
            </Eyebrow>
            <p className={cn("mt-6 text-pub-fg/85", typeScale.lede, "lg:text-[1.1875rem] lg:leading-[1.7]", "max-w-[38rem]")}>
              {room.description ?? room.shortDescription ?? `${room.name} at Vegas Luxury Hotel.`}
            </p>
          </Reveal>

          <aside id="book" aria-label={`Book the ${room.name}`} className="min-w-0 scroll-mt-[calc(var(--pub-header-h)+1rem)] lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1">
            <div className={cn(surface.panel, "lg:sticky lg:top-24")}>
              <PriceTag
                amount={price.net}
                from
                size="lg"
                was={price.discount > 0 ? price.baseRate : null}
                note={included.length > 0 ? `${included.join(" and ")} included` : undefined}
              />
              {price.discount > 0 && (
                <p className="mt-3 text-[13px] leading-snug text-pub-eyebrow">
                  {price.promotion ?? "Website rate"}{price.promoLabel ? ` · ${price.promoLabel}` : ""} · save {formatTZS(price.discount)} per night
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
            </div>
          </aside>

          <div className="min-w-0 space-y-12 lg:col-span-7 lg:row-start-2 lg:space-y-16">
            {amenities.length > 0 && (
              <Reveal>
                <Heading as="h2" size="subheading" id="amenities-title">In the room</Heading>
                <ul aria-labelledby="amenities-title" className="mt-5 grid border-t border-pub-line sm:grid-cols-2 sm:gap-x-10">
                  {amenities.map((a) => (
                    <li key={a.code} className="flex min-w-0 items-center gap-3.5 border-b border-pub-line py-4">
                      <NamedIcon name={a.icon} className="size-5 shrink-0 text-pub-eyebrow" />
                      <span className="min-w-0 flex-1 text-[15px] leading-snug text-pub-fg">{a.name}</span>
                      {HIGHLIGHT.has(a.code) && <span className={cn(typeScale.meta, "shrink-0 text-pub-eyebrow")}>Included</span>}
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}

            <Reveal>
              <Heading as="h2" size="subheading" id="times-title">Good to know</Heading>
              <InfoList
                variant="rows"
                className="mt-5"
                items={[
                  { label: "Check-in", value: `From ${stay.checkInTime}` },
                  { label: "Check-out", value: `By ${stay.checkoutTime}` },
                  ...(settings.receptionHours ? [{ label: "Reception", value: settings.receptionHours }] : []),
                ]}
              />
            </Reveal>
          </div>
        </div>
      </Section>

      {others.length > 0 && (
        <Section tone="night" glow="top" space="md" labelledBy="other-rooms">
          <SectionIntro
            align="split"
            eyebrow="Stay your way"
            title="Other rooms"
            id="other-rooms"
            actions={<TextLink href="/rooms">All rooms</TextLink>}
          />
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
