"use client";

// A client component (no state): it is rendered by server pages and by client components alike, and its
// Illustrative tag speaks the visitor's language (useT). Everything it takes is plain data or React nodes.
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { blurFor } from "../blur-data";
import { MaskReveal } from "../reveal";
import { ParallaxLayer } from "./parallax";
import { motionCls, typeScale } from "./tokens";

/** The honest label every stock photo carries (never present stock as the hotel). */
export function IllustrativeTag({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      className={cn(
        "pointer-events-none inline-flex items-center rounded-full bg-black/50 px-2.5 py-1 text-[9px] font-medium uppercase leading-none tracking-[0.22em] text-white/85 backdrop-blur-sm",
        className,
      )}
    >
      {t("Illustrative")}
    </span>
  );
}

const ROUNDED = { none: "", soft: "rounded-[0.375rem]", lg: "rounded-[1.25rem]" } as const;

const OVERLAY = {
  none: "",
  /** Readable text at the bottom of a photo. */
  bottom: "bg-[linear-gradient(to_top,rgb(12_10_7/0.88)_0%,rgb(12_10_7/0.45)_40%,rgb(12_10_7/0)_72%)]",
  /** Text anywhere over a bright photo. */
  full: "bg-[rgb(12_10_7/0.42)]",
  /** Hero: bottom-weighted, with a light scrim at the top for the header. */
  hero: "bg-[linear-gradient(to_top,rgb(12_10_7/0.92)_0%,rgb(12_10_7/0.72)_38%,rgb(12_10_7/0.4)_70%,rgb(12_10_7/0.55)_100%)]",
} as const;

export type MediaOverlay = keyof typeof OVERLAY;

/**
 * A photo in a stable frame: next/image `fill` inside an aspect box (CMS images have no
 * intrinsic size), focal point per breakpoint, blur or warm placeholder, optional gentle
 * zoom on hover, caption, scrim, viewfinder corners and the Illustrative tag (automatic for
 * /images/illustrative/ paths).
 *
 * ratio: CSS aspect ratio such as "4/5", "3/2", "16/9" — or "fill" to cover a positioned parent.
 * Pass `preload` only for the page's LCP image (the hero); everything else lazy-loads.
 *
 * Every photo gets the site's warm grade (`grade={false}` to opt out, e.g. a document or a map).
 *
 * Motion (all off with reduced motion): `parallax` (true or a strength 4–10) drifts the photo with
 * the scroll inside its frame; `reveal` wipes the frame open once as it enters, with a gold scan
 * line ("up" | "left" | "right" | "center"; true = "up"). One or two parallax photos per screen.
 */
export function MediaFrame({
  src,
  alt,
  ratio = "4/3",
  ratioSm,
  ratioLg,
  focal = "50% 50%",
  focalSm,
  sizes = "(min-width: 1024px) 50vw, 100vw",
  preload = false,
  zoom = false,
  overlay = "none",
  rounded = "none",
  corners = false,
  illustrative,
  tagClassName,
  caption,
  parallax,
  reveal,
  grade = true,
  className,
  imgClassName,
  children,
}: {
  src: string;
  alt: string;
  ratio?: string;
  ratioSm?: string;
  ratioLg?: string;
  /** object-position on phones, e.g. "50% 30%". */
  focal?: string;
  /** object-position from 640px up (defaults to `focal`). */
  focalSm?: string;
  sizes?: string;
  preload?: boolean;
  zoom?: boolean;
  overlay?: MediaOverlay;
  rounded?: keyof typeof ROUNDED;
  corners?: boolean;
  /** Defaults to true for /images/illustrative/ photos. */
  illustrative?: boolean;
  /** Position of the Illustrative tag (default top-left, inside the frame). */
  tagClassName?: string;
  caption?: React.ReactNode;
  /** Scroll-linked drift of the photo inside the frame (true = 7%). Not with `zoom` on touch-only cards. */
  parallax?: boolean | number;
  /** Wipe the frame open as it enters, with a scan line (true = "up"). */
  reveal?: boolean | "up" | "left" | "right" | "center";
  /** The site's warm colour grade (default on): calmer saturation, a touch of sepia, a soft vignette. */
  grade?: boolean;
  className?: string;
  imgClassName?: string;
  /** Overlay content (absolutely position it yourself; the frame is `relative`). */
  children?: React.ReactNode;
}) {
  const isFill = ratio === "fill";
  const stock = illustrative ?? src.includes("/illustrative/");
  const style = {
    "--ar": isFill ? undefined : ratio,
    "--ar-sm": isFill ? undefined : (ratioSm ?? ratio),
    "--ar-lg": isFill ? undefined : (ratioLg ?? ratioSm ?? ratio),
    "--focal": focal,
    "--focal-sm": focalSm ?? focal,
  } as React.CSSProperties;

  const revealDir = reveal === true ? "up" : reveal || null;
  const image = (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      preload={preload || undefined}
      {...blurFor(src)}
      className={cn("object-cover object-[var(--focal)] sm:object-[var(--focal-sm)]", grade && "pub-grade", zoom && motionCls.imageZoom, imgClassName)}
    />
  );
  const frame = (
    <div
      style={style}
      className={cn(
        "group/media isolate overflow-hidden bg-[#1c1712]",
        isFill ? "absolute inset-0" : "relative aspect-[var(--ar)] sm:aspect-[var(--ar-sm)] lg:aspect-[var(--ar-lg)]",
        ROUNDED[rounded],
        corners && "pub-corners",
        !caption && !revealDir && className,
      )}
    >
      {parallax ? <ParallaxLayer strength={typeof parallax === "number" ? parallax : 7}>{image}</ParallaxLayer> : image}
      {grade && (
        <>
          <span aria-hidden="true" className="pub-grade-tint" />
          <span aria-hidden="true" className="pub-grade-veil" />
        </>
      )}
      {overlay !== "none" && <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0", OVERLAY[overlay])} />}
      {stock && <IllustrativeTag className={cn("absolute left-3 top-3 z-10", tagClassName)} />}
      {children}
    </div>
  );

  const shown = revealDir ? (
    <MaskReveal direction={revealDir} sweep className={cn(isFill ? "absolute inset-0" : "relative", !caption && className)}>
      {frame}
    </MaskReveal>
  ) : (
    frame
  );

  if (!caption) return shown;
  return (
    <figure className={className}>
      {shown}
      <figcaption className={cn(typeScale.meta, "mt-3 text-pub-muted")}>{caption}</figcaption>
    </figure>
  );
}

/** A MediaFrame whose photo drifts with the scroll (same props; `strength` 4–10, default 7). */
export function ParallaxMedia({ strength = 7, ...props }: Omit<React.ComponentProps<typeof MediaFrame>, "parallax"> & { strength?: number }) {
  return <MediaFrame {...props} parallax={strength} />;
}
