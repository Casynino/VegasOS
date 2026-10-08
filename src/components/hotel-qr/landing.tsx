"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, CalendarCheck, ChevronRight, Lock, MapPin, MessageCircle, Phone, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { msg } from "@/i18n/msg";
import { NetworkMarks } from "@/components/payments/networks";
import type { QrLanding, QrRoomType } from "@/server/services/hotel-qr";
import type { ExplorePhoto, QrExplore } from "@/server/services/hotel-qr-explore";
import { BrandMark, card, darkButton, lightButton, Photo, Rail, Reveal, SectionHead } from "./ui";
import { Opening, type QrHero } from "./hero";
import { Accent, Actions, buttonClass, containers, Display, Eyebrow, HudLabel, TextLink, typeScale } from "@/components/public/kit";
import { LocalTime } from "@/components/public/cinema/local-time";
import heroCss from "@/components/public/home/home.module.css";
import { usePhotoViewer, type ViewPhoto } from "./viewer";
import { datesText, dayShort, holdsText, telHref, tzs, waHref, type LastBooking, type StayQuery } from "./lib";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";
import { ALT_ZH } from "@/components/public/content.zh-CN";

/** A photo's description in the reader's language: the site's Chinese photo descriptions (ALT_ZH, keyed by the English alt), else t(), else the English. */
const photoAlt = (alt: string, t: T) => (t.locale === "zh-CN" ? ALT_ZH[alt] ?? t(alt) : t(alt));
const asView = (p: ExplorePhoto, t: T): ViewPhoto => ({ src: p.src, alt: photoAlt(p.alt, t), label: p.label });

/**
 * THE FIRST SCREEN after the scan — the hotel to explore, like a resort's own app: the opening (the building, a room,
 * the bathroom, the meeting room… full screen) with the booking bar right under the words, then the rooms with their
 * photos and tonight's price, the hotel, food & drinks from the restaurant's own menu, the meeting room, what is good
 * to know and how to find us. Few words, many photos; every photo opens big.
 */
