import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, MessageCircle, Phone, Wifi } from "lucide-react";
import { getSettings } from "@/server/settings";
import { bookingWindow, listPublicRoomTypes, publicStats, tonightAvailability, websitePricer } from "@/server/services/public-booking";
import { getSiteContent } from "@/server/services/site-content";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { blurFor } from "@/components/public/blur-data";
import { addressLines, contentVars, telHref, whatsappHref } from "@/components/public/contact";
import { fill, ILLUSTRATIVE, photo } from "@/components/public/content";
import { HotelJsonLd } from "@/components/public/hotel-jsonld";
import { NamedIcon } from "@/components/public/icon";
import { BarIllustration, DiningIllustration, MeetingIllustration } from "@/components/public/illustrations";
import { Marquee } from "@/components/public/motion";
import { Reveal } from "@/components/public/reveal";
import { MAP_LINK_URL } from "@/components/public/site-config";
import { container, eyebrow, type } from "@/components/public/ui";
import { WordReveal } from "@/components/public/word-reveal";
import { HeroBookingBar } from "@/components/public/cinema/booking-bar";
import { GalleryMosaic } from "@/components/public/cinema/gallery-mosaic";
import { CinematicHero } from "@/components/public/cinema/hero";
import { RoomEditorial } from "@/components/public/cinema/room-editorial";
import { ArrivalCard, NowCard, RoomsTonightPanel } from "@/components/public/cinema/hero-panels";
import { getHotelWeather } from "@/server/services/weather";
import { BlueprintReveal } from "@/components/public/cinema/blueprint-reveal";
import { CityDive } from "@/components/public/cinema/city-dive";
import { addDays } from "@/lib/time/business-date";

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

/* Shared recipes for this page */
const label = cn(eyebrow, "flex items-center gap-3");
const rule = <span className="h-px w-10 bg-gold" aria-hidden="true" />;
/** Each section after the hero slides over the previous one like a layered sheet. */
const sheet = "relative z-10 -mt-10 rounded-t-[2.5rem] sm:-mt-14 sm:rounded-t-[3.5rem] pub-dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_-30px_80px_-40px_oklch(0.72_0.12_80/0.35)]";

function TextLink({ href, children, tone = "dark", external }: { href: string; children: React.ReactNode; tone?: "dark" | "light"; external?: boolean }) {
  const cls = cn(
    "group inline-flex items-center gap-2 text-sm font-medium uppercase tracking-[0.18em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
    tone === "dark" ? "text-tone" : "text-white",
  );
  const inner = (
    <>
      <span className="relative">
        {children}
        <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-40 bg-gold transition-transform duration-500 group-hover:scale-x-100" aria-hidden="true" />
      </span>
      <ArrowRight className="size-4 text-gold transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
    </>
  );
  return external ? <a href={href} className={cls} target="_blank" rel="noopener noreferrer">{inner}</a> : <Link href={href} className={cls}>{inner}</Link>;
}

/** Honest label for licensed stock imagery (never presented as the hotel). */
function IllustrativeTag({ className }: { className?: string }) {
  return <span className={cn("rounded-full bg-black/45 px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.22em] text-white/70 backdrop-blur-md", className)}>Illustrative</span>;
}

