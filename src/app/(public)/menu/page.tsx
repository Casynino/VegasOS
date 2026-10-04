import type { Metadata } from "next";
import Image from "next/image";
import { BedDouble, Clock, Wine } from "lucide-react";
import { getSettings } from "@/server/settings";
import { publicMenu } from "@/server/services/restaurant";
import { customerPayAccounts } from "@/server/services/payment-accounts";
import { mediaUrl } from "@/server/services/media";
import { cn } from "@/lib/utils";
import { Ornament } from "@/components/public/ornament";
import { PillLink } from "@/components/public/pill-link";
import { Reveal } from "@/components/public/reveal";
import { MenuBrowser, type MenuEntry, type MenuSection } from "@/components/public/menu-browser";
import { telHref, whatsappHref } from "@/components/public/contact";
import { container, cream, espresso, eyebrow, type } from "@/components/public/ui";
import { ILLUSTRATIVE } from "@/components/public/content";
import { MENU_PHOTO_BY_FILE } from "@/lib/menu-photos";

export const metadata: Metadata = {
  title: "Menu — Restaurant & Bar",
  description: "The Vegas Luxury Hotel menu: breakfast, local favourites, grills and mains, fresh juices, beers, wines, whiskies and spirits — with prices in TZS.",
  alternates: { canonical: "/menu" },
};

const n = (v: number) => v.toLocaleString("en-US");
/** "Jameson 750ML" → ["Jameson", "750ML"]; sizes of one drink become one entry. */
const SIZE = /^(.*?)\s+(\d+(?:\.\d+)?\s*(?:ML|CL|L))$/i;
const slug = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The public restaurant & bar menu — every price comes from the hotel's menu in the
 * database (the same one staff take orders from), and orders are placed right here — the
 * same order engine as the menu QR, tables and rooms. A room is only charged from the
 * room's own QR (a confirmed stay), never from the website.
 */
