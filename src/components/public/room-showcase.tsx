"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Baby, User } from "lucide-react";
import { useT } from "@/i18n/client";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { blurFor } from "./blur-data";
import { NamedIcon } from "./icon";
import { LinkButton, TextLink } from "./kit/button";
import { RoomCard, type RoomCardData } from "./room-card";

/**
 * Featured rooms. Desktop: an editorial index of room types beside a large
 * image stage that changes on hover/focus. Phones & tablets: a swipeable row
 * of room cards.
 */
export function RoomShowcase({ rooms }: { rooms: (RoomCardData & { description: string | null })[] }) {
  const t = useT();
  const [active, setActive] = useState(0);
  const room = rooms[active];
  if (!room) return null;
  const name = t(room.name);
  const about = room.shortDescription ?? room.description;
  return (
    <>
      {/* Phones / tablets */}
      <ul className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:hidden" aria-label={t("Room types")}>
        {rooms.map((r) => (
          <li key={r.slug} className="w-[84%] shrink-0 snap-start sm:w-[46%]">
            <RoomCard room={r} t={t} />
          </li>
        ))}
      </ul>

      {/* Desktop */}
      <div className="hidden gap-10 lg:grid lg:grid-cols-[0.9fr_1.5fr] xl:gap-14">
        <ol className="flex flex-col justify-center" aria-label={t("Room types")}>
          {rooms.map((r, i) => (
            <li key={r.slug} className="border-b border-white/10 first:border-t">
              <Link
                href={`/rooms/${r.slug}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                aria-current={i === active ? "true" : undefined}
                className="group flex items-center gap-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <span className={cn("text-xs tabular-nums transition-colors", i === active ? "text-gold" : "text-white/40")}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1">
                  <span className={cn("block font-display text-[2rem] leading-none transition-all duration-500", i === active ? "translate-x-2 italic text-gold" : "text-white/85 group-hover:text-white")}>
                    {t(r.name)}
                  </span>
                  <span className="mt-2 block text-sm text-white/55">
                    {t("From {price} / night", { price: formatTZS(r.net) })} · {t.plural(r.maxAdults, "up to {n} adult", "up to {n} adults")}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn("h-px bg-gold transition-all duration-500", i === active ? "w-12 opacity-100" : "w-0 opacity-0")}
                />
              </Link>
            </li>
          ))}
        </ol>

        <div className="relative aspect-[5/4] overflow-hidden rounded-[2rem] bg-[#1f1a14] ring-1 ring-white/10">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={room.slug}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            >
              {room.image && (
                <Image src={room.image} alt={t("{name} at Vegas Luxury Hotel", { name })} fill sizes="60vw" {...blurFor(room.image)} className="object-cover" />
              )}
            </motion.div>
          </AnimatePresence>
          <div className="absolute inset-0 bg-linear-to-t from-[#15120e] via-[#15120e]/30 to-transparent" aria-hidden="true" />
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={room.slug}
              className="absolute inset-x-0 bottom-0 p-8 xl:p-10"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex items-end justify-between gap-6">
                <div className="max-w-md">
                  <p className="flex items-center gap-4 text-sm text-white/70">
                    <span className="inline-flex items-center gap-1.5"><User className="size-4" aria-hidden="true" />{t.plural(room.maxAdults, "Up to {n} adult", "Up to {n} adults")}</span>
                    {room.maxChildren > 0 && (
                      <span className="inline-flex items-center gap-1.5"><Baby className="size-4" aria-hidden="true" />{t.plural(room.maxChildren, "{n} child", "{n} children")}</span>
                    )}
                  </p>
                  <p className="mt-3 text-pretty text-[15px] leading-relaxed text-white/80">{about ? t(about) : about}</p>
                  <ul className="mt-4 flex flex-wrap gap-2" aria-label={t("{name} amenities", { name })}>
                    {room.amenities.slice(0, 5).map((a) => (
                      <li key={a.code} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#15120e]/40 px-3 py-1.5 text-xs text-white/85 backdrop-blur-md">
                        <NamedIcon name={a.icon} className="size-3.5 text-gold" />
                        {t(a.name)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-white/60">{t("From / night")}</p>
                  <p className="font-display text-4xl font-semibold text-gold">{formatTZS(room.net)}</p>
                  {room.net < room.baseRate && (
                    <p className="text-sm text-white/50"><s><span className="sr-only">{t("instead of")} </span>{formatTZS(room.baseRate)}</s></p>
                  )}
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <LinkButton href={`/book?type=${room.slug}`} icon="arrow">{t("Book this room")}</LinkButton>
                <TextLink href={`/rooms/${room.slug}`}>{t("View details")}</TextLink>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
