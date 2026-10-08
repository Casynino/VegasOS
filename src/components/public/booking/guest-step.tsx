"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellRing, Check, ChevronDown, ChevronLeft, KeyRound, LoaderCircle, Lock, Phone, Plane, Send, Smartphone, Wallet } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "../kit/button";
import { field, typeScale } from "../kit/tokens";
import fx from "../room-fx.module.css";
import { BookingProgress } from "./progress";
import { Notice } from "./parts";
import { NetworkMarks } from "@/components/payments/networks";
import { identifyCustomerAction } from "@/app/order/actions";
import { usePhoneLookup, useWho } from "@/components/restaurant/who";

type BookAction = (prev: ActionResult<null> | undefined, fd: FormData) => Promise<ActionResult<null>>;

/** The stay as priced on the server for this screen (the server prices it again when booking). */
export interface StayPrice {
  total: number;
  gross: number;
  discount: number;
  ratePerNight: number;
  nights: number;
  rooms: number;
  checkInTime: string;
}

const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const payPhoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));
// Native date/time pickers follow the page: light on paper, dark in the dark theme.
const scheme = "[color-scheme:light] pub-dark:[color-scheme:dark]";
/** The fields folded under "Add more (optional)" — an error in one opens the fold. */
const EXTRA_FIELDS = ["email", "nationality", "expectedArrivalTime", "specialRequests", "flightNumber", "pickupDate", "pickupTime", "airport", "passengers", "pickupNotes"];

/**
 * BOOK & PAY — one screen (owner, 2026-10-05: "booking should be as easy as getting food from us — very few steps,
 * book and pay direct"). The phone first: someone we know is greeted by name and types nothing more; someone new adds
 * their name. Everything else (email, arrival time, a request, airport pickup) is folded away as optional. Then how to
 * pay — Pay now (mobile money, nTZS) first and chosen, or Pay later (not reserved until paid) — and ONE button that
 * books: "Pay TZS X now" (the payment page next) or "Book — pay later" (the booking's page next). The server checks
 * and prices everything again; nothing here decides the price.
 */
