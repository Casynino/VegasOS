"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLightbox } from "./lightbox";
import type { GalleryCategory, GalleryImage } from "./site-config";

/** Masonry photo gallery with category filters and a lightbox. */
export function GalleryGrid({
  images,
  categories,
}: {
  images: GalleryImage[];
  categories: { key: GalleryCategory; label: string }[];
}) {
  const [filter, setFilter] = useState<GalleryCategory | "all">("all");
  const shown = useMemo(() => (filter === "all" ? images : images.filter((i) => i.category === filter)), [images, filter]);
  const { open, element } = useLightbox(shown);
  const tabs = [{ key: "all" as const, label: "All" }, ...categories.filter((c) => images.some((i) => i.category === c.key))];

  return (
    <div>
      <div role="group" aria-label="Filter photos" className="mb-10 flex flex-wrap justify-center gap-2">
        {tabs.map((t) => {
          const count = t.key === "all" ? images.length : images.filter((i) => i.category === t.key).length;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={filter === t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                "rounded-full border px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
                filter === t.key ? "border-tone bg-[#15120e] text-gold" : "border-tone/20 text-tone/70 hover:border-tone hover:text-tone",
              )}
            >
              {t.label} <span className="ml-1 opacity-60">{count}</span>
            </button>
          );
        })}
      </div>
      <ul className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>li]:mb-4">
        {shown.map((img, i) => (
          <li key={img.src} className="break-inside-avoid">
            <button
              type="button"
              onClick={() => open(i)}
              className="group relative block w-full overflow-hidden rounded-2xl bg-[#15120e]/5 ring-1 ring-transparent transition-shadow duration-500 hover:shadow-[0_20px_50px_-20px_rgba(21,18,14,0.6)] hover:ring-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
            >
              <Image
                src={img.src}
                alt={img.alt}
                width={img.width}
                height={img.height}
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="h-auto w-full transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.03]"
              />
              <span className="absolute inset-0 flex items-end justify-end bg-linear-to-t from-[#15120e]/60 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
                <span className="grid size-10 place-items-center rounded-full bg-white/90 text-tone"><Expand className="size-4" /></span>
              </span>
              <span className="sr-only">Open larger view</span>
            </button>
          </li>
        ))}
      </ul>
      {element}
    </div>
  );
}
