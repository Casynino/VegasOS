import { getImageProps } from "next/image";
import { cn } from "@/lib/utils";
import { Atmosphere } from "./kit/atmosphere";
import { HOTEL_COORDS, HudLabel } from "./kit/hud";
import { MediaFrame } from "./kit/media-frame";
import { containers, measure, typeScale } from "./kit/tokens";

/** The hero's HUD: a viewfinder inset in the frame (from 640px) and a single scan of light on open. */
function HeroHud() {
  return (
    <>
      <span
        aria-hidden="true"
        className="pub-hud-corners hidden sm:block"
        style={{ inset: "calc(var(--pub-header-h) + 0.75rem) 1.25rem 1.25rem", "--hud-l": "1.25rem", "--hud-c": "rgb(240 214 160 / 0.55)" } as React.CSSProperties}
      />
      <span aria-hidden="true" className="pub-hero-scan" />
    </>
  );
}

/**
 * The hero photograph art-directed: a portrait photo on phones (< 640px), the landscape one from
 * 640px — each device downloads only its own. It is the page's LCP, so it loads eagerly with high
 * priority (no `preload`: that would fetch both). Same grade and scrim as MediaFrame's hero.
 */
function ArtDirectedPhoto({ src, mobileSrc, alt, focal = "50% 50%", focalSm }: { src: string; mobileSrc: string; alt: string; focal?: string; focalSm?: string }) {
  const common = { alt, fill: true, sizes: "100vw", loading: "eager", fetchPriority: "high" } as const;
  const { props: wide } = getImageProps({ ...common, src });
  const { props: tall } = getImageProps({ ...common, src: mobileSrc });
  return (
    <div
      className="absolute inset-0 -z-10 isolate overflow-hidden bg-[#1c1712]"
      style={{ "--focal-sm": focalSm ?? focal } as React.CSSProperties}
    >
      <picture>
        <source media="(max-width: 639px)" srcSet={tall.srcSet} sizes="100vw" />
        <source media="(min-width: 640px)" srcSet={wide.srcSet} sizes="100vw" />
        {/* eslint-disable-next-line jsx-a11y/alt-text -- alt and src come from getImageProps */}
        <img {...wide} className="pub-grade pub-settle object-cover object-[50%_45%] sm:object-[var(--focal-sm)]" />
      </picture>
      <span aria-hidden="true" className="pub-grade-tint" />
      <span aria-hidden="true" className="pub-grade-veil" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(12_10_7/0.92)_0%,rgb(12_10_7/0.72)_38%,rgb(12_10_7/0.4)_70%,rgb(12_10_7/0.55)_100%)]"
      />
    </div>
  );
}

/**
 * Photo hero for inner pages: the photograph does the talking — eyebrow, H1 and at most one
 * short line at the bottom over a soft scrim; CTAs go in `children`. Clears the fixed header.
 * Phones: ~62% of the screen, never a wall. The image is the page's LCP (`preload`).
 * HUD: a fine blueprint grid rises under the title, a viewfinder sits in the frame, one scan of
 * light runs down the photo on open, and the hotel's coordinates sit opposite the title (desktop).
 * `meta` replaces the coordinates (false hides them). `mobileImage`: a portrait photo for phones.
 */
