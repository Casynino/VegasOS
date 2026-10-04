import type { Metadata } from "next";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertCircle, CalendarDays, MessageCircle, Phone, Users } from "lucide-react";
import { getSettings } from "@/server/settings";
import { AppError } from "@/server/errors";
import {
  bookingWindow, listPublicRoomTypes, parseStayParams, quoteSelection, type SelectionQuote, type StayParams,
} from "@/server/services/public-booking";
import { addDays } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { blurFor } from "@/components/public/blur-data";
import { AvailabilityResults } from "@/components/public/booking/availability-results";
import { GuestStep } from "@/components/public/booking/guest-step";
import { BookingProgress } from "@/components/public/booking/progress";
import { ResultsSkeleton } from "@/components/public/booking/results-skeleton";
import { telHref, whatsappHref } from "@/components/public/contact";
import { getSiteContent } from "@/server/services/site-content";
import { PillLink } from "@/components/public/pill-link";
import { StaySearchForm } from "@/components/public/stay-search-form";
import { container, cream, eyebrow, goldText, type } from "@/components/public/ui";
import { confirmBookingAction, reviewBookingAction } from "./actions";

export const metadata: Metadata = {
  title: "Book your stay",
  description: "Check live availability and book a room at Vegas Luxury Hotel, Dar es Salaam. Instant booking reference, pay at the hotel.",
  alternates: { canonical: "/book" },
  robots: { index: true, follow: false },
};

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function stayHref(p: StayParams, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ checkIn: p.checkIn, checkOut: p.checkOut, adults: String(p.adults), children: String(p.children), ...extra });
  return `/book?${q.toString()}`;
}

