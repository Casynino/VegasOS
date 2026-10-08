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
import { RoomCard } from "@/components/public/room-card";
import { pad2 } from "@/components/public/room-chapter";
import { RoomDetails } from "@/components/public/room-details";
import { RoomGallery } from "@/components/public/room-gallery";
import { RoomSpecSheet } from "@/components/public/room-spec";
import { photo } from "@/components/public/site-config";
import { StaySearchForm } from "@/components/public/stay-search-form";
import { altZh } from "@/components/public/content.zh-CN";
import { getT, pageLocale } from "@/i18n/server";

const HIGHLIGHT = new Set(["WIFI", "BREAKFAST"]);

export async function generateMetadata({ params }: PageProps<"/[lang]/rooms/[slug]">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  const { slug } = await params;
  const room = await getPublicRoomType(slug);
  if (!room) return { title: t("Room not found") };
  const settings = await getSettings();
  const price = (await websitePricer(settings))(room);
  const img = room.images[0] ? photo(room.images[0]) : null;
  const name = t(room.name);
  return {
    title: name,
    description: t("{name} at Vegas Luxury Hotel, Dar es Salaam — up to {adults} adult(s), free Wi-Fi and breakfast. From {price} per night when you book direct.", {
      name,
      adults: room.maxAdults,
      price: formatTZS(price.net),
    }),
    alternates: { canonical: `/rooms/${room.slug}` },
    openGraph: img ? { images: [{ url: img.src, width: img.width, height: img.height, alt: t("{name} at Vegas Luxury Hotel", { name }) }] } : undefined,
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
export default async function RoomPage({ params }: PageProps<"/[lang]/rooms/[slug]">) {
  await pageLocale(params);
  const t = await getT();
  const { slug } = await params;
  const [room, settings, all] = await Promise.all([getPublicRoomType(slug), getSettings(), listPublicRoomTypes()]);
  if (!room) notFound();
  // The room type's name in the visitor's language (the hotel's own translation, else the English).
  const name = t(room.name);
  /** "Up to 2 adults · 1 child" — from the database only. */
  const guests = t.plural(room.maxAdults, "Up to {n} adult", "Up to {n} adults") + (room.maxChildren > 0 ? ` · ${t.plural(room.maxChildren, "{n} child", "{n} children")}` : "");
  const stay = bookingWindow(settings);
  const priceOf = await websitePricer(settings);
  const price = priceOf(room);
  const photoAlt = (a: string) => (t.locale === "zh-CN" ? altZh(a) : a);
  const images = room.images.map((src) => ({ ...photo(src), alt: t("{name}: {photo}", { name, photo: photoAlt(photo(src).alt).toLowerCase() }) }));
  const hero = images[0];
  const amenities = [...room.amenities].sort((a, b) => Number(HIGHLIGHT.has(b.code)) - Number(HIGHLIGHT.has(a.code)));
  const codes = new Set(room.amenities.map((a) => a.code));
  const breakfast = codes.has("BREAKFAST");
  const wifi = codes.has("WIFI");
  const others = all.filter((type) => type.slug !== room.slug).slice(0, 3).map((type) => {
    const p = priceOf(type);
    return { ...type, image: type.images[0], net: p.net, baseRate: p.baseRate, promo: p.promoLabel };
  });
  // "Up to 2 adults · 1 child · King bed · 32 m²" — from the database only.
  const facts = [
    { label: t.plural(room.maxAdults, "Up to {n} adult", "Up to {n} adults") },
    room.maxChildren > 0 ? { label: t.plural(room.maxChildren, "{n} child", "{n} children") } : null,
    room.bedType ? { label: t(room.bedType) } : null,
    room.sizeSqm ? { label: `${room.sizeSqm} m²` } : null,
  ].filter((f): f is { label: string } => f !== null);
  const bookHref = stay.enabled ? "#book" : "/contact?subject=booking";
  const position = all.findIndex((t) => t.slug === room.slug) + 1;
  const about = room.description ?? room.shortDescription;
  const includedNote = breakfast && wifi ? t("Breakfast and Wi-Fi included") : breakfast ? t("Breakfast included") : wifi ? t("Wi-Fi included") : undefined;
  const spec = [
    { term: t("Adults"), value: t("Up to {n}", { n: room.maxAdults }) },
    room.maxChildren > 0 ? { term: t("Children"), value: t("Up to {n}", { n: room.maxChildren }) } : null,
    room.bedType ? { term: t("Bed"), value: t(room.bedType) } : null,
    room.sizeSqm ? { term: t("Size"), value: `${room.sizeSqm} m²` } : null,
    { term: t("Check-in"), value: t("From {time}", { time: stay.checkInTime }) },
    { term: t("Check-out"), value: t("By {time}", { time: stay.checkoutTime }) },
    settings.receptionHours ? { term: t("Reception"), value: t(settings.receptionHours) } : null,
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
              <ChevronLeft className="size-3.5" strokeWidth={1.8} aria-hidden="true" /> {t("All rooms")}
            </Link>
            {position > 0 && (
              <HudLabel className="mt-3 flex text-white/70 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700">
                {t("Room type {n} / {total}", { n: pad2(position), total: pad2(all.length) })}
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
              {name}
            </h1>
            {room.shortDescription && <p className={cn("mt-4 text-white/80 sm:mt-5", typeScale.lede, measure.lede)}>{t(room.shortDescription)}</p>}
            <InfoList items={facts} className="mt-5 text-white/75" />
            <PriceTag amount={price.net} from was={price.discount > 0 ? price.baseRate : null} className="mt-5 lg:hidden" />
            <Actions className="mt-7 sm:mt-8">
              <LinkButton href={bookHref} icon="arrow" className="lg:hidden">
                {stay.enabled ? t("Book this room") : t("Ask to book")}
              </LinkButton>
              {images.length > 1 && <TextLink href="#photos">{t("View photos")}</TextLink>}
            </Actions>
          </div>

          {/* Desktop: the price floats on glass over the photograph. */}
          <GlassPanel padding="md" rounded="lg" hud spotlight className="hidden w-[22rem] shrink-0 lg:block xl:w-[24rem]">
            <div className="flex items-center justify-between gap-4">
              <HudLabel>{t("Website rate")}</HudLabel>
              <span aria-hidden="true" className="font-mono text-[11px] tracking-[0.2em] text-pub-muted">{t("TONIGHT")}</span>
            </div>
            <PriceTag amount={price.net} from size="lg" was={price.discount > 0 ? price.baseRate : null} note={includedNote} className="mt-5" />
            {price.discount > 0 && (
              <p className="mt-2 text-[13px] leading-snug text-pub-eyebrow">
                {price.promotion != null ? t(price.promotion) : t("Website rate")} · {t("save {amount} per night", { amount: formatTZS(price.discount) })}
              </p>
            )}
            <dl className="mt-5 space-y-2 border-t border-pub-line pt-4 text-[13.5px]">
              {[{ term: t("Guests"), value: guests }, ...(room.bedType ? [{ term: t("Bed"), value: t(room.bedType) }] : []), ...(room.sizeSqm ? [{ term: t("Size"), value: `${room.sizeSqm} m²` }] : [])].map((s) => (
                <div key={s.term} className="flex items-baseline gap-3">
                  <dt className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.16em] text-pub-muted">{s.term}</dt>
                  <span aria-hidden="true" className="min-w-3 flex-1 translate-y-[-3px] border-b border-dotted border-pub-line" />
                  <dd className="text-right">{s.value}</dd>
                </div>
              ))}
            </dl>
            <LinkButton href={bookHref} icon="arrow" full className="mt-6">
              {stay.enabled ? t("Book this room") : t("Ask to book")}
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
              <span id="photos-title">{t("Inside the {name}", { name })}</span>
            </Eyebrow>
            <RoomGallery images={images} roomName={name} from={1} />
          </>
        )}
        <RoomDetails
          id="room-details-title"
          title={images.length > 1 ? t("More from our rooms") : t("From our rooms")}
          exclude={room.images}
          className={images.length > 1 ? "mt-14 sm:mt-16 lg:mt-20" : undefined}
        />
      </Section>

      {/* Story, booking console and spec sheet. Phones: story → console → spec. */}
      <Section space="md" width="wide" pattern="grid" labelledBy="about-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-16">
          <Reveal className="min-w-0 lg:col-span-7">
            <Eyebrow as="h2" rule>
              <span id="about-title">{t("About this room")}</span>
            </Eyebrow>
            <p className={cn("mt-6 text-pub-fg/85", typeScale.lede, "lg:text-[1.1875rem] lg:leading-[1.7]", "max-w-[38rem]")}>
              {about != null ? t(about) : t("{name} at Vegas Luxury Hotel.", { name })}
            </p>
          </Reveal>

          <aside
            id="book"
            aria-label={t("Book the {name}", { name })}
            className="min-w-0 scroll-mt-[calc(var(--pub-header-h)+1rem)] lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1"
          >
            <GlassPanel variant="paper" padding="md" rounded="lg" hud className="lg:sticky lg:top-24">
              <div className="flex items-center justify-between gap-4">
                <HudLabel live={stay.enabled}>{stay.enabled ? t("Live availability") : t("Reservations")}</HudLabel>
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
                  {price.promotion != null ? t(price.promotion) : t("Website rate")} · {t("save {amount} per night", { amount: formatTZS(price.discount) })}
                </p>
              )}
              <div className="my-6 h-px bg-pub-line" />
              {stay.enabled ? (
                <>
                  <Heading as="h2" size="subheading">{t("Choose your dates")}</Heading>
                  <div className="mt-5">
                    <StaySearchForm
                      variant="panel"
                      defaults={{ checkIn: stay.today, checkOut: addDays(stay.today, 1), adults: Math.min(2, room.maxAdults), children: 0, type: room.slug }}
                      minDate={stay.today}
                      maxDate={stay.maxArrival}
                      maxNights={stay.maxNights}
                      submitLabel={t("Book now")}
                      stacked
                      direct
                    />
                  </div>
                </>
              ) : (
                <div>
                  <Heading as="h2" size="subheading">{t("Book with us directly")}</Heading>
                  <p className={cn(typeScale.small, "mt-2 text-pub-muted")}>{t("Online booking is paused — contact us and we’ll reserve this room for you.")}</p>
                  <div className="mt-5 grid gap-3">
                    {settings.phone && (
                      <LinkButton href={telHref(settings.phone)} full icon={<Phone className="size-4" strokeWidth={1.6} aria-hidden="true" />}>
                        {t("Call {phone}", { phone: settings.phone })}
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
            <RoomSpecSheet name={name} index={position} total={all.length} facts={spec} amenities={amenities} included={HIGHLIGHT} />
          </Reveal>
        </div>
      </Section>

      {others.length > 0 && (
        <Section
          tone="night"
          space="md"
          width="wide"
          labelledBy="other-rooms"
          marker={{ label: t("Room types"), aside: <HudLabel tick={false}>{t("{n} to choose from", { n: pad2(all.length) })}</HudLabel> }}
        >
          <SectionIntro align="split" eyebrow={t("Stay your way")} title={t("Other rooms")} id="other-rooms" actions={<TextLink href="/rooms">{t("All rooms")}</TextLink>} />
          <Rail label={t("Other room types")} desktop="grid" cols={3} className={rhythm.afterIntro}>
            {others.map((r) => (
              <RoomCard key={r.slug} room={r} t={t} />
            ))}
          </Rail>
        </Section>
      )}

      {/* Phones: a slim floating Book dock (steps aside at the booking panel). */}
      <RoomBookDock name={name} price={formatTZS(price.net)} href={bookHref} label={stay.enabled ? t("Book") : t("Ask us")} />
    </>
  );
}
