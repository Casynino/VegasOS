"use client";

import { BedDouble, CalendarDays, Clock, DoorOpen, Ruler, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { NamedIcon } from "@/components/public/icon";
import type { QrRoomType } from "@/server/services/hotel-qr";
import { Amenities, card, caps, darkButton, Gallery, lightButton, StepHeader, StepLayout } from "./ui";
import { FreeTonight } from "./landing";
import { dayShort, guestsText, holdsText, nightsText, nightsOf, tzs, type StayQuery } from "./lib";

/** What every step gets from the app: the hotel, its phone, the side card (computers) and the hotel's times. */
export type Shell = { hotel: string; phone: string | null; aside: React.ReactNode; times: { checkIn: string; checkOut: string } };

/** "1 king bed · 28 m²" — what the type has, when the hotel filled it in. */
export const bedAndSize = (t: { bedType: string | null; sizeSqm: number | null }) => [t.bedType, t.sizeSqm ? `${t.sizeSqm} m²` : null].filter(Boolean).join(" · ");

function Price({ t }: { t: QrRoomType }) {
  return (
    <div className="min-w-0 leading-tight">
      <p className="text-[11px] text-(--vr-muted)">from</p>
      <p className="text-[18px] font-semibold tabular-nums">{tzs(t.fromPerNight)}<span className="text-[12.5px] font-normal text-(--vr-muted)"> / night</span></p>
      {t.fromPerNight < t.baseRate && (
        <p className="mt-0.5 text-[11.5px] text-(--vr-gold-ink)"><s className="text-(--vr-muted)">{tzs(t.baseRate)}</s>{t.promoLabel ? ` · ${t.promoLabel}` : t.promotion ? ` · ${t.promotion}` : ""}</p>
      )}
    </div>
  );
}

/**
 * EXPLORE ROOMS — every room type the hotel sells online, from the system (never typed in here): its photos to swipe,
 * a line about it, what it has, who it takes and tonight's price. "View room" opens it; "Select" goes on to the dates
 * (or straight to the free rooms of that type when the dates are already chosen).
 */
export function RoomsView({ shell, types, imagesOf, stay, onBack, onView, onSelect, onCheck }: {
  shell: Shell; types: QrRoomType[]; imagesOf: (t: { images: string[] }) => string[]; stay: StayQuery | null;
  onBack: () => void; onView: (slug: string) => void; onSelect: (slug: string) => void; onCheck: () => void;
}) {
  return (
    <StepLayout hotel={shell.hotel} phone={shell.phone} aside={shell.aside}
      header={<StepHeader title="Our rooms" sub={stay ? `${dayShort(stay.checkIn)} → ${dayShort(stay.checkOut)} · ${guestsText(stay.adults, stay.children)}` : "Tonight’s prices · choose dates to see what is free"} onBack={onBack} />}
      cta={{ label: stay ? "See free rooms" : "Check availability", onClick: onCheck, icon: <CalendarDays className="size-4 shrink-0 text-(--vr-gold)" /> }}>
      {types.length === 0 ? (
        <p className={cn(card, "mt-4 px-5 py-10 text-center text-[14px] text-(--vr-muted)")}>Our rooms are not listed online right now — please call reception to book.</p>
      ) : (
        <ul className="mt-3 grid gap-3.5 lg:grid-cols-2 lg:gap-5">
          {types.map((t, i) => (
            <li key={t.slug} className={cn(card, "overflow-hidden motion-safe:animate-[vlh-fade_0.5s_ease-out_both]")} style={{ animationDelay: `${Math.min(i, 5) * 60}ms` }}>
              <Gallery images={imagesOf(t)} alt={t.name} sizes="(min-width:1024px) 380px, (min-width:640px) 576px, 100vw" eager={i === 0} round="rounded-none" className="aspect-[16/10]" />
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 font-display text-[22px] font-semibold leading-tight">{t.name}</h2>
                  <FreeTonight n={t.freeTonight} className="mt-1" />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-(--vr-muted)">
                  <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{holdsText(t)}</span>
                  {bedAndSize(t) && <span className="inline-flex items-center gap-1"><BedDouble className="size-3.5" />{bedAndSize(t)}</span>}
                </p>
                {t.shortDescription && <p className="mt-2 line-clamp-2 text-[13.5px] leading-snug text-(--vr-ink)/75">{t.shortDescription}</p>}
                <Amenities list={t.amenities} max={3} className="mt-3" />
                <div className="mt-3.5 flex flex-wrap items-end justify-between gap-3 border-t border-(--vr-line) pt-3.5">
                  <Price t={t} />
                  <div className="grid w-full grid-cols-2 gap-2 min-[400px]:w-auto">
                    <button type="button" onClick={() => onView(t.slug)} className={cn(lightButton, "h-10 px-4 text-[13px]")}>View room</button>
                    <button type="button" onClick={() => onSelect(t.slug)} className={cn(darkButton, "h-10 px-5 text-[13px]")}>Select</button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </StepLayout>
  );
}

/** VIEW ROOM — one room type up close: big photos, what it is and has, who it takes, the times; then the dates. */
export function TypeView({ shell, t, images, stay, onBack, onCheck }: {
  shell: Shell; t: QrRoomType; images: string[]; stay: StayQuery | null; onBack: () => void; onCheck: () => void;
}) {
  return (
    <StepLayout hotel={shell.hotel} phone={shell.phone} aside={shell.aside}
      header={<StepHeader title={t.name} sub={holdsText(t)} onBack={onBack} />}
      cta={{ label: stay ? "See free rooms" : "Check availability", onClick: onCheck, amount: { label: "from / night", value: tzs(t.fromPerNight) }, icon: <CalendarDays className="size-4 shrink-0 text-(--vr-gold)" /> }}>
      <Gallery images={images} alt={t.name} sizes="(min-width:1024px) 680px, 100vw" eager className="-mx-4 mt-1 aspect-[4/3] sm:mx-0 lg:aspect-[16/10]" round="rounded-none sm:rounded-3xl" />
      <div className="mt-4 flex items-start justify-between gap-3">
        <Price t={t} />
        <FreeTonight n={t.freeTonight} className="mt-1" />
      </div>
      {(t.description || t.shortDescription) && <p className="mt-3 whitespace-pre-line text-[14.5px] leading-relaxed text-(--vr-ink)/80">{t.description || t.shortDescription}</p>}

      <dl className="mt-4 grid grid-cols-2 gap-2">
        <Fact icon={Users} label="Guests" value={holdsText(t)} />
        {t.bedType && <Fact icon={BedDouble} label="Bed" value={t.bedType} />}
        {t.sizeSqm ? <Fact icon={Ruler} label="Size" value={`${t.sizeSqm} m²`} /> : null}
        {stay && <Fact icon={CalendarDays} label="Your dates" value={`${dayShort(stay.checkIn)} → ${dayShort(stay.checkOut)} · ${nightsText(nightsOf(stay))}`} />}
      </dl>

      {t.amenities.length > 0 && (
        <section className="mt-5">
          <h2 className={caps}>In the room</h2>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            {t.amenities.map((a) => <li key={a.code} className="flex items-center gap-2 text-[13.5px]"><NamedIcon name={a.icon} className="size-4 shrink-0 text-(--vr-gold-ink)" />{a.name}</li>)}
          </ul>
        </section>
      )}
      <dl className="mt-5 grid grid-cols-2 gap-2">
        <Fact icon={Clock} label="Check-in" value={`from ${shell.times.checkIn}`} />
        <Fact icon={DoorOpen} label="Check-out" value={`by ${shell.times.checkOut}`} />
      </dl>
    </StepLayout>
  );
}

export function Fact({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-(--vr-card) px-3 py-2.5 ring-1 ring-(--vr-line)">
      <dt className={cn(caps, "flex items-center gap-1.5")}><Icon className="size-3.5 text-(--vr-gold-ink)" />{label}</dt>
      <dd className="mt-1 text-[13.5px] font-semibold leading-snug">{value}</dd>
    </div>
  );
}