export default async function BookPage({ searchParams }: PageProps<"/book">) {
  const raw = await searchParams;
  const [settings, roomTypes, c] = await Promise.all([getSettings(), listPublicRoomTypes(), getSiteContent()]);
  const window = bookingWindow(settings);
  const typeParam = one(raw.type)?.trim();
  const preferred = typeParam && roomTypes.some((t) => t.slug === typeParam) ? typeParam : undefined;

  // ── Online booking switched off: contact-to-book ──
  if (!window.enabled) {
    return (
      <Shell title="Book your stay" intro={c.pages.book.pausedIntro}>
        <div className="rounded-[2rem] bg-panel p-8 text-center ring-1 ring-tone/[0.07] sm:p-12">
          <p className={cn("mx-auto max-w-md", type.h3)}>Contact us to book</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {settings.phone && <PillLink href={telHref(settings.phone)} external variant="dark"><Phone className="mr-1 inline size-4" aria-hidden="true" />{settings.phone}</PillLink>}
            {settings.whatsapp && <PillLink href={whatsappHref(settings.whatsapp, "Hello, I would like to book a room.")} external target="_blank" rel="noopener noreferrer" variant="outline"><MessageCircle className="mr-1 inline size-4" aria-hidden="true" />WhatsApp</PillLink>}
            <PillLink href="/contact?subject=booking" variant="outline" arrow={false}>Send a message</PillLink>
          </div>
        </div>
      </Shell>
    );
  }

  const parsed = parseStayParams(raw, window);
  const searchForm = (defaults: Partial<StayParams>, errors?: Record<string, string>) => (
    <StaySearchForm
      variant="panel"
      defaults={{
        checkIn: defaults.checkIn ?? window.today,
        checkOut: defaults.checkOut ?? addDays(defaults.checkIn ?? window.today, 1),
        adults: defaults.adults ?? 2,
        children: defaults.children ?? 0,
        type: preferred,
      }}
      minDate={window.today}
      maxDate={window.maxArrival}
      maxNights={window.maxNights}
      errors={errors}
      roomTypes={roomTypes.map((t) => ({ slug: t.slug, name: t.name }))}
    />
  );

  // ── Step 1: dates & guests ──
  if (parsed.kind !== "ok") {
    const preferredType = roomTypes.find((t) => t.slug === preferred);
    return (
      <Shell
        title="Book your stay"
        intro={c.pages.book.intro}
        image={preferredType?.images[0]}
      >
        <BookingProgress current={1} className="mb-10" />
        {parsed.kind === "invalid" && (
          <p role="alert" className="mb-6 flex items-center gap-2 rounded-2xl border border-red-700/20 bg-red-50 p-4 text-sm text-red-900">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" /> Please check the highlighted fields.
          </p>
        )}
        {preferredType && (
          <p className="mb-4 text-sm text-tone/70">
            You’re booking: <span className="font-medium text-tone">{preferredType.name}</span> — you can change the room type below.
          </p>
        )}
        {searchForm(parsed.kind === "invalid" ? parsed.partial : {}, parsed.kind === "invalid" ? parsed.errors : undefined)}
        <p className="mt-6 text-sm text-tone/60">
          Check-in from {window.checkInTime} · check-out by {window.checkoutTime} · bookings up to {settings.maxAdvanceBookingDays} days ahead.
        </p>
      </Shell>
    );
  }

  const stay = parsed.value;
  const roomsParam = Number(one(raw.rooms));
  const summary = <StaySummary stay={stay} changeHref={`/book?${new URLSearchParams({ checkIn: stay.checkIn, checkOut: stay.checkOut, adults: String(stay.adults), children: String(stay.children), ...(preferred ? { type: preferred } : {}), edit: "1" })}`} />;

  // ── Editing the search (from the summary "Change" link) ──
  if (one(raw.edit) === "1") {
    return (
      <Shell title="Change your search">
        <BookingProgress current={1} className="mb-10" />
        {searchForm(stay)}
      </Shell>
    );
  }

  // ── Steps 3–4: guest details & review ──
  if (preferred && Number.isInteger(roomsParam) && roomsParam >= 1) {
    let quote: SelectionQuote | null = null;
    let problem: string | null = null;
    try {
      quote = await quoteSelection({ ...stay, typeSlug: preferred, rooms: roomsParam });
    } catch (e) {
      if (e instanceof AppError) problem = e.message;
      else throw e;
    }
    const backToRooms = stayHref(stay, { type: preferred });
    return (
      <Shell title="Request your stay">
        {summary}
        {problem || !quote ? (
          <div role="alert" className="mt-8 rounded-[2rem] bg-panel p-8 text-center ring-1 ring-tone/[0.07] sm:p-12">
            <AlertCircle className="mx-auto size-9 text-accent-ink" strokeWidth={1.4} aria-hidden="true" />
            <h2 className={cn("mt-4", type.h3)}>Availability has changed</h2>
            <p className="mx-auto mt-3 max-w-md text-tone/70">{problem ?? "Please choose your room again."}</p>
            <div className="mt-8 flex justify-center"><PillLink href={backToRooms} variant="dark">See available rooms</PillLink></div>
          </div>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-12">
            <GuestStep
              selection={{ checkIn: stay.checkIn, checkOut: stay.checkOut, adults: stay.adults, children: stay.children, type: preferred, rooms: roomsParam }}
              backToRoomsHref={backToRooms}
              reviewAction={reviewBookingAction}
              confirmAction={confirmBookingAction}
              arrival={{
                defaultAirport: c.facts.airportName,
                note: `Our own drivers can collect you from the airport, about ${c.facts.airportKm} km away. We’ll confirm by phone or WhatsApp.`,
              }}
            />
            <SelectionAside quote={quote} />
          </div>
        )}
      </Shell>
    );
  }

  // ── Step 2: available rooms ──
  return (
    <Shell title="Choose your room">
      <BookingProgress current={2} className="mb-8" />
      {summary}
      <div className="mt-8">
        <Suspense key={`${stay.checkIn}-${stay.checkOut}-${stay.adults}-${stay.children}`} fallback={<ResultsSkeleton />}>
          <AvailabilityResults params={stay} preferred={preferred} today={window.today} maxArrival={window.maxArrival} />
        </Suspense>
      </div>
    </Shell>
  );
}

