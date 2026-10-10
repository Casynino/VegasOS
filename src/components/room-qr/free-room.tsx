"use client";

import { useState } from "react";
import { useReducedMotion } from "motion/react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { tzs } from "@/components/hotel-qr/lib";
import { goldButton, goldDot, PhotoViewer, RoomCard, sectionTitle } from "./parts";
import { useT } from "@/i18n/client";

/** A room nobody is checked in to, as its card shows it — prepared on the server in the guest's language (the website's own price and photos). */
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
  const t = useT();
  const reduce = useReducedMotion();
  const [viewing, setViewing] = useState<number | null>(null);
  const toMenu = () => document.getElementById("order")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  return (
    <>
      <RoomCard photos={room.photos} title={room.title} onPhotos={setViewing}>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90"><span className="size-1.5 rounded-full bg-emerald-400" />{t("Welcome")}</p>
        <h1 className="mt-2.5 font-display text-[23px] leading-[1.08] lining-nums sm:text-[30px]">
          {room.title}<br /><span className="text-(--vr-gold)">{room.type}</span>
        </h1>
        {room.from !== null && (
          <p className="mt-1.5 text-[12.5px] text-white/80 sm:text-[13.5px]">
            {room.base !== null && room.base > room.from
              ? t.rich("from <s>{base}</s><b>{price}</b> / night", { s: (c) => <s className="mr-1 text-white/45 tabular-nums">{c}</s>, b: (c) => <strong className="font-semibold tabular-nums text-(--vr-gold)">{c}</strong> }, { base: tzs(room.base), price: tzs(room.from) })
              : t.rich("from <b>{price}</b> / night", { b: (c) => <strong className="font-semibold tabular-nums text-(--vr-gold)">{c}</strong> }, { price: tzs(room.from) })}
          </p>
        )}
        {(room.promo || room.facts) && <p className="mt-0.5 text-[11px] leading-snug text-white/55 sm:text-[12px]">{[room.from !== null && room.promo, room.facts].filter(Boolean).join(" · ")}</p>}
        <div className="mt-3">
          {room.book && <a href={room.book.href} className={goldButton}><span className={goldDot}><ArrowRight className="size-3.5" /></span><span className="truncate">{room.book.label}</span></a>}
          <button type="button" onClick={toMenu} className="mt-1 flex min-h-10 items-center gap-1 text-[12px] font-medium text-white/75 transition hover:text-white">
            {t("See the menu")}<ChevronRight className="size-3.5 text-(--vr-gold)" />
          </button>
        </div>
      </RoomCard>
      <PhotoViewer photos={room.photos} start={viewing} title={room.title} onClose={() => setViewing(null)} />

      <div id="order" className="mt-10 scroll-mt-3 lg:mt-14">
        <h2 className={sectionTitle}>{t("Food & drinks")}</h2>
        <p className="mt-1.5 text-[13px] text-(--vr-muted)">{room.menuNote}</p>
      </div>
    </>
  );
}
