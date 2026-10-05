import { cn } from "@/lib/utils";
import type { Tone } from "./tokens";

/**
 * How much atmosphere a band carries.
 * - "rich": light (aurora / window light) that drifts slowly while on screen, line work, a survey
 *   reticle, a soft diagonal beam, grain, the dissolves (+ a HUD ruler on night, desktop).
 * - "calm": one still light, lighter line work, grain and the dissolve — for forms and dense lists.
 * - "none": a flat band.
 */
export type AtmosphereLevel = "rich" | "calm" | "none";
/**
 * "grid" = blueprint (1px gold grid + cross-hairs), "contour" = topographic lines, "auto" = by tone —
 * and on night bands by position too (grid → survey rings → night contours), so neighbours differ.
 */
export type AtmospherePattern = "auto" | "grid" | "contour" | "none";

export interface AtmosphereOptions {
  /** Default "rich". */
  atmosphere?: AtmosphereLevel;
  /** Default "auto": contours on paper, blueprint grid on deep and night. */
  pattern?: AtmospherePattern;
  /** Moving light. Default: on for rich, a single still light for calm. */
  aurora?: boolean;
  /** Diagonal light beam. Default: on for rich. */
  beam?: boolean;
  /** Star dust in the upper part (night bands; also turned on by glow="sky"). */
  stars?: boolean;
}

function resolvePattern(pattern: AtmospherePattern, tone: Tone | undefined) {
  if (pattern !== "auto") return pattern;
  return tone === "paper" ? "contour" : "grid";
}

/**
 * The living background of a band, as one absolutely positioned, aria-hidden layer. Section,
 * PageIntro, PageHero and the footer render it for you; for a custom block, put it as the first
 * child of an element that is `relative isolate` and carries data-tone (or toneAttr()):
 *
 *   <div {...toneAttr("night")} className="relative isolate bg-night"><Atmosphere tone="night" />…</div>
 *
 * It is pure CSS (globals.css, .pub-atmo): colours follow the tone and the visitor's theme; the
 * lights drift only while the band is on screen (data-live, set by PubRuntime) and never with
 * reduced motion. The dissolve from the band above works when the bands are siblings.
 */
export function Atmosphere({
  tone,
  atmosphere = "rich",
  pattern = "auto",
  aurora,
  beam,
  stars = false,
  edges = "both",
  className,
}: AtmosphereOptions & {
  tone?: Tone;
  /** "top" keeps the foot clean (photo heroes, where the title sits at the bottom). */
  edges?: "both" | "top";
  className?: string;
}) {
  if (atmosphere === "none" || tone === "none") return null;
  const rich = atmosphere === "rich";
  const lines = resolvePattern(pattern, tone);
  const moving = aurora ?? rich;
  const showBeam = beam ?? rich;
  return (
    <div
      aria-hidden="true"
      // PubRuntime sets data-live while the band is on screen; it can land before a streamed segment hydrates.
      suppressHydrationWarning
      data-level={atmosphere}
      data-edges={edges === "top" ? "top" : undefined}
      data-motion={moving ? "" : undefined}
      data-live-watch={moving ? "" : undefined}
      className={cn("pub-atmo", className)}
    >
      <i className="pub-atmo__light" data-l="1" />
      {(moving || rich) && (
        <>
          <i className="pub-atmo__light" data-l="2" />
          <i className="pub-atmo__light" data-l="3" />
        </>
      )}
      {stars && <i className="pub-atmo__stars" />}
      {showBeam && <i className="pub-atmo__beam" />}
      {lines !== "none" && <i className="pub-atmo__lines" data-p={lines} data-auto={pattern === "auto" ? "" : undefined} />}
      {rich && lines !== "none" && <i className="pub-atmo__reticle" />}
      {rich && tone === "night" && <i className="pub-atmo__ruler" />}
      <i className="pub-atmo__seam" />
      <i className="pub-atmo__seam" data-edge="bottom" />
    </div>
  );
}
