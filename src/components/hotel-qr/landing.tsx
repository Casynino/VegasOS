"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, CalendarCheck, ChevronRight, Lock, MapPin, MessageCircle, Phone, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { NetworkMarks } from "@/components/payments/networks";
import type { QrLanding, QrRoomType } from "@/server/services/hotel-qr";
import type { ExplorePhoto, QrExplore } from "@/server/services/hotel-qr-explore";
import { BrandMark, card, darkButton, lightButton, Photo, Rail, Reveal, SectionHead } from "./ui";
import { BookingBar, Opening } from "./hero";
import { usePhotoViewer, type ViewPhoto } from "./viewer";
import { datesText, dayShort, holdsText, telHref, tzs, waHref, type LastBooking, type StayQuery } from "./lib";

const asView = (p: ExplorePhoto): ViewPhoto => ({ src: p.src, alt: p.alt, label: p.label });

/**
 * THE FIRST SCREEN after the scan — the hotel to explore, like a resort's own app: the opening (the building, a room,
 * the bathroom, the meeting room… full screen) with the booking bar right under the words, then the rooms with their
 * photos and tonight's price, the hotel, food & drinks from the restaurant's own menu, the meeting room, what is good
 * to know and how to find us. Few words, many photos; every photo opens big.
 */
export function Landing({ landing, explore, imagesOf, last, stay, onDates, onSee, onBookType, onTypeDetails }: {
  landing: QrLanding; explore: QrExplore; imagesOf: (t: { images: string[] }) => string[]; last: LastBooking | null;
  /** The stay the booking bar shows (tonight → tomorrow until the guest changes it). */
  stay: StayQuery;
  onDates: () => void; onSee: () => void; onBookType: (t: QrRoomType) => void; onTypeDetails: (t: QrRoomType) => void;
}) {
  const { hotel, roomTypes, booking } = landing;
  const from = roomTypes.length ? Math.min(...roomTypes.map((t) => t.fromPerNight)) : null;
  const closed = booking.open ? null : booking.message ?? "Booking here is not available right now — please ask reception or call us.";
  const slides = explore.opening.length ? explore.opening : [{ label: hotel.name, tall: { ...hotel.hero, label: hotel.name, width: 1600, height: 1067 }, wide: { ...hotel.hero, label: hotel.name, width: 1600, height: 1067 } }];
  const has = (word: RegExp) => hotel.highlights.some((h) => word.test(h));

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

  const line = [from !== null ? `Rooms from ${tzs(from)} a night` : null, has(/breakfast/i) ? "breakfast included" : null].filter(Boolean).join(" · ");
  return (
    <div className="pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
      <Opening slides={slides} hotel={hotel}>
        <h1 className="mt-3 font-display text-[40px] font-semibold leading-[0.98] tracking-tight sm:text-[48px] lg:mt-5 lg:max-w-2xl lg:text-[76px]">
          Your stay <span className="text-(--vr-gold)">starts here.</span>
        </h1>
        {line && <p className="mt-2.5 text-[13.5px] text-white/70 lg:mt-4 lg:text-[16px]">{line}</p>}
        <div ref={bar} className="mt-5 lg:mt-8 lg:max-w-4xl">
          <BookingBar stay={stay} onDates={onDates} onSee={onSee} closed={closed} phone={hotel.phone} />
        </div>
      </Opening>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <ExploreStrip places={[
          { id: "rooms", label: "Rooms", src: roomTypes.length ? explore.opening.find((x) => x.label === "Your room")?.tall.src ?? imagesOf(roomTypes[0])[0] : undefined },
          { id: "hotel", label: "The hotel", src: explore.hotel[0]?.src },
          { id: "food", label: "Food", src: explore.food.dishes[0]?.image },
          { id: "meeting", label: "Meetings", src: explore.meeting?.photo?.src },
          { id: "find", label: "Find us", src: explore.hotel.filter((p) => p.label === "Outside").find((p) => p.width > p.height)?.src ?? explore.hotel[0]?.src },
        ]} />

        {/* ── A booking made a moment ago in this tab ── */}
        {last && (
          <Link href={last.confirmUrl} className={cn(card, "mt-5 flex items-center gap-3 p-3.5 transition hover:ring-(--vr-gold) lg:mt-8 lg:max-w-xl")}>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><CalendarCheck className="size-[18px]" /></span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[14px] font-semibold">Your booking {last.reference}</span>
              <span className="mt-0.5 block truncate text-[12.5px] text-(--vr-muted)">{last.typeName} · {dayShort(last.checkIn)} → {dayShort(last.checkOut)}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-(--vr-gold-ink)">View<ChevronRight className="size-4" /></span>
          </Link>
        )}

        {/* ── The rooms ── */}
        {roomTypes.length > 0 && (
          <section id="rooms" aria-labelledby="rooms-title" className="scroll-mt-4 pt-12 lg:pt-20">
            <Reveal>
              <SectionHead id="rooms-title" eyebrow="Stay" title="Our rooms" line={`Tonight’s prices, per room per night. Book a room and see what is free for ${datesText(stay)}.`} />
            </Reveal>
            <div className="mt-6 grid gap-x-10 gap-y-11 lg:mt-10 lg:grid-cols-2 lg:gap-y-16">
              {roomTypes.map((t, i) => (
                <RoomStory key={t.slug} t={t} images={imagesOf(t)} first={i === 0}
                  wide={roomTypes.length % 2 === 1 && i === roomTypes.length - 1 && roomTypes.length > 1}
                  onBook={() => onBookType(t)} onDetails={() => onTypeDetails(t)} closed={!!closed} />
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
              <SectionHead id="know-title" eyebrow="Your stay" title="Good to know" />
              <dl className="mt-5 divide-y divide-(--vr-line) border-y border-(--vr-line)">
                <Line label="Check-in" value={`from ${hotel.checkInTime}`} />
                <Line label="Check-out" value={`by ${hotel.checkoutTime}`} />
                {(hotel.breakfastHours || has(/breakfast/i)) && <Line label="Breakfast" value={hotel.breakfastHours ? `${hotel.breakfastHours}${has(/breakfast/i) ? " · included" : ""}` : "Included"} />}
                {has(/wi-?fi/i) && <Line label="Wi-Fi" value="Free, in every room" />}
                <Line label="Reception" value={hotel.receptionHours || "24 hours"} />
              </dl>
              {landing.policies.length > 1 && (
                <details className="group mt-4">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-(--vr-gold-ink) [&::-webkit-details-marker]:hidden">
                    Booking rules<ChevronRight className="size-4 transition group-open:rotate-90" />
                  </summary>
                  <ul className="mt-2.5 space-y-1.5 text-[12.5px] leading-relaxed text-(--vr-muted)">
                    {landing.policies.filter((p) => !p.startsWith("Check-in from")).map((p) => <li key={p}>{p}</li>)}
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
              <NetworkMarks label="Pay with" center className="w-full max-w-[300px]" />
              <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-(--vr-muted)"><Lock className="size-3 text-(--vr-gold-ink)" />Secure payment by <span className="font-semibold tracking-wide text-(--vr-ink)/80">NTZS</span></p>
            </div>
          )}
          <a href="/" target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-[12px] text-(--vr-muted) underline-offset-4 hover:text-(--vr-ink) hover:underline">
            Our website<ArrowUpRight className="size-3.5" />
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
                <span className="block text-[14.5px]">See rooms</span>
                <span className="block truncate text-[11.5px] font-normal text-white/60">{datesText(stay)} · {stay.adults + stay.children} guest{stay.adults + stay.children === 1 ? "" : "s"}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-2 text-[13px] font-medium text-white/70">
                {from !== null && <>from <span className="font-semibold tabular-nums text-(--vr-gold)">{tzs(from)}</span></>}
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
  const shown = places.filter((p): p is { id: string; label: string; src: string } => !!p.src);
  if (shown.length < 3) return null;
  const glide = (id: string) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  return (
    <nav aria-label="Explore" className="pt-6 lg:hidden">
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
function RoomStory({ t, images, first, wide, onBook, onDetails, closed }: {
  t: QrRoomType; images: string[]; first: boolean; wide: boolean; onBook: () => void; onDetails: () => void; closed: boolean;
}) {
  const view = usePhotoViewer();
  const photos = images.map((src, k) => ({ src, alt: k === 0 ? t.name : `${t.name} — photo ${k + 1}`, label: t.name }));
  const many = photos.length > 1;
  return (
    <Reveal className={cn(wide && "lg:col-span-2")}>
      <article aria-label={t.name} className={cn(wide && "lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:items-center lg:gap-12")}>
        <Rail label={`Photos of ${t.name}`}>
          {photos.map((p, k) => (
            <button key={`${p.src}-${k}`} type="button" onClick={() => view(photos, k)} aria-label={`See ${p.alt} full screen`}
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
              <h3 className="font-display text-[27px] font-semibold leading-[1.02] lg:text-[32px]">{t.name}</h3>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--vr-muted)">
                <span className="inline-flex items-center gap-1.5"><Users className="size-3.5 text-(--vr-gold-ink)" />{holdsText(t)}</span>
                <FreeTonight n={t.freeTonight} />
              </p>
            </div>
            <p className="shrink-0 pt-0.5 text-right leading-tight">
              <span className="block text-[11px] text-(--vr-muted)">from</span>
              <span className="block text-[18px] font-semibold tabular-nums">{tzs(t.fromPerNight)}</span>
              {t.fromPerNight < t.baseRate
                ? <s className="block text-[11.5px] tabular-nums text-(--vr-muted)">{tzs(t.baseRate)}</s>
                : <span className="block text-[11.5px] text-(--vr-muted)">a night</span>}
            </p>
          </div>
          {t.shortDescription && <p className="mt-2.5 line-clamp-2 max-w-xl text-[13.5px] leading-relaxed text-(--vr-ink)/75">{t.shortDescription}</p>}
          <div className="mt-3.5 flex items-center gap-2.5">
            <button type="button" onClick={onBook} disabled={closed} className={cn(darkButton, "h-12 flex-1 px-6 text-[14.5px] sm:flex-none sm:px-9")}>
              Book<ArrowRight className="size-4 text-(--vr-gold)" />
            </button>
            <button type="button" onClick={onDetails} className={cn(lightButton, "h-12 px-6 text-[14px]")}>Details</button>
          </div>
        </div>
      </article>
    </Reveal>
  );
}

/** "3 free tonight" — or that the type is full tonight (other nights may be free). */
export function FreeTonight({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium", n > 0 ? "text-emerald-700" : "text-(--vr-muted)", className)}>
      <span className={cn("size-1.5 rounded-full", n > 0 ? "bg-emerald-500" : "bg-(--vr-muted)/50")} />
      {n > 0 ? `${n} free tonight` : "Full tonight"}
    </span>
  );
}

/** THE HOTEL — a mosaic of five (outside, reception, a detail, a bathroom, outside again); every photo opens the whole set. */
function HotelMosaic({ photos }: { photos: ExplorePhoto[] }) {
  const view = usePhotoViewer();
  const all = photos.map(asView);
  const firstOf = (label: string, skip = 0) => photos.filter((p) => p.label === label)[skip];
  const tiles = [firstOf("Outside"), firstOf("Reception"), firstOf("Details") ?? firstOf("Rooms"), firstOf("Bathrooms"), firstOf("Outside", 1) ?? firstOf("Rooms", 1)]
    .filter((p, k, list): p is ExplorePhoto => !!p && list.indexOf(p) === k);
  const shape = ["row-span-2 lg:col-span-2", "", "", "", ""];
  const rest = photos.length - tiles.length;
  return (
    <section id="hotel" aria-labelledby="hotel-title" className="scroll-mt-4 pt-16 lg:pt-28">
      <Reveal>
        <SectionHead id="hotel-title" eyebrow="The hotel" title="Take a look around" line="Outside, reception, the rooms and the little things — our own photos."
          action={<button type="button" onClick={() => view(all, 0)} className="hidden items-center gap-1 text-[13px] font-medium text-(--vr-gold-ink) hover:underline sm:inline-flex">All {photos.length} photos<ChevronRight className="size-4" /></button>} />
      </Reveal>
      <Reveal delay={0.05}>
        <div className="mt-6 grid auto-rows-[150px] grid-cols-2 gap-2 sm:auto-rows-[200px] lg:mt-10 lg:auto-rows-[240px] lg:grid-cols-4 lg:gap-3">
          {tiles.map((p, k) => {
            const last = k === tiles.length - 1 && rest > 0;
            return (
              <button key={p.src} type="button" onClick={() => view(all, photos.indexOf(p))} aria-label={last ? `See all ${photos.length} photos` : `See ${p.alt} full screen`}
                className={cn("group relative overflow-hidden rounded-[20px] bg-(--vr-line)", shape[k], tiles.length === 4 && k === 3 && "col-span-2 lg:col-span-1")}>
                <Photo src={p.src} alt={p.alt} sizes={k === 0 ? "(min-width:1024px) 620px, 50vw" : "(min-width:1024px) 310px, 50vw"}
                  imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-[1.04] motion-reduce:group-hover:scale-100" />
                {last && (
                  <span className="absolute inset-0 grid place-items-center bg-(--vr-dark)/55 text-white backdrop-blur-[1px] transition group-hover:bg-(--vr-dark)/45">
                    <span className="text-center leading-tight"><span className="block font-display text-[28px] font-semibold">+{rest}</span><span className="text-[12px] text-white/80">photos</span></span>
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
  const view = usePhotoViewer();
  const photos = food.dishes.map((d) => ({ src: d.image, alt: d.name, label: `${d.name} · ${d.from ? "from " : ""}${tzs(d.price)}` }));
  const hours = [food.restaurantHours && `Kitchen ${food.restaurantHours}`, food.barHours && `Bar ${food.barHours}`].filter(Boolean).join(" · ");
  return (
    <section id="food" aria-labelledby="food-title" className="relative mt-16 scroll-mt-0 overflow-hidden bg-(--vr-dark) py-14 text-white lg:mt-28 lg:py-24">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-(--vr-gold)/10 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
        <Reveal>
          <SectionHead id="food-title" dark eyebrow="Restaurant & bar" title="Food & drinks"
            line={[food.note, hours].filter(Boolean).join(" · ")}
            action={<a href={food.menuHref} target="_blank" rel="noopener" className="hidden items-center gap-1 text-[13px] font-medium text-(--vr-gold) hover:underline sm:inline-flex">Full menu<ArrowUpRight className="size-4" /><span className="sr-only"> (opens in a new tab)</span></a>} />
        </Reveal>
        <Reveal delay={0.05} className="mt-6 lg:mt-10">
          <Rail label="Dishes and drinks" dark>
            {food.dishes.map((d, k) => (
              <button key={d.key} type="button" onClick={() => view(photos, k)} aria-label={`${d.name}, ${tzs(d.price)} — see the photo`}
                className="group w-[46%] shrink-0 snap-start text-left sm:w-[30%] lg:w-[calc((100%-36px)/4)]">
                <span className="relative block aspect-square overflow-hidden rounded-[20px] bg-white/5">
                  <Image src={d.image} alt={d.name} fill sizes="(min-width:1024px) 300px, (min-width:640px) 30vw, 46vw"
                    className="object-cover transition duration-700 group-hover:scale-105 motion-reduce:transition-none" />
                </span>
                <span className="mt-2.5 line-clamp-2 block text-[14.5px] font-semibold leading-snug">{d.name}</span>
                <span className="mt-0.5 block text-[12.5px] tabular-nums text-white/60">{d.from ? "from " : ""}{tzs(d.price)}</span>
              </button>
            ))}
          </Rail>
        </Reveal>
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <a href={food.menuHref} target="_blank" rel="noopener"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[14.5px] font-semibold ring-1 ring-white/25 transition hover:bg-white/10 sm:w-auto">
            See the full menu<ArrowUpRight className="size-4 text-(--vr-gold)" /><span className="sr-only"> (opens in a new tab)</span>
          </a>
          {food.credits.length > 0 && (
            <details className="group max-w-xl text-[11.5px] text-white/45">
              <summary className="cursor-pointer list-none leading-relaxed [&::-webkit-details-marker]:hidden">
                Photos are illustrative — served the house way. <span className="underline underline-offset-4 group-open:text-white/70">Photo credits</span>
              </summary>
              <ul className="mt-2 space-y-1">
                {food.credits.map((c) => (
                  <li key={c.sourcePage} className="leading-relaxed">
                    {c.item} — <a href={c.sourcePage} target="_blank" rel="noopener nofollow" className="hover:text-white/80 hover:underline">{c.creator}</a>,{" "}
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
  const view = usePhotoViewer();
  return (
    <section id="meeting" aria-labelledby="meeting-title" className="scroll-mt-4 pt-16 lg:pt-28">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
        {meeting.photo && (
          <Reveal>
            <button type="button" onClick={() => view([asView(meeting.photo!)], 0)} aria-label={`See ${meeting.photo.alt} full screen`}
              className="group relative block aspect-[16/10] w-full overflow-hidden rounded-[24px] bg-(--vr-line)">
              <Photo src={meeting.photo.src} alt={meeting.photo.alt} sizes="(min-width:1024px) 720px, 100vw"
                imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100" />
            </button>
          </Reveal>
        )}
        <Reveal delay={0.06}>
          <SectionHead id="meeting-title" eyebrow="Meetings" title={meeting.name} line={meeting.about ?? "A quiet room for your meeting, booked by the hour."} />
          <dl className="mt-5 divide-y divide-(--vr-line) border-y border-(--vr-line)">
            <Line label="Room for" value={`Up to ${meeting.capacity} people`} />
          </dl>
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href={meeting.href} target="_blank" rel="noopener" className={cn(darkButton, "h-12 px-6 text-[14.5px]")}>
              See the meeting room<ArrowUpRight className="size-4 text-(--vr-gold)" /><span className="sr-only"> (opens in a new tab)</span>
            </a>
            {hotel.whatsapp && (
              <a href={waHref(hotel.whatsapp, `Hello ${hotel.name}, I would like to book the ${meeting.name}.`)} target="_blank" rel="noopener"
                className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-(--vr-gold-ink) hover:underline">
                <MessageCircle className="size-4" />Ask about a date
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
  const view = usePhotoViewer();
  const row = "flex items-center gap-3 py-3.5 text-[14.5px] font-medium transition hover:text-(--vr-gold-ink)";
  return (
    <section id="find" aria-labelledby="find-title" className="scroll-mt-16">
      <SectionHead id="find-title" eyebrow="Find us" title="Where we are" line={hotel.address ?? undefined} />
      {photo && (
        <button type="button" onClick={() => view([asView(photo)], 0)} aria-label={`See ${photo.alt} full screen`}
          className="group relative mt-5 block aspect-[16/9] w-full overflow-hidden rounded-[20px] bg-(--vr-line)">
          <Photo src={photo.src} alt={photo.alt} sizes="(min-width:1024px) 560px, 100vw" imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100" />
        </button>
      )}
      <div className="mt-4 divide-y divide-(--vr-line) border-y border-(--vr-line)">
        <a href={mapHref} target="_blank" rel="noopener" className={row}>
          <MapPin className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">Directions</span><ArrowUpRight className="size-4 text-(--vr-muted)" />
        </a>
        {hotel.phone && (
          <a href={telHref(hotel.phone)} className={row}>
            <Phone className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">Call <span className="tabular-nums text-(--vr-muted)">{hotel.phone}</span></span><ChevronRight className="size-4 text-(--vr-muted)" />
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
