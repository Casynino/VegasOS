"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Expand, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { blurFor } from "../blur-data";
import { useLightbox } from "../lightbox";
import type { GalleryCategory, GalleryImage } from "../content";

/** Two mirrored editorial rhythms, alternated so chapters never repeat the same shape. */
const RHYTHM_A = [
  "col-span-2 lg:col-span-7 lg:row-span-4",
  "lg:col-span-5 lg:row-span-2",
  "lg:col-span-5 lg:row-span-2",
  "lg:col-span-4 lg:row-span-3",
  "col-span-2 lg:col-span-4 lg:row-span-3",
  "lg:col-span-4 lg:row-span-3",
];
const RHYTHM_B = [
  "col-span-2 lg:col-span-5 lg:row-span-2",
  "col-span-2 lg:col-span-7 lg:row-span-4",
  "lg:col-span-5 lg:row-span-2",
  "col-span-2 lg:col-span-6 lg:row-span-3",
  "lg:col-span-6 lg:row-span-3",
];
/** Lead each chapter with the strongest, most varied frames (near-duplicates fall later). */
const FEATURED = [
  "/images/room-red/room-red-04.webp", "/images/room-blue/room-blue-08.webp", "/images/room-red/room-red-05.webp", "/images/room-blue/room-blue-04.webp",
  "/images/room-red/room-red-07.webp", "/images/room-blue/room-blue-06.webp", "/images/room-red/room-red-06.webp", "/images/room-blue/room-blue-17.webp",
  "/images/room-red/room-red-01.webp", "/images/room-blue/room-blue-01.webp", "/images/room-blue/room-blue-13.webp", "/images/room-blue/room-blue-15.webp",
  "/images/bath/bath-01.webp", "/images/bath/bath-07.webp", "/images/bath/bath-02.webp", "/images/bath/bath-08.webp", "/images/bath/bath-05.webp",
  "/images/bath/bath-03.webp", "/images/bath/bath-14.webp", "/images/bath/bath-16.webp", "/images/bath/bath-09.webp", "/images/bath/bath-04.webp",
  "/images/lobby/lobby-02.webp", "/images/exterior/exterior-01.webp", "/images/lobby/lobby-01.webp", "/images/amenity/amenity-01.webp",
  "/images/exterior/exterior-02.webp", "/images/lobby/lobby-03.webp",
];
const rank = (src: string) => { const i = FEATURED.indexOf(src); return i === -1 ? 999 : i; };

export interface GalleryChapter { key: string; label: string; categories: GalleryCategory[] }

