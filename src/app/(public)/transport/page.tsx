import type { Metadata } from "next";
import { businessToday, getSettings } from "@/server/settings";
import { transportServices } from "@/server/services/transport";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { getSiteContent } from "@/server/services/site-content";
import { isFromPrice } from "@/lib/transport-meta";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "@/components/public/contact";
import { ILLUSTRATIVE } from "@/components/public/content";
import {
  Accent,
  Actions,
  Atmosphere,
  HOTEL_COORDS,
  Heading,
  HudLabel,
  IllustrativeTag,
  LinkButton,
  MediaFrame,
  PriceTag,
  Reveal,
  Section,
  SectionIndex,
  SectionIntro,
  TextLink,
  containers,
  rhythm,
  typeScale,
} from "@/components/public/kit";
import { ClosingBand } from "@/components/public/closing-band";
import { PageHero } from "@/components/public/page-hero";
import { RouteMap } from "@/components/public/services/route-line";
import { Steps } from "@/components/public/services/steps";
import { TransportRequest } from "@/components/public/transport-request";

export const metadata: Metadata = {
  title: "Airport Pickup & Guest Transport",
  description: "Airport pickup from Julius Nyerere International Airport to Vegas Luxury Hotel, airport drop-offs and trips in Dar es Salaam. Request online — no account needed.",
  alternates: { canonical: "/transport" },
};

/**
 * Transport as a hotel service ("Arrive without the stress"): the photograph with the pickup price ·
 * 01 the route — a HUD map from the airport to our door (the real distance, the hotel at its real
 * coordinates, a lit comet on the road) and how it works as a process track · #request — the request
 * form in a glass console over the city (services and prices from Staff → Transport; ?service=
 * preselects one) · a quiet line for travellers who need a car today. The request stays pending
 * until we confirm.
 */
export default async function TransportPage({ searchParams }: PageProps<"/transport">) {
  const [services, s, today, sp, c] = await Promise.all([transportServices({ publicOnly: true }), getSettings(), businessToday(), searchParams, getSiteContent()]);
  const online = services.length > 0 ? await onlinePayAvailable("transport", s) : false;
  const pickup = services.find((x) => x.type === "AIRPORT_PICKUP");
  const contact = s.whatsapp
    ? { href: whatsappHref(s.whatsapp, "Hello Vegas Luxury Hotel, I would like to arrange transport."), label: "WhatsApp us", external: true }
    : s.phone
      ? { href: telHref(s.phone), label: "Call us", external: false }
      : { href: "/contact?subject=transfer", label: "Send us a message", external: false };
  const external = contact.external ? { target: "_blank", rel: "noopener noreferrer" } : {};
  const newTab = contact.external && <span className="sr-only"> (opens in a new tab)</span>;
  const call = s.whatsapp && s.phone ? { href: telHref(s.phone), label: `Call ${s.phone}` } : null;
  const distance = `About ${c.facts.airportKm} km`;
  const backdrop = ILLUSTRATIVE.darCoastAerial;

  return (
    <>
      <PageHero
        kicker="Airport pickup & transport"
        title="Arrive without the stress"
        image={ILLUSTRATIVE.darCityAerial.src}
        imageAlt={ILLUSTRATIVE.darCityAerial.alt}
        focal="50% 60%"
        scrim="strong"
        id="transport-title"
        meta={<>JNIA → {s.hotelName} · {distance}</>}
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

      {/* 01 · The route: airport → our door on a HUD map, then how it works as a process track. */}
      <Section
        tone="night"
        pattern="contour"
        labelledBy="how-title"
        marker={{ index: 1, label: "The route", aside: <HudLabel tick={false}>JNIA → Mlimani City</HudLabel> }}
      >
        <Reveal>
          <SectionIntro
            align="split"
            eyebrow="How it works"
            id="how-title"
            title={
              <>
                From arrivals <Accent>to our door</Accent>
              </>
            }
            lede="Airport pickups, drop-offs and trips around Dar es Salaam with the hotel’s own drivers."
          />
        </Reveal>
        <Reveal className="mt-10 sm:mt-14">
          <RouteMap
            airport="Julius Nyerere International Airport"
            hotel={s.hotelName}
            coords={HOTEL_COORDS.label}
            distance={distance}
            className="mx-auto max-w-6xl"
          />
        </Reveal>
        <Reveal className="mt-12 sm:mt-16 lg:mt-20">
          <Steps
            layout="track"
            items={[
              { title: "Tell us when", body: "Send your flight or pickup time below — no account needed." },
              { title: "We confirm with you", body: "Reception calls or messages you to confirm the time, the place and the price." },
              { title: "Your driver is there", body: "For airport pickups we wait at arrivals — tell us if you would like a name sign." },
            ]}
          />
        </Reveal>
      </Section>

      {/* #request · the request console in glass, over the city. */}
      <section id="request" data-tone="night" aria-labelledby="request-title" className="relative isolate scroll-mt-header overflow-clip bg-night text-pub-fg">
        <div className="absolute inset-x-0 top-0 -z-10 h-[34rem] sm:h-[40rem] lg:h-[46rem]">
          <MediaFrame src={backdrop.src} alt="" ratio="fill" sizes="100vw" focal="60% 40%" illustrative={false} />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--pub-night)_0%,rgb(15_12_9/0.78)_12%,rgb(15_12_9/0.62)_32%,rgb(15_12_9/0.72)_62%,var(--pub-night)_100%)]"
          />
          {/* Stock photo: the honest tag sits above the scrim. */}
          <IllustrativeTag className="absolute right-4 top-4 sm:right-8 sm:top-8" />
        </div>
        <Atmosphere tone="night" atmosphere="calm" pattern="grid" />
        <div className={cn(containers.default, "py-16 sm:py-20 lg:py-28")}>
          <SectionIndex
            index={2}
            label="Request"
            aside={services.length > 0 ? <HudLabel tick={false}>{String(services.length).padStart(2, "0")} services</HudLabel> : undefined}
            className="mb-8 sm:mb-10 lg:mb-14"
          />
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
        </div>
      </section>

      {/* What next, when the trip is today: the closing moment at the hotel's own gate (where the driver brings you). */}
      <ClosingBand image="/images/exterior/exterior-02.webp" focal="62% 50%" labelledBy="today-title">
        {s.receptionHours && <HudLabel className="mb-5 justify-center text-white/75">Reception · {s.receptionHours}</HudLabel>}
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
      </ClosingBand>
    </>
  );
}
