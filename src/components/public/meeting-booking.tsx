"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck, CheckCircle2, Clock, Loader2, Search, ShieldCheck, Smartphone, Users, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { bookMeetingAction, checkMeetingAction, payMeetingAction, type MeetingCheck, type MeetingReceipt } from "@/app/(public)/meeting-room/actions";
import { eyebrow, fieldError, fieldInput, fieldLabel, fieldTextarea, goldText, pillGold, pillPad } from "./ui";

const n = (v: number) => v.toLocaleString("en-US");
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const payPhoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));
const SLOTS = [["Morning", "08:00", "12:00"], ["Half day", "09:00", "13:00"], ["Afternoon", "13:00", "17:00"], ["Full day", "08:00", "17:00"]] as const;

/**
 * Meeting room on the website: pick a date and time → "Check availability"
 * (live, from the same booking engine as reception) → "Book now" with the
 * customer's details. The booking is a request until the hotel confirms it — or, paying online (nTZS), it is booked
 * at once and the payment confirms it.
 */
export function MeetingBooking({ today, price, capacity, online = false }: { today: string; price: number; capacity: number; online?: boolean }) {
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

  function book(e: React.FormEvent) {
    e.preventDefault();
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

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] border border-tone/10 bg-panel p-8 text-center shadow-[0_30px_60px_-40px_rgba(20,15,10,0.6)] sm:p-10" role="status">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-gold/15 text-accent-ink"><CheckCircle2 className="size-7" /></span>
        <p className={cn(eyebrow, goldText, "mt-5")}>Request received</p>
        <h3 className="mt-3 font-display text-3xl leading-tight text-tone sm:text-4xl">Thank you, {done.name}.</h3>
        <p className="mt-3 text-tone/70">We have your meeting room request. Our team will call or WhatsApp you to confirm it.</p>
        <dl className="mt-7 divide-y divide-tone/10 rounded-2xl border border-tone/10 text-left text-sm">
          {[
            ["Reference", <span key="r" className="font-mono font-semibold tracking-wide">{done.reference}</span>],
            ["Room", done.room],
            ["Date", longDate(done.date)],
            ["Time", <span key="t" className="tabular-nums">{done.time}</span>],
            ["Price", <span key="p" className="font-semibold tabular-nums">TZS {n(done.price)}</span>],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex items-center justify-between gap-4 px-5 py-3"><dt className="text-tone/55">{k}</dt><dd className="text-right text-tone">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-5 text-xs text-tone/55">Keep your reference. The time is held for you once we confirm.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm font-medium">
          <Link href={`/booking/${done.reference}?token=${encodeURIComponent(done.manageToken)}`} className="text-tone underline underline-offset-4">View your request</Link>
          <button type="button" onClick={() => { setDone(null); setCheck(null); setWhen((w) => ({ ...w, date: "" })); }} className="text-tone/70 underline-offset-4 hover:underline">Book another time</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={book} className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.35fr_1fr]" noValidate>
      <div className="space-y-6 rounded-[2rem] border border-tone/10 bg-panel p-6 shadow-[0_30px_60px_-45px_rgba(20,15,10,0.6)] sm:p-8">
        <fieldset className="space-y-4">
          <legend className={cn(eyebrow, goldText, "mb-4")}>1 · When is your meeting?</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <F label="Date *" error={errors.date}><input className={fieldInput} type="date" min={today} value={when.date} onChange={setW("date")} aria-invalid={!!errors.date} /></F>
            <F label="Starts *" error={errors.start}><input className={fieldInput} type="time" step={900} value={when.start} onChange={setW("start")} /></F>
            <F label="Ends *" error={errors.end}><input className={fieldInput} type="time" step={900} value={when.end} onChange={setW("end")} /></F>
          </div>
          <div className="flex flex-wrap gap-2">
            {SLOTS.map(([label, a, b]) => {
              const on = when.start === a && when.end === b;
              return (
                <button key={label} type="button" aria-pressed={on} onClick={() => setWhen((w) => ({ ...w, start: a, end: b }))}
                  className={cn("rounded-full border px-4 py-2 text-left text-xs transition", on ? "border-gold bg-gold/15 text-tone" : "border-tone/15 text-tone/70 hover:border-tone/35")}>
                  <span className="font-semibold">{label}</span> <span className="tabular-nums opacity-70">{a}–{b}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-40"><F label="People *" error={errors.attendees}><input className={fieldInput} type="number" min={1} max={capacity} value={when.attendees} onChange={setW("attendees")} /></F></div>
            <button type="button" onClick={runCheck} disabled={checking} className={cn(pillGold, pillPad, "h-12")}>
              {checking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Check availability
            </button>
          </div>

          {fresh && (
            <div role="status" className={cn("rounded-2xl border p-4 text-sm", fresh.available ? "border-emerald-600/30 bg-emerald-600/[0.07]" : "border-red-700/25 bg-red-700/[0.06]")}>
              <p className="flex items-center gap-2 font-semibold text-tone">
                {fresh.available ? <CheckCircle2 className="size-5 text-emerald-700" /> : <XCircle className="size-5 text-red-700" />}
                {fresh.available ? `Available · ${longDate(when.date)}, ${when.start}–${when.end}` : "Already booked for part of that time"}
              </p>
              {fresh.available
                ? <p className="mt-1 text-tone/70">TZS {n(fresh.price)} for this booking. Add your details below to book it.</p>
                : <p className="mt-1 text-tone/70">Please choose another time on this day, or another date.</p>}
              {fresh.booked.length > 0 && (
                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-tone/65">
                  <span>Booked that day:</span>
                  {fresh.booked.map((t) => <span key={t} className="rounded-full bg-tone/10 px-2.5 py-1 font-medium tabular-nums text-tone">{t}</span>)}
                </p>
              )}
            </div>
          )}
        </fieldset>

        {fresh?.available && (
          <fieldset className="space-y-4 border-t border-tone/10 pt-6">
            <legend className={cn(eyebrow, goldText, "mb-4")}>2 · Your details</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <F label="Full name *" error={errors.fullName}><input className={fieldInput} value={f.fullName} onChange={set("fullName")} autoComplete="name" /></F>
              <F label="Company" error={errors.companyName}><input className={fieldInput} value={f.companyName} onChange={set("companyName")} autoComplete="organization" placeholder="Optional" /></F>
              <F label="Phone *" error={errors.phone}><input className={fieldInput} value={f.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="+255 …" /></F>
              <F label="Email" error={errors.email}><input className={fieldInput} type="email" value={f.email} onChange={set("email")} autoComplete="email" placeholder="Optional" /></F>
            </div>
            <F label="Special requirements" error={errors.requirements}><textarea className={fieldTextarea} value={f.requirements} onChange={set("requirements")} placeholder="e.g. projector, seating layout, tea break at 10:30, lunch for 12" /></F>
            <F label="Notes" error={errors.notes}><textarea className={cn(fieldTextarea, "min-h-20")} value={f.notes} onChange={set("notes")} /></F>
            <input type="text" name="website" value={f.website} onChange={set("website")} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            {online ? (
              <div className="space-y-4 border-t border-tone/10 pt-6">
                <p className={cn(eyebrow, goldText)}>3 · Pay online and confirm now</p>
                <F label="Mobile-money number *" error={errors.payPhone}>
                  <input className={fieldInput} value={number} onChange={(e) => setPayPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 0712 345 678" aria-invalid={!!errors.payPhone} />
                </F>
                <button type="button" onClick={payOnline} disabled={paying || booking} className={cn(pillGold, pillPad, "h-12 w-full sm:w-auto")}>
                  {paying ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />} Pay TZS {n(fresh.price)} & confirm
                </button>
                <p className="text-xs leading-relaxed text-tone/60">M-Pesa, Airtel Money, Tigo Pesa or HaloPesa — approve the request on your phone with your PIN. The time is held for you while you pay.</p>
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-tone/55"><ShieldCheck className="size-3.5 text-accent-ink" />Secure payment powered by NTZS</p>
                <button type="submit" disabled={booking || paying} className="text-sm font-medium text-tone/70 underline-offset-4 hover:text-tone hover:underline">
                  {booking ? "Sending your request…" : "Or send a request — pay at the hotel"}
                </button>
              </div>
            ) : (
              <button type="submit" disabled={booking} className={cn(pillGold, pillPad, "h-12 w-full sm:w-auto")}>
                {booking ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />} Book now
              </button>
            )}
          </fieldset>
        )}
        {formError && <p className={fieldError} role="alert">{formError}</p>}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
        <div className="rounded-[2rem] bg-[#15120e] p-6 text-white sm:p-8">
          <p className={cn(eyebrow, "text-gold")}>Meeting room</p>
          <p className="mt-3 font-display text-4xl tabular-nums">TZS {n(price)}</p>
          <p className="text-sm text-white/60">per booking</p>
          <ul className="mt-6 space-y-3 text-sm text-white/80">
            <li className="flex gap-3"><Users className="size-4 shrink-0 text-gold" />Up to {capacity} people</li>
            <li className="flex gap-3"><Clock className="size-4 shrink-0 text-gold" />Choose your own start and end time</li>
            <li className="flex gap-3"><CalendarCheck className="size-4 shrink-0 text-gold" />Food & drinks from our restaurant and bar can go on the same bill</li>
          </ul>
        </div>
        <p className="px-2 text-xs leading-relaxed text-tone/55">{online
          ? "No account needed. Pay online and your booking is confirmed at once — or send a request and our team calls or messages you to confirm it."
          : "No account needed and nothing to pay online. Your booking is confirmed when our team calls or messages you."}</p>
      </aside>
    </form>
  );
}

function F({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      {children}
      {error && <span className={fieldError}>{error}</span>}
    </label>
  );
}
