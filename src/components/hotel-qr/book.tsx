"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, Lock, Phone, RotateCcw, Send, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QrPayOptions, QrQuote, QrRoomOffer, QrRoomTypeInfo } from "@/server/services/hotel-qr";
import { card, darkButton, input, lightButton, Photo, Problem, Skeleton, StepHeader, StepLayout } from "./ui";
import { Extras, Field, type Details } from "./details";
import { PayChoice, SecureLine, type PayWay } from "./pay";
import { Policies, PriceLines } from "./room";
import { floorText, type Shell } from "./results";
import { datesText, guestsText, nightsOf, nightsText, telHref, tzs, type StayQuery } from "./lib";

/**
 * 3. YOUR DETAILS & PAY — one screen: the room (checked again on the server and priced for the stay), a name and a
 * phone (remembered on this phone after a booking here), the optional extras folded away, how to pay (Pay now first
 * and chosen) and ONE gold button: "Pay TZS X now" or "Send booking". Everything is checked again on the server.
 */
export function BookView({
  shell, stay, number, offer, type, photo, state, pay, d, errors, onChange, remembered, onForget, extrasOpen, onExtras,
  way, onWay, payPhone, onPayPhone, payError, samePhone = true, trap, onTrap, pending, onBook, onBack, onSeeRooms, onRetry,
}: {
  shell: Shell; stay: StayQuery; number: string; offer: QrRoomOffer | null; type: QrRoomTypeInfo | null; photo: string | null;
  state: { loading: boolean; quote: QrQuote | null; error: { message: string; taken: boolean } | null };
  pay: QrPayOptions; d: Details; errors: Record<string, string>; onChange: (patch: Partial<Details>) => void;
  /** The name and phone came from this phone's last booking ("Not you?" clears them). */
  remembered: boolean; onForget: () => void;
  extrasOpen: boolean; onExtras: (v: boolean) => void;
  way: PayWay; onWay: (w: PayWay) => void; payPhone: string; onPayPhone: (v: string | null) => void; payError: string | null; samePhone?: boolean;
  trap: string; onTrap: (v: string) => void; pending: boolean; onBook: () => void; onBack: () => void; onSeeRooms: () => void; onRetry: () => void;
}) {
  const q = state.quote;
  const [prices, setPrices] = useState(false);
  const total = q?.total ?? offer?.total ?? null;
  const none = !pay.online && !pay.atHotel;
  const online = way === "ONLINE";
  const floor = floorText(q?.room.floor ?? offer?.floor ?? null);
  const nights = q?.nights.length ?? nightsOf(stay);
  // The keyboard's "Next" moves on to the phone field (Enter would otherwise send the form half filled).
  const toPhone = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    document.getElementById("qr-phone")?.focus();
  };

  const cta = state.error || none ? null : {
    label: online ? (total !== null ? `Pay ${tzs(total)} now` : "Pay now") : "Send booking",
    onClick: onBook, disabled: !q, pending: pending || (state.loading && !q), gold: true,
    icon: online ? <Lock className="size-4 shrink-0" /> : <Send className="size-4 shrink-0" />,
    note: online ? <SecureLine /> : <p className="text-[11.5px] text-(--vr-muted)">The room is not held until it is paid</p>,
  };

  return (
    <StepLayout hotel={shell.hotel} phone={shell.phone} aside={shell.aside} cta={cta}
      header={<StepHeader title="Your details" sub={type ? `${type.name} · ${datesText(stay)}` : datesText(stay)} onBack={onBack} step={3} />}>
      {state.error ? (
        <Problem title={state.error.taken ? "This room was just taken" : "We could not open this room"} text={state.error.message}>
          {state.error.taken
            ? <button type="button" onClick={onSeeRooms} className={cn(darkButton, "h-11 px-5 text-[14px]")}><CalendarDays className="size-4 text-(--vr-gold)" />See free rooms</button>
            : <button type="button" onClick={onRetry} className={cn(darkButton, "h-11 px-5 text-[14px]")}><RotateCcw className="size-4 text-(--vr-gold)" />Try again</button>}
          {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />Call reception</a>}
        </Problem>
      ) : (
        <>
          {/* The room being booked (phones and computers alike — the side card shows the stay) */}
          <section aria-label="Your room" className={cn(card, "mt-1 overflow-hidden")}>
            <div className="flex items-center gap-3 p-2.5 pr-4">
              <span className="relative size-[68px] shrink-0 overflow-hidden rounded-[14px] bg-(--vr-line)">{photo && <Photo src={photo} alt="" sizes="68px" />}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[15px] font-semibold">{type?.name ?? "Your room"}</span>
                <span className="mt-0.5 block truncate text-[12px] text-(--vr-muted)">Room {number}{floor ? ` · ${floor}` : ""}</span>
                <span className="mt-0.5 block truncate text-[12px] text-(--vr-muted)">{nightsText(nights)} · {guestsText(stay.adults, stay.children)}</span>
              </span>
              <span className="shrink-0 text-right leading-tight">
                {total !== null ? <span className="block text-[16px] font-semibold tabular-nums">{tzs(total)}</span> : <Skeleton className="h-5 w-20" />}
                <button type="button" onClick={() => setPrices((p) => !p)} disabled={!q} aria-expanded={prices}
                  className="mt-1 inline-flex items-center gap-0.5 text-[11.5px] font-medium text-(--vr-gold-ink) disabled:opacity-40">
                  Price details<ChevronDown className={cn("size-3.5 transition", prices && "rotate-180")} />
                </button>
              </span>
            </div>
            {prices && q && <PriceLines q={q} className="border-t border-(--vr-line) px-4 py-3.5" />}
          </section>

          <form className="mt-5 space-y-3.5" onSubmit={(e) => { e.preventDefault(); onBook(); }} noValidate>
            {remembered && (
              <p className="flex items-center justify-between gap-3 text-[12.5px] text-(--vr-muted)">
                <span>Welcome back — your details are filled in.</span>
                <button type="button" onClick={onForget} className="shrink-0 font-semibold text-(--vr-gold-ink) hover:underline">Not you?</button>
              </p>
            )}
            <Field label="Full name" error={errors.fullName} htmlFor="qr-name">
              <UserRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
              <input id="qr-name" value={d.fullName} onChange={(e) => onChange({ fullName: e.target.value })} onKeyDown={toPhone} name="fullName" autoComplete="name" autoCapitalize="words" enterKeyHint="next" maxLength={80}
                placeholder="e.g. Asha Mwakyusa" aria-invalid={!!errors.fullName} className={cn(input, "pl-11")} />
            </Field>
            <Field label="Phone number" error={errors.phone} hint="Your booking details come to this number." htmlFor="qr-phone">
              <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
              <input id="qr-phone" name="phone" value={d.phone} onChange={(e) => onChange({ phone: e.target.value })} type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="done" maxLength={30}
                placeholder="0712 345 678" aria-invalid={!!errors.phone} className={cn(input, "pl-11 tabular-nums")} />
            </Field>
            <Extras open={extrasOpen} onOpen={onExtras} d={d} errors={errors} onChange={onChange} checkInTime={shell.times.checkIn} checkIn={stay.checkIn} />
            <button type="submit" className="sr-only" tabIndex={-1}>Book</button>
          </form>

          <div className="mt-6">
            {none ? (
              <Problem title="Booking here is not available right now" text="Please call reception and we'll book it for you.">
                {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />Call reception</a>}
              </Problem>
            ) : (
              <PayChoice pay={pay} way={way} onWay={onWay} payPhone={payPhone} onPayPhone={onPayPhone} payError={payError} samePhone={samePhone} />
            )}
          </div>

          {q && <Policies list={q.policies.filter((p) => !p.startsWith("Check-in from"))} className="mt-6" />}
          <input value={trap} onChange={(e) => onTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
        </>
      )}
    </StepLayout>
  );
}
