import type { Metadata } from "next";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { InstagramIcon, TikTokIcon, socialHandle } from "@/components/public/social-icons";
import { getSettings } from "@/server/settings";
import { bookingWindow } from "@/server/services/public-booking";
import { cn } from "@/lib/utils";
import { addressLines, contentVars, telHref, whatsappHref } from "@/components/public/contact";
import { fill } from "@/components/public/content";
import { ContactForm } from "@/components/public/contact-form";
import { getSiteContent } from "@/server/services/site-content";
import { HotelJsonLd } from "@/components/public/hotel-jsonld";
import { LocalTime } from "@/components/public/cinema/local-time";
import {
  Accent,
  Actions,
  EditorialSplit,
  Eyebrow,
  GlassPanel,
  HOTEL_COORDS,
  Heading,
  HudLabel,
  InfoList,
  LinkButton,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  rhythm,
  typeScale,
} from "@/components/public/kit";
import { ClosingBand } from "@/components/public/closing-band";
import { PageHero } from "@/components/public/page-hero";
import { ChannelCards } from "@/components/public/services/channel-cards";
import type { Channel } from "@/components/public/services/channel-list";
import { MapConsole } from "@/components/public/services/map-console";
import { MAP_LINK_URL } from "@/components/public/site-config";
import { sendContactMessage } from "./actions";
import { getT, pageLocale } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/[lang]/contact">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  return {
    title: t("Contact & location"),
    description: t("Contact Vegas Luxury Hotel at Mlimani City Roundabout, behind Mwenge Tower, Dar es Salaam. Phone, WhatsApp, email, map and enquiry form."),
    alternates: { canonical: "/contact" },
  };
}

/** The map is centred on the hotel's own listing, so the console's reticle sits on the hotel's pin. */
const mapEmbed = (hotelName: string) => `https://www.google.com/maps?q=${encodeURIComponent(`${hotelName}, Mwenge, Dar es Salaam`)}&output=embed`;

/**
 * Contact, calmly: the lobby photograph with the direct lines (call, WhatsApp, email — only what is set
 * in Settings) floating over it as glass cards · 01 Write to us — the enquiry form in a glass console
 * (#message; ?subject= preselects the topic) beside the reception hours and the hotel's local time ·
 * 02 Find us — the map as a HUD console at the hotel's real coordinates, with the address, the hours
 * and directions · a quiet closing call to book. HotelJsonLd stays on this page.
 */
