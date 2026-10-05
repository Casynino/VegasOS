"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CircleCheck, CircleX, LoaderCircle, Lock, Search, Send, Smartphone, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { bookMeetingAction, checkMeetingAction, payMeetingAction, type MeetingCheck, type MeetingReceipt } from "@/app/(public)/meeting-room/actions";
import { NetworkMarks } from "@/components/payments/networks";
import { Button, Eyebrow, InfoList, LinkButton, PriceTag, field, surface, toneAttr, typeScale } from "./kit";
import { ChoiceRow } from "./services/choice-row";
import { Field, StepLegend } from "./services/form-field";
import { Receipt } from "./services/receipt";

const n = (v: number) => v.toLocaleString("en-US");
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const payPhoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));
const SLOTS = [["Morning", "08:00", "12:00"], ["Half day", "09:00", "13:00"], ["Afternoon", "13:00", "17:00"], ["Full day", "08:00", "17:00"]] as const;

/**
 * Meeting room on the website: pick a date and time → "Check availability"
 * (live, from the same booking engine as reception) → "Book now" with the
 * customer's details. The booking is a request until the hotel confirms it — or, paying online (nTZS), it is booked
 * at once and the payment confirms it. "Pay now" comes first and is pre-selected; "Pay at the hotel" sends the request.
 * One panel for the steps; on desktop a night summary rides beside it.
 */
