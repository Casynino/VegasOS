import { cn } from "@/lib/utils";
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

/**
 * A page band: tone (colour), vertical rhythm and the content width in one place.
 * `first` clears the fixed header — use it on the first block of a page (unless it is a
 * photo hero that handles the header itself). `width="bleed"` drops the inner container
 * for full-width media.
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
  className?: string;
  containerClassName?: string;
  children: React.ReactNode;
}) {
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
      {width === "bleed" ? children : <div className={cn(containers[width], containerClassName)}>{children}</div>}
    </Tag>
  );
}
