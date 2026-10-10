"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus, Check, CheckCircle2, DoorOpen, Loader2, Minus, Plus, Presentation, Smartphone, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { validPhone } from "@/lib/guest-messages";
import { formatTZS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PayAccount } from "@/lib/pay-account";
import { NetworkMarks } from "@/components/payments/networks";
import { SendToPhone, useMobilePayAvailable } from "@/components/staff/mobile-pay";
import { KnownCustomerNote, useKnownCustomer } from "@/components/staff/known-customer";
import { checkAvailabilityAction, createReservationAction, type AvailabilityResult } from "@/app/staff/(app)/reservations/actions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

type Mode = "walkIn" | "reserve" | "meeting";
const plusDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** "Mobile money" among the ways to pay: a payment request to the guest's phone (nTZS), recorded by itself when paid. */
const PROMPT = "__ntzs_prompt__";
const SOURCES = [["PHONE", msg("Phone")], ["WHATSAPP", "WhatsApp"], ["DIRECT", msg("At the desk")], ["CORPORATE", msg("Company")]] as const;
/** Quick meeting times (start, end). */
const MEETING_TIMES = [[msg("Morning"), "08:00", "12:00"], [msg("Afternoon"), "13:00", "17:00"], [msg("Half day"), "09:00", "13:00"], [msg("Full day"), "08:00", "17:00"]] as const;

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
  const t = useT();
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
  // How it is paid now: a mobile money request (the main way), an account for money taken by hand, or "" = later.
  const mobileOk = useMobilePayAvailable() && canPay;
  const [payWay, setPayWay] = useState(mode === "walkIn" && canPay ? methods[0]?.id ?? "" : "");
  const picked = useRef(false);
  useEffect(() => { if (mobileOk && mode === "walkIn" && !picked.current) setPayWay(PROMPT); }, [mobileOk, mode]);
  const pick = (way: string) => { picked.current = true; setPayWay(way); };
  const [promptPhone, setPromptPhone] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  // Saved with a mobile money request: followed right here until the guest pays.
  const [sent, setSent] = useState<{ reservationId: string; reference: string; prompt: { id: string; amount: number; phone: string } | null; error: string | null } | null>(null);

  // The phone is the customer's key: a number already on file brings back who they are (their name fills in) — no
  // retyping, no second profile. "Someone else" keeps the typed details as a new customer.
  const [someoneElse, setSomeoneElse] = useState(false);
  const lookup = useKnownCustomer(someoneElse ? "" : guest.phone, (c) => setGuest((g) => ({ ...g, fullName: g.fullName.trim() ? g.fullName : c.name })));
  const known = someoneElse ? null : lookup.customer;
  const phoneDigits = guest.phone.replace(/\D/g, "");
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

  const type = avail?.types.find((x) => x.id === room.typeId);
  const free = type?.rooms.find((r) => r.id === room.id);
  const busy = type?.busy.find((r) => r.id === room.id);
  const total = free ? free.grossTotal != null ? free.grossTotal - (free.promoTotal ?? 0) : type!.totalNet : 0;
  const maxAdults = type?.maxAdults ?? 2;

  function save() {
    if (!free) return toast.error(t("Room {room} is not free for that time.", { room: room.number }));
    if (guest.fullName.trim().length < 2) return toast.error(mode === "meeting" ? t("Enter who is booking.") : t("Enter the guest's name."));
    if (!validPhone(guest.phone)) return toast.error(t("Enter the phone number — the booking details are sent to it."));
    const viaPhone = payWay === PROMPT && total > 0;
    const promptNumber = (promptPhone ?? guest.phone).trim();
    if (viaPhone && !validPhone(promptNumber)) return toast.error(t("Enter the guest's phone number to send the payment request."));
    const done = mode === "walkIn" ? t("Checked in to room {room}", { room: room.number }) : mode === "meeting" ? t("Meeting booked") : t("Room {room} reserved", { room: room.number });
    startSave(async () => {
      const res = await createReservationAction({
        sourceCode: mode === "walkIn" ? "WALK_IN" : source,
        status: "RESERVED",
        checkInNow: mode === "walkIn",
        stay,
        guest: { id: known?.id, createNew: someoneElse || undefined, fullName: guest.fullName.trim(), phone: guest.phone.trim(), idNumber: guest.idNumber.trim() || undefined, idType: guest.idNumber.trim() ? "NATIONAL_ID" : undefined },
        rooms: [{ roomTypeId: room.typeId, roomId: room.id, adults, children: mode === "meeting" ? 0 : children }],
        companyName: mode === "meeting" ? company.trim() || undefined : undefined,
        specialRequests: needs.trim() || undefined,
        payment: canPay && payWay && !viaPhone && total > 0 ? { amount: total, accountId: payWay, reference: ref.trim() || undefined } : null,
        prompt: viaPhone ? { amount: total, phone: promptNumber } : null,
      });
      if (res.ok && viaPhone) {
        // Stay here and follow the payment until the guest pays (it is recorded by itself, even if this is closed).
        toast.success(`${done} — ${res.data.reference}${res.data.prompt ? ` · ${t("payment request sent")}` : ""}`);
        setSent({ reservationId: res.data.id, reference: res.data.reference, prompt: res.data.prompt ? { id: res.data.prompt.id, amount: total, phone: promptNumber } : null, error: res.data.promptError });
        return;
      }
      if (res.ok) {
        toast.success(`${done} — ${res.data.reference}`, {
          action: { label: mode === "meeting" ? t("Open") : t("Send on WhatsApp"), onClick: () => router.push(`/staff/reservations/${res.data.id}${mode === "meeting" ? "" : mode === "walkIn" ? "?sent=welcome" : "?sent=new"}`) },
        });
        onDone();
        router.refresh();
      } else toast.error(res.error, { duration: 9000 });
    });
  }

  const Icon = mode === "walkIn" ? DoorOpen : mode === "meeting" ? Presentation : CalendarPlus;
  const title = mode === "walkIn" ? t("Walk-in — check in to room {room} now", { room: room.number }) : mode === "meeting" ? t("Book a meeting") : t("Reserve room {room}", { room: room.number });
  const close = () => { onDone(); router.refresh(); };

  if (sent) {
    return (
      <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
          {mode === "walkIn" ? t("{name} is checked in to room {room}", { name: guest.fullName.trim().split(" ")[0], room: room.number }) : mode === "meeting" ? t("Meeting booked") : t("Room {room} reserved", { room: room.number })} · {sent.reference}</p>
        {sent.error && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{t("The payment request was not sent: {error} Send it again below.", { error: sent.error })}</p>}
        <SendToPhone target={{ kind: "stay", reservationId: sent.reservationId }} amount={total} editableAmount phone={promptPhone ?? guest.phone} who={guest.fullName}
          resume={sent.prompt} onPaid={close} primary />
        <Button variant="outline" className="h-10 w-full" onClick={close}>{t("Done")}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold"><Icon className="size-4" />{title}</p>

      {/* When */}
      {mode === "walkIn" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("Nights")}</span>
          <Step value={nights} min={1} max={30} onChange={setNights} label={t("nights")} />
          {[1, 2, 3, 7].map((n) => <button key={n} type="button" onClick={() => setNights(n)} className={chip(nights === n)}>{n}</button>)}
        </div>
      )}
      {mode === "reserve" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="text-[11px] text-muted-foreground">{t("Check-in")}</span>
            <Input type="date" min={today} value={dates.arrival} onChange={(e) => e.target.value && setDates((d) => ({ arrival: e.target.value, departure: d.departure > e.target.value ? d.departure : plusDays(e.target.value, 1) }))} className="h-9" /></label>
          <label className="space-y-1"><span className="text-[11px] text-muted-foreground">{t("Check-out")}</span>
            <Input type="date" min={plusDays(dates.arrival, 1)} value={dates.departure} onChange={(e) => e.target.value && setDates((d) => ({ ...d, departure: e.target.value }))} className="h-9" /></label>
        </div>
      )}
      {mode === "meeting" && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1"><span className="text-[11px] text-muted-foreground">{t("Date")}</span><Input type="date" min={today} value={meet.date} onChange={(e) => e.target.value && setMeet({ ...meet, date: e.target.value })} className="h-9" /></label>
            <label className="space-y-1"><span className="text-[11px] text-muted-foreground">{t("Starts")}</span><Input type="time" step={900} value={meet.start} onChange={(e) => setMeet({ ...meet, start: e.target.value })} className="h-9" /></label>
            <label className="space-y-1"><span className="text-[11px] text-muted-foreground">{t("Ends")}</span><Input type="time" step={900} value={meet.end} onChange={(e) => setMeet({ ...meet, end: e.target.value })} className="h-9" /></label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MEETING_TIMES.map(([l, a, b]) => (
              <button key={l} type="button" onClick={() => setMeet({ ...meet, start: a, end: b })} className={chip(meet.start === a && meet.end === b)}>{t(l)} <span className="opacity-60">{a}–{b}</span></button>
            ))}
          </div>
        </div>
      )}

      {/* Free? price */}
      <div className={cn("flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs", checking || (!avail && !availError) ? "bg-muted" : free ? "bg-emerald-500/10" : "bg-rose-500/10")}>
        {checking || (!avail && !availError) ? <><Loader2 className="size-3.5 animate-spin" />{t("Checking room {room}…", { room: room.number })}</>
          : availError ? <><XCircle className="size-3.5 text-rose-600" />{availError}</>
            : free ? <><CheckCircle2 className="size-3.5 text-emerald-600" /><strong>{t("Room {room} is free", { room: room.number })}</strong><span className="ml-auto font-semibold tabular-nums">{formatTZS(total)}</span>
              <span className="basis-full text-muted-foreground">{mode === "meeting" ? t("per booking") : mode === "walkIn" ? t.plural(nights, "{n} night", "{n} nights") : `${t.date(dates.arrival)} → ${t.date(dates.departure)} · ${t.plural(avail!.stay.nights, "{n} night", "{n} nights")}`}{free.status !== "AVAILABLE" && free.status !== "READY" ? ` · ${t("cleaned before the guest arrives")}` : ""}</span></>
              : <><XCircle className="size-3.5 text-rose-600" /><span>{busy?.reason === "OUT_OF_ORDER" ? t("Room {room} is under maintenance.", { room: room.number })
                : busy?.reason === "NOT_CLEAN" ? t("Room {room} is not clean yet — mark it clean first.", { room: room.number })
                : busy?.time ? (busy.guest ? t("Room {room} is booked {time} ({guest}).", { room: room.number, time: busy.time, guest: busy.guest }) : t("Room {room} is booked {time}.", { room: room.number, time: busy.time }))
                : busy?.freeFrom ? t("Room {room} is occupied — free again {date}.", { room: room.number, date: t.date(busy.freeFrom) }) : t("Room {room} is occupied.", { room: room.number })}</span></>}
        {mode === "meeting" && type?.schedule && type.schedule.length > 0 && (
          <span className="basis-full text-muted-foreground">{t("Booked that day: {list}", { list: type.schedule.map((b) => `${b.time} ${b.who}`).join(" · ") })}</span>
        )}
      </div>

      {/* Who — the phone first: a number already on file brings the customer back */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input value={guest.phone} onChange={(e) => { setGuest({ ...guest, phone: e.target.value }); setSomeoneElse(false); }} placeholder={t("Phone (WhatsApp) *")} type="tel" inputMode="tel" aria-label={t("Phone")} required className="h-10" />
        <Input value={guest.fullName} onChange={(e) => setGuest({ ...guest, fullName: e.target.value })} placeholder={mode === "meeting" ? t("Person booking *") : t("Guest's full name *")} aria-label={t("Name")} className="h-10" />
        {!someoneElse && (
          <KnownCustomerNote phone={guest.phone} lookup={lookup} className="min-w-0 sm:col-span-2"
            action={known && <button type="button" onClick={() => setSomeoneElse(true)} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-border hover:bg-muted hover:text-foreground">{t("Someone else")}</button>} />
        )}
        {someoneElse && phoneDigits.length >= 9 && (
          <p className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-1.5 text-[11px] text-muted-foreground sm:col-span-2">
            <span>{t("Saved as a new customer with this number.")}</span>
            <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => setSomeoneElse(false)}>{t("Undo")}</button>
          </p>
        )}
        {mode === "meeting"
          ? <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t("Company (optional)")} aria-label={t("Company")} className="h-10" />
          : <Input value={guest.idNumber} onChange={(e) => setGuest({ ...guest, idNumber: e.target.value })} placeholder={t("ID / passport no. (optional)")} aria-label={t("ID number")} className="h-10" />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2">
          <span className="inline-flex items-center gap-2"><span className="text-xs text-muted-foreground">{mode === "meeting" ? t("People") : t("Adults")}</span><Step value={adults} min={1} max={maxAdults} onChange={setAdults} label={mode === "meeting" ? t("people") : t("adults")} /></span>
          {mode !== "meeting" && (type?.maxChildren ?? 0) > 0 && <span className="inline-flex items-center gap-2"><span className="text-xs text-muted-foreground">{t("Kids")}</span><Step value={children} min={0} max={type?.maxChildren ?? 0} onChange={setChildren} label={t("kids")} /></span>}
        </div>
      </div>
      {mode === "meeting" && <Input value={needs} onChange={(e) => setNeeds(e.target.value)} placeholder={t("Special requirements (projector, seating…)")} aria-label={t("Requirements")} className="h-10" />}
      {mode === "reserve" && (
        <div className="flex flex-wrap gap-1.5">
          <span className="self-center text-xs text-muted-foreground">{t.ctx("source", "Booked by")}</span>
          {SOURCES.map(([code, label]) => <button key={code} type="button" onClick={() => setSource(code)} className={chip(source === code)}>{t(label)}</button>)}
        </div>
      )}

      {/* Money — mobile money first; cash, LIPA, bank as other payment methods */}
      {canPay && (methods.length > 0 || mobileOk) && total > 0 && (
        <div className="space-y-2 rounded-xl border border-border/70 bg-card p-3">
          <p className="flex items-center justify-between text-xs font-semibold"><span>{t("Payment · {amount}", { amount: formatTZS(total) })}</span>{mode !== "walkIn" && <span className="font-normal text-muted-foreground">{t("Optional")}</span>}</p>
          {mobileOk && (
            <div className={cn("rounded-xl border p-2.5 transition", payWay === PROMPT ? "border-sky-500/60 bg-sky-500/[0.09]" : "border-border hover:bg-muted")}>
              <button type="button" aria-pressed={payWay === PROMPT} onClick={() => pick(PROMPT)} className="flex w-full items-center gap-2.5 text-left">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", payWay === PROMPT ? "bg-sky-600 text-white" : "bg-sky-500/12 text-sky-600 dark:text-sky-300")}><Smartphone className="size-4" /></span>
                <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm font-semibold">{t("Mobile money")}</span><NetworkMarks label={null} compact className="mt-1" /></span>
                {payWay === PROMPT && <CheckCircle2 className="size-4 shrink-0 text-sky-600 dark:text-sky-300" />}
              </button>
              {payWay === PROMPT && (
                <Input value={promptPhone ?? guest.phone} onChange={(e) => setPromptPhone(e.target.value)} type="tel" inputMode="tel" aria-label={t("Phone number for the payment request")}
                  placeholder={t("Phone number, e.g. 0712 345 678")} className="mt-2.5 h-10 tabular-nums" />
              )}
            </div>
          )}
          {mobileOk && methods.length > 0 && <p className="pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("Other payment methods")}</p>}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={!payWay} onClick={() => pick("")} className={chip(!payWay)}>{mode === "walkIn" ? t("Pay at check-out") : t("Pay later")}</button>
            {methods.map((m) => (
              <button key={m.id} type="button" aria-pressed={payWay === m.id} onClick={() => pick(m.id)} className={chip(payWay === m.id)}>
                {payWay === m.id && <Check className="-ml-0.5 mr-1 inline size-3" />}{t(m.name)}
              </button>
            ))}
          </div>
          {payWay && payWay !== PROMPT && <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t("Reference (M-Pesa code, receipt…) — optional")} aria-label={t("Reference")} className="h-9" />}
          {!payWay && <p className="text-[11px] text-muted-foreground">{mode === "walkIn" ? t("Checked in now — the bill is paid at check-out.") : t("Not paid: the room is held as a pending booking until it is paid.")}</p>}
          {payWay === PROMPT && <p className="text-[11px] text-muted-foreground">{t("The guest confirms it on their phone with their PIN — it is recorded automatically.")}</p>}
        </div>
      )}

      <Button className="h-11 w-full" disabled={saving || !free} onClick={save}>
        {saving ? <Loader2 className="animate-spin" /> : <Icon />}
        {payWay === PROMPT && total > 0
          ? (mode === "walkIn" ? t("Check in & request {amount}", { amount: formatTZS(total) }) : mode === "meeting" ? t("Book & request {amount}", { amount: formatTZS(total) }) : t("Reserve & request {amount}", { amount: formatTZS(total) }))
          : mode === "walkIn" ? (total ? t("Check in now · {amount}", { amount: formatTZS(total) }) : t("Check in now")) : mode === "meeting" ? t("Book the meeting") : t("Reserve the room")}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        {t.rich("Need more (several rooms, discount, company invoice, extras)? <link>Full booking form</link>", {
          link: (c) => <Link href={`/staff/reservations/new?${new URLSearchParams({ room: room.id, ...(mode === "walkIn" ? { mode: "walkin" } : mode === "meeting" ? { mode: "meeting" } : { from: dates.arrival }) })}`} className="underline underline-offset-2">{c}</Link>,
        })}
      </p>
    </div>
  );
}

const chip = (on: boolean) => cn("rounded-full border px-2.5 py-1 text-xs font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted");

function Step({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const t = useT();
  return (
    <div className="flex h-8 items-center rounded-lg border border-border bg-card">
      <button type="button" className="px-2 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={t("Fewer {what}", { what: label })}><Minus className="size-3.5" /></button>
      <span className="w-6 text-center text-sm font-semibold tabular-nums">{value}</span>
      <button type="button" className="px-2 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={t("More {what}", { what: label })}><Plus className="size-3.5" /></button>
    </div>
  );
}
