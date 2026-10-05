import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { publicMenu } from "@/server/services/restaurant";
import { mediaUrl } from "@/server/services/media";
import { getSiteContent } from "@/server/services/site-content";
import { cn } from "@/lib/utils";
import { ILLUSTRATIVE } from "@/components/public/content";
import {
  Actions,
  Eyebrow,
  Heading,
  HudLabel,
  InfoList,
  Lede,
  LinkButton,
  QuietList,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  containers,
  rhythm,
  typeScale,
} from "@/components/public/kit";
import { DayTimeline } from "@/components/public/dining/day-timeline";
import { DiningHero } from "@/components/public/dining/dining-hero";
import { DiningNav } from "@/components/public/dining/dining-nav";
import { DishRail } from "@/components/public/dining/dish-rail";
import { diningHours } from "@/components/public/dining/facts";
import { HeroPanel, LocalTimeLabel } from "@/components/public/dining/hud";
import { LayeredPhotos } from "@/components/public/dining/layered-photos";
import { buildMenuSections, creditsFor, kitchenDishes } from "@/components/public/dining/menu-data";
import { PhotoBand } from "@/components/public/dining/photo-band";
import { PhotoCredits } from "@/components/public/dining/photo-credits";
import { RoomService } from "@/components/public/dining/room-service";

export const metadata: Metadata = {
  title: "Restaurant",
  description:
    "The restaurant at Vegas Luxury Hotel, Dar es Salaam: African, American, Chinese, pizza, Spanish, sushi and grill — breakfast, brunch, lunch, high tea, cocktail hour and dinner.",
  alternates: { canonical: "/restaurant" },
};

/**
 * The restaurant as part of the stay: the room in a photograph (a glass HUD card with the live
 * local time and the day's meals or the hours the hotel set; Restaurant / Room service / Drinks on
 * the foot of the photo) · real dishes and prices from the live menu (each opens its card on
 * /menu) · the cuisines drifting by, the day as a timeline beside layered photographs · room
 * service and how it works · a word with the team over an evening photograph.
 * Copy comes from the CMS (pages.restaurant); its lists render at any length. Stock photos are
 * tagged "Illustrative", and the dish photos shown here are credited at the foot of the page.
 */
