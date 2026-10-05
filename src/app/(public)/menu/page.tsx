import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { publicMenu } from "@/server/services/restaurant";
import { customerPayAccounts } from "@/server/services/payment-accounts";
import { mediaUrl } from "@/server/services/media";
import { formatNumber } from "@/lib/format";
import { MenuBrowser } from "@/components/public/menu-browser";
import { telHref, whatsappHref } from "@/components/public/contact";
import { ILLUSTRATIVE } from "@/components/public/content";
import { Actions, InfoList, LinkButton, Section, SectionIntro, TextLink } from "@/components/public/kit";
import { DiningHero } from "@/components/public/dining/dining-hero";
import { diningHoursLine } from "@/components/public/dining/facts";
import { buildMenuSections, menuPhotoCredits } from "@/components/public/dining/menu-data";
import { PhotoCredits } from "@/components/public/dining/photo-credits";

export const metadata: Metadata = {
  title: "Menu — Restaurant & Bar",
  description: "The Vegas Luxury Hotel menu: breakfast, local favourites, grills and mains, fresh juices, beers, wines, whiskies and spirits — with prices in TZS.",
  alternates: { canonical: "/menu" },
};

/**
 * The public restaurant & bar menu — every price comes from the hotel's menu in the
 * database (the same one staff take orders from), and orders are placed right here — the
 * same order engine as the menu QR, tables and rooms. A room is only charged from the
 * room's own QR (a confirmed stay), never from the website.
 * A short photo band (hours from Settings, Order now) and the menu starts; sections are the
 * category slugs (/bar links to #beers), dishes open from ?item=…, stock photos are credited.
 */
export default async function MenuPage({ searchParams }: PageProps<"/menu">) {
  const item = (await searchParams).item;
  const [cats, s] = await Promise.all([publicMenu(), getSettings()]);
  const contact = s.whatsapp ? whatsappHref(s.whatsapp, "Hello Vegas Luxury Hotel restaurant, I would like to order:") : s.phone ? telHref(s.phone) : "/contact?subject=dining";
  const contactLabel = s.whatsapp ? "WhatsApp us" : s.phone ? "Call us" : "Message us";
  const external = contact.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {};
  // Food first, then drinks; in drink sections the sizes of one drink share a card.
  const sections = buildMenuSections(cats, mediaUrl);
  // Stock photos need their credit (CC licences); the hotel's own uploads don't.
  const credits = menuPhotoCredits(cats);
  const facts = [...diningHoursLine(s, ["restaurant", "bar"]), { label: `Room service for guests, TZS ${formatNumber(s.roomServiceFee)} delivery` }];

  return (
    <>
      <DiningHero
        id="menu-title"
        size="compact"
        kicker="Restaurant & bar"
        title="The menu"
        intro={<p>From a slow Swahili breakfast to nyama choma and a nightcap at the bar — cooked fresh, served with care.</p>}
        image={{ src: ILLUSTRATIVE.restaurantWarm.src, alt: ILLUSTRATIVE.restaurantWarm.alt }}
        focal="50% 55%"
        focalWide="50% 50%"
      >
        <InfoList items={facts} className="mt-5" />
        {/* Small buttons: this band is short on purpose — the menu starts right below. */}
        <Actions className="mt-6 sm:mt-7">
          <LinkButton href={`#${sections[0]?.slug ?? ""}`} size="sm" icon="arrow">
            Order now
          </LinkButton>
          <LinkButton href={contact} variant="glass" size="sm" {...external}>
            {contactLabel}
            {contact.startsWith("http") && <span className="sr-only"> (opens in a new tab)</span>}
          </LinkButton>
        </Actions>
      </DiningHero>

      <MenuBrowser sections={sections} whatsapp={s.whatsapp ?? null} roomServiceFee={s.roomServiceFee} initialItem={typeof item === "string" ? item : null} payTo={await customerPayAccounts()} />

      <Section tone="night" glow="top" labelledBy="room-order-title">
        <SectionIntro
          align="center"
          eyebrow="Staying with us?"
          title="Order to your room"
          id="room-order-title"
          lede={`Scan the QR card in your room — the same menu — and we bring it up and add it to your room bill, settled at checkout. Delivery TZS ${formatNumber(s.roomServiceFee)} per order.`}
          actions={<TextLink href="/book">Book your stay</TextLink>}
        />
      </Section>

      <PhotoCredits credits={credits} />
    </>
  );
}
