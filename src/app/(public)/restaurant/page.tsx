import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { publicMenu } from "@/server/services/restaurant";
import { mediaUrl } from "@/server/services/media";
import { getSiteContent } from "@/server/services/site-content";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ILLUSTRATIVE } from "@/components/public/content";
import {
  Actions,
  EditorialSplit,
  Eyebrow,
  Heading,
  InfoList,
  Lede,
  LinkButton,
  MediaFrame,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  rhythm,
  typeScale,
} from "@/components/public/kit";
import { DiningHero } from "@/components/public/dining/dining-hero";
import { DiningNav } from "@/components/public/dining/dining-nav";
import { DishRail } from "@/components/public/dining/dish-rail";
import { diningHours } from "@/components/public/dining/facts";
import { buildMenuSections, creditsFor, kitchenDishes } from "@/components/public/dining/menu-data";
import { PhotoCredits } from "@/components/public/dining/photo-credits";

export const metadata: Metadata = {
  title: "Restaurant",
  description:
    "The restaurant at Vegas Luxury Hotel, Dar es Salaam: African, American, Chinese, pizza, Spanish, sushi and grill — breakfast, brunch, lunch, high tea, cocktail hour and dinner.",
  alternates: { canonical: "/restaurant" },
};

/**
 * The restaurant as part of the stay: the room in a photograph · Restaurant / Room service /
 * Drinks · real dishes and prices from the live menu (each opens its card on /menu) · the day
 * from breakfast to dinner with the hours the hotel set · room service · a word with the team.
 * Copy comes from the CMS (pages.restaurant); its lists render at any length. Stock photos are
 * tagged "Illustrative", and the dish photos shown here are credited at the foot of the page.
 */
export default async function RestaurantPage() {
  const [c, s, cats] = await Promise.all([getSiteContent(), getSettings(), publicMenu()]);
  const p = c.pages.restaurant;
  const sections = buildMenuSections(cats, mediaUrl);
  const dishes = kitchenDishes(cats, sections, 6);
  const firstFood = sections.find((x) => x.kind === "FOOD") ?? sections[0];
  const orderHref = firstFood ? `/menu#${firstFood.slug}` : "/menu";
  const hours = diningHours(s);
  const credits = creditsFor(dishes.map((d) => ({ name: d.name, src: d.image.src })));
  const evening = ILLUSTRATIVE.dinnerCityNight;

  return (
    <>
      <DiningHero
        id="restaurant-title"
        kicker={p.kicker}
        title={p.title}
        intro={<p>{p.intro}</p>}
        image={{ src: ILLUSTRATIVE.restaurantWarm.src, alt: ILLUSTRATIVE.restaurantWarm.alt }}
        imageTall={{ src: ILLUSTRATIVE.restaurantLounge.src, alt: ILLUSTRATIVE.restaurantLounge.alt }}
        alt="Warmly lit dining room with set tables (illustrative)"
        focal="50% 62%"
        focalWide="50% 55%"
      >
        <Actions className={rhythm.beforeActions}>
          <LinkButton href="/menu" icon="arrow">
            Explore the menu
          </LinkButton>
          <LinkButton href={orderHref} variant="glass">
            Order now
          </LinkButton>
        </Actions>
      </DiningHero>

      <DiningNav active="restaurant" />

      {/* From the kitchen: where the menu travels, then real dishes with their prices. */}
      <Section labelledBy="kitchen-title">
        <SectionIntro
          align="split"
          eyebrow="From the kitchen"
          title={p.cuisinesTitle}
          id="kitchen-title"
          lede={
            <>
              <p>{p.cuisinesBody}</p>
              {p.cuisines.length > 0 && <InfoList className="mt-5" items={p.cuisines.map((x) => ({ label: x }))} />}
            </>
          }
          actions={<TextLink href="/menu">See every dish and price</TextLink>}
        />
        {dishes.length > 0 && (
          <Reveal className={rhythm.afterIntro}>
            <DishRail dishes={dishes} />
          </Reveal>
        )}
      </Section>

      {/* Morning to night: the meals, breakfast with every room, the hours, dietary options. */}
      <Section tone="night" glow="bottom" labelledBy="day-title">
        <Reveal>
          <EditorialSplit
            layout="balanced"
            reverse
            media={
              <MediaFrame
                src={evening.src}
                alt={evening.alt}
                ratio="4/3"
                ratioLg="4/5"
                focal="50% 62%"
                focalSm="50% 55%"
                zoom
                sizes="(min-width: 1024px) 46vw, 100vw"
              />
            }
          >
            <Eyebrow>Served</Eyebrow>
            <Heading id="day-title" className={rhythm.afterEyebrow}>
              {p.mealsTitle}
            </Heading>
            <Lede className={rhythm.afterHeading}>{p.breakfastNote}</Lede>
            {p.meals.length > 0 && (
              <ul className="mt-8 grid grid-cols-2 gap-x-6 border-t border-pub-line sm:grid-cols-3 lg:grid-cols-2">
                {p.meals.map((m) => (
                  <li key={m} className={cn(typeScale.item, "min-w-0 border-b border-pub-line py-3 text-pub-fg")}>
                    {m}
                  </li>
                ))}
              </ul>
            )}
            {hours.length > 0 && (
              <div className="mt-8">
                <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>Opening hours</p>
                <InfoList variant="rows" items={hours} className="mt-3" />
              </div>
            )}
            {p.dietary.length > 0 && (
              <div className="mt-8">
                <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>Dietary options</p>
                <InfoList items={p.dietary.map((d) => ({ label: d }))} className="mt-3" />
              </div>
            )}
          </EditorialSplit>
        </Reveal>
      </Section>

      {/* Room service: the same menu, to a guest's room (ordered from the room's own QR card). */}
      <Section id="room-service" tone="deep" labelledBy="room-service-title">
        <Reveal>
          <SectionIntro
            align="center"
            eyebrow="Room service"
            title="The same menu, in your room"
            id="room-service-title"
            lede="Staying with us? Scan the QR card in your room — we bring your order up and add it to your room bill, settled at check-out."
            actions={
              <>
                <LinkButton href="/book" icon="arrow">
                  Book your stay
                </LinkButton>
                <TextLink href="/menu">Explore the menu</TextLink>
              </>
            }
          />
          <InfoList
            className="mt-8 justify-center"
            items={[{ label: "Same menu" }, { label: "On your room bill" }, { label: `Delivery TZS ${formatNumber(s.roomServiceFee)}` }]}
          />
        </Reveal>
      </Section>

      {/* A word with the team: celebrations, working lunches. */}
      <Section space="sm" labelledBy="plan-title">
        <div className="grid gap-6 sm:gap-8 lg:grid-cols-12 lg:items-center lg:gap-10">
          <div className="min-w-0 lg:col-span-8">
            <Heading id="plan-title" size="subheading" className="max-w-2xl text-balance">
              {p.closingTitle}
            </Heading>
            <p className={cn(typeScale.body, "mt-3 text-pub-muted")}>{p.closingBody}</p>
          </div>
          <div className="lg:col-span-4 lg:flex lg:justify-end">
            <LinkButton href="/contact?subject=dining" variant="secondary" icon="arrow">
              Contact the team
            </LinkButton>
          </div>
        </div>
      </Section>

      <PhotoCredits credits={credits} />
    </>
  );
}
