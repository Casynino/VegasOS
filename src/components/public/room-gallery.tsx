"use client";

import Image from "next/image";
import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLightbox, type LightboxImage } from "./lightbox";

/** Room photo mosaic: large lead photo + thumbnails, all opening the lightbox. */
export function RoomGallery({ images, roomName }: { images: LightboxImage[]; roomName: string }) {
  const { open, element } = useLightbox(images);
  if (images.length === 0) return null;
  const [lead, ...rest] = images;
  const thumbs = rest.slice(0, 4);
  return (
    <div>
      <div className={cn("grid gap-2 sm:gap-3", thumbs.length > 0 && "lg:grid-cols-[2fr_1fr]")}>
        <button type="button" onClick={() => open(0)} className="group relative block aspect-[4/3] overflow-hidden rounded-3xl bg-[#15120e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 lg:aspect-auto lg:min-h-[28rem]">
          <Image src={lead.src} alt={lead.alt} fill priority sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover transition-transform duration-700 motion-safe:group-hover:scale-[1.02]" />
          <span className="sr-only">Open photo 1 of {images.length} of the {roomName}</span>
        </button>
        {thumbs.length > 0 && (
          <div className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-2">
            {thumbs.map((img, i) => (
              <button key={img.src} type="button" onClick={() => open(i + 1)} className="group relative aspect-square overflow-hidden rounded-2xl bg-[#15120e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 lg:aspect-auto">
                <Image src={img.src} alt={img.alt} fill sizes="(min-width: 1024px) 20vw, 25vw" className="object-cover transition-transform duration-700 motion-safe:group-hover:scale-105" />
                {i === thumbs.length - 1 && images.length > thumbs.length + 1 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-[#15120e]/60 text-sm font-medium text-white" aria-hidden="true">
                    +{images.length - thumbs.length - 1}
                  </span>
                )}
                <span className="sr-only">Open photo {i + 2} of {images.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={() => open(0)} className="mt-3 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-tone/70 hover:text-tone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
        <Expand className="size-4" aria-hidden="true" /> View all {images.length} photos
      </button>
      {element}
    </div>
  );
}
