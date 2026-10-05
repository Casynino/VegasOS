"use client";

import { ChevronDown, Mail, Plane } from "lucide-react";
import { cn } from "@/lib/utils";
import { validPhone } from "@/lib/guest-messages";
import { input } from "./ui";
import { dayShort } from "./lib";

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
/** The fields of the folded extras (opened by itself when one of them has a problem). */
export const EXTRA_FIELDS = ["email", "arrivalTime", "transportTime", "flightNumber"];

/** Arrival times from check-in on, every hour to midnight — picked, not typed. */
function arrivalChoices(checkIn: string) {
  const h = Number(checkIn.slice(0, 2)) || 14;
  return Array.from({ length: Math.max(0, 24 - h) }, (_, k) => `${String(h + k).padStart(2, "0")}:00`);
}

export function Field({ label, optional, error, hint, htmlFor, children }: { label: string; optional?: boolean; error?: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-(--vr-ink)/80">{label}{optional && <span className="font-normal text-(--vr-muted)"> · optional</span>}</label>
      <div className="relative mt-1">{children}</div>
      {error ? <p role="alert" className="mt-1 text-[12px] font-medium text-rose-700">{error}</p> : hint ? <p className="mt-1 text-[11.5px] text-(--vr-muted)">{hint}</p> : null}
    </div>
  );
}

/**
 * "Add arrival time, a request or airport pickup" — folded away (most guests need none of it): when they arrive
 * (picked from a list), a request, an email for the details, and an airport pickup with the flight.
 */
export function Extras({ open, onOpen, d, errors, onChange, checkInTime, checkIn }: {
  open: boolean; onOpen: (v: boolean) => void; d: Details; errors: Record<string, string>; onChange: (patch: Partial<Details>) => void;
  checkInTime: string; checkIn: string;
}) {
  const times = arrivalChoices(checkInTime);
  const added = [d.arrivalTime && `arriving ${d.arrivalTime}`, d.specialRequest.trim() && "a request", d.pickup && "airport pickup", d.email.trim() && "email"].filter(Boolean) as string[];
  return (
    <div className="rounded-2xl ring-1 ring-(--vr-line)">
      <button type="button" onClick={() => onOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[14px] font-semibold">Arrival time, a request or airport pickup</span>
          <span className="mt-0.5 block truncate text-[12px] text-(--vr-muted)">{added.length ? `Added: ${added.join(", ")}` : "Optional"}</span>
        </span>
        <ChevronDown className={cn("size-[18px] shrink-0 text-(--vr-muted) transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-(--vr-line) px-4 pb-4 pt-3.5">
          <Field label="When do you think you will arrive?" error={errors.arrivalTime} htmlFor="qr-arrival">
            <select id="qr-arrival" value={times.includes(d.arrivalTime) ? d.arrivalTime : ""} onChange={(e) => onChange({ arrivalTime: e.target.value })}
              className={cn(input, "appearance-none pr-10")}>
              <option value="">Not sure</option>
              {times.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
          </Field>
          <Field label="A request" optional htmlFor="qr-request">
            <textarea id="qr-request" value={d.specialRequest} onChange={(e) => onChange({ specialRequest: e.target.value })} rows={2} maxLength={500}
              placeholder="A quiet room, an extra pillow, a late arrival…" className={cn(input, "h-auto resize-none py-3 leading-snug")} />
          </Field>
          <Field label="Email for your booking details" optional error={errors.email} htmlFor="qr-email">
            <Mail className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
            <input id="qr-email" name="email" value={d.email} onChange={(e) => onChange({ email: e.target.value })} type="email" inputMode="email" autoComplete="email" maxLength={160}
              placeholder="you@example.com" aria-invalid={!!errors.email} className={cn(input, "pl-11")} />
          </Field>

          {/* Airport pickup */}
          <div className="overflow-hidden rounded-2xl bg-(--vr-bg)/60 ring-1 ring-(--vr-line)">
            <button type="button" role="switch" aria-checked={d.pickup} onClick={() => onChange({ pickup: !d.pickup })} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-full transition", d.pickup ? "bg-(--vr-dark) text-(--vr-gold)" : "bg-(--vr-card) text-(--vr-gold-ink) ring-1 ring-(--vr-line)")}><Plane className="size-4" /></span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-[14px] font-semibold">Airport pickup</span>
                <span className="mt-0.5 block text-[12px] text-(--vr-muted)">Our driver meets you at the airport</span>
              </span>
              <span aria-hidden className={cn("relative h-6 w-10 shrink-0 rounded-full transition", d.pickup ? "bg-(--vr-dark)" : "bg-(--vr-line)")}>
                <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", d.pickup ? "left-[18px]" : "left-0.5")} />
              </span>
            </button>
            {d.pickup && (
              <div className="grid gap-3 border-t border-(--vr-line) px-3.5 py-3.5 sm:grid-cols-2">
                <Field label="Flight number" optional error={errors.flightNumber} htmlFor="qr-flight">
                  <input id="qr-flight" value={d.flightNumber} onChange={(e) => onChange({ flightNumber: e.target.value.toUpperCase() })} maxLength={12} autoCapitalize="characters" placeholder="e.g. TC 105"
                    aria-invalid={!!errors.flightNumber} className={input} />
                </Field>
                <Field label={`Landing time on ${dayShort(checkIn)}`} error={errors.transportTime} htmlFor="qr-landing">
                  <input id="qr-landing" type="time" value={d.landingTime} onChange={(e) => onChange({ landingTime: e.target.value })} aria-invalid={!!errors.transportTime} className={cn(input, "[color-scheme:light]")} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Anything else for the driver" optional htmlFor="qr-driver">
                    <input id="qr-driver" value={d.pickupNote} onChange={(e) => onChange({ pickupNote: e.target.value })} maxLength={300} placeholder="e.g. 2 big suitcases" className={input} />
                  </Field>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
