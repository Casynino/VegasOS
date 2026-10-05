import type { Metadata } from "next";
import { businessToday, getSettings } from "@/server/settings";
import { publicMeetingRoom } from "@/server/services/booking-requests";
import { parseImages } from "@/server/services/public-booking";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { getSiteContent } from "@/server/services/site-content";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { contentVars, telHref, whatsappHref } from "@/components/public/contact";
import { fill, GALLERY, ILLUSTRATIVE, MEETING_GALLERY_KEYS } from "@/components/public/content";
import {
  Accent,
  Actions,
  Atmosphere,
  GlassPanel,
  HOTEL_COORDS,
  Heading,
  HudLabel,
  IllustrativeTag,
  InfoList,
  Lede,
  LinkButton,
  MediaFrame,
  Rail,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  containers,
  rhythm,
} from "@/components/public/kit";
import { MeetingBooking } from "@/components/public/meeting-booking";
import { PageHero } from "@/components/public/page-hero";
import { SpecRows } from "@/components/public/services/spec-sheet";

export const metadata: Metadata = {
  title: "Meeting Room",
  description: "Book the meeting room at Vegas Luxury Hotel, Mlimani City, Dar es Salaam — check availability for your date and time and book online. Call or WhatsApp us any time.",
  alternates: { canonical: "/meeting-room" },
};

const ALT = new Map<string, string>([
  ...MEETING_GALLERY_KEYS.map((k) => [ILLUSTRATIVE[k].src, ILLUSTRATIVE[k].alt] as const),
  ...GALLERY.map((g) => [g.src, g.alt] as const),
]);
/** The hotel's own boardroom photograph — it leads whenever the room type has no photos of its own. */
const OWN_PHOTO = "/images/meeting/meeting-01.webp";

/**
 * The Meeting Room as a hotel service ("Meet differently"): the photograph · a second photograph with
 * the room's spec sheet floating over it in glass (capacity and price from the database, what is close
 * at hand) · the room's own photos, when it has more · #book — the booking console: live availability
 * and booking through the same engine as reception (MeetingBooking). Stock photos stand in until the
 * hotel adds its own, always tagged "Illustrative". Generic name only — never the internal room number.
 */
