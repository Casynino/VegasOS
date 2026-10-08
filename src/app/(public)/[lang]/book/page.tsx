import type { Metadata } from "next";
import { shareCard } from "@/lib/share-card";
import { Suspense } from "react";
import { AlertCircle, MessageCircle, Phone } from "lucide-react";
import { getSettings } from "@/server/settings";
import { AppError } from "@/server/errors";
import {
  bookingWindow, listPublicRoomTypes, parseStayParams, quoteSelection, type SelectionQuote, type StayParams,
} from "@/server/services/public-booking";
import { addDays } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AvailabilityResults } from "@/components/public/booking/availability-results";
import { GuestStep } from "@/components/public/booking/guest-step";
import { StayEditor } from "@/components/public/booking/stay-editor";
import { Notice } from "@/components/public/booking/parts";
import { BookingProgress } from "@/components/public/booking/progress";
import { ResultsSkeleton } from "@/components/public/booking/results-skeleton";
import { telHref, whatsappHref } from "@/components/public/contact";
import { getSiteContent } from "@/server/services/site-content";
import {
  Actions, Eyebrow, GlassPanel, Heading, HudLabel, InfoList, LinkButton, MediaFrame, PageIntro, Section, TextLink, typeScale,
} from "@/components/public/kit";
import fx from "@/components/public/room-fx.module.css";
import { StaySearchForm } from "@/components/public/stay-search-form";
import { confirmBookingAction, payAndBookAction } from "./actions";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { getT, pageLocale } from "@/i18n/server";
import type { T } from "@/i18n/translate";

export async function generateMetadata({ params }: PageProps<"/[lang]/book">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  return {
    title: t("Book your stay"),
    description: t("Check live availability and book a room at Vegas Luxury Hotel, Dar es Salaam. Instant booking reference, pay by mobile money."),
    alternates: { canonical: "/book" },
    robots: { index: true, follow: false },
    ...shareCard("book", t("Book your stay — Vegas Luxury Hotel"), t("Pick your dates and pay by mobile money — your room at Mlimani City, Dar es Salaam in a minute.")),
  };
}

/** "2 adults, 1 child" in the visitor's language. */
function guestsLabel(t: T, adults: number, children: number) {
  const a = t.plural(adults, "{n} adult", "{n} adults");
  return children ? t("{adults}, {children}", { adults: a, children: t.plural(children, "{n} child", "{n} children") }) : a;
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function stayHref(p: StayParams, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ checkIn: p.checkIn, checkOut: p.checkOut, adults: String(p.adults), children: String(p.children), ...extra });
  return `/book?${q.toString()}`;
}

/**
 * The booking funnel on one URL, driven by its search params (checkIn, checkOut, adults,
 * children, type, rooms, edit): dates & guests → room types free for the stay → BOOK & PAY on
 * one screen (owner, 2026-10-05: "as easy as getting food from us"). With a room type already
 * chosen (a room's page, or a type picked with the dates) the dates go straight to Book & pay. Each step opens on a
 * night band (where am I, what did I search) and works on paper below it.
 */
