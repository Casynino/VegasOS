"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, CheckCircle2, DoorOpen, Loader2, Minus, Plus, Presentation, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { validPhone } from "@/lib/guest-messages";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountSelect } from "@/components/staff/finance/account-select";
import type { PayAccount } from "@/lib/pay-account";
import { checkAvailabilityAction, createReservationAction, type AvailabilityResult } from "@/app/staff/(app)/reservations/actions";

type Mode = "walkIn" | "reserve" | "meeting";
const plusDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const SOURCES = [["PHONE", "Phone"], ["WHATSAPP", "WhatsApp"], ["DIRECT", "At the desk"], ["CORPORATE", "Company"]] as const;

/**
 * Book THIS room right inside its card — no other page: a walk-in checked in now,
 * a reservation for later dates, or (meeting room) a meeting by start–end. The
 * room and price are checked live; saving uses the same booking engine as the
 * full booking form (availability, price and payment all worked out on the server).
 */
export function QuickBook({ room, mode, today, from, methods, canPay, onDone }: {
  room: { id: string; number: string; typeId: string; typeName: string };
  mode: Mode; today: string; from?: string | null; methods: PayAccount[]; canPay: boolean; onDone: () => void;
}) {
  const router = useRouter();
  const [nights, setNights] = useState(1);
  const [dates, setDates] = useState(() => ({ arrival: from && from > today ? from : today, departure: plusDays(from && from > today ? from : today, 1) }));
  const [meet, setMeet] = useState({ date: today, start: "09:00", end: "13:00" });
  const [guest, setGuest] = useState({ fullName: "", phone: "", idNumber: "" });
  const [company, setCompany] = useState("");
  const [needs, setNeeds] = useState("");
  const [adults, setAdults] = useState(mode === "meeting" ? 6 : 1);
  const [children, setChildren] = useState(0);
  const [source, setSource] = useState<string>(mode === "walkIn" ? "WALK_IN" : "PHONE");
  const [paid, setPaid] = useState(mode === "walkIn" && canPay && methods.length > 0);
  const [account, setAccount] = useState(methods[0]?.id ?? "");
  const [ref, setRef] = useState("");
  const [avail, setAvail] = useState<AvailabilityResult | null>(null);
  const [availError, setAvailError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [saving, startSave] = useTransition();

  const stay = useMemo(() => (mode === "walkIn" ? { kind: "walkIn" as const, nights }
    : mode === "meeting" ? { kind: "meeting" as const, date: meet.date, startTime: meet.start, endTime: meet.end }
      : { kind: "overnight" as const, arrivalDate: dates.arrival, departureDate: dates.departure }), [mode, nights, meet, dates]);

  useEffect(() => {
    const h = setTimeout(() => startCheck(async () => {
      const res = await checkAvailabilityAction({ stay, sourceCode: mode === "walkIn" ? "WALK_IN" : "PHONE", checkInNow: mode === "walkIn" });
      if (res.ok) { setAvail(res.data); setAvailError(null); } else { setAvail(null); setAvailError(res.error); }
    }), 250);
    return () => clearTimeout(h);
  }, [stay, mode]);

  const type = avail?.types.find((t) => t.id === room.typeId);
  const free = type?.rooms.find((r) => r.id === room.id);
  const busy = type?.busy.find((r) => r.id === room.id);
  const total = free ? free.grossTotal != null ? free.grossTotal - (free.promoTotal ?? 0) : type!.totalNet : 0;
  const maxAdults = type?.maxAdults ?? 2;

  function save() {
    if (!free) return toast.error(`Room ${room.number} is not free for that time.`);
    if (guest.fullName.trim().length < 2) return toast.error(mode === "meeting" ? "Enter who is booking." : "Enter the guest's name.");
    if (!validPhone(guest.phone)) return toast.error("Enter the phone number — the booking details are sent to it.");
    startSave(async () => {
      const res = await createReservationAction({
        sourceCode: mode === "walkIn" ? "WALK_IN" : source,
        status: "RESERVED",
        checkInNow: mode === "walkIn",
        stay,
        guest: { fullName: guest.fullName.trim(), phone: guest.phone.trim(), idNumber: guest.idNumber.trim() || undefined, idType: guest.idNumber.trim() ? "NATIONAL_ID" : undefined },
        rooms: [{ roomTypeId: room.typeId, roomId: room.id, adults, children: mode === "meeting" ? 0 : children }],
        companyName: mode === "meeting" ? company.trim() || undefined : undefined,
        specialRequests: needs.trim() || undefined,
        payment: paid && canPay && account && total > 0 ? { amount: total, accountId: account, reference: ref.trim() || undefined } : null,
      });
      if (res.ok) {
        toast.success(mode === "walkIn" ? `Checked in to room ${room.number} — ${res.data.reference}` : mode === "meeting" ? `Meeting booked — ${res.data.reference}` : `Room ${room.number} reserved — ${res.data.reference}`, {
          action: { label: mode === "meeting" ? "Open" : "Send on WhatsApp", onClick: () => router.push(`/staff/reservations/${res.data.id}${mode === "meeting" ? "" : mode === "walkIn" ? "?sent=welcome" : "?sent=new"}`) },
        });
        onDone();
        router.refresh();
      } else toast.error(res.error, { duration: 9000 });
    });
  }

  const Icon = mode === "walkIn" ? DoorOpen : mode === "meeting" ? Presentation : CalendarPlus;
  const title = mode === "walkIn" ? `Walk-in — check in to room ${room.number} now` : mode === "meeting" ? "Book a meeting" : `Reserve room ${room.number}`;
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold"><Icon className="size-4" />{title}</p>

      {/* When */}
      {mode === "walkIn" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Nights</span>
          <Step value={nights} min={1} max={30} onChange={setNights} label="nights" />
          {[1, 2, 3, 7].map((n) => <button key={n} type="button" onClick={() => setNights(n)} className={chip(nights === n)}>{n}</button>)}
        </div>
      )}
      {mode === "reserve" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-[11px] text-muted-foreground">Check-in</span>
            <Input type="date" min={today} value={dates.arrival} onChange={(e) => e.target.value && setDates((d) => ({ arrival: e.target.value, departure: d.departure > e.target.value ? d.departure : plusDays(e.target.value, 1) }))} className="h-9" /></label>
          <label className="space-y-1"><span className="text-[11px] text-muted-foreground">Check-out</span>
            <Input type="date" min={plusDays(dates.arrival, 1)} value={dates.departure} onChange={(e) => e.target.value && setDates((d) => ({ ...d, departure: e.target.value }))} className="h-9" /></label>
        </div>
      )}
      {mode === "meeting" && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1"><span className="text-[11px] text-muted-foreground">Date</span><Input type="date" min={today} value={meet.date} onChange={(e) => e.target.value && setMeet({ ...meet, date: e.target.value })} className="h-9" /></label>
            <label className="space-y-1"><span className="text-[11px] text-muted-foreground">Starts</span><Input type="time" step={900} value={meet.start} onChange={(e) => setMeet({ ...meet, start: e.target.value })} className="h-9" /></label>
            <label className="space-y-1"><span className="text-[11px] text-muted-foreground">Ends</span><Input type="time" step={900} value={meet.end} onChange={(e) => setMeet({ ...meet, end: e.target.value })} className="h-9" /></label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([["Morning", "08:00", "12:00"], ["Afternoon", "13:00", "17:00"], ["Half day", "09:00", "13:00"], ["Full day", "08:00", "17:00"]] as const).map(([l, a, b]) => (
              <button key={l} type="button" onClick={() => setMeet({ ...meet, start: a, end: b })} className={chip(meet.start === a && meet.end === b)}>{l} <span className="opacity-60">{a}–{b}</span></button>
            ))}
          </div>
        </div>
      )}

      {/* Free? price */}
      <div className={cn("flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs", checking || (!avail && !availError) ? "bg-muted" : free ? "bg-emerald-500/10" : "bg-rose-500/10")}>
        {checking || (!avail && !availError) ? <><Loader2 className="size-3.5 animate-spin" />Checking room {room.number}…</>
          : availError ? <><XCircle className="size-3.5 text-rose-600" />{availError}</>
            : free ? <><CheckCircle2 className="size-3.5 text-emerald-600" /><strong>Room {room.number} is free</strong><span className="ml-auto font-semibold tabular-nums">{formatTZS(total)}</span>
              <span className="basis-full text-muted-foreground">{mode === "meeting" ? "per booking" : mode === "walkIn" ? `${nights} night${nights === 1 ? "" : "s"}` : `${formatBusinessDate(dates.arrival)} → ${formatBusinessDate(dates.departure)} · ${avail!.stay.nights} night${avail!.stay.nights === 1 ? "" : "s"}`}{free.status !== "AVAILABLE" && free.status !== "READY" ? " · cleaned before the guest arrives" : ""}</span></>
              : <><XCircle className="size-3.5 text-rose-600" /><span>Room {room.number} is {busy?.reason === "OUT_OF_ORDER" ? "under maintenance" : busy?.reason === "NOT_CLEAN" ? "not clean yet — mark it clean first" : busy?.time ? `booked ${busy.time}${busy.guest ? ` (${busy.guest})` : ""}` : `occupied${busy?.freeFrom ? ` — free again ${formatBusinessDate(busy.freeFrom)}` : ""}`}.</span></>}
        {mode === "meeting" && type?.schedule && type.schedule.length > 0 && (
          <span className="basis-full text-muted-foreground">Booked that day: {type.schedule.map((b) => `${b.time} ${b.who}`).join(" · ")}</span>
        )}
      </div>

      {/* Who */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={guest.fullName} onChange={(e) => setGuest({ ...guest, fullName: e.target.value })} placeholder={mode === "meeting" ? "Person booking *" : "Guest's full name *"} aria-label="Name" className="h-10" />
        <Input value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} placeholder="Phone (WhatsApp) *" inputMode="tel" aria-label="Phone" required className="h-10" />
        {mode === "meeting"
          ? <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company (optional)" aria-label="Company" className="h-10" />
          : <Input value={guest.idNumber} onChange={(e) => setGuest({ ...guest, idNumber: e.target.value })} placeholder="ID / passport no. (optional)" aria-label="ID number" className="h-10" />}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{mode === "meeting" ? "People" : "Adults"}</span><Step value={adults} min={1} max={maxAdults} onChange={setAdults} label={mode === "meeting" ? "people" : "adults"} />
          {mode !== "meeting" && (type?.maxChildren ?? 0) > 0 && <><span className="text-xs text-muted-foreground">Kids</span><Step value={children} min={0} max={type?.maxChildren ?? 0} onChange={setChildren} label="kids" /></>}
        </div>
      </div>
      {mode === "meeting" && <Input value={needs} onChange={(e) => setNeeds(e.target.value)} placeholder="Special requirements (projector, seating…)" aria-label="Requirements" className="h-10" />}
      {mode === "reserve" && (
        <div className="flex flex-wrap gap-1.5">
          <span className="self-center text-xs text-muted-foreground">Booked by</span>
          {SOURCES.map(([code, label]) => <button key={code} type="button" onClick={() => setSource(code)} className={chip(source === code)}>{label}</button>)}
        </div>
      )}

      {/* Money */}
      {canPay && methods.length > 0 && total > 0 && (
        <div className="space-y-2 rounded-xl border border-border/70 bg-card p-3">
          <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />Paid now — {formatTZS(total)}</label>
          {paid && (
            <div className="grid gap-2 sm:grid-cols-2">
              <AccountSelect accounts={methods} value={account} onChange={setAccount} />
              <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference (M-Pesa code…)" aria-label="Reference" className="h-9" />
            </div>
          )}
          {!paid && mode !== "walkIn" && <p className="text-[11px] text-muted-foreground">Not paid: the room is held as a pending booking until it is paid.</p>}
        </div>
      )}

      <Button className="h-11 w-full" disabled={saving || !free} onClick={save}>
        {saving ? <Loader2 className="animate-spin" /> : <Icon />}
        {mode === "walkIn" ? `Check in now${total ? ` · ${formatTZS(total)}` : ""}` : mode === "meeting" ? "Book the meeting" : "Reserve the room"}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        Need more (several rooms, discount, company invoice, extras)? <Link href={`/staff/reservations/new?${new URLSearchParams({ room: room.id, ...(mode === "walkIn" ? { mode: "walkin" } : mode === "meeting" ? { mode: "meeting" } : { from: dates.arrival }) })}`} className="underline underline-offset-2">Full booking form</Link>
      </p>
    </div>
  );
}

const chip = (on: boolean) => cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted");

function Step({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex h-8 items-center rounded-lg border border-border bg-card">
      <button type="button" className="px-2 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label}`}><Minus className="size-3.5" /></button>
      <span className="w-6 text-center text-sm font-semibold tabular-nums">{value}</span>
      <button type="button" className="px-2 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}><Plus className="size-3.5" /></button>
    </div>
  );
}
