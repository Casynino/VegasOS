"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle, BedDouble, CalendarDays, CheckCircle2, Clock, Loader2, LogIn, Plane, Repeat, StickyNote, UserCheck, UserRound, Wallet, Zap,
} from "lucide-react";
import { ChangeRoomDialog } from "./change-room-dialog";
import type { PayAccount } from "@/lib/pay-account";
import { changeDatesAction, quickCheckInAction } from "@/app/staff/(app)/reservations/actions";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { ROOM_STATUS_META } from "@/lib/room-status";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { cn } from "@/lib/utils";
import { IdPicker, NationalityPicker } from "@/components/staff/id-nationality";
import { Initials } from "@/components/dashboard/kit";
import { DiscountEditor } from "./discount-editor";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RoomStatus } from "@/generated/prisma/enums";

/**
 * A room the guest can take: `sameType` false = another type at the same price (the booked rate is kept). `taken`: the
 * booked room of a booking made to pay later (never held) went to a guest who paid first. `busy`: that room is free on
 * the booked dates but someone is in it for the nights asked now (an early arrival).
 */
type RoomOpt = { id: string; number: string; status: RoomStatus; ready: boolean; type?: string; sameType?: boolean; taken?: boolean; busy?: boolean };

export interface ArrivalCardData {
  id: string;
  reference: string;
  status: string;
  source: string;
  eta: string | null;
  guest: { fullName: string; phone: string | null; email: string | null; idType: string | null; idNumber: string | null; nationality: string | null; stays: number };
  rooms: {
    id: string; roomTypeName: string; arrival: string; departure: string; nights: number; adults: number; children: number;
    ratePerNight: number; discountPerNight: number; current: RoomOpt; options: RoomOpt[];
  }[];
  netAmount: number;
  paidAmount: number;
  balanceAmount: number;
  pickup: string | null;
  specialRequests: string | null;
  internalNotes: string | null;
}


/** Best room to offer: the booked one if it's ready, otherwise the first ready room of the same type. */
function initialChoice(r: ArrivalCardData["rooms"][number]) {
  if (r.current.ready) return r.current.id;
  return r.options.find((o) => o.ready)?.id ?? r.current.id;
}

function Section({ icon, title, children, className }: { icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground [&_svg]:size-3.5">{icon}{title}</h3>
      {children}
    </section>
  );
}

const plusDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nightsBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
const nightsText = (n: number) => `${n} night${n === 1 ? "" : "s"}`;

/**
 * The stay dates on the check-in screen — nothing to save on its own: they go with Check in (or "Save new
 * dates" for a later day). Moving the check-in date moves the whole stay (same nights); "Today" lets an
 * early guest in now.
 */
function CheckInDates({ id, booked, value, onChange, today, canEdit }: {
  id: string; booked: { arrival: string; departure: string }; value: { arrival: string; departure: string };
  onChange: (v: { arrival: string; departure: string }) => void; today: string; canEdit: boolean;
}) {
  const { arrival, departure } = value;
  const nights = nightsBetween(arrival, departure);
  const changed = arrival !== booked.arrival || departure !== booked.departure;
  const late = booked.arrival < today;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`arr-${id}`} className="text-xs text-muted-foreground">Check-in date</Label>
          {/* A late guest's day has passed: only the check-out moves. */}
          <Input id={`arr-${id}`} type="date" value={arrival} min={today} disabled={!canEdit || late}
            onChange={(e) => e.target.value && onChange({ arrival: e.target.value, departure: plusDays(e.target.value, Math.max(1, nights)) })} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`dep-${id}`} className="text-xs text-muted-foreground">Check-out date</Label>
          <Input id={`dep-${id}`} type="date" value={departure} min={plusDays(arrival, 1)} disabled={!canEdit}
            onChange={(e) => e.target.value && e.target.value > arrival && onChange({ arrival, departure: e.target.value })} className="h-10" />
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5">
          {arrival > today && (
            <button type="button" onClick={() => onChange({ arrival: today, departure: plusDays(today, Math.max(1, nights)) })}
              className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.72_0.12_80)] px-3 py-1 text-xs font-semibold text-[oklch(0.2_0.03_60)] transition hover:brightness-105">
              <Zap className="size-3" />Today
            </button>
          )}
          <span className="mx-1 text-xs text-muted-foreground">Stay:</span>
          {[1, 2, 3, 5, 7].map((n) => (
            <button key={n} type="button" onClick={() => onChange({ arrival, departure: plusDays(arrival, n) })}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", nights === n ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
              {nightsText(n)}
            </button>
          ))}
          <button type="button" onClick={() => onChange({ arrival, departure: plusDays(departure, 1) })}
            className="rounded-full border border-dashed border-[oklch(0.72_0.12_80/0.7)] px-3 py-1 text-xs font-semibold text-[oklch(0.55_0.11_76)] transition-colors hover:bg-[oklch(0.72_0.12_80/0.12)] dark:text-gold">
            +1 night
          </button>
        </div>
      )}
      {changed && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-[oklch(0.72_0.12_80/0.1)] px-3 py-2 text-xs">
          <CalendarDays className="size-3.5 text-[oklch(0.55_0.11_76)] dark:text-gold" />
          <span><strong className="font-semibold">{formatBusinessDate(arrival)} → {formatBusinessDate(departure)}</strong> · {nightsText(nights)}</span>
          <span className="text-muted-foreground">(booked {formatBusinessDate(booked.arrival)} · {nightsText(nightsBetween(booked.arrival, booked.departure))}) — the price is worked out again.</span>
          <button type="button" onClick={() => onChange(booked)} className="font-semibold underline-offset-2 hover:underline">Undo</button>
        </p>
      )}
    </div>
  );
}

