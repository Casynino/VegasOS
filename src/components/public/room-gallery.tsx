"use client";

import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaFrame } from "./kit/media-frame";
import { Rail } from "./kit/rail";
import { typeScale } from "./kit/tokens";
import { useLightbox, type LightboxImage } from "./lightbox";

/**
 * Room photos as a filmstrip: every photo at its own shape, one height, swiped on phones and
 * stepped with arrows on desktop; each opens the full-screen viewer (swipe, arrows, Escape).
 * `from` skips photos already shown above (e.g. the hero) — the viewer still holds them all.
 * Place it directly inside a page container (the strip runs to the screen edge on phones).
 */
export function RoomGallery({ images, roomName, from = 0 }: { images: LightboxImage[]; roomName: string; from?: number }) {
  const { open, element } = useLightbox(images);
  const strip = images.slice(from);
  if (strip.length === 0) return null;
  return (
    <div>
      <Rail label={`Photos of the ${roomName}`} itemClassName="w-auto sm:w-auto lg:w-auto">
        {strip.map((img, i) => (
          <button
            key={img.src}
            type="button"
            onClick={() => open(i + from)}
            style={{ aspectRatio: `${img.width} / ${img.height}` }}
            className="group relative block h-[17.5rem] max-w-[82vw] overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:h-[21rem] sm:max-w-none lg:h-[25rem]"
          >
            <MediaFrame src={img.src} alt={img.alt} ratio="fill" zoom sizes="(min-width: 1024px) 40vw, (min-width: 640px) 50vw, 82vw" />
            <span className="sr-only">Open photo {i + from + 1} of {images.length}</span>
          </button>
        ))}
      </Rail>
      <button
        type="button"
        onClick={() => open(from)}
        className={cn(
          typeScale.cta,
          "mt-2 inline-flex min-h-11 items-center gap-2 rounded-sm text-pub-muted transition-colors duration-200 hover:text-pub-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
        )}
      >
        <Expand className="size-4" strokeWidth={1.6} aria-hidden="true" /> View all {images.length} photos
      </button>
      {element}
    </div>
  );
}
