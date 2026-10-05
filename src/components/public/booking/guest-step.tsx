"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Check, ChevronLeft, KeyRound, LoaderCircle, Lock, Pencil, Phone, Plane, Send, Smartphone, Wallet } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "../kit/button";
import { field, typeScale } from "../kit/tokens";
import fx from "../room-fx.module.css";
import { BookingProgress } from "./progress";
import { Notice, guestsLabel } from "./parts";
import { NetworkMarks } from "@/components/payments/networks";
import { identifyCustomerAction } from "@/app/order/actions";
import { usePhoneLookup, useWho } from "@/components/restaurant/who";

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

const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const payPhoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));

const TEXT_FIELDS = ["fullName", "phone", "email", "nationality", "specialRequests", "expectedArrivalTime", "company", "flightNumber", "pickupDate", "pickupTime", "airport", "passengers", "pickupNotes"] as const;

// Native date/time pickers follow the page: light on paper, dark in the dark theme.
const scheme = "[color-scheme:light] pub-dark:[color-scheme:dark]";
const optional = <span className="normal-case tracking-normal text-pub-muted">(optional)</span>;
const ease = [0.22, 1, 0.36, 1] as const;
/** A form group's HUD label: "01 ── Guest". */
const groupCls = "flex items-center gap-3 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-pub-eyebrow sm:col-span-2 sm:text-[11px]";

/**
 * Steps 3 (guest details) and 4 (review). Both steps call the server: the
 * review figures and the final booking are computed there, never here.
 * Where Pay online is on, the review offers "Pay now" first (pre-selected) and paying at the
 * hotel one tap away; each way runs its own action, exactly as before.
 */
