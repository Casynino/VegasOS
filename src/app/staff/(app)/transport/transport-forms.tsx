"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BedDouble, Car, Check, CheckCircle2, Clock, History, Loader2, Luggage, MessageCircle, Phone, PlaneLanding, PlaneTakeoff, Plus, Receipt, Tag, UserRound, Users, Wallet, X,
} from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { AccountSelect } from "@/components/staff/finance/account-select";
import type { PayAccount } from "@/lib/pay-account";
import { AIRPORTS, TRIP_STATUS_META, TRIP_TYPE_LABEL, isFromPrice, tripTone } from "@/lib/transport-meta";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  adjustTripPriceAction, chargeTripToRoomAction, confirmTripAction, createTransportRequestAction, payTripDirectAction, recordDriverAction,
  saveTransportServiceAction, saveVehicleAction, tripHistoryAction, tripStatusAction,
} from "./actions";

export type PackageOpt = { id: string; name: string; description: string | null; price: number; isActive?: boolean };
export type ServiceOpt = { id: string; name: string; description?: string | null; type: string; price: number; isActive?: boolean; isPublic?: boolean; options: PackageOpt[] };
export type BookingOpt = { id: string; name: string; phone: string | null; email: string | null; label: string; staying: boolean };
export type TripView = {
  id: string; reference: string; type: string; status: string; source: string;
  passengerName: string; passengerPhone: string | null; passengerEmail: string | null;
  date: string; time: string; pickupLocation: string; destination: string; flightNumber: string | null; passengers: number; bags: number; notes: string | null;
  reservation: { id: string; reference: string } | null; reservationRef: string | null; roomNumber: string | null;
  driverName: string | null; driverPhone: string | null; vehicleName: string | null; vehiclePlate: string | null;
  price: number; priceOption: string | null; standardPrice: number | null; priceReason: string | null; priceAdjustedBy: string | null;
  confirmedBy: string | null; cancelReason: string | null;
  money: "ROOM" | "PAID" | "TO_BILL" | null; paidInto: string | null;
};


/** The trip's icon: plane landing / taking off for airport trips, a car otherwise. */
export function TripIcon({ type, className }: { type: string; className?: string }) {
  if (type === "AIRPORT_PICKUP") return <PlaneLanding className={className} />;
  if (type === "AIRPORT_DROPOFF") return <PlaneTakeoff className={className} />;
  return <Car className={className} />;
}
const wa = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
const OPEN = ["REQUESTED", "CONFIRMED", "ASSIGNED", "EN_ROUTE", "PICKED_UP"];

/* ─────────────── New request (phone / WhatsApp / walk-up / staying guest) ─────────────── */