export function MeetingBooking({ today, price, capacity, online = false, name = "Meeting Room" }: {
  today: string; price: number; capacity: number; online?: boolean;
  /** The room's public name for the summary (never the internal room number). */
  name?: string;
}) {
  const router = useRouter();
  const [when, setWhen] = useState({ date: "", start: "09:00", end: "13:00", attendees: "10" });
  const [f, setF] = useState({ fullName: "", companyName: "", phone: "", email: "", requirements: "", notes: "", website: "" });
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
    if (!when.date) { setErrors({ date: "Choose a date." }); return; }
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
      const res = await bookMeetingAction({ ...when, attendees: Number(when.attendees), ...f });
      if (res.ok) setDone(res.data);
      else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        if (res.code === "UNAVAILABLE") setCheck(null);
      }
    });
  }

  const number = payPhone ?? f.phone;
  function payOnline() {
    setFormError(null);
    if (!payPhoneOk(number)) { setErrors({ payPhone: "Enter your mobile-money number, e.g. 0712 345 678." }); return; }
    payKey.current ||= newKey();
    startPay(async () => {
      const res = await payMeetingAction({ ...when, attendees: Number(when.attendees), ...f, payPhone: number.trim(), clientKey: payKey.current });
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
        eyebrow="Request received"
        title={`Thank you, ${done.name}.`}
        line="We have your meeting room request. Our team will call or WhatsApp you to confirm it."
        rows={[
          { label: "Reference", value: <span className="font-mono font-semibold tracking-wide">{done.reference}</span> },
          { label: "Room", value: done.room },
          { label: "Date", value: longDate(done.date) },
          { label: "Time", value: <span className="tabular-nums">{done.time}</span> },
          { label: "Price", value: <span className="tabular-nums">TZS {n(done.price)}</span> },
        ]}
        note="Keep your reference. The time is held for you once we confirm."
        actions={
          <>
            <LinkButton href={`/booking/${done.reference}?token=${encodeURIComponent(done.manageToken)}`} icon="arrow">View your request</LinkButton>
            <Button variant="text" onClick={() => { setDone(null); setCheck(null); setWhen((w) => ({ ...w, date: "" })); }}>Book another time</Button>
          </>
        }
      />
    );
  }

  const busy = booking || paying;
  const note = online
    ? "No account needed. Pay now and your booking is confirmed at once — or send a request and our team calls or messages you to confirm it."
    : "No account needed and nothing to pay online. Your booking is confirmed when our team calls or messages you.";

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-12 lg:gap-10" noValidate>
      <div className="min-w-0 lg:col-span-7">
        <div className={cn(surface.panel, "space-y-9")}>
          <fieldset>
            <StepLegend step={1}>When is your meeting?</StepLegend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Date" required error={errors.date}>
                <input className={field.input} type="date" min={today} value={when.date} onChange={setW("date")} aria-invalid={!!errors.date} aria-required="true" />
              </Field>
              <div className="grid grid-cols-2 gap-4 sm:contents">
                <Field label="Starts" required error={errors.start}>
                  <input className={field.input} type="time" step={900} value={when.start} onChange={setW("start")} aria-invalid={!!errors.start} aria-required="true" />
                </Field>
                <Field label="Ends" required error={errors.end}>
                  <input className={field.input} type="time" step={900} value={when.end} onChange={setW("end")} aria-invalid={!!errors.end} aria-required="true" />
                </Field>
              </div>
            </div>
            <div role="group" aria-label="Quick times" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SLOTS.map(([label, a, b]) => {
                const on = when.start === a && when.end === b;
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setWhen((w) => ({ ...w, start: a, end: b }))}
                    className={cn(
                      "flex min-h-12 flex-col items-start justify-center rounded-[0.625rem] border px-3 py-2 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
                      on ? "border-gold/70 bg-gold/[0.08]" : "border-pub-line hover:border-pub-fg/30",
                    )}
                  >
                    <span className="text-[13px] font-medium leading-tight text-pub-fg">{label}</span>
                    <span className="text-[12px] tabular-nums leading-tight text-pub-muted">{a}–{b}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-[9rem_auto] sm:items-end sm:justify-start">
              <Field label="People" required error={errors.attendees}>
                <input className={field.input} type="number" inputMode="numeric" min={1} max={capacity} value={when.attendees} onChange={setW("attendees")} aria-invalid={!!errors.attendees} aria-required="true" />
              </Field>
              <Button onClick={runCheck} disabled={checking} variant={fresh?.available ? "secondary" : "primary"} full className="sm:w-auto">
                <span className="inline-flex items-center gap-2">
                  {checking ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
                  Check availability
                </span>
              </Button>
            </div>

            <div aria-live="polite">
              {fresh && (
                <div className={cn("mt-5 rounded-[0.75rem] border p-4", fresh.available ? "border-emerald-600/35 bg-emerald-600/[0.06]" : "border-pub-error/35 bg-pub-error/[0.06]")}>
                  <p className="flex items-start gap-2.5 font-medium leading-snug text-pub-fg">
                    {fresh.available
                      ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-700 pub-dark:text-emerald-400" aria-hidden="true" />
                      : <CircleX className="mt-0.5 size-5 shrink-0 text-pub-error" aria-hidden="true" />}
                    <span>{fresh.available ? `Available · ${longDate(when.date)}, ${when.start}–${when.end}` : "Already booked for part of that time"}</span>
                  </p>
                  <p className="mt-1.5 pl-7.5 text-[14px] leading-relaxed text-pub-muted">
                    {fresh.available ? `TZS ${n(fresh.price)} for this booking. Add your details below to book it.` : "Please choose another time on this day, or another date."}
                  </p>
                  {fresh.booked.length > 0 && (
                    <p className={cn(typeScale.meta, "mt-3 pl-7.5 text-pub-muted")}>
                      Booked that day: <span className="tabular-nums text-pub-fg">{fresh.booked.join(" · ")}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </fieldset>

          {fresh?.available && (
            <fieldset className="border-t border-pub-line pt-8">
              <StepLegend step={2}>Your details</StepLegend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required error={errors.fullName}>
                  <input className={field.input} value={f.fullName} onChange={set("fullName")} autoComplete="name" aria-invalid={!!errors.fullName} aria-required="true" />
                </Field>
                <Field label="Company" error={errors.companyName}>
                  <input className={field.input} value={f.companyName} onChange={set("companyName")} autoComplete="organization" placeholder="Optional" />
                </Field>
                <Field label="Phone" required error={errors.phone}>
                  <input className={field.input} value={f.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="+255 …" aria-invalid={!!errors.phone} aria-required="true" />
                </Field>
                <Field label="Email" error={errors.email}>
                  <input className={field.input} type="email" value={f.email} onChange={set("email")} autoComplete="email" placeholder="Optional" aria-invalid={!!errors.email} />
                </Field>
              </div>
              <div className="mt-4 grid gap-4">
                <Field label="Special requirements" error={errors.requirements}>
                  <textarea className={field.textarea} value={f.requirements} onChange={set("requirements")} placeholder="e.g. projector, seating layout, tea break at 10:30, lunch for 12" />
                </Field>
                <Field label="Notes" error={errors.notes}>
                  <textarea className={cn(field.textarea, "min-h-20")} value={f.notes} onChange={set("notes")} />
                </Field>
              </div>
              <input type="text" name="website" value={f.website} onChange={set("website")} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            </fieldset>
          )}

          {fresh?.available && (
            <fieldset className="border-t border-pub-line pt-8">
              <StepLegend step={3}>{online ? "How would you like to pay?" : "Book it"}</StepLegend>
              {online && (
                <div role="radiogroup" aria-label="How would you like to pay?" className="mb-6 grid gap-2.5">
                  <ChoiceRow kind="radio" on={way === "NOW"} onSelect={() => setWay("NOW")} icon={<Smartphone className="size-[18px]" strokeWidth={1.6} />} title="Pay now" sub={<NetworkMarks label={null} compact />}>
                    <div className="space-y-3">
                      <Field label="Mobile-money number" required error={errors.payPhone}>
                        <input className={cn(field.input, "tabular-nums")} value={number} onChange={(e) => setPayPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 0712 345 678" aria-invalid={!!errors.payPhone} aria-required="true" />
                      </Field>
                      <p className="text-[13px] leading-relaxed text-pub-muted">You will get a payment request on your phone — enter your PIN to pay. The time is held for you while you pay.</p>
                      <p className="flex items-center gap-1.5 text-[11px] font-medium text-pub-muted">
                        <Lock className="size-3 shrink-0 text-pub-eyebrow" aria-hidden="true" />Secure payment by <span className="font-semibold tracking-wide text-pub-fg">NTZS</span>
                      </p>
                    </div>
                  </ChoiceRow>
                  <ChoiceRow kind="radio" on={way === "LATER"} onSelect={() => setWay("LATER")} icon={<Wallet className="size-[18px]" strokeWidth={1.6} />} title="Pay at the hotel" sub="Send a request — our team calls or messages you to confirm it." />
                </div>
              )}
              <Button type="submit" size="lg" full disabled={busy} className="sm:w-auto">
                <span className="inline-flex items-center gap-2">
                  {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    : !online ? <CalendarCheck className="size-4" aria-hidden="true" />
                      : way === "NOW" ? <Smartphone className="size-4" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                  {!online ? "Book now"
                    : way === "NOW" ? (paying ? "Booking your time…" : `Pay TZS ${n(fresh.price)}`)
                      : (booking ? "Sending your request…" : "Send request")}
                </span>
              </Button>
            </fieldset>
          )}
          {formError && <p className={field.error} role="alert">{formError}</p>}
        </div>
        <p className="mt-4 px-1 text-[13px] leading-relaxed text-pub-muted lg:hidden">{note}</p>
      </div>

      {/* Desktop: what you are booking, beside the steps. */}
      <aside aria-label="Your booking" className="hidden lg:col-span-4 lg:col-start-9 lg:block lg:sticky lg:top-24 lg:self-start">
        <div {...toneAttr("night")} className="rounded-[1rem] bg-night p-7 text-pub-fg">
          <Eyebrow>{name}</Eyebrow>
          <PriceTag className="mt-4" amount={fresh?.available ? fresh.price : price} unit="booking" size="lg" />
          <InfoList
            variant="rows"
            className="mt-6"
            items={[
              { label: "People", value: `Up to ${capacity}` },
              { label: "When", value: when.date ? <span className="tabular-nums">{shortDate(when.date)} · {when.start}–{when.end}</span> : "Choose a date" },
              { label: "Food & drinks", value: "On the same bill" },
            ]}
          />
        </div>
        <p className="mt-4 px-1 text-[13px] leading-relaxed text-pub-muted">{note}</p>
      </aside>
    </form>
  );
}
