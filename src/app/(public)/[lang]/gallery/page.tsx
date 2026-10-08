import type { Metadata } from "next";
import dynamic from "next/dynamic";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { getSiteContent } from "@/server/services/site-content";
import { publicMeetingRoom } from "@/server/services/booking-requests";
import { parseImages } from "@/server/services/public-booking";
import { photo as registered, type GalleryCategory, type GalleryImage } from "@/components/public/content";
import type { ChapterLayout } from "@/components/public/gallery-grid";
import { blurFor } from "@/components/public/blur-data";
import fx from "@/components/public/dining/dining.module.css";
import { Accent, Actions, Atmosphere, HOTEL_COORDS, Heading, HudLabel, LinkButton, Reveal, TextLink, containers, rhythm, typeScale } from "@/components/public/kit";
import { PageHero } from "@/components/public/page-hero";
import { altZh } from "@/components/public/content.zh-CN";
import { msg } from "@/i18n/msg";
import { getT, pageLocale } from "@/i18n/server";

// The chapters (rails, mosaic, viewer) are client code: split out of the page's server payload.
const GalleryChapter = dynamic(() => import("@/components/public/gallery-grid").then((m) => m.GalleryChapter));

export async function generateMetadata({ params }: PageProps<"/[lang]/gallery">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  return {
    title: t("Gallery"),
    description: t("Photos of the rooms, suites, bathrooms, reception and building at Vegas Luxury Hotel, Mlimani City, Dar es Salaam."),
    alternates: { canonical: "/gallery" },
  };
}

const CHAPTERS: { key: string; label: string; line: string; categories: GalleryCategory[]; layout: ChapterLayout }[] = [
  { key: "rooms", label: msg("Rooms & suites"), line: msg("Bright rooms with tall windows, crisp linen and a sofa to unwind on."), categories: ["rooms"], layout: "rail-wide" },
  { key: "bath", label: msg("Bathrooms"), line: msg("Bright, tiled bathrooms — some with a jetted jacuzzi bathtub."), categories: ["bath"], layout: "rail-tall" },
  { key: "arrival", label: msg("Reception & building"), line: msg("Where your stay begins: the building, our reception, the meeting room and the small touches."), categories: ["lobby", "exterior", "amenity"], layout: "mosaic" },
];

/** Lead each chapter with the strongest, most varied frames (near-duplicates fall later). */
const FEATURED = [
  // Rooms & suites: the owner's newest photographs lead, woven with the strongest earlier frames.
  "/images/room-red/room-red-09.webp", "/images/room-red/room-red-08.webp", "/images/room-red/room-red-04.webp", "/images/amenity/amenity-02.webp",
  "/images/room-blue/room-blue-08.webp", "/images/room-red/room-red-10.webp", "/images/room-red/room-red-05.webp", "/images/amenity/amenity-03.webp",
  "/images/room-blue/room-blue-04.webp", "/images/room-red/room-red-07.webp", "/images/amenity/amenity-04.webp", "/images/room-blue/room-blue-06.webp",
  "/images/room-red/room-red-06.webp", "/images/room-blue/room-blue-17.webp", "/images/room-red/room-red-01.webp", "/images/room-blue/room-blue-01.webp",
  "/images/room-blue/room-blue-13.webp", "/images/room-blue/room-blue-15.webp",
  // Bathrooms
  "/images/bath/bath-01.webp", "/images/bath/bath-18.webp", "/images/bath/bath-07.webp", "/images/bath/bath-17.webp", "/images/bath/bath-02.webp",
  "/images/bath/bath-08.webp", "/images/bath/bath-19.webp", "/images/bath/bath-05.webp", "/images/bath/bath-03.webp", "/images/bath/bath-14.webp",
  "/images/bath/bath-16.webp", "/images/bath/bath-09.webp", "/images/bath/bath-04.webp",
  // Reception & building: the façade leads, then the meeting room, reception and balconies.
  "/images/exterior/exterior-03.webp", "/images/meeting/meeting-01.webp", "/images/lobby/lobby-02.webp", "/images/exterior/exterior-04.webp",
  "/images/lobby/lobby-01.webp", "/images/exterior/exterior-01.webp", "/images/amenity/amenity-01.webp", "/images/exterior/exterior-02.webp",
  "/images/lobby/lobby-03.webp",
];
const rank = (src: string) => {
  const i = FEATURED.indexOf(src);
  return i === -1 ? 999 : i;
};
const photo = ({ src, alt, width, height }: GalleryImage) => ({ src, alt, width, height });
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The hotel in pictures — real photographs only (the media library never sends stock here), as one
 * immersive dark space: the photo opening · a contact-sheet index of the chapters · Rooms & suites
 * (a large opening frame, then a landscape rail) · Bathrooms (portrait rail) · Reception & building
 * (mosaic) · Book your stay. Below the hero everything sits in ONE night band with its atmosphere
 * (light, blueprint line work recurring down the page), so the chapters flow without seams.
 * Phones swipe; every photo opens the full-screen viewer.
 */