export default async function BookPage({ params, searchParams }: PageProps<"/[lang]/book">) {
  await pageLocale(params);
  const raw = await searchParams;
  const [settings, roomTypes, c, t] = await Promise.all([getSettings(), listPublicRoomTypes(), getSiteContent(), getT()]);
  const stayWindow = bookingWindow(settings);
  const typeParam = one(raw.type)?.trim();
  const preferred = typeParam && roomTypes.some((x) => x.slug === typeParam) ? typeParam : undefined;

  // ── Online booking switched off: contact-to-book ──
  if (!stayWindow.enabled) {
    return (
      <Shell title={t("Book your stay")} lede={c.pages.book.pausedIntro} step={0}>
        <div className="mx-auto max-w-xl py-6 text-center sm:py-10">
          <Heading as="h2" size="subheading">{t("Contact us to book")}</Heading>
          <p className={cn(typeScale.body, "mx-auto mt-3 max-w-md text-pub-muted")}>{t("Tell us your dates and we’ll reserve the room for you.")}</p>
          <Actions align="center" className="mt-8">
            {settings.phone && (
              <LinkButton href={telHref(settings.phone)} icon={<Phone className="size-4" strokeWidth={1.6} aria-hidden="true" />}>
                {settings.phone}
              </LinkButton>
            )}
            {settings.whatsapp && (
              <LinkButton
                href={whatsappHref(settings.whatsapp, "Hello, I would like to book a room.")}
                target="_blank"
                rel="noopener noreferrer"
                variant="secondary"
                icon={<MessageCircle className="size-4" strokeWidth={1.6} aria-hidden="true" />}
              >
                WhatsApp
              </LinkButton>
            )}
            <TextLink href="/contact?subject=booking">{t("Send a message")}</TextLink>
          </Actions>
        </div>
      </Shell>
    );
  }

  const parsed = parseStayParams(raw, stayWindow);
  const online = await onlinePayAvailable("booking", settings);
  const searchForm = (defaults: Partial<StayParams>, errors?: Record<string, string>) => (
    <StaySearchForm
      variant="panel"
      defaults={{
        checkIn: defaults.checkIn ?? stayWindow.today,
        checkOut: defaults.checkOut ?? addDays(defaults.checkIn ?? stayWindow.today, 1),
        adults: defaults.adults ?? 2,
        children: defaults.children ?? 0,
        type: preferred,
      }}
      minDate={stayWindow.today}
      maxDate={stayWindow.maxArrival}
      maxNights={stayWindow.maxNights}
      errors={errors}
      roomTypes={roomTypes.map((x) => ({ slug: x.slug, name: t(x.name) }))}
      direct
    />
  );
  const windowFacts = (
    <InfoList
      className="mt-5"
      items={[
        { label: t("Check-in from {time}", { time: stayWindow.checkInTime }) },
        { label: t("Check-out by {time}", { time: stayWindow.checkoutTime }) },
        { label: t("Book up to {days} days ahead", { days: settings.maxAdvanceBookingDays }) },
      ]}
    />
  );

  // ── Step 1: dates & guests ──
  // With Pay now on, the CMS intro ("Send a request… You pay at the hotel") would contradict the next steps.
  if (parsed.kind !== "ok") {
    const preferredType = roomTypes.find((x) => x.slug === preferred);
    const intro = online
      ? t("Choose your dates and guests to see live availability and prices — pay now by mobile money, or pay later.")
      : c.pages.book.intro;
    return (
      <Shell title={t("Book your stay")} lede={intro} step={1}>
        <BookingProgress current={1} />
        <div className="mt-8 grid gap-12 lg:mt-12 lg:grid-cols-12 lg:gap-x-10">
          <div className="min-w-0 lg:col-span-8">
            {parsed.kind === "invalid" && <Notice className="mb-6">{t("Please check the highlighted fields.")}</Notice>}
            {preferredType && (
              <div className={cn(fx.card, "relative mb-5 flex items-center gap-4 p-3 pr-5")}>
                {preferredType.images[0] && (
                  <MediaFrame src={preferredType.images[0]} alt="" ratio="1/1" sizes="72px" rounded="soft" className="w-[4.5rem] shrink-0" />
                )}
                <p className="min-w-0 leading-snug">
                  <span className={cn(typeScale.meta, "block text-pub-eyebrow")}>{t("You’re booking")}</span>
                  <span className="mt-1 block font-display text-[1.375rem] leading-tight">{t(preferredType.name)}</span>
                  <span className="mt-0.5 block text-[13px] text-pub-muted">{t("You can change the room type below.")}</span>
                </p>
              </div>
            )}
            <SearchConsole>
              {searchForm(parsed.kind === "invalid" ? parsed.partial : {}, parsed.kind === "invalid" ? parsed.errors : undefined)}
            </SearchConsole>
            {windowFacts}
          </div>
          <TalkToUs phone={settings.phone} whatsapp={settings.whatsapp} />
        </div>
      </Shell>
    );
  }

  const stay = parsed.value;
  const roomsParam = Number(one(raw.rooms));
  const summary = (
    <StaySummary
      stay={stay}
      changeHref={`/book?${new URLSearchParams({ checkIn: stay.checkIn, checkOut: stay.checkOut, adults: String(stay.adults), children: String(stay.children), ...(preferred ? { type: preferred } : {}), edit: "1" })}`}
    />
  );

  // ── Editing the search (from the summary "Change" link) ──
  if (one(raw.edit) === "1") {
    return (
      <Shell title={t("Change your search")} step={1}>
        <BookingProgress current={1} />
        <div className="mt-8 grid gap-12 lg:mt-12 lg:grid-cols-12 lg:gap-x-10">
          <div className="min-w-0 lg:col-span-8">
            <SearchConsole>{searchForm(stay)}</SearchConsole>
            {windowFacts}
          </div>
          <TalkToUs phone={settings.phone} whatsapp={settings.whatsapp} />
        </div>
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
      if (e instanceof AppError) problem = e.i18n ? t(e.i18n.key, e.i18n.vars) : t(e.message);
      else throw e;
    }
    const backToRooms = stayHref(stay, { type: preferred });
    const type = roomTypes.find((x) => x.slug === preferred);
    const editor = (
      <StayEditor stay={stay} type={preferred} rooms={roomsParam} minDate={stayWindow.today} maxDate={stayWindow.maxArrival} maxNights={stayWindow.maxNights}
        maxAdults={type?.maxAdults ?? 2} maxChildren={type?.maxChildren ?? 0} />
    );
    return (
      <Shell title={t("Book your room")} top={summary} step={3}>
        {problem || !quote ? (
          <div role="alert" className="mx-auto max-w-xl py-6 text-center sm:py-10">
            <AlertCircle className="mx-auto size-9 text-pub-eyebrow" strokeWidth={1.2} aria-hidden="true" />
            <Heading as="h2" size="subheading" className="mt-5">{t("Not free for these dates")}</Heading>
            <p className={cn(typeScale.body, "mx-auto mt-3 max-w-md text-pub-muted")}>{problem ?? t("Please choose another room or other dates.")}</p>
            <div className="mt-8 text-left">{editor}</div>
            <Actions align="center" className="mt-8">
              <LinkButton href={backToRooms} icon="arrow">{t("See rooms that are free")}</LinkButton>
            </Actions>
          </div>
        ) : (
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-10">
            <div className="min-w-0 lg:col-span-7">
              <GuestStep
                selection={{ checkIn: stay.checkIn, checkOut: stay.checkOut, adults: stay.adults, children: stay.children, type: preferred, rooms: roomsParam }}
                backToRoomsHref={backToRooms}
                confirmAction={confirmBookingAction}
                payAction={payAndBookAction}
                online={online}
                arrival={{
                  defaultAirport: c.facts.airportName,
                  note: t("Our own drivers can collect you from the airport, about {km} km away. We’ll confirm by phone or WhatsApp.", { km: c.facts.airportKm }),
                }}
                price={{ total: quote.netAmount, gross: quote.grossAmount, discount: quote.discountAmount, ratePerNight: quote.ratePerNight, nights: quote.nights, rooms: quote.selection.rooms, checkInTime: quote.checkInTime }}
                summary={<SelectionLine quote={quote} />}
                stayEditor={editor}
              />
            </div>
            <SelectionAside quote={quote} />
          </div>
        )}
      </Shell>
    );
  }

  // ── Step 2: available rooms ──
  return (
    <Shell title={t("Choose your room")} top={summary} step={2}>
      <BookingProgress current={2} />
      <div className="mt-8 lg:mt-12">
        <Suspense key={`${stay.checkIn}-${stay.checkOut}-${stay.adults}-${stay.children}`} fallback={<ResultsSkeleton />}>
          <AvailabilityResults params={stay} preferred={preferred} today={stayWindow.today} maxArrival={stayWindow.maxArrival} online={online} />
        </Suspense>
      </div>
    </Shell>
  );
}

