"use client";

import { useState, useTransition } from "react";
import { Car, Check, CheckCircle2, Loader2, PlaneLanding, PlaneTakeoff } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIRPORTS, isFromPrice } from "@/lib/transport-meta";
import { requestTransportAction, type TransportReceipt } from "@/app/(public)/transport/actions";
import { eyebrow, fieldError, fieldInput, fieldLabel, fieldTextarea, goldText, pillGold, pillPad } from "./ui";

export type PublicPackage = { id: string; name: string; description: string | null; price: number };
export type PublicService = { id: string; name: string; description: string | null; type: string; price: number; options: PublicPackage[] };

const n = (v: number) => v.toLocaleString("en-US");
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function ServiceIcon({ type, className }: { type: string; className?: string }) {
  if (type === "AIRPORT_PICKUP") return <PlaneLanding className={className} />;
  if (type === "AIRPORT_DROPOFF") return <PlaneTakeoff className={className} />;
  return <Car className={className} />;
}

/**
 * The public transport request: choose a service, fill in only what that trip
 * needs, send. No account and no password — a phone number is required so the
 * hotel can call to confirm. The request stays pending until the hotel confirms.
 */
export function TransportRequest({ services, today, initial }: { services: PublicService[]; today: string; initial?: string | null }) {
  const [serviceId, setServiceId] = useState(services.find((s) => s.type === initial || s.id === initial)?.id ?? services[0]?.id ?? "");
  const [optionId, setOptionId] = useState("");
  const [f, setF] = useState({
    passengerName: "", passengerPhone: "", passengerEmail: "", date: "", time: "", airport: AIRPORTS[0], pickupLocation: "", destination: "",
    flightNumber: "", passengers: "1", bags: "1", reservationRef: "", roomNumber: "", notes: "", company: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<TransportReceipt | null>(null);
  const [pending, start] = useTransition();
  const service = services.find((s) => s.id === serviceId);
  const option = service?.options.find((o) => o.id === optionId) ?? null;
  const needsOption = !!service?.options.length && !option;
  const price = option?.price ?? service?.price ?? 0;
  const pickup = service?.type === "AIRPORT_PICKUP";
  const airport = pickup || service?.type === "AIRPORT_DROPOFF";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await requestTransportAction({
        serviceId, optionId: option?.id, ...f, passengers: Number(f.passengers), bags: f.bags === "" ? undefined : Number(f.bags),
        airport: airport ? f.airport : undefined, flightNumber: airport ? f.flightNumber : undefined,
        pickupLocation: airport ? undefined : f.pickupLocation, destination: airport ? undefined : f.destination,
      });
      if (res.ok) { setDone(res.data); setErrors({}); setFormError(null); window.scrollTo({ top: (document.getElementById("request")?.offsetTop ?? 0) - 90, behavior: "smooth" }); }
      else { setErrors(res.fieldErrors ?? {}); setFormError(res.error); }
    });
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] border border-tone/10 bg-panel p-8 text-center shadow-[0_30px_60px_-40px_rgba(20,15,10,0.6)] sm:p-10" role="status">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-gold/15 text-accent-ink"><CheckCircle2 className="size-7" /></span>
        <p className={cn(eyebrow, goldText, "mt-5")}>Request received</p>
        <h3 className="mt-3 font-display text-3xl leading-tight text-tone sm:text-4xl">Thank you, {done.name}.</h3>
        <p className="mt-3 text-tone/70">Your transport request has been received. Our team will contact you to confirm the details.</p>
        <dl className="mt-7 divide-y divide-tone/10 rounded-2xl border border-tone/10 text-left text-sm">
          {[
            ["Reference", <span key="r" className="font-mono font-semibold tracking-wide">{done.reference}</span>],
            ["Service", done.option ? `${done.service} · ${done.option}` : done.service],
            ["Date", longDate(done.date)],
            [done.pickup ? "Arrival" : "Time", done.time],
            ["Transport fee", <span key="p" className="font-semibold tabular-nums">{done.custom ? "From " : ""}TZS {n(done.price)}</span>],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex items-center justify-between gap-4 px-5 py-3"><dt className="text-tone/55">{k}</dt><dd className="text-right text-tone">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-5 text-xs text-tone/55">Keep your reference. The request is confirmed only when we call or message you.</p>
        <button type="button" onClick={() => { setDone(null); setF((x) => ({ ...x, date: "", time: "", flightNumber: "", notes: "" })); }} className="mt-6 text-sm font-medium text-tone underline-offset-4 hover:underline">Request another trip</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-8" noValidate>
      {/* 1 · Service */}
      <fieldset>
        <legend className={cn(eyebrow, goldText, "mb-4")}>1 · Choose your transport</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((s) => {
            const on = s.id === serviceId;
            return (
              <button key={s.id} type="button" onClick={() => { setServiceId(s.id); setOptionId(""); }} aria-pressed={on}
                className={cn("group relative flex items-start gap-4 rounded-3xl border p-5 text-left transition duration-300",
                  on ? "border-gold bg-panel shadow-[0_20px_44px_-30px_oklch(0.72_0.12_80/0.9)]" : "border-tone/12 bg-panel/60 hover:border-tone/30 hover:bg-panel")}>
                <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl transition", on ? "bg-gold text-[#1a140c]" : "bg-paper-deep text-tone/70")}><ServiceIcon type={s.type} className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[1.35rem] leading-tight text-tone">{s.name}</span>
                  {s.description && <span className="mt-1 block text-sm leading-relaxed text-tone/60">{s.description}</span>}
                  <span className="mt-2 block text-sm font-semibold tabular-nums text-tone">{isFromPrice(s.type, s.options.length) && <span className="mr-1 font-normal text-tone/55">from</span>}TZS {n(s.price)}</span>
                </span>
                {on && <Check className="absolute right-4 top-4 size-4 text-accent-ink" />}
              </button>
            );
          })}
        </div>
      </fieldset>

      {!!service?.options.length && (
        <fieldset>
          <legend className={cn(eyebrow, goldText, "mb-4")}>Choose a package <span className="normal-case tracking-normal text-tone/55">— by time and distance</span></legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {service.options.map((o) => {
              const on = o.id === optionId;
              return (
                <button key={o.id} type="button" onClick={() => setOptionId(o.id)} aria-pressed={on}
                  className={cn("relative rounded-3xl border p-5 text-left transition duration-300", on ? "border-gold bg-panel shadow-[0_20px_44px_-30px_oklch(0.72_0.12_80/0.9)]" : "border-tone/12 bg-panel/60 hover:border-tone/30 hover:bg-panel")}>
                  <span className="block font-display text-xl leading-tight text-tone">{o.name}</span>
                  {o.description && <span className="mt-1 block text-sm text-tone/60">{o.description}</span>}
                  <span className="mt-3 block text-lg font-semibold tabular-nums text-tone">TZS {n(o.price)}</span>
                  {on && <Check className="absolute right-4 top-4 size-4 text-accent-ink" />}
                </button>
              );
            })}
          </div>
          {errors.optionId && <span className={fieldError}>{errors.optionId}</span>}
        </fieldset>
      )}

      {/* 2 · Details */}
      <fieldset className="space-y-5">
        <legend className={cn(eyebrow, goldText, "mb-4")}>2 · Your details</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Full name *" error={errors.passengerName}><input className={fieldInput} value={f.passengerName} onChange={set("passengerName")} autoComplete="name" required /></F>
          <F label="Phone number *" error={errors.passengerPhone} hint="We call or WhatsApp you to confirm."><input className={fieldInput} value={f.passengerPhone} onChange={set("passengerPhone")} inputMode="tel" autoComplete="tel" placeholder="+255 …" required /></F>
        </div>
        <F label="Email (optional)" error={errors.passengerEmail}><input className={fieldInput} value={f.passengerEmail} onChange={set("passengerEmail")} type="email" autoComplete="email" /></F>
      </fieldset>

      {/* 3 · The trip */}
      <fieldset className="space-y-5">
        <legend className={cn(eyebrow, goldText, "mb-4")}>3 · {pickup ? "Your arrival" : "Your trip"}</legend>
        {airport && (
          <F label="Airport *" error={errors.airport}>
            <input className={fieldInput} list="pub-airports" value={f.airport} onChange={set("airport")} />
            <datalist id="pub-airports">{AIRPORTS.map((a) => <option key={a} value={a} />)}</datalist>
          </F>
        )}
        {!airport && (
          <div className="grid gap-4 sm:grid-cols-2">
            <F label="Pickup" error={errors.pickupLocation}><input className={fieldInput} value={f.pickupLocation} onChange={set("pickupLocation")} placeholder="Vegas Luxury Hotel" /></F>
            <F label="Destination *" error={errors.destination}><input className={fieldInput} value={f.destination} onChange={set("destination")} placeholder="e.g. Mlimani City, Masaki…" /></F>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <F label={pickup ? "Arrival date *" : "Date *"} error={errors.date}><input className={fieldInput} type="date" min={today} value={f.date} onChange={set("date")} /></F>
          <F label={pickup ? "Expected arrival time *" : "Pickup time *"} error={errors.time}><input className={fieldInput} type="time" value={f.time} onChange={set("time")} /></F>
          {airport
            ? <F label={pickup ? "Flight number *" : "Flight number"} error={errors.flightNumber}><input className={cn(fieldInput, "uppercase")} value={f.flightNumber} onChange={set("flightNumber")} placeholder="e.g. TK603" /></F>
            : <F label="Guests *" error={errors.passengers}><input className={fieldInput} type="number" min={1} max={20} value={f.passengers} onChange={set("passengers")} /></F>}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {airport && <F label="Guests *" error={errors.passengers}><input className={fieldInput} type="number" min={1} max={20} value={f.passengers} onChange={set("passengers")} /></F>}
          <F label={pickup ? "Bags *" : "Bags"} error={errors.bags}><input className={fieldInput} type="number" min={0} max={40} value={f.bags} onChange={set("bags")} /></F>
          <F label="Booking number" error={errors.reservationRef} hint="If you have a room booking."><input className={cn(fieldInput, "uppercase")} value={f.reservationRef} onChange={set("reservationRef")} placeholder="VLH-…" /></F>
          {!airport && <F label="Room number" error={errors.roomNumber} hint="If you are staying with us."><input className={fieldInput} value={f.roomNumber} onChange={set("roomNumber")} /></F>}
        </div>
        <F label="Special instructions" error={errors.notes}>
          <textarea className={fieldTextarea} rows={3} value={f.notes} onChange={set("notes")} placeholder="Please wait at arrivals with my name · baby seat · a lot of luggage · late-night arrival…" />
        </F>
        <input type="text" name="company" value={f.company} onChange={set("company")} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      </fieldset>

      <div className="flex flex-col items-center gap-4 rounded-3xl border border-tone/10 bg-panel p-6 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p className="text-sm text-tone/60">{service?.name ?? "Transport"}{option ? ` · ${option.name}` : ""}</p>
          <p className="font-display text-3xl leading-none text-tone tabular-nums">{needsOption ? <span className="text-xl text-tone/55">Choose a package</span> : `${service?.type === "GUEST_TRANSPORT" ? "From " : ""}TZS ${n(price)}`}</p>
          <p className="mt-1 text-xs text-tone/55">{service?.type === "GUEST_TRANSPORT" ? "Starting price — we confirm the final price with you. " : ""}Pay after the trip, or add it to your room bill if you are staying with us.</p>
        </div>
        <button type="submit" disabled={pending || !serviceId || needsOption} className={cn(pillGold, pillPad, "shrink-0 whitespace-nowrap")}>
          {pending && <Loader2 className="size-4 animate-spin" />}Request transport
        </button>
      </div>
      {formError && <p className={cn(fieldError, "text-center")} role="alert">{formError}</p>}
    </form>
  );
}

function F({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      {children}
      {error ? <span className={fieldError}>{error}</span> : hint ? <span className="mt-1.5 block text-xs text-tone/50">{hint}</span> : null}
    </label>
  );
}
