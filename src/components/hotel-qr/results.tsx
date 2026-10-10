"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, Images, Phone, RotateCcw, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QrRoomOffer, QrSearchResult } from "@/server/services/hotel-qr";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";
import { card, darkButton, lightButton, Photo, Problem, Skeleton, StepHeader, StepLayout } from "./ui";
import { datesText, guestsText, holdsText, nightsText, nightsOf, telHref, tzs, type StayQuery } from "./lib";

/** What every step gets from the app: the hotel, its phone, the side card (computers) and the hotel's times. */
export type Shell = { hotel: string; phone: string | null; aside: React.ReactNode; times: { checkIn: string; checkOut: string } };
export type TypeGroup = QrSearchResult["types"][number];

export const floorText = (f: number | null, t: T) => (f === null ? null : f === 0 ? t("Ground floor") : t("Floor {floor}", { floor: f }));
/** The room "Book" takes: the lowest price for the stay (the server's order breaks a tie). */
export const bestOffer = (rooms: QrRoomOffer[]) => rooms.reduce((a, b) => (b.total < a.total ? b : a), rooms[0]);

/** The stay being searched, with "Change" (opens the dates sheet again). */
export function StayBar({ stay, onEdit, className }: { stay: StayQuery; onEdit: () => void; className?: string }) {
  const t = useT();
  return (
    <button type="button" onClick={onEdit} className={cn(card, "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:ring-(--vr-gold)", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><CalendarDays className="size-4" /></span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[14.5px] font-semibold">{datesText(stay, t)}</span>
        <span className="mt-0.5 block truncate text-[12px] text-(--vr-muted)">{nightsText(nightsOf(stay), t)} · {guestsText(stay.adults, stay.children, t)}</span>
      </span>
      <span className="shrink-0 px-1.5 text-[12.5px] font-semibold text-(--vr-gold-ink)">{t("Change")}</span>
    </button>
  );
}

/**
 * 2. CHOOSE YOUR ROOM — only rooms the server found free for these dates (bookings, holds, guests in house,
 * maintenance and out-of-service rooms are already left out), priced for the whole stay by the hotel's pricing, a
 * card per room type, cheapest first. One tap on "Book" goes straight to the last step with the best-priced room of
 * that type; the photo or "Details" opens the room type; "Choose your room" lists the room numbers for those who mind.
 * A chosen type that cannot take the party (or is full) never ends here: every other room that fits is shown.
 */
export function ResultsView({ shell, stay, typeFilter, state, imagesOf, onBack, onEdit, onClearType, onBook, onDetails, onRetry }: {
  shell: Shell; stay: StayQuery | null; typeFilter: { slug: string; name: string } | null;
  state: { loading: boolean; result: QrSearchResult | null; error: string | null };
  imagesOf: (t: { images: string[] }) => string[];
  onBack: () => void; onEdit: () => void; onClearType: () => void; onBook: (o: QrRoomOffer) => void; onDetails: (g: TypeGroup) => void; onRetry: () => void;
}) {
  const t = useT();
  const r = state.result;
  const free = r ? r.types.reduce((sum, x) => sum + x.available, 0) : 0;
  const people = stay ? stay.adults + stay.children : 0;
  // The chosen type has nothing for this party: the other rooms that fit are shown instead (said in one line).
  const other = r?.chosen && r.chosen.state !== "ok" ? r.chosen : null;
  return (
    <StepLayout hotel={shell.hotel} phone={shell.phone} aside={shell.aside} cta={null}
      header={<StepHeader title={t("Choose your room")} sub={state.loading ? t("Checking what is free…") : r ? (free ? t.plural(free, "{n} room free for your stay", "{n} rooms free for your stay") : t("Nothing free for these dates")) : t("Your dates")} onBack={onBack} step={2} />}>
      {stay ? <StayBar stay={stay} onEdit={onEdit} className="mt-1" /> : (
        <Problem title={t("Choose your dates")} text={t("Choose your dates and we'll show you the free rooms.")}>
          <button type="button" onClick={onEdit} className={cn(darkButton, "h-11 px-5 text-[14px]")}><CalendarDays className="size-4 text-(--vr-gold)" />{t("Choose dates")}</button>
        </Problem>
      )}
      {typeFilter && !other && r && r.types.length > 0 && (
        <p className="mt-3 flex items-center justify-between gap-3 px-1 text-[12.5px] text-(--vr-muted)">
          <span className="min-w-0 truncate">{t("Showing {name}", { name: t(typeFilter.name) })}</span>
          <button type="button" onClick={onClearType} className="shrink-0 font-semibold text-(--vr-gold-ink) hover:underline">{t("See all rooms")}</button>
        </p>
      )}

      {stay && state.loading && <ResultsSkeleton />}

      {stay && !state.loading && state.error && (
        <Problem title={t("We could not check the rooms")} text={t(state.error)}>
          <button type="button" onClick={onRetry} className={cn(darkButton, "h-11 px-5 text-[14px]")}><RotateCcw className="size-4 text-(--vr-gold)" />{t("Try again")}</button>
          {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />{t("Call reception")}</a>}
        </Problem>
      )}

      {/* Truly nothing that fits these dates (every type was checked): other dates, fewer guests per room, or a call. */}
      {stay && !state.loading && r && r.types.length === 0 && (
        <Problem title={r.tooSmall.length ? t.plural(people, "No room takes {n} guest", "No room takes {n} guests") : t("No rooms free for these dates")}
          text={r.tooSmall.length
            ? t("We have rooms free, but none takes everyone in one room. Change the number of guests, or call us and we'll book more than one room for you.")
            : t("Every room is taken for this stay. Try other dates — or call reception, rooms do free up.")}>
          <button type="button" onClick={onEdit} className={cn(darkButton, "h-11 px-5 text-[14px]")}>
            {r.tooSmall.length ? <Users className="size-4 text-(--vr-gold)" /> : <CalendarDays className="size-4 text-(--vr-gold)" />}{r.tooSmall.length ? t("Change guests") : t("Try other dates")}
          </button>
          {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />{t("Call reception")}</a>}
        </Problem>
      )}

      {stay && !state.loading && r && r.types.length > 0 && other && (
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-(--vr-gold-soft) px-3.5 py-3 text-[12.5px] leading-snug text-(--vr-ink)/85" role="status">
          <Users className="mt-px size-4 shrink-0 text-(--vr-gold-ink)" />
          <span>{other.state === "too_small"
            ? t("A {name} takes {holds} — here are the rooms free for {guests}.", { name: t(other.name), holds: holdsText(other, t).toLowerCase(), guests: t.plural(people, "{n} guest", "{n} guests") })
            : t("No {name} is free for these dates — here are the other free rooms.", { name: t(other.name) })}</span>
        </p>
      )}

      {stay && !state.loading && r && r.types.length > 0 && (
        <div className="mt-3.5 space-y-4">
          {r.types.map((g, i) => <TypeOffer key={g.type.slug} g={g} images={imagesOf(g.type)} nights={r.stay.nights} first={i === 0} onBook={onBook} onDetails={() => onDetails(g)} />)}
          {r.tooSmall.length > 0 && (
            <p className="flex items-start gap-2 rounded-2xl bg-(--vr-gold-soft) px-3.5 py-3 text-[12.5px] leading-snug text-(--vr-ink)/85">
              <Users className="mt-px size-4 shrink-0 text-(--vr-gold-ink)" />
              <span>{r.tooSmall.length === 1
                ? t("{names} is free too, but takes fewer guests. Booking for a group? Call us and we’ll book the rooms.", { names: t(r.tooSmall[0].name) })
                : t("{names} are free too, but take fewer guests. Booking for a group? Call us and we’ll book the rooms.", { names: r.tooSmall.map((x) => t(x.name)).join(t.locale === DEFAULT_LOCALE ? ", " : "、") })}</span>
            </p>
          )}
        </div>
      )}
    </StepLayout>
  );
}

/** One room type that is free: its photo (tap for details), who it takes, the price for the stay, Book. */
function TypeOffer({ g, images, nights, first, onBook, onDetails }: {
  g: TypeGroup; images: string[]; nights: number; first: boolean; onBook: (o: QrRoomOffer) => void; onDetails: () => void;
}) {
  const t = useT();
  const [pick, setPick] = useState(false);
  const type = g.type;
  const name = t(type.name);
  const best = bestOffer(g.rooms);
  if (!best) return null;
  return (
    <section aria-label={name} className={cn(card, "overflow-hidden motion-safe:animate-[vlh-fade_0.45s_ease-out_both]")}>
      <button type="button" onClick={onDetails} aria-label={t("{name} — photos and details", { name })} className="group relative block aspect-[16/9] w-full overflow-hidden bg-(--vr-line) sm:aspect-[2/1]">
        {images[0] && <Photo src={images[0]} alt={name} sizes="(min-width:1024px) 620px, (min-width:640px) 576px, 100vw" eager={first}
          imgClassName="transition-[opacity,scale] duration-700 group-hover:scale-[1.03] motion-reduce:group-hover:scale-100" />}
        {images.length > 1 && (
          <span className="absolute bottom-2.5 right-2.5 inline-flex h-7 items-center gap-1.5 rounded-full bg-black/45 px-2.5 text-[11.5px] font-medium text-white backdrop-blur-sm">
            <Images className="size-3.5" />{images.length}
          </span>
        )}
      </button>
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[25px] font-semibold leading-[1.05]">{name}</h2>
            <p className="mt-1 text-[12.5px] text-(--vr-muted)">
              {holdsText(type, t)} · <button type="button" onClick={onDetails} className="font-medium text-(--vr-gold-ink) hover:underline">{t("Details")}</button>
            </p>
          </div>
          <span className="shrink-0 pt-1.5 text-[12px] font-medium text-emerald-700">{t("{n} free", { n: g.available })}</span>
        </div>
        <div className="mt-3.5 flex items-end justify-between gap-3 border-t border-(--vr-line) pt-3.5">
          <div className="min-w-0 leading-tight">
            <p className="text-[18px] font-semibold tabular-nums">{tzs(best.perNight)}<span className="text-[12.5px] font-normal text-(--vr-muted)"> {t("/ night")}</span></p>
            <p className="mt-1 text-[12.5px] text-(--vr-muted)">
              {nightsText(nights, t)} · <strong className="font-semibold tabular-nums text-(--vr-ink)">{tzs(best.total)}</strong>
              {best.discount > 0 && <span className="text-(--vr-gold-ink)"> · {best.promotion !== null ? t(best.promotion) : t("Offer")}</span>}
            </p>
          </div>
          <button type="button" onClick={() => onBook(best)} className={cn(darkButton, "h-12 shrink-0 px-7 text-[14.5px]")}>{t("Book")}<ArrowRight className="size-4 text-(--vr-gold)" /></button>
        </div>
        {g.rooms.length > 1 && (
          <button type="button" onClick={() => setPick((p) => !p)} aria-expanded={pick}
            className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-(--vr-muted) transition hover:text-(--vr-ink)">
            {t("Choose your room")}<ChevronDown className={cn("size-4 transition", pick && "rotate-180")} />
          </button>
        )}
      </div>
      {pick && (
        <ul className="divide-y divide-(--vr-line) border-t border-(--vr-line)">
          {g.rooms.map((o) => (
            <li key={o.number} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <p className="min-w-0 leading-tight">
                <span className="block text-[15px] font-semibold">{t("Room {number}", { number: o.number })}</span>
                <span className="mt-0.5 block text-[12px] text-(--vr-muted)">{[floorText(o.floor, t), t("{amount} for {nights}", { amount: tzs(o.total), nights: nightsText(nights, t) })].filter(Boolean).join(" · ")}</span>
              </p>
              <button type="button" onClick={() => onBook(o)} className={cn(lightButton, "h-10 shrink-0 px-4 text-[13px]")}>{t("Book")}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ResultsSkeleton() {
  const t = useT();
  return (
    <div className="mt-3.5 space-y-4" aria-busy="true" aria-label={t("Checking what is free")}>
      {[0, 1].map((k) => (
        <div key={k} className={cn(card, "overflow-hidden")}>
          <Skeleton className="aspect-[16/9] rounded-none sm:aspect-[2/1]" />
          <div className="space-y-2.5 p-4">
            <Skeleton className="h-6 w-44" /><Skeleton className="h-4 w-56" />
            <div className="flex items-end justify-between gap-3 pt-2"><Skeleton className="h-10 w-40" /><Skeleton className="h-12 w-28 rounded-full" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}
