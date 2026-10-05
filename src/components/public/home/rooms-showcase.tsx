import { ViewTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EditorialSplit, Heading, InfoList, LinkButton, MediaFrame, PriceTag, Rail, TextLink, typeScale } from "../kit";
import { RoomCard, roomFacts, type RoomCardData } from "../room-card";

export interface ShowcaseRoom extends RoomCardData {
  /** Rooms of this type still free tonight (live), or null when online booking is off. */
  tonightFree: number | null;
}

/** "Available tonight" / "2 left tonight" — live, and only when there is something to say. */
function Tonight({ free, className }: { free: number | null; className?: string }) {
  if (!free) return null;
  return (
    <p className={cn(typeScale.meta, "flex items-center gap-2 text-pub-muted", className)}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
      {free <= 3 ? `${free} left tonight` : "Available tonight"}
    </p>
  );
}

/**
 * The home page's curated room showcase: one room type large (photo, name, one line, facts,
 * price, Book this room / Explore room), then the other types in a swipe rail. Room types
 * only — the booking engine assigns the room. The featured photo and each tile share the
 * `room-{slug}` view transition with the room page, so every slug appears once here.
 */
export function RoomsShowcase({ rooms }: { rooms: ShowcaseRoom[] }) {
  const [featured, ...others] = rooms;
  if (!featured) return null;
  const href = `/rooms/${featured.slug}`;
  const discounted = featured.net < featured.baseRate;

  return (
    <>
      <EditorialSplit
        layout="media-wide"
        media={
          // The photo repeats the name link for pointer users only (one link per room for keyboards).
          <Link href={href} tabIndex={-1} aria-hidden="true" className="group block">
            {featured.image ? (
              <ViewTransition name={`room-${featured.slug}`} share="vlh-morph" default="none">
                <MediaFrame src={featured.image} alt={`${featured.name} at Vegas Luxury Hotel`} ratio="3/2" ratioLg="4/3" sizes="(min-width: 1024px) 56vw, 100vw" zoom />
              </ViewTransition>
            ) : (
              <div className="aspect-[3/2] bg-pub-fg/[0.06] lg:aspect-[4/3]" />
            )}
          </Link>
        }
      >
        <Heading as="h3" size="feature">
          <Link
            href={href}
            className="rounded-sm transition-colors duration-200 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-reduce:transition-none"
          >
            {featured.name}
          </Link>
        </Heading>
        {featured.shortDescription && <p className={cn(typeScale.body, "mt-3 line-clamp-3 max-w-[34rem] text-pub-muted")}>{featured.shortDescription}</p>}
        <InfoList items={roomFacts(featured)} className="mt-4" />
        <PriceTag
          amount={featured.net}
          from
          size="lg"
          was={discounted ? featured.baseRate : null}
          note={discounted && featured.promo ? <span className="text-pub-eyebrow">{featured.promo}</span> : undefined}
          className="mt-6 border-t border-pub-line pt-5"
        />
        <Tonight free={featured.tonightFree} className="mt-3" />
        <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3">
          <LinkButton href={`/book?type=${featured.slug}`} icon="arrow">
            Book this room
          </LinkButton>
          <TextLink href={href}>
            Explore room<span className="sr-only">: {featured.name}</span>
          </TextLink>
        </div>
      </EditorialSplit>

      {others.length > 0 && (
        <div className="mt-14 sm:mt-16 lg:mt-24">
          <p className={cn(typeScale.eyebrow, "mb-6 text-pub-eyebrow sm:mb-8")}>More ways to stay</p>
          <Rail label="Room types" size="md" desktop={others.length <= 3 ? "grid" : "rail"} cols={3}>
            {others.map((r) => (
              <div key={r.slug} className="flex h-full flex-col">
                <RoomCard room={r} />
                <Tonight free={r.tonightFree} className="mt-3" />
              </div>
            ))}
          </Rail>
        </div>
      )}
    </>
  );
}