export default async function GalleryPage({ params }: PageProps<"/[lang]/gallery">) {
  await pageLocale(params);
  const t = await getT();
  const [c, meeting] = await Promise.all([getSiteContent(), publicMeetingRoom()]);
  const p = c.pages.gallery;
  // The Meeting Room's own photographs join "Reception & building" — only the hotel's files in
  // /images/meeting/ (a library upload could be stock; the gallery shows the hotel alone).
  const meetingPhotos: GalleryImage[] = (meeting ? parseImages(meeting.images) : [])
    .filter((src) => src.startsWith("/images/meeting/") && !c.gallery.some((g) => g.src === src))
    .map((src) => {
      const g = registered(src);
      // The site content's own photos already carry the visitor's language; these come from the photo library.
      const alt = g.alt === "Vegas Luxury Hotel"
        ? t("{name} at Vegas Luxury Hotel", { name: meeting?.name != null ? t(meeting.name) : t("Meeting Room") })
        : t.locale === "zh-CN" ? altZh(g.alt) : g.alt;
      return { ...g, alt, category: "amenity" };
    });
  const gallery: GalleryImage[] = [...c.gallery, ...meetingPhotos];
  const chapters = CHAPTERS.map((ch) => ({
    ...ch,
    label: t(ch.label),
    line: t(ch.line),
    all: gallery.filter((i) => ch.categories.includes(i.category)).sort((a, b) => rank(a.src) - rank(b.src)),
  })).filter((ch) => ch.all.length > 0);
  const count = chapters.reduce((sum, ch) => sum + ch.all.length, 0);

  return (
    <>
      <PageHero
        kicker={p.kicker}
        title={p.title}
        image={p.image.src}
        imageAlt={p.image.alt}
        intro={<p>{p.intro}</p>}
        focal="50% 45%"
        id="gallery-title"
        meta={count > 0 ? <>{t("{n} photographs", { n: count })} · {HOTEL_COORDS.label}</> : undefined}
      />

      <div data-tone="night" className="relative isolate overflow-x-clip bg-night text-pub-fg">
        <Atmosphere tone="night" stars />

        {/* Chapter index: a contact sheet — where each set of photographs is, and how many. */}
        {chapters.length > 1 && (
          <nav aria-label={t("Gallery chapters")} className={cn(containers.wide, "pt-10 sm:pt-14 lg:pt-16")}>
            <ul className="grid gap-px border-y border-pub-line" style={{ gridTemplateColumns: `repeat(${chapters.length}, minmax(0, 1fr))` }}>
              {chapters.map((ch, i) => (
                <li key={ch.key} className={cn("min-w-0", i > 0 && "border-l border-pub-line")}>
                  <a
                    href={`#chapter-${ch.key}`}
                    className={cn(
                      "group relative flex h-full flex-col gap-3 px-2 py-4 transition-colors duration-200 sm:flex-row sm:items-center sm:gap-5 sm:px-5 sm:py-5 motion-reduce:transition-none",
                      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold",
                      "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:origin-left before:scale-x-0 before:bg-gold before:shadow-[0_0_14px_rgb(227_189_106/0.7)] before:transition-transform before:duration-300 before:ease-pub hover:before:scale-x-100 motion-reduce:before:transition-none",
                    )}
                  >
                    <span className="relative block aspect-[3/2] w-full shrink-0 overflow-hidden bg-[#1c1712] sm:w-28 lg:w-36">
                      <Image
                        src={ch.all[0].src}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 144px, (min-width: 640px) 112px, 33vw"
                        {...blurFor(ch.all[0].src)}
                        className="object-cover opacity-80 grayscale-[35%] transition duration-500 ease-pub group-hover:scale-105 group-hover:opacity-100 group-hover:grayscale-0 motion-reduce:transition-none"
                      />
                      <span aria-hidden="true" className={fx.corners} />
                    </span>
                    <span className="min-w-0 text-center sm:text-left">
                      <span aria-hidden="true" className="block font-mono text-[10px] tracking-[0.18em] text-pub-eyebrow">{pad(i + 1)}</span>
                      <span className="mt-1.5 block font-display text-[1.0625rem] leading-tight text-pub-fg transition-colors duration-200 group-hover:text-gold sm:text-[1.375rem] lg:text-[1.625rem] motion-reduce:transition-none">
                        {ch.label}
                      </span>
                      <span className={cn(typeScale.meta, "mt-1 block text-pub-muted")}>
                        {t.plural(ch.all.length, "{n} photo", "{n} photos")}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {chapters.map((ch, i) => (
          <GalleryChapter key={ch.key} id={ch.key} index={i} total={chapters.length} title={ch.label} line={ch.line} images={ch.all.map(photo)} layout={ch.layout} />
        ))}

        <section aria-labelledby="gallery-close-title" className="relative pb-20 pt-8 sm:pb-28 lg:pb-36">
          {/* A warm horizon of light under the closing line (static). */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[80%] bg-[radial-gradient(60%_70%_at_50%_100%,oklch(0.75_0.13_78/0.16),transparent_72%)]" />
          <Reveal className={cn(containers.default, "flex flex-col items-center text-center")}>
            <span aria-hidden="true" className="mb-10 h-px w-full max-w-3xl bg-linear-to-r from-transparent via-gold/50 to-transparent sm:mb-14" />
            {count > 0 && <HudLabel>{t("{n} photographs · all of our hotel", { n: count })}</HudLabel>}
            <Heading id="gallery-close-title" className={cn("max-w-3xl", count > 0 && "mt-6")}>
              {t.rich("Seen enough? <accent>Your room is waiting.</accent>", { accent: (chunks) => <Accent>{chunks}</Accent> })}
            </Heading>
            <Actions align="center" className={rhythm.beforeActions}>
              <LinkButton href="/book" icon="arrow">
                {t("Book your stay")}
              </LinkButton>
              <TextLink href="/rooms">{t("Explore the rooms")}</TextLink>
            </Actions>
          </Reveal>
        </section>
      </div>
    </>
  );
}