function GoldButton({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex h-12 items-center gap-2 rounded-full bg-gold px-5 text-xs font-semibold uppercase tracking-[0.12em] sm:h-13 sm:gap-3 sm:px-7 sm:text-sm sm:tracking-[0.14em] text-[#15120e] shadow-[0_16px_40px_-14px_oklch(0.72_0.12_80/0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white", className)}>
      {children}
      <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
    </Link>
  );
}

function GlassButton({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  const cls = "group inline-flex h-12 items-center gap-2 rounded-full border border-white/25 bg-white/[0.07] px-5 text-xs font-medium uppercase tracking-[0.12em] sm:h-13 sm:gap-3 sm:px-7 sm:text-sm sm:tracking-[0.14em] text-white backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-gold/70 hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";
  const inner = <>{children}<ArrowUpRight className="size-4 text-gold transition-transform duration-300 group-hover:rotate-45" aria-hidden="true" /></>;
  return external ? <a href={href} className={cls}>{inner}</a> : <Link href={href} className={cls}>{inner}</Link>;
}

export default async function HomePage() {
  const [settings, roomTypes, stats, c] = await Promise.all([getSettings(), listPublicRoomTypes(), publicStats(), getSiteContent()]);
  const price = await websitePricer(settings);
  const [tonight, weather] = await Promise.all([tonightAvailability(settings), getHotelWeather()]);
  const h = c.home;
  const window = bookingWindow(settings);
  const vars = contentVars(settings, { airportKm: c.facts.airportKm, rooms: stats.rooms, roomTypes: stats.roomTypes });
  const f = (s: string) => fill(s, vars);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.vegasluxuryhotel.co.tz";
  const address = addressLines(settings);

  const rooms = roomTypes.map((t) => {
    const p = price(t);
    return {
      slug: t.slug, name: t.name, summary: t.shortDescription ?? t.description, images: t.images,
      maxAdults: t.maxAdults, maxChildren: t.maxChildren, baseRate: p.baseRate, net: p.net, amenities: t.amenities,
    };
  });
  // Lead the editorial with the suite (strongest photography); the rest keep their order.
  rooms.sort((a, b) => Number(b.slug === "executive-suite") - Number(a.slug === "executive-suite"));
  const galleryImages = [
    "/images/room-blue/room-blue-04.webp", "/images/bath/bath-08.webp", "/images/room-red/room-red-07.webp", "/images/amenity/amenity-01.webp",
    "/images/room-blue/room-blue-06.webp", "/images/bath/bath-02.webp", "/images/lobby/lobby-01.webp", "/images/room-red/room-red-03.webp",
  ].map((src) => photo(src));
  const [stayItem, dineItem, connectItem, gatherItem] = h.stay.items;
  const imageBySlug = new Map(roomTypes.map((t) => [t.slug, t.images[0] ?? null]));
  const tonightRooms = [...tonight.types]
    .sort((a, b) => Number(b.slug === "executive-suite") - Number(a.slug === "executive-suite"))
    .slice(0, 3)
    .map((t) => ({
      slug: t.slug, name: t.name, net: t.net, free: t.free, image: imageBySlug.get(t.slug) ?? null,
      href: `/book?checkIn=${window.today}&checkOut=${addDays(window.today, 1)}&adults=2&children=0&type=${t.slug}`,
    }));
  const initialTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

  return (
    <>
      <HotelJsonLd settings={settings} baseUrl={baseUrl} content={c} />

      {/* ═════════════ 1. Cinematic hero ═════════════ */}
      <CinematicHero
        labelledBy="hero-title"
        slides={h.hero.slides}
        footer={
          <div className={cn(container, "scroll-mt-24 pb-16 sm:pb-24")} id="availability">
            {window.enabled ? (
              <HeroBookingBar minDate={window.today} maxDate={window.maxArrival} maxNights={window.maxNights} defaultCheckIn={window.today}
                roomTypes={roomTypes.map((t) => ({ slug: t.slug, name: t.name }))} />
            ) : (
              <div className="vlh-glass flex flex-wrap items-center justify-between gap-4 rounded-[1.75rem] p-5 text-white">
                <p className="text-sm text-white/80">Online requests are paused — our front desk will book your room directly.</p>
                <div className="flex flex-wrap gap-3">
                  {settings.phone && <GlassButton href={telHref(settings.phone)} external>Call to book</GlassButton>}
                  {settings.whatsapp && <GlassButton href={whatsappHref(settings.whatsapp, "Hello, I would like to book a room.")} external>WhatsApp</GlassButton>}
                </div>
              </div>
            )}
          </div>
        }
      >
        <div className={cn(container, "grid flex-1 items-end gap-10 pb-8 pt-[34svh] sm:pb-10 sm:pt-28 lg:grid-cols-12 lg:pt-32")}>
          <div className="max-w-3xl lg:col-span-7">
            <p className={cn(label, "text-white/75 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-1000")}>
              {rule}<span><span className="hidden sm:inline">{settings.hotelName} · </span>{c.facts.locationLine}</span>
            </p>
            <h1 id="hero-title" className="mt-6 font-display text-[clamp(3rem,min(7.4vw,12vh),7.5rem)] font-medium leading-[0.9] tracking-[-0.02em]">
              <WordReveal className="block" parts={[{ text: f(h.hero.title) }]} />
              <WordReveal className="block pl-[0.06em]" parts={[{ text: f(h.hero.titleAccent), accent: true }]} startDelay={420} />
            </h1>
            <p className={cn("mt-5 max-w-md text-pretty text-white/75 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:delay-700 motion-safe:duration-1000", type.lead)}>
              {f(h.hero.intro)}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3 sm:gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:delay-1000 motion-safe:duration-1000">
              <GoldButton href="#availability">{h.hero.primaryCta.label}</GoldButton>
              <GlassButton href="#rooms">{h.hero.secondaryCta.label}</GlassButton>
            </div>
            <ul className="mt-7 hidden grid-cols-2 gap-x-4 gap-y-2 text-[11px] uppercase tracking-[0.2em] text-white/60 sm:flex sm:flex-wrap sm:items-center sm:gap-x-5 sm:tracking-[0.22em] motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-both motion-safe:delay-1000 motion-safe:duration-1000" aria-label="Included with your stay">
              {h.hero.highlights.map((x, i) => (
                <li key={x} className="flex items-center gap-2.5 sm:gap-5">
                  <span className={cn("size-1 shrink-0 rotate-45 bg-gold/80", i === 0 && "sm:hidden")} aria-hidden="true" />
                  {x}
                </li>
              ))}
            </ul>
            {window.enabled && tonight.fromNet !== null && tonight.totalFree > 0 && (
              <p className="mt-4 text-sm text-white/70 lg:hidden">
                <span className="mr-2 inline-block size-1.5 -translate-y-px rounded-full bg-emerald-400 align-middle motion-safe:animate-pulse" aria-hidden="true" />
                Tonight: {tonight.totalFree} rooms available · from <span className="font-medium text-gold">{formatTZS(tonight.fromNet)}</span> per night
              </p>
            )}
          </div>

          {/* Floating glass panels — live, real data over the photograph */}
          <div className="hidden gap-4 lg:col-span-5 lg:grid lg:grid-cols-2 lg:self-center motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-6 motion-safe:fill-mode-both motion-safe:delay-700 motion-safe:duration-1000">
            <NowCard weather={weather} initialTime={initialTime} checkInTime={window.checkInTime} />
            <ArrivalCard airportKm={c.facts.airportKm} />
            {window.enabled && (
              <div className="col-span-2 xl:ml-10">
                <RoomsTonightPanel rooms={tonightRooms} totalFree={tonight.totalFree} />
              </div>
            )}
          </div>
        </div>
      </CinematicHero>

      {/* ═════════════ 2. Introduction ═════════════ */}
      <section className={cn(sheet, "overflow-hidden bg-paper pb-24 pt-20 sm:pb-32 sm:pt-28")} aria-labelledby="intro-title">
        <div aria-hidden="true" className="pointer-events-none absolute -right-48 top-10 size-[40rem] rounded-full bg-[radial-gradient(circle,oklch(0.85_0.09_80/0.45),transparent_65%)]" />
        <div className={cn(container, "relative grid gap-16 lg:grid-cols-12 lg:gap-10")}>
          <Reveal className="lg:col-span-6 lg:pt-8">
            <p className={cn(label, "text-accent-ink")}>{rule}{h.intro.kicker}</p>
            <h2 id="intro-title" className="mt-6 text-balance font-display text-[clamp(2.3rem,4.2vw,4.4rem)] font-medium leading-[1.02] tracking-[-0.01em]">
              {h.intro.title} <span className="italic text-accent-ink">{h.intro.titleAccent}</span>
            </h2>
            <div className={cn("mt-8 max-w-lg space-y-4 text-tone/70", type.body)}>
              {h.intro.paragraphs.map((p) => <p key={p}>{f(p)}</p>)}
            </div>
            <dl className="mt-12 grid max-w-lg grid-cols-3 divide-x divide-tone/10 border-y border-tone/10">
              {[
                { k: String(stats.rooms), v: "Guest rooms" },
                { k: window.checkInTime, v: "Check-in from" },
                { k: `${c.facts.airportKm} km`, v: "To the airport" },
              ].map((s) => (
                <div key={s.v} className="px-4 py-5 first:pl-0">
                  <dt className="sr-only">{s.v}</dt>
                  <dd className="font-display text-3xl font-medium sm:text-4xl">{s.k}</dd>
                  <dd className="mt-1 text-[10px] uppercase tracking-[0.22em] text-tone/55" aria-hidden="true">{s.v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-10"><TextLink href="/hotel">Discover the hotel</TextLink></div>
          </Reveal>

          <div className="relative pb-10 lg:col-span-6 lg:pb-0">
            <div className="vlh-clip relative ml-auto aspect-[4/5] w-[88%] overflow-hidden rounded-[2rem] shadow-[0_50px_100px_-45px_rgba(21,18,14,0.7)]">
              <Image src={h.intro.mainImage.src} alt={h.intro.mainImage.alt} fill sizes="(min-width:1024px) 42vw, 88vw" {...blurFor(h.intro.mainImage.src)} className="vlh-scroll-zoom object-cover" />
            </div>
            <Reveal delay={0.2} className="absolute bottom-0 left-0 w-[48%] lg:-bottom-14">
              <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border-[6px] border-paper shadow-[0_40px_80px_-35px_rgba(21,18,14,0.7)]">
                <Image src={h.intro.insetImage.src} alt={h.intro.insetImage.alt} fill sizes="(min-width:1024px) 24vw, 48vw" {...blurFor(h.intro.insetImage.src)} className="object-cover" />
              </div>
            </Reveal>
            <div className="vlh-float absolute right-2 top-8 rounded-2xl bg-[#15120e]/85 px-5 py-4 text-white shadow-2xl backdrop-blur-md sm:-right-4 sm:top-12">
              <p className="text-[10px] uppercase tracking-[0.26em] text-gold">Always open</p>
              <p className="mt-1 font-display text-2xl">24-hour reception</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════ 2b. Blueprint → building ═════════════ */}
      <BlueprintReveal
        image="/images/exterior/exterior-01.webp"
        alt="Exterior of the Vegas Luxury Hotel building"
        eyebrow="The building"
        title={<>Drawn for rest. <span className="italic text-gold">Built for you.</span></>}
        notes={[
          { label: "Rooms", value: `${stats.rooms} rooms · ${stats.roomTypes} room types`, x: 58, y: 34 },
          { label: "Reception", value: "Open 24 hours", x: 44, y: 62, align: "left" },
          { label: "Dining", value: "Restaurant & bar", x: 70, y: 52 },
          { label: "Parking", value: "Free, on site", x: 30, y: 78, align: "left" },
        ]}
        finale={
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-gold">Mlimani City · Dar es Salaam</p>
              <p className="mt-3 max-w-xl font-display text-[clamp(2rem,4vw,3.6rem)] leading-[1.02]">{settings.hotelName}</p>
            </div>
            <GlassButton href="/hotel">Discover the hotel</GlassButton>
          </div>
        }
      />

      {/* ═════════════ 3. Rooms — editorial ═════════════ */}
      <section id="rooms" className={cn(sheet, "scroll-mt-10 overflow-hidden bg-[#110e0b] pb-28 pt-24 text-white sm:pb-36 sm:pt-32")} aria-labelledby="rooms-title">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="vlh-glow absolute -left-40 top-1/3 size-[44rem] rounded-full bg-[radial-gradient(circle,oklch(0.72_0.12_80/0.14),transparent_65%)]" />
          <div className="absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(ellipse_at_top_right,oklch(0.5_0.05_60/0.25),transparent_60%)]" />
        </div>
        <div className={cn(container, "relative")}>
          <Reveal className="mb-14 grid gap-8 lg:mb-20 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <p className={cn(label, "text-gold")}>{rule}{h.rooms.kicker}</p>
              <h2 id="rooms-title" className="mt-6 font-display text-[clamp(2.6rem,5.5vw,5.6rem)] font-medium leading-[0.96] tracking-[-0.015em]">{h.rooms.title}</h2>
            </div>
            <div className="lg:col-span-4 lg:col-start-9">
              <p className={cn("text-white/65", type.body)}>{f(h.rooms.intro)} Website rates already include our online discount.</p>
              <div className="mt-6"><TextLink href="/rooms" tone="light">Compare all rooms</TextLink></div>
            </div>
          </Reveal>
          <RoomEditorial rooms={rooms} />
        </div>
      </section>

      {/* ═════════════ 4. Stay experience ═════════════ */}
      <section className={cn(sheet, "bg-paper pb-24 pt-20 sm:pb-32 sm:pt-28")} aria-labelledby="stay-title">
        <div className={container}>
          <Reveal className="mb-12 max-w-3xl lg:mb-16">
            <p className={cn(label, "text-accent-ink")}>{rule}{h.stay.kicker}</p>
            <h2 id="stay-title" className="mt-6 text-balance font-display text-[clamp(2.3rem,4.4vw,4.6rem)] font-medium leading-[1.02]">
              {h.stay.title} <span className="italic text-accent-ink">{h.stay.titleAccent}</span>
            </h2>
          </Reveal>
          <div className="grid gap-4 lg:h-[46rem] lg:grid-cols-12 lg:grid-rows-2">
            {/* Stay — the photograph leads */}
            <Link href={stayItem.href} className="vlh-zoom-frame vlh-clip group relative isolate flex min-h-[28rem] flex-col justify-end overflow-hidden rounded-[2rem] p-6 text-white sm:p-10 lg:col-span-7 lg:row-span-2">
              {"image" in stayItem && stayItem.image && <Image src={stayItem.image} alt="Suite at Vegas Luxury Hotel" fill sizes="(min-width:1024px) 58vw, 100vw" {...blurFor(stayItem.image)} className="vlh-zoom-target -z-10 object-cover" />}
              <span className="absolute inset-0 -z-10 bg-linear-to-t from-[#0d0b08]/90 via-[#0d0b08]/25 to-transparent" aria-hidden="true" />
              <span className="font-display text-[clamp(4rem,9vw,8rem)] leading-none">{stayItem.title}</span>
              <span className="vlh-glass mt-5 max-w-md rounded-2xl p-5 text-[15px] leading-relaxed text-white/90">{stayItem.body}</span>
            </Link>
            {/* Dine — atmosphere through light and type */}
            <Link href={dineItem.href} className="group relative isolate flex min-h-64 flex-col justify-between overflow-hidden rounded-[2rem] bg-[#15120e] p-8 text-white ring-1 ring-white/0 transition-transform pub-dark:ring-white/10 duration-500 hover:-translate-y-1 lg:col-span-5">
              <span aria-hidden="true" className="absolute -right-16 -top-16 -z-10 size-72 rounded-full bg-[radial-gradient(circle,oklch(0.72_0.12_80/0.35),transparent_65%)]" />
              <DiningIllustration className="absolute -bottom-6 -right-6 -z-10 h-56 w-56 text-gold/20 transition-transform duration-700 group-hover:scale-105" />
              <span className="flex items-center justify-between">
                <span className="font-display text-6xl">{dineItem.title}</span>
                <ArrowUpRight className="size-6 text-gold transition-transform duration-500 group-hover:rotate-45" aria-hidden="true" />
              </span>
              <span className="max-w-sm text-white/70">{dineItem.body}</span>
            </Link>
            {/* Connect */}
            <Link href={connectItem.href} className="group relative flex min-h-56 flex-col justify-between overflow-hidden rounded-[2rem] bg-gold p-7 text-[#15120e] transition-transform duration-500 hover:-translate-y-1 lg:col-span-2">
              <Wifi className="size-8" aria-hidden="true" />
              <span>
                <span className="block font-display text-4xl">{connectItem.title}</span>
                <span className="mt-2 block text-sm text-tone/75">{connectItem.body}</span>
              </span>
            </Link>
            {/* Gather */}
            <Link href={gatherItem.href} className="vlh-zoom-frame group relative isolate flex min-h-56 flex-col justify-end overflow-hidden rounded-[2rem] p-7 text-white lg:col-span-3">
              {"image" in gatherItem && gatherItem.image && <Image src={gatherItem.image} alt="Reception at Vegas Luxury Hotel" fill sizes="(min-width:1024px) 25vw, 100vw" {...blurFor(gatherItem.image)} className="vlh-zoom-target -z-10 object-cover" />}
              <span className="absolute inset-0 -z-10 bg-linear-to-t from-[#0d0b08]/90 via-[#0d0b08]/40 to-[#0d0b08]/10" aria-hidden="true" />
              <span className="block font-display text-4xl">{gatherItem.title}</span>
              <span className="mt-2 block text-sm text-white/75">{gatherItem.body}</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ═════════════ 5. Dining & bar — atmosphere ═════════════ */}
      <section id="dining" className={cn(sheet, "isolate overflow-hidden bg-[#140f0a] pb-56 pt-24 text-white sm:pb-64 sm:pt-32")} aria-labelledby="dining-title">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="vlh-glow absolute left-1/2 top-0 h-[36rem] w-[60rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,oklch(0.7_0.13_65/0.28),transparent_65%)]" />
          <div className="absolute bottom-0 right-0 size-[40rem] rounded-full bg-[radial-gradient(circle,oklch(0.55_0.12_40/0.22),transparent_65%)]" />
        </div>
        {/* Oversized cuisines drifting behind the content */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 -translate-y-[70%] opacity-30">
          <Marquee duration={70}>
            {c.pages.restaurant.cuisines.map((cu) => (
              <span key={cu} className="vlh-outline whitespace-nowrap font-display text-[clamp(5rem,13vw,13rem)] italic leading-none text-gold">{cu}</span>
            ))}
          </Marquee>
        </div>

        <div className={cn(container, "grid gap-14 lg:grid-cols-12 lg:items-center")}>
          <Reveal className="lg:col-span-5">
            <p className={cn(label, "text-gold")}>{rule}Dining at Vegas</p>
            <h2 id="dining-title" className="mt-6 text-balance font-display text-[clamp(2.6rem,5vw,5.2rem)] font-medium leading-[0.98]">
              {h.restaurant.title} <span className="italic text-gold">{h.restaurant.titleAccent}</span>
            </h2>
            <p className={cn("mt-7 max-w-lg text-white/70", type.body)}>{f(h.restaurant.body)}</p>
            <ul className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm uppercase tracking-[0.2em] text-white/75" aria-label="Meals served">
              {c.pages.restaurant.meals.map((m, i) => (
                <li key={m} className="flex items-center gap-4">{i > 0 && <span className="size-1 rotate-45 bg-gold" aria-hidden="true" />}{m}</li>
              ))}
            </ul>
            <div className="mt-10"><GoldButton href={h.restaurant.cta.href}>{h.restaurant.cta.label}</GoldButton></div>
          </Reveal>

          <div className="relative lg:col-span-6 lg:col-start-7">
            <div className="vlh-clip relative aspect-[4/5] overflow-hidden rounded-[2rem] sm:aspect-[5/4] lg:aspect-[4/5]">
              <Image src={ILLUSTRATIVE.restaurantWarm.src} alt={ILLUSTRATIVE.restaurantWarm.alt} fill sizes="(min-width:1024px) 46vw, 100vw" className="vlh-scroll-zoom object-cover" />
              <div className="absolute inset-0 bg-linear-to-t from-[#140f0a]/80 via-transparent to-[#140f0a]/20" aria-hidden="true" />
              <IllustrativeTag className="absolute right-4 top-4" />
            </div>
            <div className="absolute -bottom-10 -right-2 hidden w-[34%] overflow-hidden rounded-2xl border border-white/15 shadow-2xl sm:block lg:-right-8">
              <div className="relative aspect-[3/4]">
                <Image src={ILLUSTRATIVE.dinnerCityNight.src} alt={ILLUSTRATIVE.dinnerCityNight.alt} fill sizes="20vw" className="object-cover" />
              </div>
            </div>
            <div className="vlh-glass vlh-hud vlh-sweep relative -mt-24 ml-4 mr-4 rounded-[1.75rem] p-6 sm:absolute sm:-bottom-12 sm:-left-8 sm:m-0 sm:w-72">
              <p className="text-[10px] uppercase tracking-[0.3em] text-gold">{h.restaurant.menuKicker}</p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5">
                {c.pages.restaurant.cuisines.map((cu) => (
                  <li key={cu} className="font-display text-xl leading-snug text-white/90">{cu}</li>
                ))}
              </ul>
              <p className="mt-4 border-t border-white/15 pt-3 text-xs text-white/60">{c.pages.restaurant.dietary.join(" · ")} options</p>
            </div>
          </div>
        </div>

        {/* The bar */}
        <div className={cn(container, "mt-20 sm:mt-28")}>
          <Reveal className="vlh-glass-dark relative grid overflow-hidden rounded-[2rem] lg:grid-cols-12">
            <div aria-hidden="true" className="absolute -left-20 bottom-0 size-96 rounded-full bg-[radial-gradient(circle,oklch(0.65_0.14_55/0.3),transparent_65%)]" />
            <div className="relative p-8 sm:p-12 lg:col-span-7">
              <p className={cn(label, "text-gold")}>{rule}{h.bar.kicker}</p>
              <h3 className="mt-5 text-balance font-display text-[clamp(2rem,3.4vw,3.4rem)] leading-[1.04]">{h.bar.title} <span className="italic text-gold">{h.bar.titleAccent}</span></h3>
              <p className={cn("mt-5 max-w-md text-white/65", type.body)}>{f(h.bar.body)}</p>
              <div className="mt-8"><TextLink href={h.bar.cta.href} tone="light">{h.bar.cta.label}</TextLink></div>
            </div>
            <div className="vlh-zoom-frame relative min-h-72 lg:col-span-5">
              <Image src={ILLUSTRATIVE.barPour.src} alt={ILLUSTRATIVE.barPour.alt} fill sizes="(min-width:1024px) 40vw, 100vw" className="vlh-zoom-target object-cover" />
              <div className="absolute inset-0 bg-linear-to-r from-[#1a1510] via-[#1a1510]/20 to-transparent" aria-hidden="true" />
              <IllustrativeTag className="absolute right-4 top-4" />
              <BarIllustration className="vlh-float absolute bottom-6 right-6 h-20 w-20 text-gold drop-shadow-[0_0_14px_oklch(0.78_0.12_80/0.6)]" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═════════════ 6. Meeting room — overlaps the dining scene ═════════════ */}
      <section className="relative z-20 bg-paper pb-24 sm:pb-32" aria-labelledby="meeting-title">
        <div className={container}>
          <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
            <Reveal className="relative isolate -mt-40 min-h-[26rem] sm:-mt-48 overflow-hidden rounded-[2rem] bg-[#1c1812] shadow-[0_60px_120px_-50px_rgba(0,0,0,0.8)] lg:col-span-6 lg:min-h-[34rem]">
              <Image src={ILLUSTRATIVE.meetingRoom.src} alt={ILLUSTRATIVE.meetingRoom.alt} fill sizes="(min-width:1024px) 50vw, 100vw" className="vlh-scroll-zoom -z-10 object-cover" />
              <div className="absolute inset-0 -z-10 bg-linear-to-t from-[#0d0b08]/85 via-[#0d0b08]/20 to-transparent" aria-hidden="true" />
              <div className="absolute inset-0 -z-10 opacity-[0.12] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px]" aria-hidden="true" />
              <MeetingIllustration className="absolute right-6 top-6 h-20 w-20 text-gold drop-shadow-[0_0_12px_oklch(0.78_0.12_80/0.6)]" />
              <IllustrativeTag className="absolute left-5 top-5" />
              <div className="vlh-glass absolute inset-x-5 bottom-5 flex items-center justify-between rounded-2xl p-5 text-white sm:inset-x-8 sm:bottom-8">
                <span>
                  <span className="block text-[10px] uppercase tracking-[0.28em] text-gold">Private room</span>
                  <span className="mt-1 block font-display text-3xl">{h.meeting.title}</span>
                </span>
                <span className="text-right text-xs text-white/65">Restaurant<br />on site</span>
              </div>
            </Reveal>
            <Reveal delay={0.1} className="lg:col-span-5 lg:col-start-8 lg:pt-20">
              <p className="font-display text-sm uppercase tracking-[0.5em] text-accent-ink">Meet · Connect · Gather</p>
              <h2 id="meeting-title" className="mt-5 text-balance font-display text-[clamp(2.3rem,4vw,4rem)] font-medium leading-[1.02]">A private room for work that matters</h2>
              <p className={cn("mt-6 text-tone/70", type.body)}>{f(h.meeting.body)}</p>
              <ol className="mt-8 divide-y divide-tone/10 border-y border-tone/10">
                {h.meeting.events.map((e, i) => (
                  <li key={e} className="flex items-baseline gap-5 py-3.5">
                    <span className="text-xs tabular-nums text-accent-ink">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-display text-2xl">{e}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-9 flex flex-wrap items-center gap-6">
                <Link href={h.meeting.primaryCta.href} className="group inline-flex h-13 items-center gap-3 rounded-full bg-tone px-7 text-sm font-semibold uppercase tracking-[0.14em] text-paper transition-all hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                  {h.meeting.primaryCta.label}<ArrowRight className="size-4 text-gold transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
                <TextLink href={h.meeting.secondaryCta.href}>{h.meeting.secondaryCta.label}</TextLink>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ═════════════ 7. Gallery — immersive ═════════════ */}
      <section className={cn(sheet, "overflow-hidden bg-[#0d0b08] pb-24 pt-20 text-white sm:pb-32 sm:pt-28")} aria-labelledby="gallery-title">
        <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 size-[36rem] rounded-full bg-[radial-gradient(circle,oklch(0.72_0.12_80/0.12),transparent_65%)]" />
        <div className={cn(container, "relative")}>
          <Reveal className="mb-12 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between lg:mb-16">
            <div>
              <p className={cn(label, "text-gold")}>{rule}{h.gallery.kicker}</p>
              <h2 id="gallery-title" className="mt-6 font-display text-[clamp(2.6rem,5.5vw,5.6rem)] font-medium leading-[0.96]">{h.gallery.title}</h2>
            </div>
            <div className="sm:text-right">
              <p className="max-w-xs text-sm text-white/55">Every photograph is of our hotel — rooms, suites, bathrooms and reception.</p>
              <div className="mt-4"><TextLink href="/gallery" tone="light">Open the full gallery</TextLink></div>
            </div>
          </Reveal>
          <GalleryMosaic images={galleryImages.map((g) => ({ src: g.src, alt: g.alt, width: g.width, height: g.height }))} />
        </div>
      </section>

      {/* ═════════════ 8. Included — amenities ═════════════ */}
      <section className={cn(sheet, "bg-paper pb-24 pt-20 sm:pb-32 sm:pt-28")} aria-labelledby="included-title">
        <div className={cn(container, "grid gap-14 lg:grid-cols-12")}>
          <div className="lg:col-span-5">
            <Reveal>
              <p className={cn(label, "text-accent-ink")}>{rule}{h.experience.kicker}</p>
              <h2 id="included-title" className="mt-6 text-balance font-display text-[clamp(2.3rem,4vw,4rem)] font-medium leading-[1.02]">{h.experience.title}</h2>
              <p className={cn("mt-6 max-w-md text-tone/70", type.body)}>{f(h.experience.intro)}</p>
            </Reveal>
            <div className="vlh-clip relative mt-10 aspect-[4/3] overflow-hidden rounded-[2rem]">
              <Image src={h.experience.image.src} alt={h.experience.image.alt} fill sizes="(min-width:1024px) 40vw, 100vw" {...blurFor(h.experience.image.src)} className="vlh-scroll-zoom object-cover" />
              <p className="vlh-glass absolute bottom-4 left-4 rounded-full px-4 py-2 text-xs uppercase tracking-[0.2em] text-white">Jacuzzi bathtubs in many rooms</p>
            </div>
          </div>
          <ul className="grid content-center gap-x-10 sm:grid-cols-2 lg:col-span-6 lg:col-start-7">
            {h.experience.features.map((feat, i) => (
              <Reveal as="li" key={feat.title} delay={(i % 2) * 0.1} className="group border-t border-tone/12 py-8">
                <span className="flex items-center gap-4">
                  <span className="grid size-12 place-items-center rounded-full border border-accent-ink/30 text-accent-ink transition-colors duration-500 group-hover:border-tone group-hover:bg-[#15120e] group-hover:text-gold">
                    <NamedIcon name={feat.icon} className="size-5" />
                  </span>
                  <span className="text-xs tabular-nums text-tone/40">{String(i + 1).padStart(2, "0")}</span>
                </span>
                <h3 className="mt-5 font-display text-3xl">{feat.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-tone/65">{f(feat.body)}</p>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* ═════════════ 9. Dive to the hotel ═════════════ */}
      <CityDive
        stages={[
          { src: ILLUSTRATIVE.darCoastAerial.src, alt: ILLUSTRATIVE.darCoastAerial.alt, label: "Dar es Salaam", sub: "On the Indian Ocean coast", illustrative: true },
          { src: ILLUSTRATIVE.darCityAerial.src, alt: ILLUSTRATIVE.darCityAerial.alt, label: "Mwenge · Mlimani City", sub: `About ${c.facts.airportKm} km from the airport`, illustrative: true },
          { src: h.location.image.src, alt: h.location.image.alt, label: settings.hotelName, sub: "You have arrived" },
        ]}
        finale={
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-6">
              <h2 id="location-title" className="font-display text-[clamp(2.2rem,4.4vw,4.2rem)] font-medium leading-[1.02]">{h.location.title}</h2>
              <address className="mt-4 not-italic text-white/75">{address.join(" · ")}</address>
            </div>
            <div className="vlh-glass vlh-hud rounded-[1.75rem] p-6 lg:col-span-5 lg:col-start-8">
              <ul className="space-y-2.5 text-sm">
                {h.location.points.map((pt) => (
                  <li key={pt.title} className="flex gap-3"><NamedIcon name={pt.icon} className="mt-0.5 size-4 shrink-0 text-gold" /><span><span className="font-medium">{f(pt.title)}</span> <span className="text-white/60">— {f(pt.body)}</span></span></li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-white/15 pt-4 text-sm">
                {settings.phone && <a href={telHref(settings.phone)} className="inline-flex items-center gap-2 hover:text-gold"><Phone className="size-4 text-gold" aria-hidden="true" />{settings.phone}</a>}
                {settings.whatsapp && <a href={whatsappHref(settings.whatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-gold"><MessageCircle className="size-4 text-gold" aria-hidden="true" />WhatsApp<span className="sr-only"> (opens in a new tab)</span></a>}
                <TextLink href={MAP_LINK_URL} tone="light" external>Directions<span className="sr-only"> (opens Google Maps)</span></TextLink>
              </div>
            </div>
          </div>
        }
      />

      {/* ═════════════ 10. Final scene ═════════════ */}
      <section className={cn(sheet, "isolate flex min-h-[80svh] items-end overflow-hidden text-white")} aria-labelledby="cta-title">
        <div className="absolute inset-0 -z-20 overflow-hidden" aria-hidden="true">
          <div className="vlh-parallax absolute inset-x-0 -inset-y-[8%]">
            <Image src={h.cta.image.src} alt="" fill sizes="100vw" {...blurFor(h.cta.image.src)} className="object-cover" />
          </div>
        </div>
        <div aria-hidden="true" className="vlh-grain absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[linear-gradient(0deg,#0d0b08_5%,rgba(13,11,8,0.7)_45%,rgba(13,11,8,0.45)_100%)]" />
          <div className="vlh-glow absolute bottom-0 left-1/2 h-[30rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,oklch(0.72_0.12_80/0.25),transparent_65%)]" />
        </div>
        <div className={cn(container, "pb-20 pt-40 sm:pb-28")}>
          <Reveal>
            <p className={cn(label, "text-gold")}>{rule}{h.cta.kicker}</p>
            <h2 id="cta-title" className="mt-7 max-w-5xl font-display text-[clamp(3.2rem,9vw,9rem)] font-medium leading-[0.9] tracking-[-0.02em]">
              {h.cta.title} <span className="block italic text-gold">{h.cta.titleAccent}</span>
            </h2>
            <div className="mt-10 grid gap-8 lg:grid-cols-12 lg:items-end">
              <p className={cn("max-w-md text-white/75 lg:col-span-5", type.lead)}>{f(h.cta.body)}</p>
              <div className="flex flex-wrap gap-4 lg:col-span-7 lg:justify-end">
                <GoldButton href="/book">Book your stay</GoldButton>
                <GlassButton href="/contact">Contact the hotel</GlassButton>
              </div>
            </div>
            <p className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/15 pt-6 text-xs uppercase tracking-[0.22em] text-white/50">
              <span>No card needed</span><span>Pay at the hotel</span><span>Breakfast included</span>
              {settings.phone && <a href={telHref(settings.phone)} className="text-white/70 hover:text-gold">{settings.phone}</a>}
            </p>
          </Reveal>
        </div>
      </section>
    </>
  );
}
