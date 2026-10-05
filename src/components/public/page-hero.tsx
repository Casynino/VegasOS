import { cn } from "@/lib/utils";
import { MediaFrame } from "./kit/media-frame";
import { containers, measure, typeScale } from "./kit/tokens";

/**
 * Photo hero for inner pages: the photograph does the talking — eyebrow, H1 and at most one
 * short line at the bottom over a soft scrim; CTAs go in `children`. Clears the fixed header.
 * Phones: ~62% of the screen, never a wall. The image is the page's LCP (`preload`).
 */
export function PageHero({
  kicker,
  title,
  intro,
  image,
  imageAlt,
  children,
  className,
  focal,
  focalSm,
  illustrative,
  size = "md",
  id,
}: {
  kicker: string;
  title: string;
  intro?: React.ReactNode;
  image: string;
  imageAlt: string;
  children?: React.ReactNode;
  className?: string;
  /** object-position on phones (e.g. "50% 35%"); focalSm from 640px. */
  focal?: string;
  focalSm?: string;
  /** Force the Illustrative tag (automatic for /images/illustrative/ photos). */
  illustrative?: boolean;
  /** md: inner pages; lg: a taller, more cinematic opening. */
  size?: "md" | "lg";
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
        tagClassName="left-auto right-4 top-[calc(var(--pub-header-h)+0.75rem)] sm:right-8"
        className="-z-10"
      />
      <div className={cn(containers.wide, "flex w-full flex-col justify-end pb-10 pt-[calc(var(--pub-header-h)+3rem)] sm:pb-14 lg:pb-20")}>
        <p className={cn(typeScale.eyebrow, "text-gold motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700")}>{kicker}</p>
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
    <section data-tone="night" className="pub-sky relative isolate overflow-hidden bg-night text-pub-fg">
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
