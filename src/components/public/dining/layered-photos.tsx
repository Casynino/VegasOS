import { cn } from "@/lib/utils";
import { HudFrame } from "../kit/hud";
import { MediaFrame } from "../kit/media-frame";
import { MaskReveal } from "../reveal";

type Shot = { src: string; alt: string; illustrative?: boolean; focal?: string };

/**
 * Two photographs layered like prints on a table: a large portrait in gold HUD brackets that
 * drifts with the scroll (parallax), and a smaller one overlapping its lower corner that wipes in
 * once. `label` / `labelEnd` print a HUD line under the large frame. Phones keep the same
 * composition, scaled (nothing wider than the column).
 */
export function LayeredPhotos({
  main,
  inset,
  side = "left",
  label,
  labelEnd,
  className,
}: {
  main: Shot;
  inset?: Shot;
  /** Where the small photo overlaps. */
  side?: "left" | "right";
  label?: React.ReactNode;
  labelEnd?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative", inset && "pb-[16%] sm:pb-[12%]", className)}>
      <HudFrame
        offset="sm"
        label={label}
        labelEnd={labelEnd}
        className={cn("w-[84%] sm:w-[78%]", inset && (side === "left" ? "ml-auto" : "mr-auto"))}
      >
        <MediaFrame
          src={main.src}
          alt={main.alt}
          ratio="4/5"
          focal={main.focal}
          illustrative={main.illustrative}
          parallax={6}
          sizes="(min-width: 1024px) 38vw, 84vw"
        />
      </HudFrame>
      {inset && (
        <MaskReveal
          direction={side === "left" ? "right" : "left"}
          sweep
          className={cn("absolute bottom-0 w-[44%] sm:w-[40%]", side === "left" ? "left-0" : "right-0")}
        >
          {/* The wipe clips this frame (the reveal's child), so nothing shows before it opens. */}
          <div className="bg-night p-1.5 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9)] sm:p-2">
            <MediaFrame
              src={inset.src}
              alt={inset.alt}
              ratio="4/5"
              focal={inset.focal}
              illustrative={inset.illustrative}
              tagClassName="left-2 top-2"
              sizes="(min-width: 1024px) 17vw, 44vw"
            />
          </div>
        </MaskReveal>
      )}
    </div>
  );
}