export function GuestStep({
  selection,
  backToRoomsHref,
  reviewAction,
  confirmAction,
  payAction,
  online = false,
  arrival,
  summary,
}: {
  selection: { checkIn: string; checkOut: string; adults: number; children: number; type: string; rooms: number };
  backToRoomsHref: string;
  /** Airport transfer copy/defaults from site content. */
  arrival: { defaultAirport: string; note: string };
  reviewAction: ReviewAction;
  confirmAction: ConfirmAction;
  /** Pay online (nTZS): the booking is made and paid now — the payment confirms it. */
  payAction: ConfirmAction;
  /** Pay online is offered for room bookings now. */
  online?: boolean;
  /** Phones: the chosen room in one line, shown under the progress (desktop shows it beside the form). */
  summary?: React.ReactNode;
}) {
  const [values, setValues] = useState<Values>({
    fullName: "", phone: "", email: "", nationality: "", specialRequests: "", expectedArrivalTime: "", company: "",
    pickup: "no", flightNumber: "", pickupDate: selection.checkIn, pickupTime: "", airport: arrival.defaultAirport,
    passengers: String(selection.adults + selection.children), pickupNotes: "",
  });
  const [wantPickup, setWantPickup] = useState(false);
  // The number first (owner, 2026-10-05): this device's last number (from a booking or an order here) is filled in, and
  // someone we know is greeted by name — they type nothing more about themselves.
  const [device, setDevice] = useWho();
  const [phoneIn, setPhone] = useState<string | null>(null);
  const phone = phoneIn ?? (values.phone || device?.phone || "");
  const lookup = useCallback(async (p: string) => {
    const r = await identifyCustomerAction({ phone: p });
    return r.ok ? r.data.name : null;
  }, []);
  const guest = usePhoneLookup(phone, lookup);
  const ready = guest.step === "known" || guest.step === "new";
  // The name shown back on the review: typed, or the greeting's for a known guest (who sends no name).
  const [knownAs, setKnownAs] = useState<string | null>(null);
  const [reviewState, runReview, reviewing] = useActionState(reviewAction, undefined);
  // The review step shows once the server has priced the stay, until the guest chooses to edit.
  const [editedAfter, setEditedAfter] = useState<typeof reviewState>(undefined);
  const step: "details" | "review" = reviewState?.ok && editedAfter !== reviewState ? "review" : "details";
  const editDetails = () => setEditedAfter(reviewState);
  const [confirmState, runConfirm, confirming] = useActionState(confirmAction, undefined);
  const [payState, runPay, paying] = useActionState(payAction, undefined);
  const [payPhone, setPayPhone] = useState<string | null>(null);
  // How the guest pays (only where Pay online is on): "Pay now" is picked first.
  const [way, setWay] = useState<"now" | "later">("now");
  const payKey = useRef("");
  // A new key after an error: the next press is a new booking attempt (the same press twice is one booking).
  useEffect(() => { if (payState && !payState.ok) payKey.current = ""; }, [payState]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  const review = reviewState?.ok ? reviewState.data : null;
  const fieldErrors = reviewState && !reviewState.ok ? reviewState.fieldErrors : undefined;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    // On arrival the heading is already on screen; bring it into view only when the step changes.
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    headingRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
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
    if (guest.step === "known") v.fullName = "";
    setKnownAs(guest.step === "known" ? guest.knownName : null);
    // Remembered on this device for next time (the website menu and bookings share it).
    if (guest.step === "known") setDevice({ name: guest.knownName!, phone: v.phone.trim(), email: v.email || device?.email, known: true, address: device?.address });
    else if (v.fullName.trim().length >= 2) setDevice({ name: v.fullName.trim(), phone: v.phone.trim(), email: v.email || undefined, known: false, address: device?.address });
    setValues(v);
    startTransition(() => runReview(buildFormData(v)));
  }

  function onConfirm() {
    startTransition(() => runConfirm(buildFormData(values)));
  }

  const number = payPhone ?? values.phone;
  function onPay() {
    payKey.current ||= newKey();
    const fd = buildFormData(values);
    fd.set("payPhone", number.trim());
    fd.set("clientKey", payKey.current);
    startTransition(() => runPay(fd));
  }

  const confirmError = confirmState && !confirmState.ok ? confirmState : payState && !payState.ok ? payState : null;
  const busy = confirming || paying;
  const unavailable = confirmError?.code === "UNAVAILABLE" || (reviewState && !reviewState.ok && reviewState.code === "UNAVAILABLE");
  const payingNow = online && way === "now";

  const errorOf = (name: keyof Values) =>
    fieldErrors?.[name] ? <p id={`${name}-error`} className={field.error}>{fieldErrors[name]}</p> : null;
  const invalid = (name: keyof Values) =>
    fieldErrors?.[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {};
  const headingCls = cn(typeScale.subheading, "scroll-mt-[calc(var(--pub-header-h)+1.5rem)] outline-none");

  return (
    <div>
      <BookingProgress current={step === "details" ? 3 : 4} />
      {summary && <div className="mt-6 lg:hidden">{summary}</div>}
      <AnimatePresence mode="wait" initial={false}>
        {step === "details" ? (
          <motion.section
            key="details"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease }}
            aria-labelledby="details-title"
            className="mt-8 lg:mt-10"
          >
            <h2 id="details-title" ref={headingRef} tabIndex={-1} className={headingCls}>Your details &amp; arrival</h2>
            <p className={cn(typeScale.small, "mt-2 max-w-[34rem] text-pub-muted")}>Start with your number — if you have stayed or ordered with us before, we already know you.</p>

            {reviewState && !reviewState.ok && (
              <Notice className="mt-6">
                <p>{reviewState.error}</p>
                {unavailable && <Link href={backToRoomsHref} className="mt-2 inline-block font-medium text-pub-fg underline underline-offset-4">Choose another room</Link>}
              </Notice>
            )}

            {/* action= makes the form post to the server action even before hydration (never a GET with personal data). */}
            <form action={runReview} onSubmit={onDetailsSubmit} noValidate className={cn(fx.card, "relative mt-8 grid gap-x-4 gap-y-5 p-5 sm:grid-cols-2 sm:p-7")}>
              {Object.entries(selection).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}

              <p className={groupCls}>01<span aria-hidden="true" className="h-px w-6 bg-current opacity-60" />Guest<span aria-hidden="true" className="h-px flex-1 bg-pub-line" /></p>
              <div className="sm:col-span-2">
                <label htmlFor="phone" className={field.label}>Phone / WhatsApp <span aria-hidden="true">*</span></label>
                <span className="relative block">
                  <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-pub-faint" aria-hidden="true" />
                  <input id="phone" name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="0712 345 678" value={phone}
                    onChange={(e) => setPhone(e.target.value)} {...invalid("phone")} aria-describedby="phone-help" className={cn(field.input, "pl-11 pr-11 tabular-nums")} />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2">
                    {guest.step === "checking" ? <LoaderCircle className="size-4 animate-spin text-pub-faint" aria-hidden="true" />
                      : ready ? <span className="grid size-5 place-items-center rounded-full bg-gold text-[#16110a]"><Check className="size-3" strokeWidth={3} aria-hidden="true" /></span> : null}
                  </span>
                </span>
                {guest.step === "phone" && <p id="phone-help" className={field.hint}>e.g. 0712 345 678, or +44 7700 900123 from abroad.</p>}
                {errorOf("phone")}
              </div>

              {guest.step === "known" && (
                <div className="flex items-center gap-3 rounded-[0.75rem] border border-pub-line bg-pub-fg/[0.03] p-3 sm:col-span-2" role="status">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#15120e] font-display text-lg text-gold">{guest.knownName!.charAt(0).toUpperCase()}</span>
                  <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm text-pub-muted">Welcome back</span><span className="block truncate font-medium">{guest.knownName}</span></span>
                  <button type="button" onClick={guest.notMe} className="min-h-11 shrink-0 px-1 text-sm font-medium underline decoration-pub-line underline-offset-4 hover:decoration-gold">Not you?</button>
                  {/* A known guest sends no name: the server uses the one it has for this number. */}
                  <input type="hidden" name="fullName" value="" />
                </div>
              )}
              {guest.step === "new" && (
                <>
                  <div className="sm:col-span-2">
                    <label htmlFor="fullName" className={field.label}>Full name <span aria-hidden="true">*</span></label>
                    <input id="fullName" name="fullName" required autoComplete="name" autoCapitalize="words"
                      defaultValue={values.fullName || (device && !device.known && device.phone === phone ? device.name : "")} {...invalid("fullName")} className={field.input} />
                    {errorOf("fullName")}
                  </div>
                  <div>
                    <label htmlFor="email" className={field.label}>Email <span className="normal-case tracking-normal text-pub-muted">(recommended)</span></label>
                    <input id="email" name="email" type="email" autoComplete="email" defaultValue={values.email || (device?.phone === phone ? device.email ?? "" : "")} {...invalid("email")} className={field.input} />
                    {errorOf("email")}
                  </div>
                  <div>
                    <label htmlFor="nationality" className={field.label}>Nationality {optional}</label>
                    <input id="nationality" name="nationality" autoComplete="country-name" defaultValue={values.nationality} {...invalid("nationality")} className={field.input} />
                    {errorOf("nationality")}
                  </div>
                </>
              )}

              {ready && (<>
              <p className={cn(groupCls, "mt-4")}>02<span aria-hidden="true" className="h-px w-6 bg-current opacity-60" />Arrival<span aria-hidden="true" className="h-px flex-1 bg-pub-line" /></p>
              <div>
                <label htmlFor="expectedArrivalTime" className={field.label}>Expected arrival time <span aria-hidden="true">*</span></label>
                <input id="expectedArrivalTime" name="expectedArrivalTime" type="time" required defaultValue={values.expectedArrivalTime}
                  aria-invalid={fieldErrors?.expectedArrivalTime ? true : undefined}
                  aria-describedby={fieldErrors?.expectedArrivalTime ? "eta-help expectedArrivalTime-error" : "eta-help"}
                  className={cn(field.input, scheme)} />
                <p id="eta-help" className={field.hint}>Check-in is from {review?.checkInTime ?? "14:00"}. Late arrivals are welcome.</p>
                {errorOf("expectedArrivalTime")}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="specialRequests" className={field.label}>Special requests {optional}</label>
                <textarea id="specialRequests" name="specialRequests" rows={3} maxLength={1000} placeholder="Dietary needs, extra bed, quiet room…" defaultValue={values.specialRequests} {...invalid("specialRequests")} className={field.textarea} />
                {errorOf("specialRequests")}
              </div>

              <fieldset className="mt-2 border-y border-pub-line py-5 sm:col-span-2">
                <legend className="sr-only">Airport pickup</legend>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="flex gap-3.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-pub-eyebrow/35 text-pub-eyebrow">
                      <Plane className="size-[18px]" strokeWidth={1.4} aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-display text-[1.25rem] leading-tight" id="pickup-q">Airport pickup? <span className="font-sans text-[13px] text-pub-muted">(optional)</span></p>
                      <p className="mt-1 text-[13px] leading-relaxed text-pub-muted">{arrival.note}</p>
                    </div>
                  </div>
                  <div role="radiogroup" aria-labelledby="pickup-q" className="inline-flex shrink-0 self-start rounded-full border border-pub-line p-1 sm:self-auto">
                    {[{ v: false, l: "No thanks" }, { v: true, l: "Yes please" }].map((o) => (
                      <label
                        key={o.l}
                        className={cn(
                          "inline-flex h-11 cursor-pointer items-center rounded-full px-5 text-[13px] font-medium transition-colors duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold motion-reduce:transition-none",
                          wantPickup === o.v ? "bg-pub-fg text-[var(--pub-surface)]" : "text-pub-muted hover:text-pub-fg",
                        )}
                      >
                        <input type="radio" name="pickup" value={o.v ? "yes" : "no"} checked={wantPickup === o.v} onChange={() => setWantPickup(o.v)} className="sr-only" />
                        {o.l}
                      </label>
                    ))}
                  </div>
                </div>
                {wantPickup && (
                  <div className="mt-6 grid gap-x-4 gap-y-5 border-t border-pub-line pt-6 sm:grid-cols-2 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-300">
                    <div>
                      <label htmlFor="flightNumber" className={field.label}>Flight number <span aria-hidden="true">*</span></label>
                      <input id="flightNumber" name="flightNumber" autoComplete="off" placeholder="e.g. KQ484" defaultValue={values.flightNumber} {...invalid("flightNumber")} className={cn(field.input, "uppercase")} />
                      {errorOf("flightNumber")}
                    </div>
                    <div>
                      <label htmlFor="passengers" className={field.label}>Passengers</label>
                      <input id="passengers" name="passengers" type="number" min={1} max={20} inputMode="numeric" defaultValue={values.passengers} {...invalid("passengers")} className={field.input} />
                      {errorOf("passengers")}
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="pickupDate" className={field.label}>Arrival date <span aria-hidden="true">*</span></label>
                      <input id="pickupDate" name="pickupDate" type="date" defaultValue={values.pickupDate} {...invalid("pickupDate")} className={cn(field.input, "min-w-0", scheme)} />
                      {errorOf("pickupDate")}
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="pickupTime" className={field.label}>Arrival time (local) <span aria-hidden="true">*</span></label>
                      <input id="pickupTime" name="pickupTime" type="time" defaultValue={values.pickupTime} {...invalid("pickupTime")} className={cn(field.input, "min-w-0", scheme)} />
                      {errorOf("pickupTime")}
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="airport" className={field.label}>Airport</label>
                      <input id="airport" name="airport" defaultValue={values.airport} {...invalid("airport")} className={field.input} />
                      {errorOf("airport")}
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="pickupNotes" className={field.label}>Instructions for the driver {optional}</label>
                      <textarea id="pickupNotes" name="pickupNotes" rows={2} maxLength={500} placeholder="Luggage, meeting point, anything we should know…" defaultValue={values.pickupNotes} {...invalid("pickupNotes")} className={field.textarea} />
                      {errorOf("pickupNotes")}
                    </div>
                  </div>
                )}
              </fieldset>
              </>)}
              {/* Honeypot — hidden from people and assistive tech. */}
              <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
                <label htmlFor="company">Company</label>
                <input id="company" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
              </div>
              <div className="flex flex-col-reverse gap-4 pt-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                <Link
                  href={backToRoomsHref}
                  className={cn(typeScale.cta, "inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm text-pub-muted transition-colors duration-200 hover:text-pub-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none sm:self-auto")}
                >
                  <ChevronLeft className="size-4" strokeWidth={1.6} aria-hidden="true" /> Back to rooms
                </Link>
                <Button type="submit" disabled={reviewing || !ready} icon={reviewing ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : "arrow"} className="w-full sm:w-auto sm:min-w-60">
                  {reviewing ? "Checking…" : online ? "Review booking" : "Review request"}
                </Button>
              </div>
            </form>
          </motion.section>
        ) : (
          <motion.section
            key="review"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease }}
            aria-labelledby="review-title"
            className="mt-8 lg:mt-10"
          >
            <h2 id="review-title" ref={headingRef} tabIndex={-1} className={headingCls}>{online ? "Review and confirm" : "Review your booking"}</h2>
            <p className={cn(typeScale.small, "mt-2 max-w-[36rem] text-pub-muted")}>{online
              ? "Check everything below. Pay now and your room is confirmed the moment the payment is approved — or book now and pay later (the room is not reserved until it is paid)."
              : "Check everything below, then book. Nothing is charged online — and the room is not reserved until it is paid."}</p>

            {confirmError && (
              <Notice className="mt-6" title={unavailable ? "Availability changed while you were choosing." : payState && !payState.ok ? "We couldn’t start your payment." : "We couldn’t make your booking."}>
                <p>{confirmError.error}</p>
                {unavailable && <Link href={backToRoomsHref} className="mt-2 inline-block font-medium text-pub-fg underline underline-offset-4">See rooms still available</Link>}
              </Notice>
            )}

            {review && (
              <div className="mt-8 space-y-6 sm:space-y-8">
                <dl className={cn(fx.card, "relative px-5 py-1 text-[15px] sm:px-7 sm:py-2")}>
                  <ReviewRow term="Room">
                    <span className="font-display text-[1.375rem] leading-tight">{review.rooms > 1 ? `${review.rooms} × ` : ""}{review.typeName}</span>
                  </ReviewRow>
                  <ReviewRow term="Check-in">
                    {review.checkIn}
                    <span className="block text-[13px] text-pub-muted">from {review.checkInTime}</span>
                  </ReviewRow>
                  <ReviewRow term="Check-out">
                    {review.checkOut}
                    <span className="block text-[13px] text-pub-muted">by {review.checkoutTime}</span>
                  </ReviewRow>
                  <ReviewRow term="Stay">
                    {review.nights} night{review.nights === 1 ? "" : "s"} · {guestsLabel(review.adults, review.children)}
                  </ReviewRow>
                  <ReviewRow term="Guest" action={<EditButton onClick={editDetails} />}>
                    <span className="font-medium">{values.fullName || knownAs}</span>
                    <span className="block text-pub-muted">{values.phone}{values.email && ` · ${values.email}`}</span>
                    {values.nationality && <span className="block text-pub-muted">{values.nationality}</span>}
                    <span className="block text-pub-muted">Expected arrival {values.expectedArrivalTime}</span>
                  </ReviewRow>
                  {values.specialRequests && (
                    <ReviewRow term="Requests">
                      <span className="text-pub-muted">“{values.specialRequests}”</span>
                    </ReviewRow>
                  )}
                  <ReviewRow term="Arrival">
                    {review.pickup ? (
                      <>
                        <span className="font-medium">Airport pickup · flight {review.pickup.flightNumber}</span>
                        <span className="block text-pub-muted">{review.pickup.date} at {review.pickup.time} · {review.pickup.airport} · {review.pickup.passengers} passenger{review.pickup.passengers === 1 ? "" : "s"}</span>
                        <span className="block text-[13px] text-pub-muted">We’ll confirm your pickup by phone or WhatsApp.</span>
                      </>
                    ) : (
                      <span className="text-pub-muted">
                        {arrival.note}{" "}
                        <button type="button" onClick={editDetails} className="inline-flex min-h-11 items-center font-medium text-pub-fg underline decoration-gold underline-offset-4 focus-visible:outline-2 focus-visible:outline-gold">
                          Add a pickup
                        </button>
                      </span>
                    )}
                  </ReviewRow>
                </dl>

                {/* The amount and how to pay: one dark panel, the page's single focal point. */}
                <div data-tone="night" className={cn(fx.night, "relative p-5 text-pub-fg sm:p-7")}>
                  <span aria-hidden="true" className="pub-hud-corners" style={{ "--hud-o": "-0.625rem", "--hud-l": "0.875rem" } as React.CSSProperties} />
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <span className="inline-flex items-center gap-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-pub-muted sm:text-[11px]">
                      <span aria-hidden="true" className="h-px w-3.5 bg-gold" />
                      {payingNow ? "Total to pay" : "Your estimate"}
                    </span>
                    <span aria-hidden="true" className="font-mono text-[10px] uppercase tracking-[0.2em] text-pub-faint sm:text-[11px]">TZS</span>
                  </div>
                  <dl className="space-y-3 text-[14px]">
                    <div className="flex justify-between gap-4">
                      <dt className="text-pub-muted">{formatTZS(review.ratePerNight)} × {review.nights} night{review.nights === 1 ? "" : "s"}{review.rooms > 1 ? ` × ${review.rooms} rooms` : ""}</dt>
                      <dd className="tabular-nums">{formatTZS(review.grossAmount)}</dd>
                    </div>
                    {review.discountAmount > 0 && (
                      <div className="flex justify-between gap-4 text-gold">
                        <dt>Website discount ({formatTZS(review.discountPerNight)} / night)</dt>
                        <dd className="shrink-0 tabular-nums">− {formatTZS(review.discountAmount)}</dd>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between gap-4 border-t border-pub-line pt-4">
                      <dt className={cn(typeScale.meta, "text-pub-muted")}>{payingNow ? "Total" : "Estimated total"}</dt>
                      <dd className="font-display text-[clamp(1.75rem,1.4rem+1.2vw,2.25rem)] leading-none text-gold lining-nums tabular-nums">{formatTZS(review.netAmount)}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-pub-muted">{payingNow
                    ? "Breakfast and Wi-Fi included. Paying now, this is the amount you pay — no card details are needed."
                    : "Breakfast and Wi-Fi included. Not reserved until paid — pay any time by mobile money from your booking page."}</p>

                  {online ? (
                    <div className="mt-6">
                      <p id="pay-way" className={cn(typeScale.eyebrow, "text-gold")}>How would you like to pay?</p>
                      <div role="radiogroup" aria-labelledby="pay-way" className="mt-3 overflow-hidden rounded-[0.875rem] border border-pub-line">
                        <WayRow
                          on={way === "now"}
                          onSelect={() => setWay("now")}
                          icon={<Smartphone className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />}
                          title="Pay now"
                          sub={<NetworkMarks label={null} compact dark />}
                        >
                          <div className="space-y-4">
                            <label className="block">
                              <span className={field.label}>Mobile-money number</span>
                              <input value={number} onChange={(e) => setPayPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 0712 345 678"
                                aria-invalid={number !== "" && !payPhoneOk(number)}
                                className={cn(field.input, "tracking-wide tabular-nums [color-scheme:dark] aria-invalid:border-amber-400/80")} />
                            </label>
                            <ol className="grid grid-cols-3 gap-2 text-center">
                              {[
                                { t: "Check your phone", i: BellRing },
                                { t: "Enter your PIN", i: KeyRound },
                                { t: "Room confirmed", i: Check },
                              ].map(({ t, i: Icon }) => (
                                <li key={t} className="min-w-0">
                                  <span className="mx-auto grid size-8 place-items-center rounded-full border border-gold/40 text-gold"><Icon className="size-3.5" strokeWidth={1.8} aria-hidden="true" /></span>
                                  <span className="mt-1.5 block text-[11px] leading-tight text-pub-muted">{t}</span>
                                </li>
                              ))}
                            </ol>
                            <p className="text-[12.5px] leading-relaxed text-pub-muted">You will get a payment request on your phone — enter your PIN to pay. We hold your room while you pay.</p>
                          </div>
                        </WayRow>
                        <WayRow
                          on={way === "later"}
                          onSelect={() => setWay("later")}
                          icon={<Wallet className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />}
                          title="Pay later"
                          sub="Not reserved until paid — pay any time from your booking"
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-6">
                    {payingNow ? (
                      <Button
                        onClick={onPay}
                        disabled={busy || Boolean(unavailable) || !payPhoneOk(number)}
                        full
                        className="h-auto min-h-10 whitespace-normal py-2.5 text-center"
                        icon={paying ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Lock className="size-4" strokeWidth={1.8} aria-hidden="true" />}
                      >
                        {paying ? "Booking your room…" : `Pay ${formatTZS(review.netAmount)}`}
                      </Button>
                    ) : (
                      <Button
                        onClick={onConfirm}
                        disabled={busy || Boolean(unavailable)}
                        full
                        className="h-auto min-h-10 whitespace-normal py-2.5 text-center"
                        icon={confirming ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" strokeWidth={1.6} aria-hidden="true" />}
                      >
                        {confirming ? "Booking…" : "Book — pay later"}
                      </Button>
                    )}
                    {payingNow && (
                      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-pub-muted">
                        <Lock className="size-3 text-gold" strokeWidth={1.8} aria-hidden="true" />Secure payment by <span className="font-semibold tracking-wide text-pub-fg/85">NTZS</span>
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={editDetails}
                      className={cn(typeScale.cta, "mt-2 flex min-h-11 w-full items-center justify-center rounded-sm text-pub-muted transition-colors duration-200 hover:text-pub-fg focus-visible:outline-2 focus-visible:outline-gold motion-reduce:transition-none")}
                    >
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

/** One line of the review: the term on the left (desktop), the value, an optional action. */
function ReviewRow({ term, action, children }: { term: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-pub-line py-4 last:border-b-0 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-6">
      <dt className={cn(typeScale.meta, "flex items-center justify-between gap-3 text-pub-muted sm:block sm:pt-1")}>
        {term}
        {action && <span className="sm:hidden">{action}</span>}
      </dt>
      <dd className="flex min-w-0 items-start justify-between gap-4 text-pub-fg">
        <span className="min-w-0">{children}</span>
        {action && <span className="hidden shrink-0 sm:block">{action}</span>}
      </dd>
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-sm px-1 text-[13px] font-medium text-pub-eyebrow transition-colors duration-200 hover:text-pub-fg focus-visible:outline-2 focus-visible:outline-gold motion-reduce:transition-none"
    >
      <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden="true" />Edit<span className="sr-only"> your details</span>
    </button>
  );
}

/** One way to pay: a full-width radio row; the chosen one opens in place with what it needs. */
function WayRow({ on, onSelect, icon, title, sub, children }: {
  on: boolean; onSelect: () => void; icon: React.ReactNode; title: string; sub: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className={cn("border-b border-pub-line transition-colors duration-200 last:border-b-0 motion-reduce:transition-none", on ? "bg-white/[0.045]" : "hover:bg-white/[0.025]")}>
      <button type="button" role="radio" aria-checked={on} onClick={onSelect} className="flex min-h-16 w-full items-center gap-3.5 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-full border transition-colors duration-200", on ? "border-gold/60 text-gold" : "border-pub-line text-pub-muted")}>{icon}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[15px] font-medium text-pub-fg">{title}</span>
          <span className="mt-1.5 block text-[12px] text-pub-muted">{sub}</span>
        </span>
        <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200", on ? "border-gold bg-gold text-[#16110a]" : "border-pub-faint")}>
          {on && <Check className="size-3" strokeWidth={3} />}
        </span>
      </button>
      {on && children && <div className="px-4 pb-5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">{children}</div>}
    </div>
  );
}
