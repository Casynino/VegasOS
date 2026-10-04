"use client";

import Image from "next/image";
import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { blurFor } from "../blur-data";
import { useLightbox, type LightboxImage } from "../lightbox";

/** Editorial rhythm for the mosaic: one feature image, then alternating supporting frames. */
const SPANS = [
  // phone: 2-column rows that always close (2,1+1,2,1+1,2,2); desktop: 12-column editorial mosaic
  "col-span-2 row-span-2 lg:col-span-7 lg:row-span-4",
  "lg:col-span-5 lg:row-span-2",
  "lg:col-span-5 lg:row-span-2",
  "col-span-2 lg:col-span-4 lg:row-span-3",
  "lg:col-span-4 lg:row-span-3",
  "lg:col-span-4 lg:row-span-3",
  "col-span-2 lg:col-span-5 lg:row-span-3",
  "col-span-2 lg:col-span-7 lg:row-span-3",
];

/**
 * Immersive gallery mosaic: varied frame sizes, mask reveal on scroll, slow
 * zoom on hover, and a full-screen lightbox. Every photo is of the hotel.
 */
export function GalleryMosaic({ images }: { images: LightboxImage[] }) {
  const { open, element } = useLightbox(images);
  return (
    <>
      <ul className="grid grid-flow-dense auto-rows-[38vw] grid-cols-2 gap-3 sm:auto-rows-[26vw] lg:auto-rows-[7.5rem] lg:grid-cols-12 lg:gap-4 xl:auto-rows-[8.5rem]">
        {images.slice(0, SPANS.length).map((img, i) => (
          <li key={img.src} className={cn("vlh-reveal", SPANS[i])} style={{ "--vlh-i": i % 4 } as React.CSSProperties}>
            <button
              type="button"
              onClick={() => open(i)}
              className="vlh-zoom-frame group relative block h-full w-full overflow-hidden rounded-2xl bg-[#1a1510] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold lg:rounded-[1.5rem]"
            >
              <Image src={img.src} alt={img.alt} fill sizes={i === 0 ? "(min-width:1024px) 58vw, 100vw" : "(min-width:1024px) 34vw, 50vw"} {...blurFor(img.src)} className="vlh-zoom-target object-cover" />
              <span className="absolute inset-0 bg-linear-to-t from-[#0d0b08]/75 via-[#0d0b08]/0 to-transparent opacity-60 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true" />
              <span className="absolute inset-x-4 bottom-4 flex translate-y-2 items-end justify-between gap-3 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                <span className="line-clamp-2 text-sm text-white/90">{img.alt}</span>
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-md"><Expand className="size-4" aria-hidden="true" /></span>
              </span>
              <span className="sr-only">Open photo: {img.alt}</span>
            </button>
          </li>
        ))}
      </ul>
      {element}
    </>
  );
}
