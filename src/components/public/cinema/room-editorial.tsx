"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Baby, User } from "lucide-react";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { blurFor } from "../blur-data";
import { NamedIcon } from "../icon";

export interface EditorialRoom {
  slug: string;
  name: string;
  summary: string | null;
  images: string[];
  maxAdults: number;
  maxChildren: number;
  baseRate: number;
  net: number;
  amenities: { code: string; name: string; icon: string | null }[];
}

const EASE = [0.22, 1, 0.36, 1] as const;

function Meta({ r }: { r: EditorialRoom }) {
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white/65">
      <span className="inline-flex items-center gap-1.5"><User className="size-4 text-gold" aria-hidden="true" />Up to {r.maxAdults} adult{r.maxAdults === 1 ? "" : "s"}</span>
      {r.maxChildren > 0 && <span className="inline-flex items-center gap-1.5"><Baby className="size-4 text-gold" aria-hidden="true" />{r.maxChildren} child{r.maxChildren === 1 ? "" : "ren"}</span>}
      <span>Breakfast &amp; Wi-Fi included</span>
    </p>
  );
}

function Price({ r, large }: { r: EditorialRoom; large?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.28em] text-white/50">From / night</p>
      <p className={cn("font-display font-medium text-gold", large ? "text-5xl" : "text-3xl")}>{formatTZS(r.net)}</p>
      {r.net < r.baseRate && <p className="text-sm text-white/45"><s><span className="sr-only">instead of </span>{formatTZS(r.baseRate)}</s> · website rate</p>}
    </div>
  );
}

