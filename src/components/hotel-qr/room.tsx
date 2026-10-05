"use client";

import { useState } from "react";
import { BedDouble, CalendarDays, Check, DoorOpen, Moon, Phone, RotateCcw, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { NamedIcon } from "@/components/public/icon";
import type { QrQuote, QrRoomOffer, QrRoomTypeInfo } from "@/server/services/hotel-qr";
import { caps, card, darkButton, Gallery, lightButton, Problem, Skeleton, StepHeader, StepLayout } from "./ui";
import { bedAndSize, Fact, type Shell } from "./rooms";
import { floorText } from "./results";
import { dayWeek, guestsText, holdsText, nightsOf, nightsText, telHref, tzs, type StayQuery } from "./lib";

/** The price for the stay, worked out by the hotel's pricing: per night × nights, any offer, the total. */
export function PriceCard({ q, className }: { q: QrQuote; className?: string }) {
  const n = q.nights.length;
  return (
    <section aria-labelledby="price-title" className={cn(card, "p-4 sm:p-5", className)}>
      <h2 id="price-title" className={caps}>Your price</h2>
      <dl className="mt-2.5 space-y-1.5 text-[13.5px]">
        {q.sameEveryNight ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-(--vr-muted)">{tzs(q.nights[0]?.price ?? q.ratePerNight)} × {nightsText(n)}</dt>
            <dd className="tabular-nums">{tzs(q.gross)}</dd>
          </div>
        ) : q.nights.map((x) => (
          <div key={x.date} className="flex items-baseline justify-between gap-3">
            <dt className="text-(--vr-muted)">{dayWeek(x.date)}{x.datePrice && <span className="text-(--vr-gold-ink)"> · {x.datePrice}</span>}</dt>
            <dd className="tabular-nums">{tzs(x.price)}</dd>
          </div>
        ))}
        {q.discount > 0 && (
          <div className="flex items-baseline justify-between gap-3 text-(--vr-gold-ink)">
            <dt>{q.promotion ?? "Offer"}</dt>
            <dd className="tabular-nums">− {tzs(q.discount)}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-(--vr-line) pt-3 font-semibold">
        Total<span className="text-[19px] tabular-nums">{tzs(q.total)}</span>
      </p>
      <p className="mt-1 text-[11.5px] text-(--vr-muted)">{nightsText(n)} · {guestsText(q.stay.adults, q.stay.children)} · checked again when you book</p>
    </section>
  );
}

/** The hotel's rules in plain words (from its settings). */
export function Policies({ list, className }: { list: string[]; className?: string }) {
  if (!list.length) return null;
  return (
    <section aria-labelledby="rules-title" className={className}>
      <h2 id="rules-title" className={caps}>Good to know</h2>
      <ul className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-(--vr-muted)">
        {list.map((p) => <li key={p} className="flex gap-2"><Check className="mt-px size-3.5 shrink-0 text-(--vr-gold-ink)" strokeWidth={2.5} />{p}</li>)}
      </ul>
    </section>
  );
}

/**
 * THE ROOM — the one the guest picked, checked again on the server (still free, takes the party) and priced for the
 * stay: big photos, the type, what it has, the dates and times, the rules, and the total. "Continue" goes to details.
 */
export function RoomView({ shell, stay, number, offer, type, state, images, onBack, onContinue, onSeeRooms, onRetry }: {
  shell: Shell; stay: StayQuery; number: string; offer: QrRoomOffer | null; type: QrRoomTypeInfo | null;
  state: { loading: boolean; quote: QrQuote | null; error: { message: string; taken: boolean } | null };
  images: string[]; onBack: () => void; onContinue: () => void; onSeeRooms: () => void; onRetry: () => void;
}) {
  const q = state.quote;
  const t = q?.type ?? type;
  const floor = floorText(q?.room.floor ?? offer?.floor ?? null);
  const [more, setMore] = useState(false);
  const about = t?.description || t?.shortDescription || null;
  return (
    <StepLayout hotel={shell.hotel} phone={shell.phone} aside={shell.aside}
      header={<StepHeader title={`Room ${number}`} sub={t?.name ?? "Your room"} onBack={onBack} step={2} />}
      cta={state.error ? null : { label: "Continue", onClick: onContinue, disabled: !q, pending: state.loading, amount: q ? { label: "Total", value: tzs(q.total) } : offer ? { label: "Total", value: tzs(offer.total) } : null }}>
      {state.error ? (
        <Problem title={state.error.taken ? `Room ${number} is no longer free` : "We could not open this room"} text={state.error.message}>
          {state.error.taken
            ? <button type="button" onClick={onSeeRooms} className={cn(darkButton, "h-11 px-5 text-[14px]")}><CalendarDays className="size-4 text-(--vr-gold)" />See free rooms</button>
            : <button type="button" onClick={onRetry} className={cn(darkButton, "h-11 px-5 text-[14px]")}><RotateCcw className="size-4 text-(--vr-gold)" />Try again</button>}
          {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />Call reception</a>}
        </Problem>
      ) : (
        <>
          <Gallery images={images} alt={t ? `${t.name} — Room ${number}` : `Room ${number}`} sizes="(min-width:1024px) 680px, 100vw" eager
            className="-mx-4 mt-1 aspect-[4/3] sm:mx-0 lg:aspect-[16/10]" round="rounded-none sm:rounded-3xl" />

          {/* The room and its type are in the header above: here, what it is like and its price. */}
          <div className="mt-3.5">
            <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-[12.5px] text-(--vr-muted)">
              {floor && <span>{floor}</span>}
              {t && <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{holdsText(t)}</span>}
              {t && bedAndSize(t) && <span className="inline-flex items-center gap-1"><BedDouble className="size-3.5" />{bedAndSize(t)}</span>}
            </p>
            {q ? (
              <p className="mt-2 text-[17px] font-semibold tabular-nums">
                {tzs(q.perNight)}<span className="text-[13px] font-normal text-(--vr-muted)"> / night{q.sameEveryNight ? "" : " on average"}</span>
                {q.discount > 0 && <span className="ml-2 text-[12px] font-medium text-(--vr-gold-ink)">{q.promotion ?? "Offer"} included</span>}
              </p>
            ) : <Skeleton className="mt-2 h-6 w-44" />}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-2">
            <Fact icon={CalendarDays} label="Check-in" value={`${dayWeek(stay.checkIn)} · from ${shell.times.checkIn}`} />
            <Fact icon={DoorOpen} label="Check-out" value={`${dayWeek(stay.checkOut)} · by ${shell.times.checkOut}`} />
            <Fact icon={Moon} label="Nights" value={nightsText(q?.nights.length ?? nightsOf(stay))} />
            <Fact icon={Users} label="Guests" value={guestsText(stay.adults, stay.children)} />
          </dl>

          {about && (
            <div className="mt-4">
              <p className={cn("whitespace-pre-line text-[14px] leading-relaxed text-(--vr-ink)/80", !more && "line-clamp-4")}>{about}</p>
              {about.length > 220 && <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 text-[12.5px] font-medium text-(--vr-gold-ink)">{more ? "Show less" : "Read more"}</button>}
            </div>
          )}

          {t && t.amenities.length > 0 && (
            <section className="mt-5">
              <h2 className={caps}>In the room</h2>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                {t.amenities.map((a) => <li key={a.code} className="flex items-center gap-2 text-[13.5px]"><NamedIcon name={a.icon} className="size-4 shrink-0 text-(--vr-gold-ink)" />{a.name}</li>)}
              </ul>
            </section>
          )}

          {q ? <PriceCard q={q} className="mt-5" /> : (
            <div className={cn(card, "mt-5 space-y-2.5 p-4")} aria-busy="true"><Skeleton className="h-4 w-24" /><Skeleton className="h-5 w-full" /><Skeleton className="h-6 w-full" /></div>
          )}
          {q && <Policies list={q.policies} className="mt-5" />}
        </>
      )}
    </StepLayout>
  );
}
