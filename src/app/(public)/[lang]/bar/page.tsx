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
  HudFrame,
  HudLabel,
  LinkButton,
  QuietList,
  MediaFrame,
  Reveal,
  Section,
  SectionIntro,
  TextLink,
  containers,
  rhythm,
  typeScale,
} from "@/components/public/kit";
import { DiningHero } from "@/components/public/dining/dining-hero";
import { DiningNav } from "@/components/public/dining/dining-nav";
import { DrinkList } from "@/components/public/dining/drink-list";
import { diningHours } from "@/components/public/dining/facts";
import { HeroPanel, LocalTimeLabel } from "@/components/public/dining/hud";
import { buildMenuSections, drinkShelves } from "@/components/public/dining/menu-data";
import { PhotoBand } from "@/components/public/dining/photo-band";
import { altZh } from "@/components/public/content.zh-CN";
import { getT, pageLocale } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/[lang]/bar">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  return {
    title: t("Bar"),
    description: t("The bar at Vegas Luxury Hotel, Mlimani City, Dar es Salaam — a relaxed place to unwind after a day of meetings or exploring."),
    alternates: { canonical: "/bar" },
  };
}

/**
 * The bar as part of the stay: a photograph and one line (a glass HUD card with the live local
 * time and the shelves from the live menu, or the bar's hours; Restaurant / Room service / Drinks
 * on the foot of the photo) · why it is an easy end to the day (pages.bar.points, any length) with
 * the bar's own hours · the shelves drifting by, then the drinks shelf by shelf, each opening its
 * section of /menu · a closing invitation on glass over an evening photograph. The drinks link
 * (/menu#beers) relies on the menu category slug "beers".
 */
