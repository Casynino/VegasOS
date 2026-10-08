import { ViewTransition } from "react";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { GlassPanel, HudFrame, HudLabel, LinkButton, MediaFrame, PriceTag, Section, TextLink, typeScale } from "./kit";
import { promoText, type RoomCardData } from "./room-card";
import fx from "./room-fx.module.css";

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** "Up to 2 adults · 1 child" — from the database only. Pass the person's translator (English without one). */
export function guestsLine(room: Pick<RoomCardData, "maxAdults" | "maxChildren">, t: T = englishT) {
  const adults = t.plural(room.maxAdults, "Up to {n} adult", "Up to {n} adults");
  return room.maxChildren > 0 ? `${adults} · ${t.plural(room.maxChildren, "{n} child", "{n} children")}` : adults;
}

/** "Breakfast · Wi-Fi" when the room type has them. */
export function includesLine(amenities: { code: string }[], t: T = englishT) {
  const codes = new Set(amenities.map((a) => a.code));
  return [codes.has("BREAKFAST") && t("Breakfast"), codes.has("WIFI") && "Wi-Fi"].filter(Boolean).join(" · ");
}

/**
 * One room type on /rooms as a chapter of its own band: a big parallax photograph in a HUD
 * frame, a glass spec panel floating over its edge (guests · bed · size · what's included ·
 * tonight's website price), the outline index numeral, the name, one line and two actions.
 * Chapters alternate tone and side; render them as siblings so the bands dissolve into each
 * other. The photo carries the ViewTransition `room-{slug}` (it morphs into the room page hero).
 */
export async function RoomChapter({
  room,
  index,
  total,
  tone,
  reverse = false,
}: {
  room: RoomCardData;
  /** 1-based position in the list. */
  index: number;
  total: number;
  tone: "night" | "paper";
  reverse?: boolean;
}) {
  const t = await getT();
  const href = `/rooms/${room.slug}`;
  const titleId = `${room.slug}-title`;
  const discounted = room.net < room.baseRate;
  const name = t(room.name);
  const includes = includesLine(room.amenities, t);
  const facts: ({ term: string; value: string } | null)[] = [
    { term: msg("Guests"), value: guestsLine(room, t) },
    room.bedType ? { term: msg("Bed"), value: t(room.bedType) } : null,
    room.sizeSqm ? { term: msg("Size"), value: `${room.sizeSqm} m²` } : null,
    includes ? { term: msg("Includes"), value: includes } : null,
  ];
  const spec = facts.filter((s): s is { term: string; value: string } => s !== null);

  return (
    <Section id={`type-${room.slug}`} tone={tone} space="md" width="wide" labelledBy={titleId} beam={index % 2 === 1} className="py-12 sm:py-20 lg:py-28">
      <article className="grid gap-y-7 sm:gap-y-9 lg:grid-cols-12 lg:grid-rows-[1fr_1fr] lg:gap-x-10 lg:gap-y-0">
        {/* Index: the outline numeral and the HUD count. */}
        <div
          className={cn(
            "flex min-w-0 items-end justify-between gap-6 lg:row-start-1 lg:block lg:self-end lg:pb-8",
            reverse ? "lg:col-span-4 lg:col-start-1" : "lg:col-span-4 lg:col-start-9",
          )}
        >
          <span aria-hidden="true" className={cn(fx.numeral, "block font-display text-[5.25rem] font-medium leading-[0.78] sm:text-[6.5rem] lg:text-[clamp(7rem,3.4rem+5.4vw,10.5rem)]")}>
            {pad2(index)}
          </span>
          <HudLabel className="pb-1.5 lg:mt-7 lg:pb-0">
            {t("Room type {n} / {total}", { n: pad2(index), total: pad2(total) })}
          </HudLabel>
        </div>

        {/* The photograph (a pointer shortcut to the room; the name is the one link for keyboards) and its spec panel. */}
        <div className={cn("relative min-w-0 lg:col-span-7 lg:row-span-2 lg:row-start-1", reverse ? "lg:col-start-6" : "lg:col-start-1")}>
          <HudFrame offset="sm">
            <Link href={href} tabIndex={-1} aria-hidden="true" className="group block">
              {room.image ? (
                <ViewTransition name={`room-${room.slug}`} share="vlh-morph" default="none">
                  <MediaFrame
                    src={room.image}
                    alt={t("{name} at Vegas Luxury Hotel", { name })}
                    ratio="4/3"
                    ratioSm="3/2"
                    ratioLg="3/2"
                    sizes="(min-width: 1024px) 54vw, 100vw"
                    parallax={6}
                    reveal={reverse ? "left" : "right"}
                    zoom
                  />
                </ViewTransition>
              ) : (
                <div className="aspect-[4/3] bg-pub-fg/[0.06] sm:aspect-[3/2]" />
              )}
            </Link>
          </HudFrame>
          <GlassPanel
            variant={tone === "night" ? "dense" : "paper"}
            padding="sm"
            spotlight
            className={cn(
              "relative z-10 mx-3 -mt-8 sm:mx-auto sm:-mt-20 sm:w-[23rem] lg:absolute lg:-bottom-12 lg:mt-0 lg:w-[20rem] xl:w-[21.5rem]",
              reverse ? "sm:mr-6 lg:-left-10 lg:mr-0 xl:-left-14" : "sm:ml-6 lg:-right-10 lg:ml-0 xl:-right-14",
            )}
          >
            <div className="flex items-center justify-between gap-4">
              <HudLabel>{t("Specification")}</HudLabel>
              <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.2em] text-pub-muted sm:text-[11px]">
                {pad2(index)}/{pad2(total)}
              </span>
            </div>
            <dl className="mt-3.5 space-y-2 text-[13px] leading-snug sm:text-[13.5px]">
              {spec.map((s) => (
                <div key={s.term} className="flex min-w-0 items-baseline gap-3">
                  <dt className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.16em] text-pub-muted">{t(s.term)}</dt>
                  <span aria-hidden="true" className="min-w-3 flex-1 translate-y-[-3px] border-b border-dotted border-pub-line" />
                  <dd className="min-w-0 text-right text-pub-fg">{s.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3.5 border-t border-pub-line pt-3.5">
              <PriceTag
                amount={room.net}
                from
                was={discounted ? room.baseRate : null}
                note={discounted && room.promo ? <span className="text-pub-eyebrow">{t("{promo} · website rate", { promo: promoText(room.promo, t) })}</span> : undefined}
              />
            </div>
          </GlassPanel>
        </div>

        {/* Name, one line, actions. */}
        <div className={cn("min-w-0 lg:row-start-2 lg:self-start lg:pt-2", reverse ? "lg:col-span-4 lg:col-start-1" : "lg:col-span-4 lg:col-start-9")}>
          <h2 id={titleId} className={typeScale.heading}>
            <Link
              href={href}
              className="rounded-sm transition-colors duration-200 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-reduce:transition-none"
            >
              {name}
            </Link>
          </h2>
          {room.shortDescription && <p className={cn(typeScale.body, "mt-3 max-w-[30rem] text-pub-muted sm:mt-4")}>{t(room.shortDescription)}</p>}
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-7 sm:gap-x-7">
            <LinkButton href={`/book?type=${room.slug}`} variant="secondary" size="sm">
              {t("Book this room")}<span className="sr-only">{t(": {name}", { name })}</span>
            </LinkButton>
            <TextLink href={href}>
              {t("Explore room")}<span className="sr-only">{t(": {name}", { name })}</span>
            </TextLink>
          </div>
        </div>
      </article>
    </Section>
  );
}