/** Arrival / departure editor for one booked room. Prices are recalculated by the server. */
export function StayDates({ reservationId, room, today, canEdit }: { reservationId: string; room: { id: string; arrival: string; departure: string }; today: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [arrival, setArrival] = useState(room.arrival);
  const [departure, setDeparture] = useState(room.departure);
  const dirty = arrival !== room.arrival || departure !== room.departure;
  const plus = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const nights = Math.max(0, Math.round((Date.parse(departure) - Date.parse(arrival)) / 86_400_000));

  function save(dates: { arrivalDate: string; departureDate: string }, done: string) {
    start(async () => {
      const res = await changeDatesAction({ reservationId, reservationRoomId: room.id, ...dates });
      if (res.ok) { toast.success(done); router.refresh(); } else toast.error(res.error, { duration: 9000 });
    });
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`arr-${room.id}`} className="text-xs text-muted-foreground">Check-in date</Label>
          <Input id={`arr-${room.id}`} type="date" value={arrival} min={today} disabled={!canEdit || pending} onChange={(e) => setArrival(e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`dep-${room.id}`} className="text-xs text-muted-foreground">Check-out date</Label>
          <Input id={`dep-${room.id}`} type="date" value={departure} min={arrival} disabled={!canEdit || pending} onChange={(e) => setDeparture(e.target.value)} className="h-10" />
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Stay:</span>
          {[1, 2, 3, 5, 7].map((n) => (
            <button key={n} type="button" disabled={pending} onClick={() => setDeparture(plus(arrival, n))}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", nights === n ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
              {n} night{n === 1 ? "" : "s"}
            </button>
          ))}
          <button type="button" disabled={pending} onClick={() => setDeparture(plus(departure, 1))}
            className="rounded-full border border-dashed border-[oklch(0.72_0.12_80/0.7)] px-3 py-1 text-xs font-semibold text-[oklch(0.55_0.11_76)] transition-colors hover:bg-[oklch(0.72_0.12_80/0.12)] dark:text-gold">
            +1 night
          </button>
        </div>
      )}
      {dirty && canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending || departure <= arrival} onClick={() => save({ arrivalDate: arrival, departureDate: departure }, "Dates updated — price recalculated.")}>
            {pending ? <Loader2 className="animate-spin" /> : <CalendarDays />}Save · {nights} night{nights === 1 ? "" : "s"}, out {formatBusinessDate(departure)}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setArrival(room.arrival); setDeparture(room.departure); }}>Undo</Button>
          <span className="text-xs text-muted-foreground">The room must be free for the new dates.</span>
        </div>
      )}
      {room.arrival > today && canEdit && !dirty && (
        <Button size="sm" variant="outline" className="border-[oklch(0.72_0.12_80/0.6)]" disabled={pending}
          onClick={() => save({ arrivalDate: today, departureDate: room.departure }, "Arrival moved to today — the guest can check in now.")}>
          {pending ? <Loader2 className="animate-spin" /> : <Zap />}Check in early · move arrival to today
        </Button>
      )}
    </div>
  );
}

/**
 * The check-in workspace for one booking: stay dates, room (booked one
 * pre-selected, any ready room of the same type can be picked), the guest's
 * details pre-filled and editable, payment, and one CHECK IN button.
 */
