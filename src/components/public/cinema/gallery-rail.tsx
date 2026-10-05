"use client";

import Image from "next/image";
import { Expand } from "lucide-react";
import { blurFor } from "../blur-data";
import css from "../home/home.module.css";
import { Rail } from "../kit/rail";
import { motionCls, typeScale } from "../kit/tokens";
import { useLightbox, type LightboxImage } from "../lightbox";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A swipe rail of the hotel's own photographs (phones: one and a bit on screen; desktop:
 * arrows), each in a HUD viewfinder: gold corner brackets that close in on hover/focus and a
 * frame number ("03 / 08"). Each photo opens the full-screen lightbox; the caption is always
 * visible, so touch visitors see it too.
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
            className={cn(css.shot, "group block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold")}
          >
            <span className="relative block aspect-[4/5] overflow-hidden bg-[#1c1712]">
              <Image
                src={img.src}
                alt=""
                fill
                sizes="(min-width: 1024px) 31vw, (min-width: 640px) 44vw, 76vw"
                {...blurFor(img.src)}
                className={cn("pub-grade object-cover", motionCls.imageZoom)}
              />
              <span aria-hidden="true" className="pub-grade-tint" />
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-24 bg-linear-to-b from-black/45 to-transparent" />
              <span aria-hidden="true" className={css.brackets} />
              <span aria-hidden="true" className="absolute left-5 top-5 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-white/90">
                <span className="text-gold">{pad(i + 1)}</span>
                <span className="mx-1.5 text-white/45">/</span>
                {pad(images.length)}
              </span>
              <span
                aria-hidden="true"
                className="absolute bottom-4 right-4 grid size-9 place-items-center rounded-full border border-white/30 bg-black/35 text-white opacity-90 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100"
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
