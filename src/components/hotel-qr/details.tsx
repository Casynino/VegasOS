"use client";

import { useState } from "react";
import { Mail, Phone, Plane, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { validPhone } from "@/lib/guest-messages";
import type { QrQuote } from "@/server/services/hotel-qr";
import { caps, card, input, Photo, StepHeader, StepLayout } from "./ui";
import type { Shell } from "./rooms";
import { dayShort, guestsText, tzs, type StayQuery } from "./lib";

/** What the guest types — only what the booking needs: a name and a phone; the rest is optional. */
export type Details = {
  fullName: string; phone: string; email: string;
  arrivalTime: string; specialRequest: string;
  pickup: boolean; flightNumber: string; landingTime: string; pickupNote: string;
};
export const NO_DETAILS: Details = { fullName: "", phone: "", email: "", arrivalTime: "", specialRequest: "", pickup: false, flightNumber: "", landingTime: "", pickupNote: "" };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The same checks the server makes (it checks again) — so the guest sees them at once, next to the field. */
export function checkDetails(d: Details): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.fullName.trim().replace(/\s+/g, " ").length < 2) e.fullName = "Please enter your full name.";
  if (!validPhone(d.phone)) e.phone = "Please enter a phone number we can reach you on (e.g. 0712 345 678).";
  const email = d.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Please check your email address.";
  if (d.arrivalTime && !TIME.test(d.arrivalTime)) e.arrivalTime = "Enter the time like 14:30.";
  if (d.pickup) {
    if (d.landingTime && !TIME.test(d.landingTime)) e.transportTime = "Enter the time like 14:30.";
    if (d.flightNumber.trim() && !/^[A-Z0-9 -]{2,12}$/i.test(d.flightNumber.trim())) e.flightNumber = "Please check the flight number.";
  }
  return e;
}

/** A few arrival times from check-in on, to tap instead of typing. */
function arrivalChoices(checkIn: string) {
  const h = Number(checkIn.slice(0, 2));
  return [0, 2, 4, 6].map((x) => h + x).filter((x) => x < 24).map((x) => `${String(x).padStart(2, "0")}:00`);
}

function Field({ label, optional, error, hint, children }: { label: string; optional?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12.5px] font-medium text-(--vr-ink)/80">{label}{optional && <span className="font-normal text-(--vr-muted)"> · optional</span>}</span>
      <span className="relative mt-1 block">{children}</span>
      {error ? <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-700">{error}</span> : hint ? <span className="mt-1 block text-[11.5px] text-(--vr-muted)">{hint}</span> : null}
    </label>
  );
}

/**
 * YOUR DETAILS — a full name and a phone number are all the booking needs (the hotel finds the guest again by the
 * phone, never saves them twice); email, arrival time, a special request and an airport pickup are optional.
 */
