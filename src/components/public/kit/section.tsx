import { cn } from "@/lib/utils";
import { Atmosphere, type AtmosphereOptions } from "./atmosphere";
import { SectionIndex } from "./hud";
import { containers, pageTop, sectionSpace, tones, type ContainerWidth, type SectionSpace, type Tone } from "./tokens";

const GLOW = { none: "", top: "pub-glow-top", bottom: "pub-glow-bottom", sky: "pub-sky" } as const;

export type SectionGlow = keyof typeof GLOW;

/** Data attribute that makes kit text colours follow a tone inside any custom block. */
export function toneAttr(tone: Exclude<Tone, "none">) {
  return { "data-tone": tone } as const;
}

/** Page-width wrapper with the standard gutters (16px phones, 32px tablet/desktop). */
export function Container({
  width = "default",
  className,
  children,
}: {
  width?: ContainerWidth;
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn(containers[width], className)}>{children}</div>;
}

/** Index line at the top of a band: "01 ── Rooms ────── aside". */
export interface SectionMarker {
  index?: string | number;
  label: React.ReactNode;
  aside?: React.ReactNode;
}

/**
 * A page band: tone (colour), vertical rhythm, content width — and its atmosphere — in one place.
 *
 * Every band gets a living background automatically (see Atmosphere): light that drifts while on
 * screen, fine line work (contours on paper, blueprint grid on deep/night), grain, a soft beam and
 * a dissolve from the band above. Tune it per band with `atmosphere="rich|calm|none"`,
 * `pattern="auto|grid|contour|none"`, `aurora`, `beam`, `stars`.
 *
 * `first` clears the fixed header — use it on the first block of a page (unless it is a photo
 * hero that handles the header itself). `width="bleed"` drops the inner container for full-width
 * media. `marker` prints a SectionIndex at the top ("01 — Rooms").
 */
export function Section({
  tone = "paper",
  space = "md",
  width = "default",
  glow = "none",
  first = false,
  as: Tag = "section",
  id,
  labelledBy,
  atmosphere = "rich",
  pattern = "auto",
  aurora,
  beam,
  stars,
  marker,
  className,
  containerClassName,
  children,
}: {
  tone?: Tone;
  space?: SectionSpace;
  width?: ContainerWidth | "bleed";
  glow?: SectionGlow;
  first?: boolean;
  as?: "section" | "div" | "article" | "aside";
  id?: string;
  /** id of the heading that names this section (aria-labelledby). */
  labelledBy?: string;
  marker?: SectionMarker;
  className?: string;
  containerClassName?: string;
  children: React.ReactNode;
} & AtmosphereOptions) {
  const indexLine = marker && (
    <SectionIndex index={marker.index} label={marker.label} aside={marker.aside} className="mb-8 sm:mb-10 lg:mb-14" />
  );
  return (
    <Tag
      id={id}
      aria-labelledby={labelledBy}
      data-tone={tone === "none" ? undefined : tone}
      className={cn(
        "relative isolate",
        tones[tone],
        sectionSpace[space],
        first && pageTop[space],
        GLOW[glow],
        id && "scroll-mt-header",
        className,
      )}
    >
      <Atmosphere tone={tone} atmosphere={atmosphere} pattern={pattern} aurora={aurora} beam={beam} stars={stars} />
      {width === "bleed" ? (
        <>
          {indexLine && <div className={containers.wide}>{indexLine}</div>}
          {children}
        </>
      ) : (
        <div className={cn(containers[width], containerClassName)}>
          {indexLine}
          {children}
        </div>
      )}
    </Tag>
  );
}
