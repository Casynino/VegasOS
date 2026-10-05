import type { Metadata } from "next";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { getSettings } from "@/server/settings";
import { bookingWindow } from "@/server/services/public-booking";
import { cn } from "@/lib/utils";
import { addressLines, contentVars, telHref, whatsappHref } from "@/components/public/contact";
import { fill } from "@/components/public/content";
import { ContactForm } from "@/components/public/contact-form";
import { getSiteContent } from "@/server/services/site-content";
import { HotelJsonLd } from "@/components/public/hotel-jsonld";
import {
  Accent,
  Actions,
  EditorialSplit,
  Eyebrow,
  Heading,
  InfoList,
  LinkButton,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  rhythm,
  surface,
  typeScale,
} from "@/components/public/kit";
import { PageHero } from "@/components/public/page-hero";
import { ChannelList, type Channel } from "@/components/public/services/channel-list";
import { MAP_EMBED_URL, MAP_LINK_URL } from "@/components/public/site-config";
import { sendContactMessage } from "./actions";

export const metadata: Metadata = {
  title: "Contact & location",
  description: "Contact Vegas Luxury Hotel at Mlimani City Roundabout, behind Mwenge Tower, Dar es Salaam. Phone, WhatsApp, email, map and enquiry form.",
  alternates: { canonical: "/contact" },
};

/**
 * Contact, calmly: the lobby photograph · Reach us — call, WhatsApp and email (only what is set in Settings) beside the
 * enquiry form (#message; ?subject= preselects the topic) · Find us — the map with the address, hours and directions ·
 * a quiet closing call to book. HotelJsonLd stays on this page.
 */
export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const sp = await searchParams;
  const subject = Array.isArray(sp.subject) ? sp.subject[0] : sp.subject;
  const [settings, c] = await Promise.all([getSettings(), getSiteContent()]);
  const p = c.pages.contact;
  const w = bookingWindow(settings);
  const address = addressLines(settings);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.vegasluxuryhotel.co.tz";
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm }));

  const channels: Channel[] = [
    settings.phone && { key: "call", icon: Phone, label: "Call", value: settings.phone, href: telHref(settings.phone) },
    settings.whatsapp && { key: "whatsapp", icon: MessageCircle, label: "WhatsApp", value: "Chat with the front desk", href: whatsappHref(settings.whatsapp), external: true },
    settings.email && { key: "email", icon: Mail, label: "Email", value: settings.email, href: `mailto:${settings.email}` },
  ].filter((x): x is Channel => Boolean(x));
  const quick = channels.find((x) => x.key === "whatsapp") ?? channels.find((x) => x.key === "call");

  return (
    <>
      <HotelJsonLd settings={settings} baseUrl={baseUrl} content={c} />
      <PageHero kicker={p.kicker} title={p.title} image={p.image.src} imageAlt={p.image.alt} focal="50% 45%" id="contact-title" intro={<p>{p.intro}</p>}>
        <Actions className="mt-7 sm:mt-8">
          {quick ? (
            <LinkButton href={quick.href} icon="arrow" {...(quick.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {quick.key === "whatsapp" ? "WhatsApp us" : "Call us"}
              {quick.external && <span className="sr-only"> (opens in a new tab)</span>}
            </LinkButton>
          ) : (
            <LinkButton href="#message" icon="arrow">Write to us</LinkButton>
          )}
          {quick && <TextLink href="#message">Write to us</TextLink>}
        </Actions>
      </PageHero>

      {/* Reach us: the direct lines beside the form. */}
      <Section labelledBy="reach-title">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-10">
          <div className="min-w-0 lg:sticky lg:top-24 lg:col-span-5 lg:self-start">
            <SectionIntro
              eyebrow="Reach us"
              id="reach-title"
              title={
                <>
                  Call, message <Accent>or write</Accent>
                </>
              }
              lede={`${settings.receptionHours ? `Reception is open ${settings.receptionHours}. ` : ""}A call or a WhatsApp is the quickest way to reach us.`}
            />
            <ChannelList channels={channels} layout="stack" className="mt-8 sm:mt-10" />
          </div>

          <div id="message" className="min-w-0 scroll-mt-header lg:col-span-6 lg:col-start-7">
            <Reveal className={surface.panel}>
              <Heading size="subheading" id="message-title">{p.formTitle}</Heading>
              <p className={cn(typeScale.body, "mt-2 text-pub-muted")}>{p.formIntro}</p>
              <div className="mt-7">
                <ContactForm action={sendContactMessage} defaultSubject={subject} />
              </div>
            </Reveal>
          </div>
        </div>
      </Section>

      {/* Find us: the map with the address, the hours and the way there. */}
      <Section tone="deep" labelledBy="find-title">
        <Reveal>
          <EditorialSplit
            layout="media-wide"
            media={
              <div className="relative aspect-[4/3] overflow-hidden border border-pub-line bg-[#1c1712] sm:aspect-[16/10] lg:aspect-[5/4]">
                <iframe
                  src={MAP_EMBED_URL}
                  title={`Map showing ${settings.hotelName} near Mlimani City, Mwenge, Dar es Salaam`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="absolute inset-0 block size-full border-0 grayscale-[35%]"
                  allowFullScreen
                />
              </div>
            }
          >
            <Eyebrow>Find us</Eyebrow>
            <Heading id="find-title" className={rhythm.afterEyebrow}>
              {c.home.location.title}
            </Heading>
            {address.length > 0 && (
              <address className={cn(typeScale.lede, "mt-5 not-italic text-pub-muted")}>
                {address.map((l) => (
                  <span key={l} className="block">
                    {l}
                  </span>
                ))}
              </address>
            )}
            <InfoList
              variant="rows"
              className="mt-8"
              items={[
                { label: "Check-in", value: `From ${w.checkInTime}` },
                { label: "Check-out", value: `By ${w.checkoutTime}` },
                ...(settings.receptionHours ? [{ label: "Reception", value: settings.receptionHours }] : []),
                { label: "Airport", value: f("About {airportKm} km") },
              ]}
            />
            <Actions className={rhythm.beforeActions}>
              <TextLink href={MAP_LINK_URL} target="_blank" rel="noopener noreferrer">
                Get directions<span className="sr-only"> (opens Google Maps)</span>
              </TextLink>
            </Actions>
          </EditorialSplit>
        </Reveal>
      </Section>

      {/* What next. */}
      <Section tone="night" glow="top" width="narrow" labelledBy="contact-cta" containerClassName="text-center">
        <Reveal>
          <SectionIntro
            align="center"
            eyebrow="Book direct"
            id="contact-cta"
            title={
              <>
                Ready to stay <Accent>with us?</Accent>
              </>
            }
            lede="Choose your dates to see live prices for every room type."
            actions={
              <>
                <LinkButton href="/book" icon="arrow">Book your stay</LinkButton>
                <TextLink href="/rooms">Explore rooms</TextLink>
              </>
            }
          />
        </Reveal>
      </Section>
    </>
  );
}
