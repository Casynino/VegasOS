import { ViewTransition } from "react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { englishT, type T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { InfoList, LinkButton, MediaFrame, PriceTag, TextLink, typeScale } from "./kit";

export interface RoomCardData {
  slug: string;
  name: string;
  shortDescription: string | null;
  image: string | undefined;
  maxAdults: number;
  maxChildren: number;
  baseRate: number;
  net: number;
  /** Promotion label from the pricing engine, e.g. "10% off". */
  promo?: string | null;
  amenities: { code: string; name: string; icon: string | null }[];
  bedType?: string | null;
  sizeSqm?: number | null;
}

/**
 * "Up to 2 adults · 1 child · King bed · 28 m²" — the room's facts, from the database only. Pass the person's
 * translator (`await getT()` / `useT()`); without one it answers in English.
 */
export function roomFacts(room: Pick<RoomCardData, "maxAdults" | "maxChildren" | "bedType" | "sizeSqm">, t: T = englishT) {
  return [
    { label: t.plural(room.maxAdults, "Up to {n} adult", "Up to {n} adults") },
    room.maxChildren > 0 ? { label: t.plural(room.maxChildren, "{n} child", "{n} children") } : null,
    room.bedType ? { label: t(room.bedType) } : null,
    room.sizeSqm ? { label: `${room.sizeSqm} m²` } : null,
  ].filter((f): f is { label: string } => f !== null);
}

/** The pricing engine's promotion label ("10% off", "TZS 20,000 off") in the visitor's words; anything else as given. */
export function promoText(label: string, t: T = englishT) {
  const pct = /^(\d+(?:\.\d+)?)% off$/.exec(label);
  if (pct) return t("{value}% off", { value: pct[1] });
  const tzs = /^TZS ([\d,]+) off$/.exec(label);
  if (tzs) return t("TZS {amount} off", { amount: tzs[1] });
  return t(label);
}

/**
 * A room type, experience first and details second. The photo shares the ViewTransition
 * `room-{slug}` with the room page's hero, so render one RoomCard per slug on a page.
 * - "tile" (default): the photo, then name, facts and price — for rails and grids.
 * - "row": the editorial row of the rooms page — a large photo beside the name, one line,
 *   facts, price and two actions. Alternate `reverse` between rows (desktop).
 * Rendered by server pages and by client components alike, so it takes the person's translator as `t`
 * (`await getT()` / `useT()`); without one it is English.
 */
export function RoomCard({
  room,
  headingLevel = 3,
  variant = "tile",
  reverse = false,
  sizes,
  t = englishT,
}: {
  room: RoomCardData;
  headingLevel?: 2 | 3;
  variant?: "tile" | "row";
  reverse?: boolean;
  /** next/image sizes for the photo (the defaults match the rails and the rooms list). */
  sizes?: string;
  /** The person's translator. */
  t?: T;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const href = `/rooms/${room.slug}`;
  const discounted = room.net < room.baseRate;
  const facts = roomFacts(room, t);
  const name = t(room.name);

  const photo = (ratio: string, ratioLg: string | undefined, fallbackSizes: string) =>
    room.image ? (
      <ViewTransition name={`room-${room.slug}`} share="vlh-morph" default="none">
        <MediaFrame src={room.image} alt={t("{name} at Vegas Luxury Hotel", { name })} ratio={ratio} ratioLg={ratioLg} sizes={sizes ?? fallbackSizes} zoom />
      </ViewTransition>
    ) : (
      <div style={{ aspectRatio: ratio }} className="bg-pub-fg/[0.06]" aria-hidden="true" />
    );

  if (variant === "row") {
    return (
      <article className="group grid gap-5 sm:gap-8 lg:grid-cols-12 lg:items-center lg:gap-x-10">
        {/* The photo repeats the name link for pointer users only (one link per room for keyboards). */}
        <Link
          href={href}
          tabIndex={-1}
          aria-hidden="true"
          className={cn("block min-w-0 lg:col-span-7 lg:row-start-1", reverse ? "lg:col-start-6" : "lg:col-start-1")}
        >
          {photo("3/2", undefined, "(min-width: 1024px) 56vw, 100vw")}
        </Link>
        <div className={cn("min-w-0 lg:col-span-4 lg:row-start-1", reverse ? "lg:col-start-1" : "lg:col-start-9")}>
          {/* A room name is an item, not a section: the scale's featured-item size. */}
          <H className={typeScale.feature}>
            <Link
              href={href}
              className="rounded-sm transition-colors duration-200 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-reduce:transition-none"
            >
              {name}
            </Link>
          </H>
          {room.shortDescription && <p className={cn(typeScale.body, "mt-2.5 max-w-[34rem] text-pub-muted sm:mt-3")}>{t(room.shortDescription)}</p>}
          <InfoList items={facts} className="mt-3.5 sm:mt-4" />
          <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-t border-pub-line pt-4 sm:mt-6 sm:pt-5 lg:block">
            <PriceTag
              amount={room.net}
              from
              was={discounted ? room.baseRate : null}
              note={discounted && room.promo ? <span className="text-pub-eyebrow">{promoText(room.promo, t)}</span> : undefined}
            />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:mt-6">
              <LinkButton href={`/book?type=${room.slug}`} variant="secondary" size="sm">
                {t("Book this room")}
              </LinkButton>
              <TextLink href={href}>
                {t("Explore room")}<span className="sr-only">{t(": {name}", { name })}</span>
              </TextLink>
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="group relative flex h-full flex-col">
      {photo("4/5", undefined, "(min-width: 1024px) 30vw, (min-width: 640px) 44vw, 76vw")}
      <div className="flex flex-1 flex-col pt-5">
        <H className={typeScale.subheading}>
          {/* The name is the tile's one link; it stretches over the whole tile. */}
          <Link
            href={href}
            className="rounded-sm transition-colors duration-200 after:absolute after:inset-0 hover:text-pub-eyebrow focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-gold motion-reduce:transition-none"
          >
            {name}
          </Link>
        </H>
        <InfoList items={facts.slice(0, 3)} className="mt-2.5" />
        <PriceTag amount={room.net} from was={discounted ? room.baseRate : null} size="sm" className="mt-auto pt-4" />
        {/* Say the tile opens the room (the whole tile is the link). */}
        <span aria-hidden="true" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-pub-eyebrow transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none">
          {t("View room")}<ArrowRight className="size-3.5" strokeWidth={1.8} />
        </span>
      </div>
    </article>
  );
}
