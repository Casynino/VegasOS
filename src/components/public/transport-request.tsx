"use client";

import { useState, useTransition } from "react";
import { Car, LoaderCircle, PlaneLanding, PlaneTakeoff } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIRPORTS, isFromPrice } from "@/lib/transport-meta";
import { requestTransportAction, type TransportReceipt } from "@/app/(public)/[lang]/transport/actions";
import { useT } from "@/i18n/client";
import { Button, Eyebrow, HOTEL_COORDS, HudLabel, LinkButton, field, typeScale } from "./kit";
import { ChoiceRow } from "./services/choice-row";
import { Field, StepLegend } from "./services/form-field";
import { Receipt } from "./services/receipt";
import { ConsoleHead } from "./services/console";
import fx from "./services/fx.module.css";

export type PublicPackage = { id: string; name: string; description: string | null; price: number };
export type PublicService = { id: string; name: string; description: string | null; type: string; price: number; options: PublicPackage[] };

const n = (v: number) => v.toLocaleString("en-US");

function ServiceIcon({ type, className }: { type: string; className?: string }) {
  if (type === "AIRPORT_PICKUP") return <PlaneLanding className={className} strokeWidth={1.6} />;
  if (type === "AIRPORT_DROPOFF") return <PlaneTakeoff className={className} strokeWidth={1.6} />;
  return <Car className={className} strokeWidth={1.6} />;
}

/** "From TZS 50,000" inside a choice (phrasing content only — it sits in a button). */
function Amount({ from, amount }: { from?: boolean; amount: number }) {
  const t = useT();
  return (
    <span className="inline-flex items-baseline gap-1.5 text-pub-fg">
      {from && <span className={cn(typeScale.meta, "text-pub-muted")}>{t("From")}</span>}
      <span className={cn(typeScale.meta, "text-pub-muted")}>TZS</span>
      <span className={cn(typeScale.price, "text-[1.25rem] leading-none")}>{n(amount)}</span>
    </span>
  );
}

/**
 * The public transport request: choose a service, fill in only what that trip
 * needs, send. No account and no password — a phone number is required so the
 * hotel can call to confirm. The request stays pending until the hotel confirms.
 * Presented as a request console (smoked glass, a step track); on desktop the price and the send button
 * ride beside it on a ticket. Meant for a night band.
 */
