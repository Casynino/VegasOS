import { cn } from "@/lib/utils";
import { Atmosphere } from "./kit/atmosphere";
import { HOTEL_COORDS, HudLabel } from "./kit/hud";
import { MediaFrame } from "./kit/media-frame";
import { containers } from "./kit/tokens";
import { Reveal } from "./reveal";

/**
 * A page's closing "book" moment as a photograph, not text on a lattice: one of the hotel's own
 * photos, dimmed and graded under a deep vignette, with slow light and star dust (no line work
 * over the photo), HUD brackets in the frame and the content centred. Use a different photo per
 * page. Server component; the photo drifts gently with the scroll (off with reduced motion).
 */
export function ClosingBand({
  image,
  focal = "50% 50%",
  labelledBy,
  meta = HOTEL_COORDS.label,
  className,
  children,
}: {
  image: string;
  focal?: string;
  /** id of the band's heading. */
  labelledBy: string;
  /** HUD line under the content (default: the hotel's coordinates; false = none). */
  meta?: React.ReactNode | false;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={labelledBy} data-tone="night" className={cn("relative isolate overflow-hidden bg-night text-pub-fg", className)}>
      <MediaFrame src={image} alt="" ratio="fill" focal={focal} sizes="100vw" parallax={6} className="-z-10" imgClassName="opacity-35" />
      <div aria-hidden="true" className="absolute inset-0 -z-[5] bg-[radial-gradient(115%_90%_at_50%_48%,rgb(12_10_7/0.45),rgb(12_10_7/0.94))]" />
      <Atmosphere tone="night" pattern="none" stars />
      <span
        aria-hidden="true"
        className="pub-hud-corners hidden sm:block"
        style={{ inset: "1.5rem", "--hud-l": "1.375rem", "--hud-c": "rgb(240 214 160 / 0.5)" } as React.CSSProperties}
      />
      <Reveal className={cn(containers.narrow, "relative flex flex-col items-center py-24 text-center sm:py-32 lg:py-36")}>
        {children}
        {meta !== false && (
          <div className="mt-12 flex w-full max-w-md items-center justify-center gap-4 sm:mt-14">
            <span aria-hidden="true" className="h-px flex-1 bg-linear-to-r from-transparent to-white/20" />
            <HudLabel tick={false} className="text-white/70">
              {meta}
            </HudLabel>
            <span aria-hidden="true" className="h-px flex-1 bg-linear-to-l from-transparent to-white/20" />
          </div>
        )}
      </Reveal>
    </section>
  );
}