export function DetailsView({ shell, stay, number, typeName, photo, quote, d, errors, onChange, onBack, onContinue }: {
  shell: Shell; stay: StayQuery; number: string; typeName: string | null; photo: string | null; quote: QrQuote | null;
  d: Details; errors: Record<string, string>; onChange: (patch: Partial<Details>) => void; onBack: () => void; onContinue: () => void;
}) {
  const times = arrivalChoices(shell.times.checkIn);
  const [otherTime, setOtherTime] = useState(!!d.arrivalTime && !times.includes(d.arrivalTime));
  // The keyboard's "Next" moves on to the next field (it sends Enter — which would otherwise send the form half filled).
  const nextOnEnter = (name: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const next = e.currentTarget.form?.elements.namedItem(name);
    if (next instanceof HTMLInputElement) next.focus();
  };
  const chip = (on: boolean) => cn("h-9 rounded-full px-3.5 text-[13px] font-medium tabular-nums ring-1 transition", on ? "bg-(--vr-dark) text-white ring-(--vr-dark)" : "bg-(--vr-card) text-(--vr-ink)/80 ring-(--vr-line) hover:ring-(--vr-gold)");

  return (
    <StepLayout hotel={shell.hotel} phone={shell.phone} aside={shell.aside}
      header={<StepHeader title="Your details" sub="So we know who is coming" onBack={onBack} step={3} />}
      cta={{ label: "Continue", onClick: onContinue, amount: quote ? { label: "Total", value: tzs(quote.total) } : null }}>
      {/* The room, small — phones (computers have the side card) */}
      <div className={cn(card, "mt-1 flex items-center gap-3 rounded-2xl p-2.5 lg:hidden")}>
        <span className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-(--vr-line)">{photo && <Photo src={photo} alt="" sizes="48px" />}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[14px] font-semibold">Room {number}{typeName ? ` · ${typeName}` : ""}</span>
          <span className="mt-0.5 block truncate text-[12px] text-(--vr-muted)">{dayShort(stay.checkIn)} → {dayShort(stay.checkOut)} · {guestsText(stay.adults, stay.children)}</span>
        </span>
      </div>

      <form className="mt-4 space-y-3.5" onSubmit={(e) => { e.preventDefault(); onContinue(); }} noValidate>
        <Field label="Full name" error={errors.fullName}>
          <UserRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
          <input value={d.fullName} onChange={(e) => onChange({ fullName: e.target.value })} onKeyDown={nextOnEnter("phone")} name="fullName" autoComplete="name" autoCapitalize="words" enterKeyHint="next" maxLength={80}
            placeholder="e.g. Asha Mwakyusa" aria-invalid={!!errors.fullName} className={cn(input, "pl-11")} />
        </Field>
        <Field label="Phone number" error={errors.phone} hint="Your booking details come to this number.">
          <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
          <input name="phone" value={d.phone} onChange={(e) => onChange({ phone: e.target.value })} onKeyDown={nextOnEnter("email")} type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="next" maxLength={30}
            placeholder="0712 345 678" aria-invalid={!!errors.phone} className={cn(input, "pl-11 tabular-nums")} />
        </Field>
        <Field label="Email" optional error={errors.email}>
          <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
          <input name="email" value={d.email} onChange={(e) => onChange({ email: e.target.value })} type="email" inputMode="email" autoComplete="email" enterKeyHint="done" maxLength={160}
            placeholder="you@example.com" aria-invalid={!!errors.email} className={cn(input, "pl-11")} />
        </Field>

        <div className="pt-2">
          <p className={caps}>Your arrival <span className="font-normal normal-case tracking-normal">· optional</span></p>
          <p className="mt-2 text-[12.5px] font-medium text-(--vr-ink)/80">When do you think you will arrive?</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Arrival time">
            <button type="button" role="radio" aria-checked={!d.arrivalTime && !otherTime} onClick={() => { setOtherTime(false); onChange({ arrivalTime: "" }); }} className={chip(!d.arrivalTime && !otherTime)}>Not sure</button>
            {times.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={!otherTime && d.arrivalTime === t} onClick={() => { setOtherTime(false); onChange({ arrivalTime: t }); }} className={chip(!otherTime && d.arrivalTime === t)}>{t}</button>
            ))}
            <button type="button" role="radio" aria-checked={otherTime} onClick={() => { setOtherTime(true); onChange({ arrivalTime: "" }); }} className={chip(otherTime)}>Other time</button>
          </div>
          {otherTime && (
            <div className="mt-2 max-w-[200px]">
              <Field label="Arrival time" error={errors.arrivalTime}>
                <input type="time" value={d.arrivalTime} onChange={(e) => onChange({ arrivalTime: e.target.value })} aria-invalid={!!errors.arrivalTime} className={cn(input, "[color-scheme:light]")} />
              </Field>
            </div>
          )}
          {errors.arrivalTime && !otherTime && <p role="alert" className="mt-1 text-[12px] font-medium text-rose-700">{errors.arrivalTime}</p>}
        </div>

        <Field label="Special request" optional>
          <textarea value={d.specialRequest} onChange={(e) => onChange({ specialRequest: e.target.value })} rows={2} maxLength={500}
            placeholder="A quiet room, an extra pillow, a late arrival…"
            className={cn(input, "h-auto resize-none py-3 leading-snug")} />
        </Field>

        {/* Airport pickup */}
        <div className={cn(card, "overflow-hidden rounded-2xl")}>
          <button type="button" role="switch" aria-checked={d.pickup} onClick={() => onChange({ pickup: !d.pickup })} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-full transition", d.pickup ? "bg-(--vr-dark) text-(--vr-gold)" : "bg-(--vr-bg) text-(--vr-gold-ink) ring-1 ring-(--vr-line)")}><Plane className="size-[18px]" /></span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[14.5px] font-semibold">Airport pickup</span>
              <span className="mt-0.5 block text-[12px] text-(--vr-muted)">Our driver meets you at the airport</span>
            </span>
            <span aria-hidden className={cn("relative h-6 w-10 shrink-0 rounded-full transition", d.pickup ? "bg-(--vr-dark)" : "bg-(--vr-line)")}>
              <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", d.pickup ? "left-[18px]" : "left-0.5")} />
            </span>
          </button>
          {d.pickup && (
            <div className="grid gap-3 border-t border-(--vr-line) bg-(--vr-bg)/60 px-3.5 py-3.5 sm:grid-cols-2">
              <Field label="Flight number" optional error={errors.flightNumber}>
                <input value={d.flightNumber} onChange={(e) => onChange({ flightNumber: e.target.value.toUpperCase() })} maxLength={12} autoCapitalize="characters" placeholder="e.g. TC 105"
                  aria-invalid={!!errors.flightNumber} className={input} />
              </Field>
              <Field label={`Landing time on ${dayShort(stay.checkIn)}`} error={errors.transportTime}>
                <input type="time" value={d.landingTime} onChange={(e) => onChange({ landingTime: e.target.value })} aria-invalid={!!errors.transportTime} className={cn(input, "[color-scheme:light]")} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Anything else for the driver" optional>
                  <input value={d.pickupNote} onChange={(e) => onChange({ pickupNote: e.target.value })} maxLength={300} placeholder="e.g. 2 big suitcases" className={input} />
                </Field>
              </div>
            </div>
          )}
        </div>
        <button type="submit" className="sr-only">Continue</button>
      </form>
    </StepLayout>
  );
}
