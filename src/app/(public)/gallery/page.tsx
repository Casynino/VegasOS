import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { getSiteContent } from "@/server/services/site-content";
import type { GalleryCategory, GalleryImage } from "@/components/public/content";
import type { ChapterLayout } from "@/components/public/gallery-grid";
import { Accent, Actions, Heading, LinkButton, Reveal, Section, TextLink, containers, rhythm, typeScale } from "@/components/public/kit";
import { PageHero } from "@/components/public/page-hero";

// The chapters (rails, mosaic, viewer) are client code: split out of the page's server payload.
const GalleryChapter = dynamic(() => import("@/components/public/gallery-grid").then((m) => m.GalleryChapter));

export const metadata: Metadata = {
  title: "Gallery",
  description: "Photos of the rooms, suites, bathrooms, reception and building at Vegas Luxury Hotel, Mlimani City, Dar es Salaam.",
  alternates: { canonical: "/gallery" },
};

const CHAPTERS: { key: string; label: string; line: string; categories: GalleryCategory[]; layout: ChapterLayout }[] = [
  { key: "rooms", label: "Rooms & suites", line: "Bright rooms with tall windows, crisp linen and a sofa to unwind on.", categories: ["rooms"], layout: "rail-wide" },
  { key: "bath", label: "Bathrooms", line: "Bright, tiled bathrooms — some with a jetted jacuzzi bathtub.", categories: ["bath"], layout: "rail-tall" },
  { key: "arrival", label: "Reception & building", line: "Where your stay begins: our reception, the building and the small touches.", categories: ["lobby", "exterior", "amenity"], layout: "mosaic" },
];
const TONES = ["paper", "deep"] as const;

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
const rank = (src: string) => {
  const i = FEATURED.indexOf(src);
  return i === -1 ? 999 : i;
};
const photo = ({ src, alt, width, height }: GalleryImage) => ({ src, alt, width, height });

/**
 * The hotel in pictures — real photographs only (the media library never sends stock here):
 * the photo opening · a chapter index · Rooms & suites (landscape rail) · Bathrooms (portrait
 * rail) · Reception & building (mosaic) · Book your stay. Phones swipe; every photo opens the
 * full-screen viewer.
 */
export default async function GalleryPage() {
  const c = await getSiteContent();
  const p = c.pages.gallery;
  const gallery: GalleryImage[] = c.gallery;
  const chapters = CHAPTERS.map((ch) => ({
    ...ch,
    all: gallery.filter((i) => ch.categories.includes(i.category)).sort((a, b) => rank(a.src) - rank(b.src)),
  })).filter((ch) => ch.all.length > 0);

  return (
    <>
      <PageHero kicker={p.kicker} title={p.title} image={p.image.src} imageAlt={p.image.alt} intro={<p>{p.intro}</p>} focal="50% 45%" id="gallery-title" />

      {/* Chapter index: where each set of photographs is, and how many. */}
      {chapters.length > 1 && (
        <nav aria-label="Gallery chapters" data-tone="night" className="bg-night text-pub-fg">
          <ul className={cn(containers.wide, "grid")} style={{ gridTemplateColumns: `repeat(${chapters.length}, minmax(0, 1fr))` }}>
            {chapters.map((ch, i) => (
              <li key={ch.key} className={cn("min-w-0 border-t border-pub-line", i > 0 && "border-l")}>
                <a
                  href={`#chapter-${ch.key}`}
                  className={cn(
                    "group relative flex min-h-16 flex-col justify-center gap-1.5 px-2 py-4 text-center transition-colors duration-200 sm:min-h-20 sm:px-6 sm:text-left motion-reduce:transition-none",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold",
                    "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:origin-left before:scale-x-0 before:bg-gold before:transition-transform before:duration-300 before:ease-pub hover:before:scale-x-100 motion-reduce:before:transition-none",
                  )}
                >
                  <span className="font-display text-[1.0625rem] leading-tight text-pub-fg group-hover:text-gold sm:text-[1.5rem]">{ch.label}</span>
                  <span className={cn(typeScale.meta, "text-pub-muted")}>
                    {ch.all.length} {ch.all.length === 1 ? "photo" : "photos"}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {chapters.map((ch, i) => (
        <GalleryChapter
          key={ch.key}
          id={ch.key}
          index={i}
          total={chapters.length}
          title={ch.label}
          line={ch.line}
          images={ch.all.map(photo)}
          layout={ch.layout}
          tone={TONES[i % 2]}
        />
      ))}

      <Section tone="night" glow="sky" space="lg" labelledBy="gallery-close-title">
        <Reveal className="flex flex-col items-center text-center">
          <Heading id="gallery-close-title" className="max-w-3xl">
            Seen enough? <Accent>Your room is waiting.</Accent>
          </Heading>
          <Actions align="center" className={rhythm.beforeActions}>
            <LinkButton href="/book" icon="arrow">
              Book your stay
            </LinkButton>
            <TextLink href="/rooms">Explore the rooms</TextLink>
          </Actions>
        </Reveal>
      </Section>
    </>
  );
}
