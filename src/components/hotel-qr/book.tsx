"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronDown, Loader2, Lock, Phone, RotateCcw, Send, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QrPayOptions, QrQuote, QrRoomOffer, QrRoomTypeInfo } from "@/server/services/hotel-qr";
import { useT } from "@/i18n/client";
import { card, darkButton, input, lightButton, Photo, Problem, Skeleton, StepHeader, StepLayout } from "./ui";
import { Extras, Field, type Details } from "./details";
import { PayChoice, SecureLine, type PayWay } from "./pay";
import { Policies, PriceLines } from "./room";
import { floorText, type Shell } from "./results";
import { datesText, guestsText, nightsOf, nightsText, telHref, tzs, type StayQuery } from "./lib";

/**
 * 3. YOUR DETAILS & PAY — one screen: the room (checked again on the server and priced for the stay), the phone FIRST
 * (owner, 2026-10-05: like the restaurant — someone we know is greeted by name and types nothing more; someone new adds
 * their name), the optional extras folded away, how to pay (Pay now first and chosen) and ONE gold button: "Pay TZS X
 * now" or "Send booking". Everything is checked again on the server.
 */
export function BookView({
  shell, stay, number, offer, type, photo, state, pay, d, errors, onChange, remembered, onForget, guest, extrasOpen, onExtras,
  way, onWay, payPhone, onPayPhone, payError, samePhone = true, trap, onTrap, pending, onBook, onBack, onSeeRooms, onRetry,
}: {
  shell: Shell; stay: StayQuery; number: string; offer: QrRoomOffer | null; type: QrRoomTypeInfo | null; photo: string | null;
  state: { loading: boolean; quote: QrQuote | null; error: { message: string; taken: boolean } | null };
  pay: QrPayOptions; d: Details; errors: Record<string, string>; onChange: (patch: Partial<Details>) => void;
  /** The name and phone came from this phone's last booking ("Not you?" clears them). */
  remembered: boolean; onForget: () => void;
  /** The phone looked up: "known" — greeted by name (first name and initials), no name to type. */
  guest: { step: "phone" | "checking" | "known" | "new"; name: string | null; notMe: () => void };
  extrasOpen: boolean; onExtras: (v: boolean) => void;
  way: PayWay; onWay: (w: PayWay) => void; payPhone: string; onPayPhone: (v: string | null) => void; payError: string | null; samePhone?: boolean;
  trap: string; onTrap: (v: string) => void; pending: boolean; onBook: () => void; onBack: () => void; onSeeRooms: () => void; onRetry: () => void;
}) {
  const t = useT();
  const q = state.quote;
  const [prices, setPrices] = useState(false);
  const total = q?.total ?? offer?.total ?? null;
  const none = !pay.online && !pay.atHotel;
  const online = way === "ONLINE";
  const floor = floorText(q?.room.floor ?? offer?.floor ?? null, t);
  const nights = q?.nights.length ?? nightsOf(stay);

  const cta = state.error || none ? null : {
    label: online ? (total !== null ? t("Pay {amount} now", { amount: tzs(total) }) : t("Pay now")) : t("Send booking"),
    onClick: onBook, disabled: !q, pending: pending || (state.loading && !q), gold: true,
    icon: online ? <Lock className="size-4 shrink-0" /> : <Send className="size-4 shrink-0" />,
    note: online ? <SecureLine /> : <p className="text-[11.5px] text-(--vr-muted)">{t("The room is not held until it is paid")}</p>,
  };

  return (
    <StepLayout hotel={shell.hotel} phone={shell.phone} aside={shell.aside} cta={cta}
      header={<StepHeader title={t("Your details")} sub={type ? `${t(type.name)} · ${datesText(stay, t)}` : datesText(stay, t)} onBack={onBack} step={3} />}>
      {state.error ? (
        <Problem title={state.error.taken ? t("This room was just taken") : t("We could not open this room")} text={t(state.error.message)}>
          {state.error.taken
            ? <button type="button" onClick={onSeeRooms} className={cn(darkButton, "h-11 px-5 text-[14px]")}><CalendarDays className="size-4 text-(--vr-gold)" />{t("See free rooms")}</button>
            : <button type="button" onClick={onRetry} className={cn(darkButton, "h-11 px-5 text-[14px]")}><RotateCcw className="size-4 text-(--vr-gold)" />{t("Try again")}</button>}
          {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />{t("Call reception")}</a>}
        </Problem>
      ) : (
        <>
          {/* The room being booked (phones and computers alike — the side card shows the stay) */}
          <section aria-label={t("Your room")} className={cn(card, "mt-1 overflow-hidden")}>
            <div className="flex items-center gap-3 p-2.5 pr-4">
              <span className="relative size-[68px] shrink-0 overflow-hidden rounded-[14px] bg-(--vr-line)">{photo && <Photo src={photo} alt="" sizes="68px" />}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[15px] font-semibold">{type ? t(type.name) : t("Your room")}</span>
                <span className="mt-0.5 block truncate text-[12px] text-(--vr-muted)">{t("Room {number}", { number })}{floor ? ` · ${floor}` : ""}</span>
                <span className="mt-0.5 block truncate text-[12px] text-(--vr-muted)">{nightsText(nights, t)} · {guestsText(stay.adults, stay.children, t)}</span>
              </span>
              <span className="shrink-0 text-right leading-tight">
                {total !== null ? <span className="block text-[16px] font-semibold tabular-nums">{tzs(total)}</span> : <Skeleton className="h-5 w-20" />}
                <button type="button" onClick={() => setPrices((p) => !p)} disabled={!q} aria-expanded={prices}
                  className="mt-1 inline-flex items-center gap-0.5 text-[11.5px] font-medium text-(--vr-gold-ink) disabled:opacity-40">
                  {t("Price details")}<ChevronDown className={cn("size-3.5 transition", prices && "rotate-180")} />
                </button>
              </span>
            </div>
            {prices && q && <PriceLines q={q} className="border-t border-(--vr-line) px-4 py-3.5" />}
          </section>

          <form className="mt-5 space-y-3.5" onSubmit={(e) => { e.preventDefault(); onBook(); }} noValidate>
            <Field label={t("Phone number")} error={errors.phone} hint={guest.step === "known" ? undefined : t("Your number first — if you have stayed or ordered with us before, we know you.")} htmlFor="qr-phone">
              <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
              <input id="qr-phone" name="phone" value={d.phone} onChange={(e) => onChange({ phone: e.target.value })} type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="next" maxLength={30}
                placeholder="0712 345 678" aria-invalid={!!errors.phone} className={cn(input, "pl-11 pr-11 tabular-nums")} />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                {guest.step === "checking" ? <Loader2 className="size-4 animate-spin text-(--vr-muted)" />
                  : guest.step === "known" || guest.step === "new" ? <span className="grid size-5 place-items-center rounded-full bg-(--vr-gold) text-(--vr-dark)"><Check className="size-3" strokeWidth={3} /></span> : null}
              </span>
            </Field>
            {guest.step === "known" ? (
              <div role="status" className={cn(card, "flex items-center gap-3 p-3")}>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) font-display text-[17px] text-(--vr-gold)">{guest.name!.charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1 leading-tight"><span className="block text-[12px] text-(--vr-muted)">{t("Welcome back")}</span><span className="block truncate text-[15px] font-semibold">{guest.name}</span></span>
                <button type="button" onClick={guest.notMe} className="shrink-0 px-1 text-[12.5px] font-semibold text-(--vr-gold-ink) hover:underline">{t("Not you?")}</button>
              </div>
            ) : guest.step === "new" ? (
              <>
                {remembered && (
                  <p className="flex items-center justify-between gap-3 text-[12.5px] text-(--vr-muted)">
                    <span>{t("Your name is filled in from last time.")}</span>
                    <button type="button" onClick={onForget} className="shrink-0 font-semibold text-(--vr-gold-ink) hover:underline">{t("Not you?")}</button>
                  </p>
                )}
                <Field label={t("Full name")} error={errors.fullName} htmlFor="qr-name">
                  <UserRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
                  <input id="qr-name" value={d.fullName} onChange={(e) => onChange({ fullName: e.target.value })} name="fullName" autoComplete="name" autoCapitalize="words" enterKeyHint="done" maxLength={80}
                    placeholder={t("e.g. Asha Mwakyusa")} aria-invalid={!!errors.fullName} className={cn(input, "pl-11")} />
                </Field>
              </>
            ) : null}
            <Extras open={extrasOpen} onOpen={onExtras} d={d} errors={errors} onChange={onChange} checkInTime={shell.times.checkIn} checkIn={stay.checkIn} />
            <button type="submit" className="sr-only" tabIndex={-1}>{t("Book")}</button>
          </form>

          <div className="mt-6">
            {none ? (
              <Problem title={t("Booking here is not available right now")} text={t("Please call reception and we'll book it for you.")}>
                {shell.phone && <a href={telHref(shell.phone)} className={cn(lightButton, "h-11 px-5 text-[14px]")}><Phone className="size-4 text-(--vr-gold-ink)" />{t("Call reception")}</a>}
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
