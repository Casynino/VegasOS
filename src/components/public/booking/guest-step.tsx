"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, ChevronLeft, LoaderCircle, Pencil, Plane, Send } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowBadge } from "../pill-link";
import { fieldError, fieldInput, fieldLabel, fieldTextarea, pillGold, type } from "../ui";
import { BookingProgress } from "./progress";

/** Structural copy of the review payload returned by reviewBookingAction. */
export interface ReviewData {
  typeName: string;
  rooms: number;
  nights: number;
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkoutTime: string;
  adults: number;
  children: number;
  ratePerNight: number;
  discountPerNight: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  pickup: { flightNumber: string; date: string; time: string; airport: string; passengers: number } | null;
}

type ReviewAction = (prev: ActionResult<ReviewData> | undefined, fd: FormData) => Promise<ActionResult<ReviewData>>;
type ConfirmAction = (prev: ActionResult<null> | undefined, fd: FormData) => Promise<ActionResult<null>>;

interface Values {
  fullName: string;
  phone: string;
  email: string;
  nationality: string;
  specialRequests: string;
  expectedArrivalTime: string;
  company: string;
  pickup: "yes" | "no";
  flightNumber: string;
  pickupDate: string;
  pickupTime: string;
  airport: string;
  passengers: string;
  pickupNotes: string;
}

const TEXT_FIELDS = ["fullName", "phone", "email", "nationality", "specialRequests", "expectedArrivalTime", "company", "flightNumber", "pickupDate", "pickupTime", "airport", "passengers", "pickupNotes"] as const;

/**
 * Steps 3 (guest details) and 4 (review). Both steps call the server: the
 * review figures and the final booking are computed there, never here.
 */