export function ArrivalCard({ a, today, canAssign, canOverride, canEditDates = false, canDiscount = false, discountMax = null, payment, checkoutTime = "11:00", methods = [] }: {
  a: ArrivalCardData; today: string; canAssign: boolean; canOverride: boolean; canEditDates?: boolean; canDiscount?: boolean; discountMax?: number | null; payment?: React.ReactNode; checkoutTime?: string;
  /** Payment accounts — a dearer room is paid for in the Change room window. */
  methods?: PayAccount[];
}) {
  const router = useRouter();
  // Change to any free room (any type) — the window shows each room's price and the difference.
  const [changing, setChanging] = useState<string | null>(null);
  const [allRooms, setAllRooms] = useState<Record<string, boolean>>({});
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(a.rooms.map((r) => [r.id, initialChoice(r)])));
  const [g, setG] = useState({
    fullName: a.guest.fullName, phone: a.guest.phone ?? "", email: a.guest.email ?? "",
    nationality: a.guest.nationality ?? "", idType: a.guest.idType ?? "", idNumber: a.guest.idNumber ?? "",
  });
  const [overrideReason, setOverrideReason] = useState("");
  // The stay dates as set here — sent with Check in (or saved for a later day).
  const [dates, setDates] = useState<Record<string, { arrival: string; departure: string }>>(() => Object.fromEntries(a.rooms.map((r) => [r.id, { arrival: r.arrival, departure: r.departure }])));
  const set = (k: keyof typeof g) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setG({ ...g, [k]: e.target.value });

  const selected = a.rooms.map((r) => ({ r, opt: [r.current, ...r.options].find((o) => o.id === choice[r.id]) ?? r.current }));
  const moving = selected.some(({ r, opt }) => opt.id !== r.current.id);
  const notReady = selected.filter(({ opt }) => !opt.ready);
  const blockedByRoom = notReady.length > 0 && (!canOverride || notReady.some(({ opt }) => opt.status !== "DIRTY" && opt.status !== "CLEANING"));
  const firstArrival = a.rooms.reduce((m, r) => (r.arrival < m ? r.arrival : m), a.rooms[0]?.arrival ?? today);
  const upcoming = firstArrival > today;
  const late = firstArrival < today;
  const changedDates = a.rooms.filter((r) => dates[r.id].arrival !== r.arrival || dates[r.id].departure !== r.departure);
  // After any changes here: does the stay still start on a later day?
  const startsLater = a.rooms.some((r) => dates[r.id].arrival > today);
  // A later day with new dates → save them (no check-in). Otherwise the button checks in — a booking for a
  // later day that was not touched moves to today (same nights) as it checks in: one tap for an early guest.
  const reschedule = startsLater && changedDates.length > 0;
  const early = startsLater && !reschedule;
  const checkInDates = () => a.rooms.map((r) => {
    const v = dates[r.id];
    const d = v.arrival > today ? { arrival: today, departure: plusDays(today, Math.max(1, nightsBetween(v.arrival, v.departure))) } : v;
    return { reservationRoomId: r.id, arrivalDate: d.arrival, departureDate: d.departure };
  }).filter((x) => { const r = a.rooms.find((y) => y.id === x.reservationRoomId)!; return x.arrivalDate !== r.arrival || x.departureDate !== r.departure; });
  const earlyOut = early ? checkInDates().reduce((m, x) => (x.departureDate > m ? x.departureDate : m), "") : "";
  const missing = [
    !g.fullName.trim() && "full name",
    !g.idNumber.trim() && "ID number",
    !reschedule && notReady.length > 0 && canOverride && !blockedByRoom && !overrideReason.trim() && "override reason",
  ].filter(Boolean) as string[];

  function submit() {
    start(async () => {
      const moves = checkInDates();
      const res = await quickCheckInAction({
        reservationId: a.id,
        assignments: selected.filter(({ r, opt }) => opt.id !== r.current.id).map(({ r, opt }) => ({ reservationRoomId: r.id, roomId: opt.id })),
        guest: g,
        notReadyOverride: notReady.length ? overrideReason : undefined,
        dates: moves,
      });
      if (res.ok) {
        const out = a.rooms.reduce((m, r) => { const d = moves.find((x) => x.reservationRoomId === r.id)?.departureDate ?? r.departure; return d > m ? d : m; }, "");
        toast.success(`${g.fullName} checked in — room ${selected.map(({ opt }) => opt.number).join(", ")}.`, {
          description: `Checkout: ${formatBusinessDate(out)} at ${checkoutTime}`, duration: 12000,
          action: { label: "Send welcome", onClick: () => router.push(`/staff/reservations/${a.id}?sent=welcome#message`) },
        });
        for (const w of res.data.warnings ?? []) toast.warning(w, { duration: 9000 });
        // Stay with this guest: "Checked in" — order food & drinks for them right here, send the welcome, or next guest.
        router.push(`/staff/check-in?done=${encodeURIComponent(a.id)}#workspace`, { scroll: false });
      } else toast.error(res.error, { duration: 9000 });
    });
  }

  // New dates for a later day (no check-in yet): each changed room, onto the room chosen for it.
  function saveDates() {
    start(async () => {
      for (const r of changedDates) {
        const opt = selected.find((x) => x.r.id === r.id)?.opt;
        const res = await changeDatesAction({ reservationId: a.id, reservationRoomId: r.id, arrivalDate: dates[r.id].arrival, departureDate: dates[r.id].departure, roomId: opt && opt.id !== r.current.id ? opt.id : null });
        if (!res.ok) { toast.error(res.error, { duration: 9000 }); return; }
      }
      toast.success(`Booking moved — ${formatBusinessDate(dates[changedDates[0].id].arrival)}. The price is worked out again.`);
      router.refresh();
    });
  }

  return (
    <article id="workspace" className="scroll-mt-24 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_2px_4px_rgba(15,23,42,0.03),0_12px_32px_-18px_rgba(15,23,42,0.18)]">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-4 sm:px-6">
        <Initials name={a.guest.fullName} className="size-12 text-sm" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-foreground">{a.guest.fullName}</h2>
          <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{a.reference}</span> · booked via {a.source}</p>
          {a.status === "INQUIRY" && <p className="text-xs text-orange-700 dark:text-orange-300">Take a payment, or give any free room.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
          {/* Booked online to pay later (or an enquiry): not paid, no room held — take a payment or give any free room. */}
          {a.status === "INQUIRY" && <span className={cn("rounded-full border px-2.5 py-1", RESERVATION_STATUS_META.INQUIRY.className)}>{RESERVATION_STATUS_META.INQUIRY.label}</span>}
          {late && <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-800 dark:text-amber-300">Late · was due {formatBusinessDate(firstArrival)}</span>}
          {upcoming && <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-sky-700 dark:text-sky-300">Arrives {formatBusinessDate(firstArrival)}</span>}
          {a.guest.stays > 1 && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-1 text-emerald-700 dark:text-emerald-300"><UserCheck className="size-3" />Returning guest</span>}
          {a.eta && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1"><Clock className="size-3" />Around {a.eta}</span>}
        </div>
      </header>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-2 xl:gap-8">
        {/* Stay & room */}
        <Section icon={<BedDouble />} title={a.rooms.length > 1 ? "Stay & rooms" : "Stay & room"}>
          <div className="space-y-3">
            {selected.map(({ r, opt }) => {
              const meta = ROOM_STATUS_META[opt.status];
              return (
                <div key={r.id} className="space-y-3 rounded-2xl bg-muted/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">{r.roomTypeName} <span className="font-normal text-muted-foreground">· {r.nights} night{r.nights === 1 ? "" : "s"} · {r.adults + r.children} guest{r.adults + r.children === 1 ? "" : "s"}</span></p>
                    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", opt.ready ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : meta.className)}>
                      {opt.ready ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}Room {opt.number} · {opt.ready ? "Ready" : meta.label}
                    </span>
                  </div>

                  <CheckInDates id={r.id} booked={r} value={dates[r.id]} today={today} canEdit={canEditDates}
                    onChange={(v) => setDates((x) => ({ ...x, [r.id]: v }))} />

                  {(() => {
                    // Every room they can take, as tap-to-pick suggestions: the booked one, ready rooms of the same type,
                    // then ready rooms of other types at the same price; rooms being cleaned only for those who may override.
                    const usable = (o: RoomOpt) => !o.taken && !o.busy && (o.ready || (canOverride && (o.status === "DIRTY" || o.status === "CLEANING")));
                    const list = [r.current, ...r.options.filter((o) => o.id !== r.current.id && usable(o))]
                      .sort((x, y) => Number(y.id === r.current.id) - Number(x.id === r.current.id) || Number(y.ready) - Number(x.ready) || Number(!!y.sameType) - Number(!!x.sameType));
                    const SHOW = 8;
                    const shown = allRooms[r.id] ? list : list.slice(0, SHOW);
                    const readyCount = list.filter((o) => o.ready).length;
                    return (
                      <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <Label id={`room-${r.id}`} className="text-xs text-muted-foreground">Room for this guest</Label>
                          <span className="text-[11px] text-muted-foreground">{readyCount} ready at this price</span>
                        </div>
                        <div role="radiogroup" aria-labelledby={`room-${r.id}`} className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                          {shown.map((o) => {
                            const on = choice[r.id] === o.id;
                            const can = canAssign && usable(o);
                            return (
                              <button key={o.id} type="button" role="radio" aria-checked={on} disabled={!can && !on} onClick={() => setChoice({ ...choice, [r.id]: o.id })}
                                className={cn("min-w-0 rounded-xl border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
                                  on ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.72_0.12_80/0.14)] ring-1 ring-[oklch(0.75_0.12_80/0.6)]" : "border-border/70 bg-background hover:bg-muted")}>
                                <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                                  <span className={cn("size-1.5 shrink-0 rounded-full", o.ready ? "bg-emerald-500" : "bg-amber-500")} />{o.number}
                                </span>
                                <span className="block truncate text-[10.5px] text-muted-foreground">
                                  {o.id === r.current.id ? "Booked · " : ""}{o.sameType === false ? o.type : o.ready ? "Ready" : ROOM_STATUS_META[o.status].label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {list.length > SHOW && (
                          <button type="button" onClick={() => setAllRooms((x) => ({ ...x, [r.id]: !x[r.id] }))} className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                            {allRooms[r.id] ? "Show fewer" : `Show all ${list.length} rooms`}
                          </button>
                        )}
                        {opt.sameType === false && <p className="text-xs text-muted-foreground">Room {opt.number} is a {opt.type} at the same price — the booked rate stays.</p>}
                    {!reschedule && !r.current.ready && opt.id !== r.current.id && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {r.current.taken ? `Room ${r.current.number} was not held (not paid) and a guest who paid first has it, so room ${opt.number} is suggested.`
                          : r.current.busy ? `Booked room ${r.current.number} is not free for these nights, so room ${opt.number} is suggested.`
                          : `Booked room ${r.current.number} is ${ROOM_STATUS_META[r.current.status].label.toLowerCase()}, so room ${opt.number} is suggested.`}
                      </p>
                    )}
                    {!reschedule && !opt.ready && r.options.every((o) => !o.ready) && (
                      <p className="text-xs text-destructive">No {r.roomTypeName} room is ready yet — pick another room type below (you see its price), or ask housekeeping to finish a room.</p>
                    )}
                    {canAssign && (
                      <Button type="button" variant={!opt.ready && r.options.every((o) => !o.ready) ? "default" : "outline"} size="sm" className="w-full" onClick={() => setChanging(r.id)}>
                        <Repeat />Another room — any type, see the price
                      </Button>
                    )}
                      </div>
                    );
                  })()}
                  <DiscountEditor reservationId={a.id} canEdit={canDiscount} max={discountMax}
                    room={{ id: r.id, number: opt.number, ratePerNight: r.ratePerNight, discountPerNight: r.discountPerNight, nights: r.nights }} />
                </div>
              );
            })}
          </div>
          {(a.pickup || a.specialRequests || a.internalNotes) && (
            <ul className="mt-3 space-y-1.5 text-xs">
              {a.pickup && <li className="flex items-start gap-2 text-sky-700 dark:text-sky-300"><Plane className="mt-0.5 size-3.5 shrink-0" />{a.pickup}</li>}
              {a.specialRequests && <li className="flex items-start gap-2 text-amber-800 dark:text-amber-300"><StickyNote className="mt-0.5 size-3.5 shrink-0" />Guest asked: {a.specialRequests}</li>}
              {a.internalNotes && <li className="flex items-start gap-2 text-muted-foreground"><StickyNote className="mt-0.5 size-3.5 shrink-0" />Staff note: {a.internalNotes}</li>}
            </ul>
          )}
        </Section>

        {/* Guest details */}
        <Section icon={<UserRound />} title="Guest details">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`name-${a.id}`} className="text-xs">Full name *</Label>
              <Input id={`name-${a.id}`} value={g.fullName} onChange={set("fullName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`phone-${a.id}`} className="text-xs">Phone</Label>
              <Input id={`phone-${a.id}`} type="tel" value={g.phone} onChange={set("phone")} placeholder="0712 345 678" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`email-${a.id}`} className="text-xs">Email</Label>
              <Input id={`email-${a.id}`} type="email" value={g.email} onChange={set("email")} placeholder="Optional" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`idno-${a.id}`} className="text-xs">ID *</Label>
              <IdPicker size="sm" numberId={`idno-${a.id}`} type={g.idType} number={g.idNumber} invalid={!g.idNumber.trim()}
                onType={(v) => setG((x) => ({ ...x, idType: v }))} onNumber={(v) => setG((x) => ({ ...x, idNumber: v }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Nationality</Label>
              <NationalityPicker size="sm" value={g.nationality} onChange={(v) => setG((x) => ({ ...x, nationality: v }))} />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Changes are saved to the guest&apos;s record when you check in.</p>
        </Section>
      </div>

      {changing && (
        <ChangeRoomDialog reservationId={a.id} reservationRoomId={changing} guest={a.guest.fullName} methods={methods} inHouse={false} onClose={() => setChanging(null)} />
      )}

      {/* Payment */}
      <Section icon={<Wallet />} title="Payment" className="border-t border-border/70 px-4 py-5 sm:px-6">
        <div className="grid gap-4 xl:grid-cols-2 xl:gap-8">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Total", formatTZS(a.netAmount), "text-foreground"],
              ["Paid", formatTZS(a.paidAmount), "text-emerald-600 dark:text-emerald-400"],
              ["Balance", a.balanceAmount > 0 ? formatTZS(a.balanceAmount) : "Paid", a.balanceAmount > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"],
            ].map(([k, v, c]) => (
              <div key={k} className="rounded-2xl bg-muted/60 px-2 py-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className={cn("mt-1 text-sm font-semibold tabular-nums sm:text-base", c)}>{v}</dd>
              </div>
            ))}
          </dl>
          {payment && <div className="[&>form]:mt-0 [&>form]:border-t-0 [&>form]:pt-0">{payment}</div>}
        </div>
      </Section>

      {/* Actions */}
      <footer className="flex flex-col gap-3 border-t border-border/70 bg-muted/30 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
        <p className={cn("flex-1 text-xs", (!reschedule && (missing.length || blockedByRoom)) || (startsLater && !canEditDates) ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {startsLater && !canEditDates ? `Booked for ${formatBusinessDate(firstArrival)} — ask a manager to move it to today.`
            : reschedule ? `New dates: ${formatBusinessDate(dates[changedDates[0].id].arrival)}. Save them — the guest checks in on that day (or tap Today to check in now).`
            : blockedByRoom ? "The chosen room isn't ready. Pick a ready room, or ask housekeeping."
            : missing.length ? `Add the ${missing.join(" and ")} to check in.`
            : early ? `Booked for ${formatBusinessDate(firstArrival)} — checking in now moves the stay to today, out ${formatBusinessDate(earlyOut)}. The price is worked out again.`
            : changedDates.length ? "The new dates are saved as you check in — the price is worked out again."
            : "Everything is ready."}
        </p>
        {notReady.length > 0 && canOverride && !blockedByRoom && !reschedule && !(startsLater && !canEditDates) && (
          <Input aria-label="Override reason" className="h-10 border-amber-500/60 sm:w-64" placeholder={`Why use a ${notReady[0].opt.status.toLowerCase()} room? *`} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
        )}
        <div className="flex items-center gap-2">
          <Link href={`/staff/reservations/${a.id}`} className={cn(buttonVariants({ variant: "ghost" }), "h-11")}>Open booking</Link>
          {reschedule ? (
            <Button className="h-11 flex-1 px-6 text-base font-semibold sm:flex-none" disabled={pending || !canEditDates} onClick={saveDates}>
              {pending ? <Loader2 className="animate-spin" /> : <CalendarDays />}Save new dates
            </Button>
          ) : (
            <Button className="h-11 flex-1 px-6 text-base font-semibold sm:flex-none" disabled={pending || blockedByRoom || missing.length > 0 || (startsLater && !canEditDates)} onClick={submit}>
              {pending ? <Loader2 className="animate-spin" /> : <LogIn />}
              {early ? (moving ? "Change room & check in today" : "Check in today") : moving ? "Change room & check in" : "Check in"}
            </Button>
          )}
        </div>
      </footer>
    </article>
  );
}

export function DepartureButton({ id, className }: { id: string; className?: string }) {
  return <Link href={`/staff/check-out?id=${id}#workspace`} className={cn(buttonVariants({ size: "sm" }), className)}>Check out</Link>;
}
