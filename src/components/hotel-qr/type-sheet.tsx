"use client";

import { useState } from "react";
import { ArrowRight, BedDouble, Images, Ruler, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { NamedIcon } from "@/components/public/icon";
import type { QrRoomTypeInfo } from "@/server/services/hotel-qr";
import { caps, darkButton, Photo, Sheet } from "./ui";
import { usePhotoViewer } from "./viewer";
import { holdsText, nightsText, tzs } from "./lib";

/** The price the sheet shows: per night (and the normal price when an offer lowers it), and the stay's total once dates are chosen. */
export type SheetPrice = { perNight: number; base?: number | null; offer?: string | null; total?: number | null; nights?: number | null; from?: boolean };

/**
 * A ROOM TYPE UP CLOSE — opens only when the guest taps a room's photo or "Details": its photos (tap one to see them
 * full screen), who it takes, the bed and size when the hotel filled them in, a few lines about it, what is in the
 * room, and the price — with the same Book button as the card it came from.
 */
export function TypeSheet({ open, onClose, t, images, price, free, cta }: {
  open: boolean; onClose: () => void; t: QrRoomTypeInfo | null; images: string[]; price: SheetPrice | null;
  /** "3 free tonight" / "3 free for your dates" — or nothing. */
  free?: string | null;
  cta: { label: string; onClick: () => void } | null;
}) {
  const view = usePhotoViewer();
  const [more, setMore] = useState(false);
  const about = t ? t.description || t.shortDescription : null;
  const photos = t ? images.map((src, k) => ({ src, alt: k === 0 ? t.name : `${t.name} — photo ${k + 1}`, label: t.name })) : [];
  return (
    <Sheet open={open && !!t} onClose={onClose} label={t?.name ?? "Room"} wide
      footer={t && cta ? (
        <div className="flex items-center gap-3">
          {price && (
            <div className="min-w-0 shrink-0 leading-tight">
              <p className="text-[11px] text-(--vr-muted)">{price.total && price.nights ? `${nightsText(price.nights)}` : price.from ? "from / night" : "per night"}</p>
              <p className="text-[16px] font-semibold tabular-nums">{tzs(price.total && price.nights ? price.total : price.perNight)}</p>
            </div>
          )}
          <button type="button" onClick={cta.onClick} className={cn(darkButton, "h-12 flex-1 text-[15px]")}>{cta.label}<ArrowRight className="size-4 text-(--vr-gold)" /></button>
        </div>
      ) : null}>
      {t && (
        <>
          {/* The photos: a swipe on phones, two at a time on computers; tap to see them big. */}
          <div className="flex snap-x snap-mandatory gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {photos.map((p, k) => (
              <button key={`${p.src}-${k}`} type="button" onClick={() => view(photos, k)} aria-label={`See ${p.alt} full screen`}
                className={cn("relative aspect-[4/3] shrink-0 snap-start overflow-hidden bg-(--vr-line)", photos.length > 1 ? "w-[88%] sm:w-[70%]" : "w-full")}>
                <Photo src={p.src} alt={p.alt} sizes="(min-width:640px) 440px, 88vw" eager={k === 0} />
              </button>
            ))}
          </div>
          <div className="px-5 pb-6 pt-4 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="min-w-0 font-display text-[28px] font-semibold leading-[1.05]">{t.name}</h2>
              {photos.length > 1 && (
                <button type="button" onClick={() => view(photos, 0)} className="mt-1 inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-(--vr-gold-ink) hover:underline">
                  <Images className="size-4" />{photos.length} photos
                </button>
              )}
            </div>
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-(--vr-muted)">
              <span className="inline-flex items-center gap-1.5"><Users className="size-3.5 text-(--vr-gold-ink)" />{holdsText(t)}</span>
              {t.bedType && <span className="inline-flex items-center gap-1.5"><BedDouble className="size-3.5 text-(--vr-gold-ink)" />{t.bedType}</span>}
              {t.sizeSqm ? <span className="inline-flex items-center gap-1.5"><Ruler className="size-3.5 text-(--vr-gold-ink)" />{t.sizeSqm} m²</span> : null}
            </p>
            {price && (
              <p className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 tabular-nums">
                <span className="whitespace-nowrap">
                  {price.from && <span className="text-[12.5px] text-(--vr-muted)">from </span>}
                  <strong className="text-[19px] font-semibold">{tzs(price.perNight)}</strong><span className="text-[13px] text-(--vr-muted)"> / night</span>
                </span>
                {(price.base && price.base > price.perNight) || price.offer ? (
                  <span className="whitespace-nowrap text-[12.5px]">
                    {price.base && price.base > price.perNight && <s className="text-(--vr-muted)">{tzs(price.base)}</s>}
                    {price.offer && <span className="ml-1.5 font-medium text-(--vr-gold-ink)">{price.offer}</span>}
                  </span>
                ) : null}
              </p>
            )}
            {free && <p className="mt-1 text-[12.5px] font-medium text-emerald-700">{free}</p>}
            {about && (
              <div className="mt-4">
                <p className={cn("whitespace-pre-line text-[14px] leading-relaxed text-(--vr-ink)/80", !more && "line-clamp-4")}>{about}</p>
                {about.length > 220 && <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 text-[12.5px] font-medium text-(--vr-gold-ink)">{more ? "Show less" : "Read more"}</button>}
              </div>
            )}
            {t.amenities.length > 0 && (
              <section className="mt-5">
                <h3 className={caps}>In the room</h3>
                <ul className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {t.amenities.map((a) => <li key={a.code} className="flex items-center gap-2 text-[13.5px]"><NamedIcon name={a.icon} className="size-4 shrink-0 text-(--vr-gold-ink)" />{a.name}</li>)}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