function Shell({ title, intro, image, children }: { title: string; intro?: string; image?: string; children: React.ReactNode }) {
  return (
    <div className={cn(cream, "flex-1")}>
      <div className="relative isolate overflow-hidden bg-[#15120e] text-white">
        {image && <Image src={image} alt="" fill sizes="100vw" {...blurFor(image)} className="-z-10 object-cover opacity-30" />}
        <div className="absolute inset-0 -z-10" aria-hidden="true" style={{ backgroundImage: "radial-gradient(ellipse 60% 80% at 90% 0%, oklch(0.72 0.12 80 / 0.18), transparent 70%)" }} />
        <div className={cn(container, "pb-12 pt-28 sm:pb-16 sm:pt-32")}>
          <p className={cn(eyebrow, "text-gold")}>Reservations</p>
          <h1 className={cn("mt-3", type.h1)}>{title}</h1>
          {intro && <p className={cn("mt-4 max-w-2xl text-white/75", type.lead)}>{intro}</p>}
        </div>
      </div>
      <div className={cn(container, "relative -mt-6 pb-20")}>
        <div className="rounded-[2rem] bg-paper px-0 pt-8 sm:px-2">{children}</div>
      </div>
    </div>
  );
}

function StaySummary({ stay, changeHref }: { stay: StayParams; changeHref: string }) {
  const nights = Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86_400_000);
  return (
    <div className="flex flex-col gap-4 rounded-3xl bg-panel p-5 ring-1 ring-tone/[0.07] sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <div className="flex items-center gap-3">
          <CalendarDays className={cn("size-5", goldText)} aria-hidden="true" />
          <div>
            <dt className="sr-only">Dates</dt>
            <dd className="font-medium">{formatBusinessDate(stay.checkIn)} → {formatBusinessDate(stay.checkOut)}</dd>
            <dd className="text-tone/60">{nights} night{nights === 1 ? "" : "s"}</dd>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Users className={cn("size-5", goldText)} aria-hidden="true" />
          <div>
            <dt className="sr-only">Guests</dt>
            <dd className="font-medium">{stay.adults} adult{stay.adults === 1 ? "" : "s"}{stay.children ? `, ${stay.children} child${stay.children === 1 ? "" : "ren"}` : ""}</dd>
          </div>
        </div>
      </dl>
      <Link href={changeHref} className="inline-flex items-center justify-center rounded-full border border-tone/20 px-5 py-2.5 text-sm font-medium hover:border-tone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
        Change search
      </Link>
    </div>
  );
}

function SelectionAside({ quote }: { quote: SelectionQuote }) {
  const img = quote.type.images[0];
  return (
    <aside aria-label="Your selection" className="lg:sticky lg:top-28 lg:self-start">
      <div className="overflow-hidden rounded-3xl bg-panel ring-1 ring-tone/[0.07]">
        {img && (
          <div className="relative aspect-[16/10]">
            <Image src={img} alt={`${quote.type.name} at Vegas Luxury Hotel`} fill sizes="(min-width: 1024px) 22rem, 100vw" {...blurFor(img)} className="object-cover" />
          </div>
        )}
        <div className="p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-tone/55">Your selection</p>
          <p className="mt-1 font-display text-2xl">{quote.selection.rooms > 1 ? `${quote.selection.rooms} × ` : ""}{quote.type.name}</p>
          <p className="mt-1 text-sm text-tone/65">{quote.nights} night{quote.nights === 1 ? "" : "s"} · check-in {quote.checkInTime} · check-out {quote.checkoutTime}</p>
          <div className="mt-5 flex items-baseline justify-between border-t border-tone/10 pt-4">
            <span className="text-sm text-tone/65">Estimated total · pay at hotel</span>
            <span className="font-display text-2xl font-semibold">{formatTZS(quote.netAmount)}</span>
          </div>
          {quote.discountAmount > 0 && <p className="mt-1 text-right text-xs text-accent-ink">Includes {formatTZS(quote.discountAmount)} website discount</p>}
        </div>
      </div>
    </aside>
  );
}
