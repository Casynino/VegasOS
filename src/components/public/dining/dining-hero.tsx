import { getImageProps } from "next/image";
import { cn } from "@/lib/utils";
import { IllustrativeTag, MediaFrame } from "../kit/media-frame";
import { containers, measure, typeScale } from "../kit/tokens";

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
 * Photo opening for the dining pages (restaurant, bar, menu): night tone, the photograph does
 * the talking — eyebrow, H1 and one line at the bottom over a soft scrim; CTAs in `children`.
 * Clears the fixed header. `size="compact"` is a shorter band for a page whose job starts
 * right below (the menu). Stock photos carry the Illustrative tag.
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
  /** H1 id (aria-labelledby). */
  id?: string;
  children?: React.ReactNode;
}) {
  const stock = illustrative ?? [image.src, imageTall?.src].some((s) => s?.includes("/illustrative/"));
  const tagCls = "absolute right-4 top-[calc(var(--pub-header-h)+0.75rem)] z-10 sm:right-8";
  return (
    <section
      data-tone="night"
      aria-labelledby={id}
      className={cn(
        "relative isolate flex overflow-hidden bg-night text-pub-fg",
        size === "md" ? "min-h-[74svh] sm:min-h-[62svh] lg:min-h-[80vh]" : "min-h-[46svh] lg:min-h-[52vh]",
      )}
    >
      <div className="absolute inset-0 -z-10 overflow-hidden bg-[#1c1712]">
        {imageTall ? (
          <ArtDirectedPhoto wide={image} tall={imageTall} alt={alt ?? image.alt} focal={focal} focalWide={focalWide} />
        ) : (
          <MediaFrame src={image.src} alt={alt ?? image.alt} ratio="fill" sizes="100vw" preload focal={focal} focalSm={focalWide} illustrative={false} imgClassName="pub-settle" />
        )}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0",
            size === "md"
              ? "bg-[linear-gradient(to_top,rgb(12_10_7/0.94)_0%,rgb(12_10_7/0.7)_34%,rgb(12_10_7/0.28)_66%,rgb(12_10_7/0.5)_100%)]"
              : "bg-[linear-gradient(to_top,rgb(12_10_7/0.95)_0%,rgb(12_10_7/0.78)_45%,rgb(12_10_7/0.55)_100%)]",
          )}
        />
        {/* A low warm light along the bottom edge, so the photo meets the page below softly. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-[radial-gradient(60%_90%_at_20%_100%,oklch(0.72_0.12_80/0.14),transparent_70%)]" />
      </div>
      {stock && <IllustrativeTag className={tagCls} />}

      <div
        className={cn(
          containers.wide,
          "flex w-full flex-col justify-end pt-[calc(var(--pub-header-h)+3rem)]",
          size === "md" ? "pb-10 sm:pb-14 lg:pb-20" : "pb-8 sm:pb-10 lg:pb-14",
        )}
      >
        <p className={cn(typeScale.eyebrow, "flex items-center gap-3 text-gold before:h-px before:w-8 before:bg-current before:opacity-70")}>{kicker}</p>
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
