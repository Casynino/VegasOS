import { getImageProps } from "next/image";
import { cn } from "@/lib/utils";
import { Atmosphere } from "../kit/atmosphere";
import { IllustrativeTag, MediaFrame } from "../kit/media-frame";
import { containers, measure, typeScale } from "../kit/tokens";
import fx from "./dining.module.css";

type Photo = { src: string; alt: string };

/**
 * One photograph, art-directed: a portrait frame on phones and tablets, a landscape frame from
 * 1024px — a single <picture>, so only the photo that fits the screen is downloaded. It is the
 * page's LCP image (eager, high priority; no <link> preload, which would fetch both).
 */
function ArtDirectedPhoto({ wide, tall, alt, focal, focalWide }: { wide: Photo; tall: Photo; alt: string; focal: string; focalWide: string }) {
  const common = { alt, fill: true, sizes: "100vw" } as const;
  const { props: { srcSet: wideSet } } = getImageProps({ ...common, src: wide.src });
  const { props: { srcSet: tallSet, style, ...img } } = getImageProps({ ...common, src: tall.src, loading: "eager", fetchPriority: "high" });
  return (
    <picture>
      <source media="(min-width: 1024px)" srcSet={wideSet} sizes="100vw" />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- next/image props via getImageProps (alt included) */}
      <img
        {...img}
        srcSet={tallSet}
        style={{ ...style, "--focal": focal, "--focal-wide": focalWide } as React.CSSProperties}
        className="pub-settle object-cover object-[var(--focal)] lg:object-[var(--focal-wide)]"
      />
    </picture>
  );
}

/**
 * Photo opening for the dining pages (restaurant, bar, menu): night tone, the photograph does the
 * talking — a live HUD line, eyebrow, H1 and one line at the bottom over a soft scrim; CTAs in
 * `children`. Over the photo: the blueprint grid rising under the title, a viewfinder in the frame
 * and one scan of light on open (as PageHero). `panel` floats a glass HUD card on the right from
 * 1024px; `nav` sits on the foot of the photo as a glass strip (Restaurant · Room service · Drinks).
 * Clears the fixed header. `size="compact"` is a shorter band for a page whose job starts right
 * below (the menu). Stock photos carry the Illustrative tag.
 */
export function DiningHero({
  kicker,
  title,
  intro,
  image,
  imageTall,
  alt,
  focal = "50% 50%",
  focalWide = "50% 50%",
  illustrative,
  size = "md",
  meta,
  panel,
  nav,
  id,
  children,
}: {
  kicker: string;
  title: string;
  intro?: React.ReactNode;
  /** Landscape photo (desktop; and phones too when there is no `imageTall`). */
  image: Photo;
  /** Portrait photo for phones and tablets (art direction). */
  imageTall?: Photo;
  /** One alt for the art-directed pair (defaults to the landscape photo's). */
  alt?: string;
  focal?: string;
  focalWide?: string;
  illustrative?: boolean;
  size?: "md" | "compact";
  /** A HUD line above the eyebrow (e.g. the live local time). */
  meta?: React.ReactNode;
  /** Glass HUD card on the right (desktop only). */
  panel?: React.ReactNode;
  /** A strip of links on the foot of the photo. */
  nav?: React.ReactNode;
  /** H1 id (aria-labelledby). */
  id?: string;
  children?: React.ReactNode;
}) {
  const stock = illustrative ?? [image.src, imageTall?.src].some((s) => s?.includes("/illustrative/"));
  return (
    <section
      data-tone="night"
      aria-labelledby={id}
      className={cn(
        "relative isolate flex flex-col overflow-hidden bg-night text-pub-fg",
        size === "md" ? "min-h-[82svh] sm:min-h-[68svh] lg:min-h-[88vh]" : "min-h-[52svh] lg:min-h-[60vh]",
      )}
    >
      <div className="absolute inset-0 -z-10 overflow-hidden bg-[#1c1712]">
        {/* The photo breathes very slowly while it is on screen (CSS, transform only; still with reduced motion). */}
        <div data-live-watch="" suppressHydrationWarning className={cn("absolute inset-0", fx.drift)}>
        {imageTall ? (
          <ArtDirectedPhoto wide={image} tall={imageTall} alt={alt ?? image.alt} focal={focal} focalWide={focalWide} />
        ) : (
          <MediaFrame src={image.src} alt={alt ?? image.alt} ratio="fill" sizes="100vw" preload focal={focal} focalSm={focalWide} illustrative={false} imgClassName="pub-settle" />
        )}
        </div>
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0",
            size === "md"
              ? "bg-[linear-gradient(to_top,rgb(12_10_7/0.95)_0%,rgb(12_10_7/0.74)_32%,rgb(12_10_7/0.3)_64%,rgb(12_10_7/0.55)_100%)]"
              : "bg-[linear-gradient(to_top,rgb(12_10_7/0.96)_0%,rgb(12_10_7/0.8)_45%,rgb(12_10_7/0.55)_100%)]",
          )}
        />
        {/* Desktop: the left side darkens a little more, so the title reads and the glass card floats on light. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(to_right,rgb(12_10_7/0.55),rgb(12_10_7/0)_55%)] lg:block" />
      </div>
      <Atmosphere tone="night" atmosphere="calm" pattern="grid" edges="top" className="pub-atmo--hero" />

      <div className="relative flex flex-1 flex-col">
        {/* Viewfinder inset in the frame (≥640px) and one scan of light down the photo on open. */}
        <span
          aria-hidden="true"
          className="pub-hud-corners hidden sm:block"
          style={{ inset: "calc(var(--pub-header-h) + 0.75rem) 1.25rem 1.25rem", "--hud-l": "1.25rem", "--hud-c": "rgb(240 214 160 / 0.55)" } as React.CSSProperties}
        />
        <span aria-hidden="true" className="pub-hero-scan" />
        {stock && <IllustrativeTag className="absolute right-4 top-[calc(var(--pub-header-h)+0.75rem)] z-10 sm:right-10 sm:top-[calc(var(--pub-header-h)+1.75rem)]" />}

        <div
          className={cn(
            containers.wide,
            "relative grid flex-1 items-end gap-10 pt-[calc(var(--pub-header-h)+3.5rem)] lg:grid-cols-12",
            size === "md" ? "pb-10 sm:pb-14 lg:pb-16" : "pb-8 sm:pb-10 lg:pb-12",
          )}
        >
          <div className="min-w-0 lg:col-span-7">
            {/* The HUD line; on desktop the glass card carries it instead. */}
            {meta && <div className={cn("mb-5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-1000", panel && "lg:hidden")}>{meta}</div>}
            <p className={cn(typeScale.eyebrow, "flex items-center gap-3 text-gold")}>
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
          {panel && (
            <div className="hidden justify-end lg:col-span-4 lg:col-start-9 lg:flex motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:delay-300 motion-safe:duration-1000 motion-safe:ease-pub">
              {panel}
            </div>
          )}
        </div>
      </div>
      {nav}
    </section>
  );
}
