"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Check, CircleCheck, CircleX, LoaderCircle, Lock, Search, Send, Smartphone, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { bookMeetingAction, checkMeetingAction, payMeetingAction, type MeetingCheck, type MeetingReceipt } from "@/app/(public)/[lang]/meeting-room/actions";
import { NetworkMarks } from "@/components/payments/networks";
import { identifyCustomerAction } from "@/app/order/actions";
import { usePhoneLookup, useWho } from "@/components/restaurant/who";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import { Button, Eyebrow, HOTEL_COORDS, HudLabel, InfoList, LinkButton, PriceTag, field, typeScale } from "./kit";
import { ChoiceRow } from "./services/choice-row";
import { Field, StepLegend } from "./services/form-field";
import { Receipt } from "./services/receipt";
import { ConsoleHead } from "./services/console";
import fx from "./services/fx.module.css";

const n = (v: number) => v.toLocaleString("en-US");
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const payPhoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));
const SLOTS = [[msg("Morning"), "08:00", "12:00"], [msg("Half day"), "09:00", "13:00"], [msg("Afternoon"), "13:00", "17:00"], [msg("Full day"), "08:00", "17:00"]] as const;

/**
 * Meeting room on the website: pick a date and time → "Check availability"
 * (live, from the same booking engine as reception) → "Book now" with the
 * customer's details. The booking is a request until the hotel confirms it — or, paying online (nTZS), it is booked
 * at once and the payment confirms it. "Pay now" (mobile money, nTZS) comes first and is pre-selected; "Pay later" sends the request.
 * Presented as a booking console: smoked glass with a live header and a step track; on desktop a
 * ticket with the price and the chosen time rides beside it. (Meant for a night band.)
 */