export function GuestStep({
  selection,
  backToRoomsHref,
  reviewAction,
  confirmAction,
  arrival,
}: {
  selection: { checkIn: string; checkOut: string; adults: number; children: number; type: string; rooms: number };
  backToRoomsHref: string;
  /** Airport transfer copy/defaults from site content. */
  arrival: { defaultAirport: string; note: string };
  reviewAction: ReviewAction;
  confirmAction: ConfirmAction;
}) {
  const [values, setValues] = useState<Values>({
    fullName: "", phone: "", email: "", nationality: "", specialRequests: "", expectedArrivalTime: "", company: "",
    pickup: "no", flightNumber: "", pickupDate: selection.checkIn, pickupTime: "", airport: arrival.defaultAirport,
    passengers: String(selection.adults + selection.children), pickupNotes: "",
  });
  const [wantPickup, setWantPickup] = useState(false);
  const [reviewState, runReview, reviewing] = useActionState(reviewAction, undefined);
  // The review step shows once the server has priced the stay, until the guest chooses to edit.
  const [editedAfter, setEditedAfter] = useState<typeof reviewState>(undefined);
  const step: "details" | "review" = reviewState?.ok && editedAfter !== reviewState ? "review" : "details";
  const editDetails = () => setEditedAfter(reviewState);
  const [confirmState, runConfirm, confirming] = useActionState(confirmAction, undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const review = reviewState?.ok ? reviewState.data : null;
  const fieldErrors = reviewState && !reviewState.ok ? reviewState.fieldErrors : undefined;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  function buildFormData(v: Values) {
    const fd = new FormData();
    for (const [k, val] of Object.entries(selection)) fd.set(k, String(val));
    for (const [k, val] of Object.entries(v)) fd.set(k, val);
    return fd;
  }

  function onDetailsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = { ...values, pickup: wantPickup ? "yes" : "no" } as Values;
    for (const k of TEXT_FIELDS) {
      const raw = fd.get(k);
      if (raw !== null) v[k] = String(raw);
    }
    setValues(v);
    startTransition(() => runReview(buildFormData(v)));
  }

  function onConfirm() {
    startTransition(() => runConfirm(buildFormData(values)));
  }

  const confirmError = confirmState && !confirmState.ok ? confirmState : null;
  const unavailable = confirmError?.code === "UNAVAILABLE" || (reviewState && !reviewState.ok && reviewState.code === "UNAVAILABLE");

  return (
    <div>
      <BookingProgress current={step === "details" ? 3 : 4} className="mb-10" />
      <AnimatePresence mode="wait" initial={false}>
        {step === "details" ? (
          <motion.section
            key="details"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            aria-labelledby="details-title"
          >
            <h2 id="details-title" ref={headingRef} tabIndex={-1} className={cn("scroll-mt-28 outline-none", type.h3)}>Your details &amp; arrival</h2>
            <p className="mt-2 text-tone/65">Our reservations team uses these details to contact you and confirm your room.</p>

            {reviewState && !reviewState.ok && (
              <div role="alert" className="mt-6 flex gap-3 rounded-2xl border border-red-700/20 bg-red-50 p-4 text-sm text-red-900">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div>
                  <p>{reviewState.error}</p>
                  {unavailable && <Link href={backToRoomsHref} className="mt-2 inline-block font-medium underline underline-offset-2">Choose another room</Link>}
                </div>
              </div>
            )}

            {/* action= makes the form post to the server action even before hydration (never a GET with personal data). */}
            <form action={runReview} onSubmit={onDetailsSubmit} noValidate className="mt-8 grid gap-5 sm:grid-cols-2">
              {Object.entries(selection).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
              <div className="sm:col-span-2">
                <label htmlFor="fullName" className={fieldLabel}>Full name <span aria-hidden="true">*</span></label>
                <input id="fullName" name="fullName" required autoComplete="name" defaultValue={values.fullName}
                  aria-invalid={fieldErrors?.fullName ? true : undefined} aria-describedby={fieldErrors?.fullName ? "fullName-error" : undefined} className={fieldInput} />
                {fieldErrors?.fullName && <p id="fullName-error" className={fieldError}>{fieldErrors.fullName}</p>}
              </div>
              <div>
                <label htmlFor="phone" className={fieldLabel}>Phone / WhatsApp <span aria-hidden="true">*</span></label>
                <input id="phone" name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="+255 7XX XXX XXX" defaultValue={values.phone}
                  aria-invalid={fieldErrors?.phone ? true : undefined} aria-describedby={fieldErrors?.phone ? "phone-error" : undefined} className={fieldInput} />
                {fieldErrors?.phone && <p id="phone-error" className={fieldError}>{fieldErrors.phone}</p>}
              </div>
              <div>
                <label htmlFor="email" className={fieldLabel}>Email <span className="normal-case tracking-normal text-tone/50">(recommended)</span></label>
                <input id="email" name="email" type="email" autoComplete="email" defaultValue={values.email}
                  aria-invalid={fieldErrors?.email ? true : undefined} aria-describedby={fieldErrors?.email ? "email-error" : undefined} className={fieldInput} />
                {fieldErrors?.email && <p id="email-error" className={fieldError}>{fieldErrors.email}</p>}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="nationality" className={fieldLabel}>Nationality <span className="normal-case tracking-normal text-tone/50">(optional)</span></label>
                <input id="nationality" name="nationality" autoComplete="country-name" defaultValue={values.nationality}
                  aria-invalid={fieldErrors?.nationality ? true : undefined} className={fieldInput} />
                {fieldErrors?.nationality && <p className={fieldError}>{fieldErrors.nationality}</p>}
              </div>
              <div className="sm:col-span-2 pt-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent-ink">Arrival</p>
              </div>
              <div>
                <label htmlFor="expectedArrivalTime" className={fieldLabel}>Expected arrival time <span aria-hidden="true">*</span></label>
                <input id="expectedArrivalTime" name="expectedArrivalTime" type="time" required defaultValue={values.expectedArrivalTime}
                  aria-invalid={fieldErrors?.expectedArrivalTime ? true : undefined} aria-describedby="eta-help" className={fieldInput} />
                <p id="eta-help" className="mt-1.5 text-xs text-tone/55">Check-in is from {review?.checkInTime ?? "14:00"}. Late arrivals are welcome.</p>
                {fieldErrors?.expectedArrivalTime && <p className={fieldError}>{fieldErrors.expectedArrivalTime}</p>}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="specialRequests" className={fieldLabel}>Special requests <span className="normal-case tracking-normal text-tone/50">(optional)</span></label>
                <textarea id="specialRequests" name="specialRequests" rows={3} maxLength={1000} placeholder="Dietary needs, extra bed, quiet room…" defaultValue={values.specialRequests}
                  aria-invalid={fieldErrors?.specialRequests ? true : undefined} className={fieldTextarea} />
                {fieldErrors?.specialRequests && <p className={fieldError}>{fieldErrors.specialRequests}</p>}
              </div>
              <fieldset className="rounded-3xl bg-panel p-5 ring-1 ring-tone/[0.07] sm:col-span-2 sm:p-6">
                <legend className="sr-only">Airport pickup</legend>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#15120e] text-gold"><Plane className="size-4" aria-hidden="true" /></span>
                    <div>
                      <p className="font-medium" id="pickup-q">Airport pickup? <span className="font-normal text-tone/55">(optional)</span></p>
                      <p className="text-sm text-tone/60">{arrival.note}</p>
                    </div>
                  </div>
                  <div role="radiogroup" aria-labelledby="pickup-q" className="inline-flex shrink-0 rounded-full bg-paper p-1">
                    {[{ v: false, l: "No thanks" }, { v: true, l: "Yes please" }].map((o) => (
                      <label key={o.l} className={cn("cursor-pointer rounded-full px-4 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold", wantPickup === o.v ? "bg-[#15120e] text-white" : "text-tone/70")}>
                        <input type="radio" name="pickup" value={o.v ? "yes" : "no"} checked={wantPickup === o.v} onChange={() => setWantPickup(o.v)} className="sr-only" />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>
                {wantPickup && (
                  <div className="mt-6 grid gap-4 border-t border-tone/10 pt-6 sm:grid-cols-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-300">
                    <div>
                      <label htmlFor="flightNumber" className={fieldLabel}>Flight number <span aria-hidden="true">*</span></label>
                      <input id="flightNumber" name="flightNumber" autoComplete="off" placeholder="e.g. KQ484" defaultValue={values.flightNumber}
                        aria-invalid={fieldErrors?.flightNumber ? true : undefined} className={cn(fieldInput, "uppercase")} />
                      {fieldErrors?.flightNumber && <p className={fieldError}>{fieldErrors.flightNumber}</p>}
                    </div>
                    <div>
                      <label htmlFor="passengers" className={fieldLabel}>Passengers</label>
                      <input id="passengers" name="passengers" type="number" min={1} max={20} inputMode="numeric" defaultValue={values.passengers}
                        aria-invalid={fieldErrors?.passengers ? true : undefined} className={fieldInput} />
                      {fieldErrors?.passengers && <p className={fieldError}>{fieldErrors.passengers}</p>}
                    </div>
                    <div>
                      <label htmlFor="pickupDate" className={fieldLabel}>Arrival date <span aria-hidden="true">*</span></label>
                      <input id="pickupDate" name="pickupDate" type="date" defaultValue={values.pickupDate}
                        aria-invalid={fieldErrors?.pickupDate ? true : undefined} className={cn(fieldInput, "[color-scheme:light]")} />
                      {fieldErrors?.pickupDate && <p className={fieldError}>{fieldErrors.pickupDate}</p>}
                    </div>
                    <div>
                      <label htmlFor="pickupTime" className={fieldLabel}>Arrival time (local) <span aria-hidden="true">*</span></label>
                      <input id="pickupTime" name="pickupTime" type="time" defaultValue={values.pickupTime}
                        aria-invalid={fieldErrors?.pickupTime ? true : undefined} className={cn(fieldInput, "[color-scheme:light]")} />
                      {fieldErrors?.pickupTime && <p className={fieldError}>{fieldErrors.pickupTime}</p>}
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="airport" className={fieldLabel}>Airport</label>
                      <input id="airport" name="airport" defaultValue={values.airport} className={fieldInput} />
                      {fieldErrors?.airport && <p className={fieldError}>{fieldErrors.airport}</p>}
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="pickupNotes" className={fieldLabel}>Instructions for the driver <span className="normal-case tracking-normal text-tone/50">(optional)</span></label>
                      <textarea id="pickupNotes" name="pickupNotes" rows={2} maxLength={500} placeholder="Luggage, meeting point, anything we should know…" defaultValue={values.pickupNotes} className={fieldTextarea} />
                      {fieldErrors?.pickupNotes && <p className={fieldError}>{fieldErrors.pickupNotes}</p>}
                    </div>
                  </div>
                )}
              </fieldset>
              {/* Honeypot — hidden from people and assistive tech. */}
              <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
                <label htmlFor="company">Company</label>
                <input id="company" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
              </div>
              <div className="flex flex-col-reverse gap-4 pt-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                <Link href={backToRoomsHref} className="inline-flex items-center gap-1.5 text-sm text-tone/70 hover:text-tone">
                  <ChevronLeft className="size-4" aria-hidden="true" /> Back to rooms
                </Link>
                <button type="submit" disabled={reviewing} className={cn(pillGold, "h-12 justify-between py-1.5 pl-6 pr-1.5 sm:min-w-64")}>
                  <span className="relative inline-flex items-center gap-2">
                    {reviewing && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                    {reviewing ? "Checking…" : "Review request"}
                  </span>
                  <ArrowBadge />
                </button>
              </div>
            </form>
          </motion.section>
        ) : (
          <motion.section
            key="review"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            aria-labelledby="review-title"
          >
            <h2 id="review-title" ref={headingRef} tabIndex={-1} className={cn("scroll-mt-28 outline-none", type.h3)}>Review your request</h2>
            <p className="mt-2 text-tone/65">Check everything below, then send it to our team. Nothing is charged online, and your room is confirmed only when our team contacts you.</p>

            {confirmError && (
              <div role="alert" className="mt-6 flex gap-3 rounded-2xl border border-red-700/20 bg-red-50 p-4 text-sm text-red-900">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">{unavailable ? "Availability changed while you were choosing." : "We couldn’t send your request."}</p>
                  <p className="mt-1">{confirmError.error}</p>
                  {unavailable && <Link href={backToRoomsHref} className="mt-2 inline-block font-medium underline underline-offset-2">See rooms still available</Link>}
                </div>
              </div>
            )}

            {review && (
              <div className="mt-8 grid gap-5 lg:grid-cols-2">
                <dl className="rounded-3xl bg-panel p-6 ring-1 ring-tone/[0.07] sm:p-7">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="sr-only">Room</dt>
                    <dd className="font-display text-2xl">{review.rooms > 1 ? `${review.rooms} × ` : ""}{review.typeName}</dd>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-4 border-t border-tone/10 pt-5 text-sm">
                    <div><dt className="text-tone/55">Check-in</dt><dd className="mt-1 font-medium">{review.checkIn}</dd><dd className="text-tone/60">from {review.checkInTime}</dd></div>
                    <div><dt className="text-tone/55">Check-out</dt><dd className="mt-1 font-medium">{review.checkOut}</dd><dd className="text-tone/60">by {review.checkoutTime}</dd></div>
                    <div><dt className="text-tone/55">Nights</dt><dd className="mt-1 font-medium">{review.nights}</dd></div>
                    <div><dt className="text-tone/55">Guests</dt><dd className="mt-1 font-medium">{review.adults} adult{review.adults === 1 ? "" : "s"}{review.children ? `, ${review.children} child${review.children === 1 ? "" : "ren"}` : ""}</dd></div>
                  </div>
                  <div className="mt-5 border-t border-tone/10 pt-5 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="text-tone/55">Guest</dt>
                      <dd><button type="button" onClick={editDetails} className="inline-flex items-center gap-1 text-accent-ink underline-offset-2 hover:underline"><Pencil className="size-3.5" aria-hidden="true" />Edit</button></dd>
                    </div>
                    <dd className="mt-1 font-medium">{values.fullName}</dd>
                    <dd className="text-tone/65">{values.phone}{values.email && ` · ${values.email}`}</dd>
                    {values.nationality && <dd className="text-tone/65">{values.nationality}</dd>}
                    <dd className="text-tone/65">Expected arrival {values.expectedArrivalTime}</dd>
                    {values.specialRequests && <dd className="mt-2 rounded-xl bg-paper p-3 text-tone/75">“{values.specialRequests}”</dd>}
                  </div>
                  <div className="mt-5 border-t border-tone/10 pt-5 text-sm">
                    <dt className="flex items-center gap-2 text-tone/55"><Plane className="size-4" aria-hidden="true" />Arrival</dt>
                    {review.pickup ? (
                      <>
                        <dd className="mt-1 font-medium">Airport pickup requested · flight {review.pickup.flightNumber}</dd>
                        <dd className="text-tone/65">{review.pickup.date} at {review.pickup.time} · {review.pickup.airport} · {review.pickup.passengers} passenger{review.pickup.passengers === 1 ? "" : "s"}</dd>
                        <dd className="mt-1 text-tone/65">We’ll confirm your pickup by phone or WhatsApp.</dd>
                      </>
                    ) : (
                      <dd className="mt-1 text-tone/65">{arrival.note} <button type="button" onClick={editDetails} className="text-accent-ink underline underline-offset-2">Add a pickup</button></dd>
                    )}
                  </div>
                </dl>

                <div className="flex flex-col rounded-3xl bg-[#15120e] p-6 text-white sm:p-7">
                  <dl className="space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-white/65">{formatTZS(review.ratePerNight)} × {review.nights} night{review.nights === 1 ? "" : "s"}{review.rooms > 1 ? ` × ${review.rooms} rooms` : ""}</dt>
                      <dd>{formatTZS(review.grossAmount)}</dd>
                    </div>
                    {review.discountAmount > 0 && (
                      <div className="flex justify-between gap-4 text-gold">
                        <dt>Website discount ({formatTZS(review.discountPerNight)} / night)</dt>
                        <dd>− {formatTZS(review.discountAmount)}</dd>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between gap-4 border-t border-white/15 pt-4">
                      <dt className="font-medium">Estimated total</dt>
                      <dd className="font-display text-3xl font-semibold text-gold">{formatTZS(review.netAmount)}</dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-xs text-white/55">Breakfast and Wi-Fi included. The final price is confirmed by our team; you pay at reception — no card details are needed online.</p>
                  <div className="mt-auto pt-6">
                    <button type="button" onClick={onConfirm} disabled={confirming || Boolean(unavailable)} className={cn(pillGold, "h-13 w-full justify-between py-1.5 pl-6 pr-1.5 text-base")}>
                      <span className="relative inline-flex items-center gap-2">
                        {confirming ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                        {confirming ? "Sending your request…" : "Send booking request"}
                      </span>
                      <ArrowBadge />
                    </button>
                    <button type="button" onClick={editDetails} className="mt-3 w-full text-center text-sm text-white/65 hover:text-white">
                      Back to details
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
