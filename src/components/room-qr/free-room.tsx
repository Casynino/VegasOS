"use client";

import { useState } from "react";
import { useReducedMotion } from "motion/react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { tzs } from "@/components/hotel-qr/lib";
import { goldButton, goldDot, PhotoViewer, RoomCard, sectionTitle } from "./parts";

/** A room nobody is checked in to, as its card shows it — prepared on the server (the website's own price and photos). */
export type FreeRoom = {
  /** "Room 101", "Meeting room 102". */
  title: string;
  /** "Double Deluxe" (the type), or a line about the meeting room. */
  type: string;
  photos: string[];
  /** Tonight's website price per night, and the normal price when a promotion lowers it. */
  from: number | null; base: number | null; promo: string | null;
  /** "Up to 2 adults · 1 child · 25 m²". */
  facts: string | null;
  book: { label: string; href: string } | null;
  /** The menu below: who can order and how. */
  menuNote: string;
};

/**
 * THE ROOM'S CARD when nobody is staying in it (a free room, or a booked guest who has not checked in yet): the room
 * itself in the Hotel QR app's look — its photos, its type, tonight's price, who it holds, "Book a room like this" (the
 * website's page of the room type) — and "See the menu" to eat at the restaurant or take out, right below.
 */
export function FreeRoomTop({ room }: { room: FreeRoom }) {
  const reduce = useReducedMotion();
  const [viewing, setViewing] = useState<number | null>(null);
  const toMenu = () => document.getElementById("order")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  return (
    <>
      <RoomCard photos={room.photos} title={room.title} onPhotos={setViewing}>
        <h1 className="font-display text-[34px] font-semibold leading-[1.02] tracking-tight lining-nums sm:text-[40px] lg:text-[50px]">
          {room.title}<br /><span className="text-(--vr-gold)">{room.type}</span>
        </h1>
        {room.from !== null && (
          <p className="mt-3 text-[15px] text-white/80 lg:mt-4 lg:text-[16px]">
            from {room.base !== null && room.base > room.from && <s className="mr-1 text-white/45 tabular-nums">{tzs(room.base)}</s>}
            <strong className="font-semibold tabular-nums text-(--vr-gold)">{tzs(room.from)}</strong> / night
          </p>
        )}
        {(room.promo || room.facts) && <p className="mt-1 text-[12.5px] leading-relaxed text-white/55 lg:text-[13px]">{[room.from !== null && room.promo, room.facts].filter(Boolean).join(" · ")}</p>}
        <div className="mt-5 max-w-sm">
          {room.book && <a href={room.book.href} className={goldButton}>{room.book.label}<span className={goldDot}><ArrowRight className="size-4" /></span></a>}
          <button type="button" onClick={toMenu} className="mt-2 inline-flex min-h-11 items-center gap-1.5 px-1 text-[13.5px] font-medium text-white/80 transition hover:text-white">
            See the menu<span className="text-white/50">· eat here or take out</span><ChevronRight className="size-4 text-(--vr-gold)" />
          </button>
        </div>
      </RoomCard>
      <PhotoViewer photos={room.photos} start={viewing} title={room.title} onClose={() => setViewing(null)} />

      <div id="order" className="mt-10 scroll-mt-3 lg:mt-14">
        <h2 className={sectionTitle}>Food & drinks</h2>
        <p className="mt-1.5 text-[13px] text-(--vr-muted)">{room.menuNote}</p>
      </div>
    </>
  );
}