export function NewRequestButton({ services, bookings, today, prefill, defaultOpen = false }: {
  services: ServiceOpt[]; bookings: BookingOpt[]; today: string; prefill?: { reservationId: string } | null; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5"><Plus />New request</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader icon={<Car />} eyebrow="Transport" tone="sky">
            <DialogTitle>New transport request</DialogTitle>
            <DialogDescription>For a call, a WhatsApp message or a guest at the desk — the same request the website makes.</DialogDescription>
          </DialogHeader>
          <RequestForm services={services} bookings={bookings} today={today} prefill={prefill} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The request form itself — also opened inside a room card (Transport). */
export function RequestForm({ services, bookings, today, prefill, onDone }: { services: ServiceOpt[]; bookings: BookingOpt[]; today: string; prefill?: { reservationId: string } | null; onDone: () => void }) {
  const router = useRouter();
  const booked = bookings.find((b) => b.id === prefill?.reservationId) ?? null;
  // A staying guest usually needs a drop-off; an arriving guest a pickup.
  const first = services.find((s) => s.type === (booked?.staying ? "AIRPORT_DROPOFF" : "AIRPORT_PICKUP")) ?? services[0];
  const [serviceId, setServiceId] = useState(first?.id ?? "");
  const [optionId, setOptionId] = useState("");
  const [bookingId, setBookingId] = useState(booked?.id ?? "");
  const [f, setF] = useState({
    passengerName: booked?.name ?? "", passengerPhone: booked?.phone ?? "", passengerEmail: booked?.email ?? "",
    date: today, time: "", airport: AIRPORTS[0], pickupLocation: "", destination: "", flightNumber: "", passengers: "1", bags: "0", reservationRef: "", notes: "",
  });
  const [confirmNow, setConfirmNow] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const service = services.find((s) => s.id === serviceId);
  const option = service?.options.find((o) => o.id === optionId) ?? null;
  const needsOption = !!service?.options.length && !option;
  const price = option?.price ?? service?.price ?? 0;
  const pickup = service?.type === "AIRPORT_PICKUP";
  const airport = pickup || service?.type === "AIRPORT_DROPOFF";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  function pickBooking(id: string) {
    setBookingId(id);
    const b = bookings.find((x) => x.id === id);
    if (b) setF((x) => ({ ...x, passengerName: b.name, passengerPhone: b.phone ?? x.passengerPhone, passengerEmail: b.email ?? x.passengerEmail }));
  }
  function submit() {
    start(async () => {
      const res = await createTransportRequestAction({
        serviceId, optionId: option?.id, ...f, passengers: Number(f.passengers), bags: Number(f.bags || 0), reservationId: bookingId || undefined,
        airport: airport ? f.airport : undefined, confirmNow,
      });
      if (res.ok) { toast.success(`${res.data.reference} created${confirmNow ? " and confirmed" : " — pending"}.`); onDone(); router.refresh(); }
      else { setErrors(res.fieldErrors ?? {}); toast.error(res.error); }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {services.map((s) => {
          return (
            <button key={s.id} type="button" onClick={() => { setServiceId(s.id); setOptionId(""); }} aria-pressed={s.id === serviceId}
              className={cn("flex items-center gap-3 rounded-2xl border p-3 text-left transition", s.id === serviceId ? "border-foreground/60 bg-muted/60" : "border-border hover:bg-muted/40")}>
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tripTone(s.type))}><TripIcon type={s.type} className="size-4" /></span>
              <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm font-semibold">{s.name}</span><span className="text-xs text-muted-foreground">{s.options.length > 1 ? `${s.options.length} packages · from ${formatTZS(s.price)}` : isFromPrice(s.type) ? `from ${formatTZS(s.price)} · agree the final price` : formatTZS(s.price)}</span></span>
              {s.id === serviceId && <Check className="size-4 text-emerald-600" />}
            </button>
          );
        })}
      </div>

      {!!service?.options.length && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Package * <span className="font-normal">— by time and distance</span></p>
          <div className="grid gap-2 sm:grid-cols-3">
            {service.options.map((o) => (
              <button key={o.id} type="button" onClick={() => setOptionId(o.id)} aria-pressed={o.id === optionId}
                className={cn("rounded-2xl border p-3 text-left transition", o.id === optionId ? "border-emerald-500 bg-emerald-500/[0.08]" : "border-border hover:bg-muted/40")}>
                <span className="block text-sm font-semibold">{o.name}</span>
                {o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}
                <span className="mt-1 block text-sm font-semibold tabular-nums">{formatTZS(o.price)}</span>
              </button>
            ))}
          </div>
          {errors.optionId && <p className="text-xs text-rose-600">{errors.optionId}</p>}
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Guest with a booking? (in the hotel or arriving)</span>
        <NativeSelect value={bookingId} onChange={(e) => pickBooking(e.target.value)}>
          <option value="">No — a new or outside customer</option>
          {bookings.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.label}</option>)}
        </NativeSelect>
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name *" error={errors.passengerName}><Input value={f.passengerName} onChange={set("passengerName")} /></Field>
        <Field label="Phone *" error={errors.passengerPhone}><Input value={f.passengerPhone} onChange={set("passengerPhone")} inputMode="tel" placeholder="+255 …" /></Field>
        <Field label="Email" error={errors.passengerEmail}><Input value={f.passengerEmail} onChange={set("passengerEmail")} type="email" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={pickup ? "Arrival date *" : "Date *"} error={errors.date}><Input type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label={pickup ? "Arrival time *" : "Pickup time *"} error={errors.time}><Input type="time" value={f.time} onChange={set("time")} /></Field>
        {airport
          ? <Field label={pickup ? "Flight number *" : "Flight number"} error={errors.flightNumber}><Input value={f.flightNumber} onChange={set("flightNumber")} placeholder="e.g. TK603" className="uppercase" /></Field>
          : <Field label="Passengers *" error={errors.passengers}><Input type="number" min={1} value={f.passengers} onChange={set("passengers")} /></Field>}
      </div>

      {airport ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem]">
          <Field label="Airport *" error={errors.airport}>
            <Input list="tr-airports" value={f.airport} onChange={set("airport")} />
            <datalist id="tr-airports">{AIRPORTS.map((a) => <option key={a} value={a} />)}</datalist>
          </Field>
          <Field label="Guests *" error={errors.passengers}><Input type="number" min={1} value={f.passengers} onChange={set("passengers")} /></Field>
          <Field label={pickup ? "Bags *" : "Bags"} error={errors.bags}><Input type="number" min={0} value={f.bags} onChange={set("bags")} /></Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_7rem]">
          <Field label="From" error={errors.pickupLocation}><Input value={f.pickupLocation} onChange={set("pickupLocation")} placeholder="Vegas Luxury Hotel" /></Field>
          <Field label="To *" error={errors.destination}><Input value={f.destination} onChange={set("destination")} placeholder="e.g. Mlimani City" /></Field>
          <Field label="Bags" error={errors.bags}><Input type="number" min={0} value={f.bags} onChange={set("bags")} /></Field>
        </div>
      )}

      <div className={cn("grid gap-3", !bookingId && "sm:grid-cols-[12rem_1fr]")}>
        {!bookingId && <Field label="Booking number" error={errors.reservationRef}><Input value={f.reservationRef} onChange={set("reservationRef")} placeholder="If they have one" /></Field>}
        <Field label="Special instructions" error={errors.notes}><Textarea rows={2} value={f.notes} onChange={set("notes")} placeholder="Wait at arrivals with a name sign · baby seat · lots of luggage…" /></Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/50 p-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />Agreed with the guest — confirm it now</label>
        <Button onClick={submit} disabled={pending || !serviceId || needsOption}>{pending && <Loader2 className="animate-spin" />}{needsOption ? "Choose a package" : `Create request · ${formatTZS(price)}`}</Button>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {error && <span className="block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

/* ─────────────── A trip, opened: details and the next step ─────────────── */

type CardCtx = {
  drivers: { id: string; fullName: string; phone: string | null }[]; vehicles: { id: string; name: string; plateNumber: string | null }[];
  accounts: PayAccount[]; staying: BookingOpt[]; perms: { manage: boolean; pay: boolean };
};

/** Confirm a waiting request right from the list — the driver and the rest are added when the trip is opened. */
export function ConfirmTripQuick({ tripId, className }: { tripId: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" disabled={pending} className={className} onClick={() => start(async () => {
      const r = await confirmTripAction({ tripId });
      if (r.ok) { toast.success("Transport confirmed — open it to add the driver."); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : <Check />}Confirm</Button>
  );
}

export function TripRowButton({ trip, children, ...ctx }: { trip: TripView; children: React.ReactNode } & CardCtx) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full text-left">{children}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
          {open && <TripCard trip={trip} onClose={() => setOpen(false)} {...ctx} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

const HISTORY: Record<string, string> = {
  "transport.requested": "Request created", "transport.confirmed": "Confirmed", "transport.driver_assigned": "Driver assigned", "transport.driver_changed": "Driver changed",
  "transport.started": "Trip started", "transport.picked_up": "Picked up", "transport.completed": "Completed", "transport.cancelled": "Cancelled", "transport.no_show": "No show",
  "transport.price_adjusted": "Price adjusted", "transport.charged_to_room": "Added to the room bill", "transport.paid": "Payment recorded",
};

function TripCard({ trip: t, onClose, drivers, vehicles, accounts, staying, perms }: { trip: TripView; onClose: () => void } & CardCtx) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [panel, setPanel] = useState<"driver" | "price" | "cancel" | "noshow" | "pay" | "room" | null>(null);
  const [history, setHistory] = useState<{ id: string; action: string; by: string | null; at: string; reason: string | null }[] | null>(null);
  const meta = TRIP_STATUS_META[t.status as keyof typeof TRIP_STATUS_META];
  const open = OPEN.includes(t.status);
  const hasDriver = !!t.driverName;
  const billed = t.money === "ROOM" || t.money === "PAID";

  useEffect(() => { void tripHistoryAction({ tripId: t.id }).then((r) => { if (r.ok) setHistory(r.data); }); }, [t.id]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) { if (done) toast.success(done); setPanel(null); router.refresh(); onClose(); }
      else toast.error(r.error ?? "Something went wrong.");
    });
  }
  const toRoom = (reservationId?: string) => run(async () => {
    const r = await chargeTripToRoomAction({ tripId: t.id, reservationId });
    if (r.ok) toast.success(`${formatTZS(t.price)} added to ${r.data.room ? `Room ${r.data.room}` : "the guest's bill"}.`);
    return r;
  });

  const initials = t.passengerName.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const primary = "h-11 rounded-xl px-4";
  return (
    <div>
      {/* ── The ticket: who, from where to where, when ── */}
      <div className="relative overflow-hidden bg-[#15110c] px-5 pb-5 pt-5 text-white">
        <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[oklch(0.75_0.13_80)]/20 blur-3xl" />
        <DialogHeader className="relative text-left">
          <div className="flex items-start gap-3 pr-8">
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", tripTone(t.type))}><TripIcon type={t.type} className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">{TRIP_TYPE_LABEL[t.type as keyof typeof TRIP_TYPE_LABEL]} · <span className="font-mono tracking-wider">{t.reference}</span></p>
              <DialogTitle className="mt-1 truncate text-xl text-white">{t.passengerName}</DialogTitle>
              <DialogDescription className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-white/55">
                <span className={cn("rounded-full px-2.5 py-0.5 font-semibold", meta.className)}>{meta.label}</span>
                <span>{t.source === "WEBSITE" ? "From the website" : "Booked by staff"}{t.confirmedBy ? ` · confirmed by ${t.confirmedBy}` : ""}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="relative mt-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
          <div className="min-w-0 leading-tight">
            <p className="text-[10px] uppercase tracking-wider text-white/45">From</p>
            <p className="mt-1 line-clamp-2 text-[15px] font-semibold">{t.pickupLocation}</p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-semibold tabular-nums ring-1 ring-white/15">{t.time}</span>
            <span className="flex w-14 items-center gap-1 text-white/30"><span className="h-px flex-1 border-t border-dashed border-white/30" /><TripIcon type={t.type} className="size-3.5" /></span>
          </div>
          <div className="min-w-0 text-right leading-tight">
            <p className="text-[10px] uppercase tracking-wider text-white/45">To</p>
            <p className="mt-1 line-clamp-2 text-[15px] font-semibold">{t.destination}</p>
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-1.5 text-[11.5px] text-white/80">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 ring-1 ring-white/10"><Clock className="size-3 text-[#f0cf86]" />{t.date}</span>
          {t.flightNumber && <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 ring-1 ring-white/10"><PlaneLanding className="size-3 text-[#f0cf86]" />Flight <span className="font-mono">{t.flightNumber}</span></span>}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 ring-1 ring-white/10"><Users className="size-3 text-[#f0cf86]" />{t.passengers} guest{t.passengers === 1 ? "" : "s"}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 ring-1 ring-white/10"><Luggage className="size-3 text-[#f0cf86]" />{t.bags} bag{t.bags === 1 ? "" : "s"}</span>
        </div>
      </div>
      {/* Tear line */}
      <div className="relative h-0 border-t-2 border-dashed border-border">
        <span className="absolute -left-3.5 -top-3.5 size-7 rounded-full bg-background/80" />
        <span className="absolute -right-3.5 -top-3.5 size-7 rounded-full bg-background/80" />
      </div>

      <div className="space-y-3.5 p-5">
        {t.notes && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-100 ring-1 ring-inset ring-amber-500/20">“{t.notes}”</p>}

        {/* Who travels, who drives */}
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/20">
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sky-500/15 text-sm font-bold text-sky-300 ring-1 ring-sky-500/30">{initials || <UserRound className="size-4" />}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Guest</p>
              <p className="truncate text-[15px] font-semibold">{t.passengerName}</p>
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                {t.reservation ? <a href={`/staff/reservations/${t.reservation.id}`} className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"><BedDouble className="size-3" />{t.roomNumber ? `Room ${t.roomNumber} · ` : ""}{t.reservation.reference}</a>
                  : t.reservationRef ? <>Booking given: <span className="font-mono">{t.reservationRef}</span> (not matched)</>
                    : "Outside guest — no booking"}
                {t.passengerEmail && <span className="block truncate">{t.passengerEmail}</span>}
              </p>
            </div>
            {t.passengerPhone && (
              <div className="flex shrink-0 gap-1.5">
                <a href={`tel:${t.passengerPhone}`} title={`Call ${t.passengerPhone}`} aria-label={`Call ${t.passengerPhone}`} className="grid size-9 place-items-center rounded-full border border-border hover:bg-muted"><Phone className="size-4" /></a>
                <a href={wa(t.passengerPhone)} target="_blank" rel="noreferrer" title="WhatsApp" aria-label="WhatsApp" className="grid size-9 place-items-center rounded-full bg-[#25D366] text-[#073b1f] hover:brightness-105"><MessageCircle className="size-4" /></a>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-border/60 px-3.5 py-3">
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", hasDriver ? "bg-[oklch(0.75_0.13_80)]/15 text-[oklch(0.84_0.11_82)] ring-1 ring-[oklch(0.75_0.13_80)]/30" : "border border-dashed border-border text-muted-foreground")}><Car className="size-4" /></span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Driver</p>
              {hasDriver ? (
                <>
                  <p className="truncate text-[15px] font-semibold">{t.driverName}</p>
                  <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {[t.driverPhone, [t.vehicleName, t.vehiclePlate].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "No phone or vehicle yet"}
                  </p>
                </>
              ) : <p className="text-sm text-muted-foreground">{t.status === "REQUESTED" ? "Confirm the request first" : "Not assigned yet"}</p>}
            </div>
            {open && t.status !== "REQUESTED" && (!hasDriver || perms.manage) && (
              <button type="button" onClick={() => setPanel(panel === "driver" ? null : "driver")} className="h-9 shrink-0 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted">{hasDriver ? "Change" : "Assign"}</button>
            )}
          </div>
        </div>
        {panel === "driver" && <DriverPanel trip={t} drivers={drivers} vehicles={vehicles} pending={pending} onSave={(v) => run(() => recordDriverAction({ tripId: t.id, ...v }), "Driver saved.")} />}

        {/* The money */}
        <div className="rounded-2xl border border-border/70 p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Price{t.priceOption ? ` · ${t.priceOption}` : ""}</span>
            <span className="whitespace-nowrap text-[1.6rem] font-semibold leading-none tracking-tight tabular-nums"><span className="mr-1 text-sm font-medium text-muted-foreground">TZS</span>{t.price.toLocaleString("en-US")}</span>
          </div>
          {t.standardPrice != null && t.standardPrice !== t.price && (
            <p className="mt-1.5 text-right text-xs text-muted-foreground">Standard {formatTZS(t.standardPrice)} · {t.price < t.standardPrice ? "−" : "+"}{formatTZS(Math.abs(t.standardPrice - t.price))}{t.priceReason ? ` · ${t.priceReason}` : ""}{t.priceAdjustedBy ? ` · by ${t.priceAdjustedBy}` : ""}</p>
          )}
          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-dashed border-border pt-2.5 text-xs">
            {t.money === "ROOM" ? <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/12 px-2.5 py-1 font-semibold text-sky-300"><BedDouble className="size-3.5" />On the room bill{t.roomNumber ? ` · Room ${t.roomNumber}` : ""}</span>
              : t.money === "PAID" ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 font-semibold text-emerald-300"><CheckCircle2 className="size-3.5" />Paid{t.paidInto ? ` · ${t.paidInto}` : ""}</span>
                : t.money === "TO_BILL" ? <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 py-1 font-semibold text-amber-300"><Wallet className="size-3.5" />To bill — add to the room or receive payment</span>
                  : <span className="text-muted-foreground">Billed after the trip is completed</span>}
            {perms.manage && !billed && !["CANCELLED", "NO_SHOW"].includes(t.status) && (
              <button type="button" onClick={() => setPanel(panel === "price" ? null : "price")} className="shrink-0 font-semibold text-[oklch(0.84_0.11_82)] underline-offset-2 hover:underline"><Tag className="mr-1 inline size-3" />Adjust</button>
            )}
          </div>
        </div>
        {panel === "price" && <PricePanel price={t.price} pending={pending} onSave={(price, reason) => run(() => adjustTripPriceAction({ tripId: t.id, price, reason }), "Price changed.")} />}
        {(panel === "cancel" || panel === "noshow") && (
          <ReasonPanel placeholder={panel === "cancel" ? "Why is it cancelled?" : "What happened? (optional)"} required={panel === "cancel"} pending={pending}
            button={panel === "cancel" ? "Cancel request" : "Mark as no show"}
            onSave={(reason) => run(() => tripStatusAction({ tripId: t.id, status: panel === "cancel" ? "CANCELLED" : "NO_SHOW", reason }), panel === "cancel" ? "Request cancelled." : "Marked as no show.")} />
        )}
        {panel === "pay" && <PayPanel accounts={accounts} amount={t.price} pending={pending} onSave={(accountId, reference) => run(() => payTripDirectAction({ tripId: t.id, accountId, reference }), "Payment recorded.")} />}
        {panel === "room" && <RoomPanel staying={staying} pending={pending} onSave={(id) => toRoom(id)} />}
        {t.cancelReason && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{t.status === "NO_SHOW" ? "No show" : "Cancelled"}: {t.cancelReason}</p>}

        <details className="group rounded-2xl border border-border/60 px-3.5 py-2.5 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium"><History className="size-4 text-muted-foreground" />History<span className="ml-auto text-xs text-muted-foreground group-open:hidden">{history ? `${history.length} step${history.length === 1 ? "" : "s"}` : ""}</span></summary>
          <ol className="mt-3 space-y-2.5 border-l border-border/70 pl-4">
            {(history ?? []).map((h) => (
              <li key={h.id} className="relative leading-tight">
                <span className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-[oklch(0.75_0.13_80)] ring-4 ring-background" />
                <span className="block text-foreground">{HISTORY[h.action] ?? h.action.replace("transport.", "").replace("_", " ")}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })}{h.by && ` · ${h.by}`}{h.reason && ` · ${h.reason}`}
                </span>
              </li>
            ))}
            {history?.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
            {!history && <li className="text-muted-foreground">Loading…</li>}
          </ol>
        </details>
      </div>

      {/* What to do next — always in reach */}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border/70 bg-popover/95 px-5 py-4 backdrop-blur">
        {t.status === "REQUESTED" && <Button className={primary} disabled={pending} onClick={() => run(() => confirmTripAction({ tripId: t.id }), "Transport confirmed.")}>{pending ? <Loader2 className="animate-spin" /> : <Check />}Confirm request</Button>}
        {(t.status === "CONFIRMED" || t.status === "ASSIGNED") && <Button variant="outline" className={primary} disabled={pending} onClick={() => run(() => tripStatusAction({ tripId: t.id, status: "EN_ROUTE" }), "Trip started.")}><Car />Start trip</Button>}
        {["CONFIRMED", "ASSIGNED", "EN_ROUTE", "PICKED_UP"].includes(t.status) && <Button className={primary} disabled={pending} onClick={() => run(() => tripStatusAction({ tripId: t.id, status: "COMPLETED" }), "Completed — now add it to the room or receive payment.")}><CheckCircle2 />Complete</Button>}
        {t.money === "TO_BILL" && perms.pay && (
          <>
            <Button className={primary} disabled={pending} onClick={() => (t.reservation ? toRoom() : setPanel(panel === "room" ? null : "room"))}><BedDouble />{t.reservation ? `Add to room${t.roomNumber ? ` ${t.roomNumber}` : ""}` : "Add to a guest's room"}</Button>
            <Button variant="outline" className={primary} disabled={pending} onClick={() => setPanel(panel === "pay" ? null : "pay")}><Wallet />Direct payment</Button>
          </>
        )}
        <span className="ml-auto flex gap-1">
          {["REQUESTED", "CONFIRMED", "ASSIGNED", "EN_ROUTE"].includes(t.status) && <Button variant="ghost" className="h-11 rounded-xl" disabled={pending} onClick={() => setPanel(panel === "noshow" ? null : "noshow")}>No show</Button>}
          {open && perms.manage && <Button variant="ghost" className="h-11 rounded-xl text-rose-400 hover:text-rose-300" disabled={pending} onClick={() => setPanel(panel === "cancel" ? null : "cancel")}><X />Cancel</Button>}
        </span>
      </div>
    </div>
  );
}

function DriverPanel({ trip, drivers, vehicles, pending, onSave }: {
  trip: TripView; drivers: CardCtx["drivers"]; vehicles: CardCtx["vehicles"]; pending: boolean;
  onSave: (v: { driverId?: string; driverName?: string; driverPhone?: string; vehicleId?: string; vehicleName?: string; vehiclePlate?: string }) => void;
}) {
  const [v, setV] = useState({ driverId: "", driverName: trip.driverName ?? "", driverPhone: trip.driverPhone ?? "", vehicleId: "", vehicleName: trip.vehicleName ?? "", vehiclePlate: trip.vehiclePlate ?? "" });
  return (
    <div className="space-y-2 rounded-2xl bg-muted/50 p-3">
      {drivers.length > 0 && (
        <NativeSelect value={v.driverId} onChange={(e) => { const d = drivers.find((x) => x.id === e.target.value); setV({ ...v, driverId: e.target.value, driverName: d?.fullName ?? v.driverName, driverPhone: d?.phone ?? v.driverPhone }); }}>
          <option value="">Hotel driver (optional) — or type below</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
        </NativeSelect>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={v.driverName} onChange={(e) => setV({ ...v, driverName: e.target.value })} placeholder="Driver name *" />
        <Input value={v.driverPhone} onChange={(e) => setV({ ...v, driverPhone: e.target.value })} placeholder="Driver phone" inputMode="tel" />
        {vehicles.length > 0 ? (
          <NativeSelect value={v.vehicleId} onChange={(e) => { const x = vehicles.find((y) => y.id === e.target.value); setV({ ...v, vehicleId: e.target.value, vehicleName: x?.name ?? v.vehicleName, vehiclePlate: x?.plateNumber ?? v.vehiclePlate }); }}>
            <option value="">Vehicle — or type the registration</option>
            {vehicles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.plateNumber ? ` · ${x.plateNumber}` : ""}</option>)}
          </NativeSelect>
        ) : <Input value={v.vehicleName} onChange={(e) => setV({ ...v, vehicleName: e.target.value })} placeholder="Vehicle, e.g. Toyota Noah" />}
        <Input value={v.vehiclePlate} onChange={(e) => setV({ ...v, vehiclePlate: e.target.value })} placeholder="Registration, e.g. T 123 ABC" className="uppercase" />
      </div>
      <Button size="sm" disabled={pending || !v.driverName.trim()} onClick={() => onSave(v)}>{pending && <Loader2 className="animate-spin" />}Save driver</Button>
    </div>
  );
}

function PricePanel({ price, pending, onSave }: { price: number; pending: boolean; onSave: (price: number, reason: string) => void }) {
  const [p, setP] = useState(String(price));
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-2 rounded-2xl bg-muted/50 p-3 sm:grid-cols-[9rem_1fr_auto]">
      <Input type="number" min={0} step={1000} value={p} onChange={(e) => setP(e.target.value)} aria-label="Final price" />
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. Corporate guest" aria-label="Reason" />
      <Button disabled={pending || !reason.trim()} onClick={() => onSave(Number(p), reason)}>Save price</Button>
    </div>
  );
}

function ReasonPanel({ placeholder, required, button, pending, onSave }: { placeholder: string; required: boolean; button: string; pending: boolean; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap gap-2 rounded-2xl bg-muted/50 p-3">
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} className="min-w-52 flex-1" />
      <Button variant="destructive" disabled={pending || (required && !reason.trim())} onClick={() => onSave(reason)}>{button}</Button>
    </div>
  );
}

function PayPanel({ accounts, amount, pending, onSave }: { accounts: PayAccount[]; amount: number; pending: boolean; onSave: (accountId: string, reference: string) => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [reference, setReference] = useState("");
  return (
    <div className="space-y-2 rounded-2xl bg-muted/50 p-3">
      <p className="text-sm font-medium">{formatTZS(amount)} paid into</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} />
        <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference (M-Pesa code, receipt…)" />
        <Button disabled={pending || !accountId} onClick={() => onSave(accountId, reference)}><Receipt />Record payment</Button>
      </div>
    </div>
  );
}

function RoomPanel({ staying, pending, onSave }: { staying: BookingOpt[]; pending: boolean; onSave: (reservationId: string) => void }) {
  const [id, setId] = useState("");
  return (
    <div className="flex flex-wrap gap-2 rounded-2xl bg-muted/50 p-3">
      <NativeSelect value={id} onChange={(e) => setId(e.target.value)} className="min-w-60 flex-1">
        <option value="">Which guest&apos;s room?</option>
        {staying.map((b) => <option key={b.id} value={b.id}>{b.label} · {b.name}</option>)}
      </NativeSelect>
      <Button disabled={pending || !id} onClick={() => onSave(id)}><BedDouble />Add to room</Button>
    </div>
  );
}

/* ─────────────── Admin & manager: services, packages & prices ─────────────── */

export function ServicePrices({ services }: { services: ServiceOpt[] }) {
  return <div className="space-y-3">{services.map((s) => <ServiceEditor key={s.id} s={s} />)}</div>;
}

type Pack = { key: string; id?: string; name: string; description: string; price: string; isActive: boolean };
function ServiceEditor({ s }: { s: ServiceOpt }) {
  const router = useRouter();
  const initial = () => ({
    name: s.name, price: String(s.price), isActive: s.isActive ?? true, isPublic: s.isPublic ?? true,
    packs: s.options.map((o) => ({ key: o.id, id: o.id, name: o.name, description: o.description ?? "", price: String(o.price), isActive: o.isActive ?? true })) as Pack[],
  });
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const setPack = (key: string, patch: Partial<Pack>) => setV((x) => ({ ...x, packs: x.packs.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
  function save() {
    start(async () => {
      const r = await saveTransportServiceAction({
        id: s.id, name: v.name, price: Number(v.price), isActive: v.isActive, isPublic: v.isPublic,
        options: v.packs.map((p) => ({ id: p.id, name: p.name, description: p.description, price: Number(p.price), isActive: p.isActive })),
      });
      if (r.ok) { toast.success(`${v.name}: saved — new requests use these prices.`); router.refresh(); } else toast.error(r.error);
    });
  }
  return (
    <div className="rounded-2xl border border-border/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tripTone(s.type))}><TripIcon type={s.type} className="size-4" /></span>
        <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className="h-9 min-w-40 flex-1 font-medium" aria-label="Service name" />
        {v.packs.length === 0 && <Input type="number" min={0} step={1000} value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} className="h-9 w-28" aria-label="Price (TZS)" />}
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />Offered</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} />On website</label>
      </div>
      {v.packs.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-border/70 pl-3">
          {v.packs.map((p) => (
            <li key={p.key} className={cn("flex flex-wrap items-center gap-2", !p.isActive && "opacity-60")}>
              <Input value={p.name} onChange={(e) => setPack(p.key, { name: e.target.value })} placeholder="Package, e.g. Half day" className="h-8 w-36" aria-label="Package name" />
              <Input value={p.description} onChange={(e) => setPack(p.key, { description: e.target.value })} placeholder="When to use it" className="h-8 min-w-36 flex-1" aria-label="Package description" />
              <Input type="number" min={0} step={1000} value={p.price} onChange={(e) => setPack(p.key, { price: e.target.value })} className="h-8 w-28" aria-label="Package price (TZS)" />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={p.isActive} onChange={(e) => setPack(p.key, { isActive: e.target.checked })} />On</label>
              <button type="button" onClick={() => setV((x) => ({ ...x, packs: x.packs.filter((y) => y.key !== p.key) }))} aria-label="Remove package" className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"><X className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setV((x) => ({ ...x, packs: [...x.packs, { key: `new-${Date.now()}`, name: "", description: "", price: x.packs.length ? x.packs[x.packs.length - 1].price : x.price, isActive: true }] }))}
          className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"><Plus className="size-3.5" />{v.packs.length ? "Add a package" : "Use packages (several prices)"}</button>
        <span className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setV(initial())}>Undo</Button>
          <Button size="sm" disabled={pending} onClick={save}>{pending && <Loader2 className="animate-spin" />}Save</Button>
        </span>
      </div>
    </div>
  );
}

export function VehicleForm() {
  const router = useRouter();
  return (
    <ActionForm action={saveVehicleAction} resetOnSuccess onSuccess={() => router.refresh()} className="space-y-2 border-t pt-3">
      {({ pending, fieldErrors: e }) => (
        <>
          <p className="text-sm font-medium">Add vehicle</p>
          <Input name="name" placeholder="e.g. Toyota Noah" aria-label="Vehicle name" />
          <FieldError message={e?.name} />
          <div className="flex gap-2">
            <Input name="plateNumber" placeholder="Plate" aria-label="Plate number" />
            <Input name="capacity" type="number" min={1} defaultValue={4} className="w-20" aria-label="Seats" />
          </div>
          <FieldError message={e?.plateNumber} />
          <Button type="submit" size="sm" variant="outline" className="w-full" disabled={pending}>Add vehicle</Button>
        </>
      )}
    </ActionForm>
  );
}
