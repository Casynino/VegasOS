import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getSettings } from "@/server/settings";
import { bookingWindow, publicStats } from "@/server/services/public-booking";
import { cn } from "@/lib/utils";
import { blurFor } from "@/components/public/blur-data";
import { contentVars } from "@/components/public/contact";
import { fill } from "@/components/public/content";
import { getSiteContent } from "@/server/services/site-content";
import { NamedIcon } from "@/components/public/icon";
import { Ornament } from "@/components/public/ornament";
import { PageHero } from "@/components/public/page-hero";
import { Reveal, Stagger, StaggerItem } from "@/components/public/reveal";
import { SectionHeading } from "@/components/public/section-heading";
import { container, cream, espresso, eyebrow, goldText, type } from "@/components/public/ui";

export async function generateMetadata(): Promise<Metadata> {
  const c = await getSiteContent();
  const img = c.pages.hotel.image;
  return {
    title: "The hotel & services",
    description: `About Vegas Luxury Hotel at Mlimani City, Dar es Salaam: ${c.services.map((s) => s.name.toLowerCase()).join(", ")}.`,
    alternates: { canonical: "/hotel" },
    openGraph: { images: [{ url: img.src, alt: img.alt }] },
  };
}

export default async function HotelPage() {
  const [settings, stats, c] = await Promise.all([getSettings(), publicStats(), getSiteContent()]);
  const p = c.pages.hotel;
  const window = bookingWindow(settings);
  const f = (s: string) => fill(s, contentVars(settings, { airportKm: c.facts.airportKm, rooms: stats.rooms, roomTypes: stats.roomTypes }));
  const facts = [
    { k: "Rooms", v: String(stats.rooms) },
    { k: "Room types", v: String(stats.roomTypes) },
    { k: "Reception", v: "24 h" },
    { k: "Check-out", v: window.checkoutTime },
  ];
  const [wide, ...squares] = p.images;
  return (
    <>
      <PageHero kicker={p.kicker} title={p.title} image={p.image.src} imageAlt={p.image.alt} intro={<p>{f(p.intro)}</p>} />

      <section className={cn(cream, "py-16 sm:py-24")} aria-labelledby="about-title">
        <div className={cn(container, "grid gap-12 lg:grid-cols-2 lg:items-center")}>
          <Reveal>
            <p className={cn(eyebrow, goldText)}>{p.aboutKicker}</p>
            <h2 id="about-title" className={cn("mt-4 text-balance", type.h2)}>{p.aboutTitle}</h2>
            <Ornament className="mt-6" />
            <div className={cn("mt-6 space-y-4 text-tone/75", type.body)}>
              {p.about.map((para) => <p key={para}>{f(para)}</p>)}
            </div>
            <dl className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {facts.map((x) => (
                <div key={x.k} className="rounded-2xl bg-panel p-4 ring-1 ring-tone/[0.06]">
                  <dt className="text-[11px] uppercase tracking-[0.18em] text-tone/55">{x.k}</dt>
                  <dd className="mt-1 font-display text-3xl">{x.v}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={0.1} className="grid grid-cols-2 gap-3 sm:gap-4">
            {wide && (
              <div className="relative col-span-2 aspect-[16/10] overflow-hidden rounded-[2rem]">
                <Image src={wide.src} alt={wide.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" {...blurFor(wide.src)} className="object-cover" />
              </div>
            )}
            {squares.slice(0, 2).map((img) => (
              <div key={img.src} className="relative aspect-square overflow-hidden rounded-3xl">
                <Image src={img.src} alt={img.alt} fill sizes="(min-width: 1024px) 22vw, 50vw" {...blurFor(img.src)} className="object-cover" />
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section className={cn(espresso, "py-16 text-white sm:py-24")} aria-labelledby="services-title">
        <div className={container}>
          <Reveal>
            <SectionHeading tone="dark" kicker="Services" title={p.servicesTitle} />
          </Reveal>
          <Stagger as="ul" className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {c.services.map((s, i) => (
              <StaggerItem as="li" key={s.key} index={i} className="flex flex-col gap-4 rounded-3xl border border-white/10 p-6 transition-colors hover:border-gold/40">
                <span className="grid size-12 place-items-center rounded-full border border-gold/30 text-gold"><NamedIcon name={s.icon} className="size-5" /></span>
                <span className="font-display text-xl">{s.name}</span>
                <span className="text-sm text-white/60">{f(s.description)}</span>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className={cn(cream, "py-16 sm:py-24")} aria-labelledby="explore-title">
        <div className={container}>
          <h2 id="explore-title" className={cn("text-center", type.h2)}>Explore more</h2>
          <ul className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { href: "/restaurant", icon: "UtensilsCrossed", title: c.home.restaurant.kicker, body: c.pages.restaurant.intro },
              { href: "/bar", icon: "Wine", title: c.home.bar.kicker, body: c.pages.bar.intro },
              { href: "/meeting-room", icon: "Presentation", title: c.home.meeting.title, body: c.pages.meeting.fallbackDescription },
            ].map((card) => (
              <li key={card.href}>
                <Link href={card.href} className={cn(espresso, "group relative flex h-full flex-col rounded-[2rem] p-8 text-white transition-shadow hover:shadow-[0_30px_60px_-30px_oklch(0.72_0.12_80/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold")}>
                  <NamedIcon name={card.icon} className="size-8 text-gold" />
                  <h3 className="mt-8 font-display text-3xl capitalize">{card.title.replace(/^the /i, "")}</h3>
                  <p className="mt-2 text-white/65">{f(card.body)}</p>
                  <span className="mt-8 inline-flex items-center gap-2 text-sm text-gold">
                    Discover <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