export function MeetingBooking({ today, price, capacity, online = false, name }: {
  today: string; price: number; capacity: number; online?: boolean;
  /** The room's public name for the summary (never the internal room number). */
  name?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [when, setWhen] = useState({ date: "", start: "09:00", end: "13:00", attendees: "10" });
  const [f, setF] = useState({ fullName: "", companyName: "", phone: "", email: "", requirements: "", notes: "", website: "" });
  // The number first (owner, 2026-10-05): this device's last number is filled in; someone we know is greeted by name.
  const [device] = useWho();
  const [phoneTyped, setPhoneTyped] = useState(false);
  const phone = phoneTyped ? f.phone : f.phone || device?.phone || "";
  const lookup = useCallback(async (p: string) => {
    const r = await identifyCustomerAction({ phone: p });
    return r.ok ? r.data.name : null;
  }, []);
  const guest = usePhoneLookup(phone, lookup);
  const known = guest.step === "known";
  /** What is sent: the number shown, and no name for a known guest (the server uses the one it has). */
  const sent = { ...f, phone, fullName: known ? "" : f.fullName };
  const [check, setCheck] = useState<(MeetingCheck & { for: string }) | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<MeetingReceipt | null>(null);
  const [checking, startCheck] = useTransition();
  const [booking, startBook] = useTransition();
  const [paying, startPay] = useTransition();
  const [payPhone, setPayPhone] = useState<string | null>(null);
  const [way, setWay] = useState<"NOW" | "LATER">("NOW");
  const payKey = useRef("");
  const key = `${when.date}|${when.start}|${when.end}`;
  const fresh = check?.for === key ? check : null;

  const setW = (k: keyof typeof when) => (e: React.ChangeEvent<HTMLInputElement>) => setWhen((w) => ({ ...w, [k]: e.target.value }));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  function runCheck() {
    setFormError(null);
    if (!when.date) { setErrors({ date: t("Choose a date.") }); return; }
    setErrors({});
    startCheck(async () => {
      const res = await checkMeetingAction({ date: when.date, start: when.start, end: when.end });
      if (res.ok) setCheck({ ...res.data, for: key });
      else { setCheck(null); setFormError(res.error); }
    });
  }

  function book() {
    setFormError(null);
    startBook(async () => {
      const res = await bookMeetingAction({ ...when, attendees: Number(when.attendees), ...sent });
      if (res.ok) setDone(res.data);
      else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        if (res.code === "UNAVAILABLE") setCheck(null);
      }
    });
  }

  const number = payPhone ?? phone;
  function payOnline() {
    setFormError(null);
    if (!payPhoneOk(number)) { setErrors({ payPhone: t("Enter your mobile-money number, e.g. 0712 345 678.") }); return; }
    payKey.current ||= newKey();
    startPay(async () => {
      const res = await payMeetingAction({ ...when, attendees: Number(when.attendees), ...sent, payPhone: number.trim(), clientKey: payKey.current });
      if (res.ok) { router.push(res.data.next); return; }
      payKey.current = ""; // the next press is a new booking attempt
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error);
      if (res.code === "UNAVAILABLE") setCheck(null);
    });
  }

  // Enter before the time is checked checks it; after, the chosen way to pay runs.
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fresh?.available) { runCheck(); return; }
    if (online && way === "NOW") payOnline();
    else book();
  }

  if (done) {
    return (
      <Receipt
        eyebrow={t("Request received")}
        title={t("Thank you, {name}.", { name: done.name })}
        line={t("We have your meeting room request. Our team will call or WhatsApp you to confirm it.")}
        rows={[
          { label: t("Reference"), value: <span className="font-mono font-semibold tracking-wide">{done.reference}</span> },
          { label: t("Room"), value: done.room },
          { label: t("Date"), value: t.date(done.date, true) },
          { label: t("Time"), value: <span className="tabular-nums">{done.time}</span> },
          { label: t("Price"), value: <span className="tabular-nums">TZS {n(done.price)}</span> },
        ]}
        note={t("Keep your reference. The time is held for you once we confirm.")}
        actions={
          <>
            <LinkButton href={`/booking/${done.reference}?token=${encodeURIComponent(done.manageToken)}`} icon="arrow">{t("View your request")}</LinkButton>
            <Button variant="text" onClick={() => { setDone(null); setCheck(null); setWhen((w) => ({ ...w, date: "" })); }}>{t("Book another time")}</Button>
          </>
        }
      />
    );
  }

  const busy = booking || paying;
  const note = online
    ? t("No account needed. Pay now and your booking is confirmed at once — or send a request and our team calls or messages you to confirm it.")
    : t("No account needed and nothing to pay online. Your booking is confirmed when our team calls or messages you.");

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-12 lg:gap-10" noValidate>
      <div className="min-w-0 lg:col-span-7">
        <div className={fx.console}>
          <ConsoleHead live={t("Live availability")} steps={[t("When"), t("Details"), online ? t("Pay") : t("Book")]} reached={fresh?.available ? 3 : 1} />
          <div className="space-y-9 p-5 sm:p-7">
            <fieldset>
              <StepLegend step={1}>{t("When is your meeting?")}</StepLegend>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t("Date")} required error={errors.date}>
                  <input className={field.input} type="date" min={today} value={when.date} onChange={setW("date")} aria-invalid={!!errors.date} aria-required="true" />
                </Field>
                <div className="grid grid-cols-2 gap-4 sm:contents">
                  <Field label={t("Starts")} required error={errors.start}>
                    <input className={field.input} type="time" step={900} value={when.start} onChange={setW("start")} aria-invalid={!!errors.start} aria-required="true" />
                  </Field>
                  <Field label={t("Ends")} required error={errors.end}>
                    <input className={field.input} type="time" step={900} value={when.end} onChange={setW("end")} aria-invalid={!!errors.end} aria-required="true" />
                  </Field>
                </div>
              </div>
              <div role="group" aria-label={t("Quick times")} className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {SLOTS.map(([label, a, b]) => {
                  const on = when.start === a && when.end === b;
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setWhen((w) => ({ ...w, start: a, end: b }))}
                      className={cn(
                        "relative flex min-h-14 flex-col items-start justify-center gap-1 rounded-[0.625rem] border px-3.5 py-2.5 text-left transition-[border-color,background-color,box-shadow] duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
                        on
                          ? "border-gold/70 bg-gold/[0.1] shadow-[inset_0_1px_0_rgb(255_240_210/0.12),0_0_26px_-10px_rgb(227_189_106/0.8)]"
                          : "border-pub-line bg-pub-fg/[0.025] hover:border-pub-fg/30",
                      )}
                    >
                      {on && <span aria-hidden="true" className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-gold shadow-[0_0_8px_1px_rgb(227_189_106/0.7)]" />}
                      <span className="text-[13px] font-medium leading-tight text-pub-fg">{t(label)}</span>
                      <span className="font-mono text-[11px] tabular-nums leading-tight tracking-[0.06em] text-pub-muted">{a}–{b}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-[9rem_auto] sm:items-end sm:justify-start">
                <Field label={t("People")} required error={errors.attendees}>
                  <input className={field.input} type="number" inputMode="numeric" min={1} max={capacity} value={when.attendees} onChange={setW("attendees")} aria-invalid={!!errors.attendees} aria-required="true" />
                </Field>
                <Button onClick={runCheck} disabled={checking} variant={fresh?.available ? "secondary" : "primary"} full className="sm:w-auto">
                  <span className="inline-flex items-center gap-2">
                    {checking ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
                    {t("Check availability")}
                  </span>
                </Button>
              </div>

              <div aria-live="polite">
                {fresh && (
                  <div className={cn("relative mt-5 overflow-hidden rounded-[0.75rem] border p-4 pl-5", fresh.available ? "border-emerald-400/30 bg-emerald-400/[0.06]" : "border-pub-error/35 bg-pub-error/[0.06]")}>
                    <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[3px]", fresh.available ? "bg-emerald-400/80" : "bg-pub-error/80")} />
                    <p className="flex items-start gap-2.5 font-medium leading-snug text-pub-fg">
                      {fresh.available
                        ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden="true" />
                        : <CircleX className="mt-0.5 size-5 shrink-0 text-pub-error" aria-hidden="true" />}
                      <span>{fresh.available ? t("Available · {date}, {start}–{end}", { date: t.date(when.date, true), start: when.start, end: when.end }) : t("Already booked for part of that time")}</span>
                    </p>
                    <p className="mt-1.5 pl-7.5 text-[14px] leading-relaxed text-pub-muted">
                      {fresh.available ? t("{amount} for this booking. Add your details below to book it.", { amount: `TZS ${n(fresh.price)}` }) : t("Please choose another time on this day, or another date.")}
                    </p>
                    {fresh.booked.length > 0 && (
                      <p className={cn(typeScale.meta, "mt-3 pl-7.5 text-pub-muted")}>
                        {t.rich("Booked that day: <b>{times}</b>", { b: (c) => <span className="tabular-nums text-pub-fg">{c}</span> }, { times: fresh.booked.join(" · ") })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </fieldset>

            {fresh?.available && (
              <fieldset className="border-t border-pub-line pt-8">
                <StepLegend step={2}>{t("Your details")}</StepLegend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("Phone")} required error={errors.phone}>
                    <span className="relative block">
                      <input className={cn(field.input, "pr-11 tabular-nums")} value={phone} onChange={(e) => { setPhoneTyped(true); setF((x) => ({ ...x, phone: e.target.value })); }} inputMode="tel" autoComplete="tel" placeholder="0712 345 678" aria-invalid={!!errors.phone} aria-required="true" />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                        {guest.step === "checking" ? <LoaderCircle className="size-4 animate-spin text-pub-faint" aria-hidden="true" />
                          : guest.step === "known" || guest.step === "new" ? <span className="grid size-5 place-items-center rounded-full bg-gold text-[#16110a]"><Check className="size-3" strokeWidth={3} aria-hidden="true" /></span> : null}
                      </span>
                    </span>
                  </Field>
                  {known ? (
                    <div role="status" className="flex items-center gap-3 self-end rounded-[0.75rem] border border-pub-line bg-pub-fg/[0.03] p-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#15120e] font-display text-lg text-gold">{guest.knownName!.charAt(0).toUpperCase()}</span>
                      <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm text-pub-muted">{t("Welcome back")}</span><span className="block truncate font-medium">{guest.knownName}</span></span>
                      <button type="button" onClick={guest.notMe} className="min-h-11 shrink-0 px-1 text-sm font-medium underline decoration-pub-line underline-offset-4 hover:decoration-gold">{t("Not you?")}</button>
                    </div>
                  ) : guest.step === "new" ? (
                    <Field label={t("Full name")} required error={errors.fullName}>
                      <input className={field.input} value={f.fullName} onChange={set("fullName")} autoComplete="name" aria-invalid={!!errors.fullName} aria-required="true" />
                    </Field>
                  ) : (
                    <p className="self-center text-[13px] leading-snug text-pub-muted">{t("Your number first — if you have stayed or ordered with us before, we already know you.")}</p>
                  )}
                  <Field label={t("Company")} error={errors.companyName}>
                    <input className={field.input} value={f.companyName} onChange={set("companyName")} autoComplete="organization" placeholder={t("Optional")} />
                  </Field>
                  <Field label={t("Email")} error={errors.email}>
                    <input className={field.input} type="email" value={f.email} onChange={set("email")} autoComplete="email" placeholder={t("Optional")} aria-invalid={!!errors.email} />
                  </Field>
                </div>
                <div className="mt-4 grid gap-4">
                  <Field label={t("Special requirements")} error={errors.requirements}>
                    <textarea className={field.textarea} value={f.requirements} onChange={set("requirements")} placeholder={t("e.g. projector, seating layout, tea break at 10:30, lunch for 12")} />
                  </Field>
                  <Field label={t("Notes")} error={errors.notes}>
                    <textarea className={cn(field.textarea, "min-h-20")} value={f.notes} onChange={set("notes")} />
                  </Field>
                </div>
                <input type="text" name="website" value={f.website} onChange={set("website")} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
              </fieldset>
            )}

            {fresh?.available && (
              <fieldset className="border-t border-pub-line pt-8">
                <StepLegend step={3}>{online ? t("How would you like to pay?") : t("Book it")}</StepLegend>
                {online && (
                  <div role="radiogroup" aria-label={t("How would you like to pay?")} className="mb-6 grid gap-2.5">
                    <ChoiceRow kind="radio" on={way === "NOW"} onSelect={() => setWay("NOW")} icon={<Smartphone className="size-[18px]" strokeWidth={1.6} />} title={t("Pay now")} sub={<NetworkMarks label={null} compact />}>
                      <div className="space-y-3">
                        <Field label={t("Mobile-money number")} required error={errors.payPhone}>
                          <input className={cn(field.input, "tabular-nums")} value={number} onChange={(e) => setPayPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder={t("e.g. {example}", { example: "0712 345 678" })} aria-invalid={!!errors.payPhone} aria-required="true" />
                        </Field>
                        <p className="text-[13px] leading-relaxed text-pub-muted">{t("You will get a payment request on your phone — enter your PIN to pay. The time is held for you while you pay.")}</p>
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-pub-muted">
                          <Lock className="size-3 shrink-0 text-pub-eyebrow" aria-hidden="true" />{t.rich("Secure payment by <b>NTZS</b>", { b: (c) => <span className="font-semibold tracking-wide text-pub-fg">{c}</span> })}
                        </p>
                      </div>
                    </ChoiceRow>
                    <ChoiceRow kind="radio" on={way === "LATER"} onSelect={() => setWay("LATER")} icon={<Wallet className="size-[18px]" strokeWidth={1.6} />} title={t("Pay later")} sub={t("Send a request — not reserved until paid; you pay by mobile money from your booking link.")} />
                  </div>
                )}
                <Button type="submit" full disabled={busy} className="sm:w-auto sm:min-w-48">
                  <span className="inline-flex items-center gap-2">
                    {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      : !online ? <CalendarCheck className="size-4" aria-hidden="true" />
                        : way === "NOW" ? <Smartphone className="size-4" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                    {!online ? t("Book now")
                      : way === "NOW" ? (paying ? t("Booking your time…") : t("Pay {amount}", { amount: `TZS ${n(fresh.price)}` }))
                        : (booking ? t("Sending your request…") : t("Send request"))}
                  </span>
                </Button>
              </fieldset>
            )}
            {formError && <p className={field.error} role="alert">{formError}</p>}
          </div>
        </div>
        <p className="mt-4 px-1 text-[13px] leading-relaxed text-pub-muted lg:hidden">{note}</p>
      </div>

      {/* Desktop: what you are booking, beside the steps. */}
      <aside aria-label={t("Your booking")} className="hidden lg:col-span-5 lg:col-start-8 lg:block lg:sticky lg:top-24 lg:self-start xl:col-span-4 xl:col-start-9">
        <div className={cn(fx.console, "p-7")}>
          <div className="flex items-center justify-between gap-4">
            <Eyebrow>{name ?? t("Meeting Room")}</Eyebrow>
            <HudLabel tick={false}>{t("Your booking")}</HudLabel>
          </div>
          <PriceTag className="mt-5" amount={fresh?.available ? fresh.price : price} unit="booking" size="lg" />
          <div aria-hidden="true" className={cn(fx.perf, "mt-6")} />
          <InfoList
            variant="rows"
            className="mt-6"
            items={[
              { label: t("People"), value: t("Up to {n}", { n: capacity }) },
              { label: t("When"), value: when.date ? <span className="tabular-nums">{t.dayMonth(when.date)} · {when.start}–{when.end}</span> : t("Choose a date") },
              { label: t("Food & drinks"), value: t("On the same bill") },
            ]}
          />
          <HudLabel className="mt-6">{HOTEL_COORDS.label}</HudLabel>
        </div>
        <p className="mt-4 px-1 text-[13px] leading-relaxed text-pub-muted">{note}</p>
      </aside>
    </form>
  );
}
