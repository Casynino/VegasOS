import type { Metadata } from "next";
import { shareCard } from "@/lib/share-card";
import { getSettings } from "@/server/settings";
import { publicMenu } from "@/server/services/restaurant";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { mediaUrl } from "@/server/services/media";
import { formatNumber } from "@/lib/format";
import { MenuBrowser } from "@/components/public/menu-browser";
import { telHref, whatsappHref } from "@/components/public/contact";
import { ILLUSTRATIVE } from "@/components/public/content";
import { Actions, InfoList, LinkButton, TextLink } from "@/components/public/kit";
import { DiningHero } from "@/components/public/dining/dining-hero";
import { diningHours } from "@/components/public/dining/facts";
import { HeroPanel, LocalTimeLabel } from "@/components/public/dining/hud";
import { buildMenuSections, menuPhotoCredits } from "@/components/public/dining/menu-data";
import { PhotoCredits } from "@/components/public/dining/photo-credits";
import { RoomService } from "@/components/public/dining/room-service";
import { altZh } from "@/components/public/content.zh-CN";
import { getT, pageLocale } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/[lang]/menu">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  return {
    title: t("Menu — Restaurant & Bar"),
    description: t("The Vegas Luxury Hotel menu: breakfast, local favourites, grills and mains, fresh juices, beers, wines, whiskies and spirits — with prices in TZS."),
    alternates: { canonical: "/menu" },
    ...shareCard("menu", t("Our menu — Vegas Luxury Hotel"), t("Eat here or take out — order from our restaurant & bar online and pay by mobile money.")),
  };
}

/**
 * The public restaurant & bar menu — every price comes from the hotel's menu in the
 * database (the same one staff take orders from), and orders are placed right here — the
 * same order engine as the menu QR, tables and rooms. A room is only charged from the
 * room's own QR (a confirmed stay), never from the website.
 * A short photo band (hours from Settings, Order now; a glass HUD card with the live local time
 * and the menu's real counts on desktop) and the menu starts; sections are the category slugs
 * (/bar links to #beers), dishes open from ?item=…, stock photos are credited.
 */
export default async function MenuPage({ params, searchParams }: PageProps<"/[lang]/menu">) {
  await pageLocale(params);
  const t = await getT();
  const item = (await searchParams).item;
  const [cats, s] = await Promise.all([publicMenu(), getSettings()]);
  const contact = s.whatsapp ? whatsappHref(s.whatsapp, "Hello Vegas Luxury Hotel restaurant, I would like to order:") : s.phone ? telHref(s.phone) : "/contact?subject=dining";
  const contactLabel = s.whatsapp ? t("WhatsApp us") : s.phone ? t("Call us") : t("Message us");
  const external = contact.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {};
  // Food first, then drinks; in drink sections the sizes of one drink share a card.
  const sections = buildMenuSections(cats, mediaUrl);
  // Stock photos need their credit (CC licences); the hotel's own uploads don't.
  const credits = menuPhotoCredits(cats);
  // "Restaurant 07:00 – 23:00" — the hours exactly as the hotel set them.
  const facts = [
    ...diningHours(s, ["restaurant", "bar"]).map((h) => ({ label: `${t(h.label)} ${t(h.value)}` })),
    { label: t("Room service for guests, TZS {fee} delivery", { fee: formatNumber(s.roomServiceFee) }) },
  ];
  const count = (kind: "FOOD" | "DRINK") => sections.filter((x) => x.kind === kind).reduce((sum, x) => sum + x.entries.length, 0);
  const dishes = count("FOOD");
  const drinks = count("DRINK");

  return (
    <>
      <DiningHero
        id="menu-title"
        size="compact"
        kicker={t("Restaurant & bar")}
        title={t("The menu")}
        intro={<p>{t("From a slow Swahili breakfast to nyama choma and a nightcap at the bar — cooked fresh, served with care.")}</p>}
        image={{ src: ILLUSTRATIVE.restaurantWarm.src, alt: t.locale === "zh-CN" ? altZh(ILLUSTRATIVE.restaurantWarm.alt) : ILLUSTRATIVE.restaurantWarm.alt }}
        focal="50% 55%"
        focalWide="50% 50%"
        meta={<LocalTimeLabel city={s.city || undefined} className="text-white/75" />}
        panel={
          <HeroPanel
            title={t("Order right here")}
            rows={[
              ...(dishes > 0 ? [{ label: t("From the kitchen"), value: t("{n} dishes", { n: dishes }) }] : []),
              ...(drinks > 0 ? [{ label: t("From the bar"), value: t("{n} drinks", { n: drinks }) }] : []),
              { label: t("Room service"), value: `TZS ${formatNumber(s.roomServiceFee)}` },
            ]}
          />
        }
      >
        <InfoList items={facts} className="mt-5" />
        {/* Small buttons: this band is short on purpose — the menu starts right below. */}
        <Actions className="mt-6 sm:mt-7">
          <LinkButton href={`#${sections[0]?.slug ?? ""}`} size="sm" icon="arrow">
            {t("Order now")}
          </LinkButton>
          <TextLink href={contact} {...external}>
            {contactLabel}
            {contact.startsWith("http") && <span className="sr-only"> {t("(opens in a new tab)")}</span>}
          </TextLink>
        </Actions>
      </DiningHero>

      <MenuBrowser sections={sections} whatsapp={s.whatsapp ?? null} roomServiceFee={s.roomServiceFee} initialItem={typeof item === "string" ? item : null} online={await onlinePayAvailable("restaurant", s)} />

      <RoomService
        titleId="room-order-title"
        eyebrow={t("Staying with us?")}
        title={t("Order to your room")}
        lede={t("Scan the QR card in your room — the same menu — and we bring it up and add it to your room bill, settled at checkout. Delivery TZS {fee} per order.", { fee: formatNumber(s.roomServiceFee) })}
        fee={s.roomServiceFee}
        actions={<TextLink href="/book">{t("Book your stay")}</TextLink>}
        footnote={credits.length > 0 ? <PhotoCredits credits={credits} bare /> : undefined}
      />
    </>
  );
}
