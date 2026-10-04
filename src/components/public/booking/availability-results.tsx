import Image from "next/image";
import Link from "next/link";
import { Baby, CalendarSearch, Check, Coffee, User, Wifi } from "lucide-react";
import { listPublicRoomTypes, searchAvailability, type SearchOption, type StayParams } from "@/server/services/public-booking";
import { addDays, diffDays } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { blurFor } from "../blur-data";
import { ArrowBadge } from "../pill-link";
import { pillGold, type } from "../ui";

function stayQuery(p: StayParams, extra: Record<string, string | number> = {}) {
  const q = new URLSearchParams({ checkIn: p.checkIn, checkOut: p.checkOut, adults: String(p.adults), children: String(p.children) });
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  return `/book?${q.toString()}`;
}

/** Live availability for a stay (server component, streamed behind a skeleton). */
export async function AvailabilityResults({ params, preferred, today, maxArrival }: { params: StayParams; preferred?: string; today: string; maxArrival: string }) {
  const [result, allTypes] = await Promise.all([searchAvailability(params), listPublicRoomTypes()]);
  const { options, nights } = result;
  const available = new Set(options.map((o) => o.type.slug));
  const unavailable = allTypes.filter((t) => !available.has(t.slug));
  const ordered = [...options].sort((a, b) => Number(b.type.slug === preferred) - Number(a.type.slug === preferred));

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
      <div className="rounded-[2rem] bg-panel px-6 py-12 text-center ring-1 ring-tone/[0.06] sm:px-12 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700">
        <CalendarSearch className="mx-auto size-10 text-accent-ink" strokeWidth={1.3} aria-hidden="true" />
        <h2 className={cn("mt-4", type.h3)}>A full house on these dates</h2>
        <p className="mx-auto mt-3 max-w-md text-tone/70">
          {result.tooSmall.length > 0
            ? `We have rooms free, but not enough to fit ${params.adults} adult(s)${params.children ? ` and ${params.children} child(ren)` : ""} in one booking. Try fewer guests per booking, or contact us and we’ll arrange it.`
            : "Every room is taken for this stay. Try different dates — or contact us, as cancellations do come up."}
        </p>
        {nearby.length > 0 && (
          <div className="mt-8">
            <p className="text-sm font-medium">Rooms are free on these nearby dates:</p>
            <ul className="mt-4 flex flex-wrap justify-center gap-3">
              {nearby.map((n) => (
                <li key={n.checkIn}>
                  <Link href={stayQuery({ ...params, checkIn: n.checkIn, checkOut: n.checkOut })} className="block rounded-2xl border border-tone/15 px-5 py-3 text-left transition-colors hover:border-tone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                    <span className="block text-sm font-medium">{formatBusinessDate(n.checkIn)} → {formatBusinessDate(n.checkOut)}</span>
                    <span className="text-xs text-tone/60">from {formatTZS(n.from)} / night</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/contact?subject=booking" className="inline-flex items-center rounded-full border border-tone/25 px-6 py-3 text-sm font-medium hover:border-tone">Contact the front desk</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-tone/65" aria-live="polite">
        {options.length} room type{options.length === 1 ? "" : "s"} available for {nights} night{nights === 1 ? "" : "s"} · prices include the website discount
      </p>
      <ul className="space-y-5">
        {ordered.map((o, i) => (
          <li key={o.type.slug} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:duration-700" style={{ animationDelay: `${i * 90}ms` }}>
            <AvailabilityCard option={o} params={params} nights={nights} preferred={o.type.slug === preferred} />
          </li>
        ))}
      </ul>

      {unavailable.length > 0 && (
        <div className="pt-6">
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-tone/60">Currently unavailable for these dates</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {unavailable.map((t) => {
              const small = result.tooSmall.find((s) => s.name === t.name);
              return (
                <li key={t.slug} className="flex items-center gap-4 rounded-2xl border border-dashed border-tone/20 p-4">
                  {t.images[0] && (
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl grayscale">
                      <Image src={t.images[0]} alt="" fill sizes="64px" className="object-cover opacity-70" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-display text-xl">{t.name}</p>
                    <p className="text-sm text-tone/60">
                      {small ? `Too small for ${params.adults + params.children} guests in one booking` : "Fully booked"} — try{" "}
                      {options.slice(0, 2).map((o, j) => (
                        <span key={o.type.slug}>{j > 0 && " or "}<a href={`#option-${o.type.slug}`} className="underline underline-offset-2 hover:text-tone">{o.type.name}</a></span>
                      ))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function AvailabilityCard({ option: o, params, nights, preferred }: { option: SearchOption; params: StayParams; nights: number; preferred: boolean }) {
  const t = o.type;
  const codes = new Set(t.amenities.map((a) => a.code));
  const includes = [codes.has("WIFI") && "Wi-Fi", codes.has("BREAKFAST") && "Breakfast"].filter(Boolean) as string[];
  const choices = Array.from({ length: o.maxRooms - o.minRooms + 1 }, (_, i) => o.minRooms + i);
  return (
    <article
      id={`option-${t.slug}`}
      className={cn(
        "group grid scroll-mt-28 overflow-hidden rounded-3xl bg-panel ring-1 transition-shadow duration-500 hover:shadow-[0_24px_60px_-30px_rgba(21,18,14,0.45)] md:grid-cols-[18rem_1fr]",
        preferred ? "ring-2 ring-gold" : "ring-tone/[0.07]",
      )}
    >
      <div className="relative aspect-[16/10] overflow-hidden md:aspect-auto md:min-h-60">
        {t.images[0] && (
          <Image src={t.images[0]} alt={`${t.name} at Vegas Luxury Hotel`} fill sizes="(min-width: 768px) 18rem, 100vw" {...blurFor(t.images[0])} className="object-cover transition-transform duration-[1.2s] motion-safe:group-hover:scale-105" />
        )}
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[#15120e]/75 px-3 py-1.5 text-xs text-white backdrop-blur-md">
          <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
          {o.available <= 2 ? `Only ${o.available} left` : "Available"}
        </span>
        {preferred && <span className="absolute right-3 top-3 rounded-full bg-gold px-3 py-1.5 text-xs font-medium text-[#15120e]">Your choice</span>}
      </div>
      <div className="flex flex-col p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <h3 className={type.h3}>
            <Link href={`/rooms/${t.slug}`} className="hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">{t.name}</Link>
          </h3>
          <p className="text-right">
            <span className="font-display text-3xl font-semibold">{formatTZS(o.perRoom.netPerNight)}</span>
            <span className="text-sm text-tone/60"> / night</span>
            {o.perRoom.discountPerNight > 0 && (
              <span className="block text-sm text-tone/50"><s><span className="sr-only">instead of </span>{formatTZS(o.perRoom.ratePerNight)}</s></span>
            )}
          </p>
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-tone/65">
          <li className="inline-flex items-center gap-1.5"><User className="size-4" aria-hidden="true" />Up to {t.maxAdults} adult{t.maxAdults === 1 ? "" : "s"} per room</li>
          {t.maxChildren > 0 && <li className="inline-flex items-center gap-1.5"><Baby className="size-4" aria-hidden="true" />{t.maxChildren} child{t.maxChildren === 1 ? "" : "ren"}</li>}
          {includes.length > 0 && (
            <li className="inline-flex items-center gap-1.5 text-accent-ink">
              {codes.has("WIFI") && <Wifi className="size-4" aria-hidden="true" />}
              {codes.has("BREAKFAST") && <Coffee className="size-4" aria-hidden="true" />}
              Includes {includes.join(" & ")}
            </li>
          )}
        </ul>
        {t.shortDescription && <p className="mt-3 text-[15px] text-tone/70">{t.shortDescription}</p>}

        <form action="/book" method="get" className="mt-auto flex flex-col gap-4 border-t border-tone/10 pt-5 sm:flex-row sm:items-end sm:justify-between">
          <input type="hidden" name="checkIn" value={params.checkIn} />
          <input type="hidden" name="checkOut" value={params.checkOut} />
          <input type="hidden" name="adults" value={params.adults} />
          <input type="hidden" name="children" value={params.children} />
          <input type="hidden" name="type" value={t.slug} />
          <div className="flex items-end gap-5">
            {choices.length > 1 ? (
              <div>
                <label htmlFor={`rooms-${t.slug}`} className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.18em] text-tone/60">Rooms</label>
                <select id={`rooms-${t.slug}`} name="rooms" defaultValue={o.minRooms} className="h-11 rounded-xl border border-tone/15 bg-panel px-3 text-base focus:outline-none focus:ring-3 focus:ring-gold/40">
                  {choices.map((n) => <option key={n} value={n}>{n} room{n === 1 ? "" : "s"}</option>)}
                </select>
              </div>
            ) : (
              <input type="hidden" name="rooms" value={o.minRooms} />
            )}
            <p className="text-sm text-tone/65">
              {nights} night{nights === 1 ? "" : "s"}
              {choices.length === 1 && o.minRooms > 1 && <> · {o.minRooms} rooms</>}
              <span className="block font-medium text-tone">
                {formatTZS(o.perRoom.netAmount * o.minRooms)} total{choices.length > 1 && " for " + o.minRooms + " room" + (o.minRooms === 1 ? "" : "s")}
              </span>
            </p>
          </div>
          <button type="submit" className={cn(pillGold, "h-12 justify-between py-1.5 pl-6 pr-1.5")}>
            <span className="relative">Select room</span>
            <ArrowBadge />
            <span className="sr-only"> {t.name}</span>
          </button>
        </form>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-tone/55"><Check className="size-3.5" aria-hidden="true" />No payment now — pay at the hotel</p>
      </div>
    </article>
  );
}
