import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { publicMenu } from "@/server/services/restaurant";
import { mediaUrl } from "@/server/services/media";
import { getSiteContent } from "@/server/services/site-content";
import { cn } from "@/lib/utils";
import { ILLUSTRATIVE } from "@/components/public/content";
import {
  Actions,
  EditorialSplit,
  Eyebrow,
  FeatureList,
  Heading,
  InfoList,
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
import { DrinkList } from "@/components/public/dining/drink-list";
import { diningHours } from "@/components/public/dining/facts";
import { buildMenuSections, drinkShelves } from "@/components/public/dining/menu-data";

export const metadata: Metadata = {
  title: "Bar",
  description: "The bar at Vegas Luxury Hotel, Mlimani City, Dar es Salaam — a relaxed place to unwind after a day of meetings or exploring.",
  alternates: { canonical: "/bar" },
};

/**
 * The bar as part of the stay: a photograph and one line · Restaurant / Room service / Drinks ·
 * why it is an easy end to the day (pages.bar.points, any length) with the bar's own hours · the
 * drinks shelf by shelf from the live menu, each opening its section of /menu · a closing
 * invitation. The drinks link (/menu#beers) relies on the menu category slug "beers".
 */
export default async function BarPage() {
  const [c, s, cats] = await Promise.all([getSiteContent(), getSettings(), publicMenu()]);
  const p = c.pages.bar;
  const shelves = drinkShelves(buildMenuSections(cats, mediaUrl));
  const hours = diningHours(s, ["bar"]);
  const counter = ILLUSTRATIVE.barCounter;
  // "Beers, wines, whiskies and spirits" — named from the live menu, never a fixed list.
  const names = shelves.filter((x) => x.bar).map((x, i) => (i === 0 ? x.name : x.name.toLowerCase()));
  const served = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];

  return (
    <>
      <DiningHero
        id="bar-title"
        kicker={p.kicker}
        title={p.title}
        intro={<p>{p.intro}</p>}
        image={{ src: ILLUSTRATIVE.barPour.src, alt: ILLUSTRATIVE.barPour.alt }}
        imageTall={{ src: ILLUSTRATIVE.barMartini.src, alt: ILLUSTRATIVE.barMartini.alt }}
        alt="A drink being poured at a softly lit bar (illustrative)"
        focal="50% 40%"
        focalWide="50% 45%"
      >
        <Actions className={rhythm.beforeActions}>
          <LinkButton href="/menu#beers" icon="arrow">
            Explore the drinks
          </LinkButton>
          <LinkButton href="/contact?subject=dining" variant="glass">
            Ask the team
          </LinkButton>
        </Actions>
      </DiningHero>

      <DiningNav active="drinks" />

      {/* Why the bar: a photograph, a short list, the hours the hotel set. */}
      <Section labelledBy="evening-title">
        <Reveal>
          <EditorialSplit
            layout="media-wide"
            media={
              <MediaFrame
                src={counter.src}
                alt={counter.alt}
                ratio="4/3"
                ratioLg="5/6"
                focal="50% 58%"
                focalSm="50% 55%"
                zoom
                sizes="(min-width: 1024px) 55vw, 100vw"
              />
            }
          >
            <Eyebrow>The bar</Eyebrow>
            <Heading id="evening-title" className={rhythm.afterEyebrow}>
              An easy end to the day
            </Heading>
            {p.points.length > 0 && (
              <FeatureList cols={1} className="mt-8" items={p.points.map((x) => ({ title: x.title, body: x.body }))} />
            )}
            {hours.length > 0 && (
              <div className="mt-8">
                <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>Opening hours</p>
                <InfoList variant="rows" items={hours} className="mt-3" />
              </div>
            )}
          </EditorialSplit>
        </Reveal>
      </Section>

      {/* The drinks, shelf by shelf, with real prices from the live menu. */}
      {shelves.length > 0 && (
        <Section tone="night" glow="top" labelledBy="drinks-title">
          <SectionIntro
            align="split"
            eyebrow="On the shelf"
            title="Drinks at the bar"
            id="drinks-title"
            lede={served ? `${served} — served at the bar, at your table or ordered online.` : "Served at the bar, at your table or ordered online."}
            actions={
              // The hero already has the gold drinks button: a quiet link here, not a second one.
              <TextLink href={`/menu#${shelves.find((x) => x.bar)?.slug ?? shelves[0].slug}`}>Order now</TextLink>
            }
          />
          <Reveal className={rhythm.afterIntro}>
            <DrinkList shelves={shelves} />
            <p className={cn(typeScale.small, "mt-6 text-pub-muted")}>Alcohol is served only to guests aged 18 and over — please drink responsibly.</p>
          </Reveal>
        </Section>
      )}

      {/* Closing invitation. */}
      <Section tone="deep" labelledBy="visit-title">
        <Reveal>
          <SectionIntro
            align="center"
            eyebrow="Visit us"
            title={p.closingTitle}
            id="visit-title"
            actions={
              <>
                <LinkButton href="/book" icon="arrow">
                  Book your stay
                </LinkButton>
                <TextLink href="/restaurant">See the restaurant</TextLink>
              </>
            }
          />
        </Reveal>
      </Section>
    </>
  );
}
