import type { Metadata } from "next";
import { Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { getSettings } from "@/server/settings";
import { bookingWindow } from "@/server/services/public-booking";
import { cn } from "@/lib/utils";
import { addressLines, telHref, whatsappHref } from "@/components/public/contact";
import { ContactForm } from "@/components/public/contact-form";
import { getSiteContent } from "@/server/services/site-content";
import { HotelJsonLd } from "@/components/public/hotel-jsonld";
import { PageHero } from "@/components/public/page-hero";
import { PillLink } from "@/components/public/pill-link";
import { Reveal } from "@/components/public/reveal";
import { MAP_EMBED_URL, MAP_LINK_URL } from "@/components/public/site-config";
import { container, cream, espresso, type } from "@/components/public/ui";
import { sendContactMessage } from "./actions";

export const metadata: Metadata = {
  title: "Contact & location",
  description: "Contact Vegas Luxury Hotel at Mlimani City Roundabout, behind Mwenge Tower, Dar es Salaam. Phone, WhatsApp, email, map and enquiry form.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const sp = await searchParams;
  const subject = Array.isArray(sp.subject) ? sp.subject[0] : sp.subject;
  const [settings, c] = await Promise.all([getSettings(), getSiteContent()]);
  const p = c.pages.contact;
  const window = bookingWindow(settings);
  const address = addressLines(settings);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.vegasluxuryhotel.co.tz";

  const channels = [
    settings.phone && { icon: Phone, label: "Call", value: settings.phone, href: telHref(settings.phone), external: false },
    settings.whatsapp && { icon: MessageCircle, label: "WhatsApp", value: "Chat with the front desk", href: whatsappHref(settings.whatsapp), external: true },
    settings.email && { icon: Mail, label: "Email", value: settings.email, href: `mailto:${settings.email}`, external: false },
  ].filter(Boolean) as { icon: typeof Phone; label: string; value: string; href: string; external: boolean }[];

  return (
    <>
      <HotelJsonLd settings={settings} baseUrl={baseUrl} content={c} />
      <PageHero
        kicker={p.kicker}
        title={p.title}
        image={p.image.src}
        imageAlt={p.image.alt}
        intro={<p>{p.intro}</p>}
      />

      <section className={cn(cream, "py-16 sm:py-24")}>
        <div className={cn(container, "grid gap-10 lg:grid-cols-[1fr_1.3fr] lg:gap-16")}>
          <div className="space-y-4">
            {channels.map((c) => (
              <a
                key={c.label}
                href={c.href}
                {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="group flex items-center gap-5 rounded-3xl bg-panel p-5 ring-1 ring-tone/[0.07] transition-shadow hover:shadow-[0_20px_50px_-30px_rgba(21,18,14,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:p-6"
              >
                <span className={cn("grid size-12 shrink-0 place-items-center rounded-full text-gold", espresso)}><c.icon className="size-5" aria-hidden="true" /></span>
                <span className="min-w-0">
                  <span className="block text-xs uppercase tracking-[0.18em] text-tone/55">{c.label}</span>
                  <span className="block break-words font-medium">{c.value}</span>
                </span>
                {c.external && <span className="sr-only"> (opens in a new tab)</span>}
              </a>
            ))}
            <div className={cn(espresso, "rounded-3xl p-6 text-white")}>
              <p className="flex items-center gap-2 text-sm text-gold"><MapPin className="size-4" aria-hidden="true" /> Address</p>
              <address className="mt-2 not-italic leading-relaxed text-white/85">{address.map((l) => <span key={l} className="block">{l}</span>)}</address>
              <p className="mt-4 flex items-center gap-2 text-sm text-white/65"><Clock className="size-4 text-gold" aria-hidden="true" /> Check-in from {window.checkInTime} · check-out by {window.checkoutTime}</p>
              <div className="mt-6"><PillLink href={MAP_LINK_URL} external target="_blank" rel="noopener noreferrer" variant="glass">Get directions<span className="sr-only"> (opens Google Maps)</span></PillLink></div>
            </div>
          </div>

          <Reveal className="rounded-[2rem] bg-panel p-6 ring-1 ring-tone/[0.07] sm:p-10">
            <h2 className={type.h3}>{p.formTitle}</h2>
            <p className="mt-2 text-sm text-tone/65">{p.formIntro}</p>
            <div className="mt-8"><ContactForm action={sendContactMessage} defaultSubject={subject} /></div>
          </Reveal>
        </div>
      </section>

      <section className={cn(cream, "pb-16 sm:pb-24")} aria-labelledby="map-title">
        <div className={container}>
          <h2 id="map-title" className="sr-only">Map</h2>
          <div className="overflow-hidden rounded-[2rem] ring-1 ring-tone/10">
            <iframe
              src={MAP_EMBED_URL}
              title={`Map showing ${settings.hotelName} near Mlimani City, Mwenge, Dar es Salaam`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="block h-[380px] w-full border-0 grayscale-[35%] sm:h-[460px]"
              allowFullScreen
            />
          </div>
          <div className="mt-10 flex flex-col items-center gap-4 text-center">
            <p className={cn("max-w-xl text-balance", type.h3)}>Ready to stay with us?</p>
            <PillLink href="/book" variant="dark">Book your stay</PillLink>
          </div>
        </div>
      </section>
    </>
  );
}
