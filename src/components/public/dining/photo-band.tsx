import { cn } from "@/lib/utils";
import { Atmosphere } from "../kit/atmosphere";
import { GlassPanel } from "../kit/hud";
import { IllustrativeTag, MediaFrame } from "../kit/media-frame";
import { containers } from "../kit/tokens";
import { Reveal } from "../reveal";

/**
 * A cinematic closing band: a full-bleed photograph drifting with the scroll, the blueprint grid
 * rising from the foot, and the words on a smoked-glass card floating over it (never bare text on
 * the photo). Night tone, so the band above dissolves into it with a gold horizon.
 */
export function PhotoBand({
  image,
  alt,
  focal = "50% 50%",
  imageSm,
  labelledBy,
  align = "left",
  footnote,
  children,
}: {
  /** The photograph (all widths, or from 1024px when `imageSm` is set). */
  image: string;
  alt: string;
  focal?: string;
  /** A different photograph below 1024px (e.g. one the page's hero shows only on desktop), so no screen repeats a photo. */
  imageSm?: { src: string; alt: string; focal?: string };
  labelledBy: string;
  align?: "left" | "right";
  /** A quiet line at the band's foot (e.g. the photo credits), on the scrim. */
  footnote?: React.ReactNode;
  children: React.ReactNode;
}) {
  const stock = [image, imageSm?.src].some((s) => s?.includes("/illustrative/"));
  return (
    <section
      data-tone="night"
      aria-labelledby={labelledBy}
      className={cn(
        "relative isolate flex min-h-[86svh] items-end overflow-hidden bg-night py-12 text-pub-fg sm:min-h-[72vh] sm:py-16 lg:min-h-[86vh] lg:items-center lg:py-24",
        footnote && "pb-20 sm:pb-24",
      )}
    >
      {/* Lazy images that are display:none are never fetched: each screen loads only its own photo. */}
      {imageSm && (
        <MediaFrame src={imageSm.src} alt={imageSm.alt} ratio="fill" focal={imageSm.focal} parallax={7} sizes="100vw" illustrative={false} className="-z-10 lg:hidden" />
      )}
      <MediaFrame src={image} alt={alt} ratio="fill" focal={focal} parallax={7} sizes="100vw" illustrative={false} className={cn("-z-10", imageSm && "hidden lg:block")} />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 -z-10",
          "bg-[linear-gradient(to_top,rgb(12_10_7/0.82),rgb(12_10_7/0.25)_55%,rgb(12_10_7/0.35))]",
          align === "left"
            ? "lg:bg-[linear-gradient(to_right,rgb(12_10_7/0.72),rgb(12_10_7/0.15)_60%,rgb(12_10_7/0.3))]"
            : "lg:bg-[linear-gradient(to_left,rgb(12_10_7/0.72),rgb(12_10_7/0.15)_60%,rgb(12_10_7/0.3))]",
        )}
      />
      <Atmosphere tone="night" atmosphere="calm" pattern="grid" edges="top" className="pub-atmo--hero" />
      {stock && <IllustrativeTag className="absolute right-4 top-5 z-10 sm:right-8 sm:top-7" />}
      <div className={cn(containers.wide, "flex", align === "right" && "lg:justify-end")}>
        <Reveal className="w-full max-w-xl">
          <GlassPanel hud spotlight padding="lg" rounded="lg">
            {children}
          </GlassPanel>
        </Reveal>
      </div>
      {footnote && <div className={cn(containers.wide, "absolute inset-x-0 bottom-2 sm:bottom-4")}>{footnote}</div>}
    </section>
  );
}