function Ctas({ r }: { r: EditorialRoom }) {
  return (
    <div className="flex flex-wrap items-center gap-5">
      <Link href={`/book?type=${r.slug}`} className="group inline-flex h-12 items-center gap-3 rounded-full bg-gold px-6 text-sm font-semibold uppercase tracking-[0.14em] text-[#15120e] transition-all hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
        Book this room <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </Link>
      <Link href={`/rooms/${r.slug}`} className="group relative text-sm uppercase tracking-[0.18em] text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
        Room details
        <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-50 bg-gold transition-transform duration-500 group-hover:scale-x-100" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * Editorial room showcase. Desktop: one room at a time on a large stage —
 * photo left with a slow drift, story right, "Room 01" index, and a rail of
 * the other rooms. Phones: a calm vertical sequence of room stories.
 */
export function RoomEditorial({ rooms }: { rooms: EditorialRoom[] }) {
  const [i, setI] = useState(0);
  const r = rooms[i];
  if (!r) return null;
  const go = (d: number) => setI((x) => (x + d + rooms.length) % rooms.length);

  return (
    <>
      {/* Phones & tablets: vertical stories */}
      <ol className="space-y-14 lg:hidden">
        {rooms.map((room, n) => (
          <li key={room.slug}>
            <Link href={`/rooms/${room.slug}`} className="vlh-zoom-frame vlh-clip relative block aspect-[4/3] overflow-hidden rounded-[1.75rem]">
              {room.images[0] && <Image src={room.images[0]} alt={`${room.name} at Vegas Luxury Hotel`} fill sizes="100vw" {...blurFor(room.images[0])} className="vlh-zoom-target object-cover" />}
              <span className="absolute inset-0 bg-linear-to-t from-[#0d0b08]/80 via-transparent to-transparent" aria-hidden="true" />
              <span className="absolute left-5 top-4 font-display text-6xl text-white/80 vlh-outline" aria-hidden="true">{String(n + 1).padStart(2, "0")}</span>
            </Link>
            <div className="relative -mt-10 mx-3 rounded-3xl vlh-glass-dark p-6">
              <p className="text-[10px] uppercase tracking-[0.3em] text-gold">Room {String(n + 1).padStart(2, "0")}</p>
              <h3 className="mt-2 font-display text-3xl">{room.name}</h3>
              {room.summary && <p className="mt-3 text-[15px] leading-relaxed text-white/70">{room.summary}</p>}
              <div className="mt-4"><Meta r={room} /></div>
              <div className="mt-5 flex items-end justify-between gap-4"><Price r={room} /></div>
              <div className="mt-6"><Ctas r={room} /></div>
            </div>
          </li>
        ))}
      </ol>

      {/* Desktop: editorial stage */}
      <div className="hidden lg:block">
        <div className="grid grid-cols-12 items-center gap-0">
          <div className="relative col-span-7 aspect-[5/4] overflow-hidden rounded-[2rem] bg-[#1a1510] shadow-[0_60px_120px_-50px_rgba(0,0,0,0.9)]">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div key={r.slug} className="absolute inset-0"
                initial={{ opacity: 0, clipPath: "inset(0 0 0 100%)" }} animate={{ opacity: 1, clipPath: "inset(0 0 0 0%)" }} exit={{ opacity: 0 }}
                transition={{ duration: 1.1, ease: EASE }}>
                <div className="vlh-kb-a absolute inset-0">
                  {r.images[0] && <Image src={r.images[0]} alt={`${r.name} at Vegas Luxury Hotel`} fill sizes="60vw" {...blurFor(r.images[0])} className="object-cover" />}
                </div>
              </motion.div>
            </AnimatePresence>
            <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-transparent via-transparent to-[#0d0b08]/50" aria-hidden="true" />
            {/* Secondary photo floating over the frame edge */}
            {r.images[1] && (
              <AnimatePresence initial={false} mode="popLayout">
                <motion.div key={`${r.slug}-2`} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.9, delay: 0.25, ease: EASE }}
                  className="absolute bottom-6 left-6 aspect-[4/3] w-[32%] overflow-hidden rounded-2xl border border-white/20 shadow-2xl">
                  <Image src={r.images[1]} alt="" fill sizes="20vw" className="object-cover" />
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          <div className="relative col-span-5 -ml-16 xl:-ml-24">
            <div className="vlh-glass-dark relative rounded-[2rem] p-10 xl:p-12">
              <span className="pointer-events-none absolute -top-16 right-8 font-display text-[9rem] leading-none text-gold/40 vlh-outline" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={r.slug} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.55, ease: EASE }}>
                  <p className="text-[11px] uppercase tracking-[0.32em] text-gold">Room {String(i + 1).padStart(2, "0")} of {String(rooms.length).padStart(2, "0")}</p>
                  <h3 className="mt-3 font-display text-5xl leading-[1.02] xl:text-6xl">{r.name}</h3>
                  {r.summary && <p className="mt-5 text-base leading-relaxed text-white/70">{r.summary}</p>}
                  <div className="mt-5"><Meta r={r} /></div>
                  <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2.5" aria-label={`${r.name} amenities`}>
                    {r.amenities.slice(0, 6).map((a) => (
                      <li key={a.code} className="flex items-center gap-2 text-sm text-white/80"><NamedIcon name={a.icon} className="size-4 shrink-0 text-gold" />{a.name}</li>
                    ))}
                  </ul>
                  <div className="mt-8 flex items-end justify-between gap-6 border-t border-white/10 pt-6"><Price r={r} large /></div>
                  <div className="mt-7"><Ctas r={r} /></div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Rail */}
        <div className="mt-10 flex items-center gap-6">
          <div className="flex gap-2">
            <button type="button" onClick={() => go(-1)} aria-label="Previous room" className="grid size-12 place-items-center rounded-full border border-white/20 text-white transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"><ArrowLeft className="size-5" /></button>
            <button type="button" onClick={() => go(1)} aria-label="Next room" className="grid size-12 place-items-center rounded-full border border-white/20 text-white transition-colors hover:border-gold hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"><ArrowRight className="size-5" /></button>
          </div>
          <ol className="grid flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${rooms.length}, minmax(0, 1fr))` }} aria-label="Room types">
            {rooms.map((room, n) => (
              <li key={room.slug}>
                <button type="button" onClick={() => setI(n)} aria-current={n === i ? "true" : undefined}
                  className="group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                  <span className="relative block h-px w-full bg-white/15">
                    <span className={cn("absolute inset-y-0 left-0 bg-gold transition-all duration-700", n === i ? "w-full" : "w-0 group-hover:w-1/3")} />
                  </span>
                  <span className={cn("mt-3 block text-[11px] tabular-nums tracking-[0.2em]", n === i ? "text-gold" : "text-white/40")}>{String(n + 1).padStart(2, "0")}</span>
                  <span className={cn("block truncate font-display text-xl transition-colors", n === i ? "text-white" : "text-white/50 group-hover:text-white/80")}>{room.name}</span>
                  <span className="block text-xs text-white/40">from {formatTZS(room.net)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
