import type { Metadata } from "next";
import { businessToday, getSettings } from "@/server/settings";
import { transportServices } from "@/server/services/transport";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { getSiteContent } from "@/server/services/site-content";
import { isFromPrice } from "@/lib/transport-meta";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "@/components/public/contact";
import { ILLUSTRATIVE, photo } from "@/components/public/content";
import {
  Accent,
  Actions,
  EditorialSplit,
  Eyebrow,
  Heading,
  Lede,
  LinkButton,
  MediaFrame,
  PriceTag,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  rhythm,
  typeScale,
} from "@/components/public/kit";
import { PageHero } from "@/components/public/page-hero";
import { Steps } from "@/components/public/services/steps";
import { TransportRequest } from "@/components/public/transport-request";

export const metadata: Metadata = {
  title: "Airport Pickup & Guest Transport",
  description: "Airport pickup from Julius Nyerere International Airport to Vegas Luxury Hotel, airport drop-offs and trips in Dar es Salaam. Request online — no account needed.",
  alternates: { canonical: "/transport" },
};

/**
 * Transport as a hotel service ("Arrive without the stress"): the photograph with the pickup price · how it works,
 * beside the hotel's own gate · #request — the request form (services and prices from Staff → Transport; ?service=
 * preselects one) · a quiet line for travellers who need a car today. The request stays pending until we confirm.
 */
export default async function TransportPage({ searchParams }: PageProps<"/transport">) {
  const [services, s, today, sp, c] = await Promise.all([transportServices({ publicOnly: true }), getSettings(), businessToday(), searchParams, getSiteContent()]);
  const online = services.length > 0 ? await onlinePayAvailable("transport", s) : false;
  const pickup = services.find((x) => x.type === "AIRPORT_PICKUP");
  const gate = photo("/images/exterior/exterior-02.webp");
  const contact = s.whatsapp
    ? { href: whatsappHref(s.whatsapp, "Hello Vegas Luxury Hotel, I would like to arrange transport."), label: "WhatsApp us", external: true }
    : s.phone
      ? { href: telHref(s.phone), label: "Call us", external: false }
      : { href: "/contact?subject=transfer", label: "Send us a message", external: false };
  const external = contact.external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  const newTab = contact.external && <span className="sr-only"> (opens in a new tab)</span>;
  const call = s.whatsapp && s.phone ? { href: telHref(s.phone), label: `Call ${s.phone}` } : null;

  return (
    <>
      <PageHero
        kicker="Airport pickup & transport"
        title="Arrive without the stress"
        image={ILLUSTRATIVE.darCityAerial.src}
        imageAlt={ILLUSTRATIVE.darCityAerial.alt}
        focal="50% 60%"
        id="transport-title"
        intro={<p>About {c.facts.airportKm} km from the airport to our door — with a hotel driver waiting at arrivals.</p>}
      >
        {pickup && (
          <PriceTag className="mt-6" amount={pickup.price} from={isFromPrice(pickup.type, pickup.options.length)} unit="pickup" />
        )}
        <Actions className="mt-7 sm:mt-8">
          <LinkButton href="#request" icon="arrow">{pickup ? "Request airport pickup" : "Request transport"}</LinkButton>
          <TextLink href={contact.href} {...external}>
            {contact.label}
            {newTab}
          </TextLink>
        </Actions>
      </PageHero>

      {/* How it works: three short steps beside the hotel's own gate. */}
      <Section labelledBy="how-title">
        <Reveal>
          <EditorialSplit
            layout="balanced"
            reverse
            media={<MediaFrame src={gate.src} alt={gate.alt} ratio="4/3" ratioLg="4/5" focal="60% 50%" sizes="(min-width: 1024px) 46vw, 100vw" />}
          >
            <Eyebrow>How it works</Eyebrow>
            <Heading id="how-title" className={rhythm.afterEyebrow}>
              From arrivals <Accent>to our door</Accent>
            </Heading>
            <Lede className={rhythm.afterHeading}>
              Airport pickups, drop-offs and trips around Dar es Salaam with the hotel’s own drivers.
            </Lede>
            <Steps
              className="mt-8"
              items={[
                { title: "Tell us when", body: "Send your flight or pickup time below — no account needed." },
                { title: "We confirm with you", body: "Reception calls or messages you to confirm the time, the place and the price." },
                { title: "Your driver is there", body: "For airport pickups we wait at arrivals — tell us if you would like a name sign." },
              ]}
            />
          </EditorialSplit>
        </Reveal>
      </Section>

      <Section id="request" tone="deep" labelledBy="request-title">
        <SectionIntro
          eyebrow="Request transport"
          id="request-title"
          title="Tell us where and when"
          lede="No account needed. We call or WhatsApp you to confirm — your request is confirmed only then."
        />
        <div className={rhythm.afterIntro}>
          {services.length > 0 ? (
            <TransportRequest
              services={services.map((x) => ({
                id: x.id,
                name: x.name,
                description: x.description,
                type: x.type,
                price: x.price,
                options: x.options.map((o) => ({ id: o.id, name: o.name, description: o.description, price: o.price })),
              }))}
              today={today}
              initial={typeof sp.service === "string" ? sp.service : null}
              online={online}
            />
          ) : (
            <div className="max-w-xl border-t border-pub-line pt-8">
              <p className={cn(typeScale.lede, "text-pub-muted")}>Transport requests are paused right now — please call us.</p>
              <Actions className="mt-6">
                <TextLink href={contact.href} {...external}>
                  {contact.label}
                  {newTab}
                </TextLink>
              </Actions>
            </div>
          )}
        </div>
      </Section>

      {/* What next, when the trip is today. */}
      <Section tone="night" glow="top" space="sm" width="narrow" labelledBy="today-title" containerClassName="text-center">
        <Reveal>
          <Heading id="today-title" className="mx-auto max-w-xl">
            Travelling <Accent>today?</Accent>
          </Heading>
          <p className={cn(typeScale.lede, "mx-auto mt-4 max-w-md text-pub-muted")}>Call or WhatsApp us — we arrange it directly.</p>
          <Actions align="center" className={rhythm.beforeActions}>
            <LinkButton href={contact.href} {...external}>
              {contact.label}
              {newTab}
            </LinkButton>
            {call && <TextLink href={call.href}>{call.label}</TextLink>}
          </Actions>
        </Reveal>
      </Section>
    </>
  );
}
