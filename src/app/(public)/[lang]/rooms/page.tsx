import type { Metadata } from "next";
import { ArrowDown, Clock, MessageCircle } from "lucide-react";
import { getSettings } from "@/server/settings";
import { bookingWindow, listPublicRoomTypes, websitePricer } from "@/server/services/public-booking";
import { addDays } from "@/lib/time/business-date";
import { formatNumber, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { contentVars } from "@/components/public/contact";
import { fill, portraitFor } from "@/components/public/content";
import { getSiteContent } from "@/server/services/site-content";
import { NamedIcon } from "@/components/public/icon";
import {
  Actions, GlassPanel, HOTEL_COORDS, HudLabel, LinkButton, Reveal, Section, SectionIntro, StaggerItem, TextLink, rhythm, typeScale,
} from "@/components/public/kit";
import { PageHero } from "@/components/public/page-hero";
import { RoomChapter, pad2 } from "@/components/public/room-chapter";
import { RoomDetails } from "@/components/public/room-details";
import { StaySearchForm } from "@/components/public/stay-search-form";
import fx from "@/components/public/room-fx.module.css";
import { msg } from "@/i18n/msg";
import { getT, pageLocale } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/[lang]/rooms">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  return {
    title: t("Rooms & suites"),
    description: t(
      "Standard Single, Double Deluxe, Executive, Executive Suite and Twin rooms at Vegas Luxury Hotel, Dar es Salaam — all with free Wi-Fi and breakfast. Book direct online.",
    ),
    alternates: { canonical: "/rooms" },
  };
}

const SPAN_BASE = ["", "", "col-span-2"] as const;
const SPAN_SM = ["", "sm:col-span-1", "sm:col-span-2", "sm:col-span-3"] as const;
const SPAN_LG = ["", "lg:col-span-1", "lg:col-span-2", "lg:col-span-3", "lg:col-span-4"] as const;
/** Column span for the last of `total` cells so it completes its row in a 2 / 3 / 4-column grid. */
function fillSpan(total: number) {
  const span = (cols: number) => (total % cols === 0 ? 1 : cols - (total % cols) + 1);
  return cn(SPAN_BASE[span(2)], SPAN_SM[span(3)], SPAN_LG[span(4)]);
}

const WORDS = ["", msg("One"), msg("Two"), msg("Three"), msg("Four"), msg("Five"), msg("Six"), msg("Seven"), msg("Eight"), msg("Nine"), msg("Ten")];

/**
 * Rooms: the photograph first; a room index (every type side by side, tonight's website rate,
 * a jump to its chapter); then one chapter band per room type — parallax photo in a HUD frame,
 * a glass spec panel, the outline index numeral — alternating night and paper; what every room
 * includes as a spec plate; and a closing booking console. Room types only — never room numbers.
 */
