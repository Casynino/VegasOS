import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { GalleryRail } from "./cinema/gallery-rail";
import { ROOM_DETAILS, photo } from "./content";
import { ALT_ZH } from "./content.zh-CN";
import { typeScale } from "./kit/tokens";
import { Eyebrow } from "./kit/typography";

/**
 * "In the room" — a swipe rail of the owner's detail photographs (beds, sofa and mirror, desk and
 * kettle, bathrooms) from across the hotel's rooms. They belong to no single room type, so the
 * rail says so. `exclude` drops photos the page already shows. `title` is an English key or already translated.
 */
export async function RoomDetails({
  id,
  title = "In the room",
  exclude = [],
  className,
}: {
  /** id of the rail's heading (aria-labelledby of the surrounding section, if any). */
  id: string;
  title?: string;
  exclude?: string[];
  className?: string;
}) {
  const t = await getT();
  // Photo captions: the site's Chinese photo descriptions (ALT_ZH, keyed by the English alt), else t(), else the English.
  const altOf = (alt: string) => (t.locale === "zh-CN" ? ALT_ZH[alt] ?? t(alt) : t(alt));
  const images = ROOM_DETAILS.filter((src) => !exclude.includes(src)).map((src) => {
    const g = photo(src);
    return { src: g.src, alt: altOf(g.alt), width: g.width, height: g.height };
  });
  if (images.length === 0) return null;
  return (
    <div className={className}>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 lg:mb-8">
        <Eyebrow as="h2" rule>
          <span id={id}>{t(title)}</span>
        </Eyebrow>
        <p className={cn(typeScale.small, "text-pub-muted")}>{t("Photos from across our rooms — fittings vary by room type.")}</p>
      </div>
      <GalleryRail images={images} label={t("Details from our rooms")} />
    </div>
  );
}
