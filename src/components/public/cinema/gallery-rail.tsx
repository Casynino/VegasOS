"use client";

import Image from "next/image";
import { Expand } from "lucide-react";
import { blurFor } from "../blur-data";
import { Rail } from "../kit/rail";
import { motionCls, typeScale } from "../kit/tokens";
import { useLightbox, type LightboxImage } from "../lightbox";
import { cn } from "@/lib/utils";

/**
 * A swipe rail of the hotel's own photographs (phones: one and a bit on screen; desktop:
 * arrows). Each photo opens the full-screen lightbox; the caption is always visible, so touch
 * visitors see it too.
 */
export function GalleryRail({ images, label }: { images: LightboxImage[]; label: string }) {
  const { open, element } = useLightbox(images);
  return (
    <>
      <Rail label={label} size="md">
        {images.map((img, i) => (
          <button
            key={img.src}
            type="button"
            onClick={() => open(i)}
            className="group block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
          >
            <span className="relative block aspect-[4/5] overflow-hidden bg-[#1c1712]">
              <Image
                src={img.src}
                alt=""
                fill
                sizes="(min-width: 1024px) 31vw, (min-width: 640px) 44vw, 76vw"
                {...blurFor(img.src)}
                className={cn("object-cover", motionCls.imageZoom)}
              />
              <span
                aria-hidden="true"
                className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full border border-white/30 bg-black/35 text-white opacity-90 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100"
              >
                <Expand className="size-3.5" strokeWidth={1.6} />
              </span>
            </span>
            {/* The caption names the button (the photo itself is decorative here). */}
            <span className={cn(typeScale.small, "mt-3 line-clamp-2 block text-pub-muted")}>{img.alt}</span>
            <span className="sr-only">, open full screen</span>
          </button>
        ))}
      </Rail>
      {element}
    </>
  );
}