/**
 * Night band (eyebrow, page title, one line, the search readout) over a calm paper work area
 * drawn on a faint drafting grid — the booking console. `step` sets the HUD line opposite the
 * title on desktop (0 = none).
 */
async function Shell({ title, lede, top, step, children }: { title: string; lede?: string; top?: React.ReactNode; step: number; children: React.ReactNode }) {
  const t = await getT();
  return (
    <div className="flex flex-1 flex-col">
      <PageIntro
        eyebrow={t("Reservations")}
        title={title}
        lede={lede}
        space="sm"
        id="book-title"
        meta={step > 0 ? <>{t("Booking console · step {step} / 03", { step: String(step).padStart(2, "0") })}</> : undefined}
      >
        {top}
      </PageIntro>
      <Section as="div" space="sm" width="wide" atmosphere="calm" pattern="grid" className="flex-1 pb-20 sm:pb-24 lg:pb-28">
        {children}
      </Section>
    </div>
  );
}

/** Step 1: the search in a console card, with its live label. */
async function SearchConsole({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <div className={cn(fx.card, "relative p-5 sm:p-7")}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-pub-line pb-4">
        <HudLabel live>{t("Live availability")}</HudLabel>
        <span aria-hidden="true" className="font-mono text-[10px] uppercase tracking-[0.2em] text-pub-muted sm:text-[11px]">{t("Dates · guests · room type")}</span>
      </div>
      {children}
    </div>
  );
}

