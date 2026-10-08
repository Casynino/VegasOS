import { ViewTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";
import { GlassPanel, HudLabel, InfoList, LinkButton, MediaFrame, PriceTag, Rail, TextLink, typeScale } from "../kit";
import { RoomCard, roomFacts, type RoomCardData } from "../room-card";
import css from "./home.module.css";

export interface ShowcaseRoom extends RoomCardData {
  /** Rooms of this type still free tonight (live), or null when online booking is off. */
  tonightFree: number | null;
}

/** "Available tonight" / "2 left tonight" — live, and only when there is something to say. */
function tonightLabel(free: number | null, t: T) {
  if (!free) return null;
  return free <= 3 ? t("{n} left tonight", { n: free }) : t("Available tonight");
}

function Tonight({ free, t, className }: { free: number | null; t: T; className?: string }) {
  const label = tonightLabel(free, t);
  if (!label) return null;
  return (
    <p className={cn(typeScale.meta, "flex items-center gap-2 text-pub-muted", className)}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
      {label}
    </p>
  );
}

/** The pricing engine's promotion label ("10% off", "TZS 20,000 off") in the visitor's words; anything else as given. */
function promoText(label: string, t: T) {
  const pct = /^(\d+(?:\.\d+)?)% off$/.exec(label);
  if (pct) return t("{value}% off", { value: pct[1] });
  const tzs = /^TZS ([\d,]+) off$/.exec(label);
  if (tzs) return t("TZS {amount} off", { amount: tzs[1] });
  return t(label);
}

const pad = (n: number) => String(n).padStart(2, "0");
const nameLink =
  "rounded-sm transition-colors duration-200 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-reduce:transition-none";

/**
 * The home page's room showcase. The lead room type is a wide photograph that drifts with the
 * scroll, with its spec sheet floating over it in smoked glass (desktop): "Room type 01 / 05",
 * the live "Available tonight", name, one line, facts, price, Book this room / Explore room.
 * Phones keep the photo clear: the name and price sit on its foot, the rest follows below.
 * The other types follow in a swipe rail. Room types only — the booking engine assigns the
 * room. The lead photo and each tile share the `room-{slug}` view transition with the room page,
 * so every slug appears once here.
 */
export async function RoomsShowcase({ rooms }: { rooms: ShowcaseRoom[] }) {
  const [featured, ...others] = rooms;
  if (!featured) return null;
  const t = await getT();
  const name = t(featured.name);
  const shortDescription = featured.shortDescription ? t(featured.shortDescription) : null;
  const href = `/rooms/${featured.slug}`;
  const discounted = featured.net < featured.baseRate;
  const index = t("Room type {n} / {total}", { n: pad(1), total: pad(rooms.length) });
  const tonight = tonightLabel(featured.tonightFree, t);
  const price = (size: "md" | "lg") => (
    <PriceTag
      amount={featured.net}
      from
      size={size}
      was={discounted ? featured.baseRate : null}
      note={discounted && featured.promo ? <span className="text-pub-eyebrow">{promoText(featured.promo, t)}</span> : undefined}
    />
  );
  const actions = (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
      <LinkButton href={`/book?type=${featured.slug}`} icon="arrow">
        {t("Book this room")}
      </LinkButton>
      <TextLink href={href}>
        {t("Explore room")}
        <span className="sr-only">{t(": {name}", { name })}</span>
      </TextLink>
    </div>
  );

  return (
    <>
      <div className="relative">
        <div className="relative">
          {/* The photo repeats the name link for pointer users only (one link per room for keyboards). */}
          <Link href={href} tabIndex={-1} aria-hidden="true" className="group block">
            {featured.image ? (
              <ViewTransition name={`room-${featured.slug}`} share="vlh-morph" default="none">
                <MediaFrame
                  src={featured.image}
                  alt={t("{name} at Vegas Luxury Hotel", { name })}
                  ratio="1/1"
                  ratioSm="3/2"
                  ratioLg="16/9"
                  focal="40% 50%"
                  sizes="(min-width: 1280px) 1216px, 100vw"
                  parallax={6}
                />
              </ViewTransition>
            ) : (
              <div className="aspect-square bg-pub-fg/[0.06] sm:aspect-[3/2] lg:aspect-[16/9]" />
            )}
          </Link>
          <div aria-hidden="true" className={css.specShade} />

          {/* Phones and tablets: index, name and price on the photo's foot. */}
          <div data-tone="night" className="pointer-events-none absolute inset-x-0 bottom-0 p-4 text-pub-fg sm:p-6 lg:hidden">
            <HudLabel className="text-white/75">{index}</HudLabel>
            <h3 className={cn(typeScale.feature, "pointer-events-auto mt-3")}>
              <Link href={href} className={nameLink}>
                {name}
              </Link>
            </h3>
            <div className="mt-3">{price("md")}</div>
          </div>

          {/* Desktop: the spec sheet floats over the photograph in smoked glass. */}
          <GlassPanel
            hud
            spotlight
            className="absolute right-8 top-1/2 hidden w-[25rem] -translate-y-1/2 lg:block xl:right-14 xl:w-[27rem]"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
              <HudLabel>{index}</HudLabel>
              {tonight && (
                <HudLabel live tick={false} className="text-pub-fg">
                  {tonight}
                </HudLabel>
              )}
            </div>
            <h3 className={cn(typeScale.feature, "mt-5")}>
              <Link href={href} className={nameLink}>
                {name}
              </Link>
            </h3>
            {shortDescription && <p className={cn(typeScale.small, "mt-3 line-clamp-2 text-pub-muted")}>{shortDescription}</p>}
            <InfoList items={roomFacts(featured, t)} className="mt-4" />
            <div className="mt-5 border-t border-pub-line pt-5">{price("lg")}</div>
            <div className="mt-6">{actions}</div>
          </GlassPanel>

          <span aria-hidden="true" className="pub-hud-corners" style={{ "--hud-o": "0.625rem", "--hud-l": "1.25rem" } as React.CSSProperties} />
        </div>

        {/* Phones and tablets: the rest of the spec sheet under the photo. */}
        <div className="mt-6 lg:hidden">
          {tonight && (
            <HudLabel live tick={false} className="text-pub-fg">
              {tonight}
            </HudLabel>
          )}
          {shortDescription && <p className={cn(typeScale.body, "mt-3 line-clamp-3 max-w-[34rem] text-pub-muted")}>{shortDescription}</p>}
          <InfoList items={roomFacts(featured, t)} className="mt-3" />
          <div className="mt-6">{actions}</div>
        </div>
      </div>

      {others.length > 0 && (
        <div className="mt-14 sm:mt-16 lg:mt-24">
          <div className="mb-6 flex items-center gap-4 sm:mb-8">
            <p className={cn(typeScale.eyebrow, "shrink-0 text-pub-eyebrow")}>{t("More ways to stay")}</p>
            <span aria-hidden="true" className="h-px flex-1 bg-linear-to-r from-pub-line to-transparent" />
          </div>
          <Rail label={t("Room types")} size="md" desktop={others.length <= 4 ? "grid" : "rail"} cols={others.length >= 4 ? 4 : 3}>
            {others.map((r) => (
              <div key={r.slug} className="flex h-full flex-col">
                <RoomCard room={r} t={t} />
                <Tonight free={r.tonightFree} t={t} className="mt-3" />
              </div>
            ))}
          </Rail>
        </div>
      )}
    </>
  );
}