export function PageHero({
  kicker,
  title,
  intro,
  image,
  imageAlt,
  mobileImage,
  children,
  className,
  focal,
  focalSm,
  illustrative,
  size = "md",
  meta,
  scrim = "default",
  id,
}: {
  kicker: string;
  title: string;
  intro?: React.ReactNode;
  image: string;
  imageAlt: string;
  /** Portrait photo for phones (< 640px), e.g. from `portraitFor(image)`. The hotel's own photos only. */
  mobileImage?: string;
  children?: React.ReactNode;
  className?: string;
  /** object-position on phones (e.g. "50% 35%"); focalSm from 640px. */
  focal?: string;
  focalSm?: string;
  /** Force the Illustrative tag (automatic for /images/illustrative/ photos). */
  illustrative?: boolean;
  /** md: inner pages; lg: a taller, more cinematic opening. */
  size?: "md" | "lg";
  /** HUD text opposite the title on desktop (default: the hotel's coordinates; false = none). */
  meta?: React.ReactNode | false;
  /** "strong" for a busy, colourful photo (an aerial city): a deeper shade behind the left-aligned words. */
  scrim?: "default" | "strong";
  /** H1 id (aria-labelledby). */
  id?: string;
}) {
  return (
    <section
      data-tone="night"
      aria-labelledby={id}
      className={cn(
        "relative isolate flex overflow-hidden bg-night text-pub-fg",
        size === "lg" ? "min-h-[78svh] lg:min-h-[86vh]" : "min-h-[62svh] sm:min-h-[52svh] lg:min-h-[60vh]",
        className,
      )}
    >
      {mobileImage ? (
        <ArtDirectedPhoto src={image} mobileSrc={mobileImage} alt={imageAlt} focal={focal} focalSm={focalSm} />
      ) : (
        <MediaFrame
          src={image}
          alt={imageAlt}
          ratio="fill"
          sizes="100vw"
          preload
          focal={focal}
          focalSm={focalSm}
          illustrative={illustrative}
          overlay="hero"
          imgClassName="pub-settle"
          tagClassName="left-auto right-4 top-[calc(var(--pub-header-h)+0.75rem)] sm:right-10 sm:top-[calc(var(--pub-header-h)+1.75rem)]"
          className="-z-10"
        />
      )}
      {/* The words sit bottom-left: shade that side (desktop), and deepen the whole foot for busy photos. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 -z-10",
          scrim === "strong"
            ? "bg-[linear-gradient(to_top,rgb(12_10_7/0.55),rgb(12_10_7/0.3)_55%,transparent_80%)] lg:bg-[linear-gradient(90deg,rgb(12_10_7/0.8),rgb(12_10_7/0.45)_40%,transparent_68%)]"
            : "hidden lg:block lg:bg-[linear-gradient(90deg,rgb(12_10_7/0.5),rgb(12_10_7/0.2)_38%,transparent_60%)]",
        )}
      />
      <Atmosphere tone="night" atmosphere="calm" pattern="grid" edges="top" className="pub-atmo--hero" />
      <HeroHud />
      <div className={cn(containers.wide, "relative flex w-full flex-col justify-end pb-10 pt-[calc(var(--pub-header-h)+3rem)] sm:pb-14 lg:pb-20")}>
        {meta !== false && (
          <div className="absolute bottom-14 right-8 hidden flex-col items-end gap-3 lg:bottom-20 lg:flex">
            <HudLabel tick={false} className="text-white/70">{meta ?? HOTEL_COORDS.label}</HudLabel>
            <span aria-hidden="true" className="h-px w-24 bg-linear-to-l from-gold/70 to-transparent" />
          </div>
        )}
        <p className={cn(typeScale.eyebrow, "flex items-center gap-3 text-gold motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700")}>
          <span aria-hidden="true" className="h-px w-8 bg-gold/70" />
          {kicker}
        </p>
        <h1
          id={id}
          className={cn(
            "mt-4 max-w-4xl",
            typeScale.title,
            "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-pub",
          )}
        >
          {title}
        </h1>
        {intro && <div className={cn("mt-4 text-white/80 sm:mt-5", typeScale.lede, measure.lede)}>{intro}</div>}
        {children}
      </div>
    </section>
  );
}

/**
 * Typographic hero for venues without photography: a night band with a soft gold light and a
 * fine gold line illustration (desktop). Clears the fixed header.
 */
export function VenueHero({
  kicker,
  title,
  intro,
  illustration,
  children,
}: {
  kicker: string;
  title: string;
  intro?: React.ReactNode;
  illustration: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section data-tone="night" className="relative isolate overflow-hidden bg-night text-pub-fg">
      <Atmosphere tone="night" stars />
      <div
        className={cn(
          containers.wide,
          "grid items-end gap-10 pb-12 pt-[calc(var(--pub-header-h)+3rem)] sm:pb-16 sm:pt-[calc(var(--pub-header-h)+4rem)] lg:grid-cols-[1.4fr_1fr] lg:items-center lg:pb-20",
        )}
      >
        <div className="min-w-0">
          <p className={cn(typeScale.eyebrow, "text-gold")}>{kicker}</p>
          <h1
            className={cn(
              "mt-4 max-w-4xl",
              typeScale.title,
              "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-pub",
            )}
          >
            {title}
          </h1>
          {intro && <div className={cn("mt-4 text-white/75 sm:mt-5", typeScale.lede, measure.lede)}>{intro}</div>}
          {children}
        </div>
        <div className="hidden justify-center text-gold/80 lg:flex motion-safe:animate-in motion-safe:fade-in motion-safe:duration-1000">
          {illustration}
        </div>
      </div>
    </section>
  );
}