export default async function ContactPage({ params, searchParams }: PageProps<"/[lang]/contact">) {
  await pageLocale(params);
  const sp = await searchParams;
  const subject = Array.isArray(sp.subject) ? sp.subject[0] : sp.subject;
  const [settings, c, t] = await Promise.all([getSettings(), getSiteContent(), getT()]);
  const p = c.pages.contact;
  const w = bookingWindow(settings);
  const address = addressLines(settings);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.vegashoteltz.com";
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm }));
  // The city as set in Settings — a place name, shown in the visitor's language when there is a translation.
  const city = t(settings.city || "Dar es Salaam");
  // The hotel's local time (Africa/Dar_es_Salaam, 24 h), as LocalTime shows it.
  const now = t.time(new Date(), "Africa/Dar_es_Salaam");

  const channels: Channel[] = [
    settings.phone && { key: "call", icon: Phone, label: t("Call"), value: settings.phone, href: telHref(settings.phone) },
    settings.whatsapp && { key: "whatsapp", icon: MessageCircle, label: "WhatsApp", value: t("Chat with the front desk"), href: whatsappHref(settings.whatsapp), external: true },
    settings.email && { key: "email", icon: Mail, label: t("Email"), value: settings.email, href: `mailto:${settings.email}` },
    settings.instagramUrl && { key: "instagram", icon: InstagramIcon, label: "Instagram", value: socialHandle(settings.instagramUrl), href: settings.instagramUrl, external: true },
    settings.tiktokUrl && { key: "tiktok", icon: TikTokIcon, label: "TikTok", value: socialHandle(settings.tiktokUrl), href: settings.tiktokUrl, external: true },
  ].filter(Boolean) as Channel[];

  return (
    <>
      <HotelJsonLd settings={settings} baseUrl={baseUrl} content={c} />
      <PageHero
        kicker={p.kicker}
        title={p.title}
        image={p.image.src}
        imageAlt={p.image.alt}
        focal="50% 45%"
        id="contact-title"
        intro={<p>{p.intro}</p>}
        meta={t.rich("{city} · <clock></clock> local time", { clock: () => <LocalTime initial={now} /> }, { city })}
      >
        {channels.length > 0 ? (
          <>
            <ChannelCards channels={channels} className="mt-7 sm:mt-8 lg:max-w-[54rem]" />
            <Actions className="mt-5 sm:mt-6">
              <TextLink href="#message" className="text-white">{t("Write to us")}</TextLink>
            </Actions>
          </>
        ) : (
          <Actions className="mt-7 sm:mt-8">
            <LinkButton href="#message" icon="arrow">{t("Write to us")}</LinkButton>
          </Actions>
        )}
      </PageHero>

      {/* 01 · Write to us: the form in a glass console, beside the hours and the hotel's local time. */}
      <Section
        labelledBy="message-title"
        marker={{ index: 1, label: t("Write to us"), aside: <HudLabel tick={false}>{t("We reply by phone, WhatsApp or email")}</HudLabel> }}
      >
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-10">
          <div className="min-w-0 lg:sticky lg:top-24 lg:col-span-5 lg:self-start">
            <SectionIntro
              eyebrow={t("Send a message")}
              id="message-title"
              title={t.rich("Call, message <accent>or write</accent>", { accent: (x) => <Accent>{x}</Accent> })}
              lede={p.formIntro}
            />
            <dl className={cn("mt-9 grid border-y border-pub-line sm:mt-10", settings.receptionHours && "grid-cols-2")}>
              <div className="min-w-0 py-4 pr-4">
                <dt>
                  <HudLabel live>{t("Local time")}</HudLabel>
                </dt>
                <dd className="mt-2.5 font-display text-[2rem] leading-none text-pub-fg tabular-nums">
                  <LocalTime initial={now} />
                </dd>
              </div>
              {settings.receptionHours && (
                <div className="min-w-0 border-l border-pub-line py-4 pl-4">
                  <dt>
                    <HudLabel>{t("Reception")}</HudLabel>
                  </dt>
                  <dd className="mt-2.5 font-display text-[2rem] leading-none text-pub-fg">{t(settings.receptionHours)}</dd>
                </div>
              )}
            </dl>
            <p className={cn(typeScale.small, "mt-5 text-pub-muted")}>
              {settings.receptionHours
                ? t("Reception is open {hours}. A call or a WhatsApp is the quickest way to reach us.", { hours: t(settings.receptionHours) })
                : t("A call or a WhatsApp is the quickest way to reach us.")}
            </p>
          </div>

          <div id="message" className="min-w-0 scroll-mt-header lg:col-span-7 lg:col-start-6">
            <Reveal>
              <GlassPanel variant="paper" padding="lg" rounded="lg" hud>
                <div className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-pub-line pb-5">
                  <Heading as="h3" size="subheading">{p.formTitle}</Heading>
                  <HudLabel tick={false}>{HOTEL_COORDS.label}</HudLabel>
                </div>
                <ContactForm action={sendContactMessage} defaultSubject={subject} />
              </GlassPanel>
            </Reveal>
          </div>
        </div>
      </Section>

      {/* 02 · Find us: the map as a HUD console, with the address, the hours and the way there. */}
      <Section
        pattern="grid"
        labelledBy="find-title"
        marker={{ index: 2, label: t("Find us"), aside: <HudLabel tick={false}>{HOTEL_COORDS.label}</HudLabel> }}
      >
        <Reveal>
          <EditorialSplit
            layout="media-wide"
            media={
              <MapConsole
                src={mapEmbed(settings.hotelName)}
                title={t("Map showing {hotel} near Mlimani City, Mwenge, Dar es Salaam", { hotel: settings.hotelName })}
                name={settings.hotelName}
                coords={HOTEL_COORDS.label}
                place="Mlimani City · Mwenge"
              />
            }
          >
            <Eyebrow>{t("Find us")}</Eyebrow>
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
                { label: t("Check-in"), value: t("From {time}", { time: w.checkInTime }) },
                { label: t("Check-out"), value: t("By {time}", { time: w.checkoutTime }) },
                ...(settings.receptionHours ? [{ label: t("Reception"), value: t(settings.receptionHours) }] : []),
                { label: t("Airport"), value: f(t("About {airportKm} km")) },
              ]}
            />
            <Actions className={rhythm.beforeActions}>
              <LinkButton href={MAP_LINK_URL} target="_blank" rel="noopener noreferrer" variant="secondary" icon="arrow">
                {t("Get directions")}<span className="sr-only"> {t("(opens Google Maps)")}</span>
              </LinkButton>
            </Actions>
          </EditorialSplit>
        </Reveal>
      </Section>

      {/* What next: the closing moment over reception and its world clocks. */}
      <ClosingBand image="/images/lobby/lobby-03.webp" focal="50% 35%" labelledBy="contact-cta">
        <SectionIntro
            align="center"
            eyebrow={t("Book direct")}
            id="contact-cta"
            title={t.rich("Ready to stay <accent>with us?</accent>", { accent: (x) => <Accent>{x}</Accent> })}
            lede={t("Choose your dates to see live prices for every room type.")}
            actions={
              <>
                <LinkButton href="/book" icon="arrow">{t("Book your stay")}</LinkButton>
                <TextLink href="/rooms">{t("Explore rooms")}</TextLink>
              </>
            }
          />
      </ClosingBand>
    </>
  );
}