export function Landing({ landing, explore, hero, imagesOf, last, stay, onDates, onSee, onBookType, onTypeDetails }: {
  landing: QrLanding; explore: QrExplore; hero: QrHero; imagesOf: (t: { images: string[] }) => string[]; last: LastBooking | null;
  /** The stay the booking bar shows (tonight → tomorrow until the guest changes it). */
  stay: StayQuery;
  onDates: () => void; onSee: () => void; onBookType: (t: QrRoomType) => void; onTypeDetails: (t: QrRoomType) => void;
}) {
  const t = useT();
  const { hotel, roomTypes, booking } = landing;
  const from = roomTypes.length ? Math.min(...roomTypes.map((x) => x.fromPerNight)) : null;
  const closed = booking.open ? null : booking.message ?? msg("Booking here is not available right now — please ask reception or call us.");
  // (The highlights come in the guest's language: "Breakfast" is looked for in both.)
  const has = (word: RegExp) => hotel.highlights.some((h) => word.test(h));

  const freeTonight = roomTypes.some((x) => x.freeTonight > 0);
  // Phones: once the booking bar scrolls away, "See rooms" waits at the bottom.
  const bar = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setFloating(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
      <Opening hero={hero} hotel={hotel} onBook={closed ? null : onDates}>
        <div className={cn(containers.wide, "flex flex-1 flex-col justify-end pb-[calc(2.75rem+env(safe-area-inset-bottom))] pt-8 sm:pb-16 lg:pb-14 lg:pt-[calc(var(--pub-header-h)+3rem)]")}>
          <div className="lg:flex lg:items-end lg:justify-between lg:gap-12">
            <div className="max-w-3xl">
              <Eyebrow rule className="whitespace-nowrap max-[359px]:text-[10px] max-[359px]:tracking-[0.16em] max-[359px]:before:hidden">{hero.eyebrow}</Eyebrow>
              <Display id="qr-hero-title" className={cn("mt-5 sm:mt-6", heroCss.sheen)}>{hotel.name}</Display>
              <p className={cn(typeScale.subheading, "mt-4 text-pub-fg")}>{hero.title} <Accent>{hero.accent}</Accent></p>
              {closed ? (
                <p className="mt-6 max-w-md text-[14px] leading-relaxed text-pub-muted">
                  {t(closed)}{hotel.phone && <> <a href={telHref(hotel.phone)} className="font-semibold text-pub-fg underline underline-offset-4">{t("Call {phone}", { phone: hotel.phone })}</a></>}
                </p>
              ) : (
                <div ref={bar}>
                  <Actions className="mt-8">
                    <button type="button" onClick={onDates} className={buttonClass({ size: "md" })}>{t("Check availability")}</button>
                    <TextLink href="#rooms" icon="arrow">{t("Explore rooms")}</TextLink>
                  </Actions>
                </div>
              )}
              {!closed && from !== null && freeTonight && (
                <HudLabel as="p" live className="mt-6 text-pub-muted lg:mt-5">
                  {t.rich("Tonight from <b>{price}</b>", { b: (c) => <span className="ml-1 text-pub-fg">{c}</span> }, { price: tzs(from) })}
                </HudLabel>
              )}
            </div>

            {/* Computers: the hotel's local time and weather, as on the website. */}
            <div className="hidden shrink-0 flex-col items-end gap-3 pb-1 text-right lg:flex">
              <HudLabel live className="text-white/75">{t("Local time · {place}", { place: hero.place })}</HudLabel>
              <LocalTime initial={hero.initialTime} className="block font-display text-[3.25rem] leading-none text-pub-fg tabular-nums" />
              <HudLabel tick={false} className="text-white/75">{hero.weather ?? t("Check-in from {time}", { time: hotel.checkInTime })}</HudLabel>
              <span aria-hidden="true" className="mt-1 h-px w-36 bg-linear-to-l from-gold/80 to-transparent" />
            </div>
          </div>
        </div>
      </Opening>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <ExploreStrip places={[
          { id: "rooms", label: t("Rooms"), src: roomTypes.length ? explore.opening.find((x) => x.label === "Your room")?.tall.src ?? imagesOf(roomTypes[0])[0] : undefined },
          { id: "hotel", label: t("The hotel"), src: explore.hotel[0]?.src },
          { id: "food", label: t("Food"), src: explore.food.dishes[0]?.image },
          { id: "meeting", label: t("Meetings"), src: explore.meeting?.photo?.src },
          { id: "find", label: t("Find us"), src: explore.hotel.filter((p) => p.label === "Outside").find((p) => p.width > p.height)?.src ?? explore.hotel[0]?.src },
        ]} />

        {/* ── A booking made a moment ago in this tab ── */}
        {last && (
          <Link href={last.confirmUrl} className={cn(card, "mt-5 flex items-center gap-3 p-3.5 transition hover:ring-(--vr-gold) lg:mt-8 lg:max-w-xl")}>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><CalendarCheck className="size-[18px]" /></span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[14px] font-semibold">{t("Your booking {reference}", { reference: last.reference })}</span>
              <span className="mt-0.5 block truncate text-[12.5px] text-(--vr-muted)">{t(last.typeName)} · {dayShort(last.checkIn, t)} → {dayShort(last.checkOut, t)}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-(--vr-gold-ink)">{t("View")}<ChevronRight className="size-4" /></span>
          </Link>
        )}

        {/* ── The rooms ── */}
        {roomTypes.length > 0 && (
          <section id="rooms" aria-labelledby="rooms-title" className="scroll-mt-4 pt-12 lg:pt-20">
            <Reveal>
              <SectionHead id="rooms-title" eyebrow={t("Stay")} title={t("Our rooms")} line={t("Tonight’s prices, per room per night. Book a room and see what is free for {dates}.", { dates: datesText(stay, t) })} />
            </Reveal>
            <div className="mt-6 grid gap-x-10 gap-y-11 lg:mt-10 lg:grid-cols-2 lg:gap-y-16">
              {roomTypes.map((x, i) => (
                <RoomStory key={x.slug} t={x} images={imagesOf(x)} first={i === 0}
                  wide={roomTypes.length % 2 === 1 && i === roomTypes.length - 1 && roomTypes.length > 1}
                  onBook={() => onBookType(x)} onDetails={() => onTypeDetails(x)} closed={!!closed} />
              ))}
            </div>
          </section>
        )}

        {/* ── The hotel ── */}
        {explore.hotel.length > 0 && <HotelMosaic photos={explore.hotel} />}
      </div>

      {/* ── Food & drinks ── */}
      {explore.food.dishes.length > 0 && <Food food={explore.food} />}

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        {/* ── Meetings ── */}
        {explore.meeting && <Meeting meeting={explore.meeting} hotel={hotel} />}

        {/* ── Good to know · Find us ── */}
        <div className="grid gap-10 pt-14 lg:grid-cols-2 lg:gap-16 lg:pt-24">
          <Reveal>
            <section aria-labelledby="know-title">
              <SectionHead id="know-title" eyebrow={t("Your stay")} title={t("Good to know")} />
              <dl className="mt-5 divide-y divide-(--vr-line) border-y border-(--vr-line)">
                <Line label={t("Check-in")} value={t("from {time}", { time: hotel.checkInTime })} />
                <Line label={t("Check-out")} value={t("by {time}", { time: hotel.checkoutTime })} />
                {(hotel.breakfastHours || has(/breakfast|早餐/i)) && <Line label={t("Breakfast")} value={hotel.breakfastHours ? (has(/breakfast|早餐/i) ? t("{hours} · included", { hours: t(hotel.breakfastHours) }) : t(hotel.breakfastHours)) : t("Included")} />}
                {has(/wi-?fi/i) && <Line label={t("Wi-Fi")} value={t("Free, in every room")} />}
                <Line label={t("Reception")} value={hotel.receptionHours ? t(hotel.receptionHours) : t("24 hours")} />
              </dl>
              {landing.policies.length > 1 && (
                <details className="group mt-4">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-(--vr-gold-ink) [&::-webkit-details-marker]:hidden">
                    {t("Booking rules")}<ChevronRight className="size-4 transition group-open:rotate-90" />
                  </summary>
                  <ul className="mt-2.5 space-y-1.5 text-[12.5px] leading-relaxed text-(--vr-muted)">
                    {landing.policies.filter((p) => !p.startsWith("Check-in from")).map((p) => <li key={p}>{t(p)}</li>)}
                  </ul>
                </details>
              )}
            </section>
          </Reveal>
          <Reveal delay={0.08}>
            <FindUs hotel={hotel} mapHref={explore.mapHref} photo={explore.hotel.filter((p) => p.label === "Outside").find((p) => p.width > p.height) ?? null} />
          </Reveal>
        </div>

        <footer className="mt-16 flex flex-col items-center gap-3 border-t border-(--vr-line) pb-10 pt-8 text-center lg:mt-24 lg:pb-14">
          <BrandMark className="size-11" />
          <p className="font-display text-[20px] font-semibold leading-none">{hotel.name}</p>
          {hotel.address && <p className="max-w-xs text-[12px] leading-snug text-(--vr-muted)">{hotel.address}</p>}
          {booking.online && (
            <div className="mt-2 flex flex-col items-center gap-2">
              <NetworkMarks label={t("Pay with")} center className="w-full max-w-[300px]" />
              <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-(--vr-muted)"><Lock className="size-3 text-(--vr-gold-ink)" />{t.rich("Secure payment by <b>NTZS</b>", { b: (c) => <span className="font-semibold tracking-wide text-(--vr-ink)/80">{c}</span> })}</p>
            </div>
          )}
          <a href="/" target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-[12px] text-(--vr-muted) underline-offset-4 hover:text-(--vr-ink) hover:underline">
            {t("Our website")}<ArrowUpRight className="size-3.5" />
          </a>
        </footer>
      </div>

      {/* Phones: "See rooms" once the booking bar is gone */}
      <AnimatePresence>
        {floating && !closed && (
          <motion.div initial={{ y: 90 }} animate={{ y: 0 }} exit={{ y: 90 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
            <button type="button" onClick={onSee} className={cn(darkButton, "mx-auto flex h-14 w-full max-w-md justify-between pl-5 pr-4 shadow-[0_16px_40px_-14px_rgba(29,23,18,0.85)]")}>
              <span className="min-w-0 text-left leading-tight">
                <span className="block text-[14.5px]">{t("See rooms")}</span>
                <span className="block truncate text-[11.5px] font-normal text-white/60">{datesText(stay, t)} · {t.plural(stay.adults + stay.children, "{n} guest", "{n} guests")}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-2 text-[13px] font-medium text-white/70">
                {from !== null && t.rich("from <b>{price}</b>", { b: (c) => <span className="font-semibold tabular-nums text-(--vr-gold)">{c}</span> }, { price: tzs(from) })}
                <ArrowRight className="size-4 text-(--vr-gold)" />
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Phones: the places to explore as small round photos under the opening — a tap glides to that part of the page.
 * (Computers see the whole page at a glance.)
 */
function ExploreStrip({ places }: { places: { id: string; label: string; src?: string }[] }) {
  const t = useT();
  const shown = places.filter((p): p is { id: string; label: string; src: string } => !!p.src);
  if (shown.length < 3) return null;
  const glide = (id: string) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  return (
    <nav aria-label={t("Explore")} className="pt-6 lg:hidden">
      <ul className="grid gap-2 sm:flex sm:gap-8" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((p) => (
          <li key={p.id} className="flex justify-center">
            <button type="button" onClick={() => glide(p.id)} className="group flex w-full flex-col items-center gap-1.5 text-center sm:w-[64px]">
              <span className="relative size-[56px] overflow-hidden rounded-full bg-(--vr-line) ring-[1.5px] ring-(--vr-gold)/55 ring-offset-2 ring-offset-(--vr-bg) sm:size-[64px]">
                <Photo src={p.src} alt="" sizes="64px" imgClassName="transition-[opacity,scale] duration-500 group-active:scale-110" />
              </span>
              <span className="text-[11.5px] font-medium leading-tight text-(--vr-ink)/80">{p.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One room type: its photos to swipe (tap one to see them big), its name, who it takes, tonight's price, Book. */
function RoomStory({ t: type, images, first, wide, onBook, onDetails, closed }: {
  t: QrRoomType; images: string[]; first: boolean; wide: boolean; onBook: () => void; onDetails: () => void; closed: boolean;
}) {
  const t = useT();
  const view = usePhotoViewer();
  const name = t(type.name);
  const photos = images.map((src, k) => ({ src, alt: k === 0 ? name : t("{name} — photo {n}", { name, n: k + 1 }), label: name }));
  const many = photos.length > 1;
  return (
    <Reveal className={cn(wide && "lg:col-span-2")}>
      <article aria-label={name} className={cn(wide && "lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-center lg:gap-12")}>
        <Rail label={t("Photos of {name}", { name })}>
          {photos.map((p, k) => (
            <button key={`${p.src}-${k}`} type="button" onClick={() => view(photos, k)} aria-label={t("See {photo} full screen", { photo: p.alt })}
              className={cn("group relative aspect-[4/3] shrink-0 snap-start overflow-hidden rounded-[22px] bg-(--vr-line)",
                many ? "w-[86%] sm:w-[62%] lg:w-[86%]" : "w-full", wide && many && "lg:w-[64%]")}>
              <Photo src={p.src} alt={p.alt} sizes={wide ? "(min-width:1024px) 520px, 86vw" : "(min-width:1024px) 520px, (min-width:640px) 62vw, 86vw"} eager={first && k === 0}
                imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100" />
            </button>
          ))}
        </Rail>
        <div className={cn("mt-3", wide && "lg:mt-0")}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-display text-[27px] font-semibold leading-[1.02] lg:text-[32px]">{name}</h3>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--vr-muted)">
                <span className="inline-flex items-center gap-1.5"><Users className="size-3.5 text-(--vr-gold-ink)" />{holdsText(type, t)}</span>
                <FreeTonight n={type.freeTonight} />
              </p>
            </div>
            <p className="shrink-0 pt-0.5 text-right leading-tight">
              <span className="block text-[11px] text-(--vr-muted)">{t("from")}</span>
              <span className="block text-[18px] font-semibold tabular-nums">{tzs(type.fromPerNight)}</span>
              {type.fromPerNight < type.baseRate
                ? <s className="block text-[11.5px] tabular-nums text-(--vr-muted)">{tzs(type.baseRate)}</s>
                : <span className="block text-[11.5px] text-(--vr-muted)">{t("a night")}</span>}
            </p>
          </div>
          {type.shortDescription && <p className="mt-2.5 line-clamp-2 max-w-xl text-[13.5px] leading-relaxed text-(--vr-ink)/75">{t(type.shortDescription)}</p>}
          <div className="mt-3.5 flex items-center gap-2.5">
            <button type="button" onClick={onBook} disabled={closed} className={cn(darkButton, "h-12 flex-1 px-6 text-[14.5px] sm:flex-none sm:px-9")}>
              {t("Book")}<ArrowRight className="size-4 text-(--vr-gold)" />
            </button>
            <button type="button" onClick={onDetails} className={cn(lightButton, "h-12 px-6 text-[14px]")}>{t("Details")}</button>
          </div>
        </div>
      </article>
    </Reveal>
  );
}

/** "3 free tonight" — or that the type is full tonight (other nights may be free). */
export function FreeTonight({ n, className }: { n: number; className?: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium", n > 0 ? "text-emerald-700" : "text-(--vr-muted)", className)}>
      <span className={cn("size-1.5 rounded-full", n > 0 ? "bg-emerald-500" : "bg-(--vr-muted)/50")} />
      {n > 0 ? t("{n} free tonight", { n }) : t("Full tonight")}
    </span>
  );
}

/** THE HOTEL — a mosaic of five (outside, reception, a detail, a bathroom, outside again); every photo opens the whole set. */
function HotelMosaic({ photos }: { photos: ExplorePhoto[] }) {
  const t = useT();
  const view = usePhotoViewer();
  const all = photos.map((p) => asView(p, t));
  const firstOf = (label: string, skip = 0) => photos.filter((p) => p.label === label)[skip];
  const tiles = [firstOf("Outside"), firstOf("Reception"), firstOf("Details") ?? firstOf("Rooms"), firstOf("Bathrooms"), firstOf("Outside", 1) ?? firstOf("Rooms", 1)]
    .filter((p, k, list): p is ExplorePhoto => !!p && list.indexOf(p) === k);
  const shape = ["row-span-2 lg:col-span-2", "", "", "", ""];
  const rest = photos.length - tiles.length;
  return (
    <section id="hotel" aria-labelledby="hotel-title" className="scroll-mt-4 pt-16 lg:pt-28">
      <Reveal>
        <SectionHead id="hotel-title" eyebrow={t("The hotel")} title={t("Take a look around")} line={t("Outside, reception, the rooms and the little things — our own photos.")}
          action={<button type="button" onClick={() => view(all, 0)} className="hidden items-center gap-1 text-[13px] font-medium text-(--vr-gold-ink) hover:underline sm:inline-flex">{t("All {n} photos", { n: photos.length })}<ChevronRight className="size-4" /></button>} />
      </Reveal>
      <Reveal delay={0.05}>
        <div className="mt-6 grid auto-rows-[150px] grid-cols-2 gap-2 sm:auto-rows-[200px] lg:mt-10 lg:auto-rows-[240px] lg:grid-cols-4 lg:gap-3">
          {tiles.map((p, k) => {
            const last = k === tiles.length - 1 && rest > 0;
            return (
              <button key={p.src} type="button" onClick={() => view(all, photos.indexOf(p))} aria-label={last ? t("See all {n} photos", { n: photos.length }) : t("See {photo} full screen", { photo: photoAlt(p.alt, t) })}
                className={cn("group relative overflow-hidden rounded-[20px] bg-(--vr-line)", shape[k], tiles.length === 4 && k === 3 && "col-span-2 lg:col-span-1")}>
                <Photo src={p.src} alt={photoAlt(p.alt, t)} sizes={k === 0 ? "(min-width:1024px) 620px, 50vw" : "(min-width:1024px) 310px, 50vw"}
                  imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-[1.04] motion-reduce:group-hover:scale-100" />
                {last && (
                  <span className="absolute inset-0 grid place-items-center bg-(--vr-dark)/55 text-white backdrop-blur-[1px] transition group-hover:bg-(--vr-dark)/45">
                    <span className="text-center leading-tight"><span className="block font-display text-[28px] font-semibold">+{rest}</span><span className="text-[12px] text-white/80">{t("photos")}</span></span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Reveal>
    </section>
  );
}

/** FOOD & DRINKS — on the dark band: dishes from the restaurant's own menu (with prices), and the whole menu a tap away. */
function Food({ food }: { food: QrExplore["food"] }) {
  const t = useT();
  const view = usePhotoViewer();
  const price = (d: QrExplore["food"]["dishes"][number]) => (d.from ? t("from {price}", { price: tzs(d.price) }) : tzs(d.price));
  const photos = food.dishes.map((d) => ({ src: d.image, alt: t(d.name), label: `${t(d.name)} · ${price(d)}` }));
  const hours = [food.restaurantHours && t("Kitchen {hours}", { hours: t(food.restaurantHours) }), food.barHours && t("Bar {hours}", { hours: t(food.barHours) })].filter(Boolean).join(" · ");
  return (
    <section id="food" aria-labelledby="food-title" className="relative mt-16 scroll-mt-0 overflow-hidden bg-(--vr-dark) py-14 text-white lg:mt-28 lg:py-24">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-(--vr-gold)/10 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <Reveal>
          <SectionHead id="food-title" dark eyebrow={t("Restaurant & bar")} title={t("Food & drinks")}
            line={[t(food.note), hours].filter(Boolean).join(" · ")}
            action={<a href={food.menuHref} target="_blank" rel="noopener" className="hidden items-center gap-1 text-[13px] font-medium text-(--vr-gold) hover:underline sm:inline-flex">{t("Full menu")}<ArrowUpRight className="size-4" /><span className="sr-only"> {t("(opens in a new tab)")}</span></a>} />
        </Reveal>
        <Reveal delay={0.05} className="mt-6 lg:mt-10">
          <Rail label={t("Dishes and drinks")} dark>
            {food.dishes.map((d, k) => (
              <button key={d.key} type="button" onClick={() => view(photos, k)} aria-label={t("{name}, {price} — see the photo", { name: t(d.name), price: tzs(d.price) })}
                className="group w-[46%] shrink-0 snap-start text-left sm:w-[30%] lg:w-[calc((100%-36px)/4)]">
                <span className="relative block aspect-square overflow-hidden rounded-[20px] bg-white/5">
                  <Image src={d.image} alt={t(d.name)} fill sizes="(min-width:1024px) 300px, (min-width:640px) 30vw, 46vw"
                    className="object-cover transition duration-700 group-hover:scale-105 motion-reduce:transition-none" />
                </span>
                <span className="mt-2.5 line-clamp-2 block text-[14.5px] font-semibold leading-snug">{t(d.name)}</span>
                <span className="mt-0.5 block text-[12.5px] tabular-nums text-white/60">{price(d)}</span>
              </button>
            ))}
          </Rail>
        </Reveal>
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <a href={food.menuHref} target="_blank" rel="noopener"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[14.5px] font-semibold ring-1 ring-white/25 transition hover:bg-white/10 sm:w-auto">
            {t("See the full menu")}<ArrowUpRight className="size-4 text-(--vr-gold)" /><span className="sr-only"> {t("(opens in a new tab)")}</span>
          </a>
          {food.credits.length > 0 && (
            <details className="group max-w-xl text-[11.5px] text-white/45">
              <summary className="cursor-pointer list-none leading-relaxed [&::-webkit-details-marker]:hidden">
                {t("Photos are illustrative — served the house way.")} <span className="underline underline-offset-4 group-open:text-white/70">{t("Photo credits")}</span>
              </summary>
              <ul className="mt-2 space-y-1">
                {food.credits.map((c) => (
                  <li key={c.sourcePage} className="leading-relaxed">
                    {t(c.item)} — <a href={c.sourcePage} target="_blank" rel="noopener nofollow" className="hover:text-white/80 hover:underline">{c.creator}</a>,{" "}
                    <a href={c.licenseUrl} target="_blank" rel="noopener nofollow" className="hover:text-white/80 hover:underline">{c.license}</a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}

/** MEETINGS — the boardroom photo, how many it takes, and its page (in a new tab). */
function Meeting({ meeting, hotel }: { meeting: NonNullable<QrExplore["meeting"]>; hotel: QrLanding["hotel"] }) {
  const t = useT();
  const view = usePhotoViewer();
  return (
    <section id="meeting" aria-labelledby="meeting-title" className="scroll-mt-4 pt-16 lg:pt-28">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
        {meeting.photo && (
          <Reveal>
            <button type="button" onClick={() => view([asView(meeting.photo!, t)], 0)} aria-label={t("See {photo} full screen", { photo: photoAlt(meeting.photo.alt, t) })}
              className="group relative block aspect-[16/10] w-full overflow-hidden rounded-[24px] bg-(--vr-line)">
              <Photo src={meeting.photo.src} alt={photoAlt(meeting.photo.alt, t)} sizes="(min-width:1024px) 720px, 100vw"
                imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100" />
            </button>
          </Reveal>
        )}
        <Reveal delay={0.06}>
          <SectionHead id="meeting-title" eyebrow={t("Meetings")} title={t(meeting.name)} line={meeting.about ? t(meeting.about) : t("A quiet room for your meeting, booked by the hour.")} />
          <dl className="mt-5 divide-y divide-(--vr-line) border-y border-(--vr-line)">
            <Line label={t("Room for")} value={t("Up to {n} people", { n: meeting.capacity })} />
          </dl>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href={meeting.href} target="_blank" rel="noopener" className={cn(darkButton, "h-12 px-6 text-[14.5px]")}>
              {t("See the meeting room")}<ArrowUpRight className="size-4 text-(--vr-gold)" /><span className="sr-only"> {t("(opens in a new tab)")}</span>
            </a>
            {hotel.whatsapp && (
              <a href={waHref(hotel.whatsapp, `Hello ${hotel.name}, I would like to book the ${meeting.name}.`)} target="_blank" rel="noopener"
                className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-(--vr-gold-ink) hover:underline">
                <MessageCircle className="size-4" />{t("Ask about a date")}
              </a>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/** FIND US — where the hotel is, a photo of the entrance, and directions / call / WhatsApp as plain rows. */
function FindUs({ hotel, mapHref, photo }: { hotel: QrLanding["hotel"]; mapHref: string; photo: ExplorePhoto | null }) {
  const t = useT();
  const view = usePhotoViewer();
  const row = "flex items-center gap-3 py-3.5 text-[14.5px] font-medium transition hover:text-(--vr-gold-ink)";
  return (
    <section id="find" aria-labelledby="find-title" className="scroll-mt-16">
      <SectionHead id="find-title" eyebrow={t("Find us")} title={t("Where we are")} line={hotel.address ?? undefined} />
      {photo && (
        <button type="button" onClick={() => view([asView(photo, t)], 0)} aria-label={t("See {photo} full screen", { photo: photoAlt(photo.alt, t) })}
          className="group relative mt-5 block aspect-[16/9] w-full overflow-hidden rounded-[20px] bg-(--vr-line)">
          <Photo src={photo.src} alt={photoAlt(photo.alt, t)} sizes="(min-width:1024px) 560px, 100vw" imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100" />
        </button>
      )}
      <div className="mt-4 divide-y divide-(--vr-line) border-y border-(--vr-line)">
        <a href={mapHref} target="_blank" rel="noopener" className={row}>
          <MapPin className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">{t("Directions")}</span><ArrowUpRight className="size-4 text-(--vr-muted)" />
        </a>
        {hotel.phone && (
          <a href={telHref(hotel.phone)} className={row}>
            <Phone className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">{t.rich("Call <b>{phone}</b>", { b: (c) => <span className="tabular-nums text-(--vr-muted)">{c}</span> }, { phone: hotel.phone })}</span><ChevronRight className="size-4 text-(--vr-muted)" />
          </a>
        )}
        {hotel.whatsapp && (
          <a href={waHref(hotel.whatsapp, `Hello ${hotel.name}, I would like to ask about a room.`)} target="_blank" rel="noopener" className={row}>
            <MessageCircle className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">WhatsApp</span><ArrowUpRight className="size-4 text-(--vr-muted)" />
          </a>
        )}
      </div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3.5">
      <dt className="text-[13.5px] text-(--vr-muted)">{label}</dt>
      <dd className="text-right text-[14.5px] font-semibold">{value}</dd>
    </div>
  );
}
