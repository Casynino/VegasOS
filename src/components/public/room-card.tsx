import { ViewTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Baby, User } from "lucide-react";
import { formatTZS } from "@/lib/format";
import { blurFor } from "./blur-data";
import { NamedIcon } from "./icon";
import { ArrowBadge } from "./pill-link";

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
}

/** Photo + dark panel room card with gold price pill (whole card is one link). */
export function RoomCard({ room, headingLevel = 3 }: { room: RoomCardData; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const discounted = room.net < room.baseRate;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl bg-[#1f1a14] text-white ring-1 ring-white/10 transition-[box-shadow,transform] duration-500 hover:-translate-y-1 hover:shadow-[0_30px_70px_-30px_oklch(0.72_0.12_80/0.55)] hover:ring-gold/50 motion-reduce:hover:translate-y-0">
      <div className="relative aspect-[4/3] overflow-hidden">
        {room.image && (
          <ViewTransition name={`room-${room.slug}`} share="vlh-morph" default="none">
            <Image
              src={room.image}
              alt=""
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 85vw"
              {...blurFor(room.image)}
              className="object-cover transition-transform duration-[1.2s] ease-out motion-safe:group-hover:scale-110"
            />
          </ViewTransition>
        )}
        <div className="absolute inset-0 bg-linear-to-t from-[#1f1a14] via-transparent to-transparent" aria-hidden="true" />
        {room.promo && discounted && (
          <p className="absolute right-4 top-4 rounded-full bg-gold px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#15120e]">{room.promo}</p>
        )}
        <p className="absolute left-4 top-4 rounded-full border border-gold/40 bg-[#15120e]/70 px-3.5 py-1.5 text-xs text-white backdrop-blur-md">
          <span className="text-white/70">From </span>
          <span className="font-semibold text-gold">{formatTZS(room.net)}</span>
          <span className="text-white/70"> / night</span>
          {discounted && (
            <>
              {" "}<s className="text-white/50"><span className="sr-only">instead of </span>{formatTZS(room.baseRate)}</s>
            </>
          )}
        </p>
      </div>
      <div className="flex flex-1 flex-col px-6 pb-6 pt-2 sm:px-7">
        <div className="flex items-start justify-between gap-4">
          <H className="font-display text-3xl font-medium leading-tight">
            <Link href={`/rooms/${room.slug}`} className="rounded-sm after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-gold">
              {room.name}
            </Link>
          </H>
          <ArrowBadge tone="gold" className="mt-1" />
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/60">
          <span className="inline-flex items-center gap-1.5"><User className="size-4" aria-hidden="true" />Up to {room.maxAdults} adult{room.maxAdults === 1 ? "" : "s"}</span>
          {room.maxChildren > 0 && (
            <span className="inline-flex items-center gap-1.5"><Baby className="size-4" aria-hidden="true" />{room.maxChildren} child{room.maxChildren === 1 ? "" : "ren"}</span>
          )}
        </p>
        {room.shortDescription && <p className="mt-4 text-[15px] leading-relaxed text-white/70">{room.shortDescription}</p>}
        {room.amenities.length > 0 && (
          <ul className="mt-auto flex flex-wrap gap-2 pt-6 text-xs text-white/70" aria-label={`${room.name} amenities`}>
            {room.amenities.slice(0, 4).map((a) => (
              <li key={a.code} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5">
                <NamedIcon name={a.icon} className="size-3.5 text-gold" />
                {a.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
