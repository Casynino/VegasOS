"use client";

import { useState } from "react";
import { BedDouble, CalendarDays, ChevronDown, Phone, RotateCcw, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QrRoomOffer, QrSearchResult } from "@/server/services/hotel-qr";
import { Amenities, card, darkButton, Gallery, lightButton, Problem, Skeleton, StepHeader, StepLayout } from "./ui";
import { bedAndSize, type Shell } from "./rooms";
import { dayShort, guestsText, holdsText, nightsText, nightsOf, plural, telHref, tzs, type StayQuery } from "./lib";

const FIRST = 4;
export const floorText = (f: number | null) => (f === null ? null : f === 0 ? "Ground floor" : `Floor ${f}`);

/** The stay being searched, with "Edit" (opens the dates sheet again). */
export function StayBar({ stay, onEdit, className }: { stay: StayQuery; onEdit: () => void; className?: string }) {
  return (
    <div className={cn(card, "flex items-center gap-3 rounded-2xl px-3 py-2.5", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><CalendarDays className="size-4" /></span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[14px] font-semibold">{dayShort(stay.checkIn)} → {dayShort(stay.checkOut)}</p>
        <p className="mt-0.5 truncate text-[12px] text-(--vr-muted)">{nightsText(nightsOf(stay))} · {guestsText(stay.adults, stay.children)}</p>
      </div>
      <button type="button" onClick={onEdit} className="h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold text-(--vr-gold-ink) ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold)">Edit</button>
    </div>
  );
}

/**
 * AVAILABLE ROOMS — only rooms the server found free for these dates (bookings, holds, guests in house, maintenance and
 * out-of-service rooms are already left out), each priced for the whole stay by the hotel's pricing. Grouped by type,
 * cheapest first. A chosen type that cannot take the party (or is full) never ends here: every other room that fits is
 * shown, with one short line why. "Nothing free" only when nothing fits these dates: other dates or a call.
 */
export function ResultsView({ shell, stay, typeFilter, state, imagesOf, onBack, onEdit, onClearType, onSelect, onRetry }: {
  shell: Shell; stay: StayQuery | null; typeFilter: { slug: string; name: string } | null;
  state: { loading: boolean; result: QrSearchResult | null; error: string | null };
  imagesOf: (t: { images: string[] }) => string[];
  onBack: () => void; onEdit: () => void; onClearType: () => void; onSelect: (o: QrRoomOffer) => void; onRetry: () => void;
}) {
  const r = state.result;
  const free = r ? r.types.reduce((t, x) => t + x.available, 0) : 0;
  const people = stay ? stay.adults + stay.children : 0;
  // The chosen type has nothing for this party: the other rooms that fit are shown instead (said in one line).
  const other = r?.chosen && r.chosen.state !== "ok" ? r.chosen : null;
  return (
    <StepLayout hotel={shell.hotel} phone={shell.phone} aside={shell.aside} cta={null}
      header={<StepHeader title="Available rooms" sub={state.loading ? "Checking what is free…" : r ? (free ? `${plural(free, "room")} free for your stay` : "Nothing free for these dates") : "Your dates"} onBack={onBack} step={1} />}>
      {stay ? <StayBar stay={stay} onEdit={onEdit} className="mt-1" /> : (
        <Problem title="Choose your dates" text="Choose your dates and we'll show you the free rooms.">
          <button type="button" onClick={onEdit} className={cn(darkButton, "h-11 px-5 text-[14px]")}><CalendarDays className="size-4 text-(--vr-gold)" />Choose dates</button>
        </Problem>
      )}
      {typeFilter && !other && (
        <button type="button" onClick={onClearType} className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-full bg-(--vr-gold-soft) pl-3 pr-2 text-[12.5px] font-medium text-(--vr-ink) ring-1 ring-(--vr-gold)/40">
          {typeFilter.name} only<X className="size-3.5 text-(--vr-gold-ink)" /><span className="sr-only">— show every room type</span>
        </button>
      )}

      {stay && state.loading && <ResultsSkeleton />}

      {stay && !state.loading && state.error && (
        <Problem title="We could not check the rooms" text={state.error}>
          <button type="button" onClick={onRetry} className={cn(darkButton, "h-11 px-5 text-[14px]")}><RotateCcw className="size-4 text-(--vr-gold)" />Try again</button>
          {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />Call reception</a>}
        </Problem>
      )}

      {/* Truly nothing that fits these dates (every type was checked): other dates, fewer guests per room, or a call. */}
      {stay && !state.loading && r && r.types.length === 0 && (
        <Problem title={r.tooSmall.length ? `No room takes ${plural(people, "guest")}` : "No rooms free for these dates"}
          text={r.tooSmall.length
            ? "We have rooms free, but none takes everyone in one room. Change the number of guests, or call us and we'll book more than one room for you."
            : "Every room is taken for this stay. Try other dates — or call reception, rooms do free up."}>
          <button type="button" onClick={onEdit} className={cn(darkButton, "h-11 px-5 text-[14px]")}>
            {r.tooSmall.length ? <Users className="size-4 text-(--vr-gold)" /> : <CalendarDays className="size-4 text-(--vr-gold)" />}{r.tooSmall.length ? "Change guests" : "Try other dates"}
          </button>
          {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />Call reception</a>}
        </Problem>
      )}

      {stay && !state.loading && r && r.types.length > 0 && other && (
        <p className="mt-2.5 flex items-start gap-2 rounded-2xl bg-(--vr-gold-soft) px-3.5 py-3 text-[12.5px] leading-snug text-(--vr-ink)/85" role="status">
          <Users className="mt-px size-4 shrink-0 text-(--vr-gold-ink)" />
          <span>{other.state === "too_small"
            ? `A ${other.name} takes ${holdsText(other).toLowerCase()} — here are the rooms free for ${plural(people, "guest")}.`
            : `No ${other.name} is free for these dates — here are the other free rooms.`}</span>
        </p>
      )}

      {stay && !state.loading && r && r.types.length > 0 && (
        <div className="mt-3 space-y-3.5">
          {r.types.map((g, i) => <TypeGroup key={g.type.slug} g={g} images={imagesOf(g.type)} nights={r.stay.nights} first={i === 0} onSelect={onSelect} />)}
          {r.tooSmall.length > 0 && (
            <p className="flex items-start gap-2 rounded-2xl bg-(--vr-gold-soft) px-3.5 py-3 text-[12.5px] leading-snug text-(--vr-ink)/85">
              <Users className="mt-px size-4 shrink-0 text-(--vr-gold-ink)" />
              <span>{r.tooSmall.map((t) => t.name).join(", ")} {r.tooSmall.length === 1 ? "is" : "are"} free too, but take{r.tooSmall.length === 1 ? "s" : ""} fewer guests. Booking for a group? Call us and we’ll book the rooms.</span>
            </p>
          )}
        </div>
      )}
    </StepLayout>
  );
}

function TypeGroup({ g, images, nights, first, onSelect }: {
  g: QrSearchResult["types"][number]; images: string[]; nights: number; first: boolean; onSelect: (o: QrRoomOffer) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? g.rooms : g.rooms.slice(0, FIRST);
  const t = g.type;
  return (
    <section aria-label={t.name} className={cn(card, "overflow-hidden motion-safe:animate-[vlh-fade_0.45s_ease-out_both]")}>
      <div className="sm:flex">
        <Gallery images={images} alt={t.name} sizes="(min-width:640px) 240px, 100vw" eager={first} round="rounded-none" className="aspect-[16/9] sm:aspect-auto sm:min-h-[170px] sm:w-[240px] sm:shrink-0" />
        <div className="min-w-0 p-4 sm:flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="min-w-0 font-display text-[22px] font-semibold leading-tight">{t.name}</h2>
            <span className="shrink-0 text-[11.5px] font-medium text-emerald-700">{g.available} free</span>
          </div>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[12.5px] text-(--vr-muted)">
            <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{holdsText(t)}</span>
            {bedAndSize(t) && <span className="inline-flex items-center gap-1"><BedDouble className="size-3.5" />{bedAndSize(t)}</span>}
          </p>
          <Amenities list={t.amenities} max={3} className="mt-2.5" />
          <p className="mt-2.5 text-[12.5px] text-(--vr-muted)">from <strong className="font-semibold tabular-nums text-(--vr-ink)">{tzs(g.fromPerNight)}</strong> / night</p>
        </div>
      </div>
      <ul className="divide-y divide-(--vr-line) border-t border-(--vr-line)">
        {shown.map((o) => (
          <li key={o.number} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 font-display text-[20px] font-semibold leading-none">
                Room {o.number}{floorText(o.floor) && <span className="ml-2 font-sans text-[12px] font-normal text-(--vr-muted)">{floorText(o.floor)}</span>}
              </p>
              <p className="shrink-0 text-[13px] tabular-nums"><strong className="font-semibold">{tzs(o.perNight)}</strong><span className="text-(--vr-muted)"> / night</span></p>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="min-w-0 text-[12.5px] leading-snug text-(--vr-muted)">
                {nightsText(nights)}: <strong className="font-semibold tabular-nums text-(--vr-ink)">{tzs(o.total)}</strong>
                {o.discount > 0 && <span className="block text-(--vr-gold-ink)">{o.promotion ?? "Offer"} · you save {tzs(o.discount)}</span>}
              </p>
              <button type="button" onClick={() => onSelect(o)} className={cn(darkButton, "h-10 shrink-0 px-4 text-[13px]")}>Select room</button>
            </div>
          </li>
        ))}
      </ul>
      {g.rooms.length > FIRST && !all && (
        <button type="button" onClick={() => setAll(true)} className="flex h-11 w-full items-center justify-center gap-1.5 border-t border-(--vr-line) text-[13px] font-medium text-(--vr-gold-ink) hover:bg-(--vr-bg)">
          Show {plural(g.rooms.length - FIRST, "more room")}<ChevronDown className="size-4" />
        </button>
      )}
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <div className="mt-3 space-y-3.5" aria-busy="true" aria-label="Checking what is free">
      {[0, 1].map((k) => (
        <div key={k} className={cn(card, "overflow-hidden")}>
          <div className="sm:flex">
            <Skeleton className="aspect-[16/9] rounded-none sm:aspect-auto sm:h-[170px] sm:w-[240px]" />
            <div className="space-y-2.5 p-4 sm:flex-1">
              <Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-56" /><Skeleton className="h-7 w-64" />
            </div>
          </div>
          {[0, 1].map((j) => (
            <div key={j} className="flex items-center justify-between gap-3 border-t border-(--vr-line) px-4 py-3.5">
              <div className="space-y-2"><Skeleton className="h-5 w-24" /><Skeleton className="h-4 w-36" /></div>
              <Skeleton className="h-10 w-28 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