export default async function MeetingRoomPage() {
  const [settings, c, room, today] = await Promise.all([getSettings(), getSiteContent(), publicMeetingRoom(), businessToday()]);
  const p = c.pages.meeting;
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm }));
  // Public name is generic — the internal room number is not shown to guests.
  const name = room?.name ?? p.fallbackName;
  const own = room ? parseImages(room.images) : [];
  const photos = own.length ? own : [OWN_PHOTO, ...MEETING_GALLERY_KEYS.map((k) => ILLUSTRATIVE[k].src)];
  const [hero, detail] = photos;
  const more = own.slice(2, 8);
  const alt = (src: string) => ALT.get(src) ?? `${name} at ${settings.hotelName}`;
  const intro = room?.shortDescription || room?.description || p.fallbackDescription;
  const online = room ? await onlinePayAvailable("meeting", settings) : false;
  const contact = settings.whatsapp
    ? { href: whatsappHref(settings.whatsapp, `Hello, I would like to book the ${name}.`), label: "WhatsApp us", external: true }
    : settings.phone
      ? { href: telHref(settings.phone), label: "Call us", external: false }
      : { href: "/contact?subject=meeting", label: "Send us a message", external: false };
  const external = contact.external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  const newTab = contact.external && <span className="sr-only"> (opens in a new tab)</span>;

  // The spec sheet: only real figures (capacity and price from the room in the database).
  const spec = room
    ? [
        { label: "Capacity", value: `Up to ${room.maxAdults} people` },
        { label: "Price", value: <>{formatTZS(room.baseRate)}<span className="ml-1.5 font-sans text-[12px] text-pub-muted">/ booking</span></> },
        { label: "Food & drinks", value: "On the same bill" },
      ]
    : [];

  return (
    <>
      <PageHero
        kicker={p.kicker}
        title={name}
        intro={<p>{intro}</p>}
        image={hero}
        imageAlt={alt(hero)}
        focal="50% 55%"
        id="meeting-title"
        meta={room ? <>Up to {room.maxAdults} people · {HOTEL_COORDS.label}</> : undefined}
      >
        <Actions className="mt-7 sm:mt-8">
          {room ? (
            <LinkButton href="#book" icon="arrow">Check availability</LinkButton>
          ) : (
            <LinkButton href={contact.href} icon="arrow" {...external}>
              {contact.label}
              {newTab}
            </LinkButton>
          )}
          {room ? (
            <TextLink href={contact.href} {...external}>
              {contact.label}
              {newTab}
            </TextLink>
          ) : (
            contact.href !== "/contact?subject=meeting" && <TextLink href="/contact?subject=meeting">Send a message</TextLink>
          )}
        </Actions>
      </PageHero>

      {/* The room's own photos, when the hotel has added more than two — between the two big photographs, so they never touch. */}
      {more.length > 0 && (
        <Section
          space="sm"
          labelledBy="photos-title"
          marker={{ index: 1, label: "The room in photos", aside: <HudLabel tick={false}>{String(more.length).padStart(2, "0")} photos</HudLabel> }}
        >
          <h2 id="photos-title" className="sr-only">{name} photos</h2>
          <Reveal>
            <Rail label={`${name} photos`} size="md" desktop={more.length <= 3 ? "grid" : "rail"} cols={3}>
              {more.map((src, i) => (
                <MediaFrame key={src} src={src} alt={alt(src)} ratio="4/3" zoom reveal="left" sizes="(min-width: 1024px) 31vw, (min-width: 640px) 44vw, 76vw" caption={`Fig. ${String(i + 1).padStart(2, "0")}`} />
              ))}
            </Rail>
          </Reveal>
        </Section>
      )}

      {/* Meet differently: the second photograph, with the room's spec sheet floating over it in glass. */}
      <section data-tone="night" aria-labelledby="room-title" className="relative isolate overflow-hidden bg-night text-pub-fg">
        <Atmosphere tone="night" atmosphere="calm" pattern="grid" edges="top" className="pub-atmo--hero" />
        {detail && (
          <div className="relative -z-10 aspect-[4/5] sm:aspect-[16/10] lg:absolute lg:inset-0 lg:aspect-auto">
            <MediaFrame
              src={detail}
              alt={alt(detail)}
              ratio="fill"
              sizes="100vw"
              focal="50% 50%"
              focalSm="40% 50%"
              illustrative={false}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,var(--pub-night)_0%,rgb(15_12_9/0.55)_26%,rgb(15_12_9/0)_60%),linear-gradient(to_bottom,rgb(15_12_9/0.7),rgb(15_12_9/0)_18%)] lg:bg-[linear-gradient(to_left,rgb(12_10_7/0.82)_0%,rgb(12_10_7/0.45)_36%,rgb(12_10_7/0.05)_62%),linear-gradient(to_top,var(--pub-night),rgb(12_10_7/0.55)_14%,rgb(12_10_7/0)_40%),linear-gradient(to_bottom,rgb(15_12_9/0.85),rgb(15_12_9/0)_22%)]"
            />
            <span aria-hidden="true" className="pub-hud-corners hidden lg:block" style={{ inset: "2rem", "--hud-l": "1.25rem", "--hud-c": "rgb(240 214 160 / 0.5)" } as React.CSSProperties} />
            {/* Stock photo: the honest tag sits above the scrim, clear of the bracket. */}
            {detail.includes("/illustrative/") && <IllustrativeTag className="absolute left-4 top-4 z-10 sm:left-8 sm:top-8 lg:left-12 lg:top-12" />}
          </div>
        )}
        <div
          className={cn(
            containers.default,
            "relative pb-16 sm:pb-20 lg:flex lg:min-h-[min(88vh,56rem)] lg:items-center lg:justify-end lg:py-28",
            detail ? "-mt-36 sm:-mt-44 lg:mt-0" : "pt-16 sm:pt-20",
          )}
        >
          {detail && (
            <div className="absolute bottom-12 left-8 hidden flex-col gap-3 lg:flex">
              <HudLabel className="text-white/75">{name}</HudLabel>
              <HudLabel tick={false} className="text-white/60">{HOTEL_COORDS.label}</HudLabel>
            </div>
          )}
          <Reveal className="w-full lg:max-w-[31rem]">
            <GlassPanel variant="smoke" padding="lg" rounded="lg" hud spotlight className="w-full">
              <HudLabel>Spec · {name}</HudLabel>
              <Heading id="room-title" className="mt-5">
                Meet <Accent>differently</Accent>
              </Heading>
              <Lede className={cn(rhythm.afterHeading, "text-pub-fg/80")}>
                {room
                  ? "For business meetings, workshops and private gatherings — choose your hours and book them online in minutes."
                  : "For business meetings, workshops and private gatherings — tell us your date and we will help you plan it."}
              </Lede>
              {spec.length > 0 && <SpecRows rows={spec} className="mt-7" />}
              <InfoList items={p.why.map((x) => ({ label: f(x.title), icon: x.icon }))} className="mt-6" />
              <Actions className="mt-8">
                {room ? (
                  <LinkButton href="#book" icon="arrow">Book the Meeting Room</LinkButton>
                ) : (
                  <LinkButton href={contact.href} icon="arrow" {...external}>
                    {contact.label}
                    {newTab}
                  </LinkButton>
                )}
              </Actions>
            </GlassPanel>
          </Reveal>
        </div>
      </section>

      {room && (
        <Section
          id="book"
          tone="night"
          atmosphere="calm"
          pattern="grid"
          labelledBy="book-title"
          marker={{ index: more.length > 0 ? 2 : 1, label: "Booking console", aside: <HudLabel tick={false}>No account needed</HudLabel> }}
        >
          <SectionIntro
            eyebrow="Book the Meeting Room"
            title="Check your date and time"
            id="book-title"
            lede={
              online
                ? "See at once if the room is free. Pay now and it is confirmed straight away — or send a request and we confirm it with you."
                : "See at once if the room is free, then book it — no account needed. We confirm by phone or WhatsApp."
            }
          />
          <div className={rhythm.afterIntro}>
            <MeetingBooking today={today} price={room.baseRate} capacity={room.maxAdults} online={online} name={name} />
          </div>
        </Section>
      )}
    </>
  );
}
