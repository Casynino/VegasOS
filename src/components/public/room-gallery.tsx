"use client";

import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { HudFrame, HudLabel } from "./kit/hud";
import { MediaFrame } from "./kit/media-frame";
import { Rail } from "./kit/rail";
import { typeScale } from "./kit/tokens";
import { useLightbox, type LightboxImage } from "./lightbox";
import fx from "./room-fx.module.css";

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Room photos, immersive: phones swipe a filmstrip (every photo at its own shape, one height);
 * desktop gets a mosaic in a HUD frame — one large photo and two beside it, the last one saying
 * how many more there are. Every tile closes a gold viewfinder on hover/focus and opens the
 * full-screen viewer (swipe, arrows, Escape). `from` skips photos already shown above (e.g. the
 * hero) — the viewer still holds them all. Place it directly inside a page container.
 */
export function RoomGallery({ images, roomName, from = 0 }: { images: LightboxImage[]; roomName: string; from?: number }) {
  const { open, element } = useLightbox(images);
  const strip = images.slice(from);
  if (strip.length === 0) return null;
  const mosaic = strip.slice(0, 3);
  const more = strip.length - mosaic.length;

  const tile = (img: LightboxImage, i: number, className: string, sizes: string, extra?: React.ReactNode) => (
    <button
      key={img.src}
      type="button"
      onClick={() => open(i + from)}
      className={cn(fx.lensHost, "group relative block overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold", className)}
    >
      <MediaFrame src={img.src} alt={img.alt} ratio="fill" zoom sizes={sizes} />
      <span aria-hidden="true" className={fx.lens} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 left-3 z-[4] font-mono text-[10px] tracking-[0.2em] text-white/85 [text-shadow:0_1px_8px_rgb(0_0_0/0.75)]"
      >
        {pad2(i + from + 1)}
      </span>
      {extra}
      <span className="sr-only">
        Open photo {i + from + 1} of {images.length}
      </span>
    </button>
  );

  return (
    <div>
      {/* Phones and tablets: the filmstrip. */}
      <div className="lg:hidden">
        <Rail label={`Photos of the ${roomName}`} itemClassName="w-auto sm:w-auto lg:w-auto">
          {strip.map((img, i) => (
            <div key={img.src} style={{ aspectRatio: `${img.width} / ${img.height}` }} className="relative h-[17.5rem] max-w-[82vw] sm:h-[21rem] sm:max-w-none">
              {tile(img, i, "absolute inset-0", "(min-width: 640px) 50vw, 82vw")}
            </div>
          ))}
        </Rail>
      </div>

      {/* Desktop: the mosaic in a HUD frame. */}
      <HudFrame className="hidden lg:block" label="Select a photo to enlarge" labelEnd={<>{pad2(images.length)} photos</>}>
        <div
          className={cn(
            "grid gap-3",
            mosaic.length === 1 && "aspect-[21/9]",
            mosaic.length === 2 && "aspect-[2/1] grid-cols-2",
            mosaic.length === 3 && "aspect-[2.15/1] grid-cols-12 grid-rows-2",
          )}
        >
          {mosaic.map((img, i) =>
            tile(
              img,
              i,
              cn("relative h-full min-h-0", mosaic.length === 3 && (i === 0 ? "col-span-8 row-span-2" : "col-span-4")),
              mosaic.length === 3 && i > 0 ? "28vw" : mosaic.length === 1 ? "90vw" : "60vw",
              i === mosaic.length - 1 && more > 0 ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-[2] grid place-items-center bg-[rgb(12_10_7/0.45)] transition-colors duration-500 group-hover:bg-[rgb(12_10_7/0.3)] motion-reduce:transition-none"
                >
                  <span className="pub-glass rounded-full px-4 py-2 text-[13px] font-medium text-white">+ {more} more</span>
                </span>
              ) : undefined,
            ),
          )}
        </div>
      </HudFrame>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 lg:mt-3">
        <button
          type="button"
          onClick={() => open(from)}
          className={cn(
            typeScale.cta,
            "inline-flex min-h-11 items-center gap-2 rounded-sm text-pub-muted transition-colors duration-200 hover:text-pub-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
          )}
        >
          <Expand className="size-4" strokeWidth={1.6} aria-hidden="true" /> View all {images.length} photos
        </button>
        <HudLabel tick={false} className="lg:hidden">
          {pad2(images.length)} photos
        </HudLabel>
      </div>
      {element}
    </div>
  );
}