export default async function BarPage({ params }: PageProps<"/[lang]/bar">) {
  await pageLocale(params);
  const t = await getT();
  // Stock photos keep their description in the visitor's language.
  const alt = (a: string) => (t.locale === "zh-CN" ? altZh(a) : a);
  const [c, s, cats] = await Promise.all([getSiteContent(), getSettings(), publicMenu()]);
  const p = c.pages.bar;
  const shelves = drinkShelves(buildMenuSections(cats, mediaUrl));
  const hours = diningHours(s, ["bar"]);
  const counter = ILLUSTRATIVE.barCounter;
  const total = shelves.reduce((sum, x) => sum + x.count, 0);
  // "Beers, wines, whiskies and spirits" — named from the live menu, never a fixed list.
  const names = shelves.filter((x) => x.bar).map((x, i) => (i === 0 ? t(x.name) : t(x.name).toLowerCase()));
  const served = names.length > 1 ? t("{list} and {last}", { list: names.slice(0, -1).join(t(", ")), last: names.at(-1) }) : names[0];
  const firstShelf = shelves.find((x) => x.bar) ?? shelves[0];

  return (
    <>
      <DiningHero
        id="bar-title"
        kicker={p.kicker}
        title={p.title}
        intro={<p>{p.intro}</p>}
        image={{ src: ILLUSTRATIVE.barPour.src, alt: alt(ILLUSTRATIVE.barPour.alt) }}
        imageTall={{ src: ILLUSTRATIVE.barMartini.src, alt: alt(ILLUSTRATIVE.barMartini.alt) }}
        alt={t("A drink being poured at a softly lit bar (illustrative)")}
        focal="50% 40%"
        focalWide="50% 45%"
        meta={<LocalTimeLabel city={s.city || undefined} className="text-white/75" />}
        panel={
          shelves.length > 0 || hours.length > 0 ? (
            <HeroPanel
              title={total > 0 ? t("{n} drinks on the menu", { n: total }) : t("The bar")}
              rows={[
                ...hours.map((h) => ({ label: t("{label} hours", { label: t(h.label) }), value: t(h.value) })),
                ...shelves.slice(0, hours.length > 0 ? 4 : 5).map((x) => ({ label: t(x.name), value: `${String(x.count).padStart(2, "0")}` })),
              ]}
            />
          ) : undefined
        }
        nav={<DiningNav active="drinks" />}
      >
        <Actions className={rhythm.beforeActions}>
          <LinkButton href="/menu#beers" icon="arrow">
            {t("Explore the drinks")}
          </LinkButton>
          <TextLink href="/contact?subject=dining">{t("Ask the team")}</TextLink>
        </Actions>
      </DiningHero>

      {/* Why the bar: a photograph, a short list, the hours the hotel set. */}
      <Section labelledBy="evening-title" marker={{ index: 1, label: t("The bar"), aside: hours[0] ? <HudLabel>{t("Open {hours}", { hours: t(hours[0].value) })}</HudLabel> : undefined }}>
        <Reveal>
          <EditorialSplit
            layout="media-wide"
            media={
              <HudFrame offset="sm">
                <MediaFrame
                  src={counter.src}
                  alt={alt(counter.alt)}
                  ratio="4/3"
                  ratioLg="5/6"
                  focal="50% 58%"
                  focalSm="50% 55%"
                  parallax={6}
                  sizes="(min-width: 1024px) 55vw, 100vw"
                />
              </HudFrame>
            }
          >
            <Heading id="evening-title">{t("An easy end to the day")}</Heading>
            {p.points.length > 0 && (
              <FeatureList cols={1} className="mt-8" items={p.points.map((x) => ({ title: x.title, body: x.body }))} />
            )}
            {hours.length > 0 && (
              <div className="mt-8 flex flex-col gap-3">
                <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>{t("Opening hours")}</p>
                {hours.map((h) => (
                  <HudLabel key={h.label} as="p">
                    {t(h.label)} · {t(h.value)}
                  </HudLabel>
                ))}
              </div>
            )}
          </EditorialSplit>
        </Reveal>
      </Section>

      {/* The drinks, shelf by shelf, with real prices from the live menu. */}
      {shelves.length > 0 && (
        <Section tone="night" width="bleed" labelledBy="drinks-title" className="overflow-hidden">
          {shelves.length > 2 && (
            <QuietList items={shelves.map((x) => t(x.name))} icons={false} label={t("On the shelves")} className="mx-auto mb-12 max-w-3xl px-4 sm:mb-16 lg:mb-20" />
          )}
          <div className={containers.default}>
            <SectionIntro
              align="split"
              eyebrow={t("On the shelf")}
              title={t("Drinks at the bar")}
              id="drinks-title"
              lede={served ? t("{served} — served at the bar, at your table or ordered online.", { served }) : t("Served at the bar, at your table or ordered online.")}
              actions={
                // The hero already has the gold drinks button: a quiet link here, not a second one.
                firstShelf && <TextLink href={`/menu#${firstShelf.slug}`}>{t("Order now")}</TextLink>
              }
            />
            <Reveal className={rhythm.afterIntro}>
              <DrinkList shelves={shelves} />
              <p className={cn(typeScale.small, "mt-6 text-pub-muted")}>{t("Alcohol is served only to guests aged 18 and over — please drink responsibly.")}</p>
            </Reveal>
          </div>
        </Section>
      )}

      {/* Closing invitation, on glass over an evening photograph. */}
      <PhotoBand
        image={ILLUSTRATIVE.barMartini.src}
        alt={alt(ILLUSTRATIVE.barMartini.alt)}
        focal="50% 50%"
        imageSm={{ src: ILLUSTRATIVE.dinnerCityNight.src, alt: alt(ILLUSTRATIVE.dinnerCityNight.alt), focal: "50% 60%" }}
        labelledBy="visit-title"
        align="right"
      >
        <Eyebrow>{t("Visit us")}</Eyebrow>
        <Heading id="visit-title" size="subheading" className="mt-4 text-balance">
          {p.closingTitle}
        </Heading>
        <Actions className="mt-7">
          <LinkButton href="/book" icon="arrow">
            {t("Book your stay")}
          </LinkButton>
          <TextLink href="/restaurant">{t("See the restaurant")}</TextLink>
        </Actions>
      </PhotoBand>
    </>
  );
}
