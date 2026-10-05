"use client";

import Link from "next/link";
import { BellRing, Building2, CalendarCheck, Check, CircleCheck, KeyRound, Loader2, Lock, Phone, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { NetworkMarks } from "@/components/payments/networks";
import type { QrQuote } from "@/server/services/hotel-qr";
import { caps, card, darkButton, input, lightButton, Photo, Problem, Skeleton, StepHeader, StepLayout } from "./ui";
import { Policies } from "./room";
import type { Shell } from "./rooms";
import { dayShort, guestsText, nightsText, payPhoneOk, telHref, tzs, type LastBooking, type StayQuery } from "./lib";

export type PayWay = "ONLINE" | "HOTEL";

/**
 * HOW WOULD YOU LIKE TO PAY — "Pay now" first (a payment request to the guest's phone, nTZS; the room is held while they
 * pay and the booking is confirmed only when nTZS confirms the money), then "Pay later" when the hotel offers it: the
 * booking is saved but the room is NOT held until it is paid (owner, 2026-10-05) — said plainly, in a few words.
 * The amount is never sent from here — the server works it out again.
 */
export function PayView({ shell, stay, number, typeName, photo, quote, way, onWay, payPhone, onPayPhone, payError, trap, onTrap, pending, onBook, onBack }: {
  shell: Shell; stay: StayQuery; number: string; typeName: string | null; photo: string | null; quote: QrQuote | null;
  way: PayWay; onWay: (w: PayWay) => void; payPhone: string; onPayPhone: (v: string) => void; payError: string | null;
  trap: string; onTrap: (v: string) => void; pending: boolean; onBook: () => void; onBack: () => void;
}) {
  const pay = quote?.pay;
  const none = pay && !pay.online && !pay.atHotel;
  const online = way === "ONLINE";
  return (
    <StepLayout hotel={shell.hotel} phone={shell.phone} aside={shell.aside}
      header={<StepHeader title="How would you like to pay?" sub={quote ? `Total ${tzs(quote.total)}` : "Your booking"} onBack={onBack} step={4} />}
      cta={none ? null : {
        label: online ? (quote ? `Pay ${tzs(quote.total)} now` : "Pay now") : "Book — pay later",
        onClick: onBook, disabled: !quote, pending,
        icon: online ? <Lock className="size-4 shrink-0 text-(--vr-gold)" /> : <Check className="size-4 shrink-0 text-(--vr-gold)" strokeWidth={3} />,
      }}>
      {/* What is being booked */}
      <div className={cn(card, "mt-1 flex items-center gap-3 rounded-2xl p-2.5")}>
        <span className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-(--vr-line)">{photo && <Photo src={photo} alt="" sizes="56px" />}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[14px] font-semibold">Room {number}{typeName ? ` · ${typeName}` : ""}</span>
          <span className="mt-0.5 block truncate text-[12px] text-(--vr-muted)">{dayShort(stay.checkIn)} → {dayShort(stay.checkOut)} · {quote ? nightsText(quote.nights.length) : ""}{quote ? " · " : ""}{guestsText(stay.adults, stay.children)}</span>
        </span>
        {quote ? <span className="shrink-0 pr-1 text-[15px] font-semibold tabular-nums">{tzs(quote.total)}</span> : <Skeleton className="h-5 w-20" />}
      </div>

      {!pay ? (
        <div className="mt-4 space-y-2" aria-busy="true"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
      ) : none ? (
        <Problem title="Booking here is not available right now" text="Please call reception and we'll book it for you.">
          {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />Call reception</a>}
        </Problem>
      ) : (
        <div role="radiogroup" aria-label="How would you like to pay?" className={cn(card, "mt-4 overflow-hidden shadow-[0_18px_40px_-34px_rgba(29,23,18,0.85)]")}>
          {pay.online && (
            <WayRow on={online} onSelect={() => onWay("ONLINE")} icon={Smartphone} title="Pay now" sub="Secure your booking now" marks>
              <div className="space-y-3.5 rounded-2xl bg-(--vr-card) p-3.5 ring-1 ring-(--vr-line)">
                <label className="block">
                  <span className="text-[12px] font-medium text-(--vr-ink)/75">Mobile-money number</span>
                  <span className="relative mt-1 block">
                    <Phone className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
                    <input value={payPhone} onChange={(e) => onPayPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678"
                      aria-invalid={!!payError || (!!payPhone && !payPhoneOk(payPhone))} className={cn(input, "pl-10 font-medium tabular-nums")} />
                    {payPhoneOk(payPhone) && <CircleCheck className="pointer-events-none absolute right-3.5 top-1/2 size-[18px] -translate-y-1/2 text-emerald-600" />}
                  </span>
                  {payError ? <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-700">{payError}</span>
                    : payPhone && !payPhoneOk(payPhone) ? <span className="mt-1 block text-[11.5px] text-amber-700">e.g. 0712 345 678</span> : null}
                </label>
                {/* The three steps: in a row, or one under the other on the narrowest phones. */}
                <ol className="relative grid gap-2 min-[380px]:grid-cols-3 min-[380px]:gap-0">
                  <span aria-hidden className="absolute left-[16.7%] right-[16.7%] top-[15px] hidden h-px bg-linear-to-r from-(--vr-gold)/70 via-(--vr-gold)/35 to-(--vr-gold)/70 min-[380px]:block" />
                  {[{ t: "Check your phone", i: BellRing }, { t: "Enter your PIN", i: KeyRound }, { t: "Booking confirmed", i: CalendarCheck }].map(({ t, i: Icon }) => (
                    <li key={t} className="relative flex items-center gap-2.5 min-[380px]:block min-[380px]:text-center">
                      <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold) ring-4 ring-(--vr-card) min-[380px]:mx-auto"><Icon className="size-[14px]" /></span>
                      <span className="block text-[12px] font-medium leading-snug text-(--vr-ink)/75 min-[380px]:mt-1.5">{t}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-center text-[11.5px] leading-snug text-(--vr-muted)">We keep the room for {pay.onlineHoldMinutes} minutes while you pay.</p>
                <p className="flex items-center justify-center gap-1.5 border-t border-(--vr-line) pt-3 text-[11.5px] font-medium text-(--vr-muted)">
                  <Lock className="size-3 shrink-0 text-(--vr-gold-ink)" />Secure payment by <span className="font-semibold tracking-wide text-(--vr-ink)/80">NTZS</span>
                </p>
              </div>
            </WayRow>
          )}
          {pay.atHotel && (
            // Said as it is: the booking is saved, but nothing is held until it is paid — whoever pays first gets the room.
            <WayRow on={!online} onSelect={() => onWay("HOTEL")} icon={Building2} title="Pay later" sub="Not reserved until paid">
              <p className="rounded-2xl bg-(--vr-card) px-3.5 py-3 text-[12.5px] leading-snug text-(--vr-ink)/75 ring-1 ring-(--vr-line)">
                Your booking is saved, but the room is not held until it is paid. Pay now any time from your booking to secure it.
              </p>
            </WayRow>
          )}
        </div>
      )}

      {quote && <Policies list={quote.policies.filter((p) => !p.startsWith("Check-in from"))} className="mt-5" />}
      <input value={trap} onChange={(e) => onTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
    </StepLayout>
  );
}

function WayRow({ on, onSelect, icon: Icon, title, sub, marks, children }: {
  on: boolean; onSelect: () => void; icon: typeof Smartphone; title: string; sub: string; marks?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className={cn("border-b border-(--vr-line) transition-colors last:border-b-0", on ? "bg-(--vr-gold-soft)/55" : "hover:bg-(--vr-bg)/70")}>
      <button type="button" role="radio" aria-checked={on} onClick={onSelect} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-full transition", on ? "bg-(--vr-dark) text-(--vr-gold)" : "bg-(--vr-bg) text-(--vr-gold-ink) ring-1 ring-(--vr-line)")}><Icon className="size-[18px]" /></span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[15px] font-semibold">{title}</span>
          <span className="mt-0.5 block text-[12.5px] text-(--vr-muted)">{sub}</span>
          {marks && <NetworkMarks label={null} compact className="mt-1.5" />}
        </span>
        <span aria-hidden className={cn("grid size-[22px] shrink-0 place-items-center rounded-full border-2 transition", on ? "border-(--vr-dark) bg-(--vr-dark) text-white" : "border-(--vr-line) bg-white")}>
          {on && <Check className="size-3" strokeWidth={3.5} />}
        </span>
      </button>
      {on && children && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/**
 * The booking was just made in this tab (Back from the payment page lands here): what it is and where to go on —
 * finish paying, or the booking's own page. Never the form again.
 */
export function BookedView({ last, busy }: { last: LastBooking; busy: boolean }) {
  return (
    <div className="mx-auto grid min-h-[80svh] max-w-md place-items-center px-4 py-10">
      <div className={cn(card, "w-full overflow-hidden text-center")}>
        <div className="bg-(--vr-dark) px-5 pb-6 pt-7 text-white">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-(--vr-gold) text-(--vr-ink)"><CalendarCheck className="size-6" /></span>
          <p className={cn(caps, "mt-4 text-white/55")}>Booking reference</p>
          <p className="mt-1 font-display text-[34px] font-semibold leading-none tracking-wide text-(--vr-gold)">{last.reference}</p>
          <p className="mt-2.5 text-[13px] text-white/70">Room {last.room} · {last.typeName}</p>
          <p className="text-[13px] text-white/70">{dayShort(last.checkIn)} → {dayShort(last.checkOut)} · {tzs(last.total)}</p>
        </div>
        <div className="space-y-2 p-4">
          {busy ? (
            <p className="flex h-12 items-center justify-center gap-2 text-[14px] text-(--vr-muted)"><Loader2 className="size-4 animate-spin" />{last.payUrl ? "Opening the payment…" : "Opening your booking…"}</p>
          ) : (
            <>
              {last.payWay === "ONLINE" && last.payUrl && <Link href={last.payUrl} className={cn(darkButton, "h-12 w-full text-[14.5px]")}><Lock className="size-4 text-(--vr-gold)" />Continue to payment</Link>}
              <Link href={last.confirmUrl} className={cn(last.payWay === "ONLINE" && last.payUrl ? lightButton : darkButton, "h-12 w-full text-[14.5px]")}>View booking</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