export function GuestStep({
  selection,
  backToRoomsHref,
  confirmAction,
  payAction,
  online = false,
  arrival,
  price,
  summary,
  stayEditor,
}: {
  selection: { checkIn: string; checkOut: string; adults: number; children: number; type: string; rooms: number };
  backToRoomsHref: string;
  /** Airport transfer copy/defaults from site content. */
  arrival: { defaultAirport: string; note: string };
  /** Book now, pay later: the booking is made, no room held until it is paid. */
  confirmAction: BookAction;
  /** Pay online (nTZS): the booking is made and paid now — the payment confirms it. */
  payAction: BookAction;
  /** Pay online is offered for room bookings now. */
  online?: boolean;
  price: StayPrice;
  /** Phones: the chosen room in one line, shown under the progress (desktop shows it beside the form). */
  summary?: React.ReactNode;
  /** The dates and guests, changeable right here (StayEditor). */
  stayEditor?: React.ReactNode;
}) {
  const t = useT();
  const optional = <span className="normal-case tracking-normal text-pub-muted">{t("(optional)")}</span>;
  // ── Who: the number first (this device's last number is filled in) ──
  const [device, setDevice] = useWho();
  const [phoneIn, setPhone] = useState<string | null>(null);
  const phone = phoneIn ?? device?.phone ?? "";
  const lookup = useCallback(async (p: string) => {
    const r = await identifyCustomerAction({ phone: p });
    return r.ok ? r.data.name : null;
  }, []);
  const guest = usePhoneLookup(phone, lookup);
  const known = guest.step === "known";
  const ready = known || guest.step === "new";

  // ── The extras, folded ──
  const [moreOpen, setMoreOpen] = useState(false);
  const [wantPickup, setWantPickup] = useState(false);

  // ── Paying ──
  const [way, setWay] = useState<"now" | "later">(online ? "now" : "later");
  const payingNow = online && way === "now";
  const [payPhoneIn, setPayPhone] = useState<string | null>(null);
  const number = payPhoneIn ?? phone;
  const [confirmState, runConfirm, confirming] = useActionState(confirmAction, undefined);
  const [payState, runPay, paying] = useActionState(payAction, undefined);
  const payKey = useRef("");
  // A new key after an error: the next press is a new booking attempt (the same press twice is one booking).
  useEffect(() => { if (payState && !payState.ok) payKey.current = ""; }, [payState]);
  const busy = confirming || paying;

  // The latest answer (only one of the two runs per press).
  const last = payingNow ? payState : confirmState;
  const failed = last && !last.ok ? last : null;
  const fieldErrors = failed?.fieldErrors;
  const unavailable = failed?.code === "UNAVAILABLE";
  const moreShown = moreOpen || Object.keys(fieldErrors ?? {}).some((k) => EXTRA_FIELDS.includes(k));

  const errorOf = (name: string) => (fieldErrors?.[name] ? <p id={`${name}-error`} className={field.error}>{fieldErrors[name]}</p> : null);
  const invalid = (name: string) => (fieldErrors?.[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || busy) return;
    const fd = new FormData(e.currentTarget);
    fd.set("pickup", wantPickup ? "yes" : "no");
    fd.set("phone", phone.trim());
    if (known) fd.set("fullName", "");
    // Remembered on this device for next time (the website menu and bookings share it).
    const typed = String(fd.get("fullName") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    if (known) setDevice({ name: guest.knownName!, phone: phone.trim(), email: email || device?.email, known: true, address: device?.address });
    else if (typed.length >= 2) setDevice({ name: typed, phone: phone.trim(), email: email || undefined, known: false, address: device?.address });
    if (payingNow) {
      payKey.current ||= newKey();
      fd.set("payPhone", number.trim());
      fd.set("clientKey", payKey.current);
      startTransition(() => runPay(fd));
    } else {
      startTransition(() => runConfirm(fd));
    }
  }

  const canSend = ready && !busy && !unavailable && (!payingNow || payPhoneOk(number));

  return (
    <div>
      <BookingProgress current={3} />
      {summary && <div className="mt-6 lg:hidden">{summary}</div>}
      <section aria-labelledby="details-title" className="mt-8 lg:mt-10">
        <h2 id="details-title" className={typeScale.subheading}>{t("Book & pay")}</h2>
        <p className={cn(typeScale.small, "mt-2 max-w-[34rem] text-pub-muted")}>{t("Your number first — if you have stayed or ordered with us before, we already know you.")}</p>

        {stayEditor && <div className="mt-6">{stayEditor}</div>}

        {failed && (
          <Notice className="mt-6" title={unavailable ? t("This room was just taken.") : payState && !payState.ok && payingNow ? t("We couldn’t start your payment.") : t("We couldn’t make your booking.")}>
            <p>{failed.error}</p>
            {unavailable && <Link href={backToRoomsHref} className="mt-2 inline-block font-medium text-pub-fg underline underline-offset-4">{t("See rooms still free")}</Link>}
          </Notice>
        )}

        {/* action= makes the form post to the server even before hydration (never a GET with personal data). */}
        <form action={runConfirm} onSubmit={onSubmit} noValidate className="mt-8 space-y-6">
          {Object.entries(selection).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}

          <div className={cn(fx.card, "relative grid gap-x-4 gap-y-5 p-5 sm:grid-cols-2 sm:p-7")}>
            {/* The number */}
            <div className="sm:col-span-2">
              <label htmlFor="phone" className={field.label}>{t("Phone / WhatsApp")} <span aria-hidden="true">*</span></label>
              <span className="relative block">
                <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-pub-faint" aria-hidden="true" />
                <input id="phone" name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="0712 345 678" value={phone}
                  onChange={(e) => setPhone(e.target.value)} {...invalid("phone")} className={cn(field.input, "pl-11 pr-11 tabular-nums")} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2">
                  {guest.step === "checking" ? <LoaderCircle className="size-4 animate-spin text-pub-faint" aria-hidden="true" />
                    : ready ? <span className="grid size-5 place-items-center rounded-full bg-gold text-[#16110a]"><Check className="size-3" strokeWidth={3} aria-hidden="true" /></span> : null}
                </span>
              </span>
              {guest.step === "phone" && <p className={field.hint}>{t("e.g. 0712 345 678, or +44 7700 900123 from abroad.")}</p>}
              {errorOf("phone")}
            </div>

            {/* Known: greeted, nothing to type. New: the name. */}
            {known ? (
              <div role="status" className="flex items-center gap-3 rounded-[0.75rem] border border-pub-line bg-pub-fg/[0.03] p-3 sm:col-span-2">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#15120e] font-display text-lg text-gold">{guest.knownName!.charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm text-pub-muted">{t("Welcome back")}</span><span className="block truncate font-medium">{guest.knownName}</span></span>
                <button type="button" onClick={guest.notMe} className="min-h-11 shrink-0 px-1 text-sm font-medium underline decoration-pub-line underline-offset-4 hover:decoration-gold">{t("Not you?")}</button>
              </div>
            ) : guest.step === "new" ? (
              <div className="sm:col-span-2">
                <label htmlFor="fullName" className={field.label}>{t("Full name")} <span aria-hidden="true">*</span></label>
                <input id="fullName" name="fullName" required autoComplete="name" autoCapitalize="words"
                  defaultValue={device && !device.known && device.phone === phone ? device.name : ""} {...invalid("fullName")} className={field.input} />
                {errorOf("fullName")}
              </div>
            ) : null}

            {/* Everything else is optional — folded away. */}
            {ready && (
              <div className="border-t border-pub-line pt-1 sm:col-span-2">
                <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreShown} aria-controls="more-fields"
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[14px] font-medium text-pub-fg">
                  <span>{t("Add email, arrival time, a request or airport pickup")} <span className="font-normal text-pub-muted">{t("(optional)")}</span></span>
                  <ChevronDown className={cn("size-4 shrink-0 text-pub-muted transition-transform duration-200", moreShown && "rotate-180")} aria-hidden="true" />
                </button>
                <div id="more-fields" hidden={!moreShown} className="mt-4 grid gap-x-4 gap-y-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="email" className={field.label}>{t("Email")} {optional}</label>
                    <input id="email" name="email" type="email" autoComplete="email" defaultValue={device?.phone === phone ? device.email ?? "" : ""} {...invalid("email")} className={field.input} />
                    {errorOf("email")}
                  </div>
                  <div>
                    <label htmlFor="expectedArrivalTime" className={field.label}>{t("Arrival time")} {optional}</label>
                    <input id="expectedArrivalTime" name="expectedArrivalTime" type="time" {...invalid("expectedArrivalTime")} className={cn(field.input, scheme)} />
                    <p className={field.hint}>{t("Check-in is from {time}. Late arrivals are welcome.", { time: price.checkInTime })}</p>
                    {errorOf("expectedArrivalTime")}
                  </div>
                  {!known && (
                    <div className="sm:col-span-2">
                      <label htmlFor="nationality" className={field.label}>{t("Nationality")} {optional}</label>
                      <input id="nationality" name="nationality" autoComplete="country-name" {...invalid("nationality")} className={field.input} />
                      {errorOf("nationality")}
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <label htmlFor="specialRequests" className={field.label}>{t("A request")} {optional}</label>
                    <textarea id="specialRequests" name="specialRequests" rows={2} maxLength={1000} placeholder={t("Extra bed, quiet room, late check-in…")} {...invalid("specialRequests")} className={field.textarea} />
                    {errorOf("specialRequests")}
                  </div>

                  <fieldset className="border-t border-pub-line pt-5 sm:col-span-2">
                    <legend className="sr-only">{t("Airport pickup")}</legend>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                      <div className="flex gap-3.5">
                        <Plane className="mt-0.5 size-[18px] shrink-0 text-pub-eyebrow" strokeWidth={1.4} aria-hidden="true" />
                        <div>
                          <p className="text-[15px] font-medium leading-tight" id="pickup-q">{t("Airport pickup?")}</p>
                          <p className="mt-1 text-[13px] leading-relaxed text-pub-muted">{arrival.note}</p>
                        </div>
                      </div>
                      <div role="radiogroup" aria-labelledby="pickup-q" className="inline-flex shrink-0 self-start rounded-full border border-pub-line p-1 sm:self-auto">
                        {[{ v: false, l: msg("No thanks") }, { v: true, l: msg("Yes please") }].map((o) => (
                          <button key={o.l} type="button" role="radio" aria-checked={wantPickup === o.v} onClick={() => setWantPickup(o.v)}
                            className={cn("inline-flex h-10 items-center rounded-full px-4 text-[13px] font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
                              wantPickup === o.v ? "bg-pub-fg text-[var(--pub-surface)]" : "text-pub-muted hover:text-pub-fg")}>
                            {t(o.l)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {wantPickup && (
                      <div className="mt-5 grid gap-x-4 gap-y-5 sm:grid-cols-2">
                        <div>
                          <label htmlFor="flightNumber" className={field.label}>{t("Flight number")} <span aria-hidden="true">*</span></label>
                          <input id="flightNumber" name="flightNumber" autoComplete="off" placeholder={t("e.g. KQ484")} {...invalid("flightNumber")} className={cn(field.input, "uppercase")} />
                          {errorOf("flightNumber")}
                        </div>
                        <div>
                          <label htmlFor="passengers" className={field.label}>{t("Passengers")}</label>
                          <input id="passengers" name="passengers" type="number" min={1} max={20} inputMode="numeric" defaultValue={String(selection.adults + selection.children)} {...invalid("passengers")} className={field.input} />
                          {errorOf("passengers")}
                        </div>
                        <div className="min-w-0">
                          <label htmlFor="pickupDate" className={field.label}>{t("Landing date")} <span aria-hidden="true">*</span></label>
                          <input id="pickupDate" name="pickupDate" type="date" defaultValue={selection.checkIn} {...invalid("pickupDate")} className={cn(field.input, "min-w-0", scheme)} />
                          {errorOf("pickupDate")}
                        </div>
                        <div className="min-w-0">
                          <label htmlFor="pickupTime" className={field.label}>{t("Landing time (local)")} <span aria-hidden="true">*</span></label>
                          <input id="pickupTime" name="pickupTime" type="time" {...invalid("pickupTime")} className={cn(field.input, "min-w-0", scheme)} />
                          {errorOf("pickupTime")}
                        </div>
                        <div className="sm:col-span-2">
                          <label htmlFor="airport" className={field.label}>{t("Airport")}</label>
                          <input id="airport" name="airport" defaultValue={arrival.defaultAirport} {...invalid("airport")} className={field.input} />
                          {errorOf("airport")}
                        </div>
                        <div className="sm:col-span-2">
                          <label htmlFor="pickupNotes" className={field.label}>{t("For the driver")} {optional}</label>
                          <textarea id="pickupNotes" name="pickupNotes" rows={2} maxLength={500} placeholder={t("Luggage, meeting point…")} {...invalid("pickupNotes")} className={field.textarea} />
                          {errorOf("pickupNotes")}
                        </div>
                      </div>
                    )}
                  </fieldset>
                </div>
              </div>
            )}

            {/* Hidden anti-spam field: never shown (display:none) and never named like a real field, so browser autofill cannot fill it (2026-10-05: Chrome filled the old "Company" one and real bookings were refused). */}
            <input name="hp_field" tabIndex={-1} autoComplete="off" aria-hidden="true" hidden defaultValue="" />
          </div>

          {/* The amount and how to pay: one dark panel, the screen's single focal point, with the one button. */}
          <div data-tone="night" className={cn(fx.night, "relative p-5 text-pub-fg sm:p-7")}>
            <span aria-hidden="true" className="pub-hud-corners" style={{ "--hud-o": "-0.625rem", "--hud-l": "0.875rem" } as React.CSSProperties} />
            <dl className="space-y-3 text-[14px]">
              <div className="flex justify-between gap-4">
                <dt className="text-pub-muted">{formatTZS(price.ratePerNight)} × {t.plural(price.nights, "{n} night", "{n} nights")}{price.rooms > 1 ? ` × ${t.plural(price.rooms, "{n} room", "{n} rooms")}` : ""}</dt>
                <dd className="tabular-nums">{formatTZS(price.gross)}</dd>
              </div>
              {price.discount > 0 && (
                <div className="flex justify-between gap-4 text-gold">
                  <dt>{t("Website discount")}</dt>
                  <dd className="shrink-0 tabular-nums">− {formatTZS(price.discount)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-4 border-t border-pub-line pt-4">
                <dt className={cn(typeScale.meta, "text-pub-muted")}>{t("Total")}</dt>
                <dd className="font-display text-[clamp(1.75rem,1.4rem+1.2vw,2.25rem)] leading-none text-gold lining-nums tabular-nums">{formatTZS(price.total)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[12.5px] leading-relaxed text-pub-muted">{t("Breakfast and Wi-Fi included. No card needed.")}</p>

            {online && (
              <div className="mt-6">
                <p id="pay-way" className={cn(typeScale.eyebrow, "text-gold")}>{t("How would you like to pay?")}</p>
                <div role="radiogroup" aria-labelledby="pay-way" className="mt-3 overflow-hidden rounded-[0.875rem] border border-pub-line">
                  <WayRow on={way === "now"} onSelect={() => setWay("now")} icon={<Smartphone className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />}
                    title={t("Pay now")} sub={<NetworkMarks label={null} compact dark />}>
                    <div className="space-y-4">
                      <label className="block">
                        <span className={field.label}>{t("Mobile-money number")}</span>
                        <input value={number} onChange={(e) => setPayPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder={t("e.g. 0712 345 678")}
                          aria-invalid={number !== "" && !payPhoneOk(number)} className={cn(field.input, "tracking-wide tabular-nums [color-scheme:dark] aria-invalid:border-amber-400/80")} />
                      </label>
                      <ol className="grid grid-cols-3 gap-2 text-center">
                        {[{ label: msg("Check your phone"), i: BellRing }, { label: msg("Enter your PIN"), i: KeyRound }, { label: msg("Room confirmed"), i: Check }].map(({ label, i: Icon }) => (
                          <li key={label} className="min-w-0">
                            <span className="mx-auto grid size-8 place-items-center rounded-full border border-gold/40 text-gold"><Icon className="size-3.5" strokeWidth={1.8} aria-hidden="true" /></span>
                            <span className="mt-1.5 block text-[11px] leading-tight text-pub-muted">{t(label)}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </WayRow>
                  <WayRow on={way === "later"} onSelect={() => setWay("later")} icon={<Wallet className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />}
                    title={t("Pay later")} sub={t("Not reserved until paid — pay any time from your booking")} />
                </div>
              </div>
            )}

            <div className="mt-6">
              <Button type="submit" disabled={!canSend} full className="h-auto min-h-11 whitespace-normal py-2.5 text-center"
                icon={busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : payingNow ? <Lock className="size-4" strokeWidth={1.8} aria-hidden="true" /> : <Send className="size-4" strokeWidth={1.6} aria-hidden="true" />}>
                {busy ? (payingNow ? t("Booking your room…") : t("Booking…")) : payingNow ? t("Pay {amount} now", { amount: formatTZS(price.total) }) : online ? t("Book — pay later") : t("Book now")}
              </Button>
              <p className="mt-3 text-center text-[11.5px] leading-relaxed text-pub-muted">
                {!ready ? t("Enter your number to continue.")
                  : payingNow ? <span className="inline-flex items-center gap-1.5"><Lock className="size-3 text-gold" strokeWidth={1.8} aria-hidden="true" />{t.rich("Secure payment by <b>NTZS</b>", { b: (c) => <span className="font-semibold tracking-wide text-pub-fg/85">{c}</span> })}</span>
                    : online ? t("The room is not reserved until it is paid.") : t("Nothing is charged online — the room is not reserved until it is paid.")}
              </p>
            </div>
          </div>

          <Link href={backToRoomsHref}
            className={cn(typeScale.cta, "inline-flex min-h-11 items-center gap-1.5 rounded-sm text-pub-muted transition-colors duration-200 hover:text-pub-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none")}>
            <ChevronLeft className="size-4" strokeWidth={1.6} aria-hidden="true" /> {t("Back to rooms")}
          </Link>
        </form>
      </section>
    </div>
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