export default async function RestaurantPage() {
  const [c, s, cats] = await Promise.all([getSiteContent(), getSettings(), publicMenu()]);
  const p = c.pages.restaurant;
  const sections = buildMenuSections(cats, mediaUrl);
  const dishes = kitchenDishes(cats, sections, 6);
  const food = sections.filter((x) => x.kind === "FOOD");
  const foodCount = food.reduce((t, x) => t + x.entries.length, 0);
  const firstFood = food[0] ?? sections[0];
  const orderHref = firstFood ? `/menu#${firstFood.slug}` : "/menu";
  const hours = diningHours(s);
  const credits = creditsFor(dishes.map((d) => ({ name: d.name, src: d.image.src })));
  const evening = ILLUSTRATIVE.dinnerCityNight;
  const lounge = ILLUSTRATIVE.restaurantLounge;
  // The plate that overlaps the evening photo: the last dish of the rail (the first ones are on screen there).
  const plate = dishes.at(-1);
  const drift = p.cuisines.length > 2 ? p.cuisines : food.map((x) => x.name);
  const span = p.meals.length > 1 ? `${p.meals[0]} to ${p.meals.at(-1)!.toLowerCase()}` : "The restaurant";

  return (
    <>
      <DiningHero
        id="restaurant-title"
        kicker={p.kicker}
        title={p.title}
        intro={<p>{p.intro}</p>}
        image={{ src: ILLUSTRATIVE.restaurantWarm.src, alt: ILLUSTRATIVE.restaurantWarm.alt }}
        imageTall={{ src: lounge.src, alt: lounge.alt }}
        alt="Warmly lit dining room with set tables (illustrative)"
        focal="50% 62%"
        focalWide="50% 55%"
        meta={<LocalTimeLabel city={s.city || undefined} className="text-white/75" />}
        panel={
          <HeroPanel
            title={span}
            rows={hours.length > 0 ? hours.map((h) => ({ label: h.label, value: h.value })) : p.meals.map((m) => ({ label: m }))}
          />
        }
        nav={<DiningNav active="restaurant" />}
      >
        <Actions className={rhythm.beforeActions}>
          <LinkButton href="/menu" icon="arrow">
            Explore the menu
          </LinkButton>
          <TextLink href={orderHref}>Order now</TextLink>
        </Actions>
      </DiningHero>

      {/* From the kitchen: where the menu travels, then real dishes with their prices. */}
      <Section
        labelledBy="kitchen-title"
        marker={{ index: 1, label: "From the kitchen", aside: foodCount > 0 ? <HudLabel>{foodCount} dishes on the menu</HudLabel> : undefined }}
      >
        <SectionIntro
          align="split"
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

      {/* Morning to night: the cuisines drifting by, the meals as a timeline, layered photographs, the hours, dietary options. */}
      <Section tone="night" width="bleed" labelledBy="day-title" className="overflow-hidden">
        {drift.length > 2 && <QuietList items={drift} icons={false} label="On the menu" className="mx-auto mb-12 max-w-3xl px-4 sm:mb-16 lg:mb-20" />}
        <div className={containers.default}>
          <div className="grid gap-14 lg:grid-cols-12 lg:items-center lg:gap-10">
            <Reveal className="min-w-0 lg:col-span-5">
              <Eyebrow rule>Served</Eyebrow>
              <Heading id="day-title" className={rhythm.afterEyebrow}>
                {p.mealsTitle}
              </Heading>
              <Lede className={rhythm.afterHeading}>{p.breakfastNote}</Lede>
              <DayTimeline items={p.meals} className="mt-8 border-t border-pub-line pt-3" />
              {hours.length > 0 && (
                <div className="mt-8 flex flex-col gap-3">
                  <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>Opening hours</p>
                  {hours.map((h) => (
                    <HudLabel key={h.label} as="p">
                      {h.label} · {h.value}
                    </HudLabel>
                  ))}
                </div>
              )}
              {p.dietary.length > 0 && (
                <div className="mt-8">
                  <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>Dietary options</p>
                  <InfoList items={p.dietary.map((d) => ({ label: d }))} className="mt-3" />
                </div>
              )}
            </Reveal>
            <div className="min-w-0 lg:col-span-6 lg:col-start-7">
              <LayeredPhotos
                main={{ src: evening.src, alt: evening.alt, focal: "50% 60%" }}
                inset={plate ? { src: plate.image.src, alt: plate.image.alt, illustrative: plate.stock } : undefined}
                labelEnd={plate ? undefined : "Evening service"}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* Room service: the same menu, to a guest's room (ordered from the room's own QR card). */}
      <RoomService
        id="room-service"
        titleId="room-service-title"
        title="The same menu, in your room"
        lede="Staying with us? Scan the QR card in your room — we bring your order up and add it to your room bill, settled at check-out."
        fee={s.roomServiceFee}
        marker={{ index: 2, label: "Room service" }}
        actions={
          <>
            <LinkButton href="/book" icon="arrow">
              Book your stay
            </LinkButton>
            <TextLink href="/menu">Explore the menu</TextLink>
          </>
        }
      />

      {/* A word with the team: celebrations, working lunches — on glass over an evening photograph. */}
      <PhotoBand
        image={lounge.src}
        alt={lounge.alt}
        focal="40% 36%"
        align="right"
        imageSm={{ src: ILLUSTRATIVE.restaurantWarm.src, alt: ILLUSTRATIVE.restaurantWarm.alt, focal: "62% 55%" }}
        labelledBy="plan-title"
        footnote={credits.length > 0 ? <PhotoCredits credits={credits} bare className="rounded-[0.625rem] open:bg-[rgb(12_10_7/0.82)] open:p-4" /> : undefined}
      >
        <Eyebrow>Plan with us</Eyebrow>
        <Heading id="plan-title" size="subheading" className="mt-4 text-balance">
          {p.closingTitle}
        </Heading>
        <p className={cn(typeScale.body, "mt-3 text-pub-muted")}>{p.closingBody}</p>
        <Actions className="mt-7">
          <LinkButton href="/contact?subject=dining" icon="arrow">
            Contact the team
          </LinkButton>
        </Actions>
      </PhotoBand>
    </>
  );
}
