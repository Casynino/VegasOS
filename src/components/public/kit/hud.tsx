import { cn } from "@/lib/utils";

/**
 * The hotel's real position (from the weather service: -6.7726, 39.2310), for HUD labels.
 * Use it as-is; never invent other figures for "technical" decoration.
 */
export const HOTEL_COORDS = { lat: -6.7726, lon: 39.231, label: "06°46′S · 39°14′E" } as const;

/**
 * A tiny HUD label: mono caps with a gold tick — "06°46′S · 39°14′E", "Room type 02/05", "Live".
 * Text uses the tone's muted ink (readable on paper and night); `live` adds a softly pinging dot.
 * Over photography, put it on a scrim or inside a GlassPanel.
 */
export function HudLabel({
  as: Tag = "span",
  live = false,
  tick = true,
  className,
  children,
}: {
  as?: "span" | "p" | "div" | "li";
  live?: boolean;
  /** The short gold line before the text (default on; off when `live`). */
  tick?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "inline-flex items-center gap-2.5 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.2em] text-pub-muted sm:text-[11px]",
        className,
      )}
    >
      {live ? (
        <span aria-hidden="true" className="pub-live-dot relative inline-block size-1.5 shrink-0 rounded-full bg-gold after:absolute after:inset-0 after:rounded-full after:bg-gold" />
      ) : (
        tick && <span aria-hidden="true" className="h-px w-3.5 shrink-0 bg-pub-eyebrow" />
      )}
      <span className="min-w-0">{children}</span>
    </Tag>
  );
}

/**
 * Section index: "01 ── Rooms ─────────── aside". The gold number and short rule, the label, then a
 * hairline that draws in as it scrolls into view. `aside` sits at the far end (e.g. a HudLabel).
 */
export function SectionIndex({
  index,
  label,
  aside,
  className,
}: {
  index?: string | number;
  label: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  const n = typeof index === "number" ? String(index).padStart(2, "0") : index;
  return (
    <div className={cn("flex min-w-0 items-center gap-3 sm:gap-4", className)}>
      {n && <span className="font-mono text-[11px] font-medium tracking-[0.18em] text-pub-eyebrow">{n}</span>}
      {n && <span aria-hidden="true" className="h-px w-6 shrink-0 bg-pub-eyebrow sm:w-8" />}
      <span className="shrink-0 text-[11px] font-medium uppercase leading-none tracking-[0.28em] text-pub-eyebrow">{label}</span>
      <span aria-hidden="true" className="relative h-px min-w-6 flex-1 overflow-hidden">
        <span className="pub-draw-x absolute inset-0 bg-linear-to-r from-pub-line via-pub-line to-transparent" />
      </span>
      {aside && <span className="hidden shrink-0 sm:inline-flex">{aside}</span>}
    </div>
  );
}

const OFFSET = { none: "0rem", sm: "0.5rem", md: "0.875rem" } as const;

/**
 * Thin gold corner brackets around a photo or panel — the HUD "viewfinder". `offset` places the
 * brackets just outside the box (default "sm"), so they never cover the content. `label` /
 * `labelEnd` print a HudLabel row under the frame (e.g. caption and coordinates).
 */
export function HudFrame({
  offset = "sm",
  size = "md",
  label,
  labelEnd,
  className,
  frameClassName,
  children,
}: {
  offset?: keyof typeof OFFSET;
  size?: "sm" | "md" | "lg";
  label?: React.ReactNode;
  labelEnd?: React.ReactNode;
  className?: string;
  /** Classes for the bracketed box itself (when `label`s add a row under it). */
  frameClassName?: string;
  children: React.ReactNode;
}) {
  const style = { "--hud-o": OFFSET[offset], "--hud-l": size === "sm" ? "0.75rem" : size === "lg" ? "1.5rem" : "1.125rem" } as React.CSSProperties;
  const box = (
    <div style={style} className={cn("pub-hud-frame", !(label || labelEnd) && className, frameClassName)}>
      {children}
      <span aria-hidden="true" className="pub-hud-corners" />
    </div>
  );
  if (!label && !labelEnd) return box;
  return (
    <div className={className}>
      {box}
      <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-2", offset === "none" ? "mt-3" : "mt-5")}>
        {label ? <HudLabel>{label}</HudLabel> : <span />}
        {labelEnd && <HudLabel tick={false}>{labelEnd}</HudLabel>}
      </div>
    </div>
  );
}

const PAD = { none: "", sm: "p-4 sm:p-5", md: "p-5 sm:p-7", lg: "p-6 sm:p-9" } as const;
const ROUND = { none: "", md: "rounded-[0.875rem]", lg: "rounded-[1.25rem]", full: "rounded-full" } as const;

/**
 * Frosted panel floating over photography (or a lit band): 1px light edge, inner highlight, a gold
 * hairline on top. "smoke" (default) is the most legible over bright photos; "clear" is lighter;
 * "paper" is a light glass for paper bands (dark glass in the dark theme). Text inside follows the
 * panel (night ink on smoke/clear, paper ink on paper). `spotlight` adds the cursor-lit border.
 * Glass blurs what is behind it — keep it to one or two panels per screen.
 */
export function GlassPanel({
  as: Tag = "div",
  variant = "smoke",
  padding = "md",
  rounded = "md",
  hud = false,
  spotlight = false,
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "aside" | "article" | "figure" | "form" | "li";
  /** "dense" = smoke at ~80%: long text or small labels over a bright photo. */
  variant?: "smoke" | "dense" | "clear" | "paper";
  padding?: keyof typeof PAD;
  rounded?: keyof typeof ROUND;
  /** Gold corner brackets just inside the panel. */
  hud?: boolean;
  spotlight?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      data-tone={variant === "paper" ? "paper" : "night"}
      data-glass={variant === "smoke" ? undefined : variant}
      data-spotlight={spotlight ? "border" : undefined}
      className={cn("pub-glass text-pub-fg", PAD[padding], ROUND[rounded], hud && "pub-hud-frame", className)}
      style={hud ? ({ "--hud-o": "-0.5rem", "--hud-l": "0.75rem" } as React.CSSProperties) : undefined}
      {...rest}
    >
      {children}
      {hud && <span aria-hidden="true" className="pub-hud-corners" />}
    </Tag>
  );
}

/**
 * A block lit by the cursor on desktop (fine pointers; nothing on touch). "glow" washes a soft
 * gold light under the cursor; "border" lights the 1px edge. Add `data-spotlight` to any element
 * yourself if you would rather not wrap (it uses that element's ::before and needs `position`).
 */
export function Spotlight({
  as: Tag = "div",
  variant = "glow",
  className,
  children,
  ...rest
}: {
  as?: "div" | "li" | "article" | "section";
  variant?: "glow" | "border";
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag data-spotlight={variant === "border" ? "border" : ""} className={className} {...rest}>
      {children}
    </Tag>
  );
}