/** The search on the night band, as a glass readout: check-in → check-out, nights, guests, change. */
async function StaySummary({ stay, changeHref }: { stay: StayParams; changeHref: string }) {
  const t = await getT();
  const nights = Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86_400_000);
  const dt = "font-mono text-[10px] uppercase tracking-[0.2em] text-pub-muted sm:text-[11px]";
  const dd = "mt-1.5 font-display text-[1.25rem] font-medium leading-tight text-pub-fg lining-nums sm:text-[1.5rem]";
  const cell = "min-w-0 px-4 py-3.5 sm:px-5 sm:py-4";
  return (
    <GlassPanel variant="clear" padding="none" rounded="md" className="mt-7 sm:mt-9">
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        <dl className="grid min-w-0 flex-1 grid-cols-2 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,0.7fr)_minmax(0,1.1fr)]">
          <div className={cn(cell, "border-b border-r border-pub-line sm:border-b-0")}>
            <dt className={dt}>{t("Check-in")}</dt>
            <dd className={dd}>{t.dayMonth(stay.checkIn)}</dd>
          </div>
          <div className={cn(cell, "border-b border-pub-line sm:border-b-0 sm:border-r")}>
            <dt className={dt}>{t("Check-out")}</dt>
            <dd className={dd}>{t.dayMonth(stay.checkOut)}</dd>
          </div>
          <div className={cn(cell, "border-r border-pub-line")}>
            <dt className={dt}>{t("Nights")}</dt>
            <dd className={dd}>{String(nights).padStart(2, "0")}</dd>
          </div>
          <div className={cn(cell, "sm:border-r sm:border-pub-line")}>
            <dt className={dt}>{t("Guests")}</dt>
            <dd className={dd}>{guestsLabel(t, stay.adults, stay.children)}</dd>
          </div>
        </dl>
        <div className="flex items-center border-t border-pub-line px-4 py-1 sm:border-t-0 sm:px-6 sm:py-0">
          <TextLink href={changeHref}>{t("Change search")}</TextLink>
        </div>
      </div>
    </GlassPanel>
  );
}

/** Steps 1 and edit: another way to book, for guests who would rather talk. */
async function TalkToUs({ phone, whatsapp }: { phone: string | null; whatsapp: string | null }) {
  const t = await getT();
  return (
    <aside aria-labelledby="talk-title" className="min-w-0 lg:col-span-3 lg:col-start-10 lg:pt-2">
      <Eyebrow as="h2" rule>
        <span id="talk-title">{t("Prefer to talk?")}</span>
      </Eyebrow>
      <p className={cn(typeScale.small, "mt-4 text-pub-muted")}>{t("Our front desk will happily find the right room and reserve it for you.")}</p>
      <ul className="mt-4 border-t border-pub-line">
        {phone && (
          <li className="border-b border-pub-line">
            <a href={telHref(phone)} className="group flex min-h-12 items-center gap-3 text-[15px] text-pub-fg transition-colors duration-200 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-gold motion-reduce:transition-none">
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-pub-eyebrow/35 text-pub-eyebrow">
                <Phone className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              </span>
              {phone}
            </a>
          </li>
        )}
        {whatsapp && (
          <li className="border-b border-pub-line">
            <a
              href={whatsappHref(whatsapp, "Hello, I would like to book a room.")}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex min-h-12 items-center gap-3 text-[15px] text-pub-fg transition-colors duration-200 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-gold motion-reduce:transition-none"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full border border-pub-eyebrow/35 text-pub-eyebrow">
                <MessageCircle className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
              </span>
              WhatsApp<span className="sr-only"> {t("(opens in a new tab)")}</span>
            </a>
          </li>
        )}
      </ul>
      <TextLink href="/contact?subject=booking" className="mt-3">{t("Send a message")}</TextLink>
    </aside>
  );
}

