"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QrQuote } from "@/server/services/hotel-qr";
import { caps } from "./ui";
import { dayWeek, guestsText, nightsText, tzs } from "./lib";

/** The price for the stay, worked out by the hotel's pricing: per night × nights (or night by night), any offer, the total. */
export function PriceLines({ q, className }: { q: QrQuote; className?: string }) {
  const n = q.nights.length;
  return (
    <div className={className}>
      <dl className="space-y-1.5 text-[13px]">
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
      <p className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-(--vr-line) pt-2.5 text-[13.5px] font-semibold">
        Total<span className="text-[17px] tabular-nums">{tzs(q.total)}</span>
      </p>
      <p className="mt-1 text-[11.5px] text-(--vr-muted)">{nightsText(n)} · {guestsText(q.stay.adults, q.stay.children)} · checked again when you book</p>
    </div>
  );
}

/** The hotel's rules in plain words (from its settings). */
export function Policies({ list, className }: { list: string[]; className?: string }) {
  if (!list.length) return null;
  return (
    <section aria-labelledby="rules-title" className={className}>
      <h2 id="rules-title" className={caps}>Good to know</h2>
      <ul className="mt-2 space-y-1.5 text-[12.5px] leading-snug text-(--vr-muted)">
        {list.map((p) => <li key={p} className={cn("flex gap-2")}><Check className="mt-px size-3.5 shrink-0 text-(--vr-gold-ink)" strokeWidth={2.5} />{p}</li>)}
      </ul>
    </section>
  );
}