export default async function MenuPage({ searchParams }: PageProps<"/menu">) {
  const item = (await searchParams).item;
  const [cats, s] = await Promise.all([publicMenu(), getSettings()]);
  const contact = s.whatsapp ? whatsappHref(s.whatsapp, "Hello Vegas Luxury Hotel restaurant, I would like to order:") : s.phone ? telHref(s.phone) : "/contact?subject=dining";
  // Food first, then drinks; in drink sections the sizes of one drink share a card.
  const sections: MenuSection[] = [...cats.filter((c) => c.type === "FOOD"), ...cats.filter((c) => c.type === "DRINK")].map((c) => {
    const entries: MenuEntry[] = [];
    for (const i of c.items) {
      const m = c.type === "DRINK" ? SIZE.exec(i.name) : null;
      const base = m ? m[1].trim() : i.name;
      const size = { id: i.id, label: m ? m[2].replace(/\s+/g, "").toUpperCase() : null, price: i.price, available: i.isAvailable };
      const same = m ? entries.find((e) => e.name === base && e.sizes[0].label) : undefined;
      if (same) { same.sizes.push(size); continue; }
      const img = i.image?.isActive ? mediaUrl(i.image) : null;
      entries.push({
        key: `${c.slug}-${slug(base)}`, name: base, description: i.description, subcategory: i.subcategory,
        image: img ? { src: img, alt: i.image?.altText || base } : null, sizes: [size],
      });
    }
    return { id: c.id, slug: c.slug, name: c.name, description: c.description, kind: c.type === "DRINK" ? "DRINK" : "FOOD", bar: c.revenueKind === "BAR", entries };
  });
  // Stock photos need their credit (CC licences); the hotel's own uploads don't.
  const credits = [...new Map(cats.flatMap((c) => c.items).flatMap((i) => {
    const p = i.image?.isActive && i.image.url ? MENU_PHOTO_BY_FILE.get(i.image.url) : undefined;
    return p ? [[p.sourcePage, { ...p, item: i.name }] as const] : [];
  })).values()];

  return (
    <>
      {/* Hero */}
      <section className={cn(espresso, "relative overflow-hidden pb-14 pt-32 text-white sm:pb-20 sm:pt-40")}>
        {/* Full-width dining photo (labelled stock until the hotel's own photos are added), faded into the espresso band. */}
        <Image src={ILLUSTRATIVE.restaurantWarm.src} alt="" fill priority sizes="100vw" className="object-cover object-center opacity-40" />
        <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-[#15120e]/60 via-[#15120e]/55 to-[#15120e]" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.72_0.12_80/0.16),transparent_60%)]" aria-hidden="true" />
        <span className="absolute right-4 top-24 rounded-full bg-black/45 px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.22em] text-white/70 backdrop-blur-md sm:top-28">Illustrative</span>
        <div className={cn(container, "relative text-center")}>
          <Reveal>
            <p className={cn(eyebrow, "text-gold")}>Restaurant & bar</p>
            <h1 className={cn("mx-auto mt-5 max-w-4xl text-balance", type.display)}>The menu</h1>
            <Ornament className="mx-auto mt-7" />
            <p className={cn("mx-auto mt-7 max-w-2xl text-white/70", type.lead)}>
              From a slow Swahili breakfast to charcoal-grilled nyama choma and a nightcap at the bar — cooked fresh, served with care.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-white/75">
              {s.restaurantHours && <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 backdrop-blur"><Clock className="size-4 text-gold" />Restaurant {s.restaurantHours}</span>}
              {s.barHours && <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 backdrop-blur"><Wine className="size-4 text-gold" />Bar {s.barHours}</span>}
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 backdrop-blur"><BedDouble className="size-4 text-gold" />Room service for guests · TZS {n(s.roomServiceFee)} delivery</span>
            </div>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <PillLink href={`#${sections[0]?.slug ?? ""}`}>Order now</PillLink>
              <PillLink href={contact} variant="glass" arrow={false} external={contact.startsWith("http")}>Call / WhatsApp the restaurant</PillLink>
            </div>
          </Reveal>
        </div>
      </section>

      <MenuBrowser sections={sections} whatsapp={s.whatsapp ?? null} roomServiceFee={s.roomServiceFee} initialItem={typeof item === "string" ? item : null} payTo={await customerPayAccounts()} />

      <section className={cn(espresso, "py-16 text-white sm:py-20")}>
        <div className={cn(container, "flex flex-col items-center gap-6 text-center")}>
          <p className={cn(eyebrow, "text-gold")}>Staying with us?</p>
          <h2 className={cn("max-w-2xl text-balance", type.h2)}>Order to your room</h2>
          <p className={cn("max-w-xl text-white/70", type.body)}>Scan the QR card in your room — the same menu — and we bring it up and add it to your room bill, settled at checkout. Delivery TZS {n(s.roomServiceFee)} per order.</p>
        </div>
      </section>

      {credits.length > 0 && (
        <section className={cn(cream, "border-t border-tone/10 py-8")}>
          <div className={container}>
            <details className="group text-xs text-tone/55">
              <summary className="cursor-pointer list-none font-medium text-tone/70 hover:text-tone [&::-webkit-details-marker]:hidden">
                Photos are illustrative — dishes and drinks are served the house way. <span className="underline underline-offset-2">Photo credits</span>
              </summary>
              <ul className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {credits.map((c) => (
                  <li key={c.sourcePage} className="leading-relaxed">
                    <span className="text-tone/70">{c.item}</span> — <a href={c.sourcePage} target="_blank" rel="noopener nofollow" className="underline-offset-2 hover:underline">{c.creator}</a>,{" "}
                    <a href={c.licenseUrl} target="_blank" rel="noopener nofollow" className="underline-offset-2 hover:underline">{c.license}</a>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </section>
      )}
    </>
  );
}