export function TransportRequest({ services, today, initial, online = false }: { services: PublicService[]; today: string; initial?: string | null; /** Pay online (nTZS) offered for transport. */ online?: boolean }) {
  // Service and package names arrive already in the visitor's language (the page translates the hotel's content).
  const t = useT();
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
  const custom = service?.type === "GUEST_TRANSPORT";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await requestTransportAction({
        serviceId, optionId: option?.id, ...f, passengers: Number(f.passengers), bags: f.bags === "" ? undefined : Number(f.bags),
        airport: airport ? f.airport : undefined, flightNumber: airport ? f.flightNumber : undefined,
        pickupLocation: airport ? undefined : f.pickupLocation, destination: airport ? undefined : f.destination,
      });
      // The receipt replaces the form and brings itself into view under the header.
      if (res.ok) { setDone(res.data); setErrors({}); setFormError(null); }
      else { setErrors(res.fieldErrors ?? {}); setFormError(res.error); }
    });
  }

  if (done) {
    const payNow = online && !done.custom && done.price > 0;
    return (
      <Receipt
        eyebrow={t("Request received")}
        title={t("Thank you, {name}.", { name: done.name })}
        line={t("Your transport request has been received. Our team will contact you to confirm the details.")}
        rows={[
          { label: t("Reference"), value: <span className="font-mono font-semibold tracking-wide">{done.reference}</span> },
          { label: t("Service"), value: done.option ? `${done.service} · ${done.option}` : done.service },
          { label: t("Date"), value: t.date(done.date, true) },
          { label: done.pickup ? t("Arrival") : t("Time"), value: <span className="tabular-nums">{done.time}</span> },
          { label: t("Transport fee"), value: <span className="tabular-nums">{done.custom ? t("From {amount}", { amount: `TZS ${n(done.price)}` }) : `TZS ${n(done.price)}`}</span> },
        ]}
        note={t("Keep your reference. The request is confirmed only when we call or message you.")}
        actions={
          <>
            {done.page && (
              <LinkButton href={done.page} icon="arrow">
                {payNow ? t("Pay {amount} now", { amount: `TZS ${n(done.price)}` }) : t("View your trip")}
              </LinkButton>
            )}
            <Button variant="text" onClick={() => { setDone(null); setF((x) => ({ ...x, date: "", time: "", flightNumber: "", notes: "" })); }}>
              {t("Request another trip")}
            </Button>
          </>
        }
      />
    );
  }

  // How far along the console's step track is (presentation only).
  const reached = 1 + (f.passengerName.trim() && f.passengerPhone.trim() ? 1 : 0) + (f.date && f.time ? 1 : 0);
  const label = pickup ? t("Request airport pickup") : t("Request transport");
  const total = needsOption ? null : custom ? t("From {amount}", { amount: `TZS ${n(price)}` }) : `TZS ${n(price)}`;
  const note = `${custom ? `${t("Starting price — we confirm the final price with you.")} ` : ""}${online && !custom
    ? t("Pay now once you send it, after the trip, or on your room bill if you are staying with us.")
    : t("Pay after the trip, or add it to your room bill if you are staying with us.")}`;
  const send = (
    <Button type="submit" full disabled={pending || !serviceId || needsOption}>
      <span className="inline-flex items-center gap-2">
        {pending && <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
        {label}
      </span>
    </Button>
  );
  const problem = formError && <p className={cn(field.error, "mt-3")} role="alert">{formError}</p>;

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-12 lg:gap-10" noValidate>
      <div className="min-w-0 lg:col-span-7">
        <div className={fx.console}>
          <ConsoleHead label={t("Transport request")} steps={[t("Transport"), t("Details"), pickup ? t("Arrival") : t("Trip")]} reached={reached} />
          <div className="space-y-10 p-5 sm:p-7">
            {/* 1 · Service */}
            <fieldset>
              <StepLegend step={1}>{t("Choose your transport")}</StepLegend>
              <div role="group" aria-label={t("Transport services")} className="grid gap-2.5 sm:grid-cols-2">
                {services.map((s) => (
                  <ChoiceRow
                    key={s.id}
                    on={s.id === serviceId}
                    onSelect={() => { setServiceId(s.id); setOptionId(""); }}
                    icon={<ServiceIcon type={s.type} className="size-[18px]" />}
                    title={s.name}
                    sub={s.description ?? undefined}
                    meta={<Amount from={isFromPrice(s.type, s.options.length)} amount={s.price} />}
                  />
                ))}
              </div>

              {!!service?.options.length && (
                <fieldset className="mt-8">
                  <StepLegend hint={t("by time and distance")}>{t("Choose a package")}</StepLegend>
                  <div role="group" aria-label={t("Packages")} className="grid gap-2.5 sm:grid-cols-2">
                    {service.options.map((o) => (
                      <ChoiceRow
                        key={o.id}
                        on={o.id === optionId}
                        onSelect={() => setOptionId(o.id)}
                        title={o.name}
                        sub={o.description ?? undefined}
                        meta={<Amount amount={o.price} />}
                      />
                    ))}
                  </div>
                  {errors.optionId && <p className={field.error}>{errors.optionId}</p>}
                </fieldset>
              )}
            </fieldset>

            {/* 2 · Details */}
            <fieldset className="border-t border-pub-line pt-8">
              <StepLegend step={2}>{t("Your details")}</StepLegend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("Full name")} required error={errors.passengerName}>
                  <input className={field.input} value={f.passengerName} onChange={set("passengerName")} autoComplete="name" required aria-required="true" aria-invalid={!!errors.passengerName} />
                </Field>
                <Field label={t("Phone number")} required error={errors.passengerPhone} hint={t("We call or WhatsApp you to confirm.")}>
                  <input className={field.input} value={f.passengerPhone} onChange={set("passengerPhone")} inputMode="tel" autoComplete="tel" placeholder="+255 …" required aria-required="true" aria-invalid={!!errors.passengerPhone} />
                </Field>
                <Field label={t("Email")} error={errors.passengerEmail} className="sm:col-span-2">
                  <input className={field.input} value={f.passengerEmail} onChange={set("passengerEmail")} type="email" autoComplete="email" placeholder={t("Optional")} aria-invalid={!!errors.passengerEmail} />
                </Field>
              </div>
            </fieldset>

            {/* 3 · The trip */}
            <fieldset className="border-t border-pub-line pt-8">
              <StepLegend step={3}>{pickup ? t("Your arrival") : t("Your trip")}</StepLegend>
              <div className="grid gap-4">
                {airport ? (
                  <Field label={t("Airport")} required error={errors.airport}>
                    <input className={field.input} list="pub-airports" value={f.airport} onChange={set("airport")} aria-required="true" aria-invalid={!!errors.airport} />
                    <datalist id="pub-airports">{AIRPORTS.map((a) => <option key={a} value={a} />)}</datalist>
                  </Field>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* t.ctx("trip", …): the trip's sense of the word ("Pickup" is collecting an order, "Guests" the people staying). */}
                    <Field label={t.ctx("trip", "Pickup")} error={errors.pickupLocation}>
                      <input className={field.input} value={f.pickupLocation} onChange={set("pickupLocation")} placeholder="Vegas Luxury Hotel" aria-invalid={!!errors.pickupLocation} />
                    </Field>
                    <Field label={t("Destination")} required error={errors.destination}>
                      <input className={field.input} value={f.destination} onChange={set("destination")} placeholder={t("e.g. Mlimani City, Masaki…")} aria-required="true" aria-invalid={!!errors.destination} />
                    </Field>
                  </div>
                )}
                <div className="grid gap-4 min-[400px]:grid-cols-2">
                  <Field label={pickup ? t("Arrival date") : t("Date")} required error={errors.date}>
                    <input className={field.input} type="date" min={today} value={f.date} onChange={set("date")} aria-required="true" aria-invalid={!!errors.date} />
                  </Field>
                  <Field label={pickup ? t("Arrival time") : t("Pickup time")} required error={errors.time}>
                    <input className={field.input} type="time" value={f.time} onChange={set("time")} aria-required="true" aria-invalid={!!errors.time} />
                  </Field>
                </div>
                <div className={cn("grid grid-cols-2 gap-4", airport && "sm:grid-cols-3")}>
                  {airport && (
                    <Field label={t("Flight number")} required={pickup} error={errors.flightNumber} className="col-span-2 sm:col-span-1">
                      <input className={cn(field.input, "uppercase placeholder:normal-case")} value={f.flightNumber} onChange={set("flightNumber")} placeholder={t("e.g. {example}", { example: "TK603" })} aria-required={pickup || undefined} aria-invalid={!!errors.flightNumber} />
                    </Field>
                  )}
                  <Field label={t.ctx("trip", "Guests")} required error={errors.passengers}>
                    <input className={field.input} type="number" inputMode="numeric" min={1} max={20} value={f.passengers} onChange={set("passengers")} aria-required="true" aria-invalid={!!errors.passengers} />
                  </Field>
                  <Field label={t("Bags")} required={pickup} error={errors.bags}>
                    <input className={field.input} type="number" inputMode="numeric" min={0} max={40} value={f.bags} onChange={set("bags")} aria-required={pickup || undefined} aria-invalid={!!errors.bags} />
                  </Field>
                </div>
                <div className={cn("grid gap-4", !airport && "sm:grid-cols-2")}>
                  <Field label={t("Booking number")} error={errors.reservationRef}>
                    <input className={cn(field.input, "uppercase placeholder:normal-case")} value={f.reservationRef} onChange={set("reservationRef")} placeholder={t("VLH-… if you have a room booking")} aria-invalid={!!errors.reservationRef} />
                  </Field>
                  {!airport && (
                    <Field label={t("Room number")} error={errors.roomNumber}>
                      <input className={field.input} value={f.roomNumber} onChange={set("roomNumber")} placeholder={t("If you are staying with us")} aria-invalid={!!errors.roomNumber} />
                    </Field>
                  )}
                </div>
                <Field label={t("Special instructions")} error={errors.notes}>
                  <textarea className={field.textarea} rows={3} value={f.notes} onChange={set("notes")} placeholder={t("Please wait at arrivals with my name · baby seat · a lot of luggage · late-night arrival…")} />
                </Field>
              </div>
              <input type="text" name="company" value={f.company} onChange={set("company")} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
            </fieldset>

            {/* Phones and tablets: the price and the send button close the form. */}
            <div className="border-t border-pub-line pt-8 lg:hidden">
              <p className={cn(typeScale.meta, "text-pub-muted")}>{service?.name ?? t("Transport")}{option ? ` · ${option.name}` : ""}</p>
              <p className={cn(typeScale.price, "mt-2 text-[1.75rem] leading-none text-pub-fg")}>
                {total ?? <span className="font-sans text-[15px] text-pub-muted">{t("Choose a package")}</span>}
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-pub-muted">{note}</p>
              <div className="mt-6">{send}</div>
              {problem}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop: what you are asking for, its price and the send button, beside the steps. */}
      <aside aria-label={t("Your request")} className="hidden lg:col-span-5 lg:col-start-8 lg:block lg:sticky lg:top-24 lg:self-start xl:col-span-4 xl:col-start-9">
        <div className={cn(fx.console, "p-7")}>
          <div className="flex items-center justify-between gap-4">
            <Eyebrow>{t("Your request")}</Eyebrow>
            <span className="text-pub-eyebrow">
              <ServiceIcon type={service?.type ?? ""} className="size-[18px]" />
            </span>
          </div>
          <p className="mt-4 font-display text-[1.5rem] leading-tight">{service?.name ?? t("Transport")}</p>
          {option && <p className="mt-1 text-[14px] text-pub-muted">{option.name}</p>}
          <p className={cn(typeScale.price, "mt-5 text-[2rem] leading-none")}>
            {total ?? <span className="font-sans text-[15px] text-pub-muted">{t("Choose a package")}</span>}
          </p>
          <div aria-hidden="true" className={cn(fx.perf, "mt-6")} />
          <p className="mt-5 text-[13px] leading-relaxed text-pub-muted">{note}</p>
          <div className="mt-6">{send}</div>
          {problem}
          <HudLabel className="mt-6">{HOTEL_COORDS.label}</HudLabel>
        </div>
      </aside>
    </form>
  );
}
