import Image from "next/image";
import Link from "next/link";
import { CalendarSearch } from "lucide-react";
import { listPublicRoomTypes, searchAvailability, type SearchOption, type StayParams } from "@/server/services/public-booking";
import { addDays, diffDays } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, Eyebrow, HudLabel, InfoList, MediaFrame, PriceTag, TextLink, field, typeScale } from "../kit";
import fx from "../room-fx.module.css";
import { formatDay } from "./parts";

const pad2 = (n: number) => String(n).padStart(2, "0");

function stayQuery(p: StayParams, extra: Record<string, string | number> = {}) {
  const q = new URLSearchParams({ checkIn: p.checkIn, checkOut: p.checkOut, adults: String(p.adults), children: String(p.children) });
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  return `/book?${q.toString()}`;
}

/** Live availability for a stay (server component, streamed behind a skeleton). */
export async function AvailabilityResults({
  params,
  preferred,
  today,
  maxArrival,
  online = false,
}: {
  params: StayParams;
  preferred?: string;
  today: string;
  maxArrival: string;
  /** Pay online (nTZS) is offered for room bookings — the next step offers Pay now or pay later. */
  online?: boolean;
}) {
  const [result, allTypes] = await Promise.all([searchAvailability(params), listPublicRoomTypes()]);
  const { options, nights } = result;
  const available = new Set(options.map((o) => o.type.slug));
  const unavailable = allTypes.filter((t) => !available.has(t.slug));
  const ordered = [...options].sort((a, b) => Number(b.type.slug === preferred) - Number(a.type.slug === preferred));
  const discounted = options.some((o) => o.perRoom.discountPerNight > 0);

  if (options.length === 0) {
    // Look for nearby dates that do have rooms, so the guest has a next step.
    const length = diffDays(params.checkIn, params.checkOut);
    const shifts = [1, 2, 3, 7, -1].map((d) => addDays(params.checkIn, d)).filter((d) => d >= today && d <= maxArrival);
    const nearby: { checkIn: string; checkOut: string; from: number }[] = [];
    for (const checkIn of shifts) {
      if (nearby.length >= 3) break;
      try {
        const r = await searchAvailability({ ...params, checkIn, checkOut: addDays(checkIn, length) });
        if (r.options.length) nearby.push({ checkIn, checkOut: addDays(checkIn, length), from: Math.min(...r.options.map((o) => o.perRoom.netPerNight)) });
      } catch {
        /* date outside the bookable window — skip */
      }
    }
    return (
      <div className={cn(fx.card, "relative mx-auto max-w-2xl px-5 py-10 text-center motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700 sm:px-10 sm:py-12")}>
        <span className="mx-auto grid size-16 place-items-center rounded-full border border-pub-eyebrow/35 text-pub-eyebrow shadow-[0_0_0_8px_color-mix(in_oklab,var(--pub-eyebrow)_7%,transparent)]">
          <CalendarSearch className="size-7" strokeWidth={1.2} aria-hidden="true" />
        </span>
        <h2 className={cn("mt-5", typeScale.subheading)}>A full house on these dates</h2>
        <p className={cn("mx-auto mt-3 max-w-md text-pub-muted", typeScale.body)}>
          {result.tooSmall.length > 0
            ? `We have rooms free, but not enough to fit ${params.adults} adult(s)${params.children ? ` and ${params.children} child(ren)` : ""} in one booking. Try fewer guests per booking, or contact us and we’ll arrange it.`
            : "Every room is taken for this stay. Try different dates — or contact us, as cancellations do come up."}
        </p>
        {nearby.length > 0 && (
          <div className="mt-10 text-left">
            <Eyebrow className="text-center">Rooms are free on these nearby dates</Eyebrow>
            <ul className="mt-5 border-t border-pub-line">
              {nearby.map((n) => (
                <li key={n.checkIn} className="border-b border-pub-line">
                  <Link
                    href={stayQuery({ ...params, checkIn: n.checkIn, checkOut: n.checkOut })}
                    className="group flex min-h-14 items-center justify-between gap-4 py-4 transition-colors duration-200 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none"
                  >
                    <span className="font-display text-[1.25rem] leading-tight">{formatDay(n.checkIn)} → {formatDay(n.checkOut)}</span>
                    <span className={cn(typeScale.meta, "shrink-0 text-pub-muted")}>From {formatTZS(n.from)} / night</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-8 flex justify-center">
          <TextLink href="/contact?subject=booking">Contact the front desk</TextLink>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-pub-line pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite">
          <HudLabel live as="span">
            {options.length} room type{options.length === 1 ? "" : "s"} free · {nights} night{nights === 1 ? "" : "s"}
          </HudLabel>
          {discounted && <span className="text-[13px] text-pub-muted">Prices include the website discount.</span>}
        </p>
        {/* How paying works, said once for every room below. */}
        <p className="text-[13px] leading-snug text-pub-muted">{online ? "Pay now by mobile money, or later at the hotel — you choose next." : "No payment now — pay at the hotel."}</p>
      </div>
      <ul className="mt-6 space-y-5 sm:mt-8 sm:space-y-6 lg:mt-4 lg:space-y-0">
        {ordered.map((o, i) => (
          <li
            key={o.type.slug}
            className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:duration-700"
            style={{ animationDelay: `${i * 90}ms` }}
          >
            <AvailabilityRow option={o} params={params} nights={nights} preferred={o.type.slug === preferred} index={i + 1} total={ordered.length} />
          </li>
        ))}
      </ul>

      {unavailable.length > 0 && (
        <section aria-labelledby="unavailable-title" className="mt-12 sm:mt-14">
          <h2 id="unavailable-title" className="leading-none">
            <HudLabel as="span">Not free for these dates</HudLabel>
          </h2>
          <ul className="mt-4 grid gap-x-10 border-t border-pub-line sm:grid-cols-2">
            {unavailable.map((t) => {
              const small = result.tooSmall.find((s) => s.name === t.name);
              return (
                <li key={t.slug} className="flex items-center gap-4 border-b border-pub-line py-4">
                  {t.images[0] && (
                    <div className="relative size-14 shrink-0 overflow-hidden grayscale">
                      <Image src={t.images[0]} alt="" fill sizes="56px" className="object-cover opacity-60" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-display text-[1.2rem] leading-tight text-pub-fg/80">{t.name}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-pub-muted">
                      {small ? `Too small for ${params.adults + params.children} guests in one booking` : "Fully booked"} — try{" "}
                      {options.slice(0, 2).map((o, j) => (
                        <span key={o.type.slug}>
                          {j > 0 && " or "}
                          <a href={`#option-${o.type.slug}`} className="text-pub-fg underline decoration-pub-line underline-offset-4 hover:decoration-gold">{o.type.name}</a>
                        </span>
                      ))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function AvailabilityRow({
  option: o,
  params,
  nights,
  preferred,
  index,
  total,
}: {
  option: SearchOption;
  params: StayParams;
  nights: number;
  preferred: boolean;
  index: number;
  total: number;
}) {
  const t = o.type;
  const codes = new Set(t.amenities.map((a) => a.code));
  const includes = [codes.has("BREAKFAST") && "Breakfast", codes.has("WIFI") && "Wi-Fi"].filter(Boolean) as string[];
  const choices = Array.from({ length: o.maxRooms - o.minRooms + 1 }, (_, i) => o.minRooms + i);
  const facts = [
    { label: `Up to ${t.maxAdults} adult${t.maxAdults === 1 ? "" : "s"} per room` },
    t.maxChildren > 0 ? { label: `${t.maxChildren} child${t.maxChildren === 1 ? "" : "ren"}` } : null,
    t.bedType ? { label: t.bedType } : null,
    includes.length ? { label: `${includes.join(" & ")} included` } : null,
  ].filter((f): f is { label: string } => f !== null);

  return (
    <article
      id={`option-${t.slug}`}
      data-spotlight="border"
      className={cn(
        fx.card,
        fx.optionRow,
        "group relative grid scroll-mt-[calc(var(--pub-header-h)+1.5rem)] gap-5 p-3 sm:gap-6 sm:p-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-8 lg:gap-12",
        preferred && "outline-1 -outline-offset-1 outline-pub-eyebrow/45",
      )}
    >
      <Link href={`/rooms/${t.slug}`} tabIndex={-1} aria-hidden="true" className="relative block min-w-0">
        {t.images[0] ? (
          <MediaFrame
            src={t.images[0]}
            alt={`${t.name} at Vegas Luxury Hotel`}
            ratio="16/9"
            ratioSm="3/2"
            ratioLg="4/3"
            rounded="soft"
            sizes="(min-width: 1024px) 34vw, (min-width: 768px) 40vw, 100vw"
            corners
            zoom
          />
        ) : (
          <div className="aspect-[16/9] rounded-[0.375rem] bg-pub-fg/[0.06] sm:aspect-[3/2] lg:aspect-[4/3]" />
        )}
        {/* Option index on the photo, on a small smoked chip. */}
        <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 rounded-full bg-[rgb(12_10_7/0.55)] px-2.5 py-1 font-mono text-[10px] tracking-[0.2em] text-white/90 backdrop-blur-sm">
          {pad2(index)}/{pad2(total)}
        </span>
        {preferred && <span aria-hidden="true" className="pub-hud-corners" style={{ "--hud-o": "-0.625rem", "--hud-l": "0.875rem", "--hud-c": "rgb(244 220 168 / 0.9)" } as React.CSSProperties} />}
      </Link>

      <div className="flex min-w-0 flex-col px-1.5 pb-1.5 sm:px-1 md:py-2 md:pr-2">
        {(preferred || o.available <= 2) && (
          <p className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            {preferred && <HudLabel as="span">Your choice</HudLabel>}
            {o.available <= 2 && <HudLabel as="span" live>Only {o.available} left</HudLabel>}
          </p>
        )}
        <h3 className={typeScale.subheading}>
          <Link href={`/rooms/${t.slug}`} className="rounded-sm transition-colors duration-200 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-reduce:transition-none">
            {t.name}
          </Link>
        </h3>
        <InfoList items={facts} className="mt-2.5" />
        {t.shortDescription && <p className={cn(typeScale.body, "mt-3 hidden max-w-[34rem] text-pub-muted sm:block")}>{t.shortDescription}</p>}

        <PriceTag
          amount={o.perRoom.netPerNight}
          was={o.perRoom.discountPerNight > 0 ? o.perRoom.ratePerNight : null}
          className="mt-4 sm:mt-5"
        />

        <form action="/book" method="get" className="mt-5 flex flex-col gap-4 border-t border-dashed border-pub-line pt-5 sm:mt-auto sm:flex-row sm:items-end sm:justify-between sm:gap-5 md:mt-6">
          <input type="hidden" name="checkIn" value={params.checkIn} />
          <input type="hidden" name="checkOut" value={params.checkOut} />
          <input type="hidden" name="adults" value={params.adults} />
          <input type="hidden" name="children" value={params.children} />
          <input type="hidden" name="type" value={t.slug} />
          <div className="flex items-end gap-5">
            {choices.length > 1 ? (
              <div className="w-32 shrink-0">
                <label htmlFor={`rooms-${t.slug}`} className={field.label}>Rooms</label>
                <select
                  id={`rooms-${t.slug}`}
                  name="rooms"
                  defaultValue={o.minRooms}
                  className={cn(field.input, "appearance-auto px-3 [color-scheme:light] pub-dark:[color-scheme:dark]")}
                >
                  {choices.map((n) => <option key={n} value={n}>{n} room{n === 1 ? "" : "s"}</option>)}
                </select>
              </div>
            ) : (
              <input type="hidden" name="rooms" value={o.minRooms} />
            )}
            <p className="min-w-0 pb-0.5 text-[13px] leading-snug text-pub-muted">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] sm:text-[11px]">
                {nights} night{nights === 1 ? "" : "s"}
                {choices.length === 1 && o.minRooms > 1 && <> · {o.minRooms} rooms</>}
              </span>
              <span className="mt-1 block font-display text-[1.375rem] leading-tight text-pub-fg lining-nums tabular-nums">
                {formatTZS(o.perRoom.netAmount * o.minRooms)}
              </span>
              <span className="block">total{choices.length > 1 && ` for ${o.minRooms} room${o.minRooms === 1 ? "" : "s"}`}</span>
            </p>
          </div>
          <Button type="submit" icon="arrow" className="w-full sm:w-auto">
            Select room<span className="sr-only"> {t.name}</span>
          </Button>
        </form>
      </div>
    </article>
  );
}