function Mosaic({ images, rhythm, onOpen, offset }: { images: GalleryImage[]; rhythm: string[]; onOpen: (i: number) => void; offset: number }) {
  return (
    <ul className="grid grid-flow-dense auto-rows-[42vw] grid-cols-2 gap-3 sm:auto-rows-[28vw] lg:auto-rows-[7.25rem] lg:grid-cols-12 lg:gap-4 xl:auto-rows-[8.25rem]">
      {images.map((img, i) => (
        <li key={img.src} className={cn("vlh-reveal", rhythm[i % rhythm.length])} style={{ "--vlh-i": i % 4 } as React.CSSProperties}>
          <button type="button" onClick={() => onOpen(offset + i)}
            className="vlh-zoom-frame group relative block h-full w-full overflow-hidden rounded-2xl bg-[#1a1510] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold lg:rounded-[1.5rem]">
            <Image src={img.src} alt={img.alt} fill sizes="(min-width:1024px) 45vw, 50vw" {...blurFor(img.src)} className="vlh-zoom-target object-cover" />
            <span className="absolute inset-0 bg-linear-to-t from-[#0d0b08]/80 via-transparent to-transparent opacity-50 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true" />
            <span className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10 transition-colors duration-500 group-hover:ring-gold/50" aria-hidden="true" />
            <span className="absolute inset-x-4 bottom-4 flex translate-y-2 items-end justify-between gap-3 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
              <span className="line-clamp-2 text-sm text-white/90">{img.alt}</span>
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-md"><Expand className="size-4" aria-hidden="true" /></span>
            </span>
            <span className="sr-only">Open photo: {img.alt}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The hotel gallery as an editorial experience: chapters by space, each laid
 * out as a varied mosaic, glass filter pills, long sets trimmed behind
 * "Show all", and one full-screen lightbox across everything visible.
 */
export function GalleryExperience({ images, chapters: defs }: { images: GalleryImage[]; chapters: GalleryChapter[] }) {
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const chapters = useMemo(
    () => defs
      .map((c) => ({ ...c, all: images.filter((i) => c.categories.includes(i.category)).sort((a, b) => rank(a.src) - rank(b.src)) }))
      .filter((c) => c.all.length > 0),
    [images, defs],
  );
  // Previews are whole rhythm cycles, so every row closes cleanly.
  const visible = (filter === "all" ? chapters : chapters.filter((c) => c.key === filter)).map((c, ci) => {
    const preview = (ci % 2 === 0 ? RHYTHM_A : RHYTHM_B).length * 2;
    return { ...c, preview, shown: expanded[c.key] || filter !== "all" ? c.all : c.all.slice(0, preview) };
  });
  const flat = visible.flatMap((c) => c.shown);
  const { open, element } = useLightbox(flat);
  // Where each chapter starts in the lightbox's flat list.
  const starts = visible.map((_, i) => visible.slice(0, i).reduce((n, c) => n + c.shown.length, 0));

  return (
    <div>
      <div role="group" aria-label="Filter photos" className="relative z-20 mx-auto mb-14 flex w-fit sm:sticky sm:top-20 max-w-full gap-1 overflow-x-auto rounded-full p-1.5 vlh-glass vlh-hud [scrollbar-width:none]">
        {[{ key: "all" as const, label: "All", count: images.length }, ...chapters.map((c) => ({ key: c.key, label: c.label, count: c.all.length }))].map((t) => (
          <button key={t.key} type="button" aria-pressed={filter === t.key} onClick={() => setFilter(t.key)}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
              filter === t.key ? "bg-gold text-[#15120e] shadow-[0_0_20px_oklch(0.78_0.12_80/0.5)]" : "text-white/75 hover:bg-white/10 hover:text-white",
            )}>
            {t.label} <span className="ml-1 opacity-60">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="space-y-24 sm:space-y-32">
        {visible.map((c, ci) => {
          const start = starts[ci];
          return (
            <section key={c.key} aria-labelledby={`g-${c.key}`}>
              <div className="mb-8 flex items-end justify-between gap-6 border-b border-white/10 pb-5">
                <h2 id={`g-${c.key}`} className="flex items-baseline gap-5 font-display text-[clamp(2.2rem,4.5vw,4.4rem)] leading-none text-white">
                  <span className="vlh-outline font-display text-[0.7em] text-gold" aria-hidden="true">{String(ci + 1).padStart(2, "0")}</span>
                  {c.label}
                </h2>
                <p className="shrink-0 font-mono text-xs uppercase tracking-[0.25em] text-white/50">{c.all.length} photo{c.all.length === 1 ? "" : "s"}</p>
              </div>
              <Mosaic images={c.shown} rhythm={ci % 2 === 0 ? RHYTHM_A : RHYTHM_B} onOpen={open} offset={start} />
              {filter === "all" && c.all.length > c.preview && !expanded[c.key] && (
                <div className="mt-8 flex justify-center">
                  <button type="button" onClick={() => setExpanded((e) => ({ ...e, [c.key]: true }))}
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 text-sm uppercase tracking-[0.16em] text-white/80 transition-colors hover:border-gold hover:text-white">
                    <Plus className="size-4 text-gold" aria-hidden="true" /> Show all {c.all.length}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {element}
    </div>
  );
}