export default async function RoomsPage({ params }: PageProps<"/[lang]/rooms">) {
  await pageLocale(params);
  const t = await getT();
  /** "Up to 2 adults · 1 child" — from the database only. */
  const guests = (r: { maxAdults: number; maxChildren: number }) =>
    t.plural(r.maxAdults, "Up to {n} adult", "Up to {n} adults") + (r.maxChildren > 0 ? ` · ${t.plural(r.maxChildren, "{n} child", "{n} children")}` : "");
  const [settings, types, c] = await Promise.all([getSettings(), listPublicRoomTypes(), getSiteContent()]);
  const price = await websitePricer(settings);
  const stay = bookingWindow(settings);
  const p = c.pages.rooms;
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm }));
  const rooms = types.map((type) => {
    const p = price(type);
    return { ...type, image: type.images[0], net: p.net, baseRate: p.baseRate, promo: p.promoLabel };
  });
  const discount = rooms[0] ? rooms[0].baseRate - rooms[0].net : 0;
  // Amenities every public room type shares.
  const shared = rooms[0]?.amenities.filter((a) => rooms.every((r) => r.amenities.some((b) => b.code === a.code))) ?? [];
  const lowest = rooms.length ? Math.min(...rooms.map((r) => r.net)) : null;
  const n = rooms.length;

  return (
    <>
      <PageHero
        kicker={p.kicker}
        title={p.title}
        image={p.image.src}
        imageAlt={p.image.alt}
        mobileImage={portraitFor(p.image.src)}
        focal="50% 45%"
        id="rooms-title"
        size="lg"
        meta={n > 0 ? <>{t("{n} room types", { n: pad2(n) })} · {HOTEL_COORDS.label}</> : undefined}
        intro={
          <p>
            {f(p.intro)}
            {discount > 0 && <> {t("Online prices include our standard {amount} per night discount.", { amount: formatTZS(discount) })}</>}
          </p>
        }
      >
        <Actions className="mt-7 sm:mt-8">
          <LinkButton href="/book" icon="arrow">{t("Check availability")}</LinkButton>
          {n > 0 && <TextLink href="#room-types">{t("See the rooms")}</TextLink>}
        </Actions>
      </PageHero>

      {/* Room index: every type side by side — the comparison, and a jump to each chapter. */}
      <Section
        id="room-types"
        labelledBy="room-types-title"
        space="md"
        width="wide"
        marker={{
          index: 1,
          label: t("Room index"),
          aside: lowest !== null ? <HudLabel tick={false}>{t("From {price} · tonight’s website rates", { price: formatTZS(lowest) })}</HudLabel> : undefined,
        }}
      >
        {n === 0 ? (
          <div className="mx-auto max-w-md py-10 text-center">
            <h2 id="room-types-title" className={typeScale.subheading}>{t("Room types")}</h2>
            <p className={cn(typeScale.lede, "mt-3 text-pub-muted")}>{t("Room information is being updated — please contact us to book.")}</p>
            <Actions align="center" className={rhythm.beforeActions}>
              <TextLink href="/contact?subject=booking">{t("Contact the front desk")}</TextLink>
            </Actions>
          </div>
        ) : (
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-x-10">
            <Reveal className="min-w-0 lg:col-span-4">
              <SectionIntro
                eyebrow={t("Compare")}
                title={t("{count} ways to stay", { count: WORDS[n] ? t(WORDS[n]) : n })}
                id="room-types-title"
                lede={t("Every room type side by side, at tonight’s website rate. Choose one to see it up close.")}
              />
              <div className={cn(fx.ruler, "mt-9 hidden w-full max-w-xs lg:block")} aria-hidden="true" />
            </Reveal>
            <ol aria-label={t("Room types")} className="min-w-0 border-t border-pub-line lg:col-span-8 lg:col-start-5">
              {rooms.map((r, i) => (
                <StaggerItem as="li" index={i} key={r.slug} className="border-b border-pub-line">
                  <a
                    href={`#type-${r.slug}`}
                    className={cn(
                      fx.indexRow,
                      "group relative grid min-h-16 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,13rem)_auto_1.25rem] sm:gap-x-6 sm:py-5",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    )}
                  >
                    <span className="font-mono text-[11px] font-medium tracking-[0.18em] text-pub-eyebrow">{pad2(i + 1)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-display text-[1.375rem] font-medium leading-tight transition-colors duration-200 group-hover:text-pub-eyebrow motion-reduce:transition-none sm:text-[1.75rem]">
                        {t(r.name)}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-pub-muted sm:hidden">{guests(r)}</span>
                    </span>
                    <span className={cn(typeScale.meta, "hidden text-pub-muted sm:block")}>{guests(r)}</span>
                    <span className="text-right leading-none">
                      <span className="font-display text-[1.25rem] font-medium lining-nums tabular-nums sm:text-[1.5rem]">{formatNumber(r.net)}</span>
                      <span className="mt-1 block text-[10.5px] font-medium uppercase tracking-[0.16em] text-pub-muted">{t("TZS / night")}</span>
                    </span>
                    <ArrowDown
                      aria-hidden="true"
                      strokeWidth={1.6}
                      className="hidden size-4 text-pub-faint transition duration-300 ease-pub group-hover:translate-y-0.5 group-hover:text-pub-eyebrow motion-reduce:transition-none sm:block"
                    />
                  </a>
                </StaggerItem>
              ))}
            </ol>
          </div>
        )}
      </Section>

      {/* One chapter per room type, alternating night and paper (siblings, so the bands dissolve). */}
      {rooms.map((r, i) => (
        <RoomChapter key={r.slug} room={r} index={i + 1} total={n} tone={i % 2 === 0 ? "night" : "paper"} reverse={i % 2 === 1} />
      ))}

      {/* What every room includes, as a spec plate on drafting paper. */}
      {shared.length > 0 && (
        <Section tone="deep" space="md" width="wide" labelledBy="included-title" marker={{ index: 2, label: t("In every room") }}>
          <Reveal>
            <SectionIntro align="split" eyebrow={t("Included")} title={p.includedTitle} lede={f(p.includedNote)} id="included-title" />
          </Reveal>
          <ul className={cn(rhythm.afterIntro, "grid grid-cols-2 border-l border-t border-pub-line sm:grid-cols-3 lg:grid-cols-4")}>
            {shared.map((a, i) => (
              <StaggerItem
                as="li"
                index={i}
                key={a.code}
                className="relative flex min-h-[6.5rem] min-w-0 flex-col justify-between gap-3 border-b border-r border-pub-line p-3.5 sm:min-h-32 sm:gap-5 sm:p-5 lg:p-6"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border border-pub-eyebrow/35 text-pub-eyebrow sm:size-10">
                    <NamedIcon name={a.icon} className="size-[18px]" />
                  </span>
                  <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.2em] text-pub-muted">{pad2(i + 1)}</span>
                </span>
                <span className="min-w-0 text-[15px] leading-snug text-pub-fg">{t(a.name)}</span>
              </StaggerItem>
            ))}
            {/* The closing cell completes the last row at every width (no empty, half-bordered cells). */}
            <StaggerItem
              as="li"
              index={shared.length}
              className={cn(
                "relative flex min-h-[6.5rem] min-w-0 flex-col justify-between gap-3 border-b border-r border-pub-line bg-pub-fg/[0.03] p-3.5 sm:min-h-32 sm:gap-5 sm:p-5 lg:p-6",
                fillSpan(shared.length + 1),
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-pub-eyebrow/35 text-pub-eyebrow sm:size-10">
                  <Clock className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
                </span>
                <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.2em] text-pub-muted">{pad2(shared.length + 1)}</span>
              </span>
              <span className="min-w-0 text-[15px] leading-snug text-pub-fg">
                {t("Check-in {time}", { time: stay.checkInTime })} <span className="text-pub-faint">·</span> {t("Check-out {time}", { time: stay.checkoutTime })}
              </span>
            </StaggerItem>
          </ul>
          {/* The owner's detail photographs: beds, sofa and mirror, desk and kettle, bathrooms. */}
          <Reveal className="mt-14 sm:mt-16 lg:mt-20">
            <RoomDetails id="room-details-title" />
          </Reveal>
        </Section>
      )}

      {/* Closing booking console: dates and guests straight to live availability. */}
      <Section tone="night" space="md" width="wide" stars labelledBy="rooms-cta">
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-x-10">
          <Reveal className="min-w-0 lg:col-span-5">
            <SectionIntro
              eyebrow={t("Plan your stay")}
              title={p.helpTitle}
              lede={p.helpBody}
              id="rooms-cta"
              actions={
                <TextLink href="/contact?subject=booking" icon={<MessageCircle className="size-4" strokeWidth={1.6} aria-hidden="true" />}>
                  {t("Ask the front desk")}
                </TextLink>
              }
            />
          </Reveal>
          <div className="min-w-0 sm:mx-auto sm:max-w-xl sm:w-full lg:col-span-6 lg:col-start-7 lg:max-w-none">
            {stay.enabled ? (
              <GlassPanel variant="clear" padding="md" rounded="lg" hud>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <HudLabel live>{t("Live availability")}</HudLabel>
                  <HudLabel tick={false}>
                    {t("In {checkIn} · Out {checkOut}", { checkIn: stay.checkInTime, checkOut: stay.checkoutTime })}
                  </HudLabel>
                </div>
                <StaySearchForm
                  variant="hero"
                  defaults={{ checkIn: stay.today, checkOut: addDays(stay.today, 1), adults: 2, children: 0 }}
                  minDate={stay.today}
                  maxDate={stay.maxArrival}
                  maxNights={stay.maxNights}
                  submitLabel={t("Check availability")}
                  stacked
                />
              </GlassPanel>
            ) : (
              <Actions>
                <LinkButton href="/contact?subject=booking" icon="arrow">{t("Contact us to book")}</LinkButton>
              </Actions>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
