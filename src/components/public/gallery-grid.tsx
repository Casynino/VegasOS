"use client";

import Image from "next/image";
import { Expand } from "lucide-react";
import { cn } from "@/lib/utils";
import { blurFor } from "./blur-data";
import { Button } from "./kit/button";
import { Rail } from "./kit/rail";
import { Section } from "./kit/section";
import { motionCls, rhythm, typeScale, type Tone } from "./kit/tokens";
import { SectionIntro } from "./kit/typography";
import { useLightbox, type LightboxImage } from "./lightbox";

/** How a chapter lays out its photographs: a landscape rail, a portrait rail or a small mosaic. */
export type ChapterLayout = "rail-wide" | "rail-tall" | "mosaic";

/** A rail shows this many, then one "+N more" frame that opens the viewer; a mosaic shows five. */
const RAIL_MAX = 12;
const MOSAIC_MAX = 5;

const RAIL = {
  "rail-wide": { size: "lg", frame: "aspect-[3/2]", sizes: "(min-width: 1024px) 42vw, (min-width: 640px) 58vw, 84vw" },
  "rail-tall": { size: "md", frame: "aspect-[4/5]", sizes: "(min-width: 1024px) 31vw, (min-width: 640px) 44vw, 76vw" },
} as const;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * One chapter of the hotel gallery (rooms, bathrooms, arrival): a short heading, then the
 * photographs as a swipe rail (phones: one and a bit on screen; desktop: arrows) or a calm
 * mosaic — never a wall of stacked images. Every photo opens the full-screen viewer (swipe,
 * arrow keys, Escape), and "View all" walks through the whole chapter there. Rail captions are
 * always visible, so touch visitors see them too. Real hotel photos only.
 */
export function GalleryChapter({
  id,
  index,
  total,
  title,
  line,
  images,
  layout,
  tone = "paper",
}: {
  /** Chapter key: the section is #chapter-<id>, its heading #g-<id>. */
  id: string;
  index: number;
  total: number;
  title: string;
  line?: string;
  images: LightboxImage[];
  layout: ChapterLayout;
  tone?: Exclude<Tone, "none">;
}) {
  const { open, element } = useLightbox(images);
  const headingId = `g-${id}`;
  return (
    <Section id={`chapter-${id}`} tone={tone} labelledBy={headingId}>
      <SectionIntro
        align="split"
        eyebrow={`${pad(index + 1)} / ${pad(total)} · ${images.length} ${images.length === 1 ? "photo" : "photos"}`}
        title={title}
        id={headingId}
        lede={line}
        actions={
          images.length > 1 && (
            <Button variant="secondary" size="sm" onClick={() => open(0)} icon={<Expand className="size-3.5" strokeWidth={1.6} aria-hidden="true" />}>
              View all {images.length}
            </Button>
          )
        }
      />
      <div className={rhythm.afterIntro}>
        {layout === "mosaic" ? (
          <Mosaic images={images} onOpen={open} />
        ) : (
          <ChapterRail images={images} title={title} layout={layout} onOpen={open} />
        )}
      </div>
      {element}
    </Section>
  );
}

/** A photo that opens the viewer. With a caption the caption names it; without, the alt text does. */
function Tile({
  img,
  frame,
  sizes,
  caption = true,
  className,
  onOpen,
}: {
  img: LightboxImage;
  frame: string;
  sizes: string;
  caption?: boolean;
  className?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("group block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold", className)}
    >
      <span className={cn("relative block overflow-hidden bg-[#1c1712]", frame)}>
        <Image src={img.src} alt={caption ? "" : img.alt} fill sizes={sizes} {...blurFor(img.src)} className={cn("object-cover", motionCls.imageZoom)} />
        <span
          aria-hidden="true"
          className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full border border-white/30 bg-black/35 text-white opacity-90 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none"
        >
          <Expand className="size-3.5" strokeWidth={1.6} />
        </span>
      </span>
      {caption && <span className={cn(typeScale.small, "mt-3 line-clamp-2 block text-pub-muted")}>{img.alt}</span>}
      <span className="sr-only">, open full screen</span>
    </button>
  );
}

/** Rooms and bathrooms: a swipe rail of the first dozen, then "+N more" into the viewer. */
function ChapterRail({ images, title, layout, onOpen }: { images: LightboxImage[]; title: string; layout: Exclude<ChapterLayout, "mosaic">; onOpen: (i: number) => void }) {
  const r = RAIL[layout];
  const shown = images.slice(0, RAIL_MAX);
  const next = images[RAIL_MAX];
  const rest = images.length - shown.length;
  return (
    <Rail label={`${title} — photos`} size={r.size}>
      {shown.map((img, i) => (
        <Tile key={img.src} img={img} frame={r.frame} sizes={r.sizes} onOpen={() => onOpen(i)} />
      ))}
      {next && (
        <button
          type="button"
          onClick={() => onOpen(RAIL_MAX)}
          className="group block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
        >
          <span className={cn("relative block overflow-hidden bg-[#1c1712]", r.frame)}>
            <Image src={next.src} alt="" fill sizes={r.sizes} {...blurFor(next.src)} className="scale-105 object-cover opacity-40 blur-[2px]" />
            <span className="absolute inset-0 grid place-items-center bg-[rgb(12_10_7/0.35)] text-center text-white">
              <span>
                <span className="block font-display text-[2.75rem] font-medium leading-none lining-nums">+{rest}</span>
                <span className={cn(typeScale.cta, "mt-4 block text-white/85")}>View all {images.length}</span>
              </span>
            </span>
          </span>
          <span className={cn(typeScale.small, "mt-3 block text-pub-muted")}>More of {title.toLowerCase()}</span>
        </button>
      )}
    </Rail>
  );
}

/** Where each of up to five photos sits: one large frame, the rest around it (phones: 2 columns, desktop: 4). */
function cell(i: number, n: number): { li: string; frame: string; button?: string } {
  if (n === 1) return { li: "col-span-2 lg:col-span-4", frame: "aspect-[3/2] lg:aspect-[21/9]" };
  if (n === 2) return { li: "lg:col-span-2", frame: "aspect-[4/5] lg:aspect-[4/3]" };
  if (i === 0) return { li: "col-span-2 lg:row-span-2", frame: "aspect-[3/2] lg:aspect-auto lg:h-full", button: "lg:h-full" };
  if (n === 3) return { li: "lg:col-span-2", frame: "aspect-square lg:aspect-[2/1]" };
  if (n === 4 && i === 3) return { li: "col-span-2", frame: "aspect-[3/2] lg:aspect-[2/1]" };
  return { li: "", frame: "aspect-square" };
}

/** A small chapter: a calm mosaic of five; "View all" (in the heading) shows the rest. */
function Mosaic({ images, onOpen }: { images: LightboxImage[]; onOpen: (i: number) => void }) {
  const shown = images.slice(0, MOSAIC_MAX);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {shown.map((img, i) => {
        const c = cell(i, shown.length);
        return (
          <li key={img.src} className={cn("min-w-0", c.li)}>
            <Tile
              img={img}
              frame={c.frame}
              caption={false}
              className={c.button}
              sizes={i === 0 ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"}
              onOpen={() => onOpen(i)}
            />
          </li>
        );
      })}
    </ul>
  );
}
