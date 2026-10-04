import type { Metadata } from "next";
import { ViewTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Baby, BedDouble, ChevronLeft, Clock, Maximize2, User } from "lucide-react";
import { getSettings } from "@/server/settings";
import { bookingWindow, getPublicRoomType, listPublicRoomTypes, websitePricer } from "@/server/services/public-booking";
import { addDays } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { blurFor } from "@/components/public/blur-data";
import { telHref, whatsappHref } from "@/components/public/contact";
import { NamedIcon } from "@/components/public/icon";
import { Ornament } from "@/components/public/ornament";
import { PillLink } from "@/components/public/pill-link";
import { Reveal } from "@/components/public/reveal";
import { RoomCard } from "@/components/public/room-card";
import { RoomGallery } from "@/components/public/room-gallery";
import { photo } from "@/components/public/site-config";
import { StaySearchForm } from "@/components/public/stay-search-form";
import { container, cream, espresso, eyebrow, goldText, type } from "@/components/public/ui";

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

export default async function RoomPage({ params }: PageProps<"/rooms/[slug]">) {
  const { slug } = await params;
  const [room, settings, all] = await Promise.all([getPublicRoomType(slug), getSettings(), listPublicRoomTypes()]);
  if (!room) notFound();
  const window = bookingWindow(settings);
  const priceOf = await websitePricer(settings);
  const price = priceOf(room);
  const images = room.images.map((src) => ({ ...photo(src), alt: `${room.name}: ${photo(src).alt.toLowerCase()}` }));
  const hero = images[0];
  const amenities = [...room.amenities].sort((a, b) => Number(HIGHLIGHT.has(b.code)) - Number(HIGHLIGHT.has(a.code)));
  const others = all.filter((t) => t.slug !== room.slug).slice(0, 3).map((t) => {
    const p = priceOf(t);
    return { ...t, image: t.images[0], net: p.net, baseRate: p.baseRate, promo: p.promoLabel };
  });

  const bookingPanel = (
    <div className="rounded-[2rem] bg-panel p-6 shadow-[0_30px_80px_-40px_rgba(21,18,14,0.45)] ring-1 ring-tone/[0.07] sm:p-7">
      <p className="text-[11px] uppercase tracking-[0.22em] text-tone/60">From, per night</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
        <span className="font-display text-5xl font-semibold">{formatTZS(price.net)}</span>
        {price.discount > 0 && (
          <s className="text-tone/50"><span className="sr-only">instead of </span>{formatTZS(price.baseRate)}</s>
        )}
      </p>
      {price.discount > 0 && (
        <p className="mt-2 inline-flex rounded-full bg-gold/15 px-3 py-1 text-xs font-medium text-accent-ink">
          {price.promotion ?? "Website rate"}{price.promoLabel ? ` · ${price.promoLabel}` : ""} · save {formatTZS(price.discount)} per night
        </p>
      )}
      <p className="mt-3 text-sm text-tone/65">Breakfast and Wi-Fi included · pay at the hotel</p>
      <div className="my-6 h-px bg-[#15120e]/10" />
      {window.enabled ? (
        <>
          <h2 className="font-display text-2xl">Check availability</h2>
          <div className="mt-4">
            <StaySearchForm
              variant="panel"
              defaults={{ checkIn: window.today, checkOut: addDays(window.today, 1), adults: Math.min(2, room.maxAdults), children: 0, type: room.slug }}
              minDate={window.today}
              maxDate={window.maxArrival}
              maxNights={window.maxNights}
              submitLabel="Check dates"
              stacked
            />
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-tone/70">Online booking is paused — contact us and we’ll reserve this room for you.</p>
          {settings.phone && <PillLink href={telHref(settings.phone)} external variant="dark" className="w-full justify-between">Call {settings.phone}</PillLink>}
          {settings.whatsapp && <PillLink href={whatsappHref(settings.whatsapp, `Hello, I would like to book a ${room.name}.`)} external target="_blank" rel="noopener noreferrer" variant="outline" className="w-full justify-between">WhatsApp</PillLink>}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Hero */}
      <section className={cn(espresso, "relative isolate overflow-hidden text-white")} aria-labelledby="room-title">
        {hero && (
          <ViewTransition name={`room-${room.slug}`} share="vlh-morph" default="none">
            <Image src={hero.src} alt={hero.alt} fill priority sizes="100vw" {...blurFor(hero.src)} className="-z-10 object-cover" />
          </ViewTransition>
        )}
        <div className="absolute inset-0 -z-10 bg-linear-to-t from-[#15120e] via-[#15120e]/50 to-[#15120e]/10" aria-hidden="true" />
        <div className={cn(container, "flex min-h-[420px] flex-col justify-end pb-10 pt-24 sm:min-h-[62svh] sm:pb-14")}>
          <Link href="/rooms" className="mb-auto inline-flex w-fit items-center gap-1.5 rounded-full border border-white/20 bg-[#15120e]/40 px-4 py-2 text-sm text-white/85 backdrop-blur-md hover:border-gold hover:text-gold">
            <ChevronLeft className="size-4" aria-hidden="true" /> All rooms
          </Link>
          <p className={cn(eyebrow, "mt-10 text-gold")}>Room type</p>
          <h1 id="room-title" className={cn("mt-3 text-balance", type.display)}>{room.name}</h1>
          <ul className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="Room facts">
            <li className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 backdrop-blur-md"><User className="size-4 text-gold" aria-hidden="true" />Up to {room.maxAdults} adult{room.maxAdults === 1 ? "" : "s"}</li>
            {room.maxChildren > 0 && <li className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 backdrop-blur-md"><Baby className="size-4 text-gold" aria-hidden="true" />{room.maxChildren} child{room.maxChildren === 1 ? "" : "ren"}</li>}
            {room.bedType && <li className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 backdrop-blur-md"><BedDouble className="size-4 text-gold" aria-hidden="true" />{room.bedType}</li>}
            {room.sizeSqm && <li className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 backdrop-blur-md"><Maximize2 className="size-4 text-gold" aria-hidden="true" />{room.sizeSqm} m²</li>}
          </ul>
        </div>
      </section>

      {/* Body */}
      <section className={cn(cream, "py-14 sm:py-20")}>
        <div className={cn(container, "grid gap-12 lg:grid-cols-[1.6fr_1fr] lg:gap-14")}>
          <div className="min-w-0">
            {images.length > 1 && <RoomGallery images={images} roomName={room.name} />}

            <Reveal className="mt-12">
              <p className={cn(eyebrow, goldText)}>About this room</p>
              <h2 className={cn("mt-3", type.h2)}>{room.shortDescription ?? room.name}</h2>
              <Ornament className="mt-5" />
              {room.description && <p className={cn("mt-6 max-w-2xl text-tone/75", type.lead)}>{room.description}</p>}
            </Reveal>

            {amenities.length > 0 && (
              <Reveal className="mt-12">
                <h2 className={type.h3}>Amenities</h2>
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                  {amenities.map((a) => (
                    <li
                      key={a.code}
                      className={cn(
                        "flex items-center gap-4 rounded-2xl px-5 py-4",
                        HIGHLIGHT.has(a.code) ? cn(espresso, "text-white") : "bg-panel ring-1 ring-tone/[0.06]",
                      )}
                    >
                      <span className={cn("grid size-10 shrink-0 place-items-center rounded-full border", HIGHLIGHT.has(a.code) ? "border-gold/40 text-gold" : "border-accent-ink/30 text-accent-ink")}>
                        <NamedIcon name={a.icon} className="size-5" />
                      </span>
                      <span className="font-medium">{a.name}</span>
                      {HIGHLIGHT.has(a.code) && <span className="ml-auto rounded-full bg-gold/15 px-2.5 py-1 text-[11px] uppercase tracking-wider text-gold">Included</span>}
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}

            <Reveal className="mt-12 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-panel p-6 ring-1 ring-tone/[0.06]">
                <Clock className="size-5 text-accent-ink" aria-hidden="true" />
                <p className="mt-3 font-medium">Check-in from {window.checkInTime}</p>
                <p className="mt-1 text-sm text-tone/65">Our 24-hour front desk welcomes late arrivals.</p>
              </div>
              <div className="rounded-2xl bg-panel p-6 ring-1 ring-tone/[0.06]">
                <Clock className="size-5 text-accent-ink" aria-hidden="true" />
                <p className="mt-3 font-medium">Check-out by {window.checkoutTime}</p>
                <p className="mt-1 text-sm text-tone/65">Payment is taken at the hotel during your stay.</p>
              </div>
            </Reveal>
          </div>

          {/* Sticky booking panel (desktop) / inline (mobile) */}
          <aside id="book" aria-label={`Book the ${room.name}`} className="scroll-mt-24">
            <div className="lg:sticky lg:top-28">{bookingPanel}</div>
          </aside>
        </div>
      </section>

      {others.length > 0 && (
        <section className={cn(espresso, "py-16 text-white sm:py-24")} aria-labelledby="other-rooms">
          <div className={container}>
            <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <h2 id="other-rooms" className={type.h2}>Other rooms</h2>
              <PillLink href="/rooms" variant="glass" className="self-start">All rooms</PillLink>
            </div>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((r) => <li key={r.slug}><RoomCard room={r} /></li>)}
            </ul>
          </div>
        </section>
      )}

      {/* Sticky mobile CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#15120e]/92 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 text-white backdrop-blur-xl sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-white/60">{room.name} · from</p>
            <p className="font-display text-2xl leading-tight text-gold">{formatTZS(price.net)}<span className="text-sm text-white/60"> /night</span></p>
          </div>
          <PillLink href={window.enabled ? "#book" : "/contact?subject=booking"} className="h-12 shrink-0">Book</PillLink>
        </div>
      </div>
    </>
  );
}