/** Phones: the chosen room in one line above the form (the full summary sits beside it on desktop). */
async function SelectionLine({ quote }: { quote: SelectionQuote }) {
  const t = await getT();
  const img = quote.type.images[0];
  return (
    <div className={cn(fx.card, "relative flex items-center gap-4 p-3 pr-4")}>
      {img && <MediaFrame src={img} alt="" ratio="1/1" sizes="64px" rounded="soft" className="w-16 shrink-0" />}
      <p className="min-w-0 flex-1 leading-snug">
        <span className="block truncate font-display text-[1.25rem] leading-tight">
          {quote.selection.rooms > 1 ? `${quote.selection.rooms} × ` : ""}{t(quote.type.name)}
        </span>
        <span className="mt-0.5 block text-[13px] text-pub-muted">{t.plural(quote.nights, "{n} night · estimated total", "{n} nights · estimated total")}</span>
      </p>
      <span className="shrink-0 font-display text-[1.25rem] leading-none lining-nums tabular-nums">{formatTZS(quote.netAmount)}</span>
    </div>
  );
}

/** Desktop: the chosen room beside the form, sticky — photo, stay and the estimated total. */
async function SelectionAside({ quote }: { quote: SelectionQuote }) {
  const t = await getT();
  const typeName = t(quote.type.name);
  const img = quote.type.images[0];
  return (
    <aside aria-label={t("Your selection")} className="hidden min-w-0 lg:col-span-4 lg:col-start-9 lg:block">
      <div className={cn(fx.card, "sticky top-24 overflow-hidden")}>
        {img && (
          <div className="relative p-2.5 pb-0">
            <MediaFrame src={img} alt={t("{name} at Vegas Luxury Hotel", { name: typeName })} ratio="3/2" rounded="soft" sizes="(min-width: 1024px) 30vw, 100vw" />
            <span aria-hidden="true" className="pub-hud-corners" style={{ "--hud-o": "-1.25rem", "--hud-l": "0.875rem", "--hud-c": "rgb(244 220 168 / 0.85)" } as React.CSSProperties} />
          </div>
        )}
        <div className="p-6 xl:p-7">
          <div className="flex items-center justify-between gap-4">
            <HudLabel>{t("Your selection")}</HudLabel>
            <span aria-hidden="true" className="font-mono text-[10px] uppercase tracking-[0.2em] text-pub-muted sm:text-[11px]">
              {t.plural(quote.nights, "{n} night", "{n} nights", { n: String(quote.nights).padStart(2, "0") })}
            </span>
          </div>
          <p className={cn(typeScale.subheading, "mt-3")}>{quote.selection.rooms > 1 ? `${quote.selection.rooms} × ` : ""}{typeName}</p>
          <InfoList
            className="mt-3"
            items={[
              { label: t.plural(quote.nights, "{n} night", "{n} nights") },
              { label: t("In from {time}", { time: quote.checkInTime }) },
              { label: t("Out by {time}", { time: quote.checkoutTime }) },
            ]}
          />
          <div className="mt-6 flex items-baseline justify-between gap-4 border-t border-pub-line pt-5">
            <span className="text-[13px] text-pub-muted">{t("Estimated total")}</span>
            <span className="font-display text-[1.75rem] leading-none lining-nums tabular-nums">{formatTZS(quote.netAmount)}</span>
          </div>
          {quote.discountAmount > 0 && <p className="mt-2 text-right text-[13px] text-pub-eyebrow">{t("Includes {amount} website discount", { amount: formatTZS(quote.discountAmount) })}</p>}
        </div>
      </div>
    </aside>
  );
}
