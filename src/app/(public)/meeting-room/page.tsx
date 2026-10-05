import type { Metadata } from "next";
import { businessToday, getSettings } from "@/server/settings";
import { publicMeetingRoom } from "@/server/services/booking-requests";
import { parseImages } from "@/server/services/public-booking";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { getSiteContent } from "@/server/services/site-content";
import { contentVars, telHref, whatsappHref } from "@/components/public/contact";
import { fill, ILLUSTRATIVE, MEETING_GALLERY_KEYS } from "@/components/public/content";
import {
  Accent,
  Actions,
  EditorialSplit,
  Eyebrow,
  Heading,
  InfoList,
  Lede,
  LinkButton,
  MediaFrame,
  PriceTag,
  Rail,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  rhythm,
} from "@/components/public/kit";
import { MeetingBooking } from "@/components/public/meeting-booking";
import { PageHero } from "@/components/public/page-hero";

export const metadata: Metadata = {
  title: "Meeting Room",
  description: "Book the meeting room at Vegas Luxury Hotel, Mlimani City, Dar es Salaam — check availability for your date and time and book online. Call or WhatsApp us any time.",
  alternates: { canonical: "/meeting-room" },
};

const ALT = new Map<string, string>(MEETING_GALLERY_KEYS.map((k) => [ILLUSTRATIVE[k].src, ILLUSTRATIVE[k].alt]));

/**
 * The Meeting Room as a hotel service ("Meet differently"): the photograph with the name, price and
 * capacity · the room in a few words and what is close at hand · #book — live availability and booking through
 * the same engine as reception (MeetingBooking). Stock photos stand in until the hotel adds its own,
 * always tagged "Illustrative"; only the hotel's own photos earn a gallery. Generic name only —
 * never the internal room number.
 */
export default async function MeetingRoomPage() {
  const [settings, c, room, today] = await Promise.all([getSettings(), getSiteContent(), publicMeetingRoom(), businessToday()]);
  const p = c.pages.meeting;
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm }));
  // Public name is generic — the internal room number is not shown to guests.
  const name = room?.name ?? p.fallbackName;
  const own = room ? parseImages(room.images) : [];
  const photos = own.length ? own : MEETING_GALLERY_KEYS.map((k) => ILLUSTRATIVE[k].src);
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

  const story = (
    <>
      <Eyebrow>The room</Eyebrow>
      <Heading id="room-title" className={rhythm.afterEyebrow}>
        Meet <Accent>differently</Accent>
      </Heading>
      <Lede className={rhythm.afterHeading}>
        {room
          ? "For business meetings, workshops and private gatherings — choose your hours and book them online in minutes."
          : "For business meetings, workshops and private gatherings — tell us your date and we will help you plan it."}
      </Lede>
      {/* Price and capacity are in the hero and beside the booking form — not repeated here. */}
      <InfoList items={p.why.map((x) => ({ label: f(x.title), icon: x.icon }))} className="mt-8" />
    </>
  );

  return (
    <>
      <PageHero kicker={p.kicker} title={name} intro={<p>{intro}</p>} image={hero} imageAlt={alt(hero)} focal="50% 55%" id="meeting-title">
        {room && <PriceTag className="mt-6" amount={room.baseRate} unit="booking" note={`Up to ${room.maxAdults} people`} />}
        <Actions className="mt-7 sm:mt-8">
          {room ? (
            <LinkButton href="#book" icon="arrow">Check availability</LinkButton>
          ) : (
            <LinkButton href={contact.href} icon="arrow" {...external}>
              {contact.label}
              {contact.external && <span className="sr-only"> (opens in a new tab)</span>}
            </LinkButton>
          )}
          {room ? (
            <TextLink href={contact.href} {...external}>
              {contact.label}
              {contact.external && <span className="sr-only"> (opens in a new tab)</span>}
            </TextLink>
          ) : (
            contact.href !== "/contact?subject=meeting" && <TextLink href="/contact?subject=meeting">Send a message</TextLink>
          )}
        </Actions>
      </PageHero>

      {/* The room: a second photograph, a few words, what is close at hand. */}
      <Section labelledBy="room-title">
        <Reveal>
          {detail ? (
            <EditorialSplit
              layout="media-wide"
              reverse
              media={<MediaFrame src={detail} alt={alt(detail)} ratio="4/3" ratioLg="5/4" zoom sizes="(min-width: 1024px) 55vw, 100vw" />}
            >
              {story}
            </EditorialSplit>
          ) : (
            <div className="max-w-2xl">{story}</div>
          )}
        </Reveal>
        {more.length > 0 && (
          <Reveal className="mt-14 sm:mt-16">
            <Rail label={`${name} photos`} size="md" desktop={more.length <= 3 ? "grid" : "rail"} cols={3}>
              {more.map((src) => (
                <MediaFrame key={src} src={src} alt={alt(src)} ratio="4/3" zoom sizes="(min-width: 1024px) 31vw, (min-width: 640px) 44vw, 76vw" />
              ))}
            </Rail>
          </Reveal>
        )}
      </Section>

      {room && (
        <Section id="book" tone="deep" labelledBy="book-title">
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
