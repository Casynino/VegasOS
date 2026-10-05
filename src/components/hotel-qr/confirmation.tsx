"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  BedDouble, CalendarPlus, Check, ChevronRight, CircleCheck, Copy, Download, Hourglass, Loader2, Lock, MessageCircle, Phone, Plus, RotateCcw, Smartphone,
  UtensilsCrossed, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NetworkMarks } from "@/components/payments/networks";
import type { QrConfirmation } from "@/server/services/hotel-qr";
import { qrBookingStatusAction, qrPayNowAction } from "@/app/b/[token]/actions";
import { useWho } from "@/components/restaurant/who";
import { BrandMark, card, darkButton, goldButton, input, lightButton } from "./ui";

/** A plain row (an icon, the words, a chevron) — the quiet way to list what can be done next. */
const rowLink = "flex w-full items-center gap-3 py-3.5 text-left text-[14px] font-medium transition hover:text-(--vr-gold-ink)";
import { dayLong, flowUrl, guestsText, hotelClock, hotelInstant, newKey, nightsText, payPhoneOk, telHref, tzs, waHref } from "./lib";

type Tone = "ok" | "wait" | "warn" | "off";
const OFFLINE = "No connection — please check your internet and try again.";

/** The big line at the top — from the booking's real state ("paid" only once nTZS confirmed the money). */
function headline(b: QrConfirmation): { tone: Tone; title: string; line: string } {
  const hold = b.holdUntil ? hotelClock(b.holdUntil, b.timezone) : null;
  const thanks = b.guestFirstName ? `Thank you, ${b.guestFirstName}. ` : "";
  if (b.status === "CANCELLED") {
    return { tone: "off", title: "Booking cancelled", line: b.payWay === "ONLINE" && b.paid === 0 ? "The payment did not come in, so the room was released. You are welcome to book again." : "This booking is cancelled. Questions? Call us." };
  }
  if (b.status === "NO_SHOW") return { tone: "off", title: "Booking closed", line: "This booking was closed after the arrival day. Questions? Call us." };
  if (b.status === "CHECKED_IN") return { tone: "ok", title: "You are checked in", line: `Welcome to ${b.hotel.name} — enjoy your stay.` };
  if (b.status === "CHECKED_OUT") return { tone: "ok", title: "Thank you for staying", line: "We hope to welcome you again soon." };
  // Booked to pay later (or a payment that never started): saved, but nothing is held until it is paid (whoever pays
  // first gets the room).
  if (b.status === "INQUIRY" && b.paymentStatus !== "PAYMENT_PENDING") {
    const tried = b.paymentStatus === "PAYMENT_FAILED" || b.paymentStatus === "PAYMENT_EXPIRED";
    return { tone: "warn", title: tried ? "Payment not completed" : "Booked — not paid yet", line: `${tried ? "" : thanks}Your room is not reserved until it is paid. Pay now to secure it.` };
  }
  // Booked to pay later and kept only while it is paid (Pay now pressed — the room checked again): not reserved yet.
  if (b.payWay === "HOTEL" && b.status === "RESERVED" && b.paid === 0 && hold && (b.paymentStatus === "PAYMENT_FAILED" || b.paymentStatus === "PAYMENT_EXPIRED")) {
    return { tone: "warn", title: "Room kept while you pay", line: `Pay now by ${hold} to confirm it — after that the room is not held.` };
  }
  switch (b.paymentStatus) {
    case "PAID": return { tone: "ok", title: "Booking confirmed", line: `${thanks}We look forward to welcoming you to ${b.hotel.name}.` };
    case "PARTIALLY_PAID": return { tone: "ok", title: "Booking confirmed", line: `${thanks}Part paid — ${tzs(b.balance)} still to pay.` };
    case "PAYMENT_PENDING": return { tone: "wait", title: "Waiting for your payment", line: "Approve the payment request on your phone. This page updates by itself." };
    case "PAYMENT_FAILED":
    case "PAYMENT_EXPIRED": return { tone: "warn", title: "Payment not completed", line: hold ? `Your room is held until ${hold}. Pay now to confirm it.` : "Pay now to confirm your booking." };
    case "REFUNDED": return { tone: "off", title: "Payment refunded", line: "Your payment was refunded. Questions? Call us." };
    default:
      if (b.confirmed) return { tone: "ok", title: "Booking confirmed", line: `${thanks}Pay at reception when you arrive.` };
      return { tone: "ok", title: "Room reserved", line: hold ? `${thanks}We hold your room until ${hold} — pay now by mobile money before then.` : `${thanks}Pay at reception when you arrive.` };
  }
}

const PAYMENT_WORD: Record<QrConfirmation["paymentStatus"], string> = {
  PAID: "Paid", PARTIALLY_PAID: "Part paid", PAY_AT_HOTEL: "Not paid yet", PAYMENT_PENDING: "Waiting for your payment",
  PAYMENT_FAILED: "Not completed", PAYMENT_EXPIRED: "Not completed — time ran out", REFUNDED: "Refunded",
};
const paymentWord = (b: QrConfirmation) => (b.paymentStatus === "PAID" && b.ntzsReference ? "Paid online"
  : !b.roomHeld && b.paymentStatus === "PAY_AT_HOTEL" ? "Not paid — room not held" : PAYMENT_WORD[b.paymentStatus]);

/** The booking as a calendar event (made on the phone, nothing sent anywhere): check-in to check-out, at the hotel's time. */
function calendarFile(b: QrConfirmation, origin: string) {
  // Exact instants (UTC) of the hotel's check-in and check-out times — right on a phone in any time zone.
  const at = (d: string, t: string) => hotelInstant(d, t, b.timezone).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
  // Lines longer than 75 characters are folded, as calendar files require.
  const fold = (l: string) => l.length <= 74 ? l : l.match(/.{1,73}/g)!.join("\r\n ");
  const rooms = b.rooms.map((r) => `Room ${r.number} (${r.typeName})`).join(", ");
  const stamp = b.createdAt.replace(/[-:]/g, "").replace(/\.\d+/, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vegas Luxury Hotel//Hotel QR//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.reference}@hotel-qr`, `DTSTAMP:${stamp}`,
    `DTSTART:${at(b.checkIn, b.checkInTime)}`, `DTEND:${at(b.checkOut, b.checkoutTime)}`,
    `SUMMARY:${esc(`Stay at ${b.hotel.name} — ${b.reference}`)}`,
    `LOCATION:${esc(b.hotel.name)}`,
    `DESCRIPTION:${esc(`Booking ${b.reference} · ${rooms} · ${guestsText(b.adults, b.children)}. Check-in from ${b.checkInTime}, check-out by ${b.checkoutTime}.${b.hotel.phone ? ` Reception: ${b.hotel.phone}.` : ""}`)}`,
    `URL:${origin}${b.bookingLink}`,
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n");
}

/**
 * BOOKING CONFIRMATION — "Booking confirmed" (paid), "Booked — not paid yet" (pay later: the room is not held until it
 * is paid, Pay now first) or "Waiting for your payment":
 * the reference, the room, the dates, the guests, the money, and View booking / Download confirmation / Add to
 * calendar. While a payment is on its way the page asks the server now and then (gently), and changes by itself.
 */
export function QrConfirmationView({ token, link, initial }: { token: string; link: { ref: string; key: string }; initial: QrConfirmation }) {
  const [b, setB] = useState(initial);
  const reduce = useReducedMotion();
  const [checking, startChecking] = useTransition();

  useEffect(() => {
    if (b.paymentStatus !== "PAYMENT_PENDING") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const since = Date.now();
    const tick = async () => {
      const r = await qrBookingStatusAction(token, link).catch(() => null);
      if (stopped) return;
      if (r?.ok && r.data.state === "moved") { window.location.replace(r.data.href); return; }
      if (r?.ok && r.data.state === "ok" && (r.data.booking.paymentStatus !== b.paymentStatus || r.data.booking.status !== b.status)) {
        setB(r.data.booking);
        if (r.data.booking.paymentStatus === "PAID") toast.success("Payment received — your booking is confirmed.");
        return;
      }
      const age = Date.now() - since;
      if (age > 20 * 60_000) return; // after 20 minutes: "Check again" only
      timer = setTimeout(tick, age > 2 * 60_000 ? 10_000 : 4_000);
    };
    timer = setTimeout(tick, 4_000);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [b.paymentStatus, b.status, token, link]);

  /** The booking again from the server (after Pay now changed it: another room, another price). */
  const reload = async () => {
    const r = await qrBookingStatusAction(token, link).catch(() => null);
    if (r?.ok && r.data.state === "ok") setB(r.data.booking);
  };
  const checkNow = () => startChecking(async () => {
    const r = await qrBookingStatusAction(token, link).catch(() => null);
    if (!r) { toast.error(OFFLINE); return; }
    if (!r.ok) { toast.error(r.error); return; }
    if (r.data.state === "moved") { window.location.replace(r.data.href); return; }
    if (r.data.state === "ok") {
      setB(r.data.booking);
      if (r.data.booking.paymentStatus === "PAYMENT_PENDING") toast("Not received yet — it shows here by itself once it comes in.");
    }
  });

  const h = headline(b);
  const copy = () => navigator.clipboard?.writeText(b.reference).then(() => toast.success("Reference copied"), () => null);
  const addToCalendar = () => {
    const blob = new Blob([calendarFile(b, window.location.origin)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${b.reference}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const roomsLine = b.rooms.map((r) => `${r.number} — ${r.typeName}`).join(", ");
  const Icon = h.tone === "ok" ? Check : h.tone === "wait" ? Smartphone : h.tone === "warn" ? Hourglass : X;
  // Something to do about the money now: a payment on its way, or Pay now.
  const toDo = !!b.livePayment || b.paymentStatus === "PAYMENT_PENDING" || b.canPayNow;

  return (
    <main className="vr min-h-svh bg-(--vr-bg) pb-[max(2rem,env(safe-area-inset-bottom))] text-[14.5px] text-(--vr-ink) print:bg-white print:pb-0">
      <div className="print:hidden">
        {/* ── Where the booking stands ── */}
        <section className="relative overflow-hidden bg-(--vr-dark) text-white">
          <div aria-hidden className="pointer-events-none absolute -left-24 -top-28 size-80 rounded-full bg-(--vr-gold)/10 blur-3xl" />
          <div className="relative mx-auto max-w-5xl px-4 pb-8 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6 lg:pb-12">
            <header className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2.5">
                <BrandMark />
                <span className="min-w-0 leading-none">
                  <span className="block truncate font-display text-[17px] font-semibold tracking-wide">{b.hotel.name}</span>
                  <span className="mt-1 block truncate text-[10px] uppercase tracking-[0.22em] text-white/55">Your booking</span>
                </span>
              </span>
              <Link href={`/b/${token}`} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-white/80 ring-1 ring-white/15 transition hover:bg-white/10">
                <Plus className="size-4 text-(--vr-gold)" />Book another
              </Link>
            </header>
            <div className="mt-7 text-center lg:mt-10">
              <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 18 }}
                className={cn("mx-auto grid size-16 place-items-center rounded-full",
                  h.tone === "ok" ? "bg-emerald-500 text-white" : h.tone === "wait" ? "bg-(--vr-gold) text-(--vr-ink)" : h.tone === "warn" ? "bg-amber-400 text-(--vr-ink)" : "bg-white/15 text-white")}>
                <Icon className="size-7" strokeWidth={h.tone === "ok" ? 3 : 2} />
              </motion.span>
              <h1 className="mt-4 font-display text-[34px] font-semibold leading-[1.05] sm:text-[42px]">{h.title}</h1>
              <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-white/70">{h.line}</p>
              {b.paymentStatus === "PAYMENT_PENDING" && (
                <p className="mt-3 inline-flex items-center gap-2 text-[12.5px] text-white/60"><Loader2 className="size-3.5 animate-spin" />Checking with NTZS…</p>
              )}
              <div className="mx-auto mt-6 flex max-w-xs items-center justify-center gap-3 rounded-2xl bg-white/[0.06] py-3 pl-5 pr-3 ring-1 ring-white/10">
                <span className="min-w-0 text-left leading-tight">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-white/50">Booking reference</span>
                  <span className="mt-1 block font-display text-[30px] font-semibold tracking-wide text-(--vr-gold)">{b.reference}</span>
                </span>
                <button type="button" onClick={copy} aria-label="Copy the reference" className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.08] transition hover:bg-white/15"><Copy className="size-4" /></button>
              </div>
            </div>
          </div>
        </section>

        {/* Phones: paying comes first when it is what to do now (the details follow); computers: beside the details. */}
        <div className="mx-auto mt-5 flex max-w-5xl flex-col gap-4 px-4 sm:px-6 lg:mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-8 lg:gap-y-3">
          {toDo && (
            <div className="space-y-3 lg:col-start-2 lg:row-start-1">
              {b.livePayment && (
                <Link href={`/pay/${b.livePayment}`} className="flex items-center gap-3 rounded-3xl bg-(--vr-dark) p-4 text-white">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-gold) text-(--vr-ink)"><Loader2 className="size-5 animate-spin" /></span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[15px] font-semibold">Your payment is on its way</span>
                    <span className="text-[12px] text-white/70">Approve it on your phone — tap to follow it</span>
                  </span>
                  <span className="text-[12.5px] font-semibold text-(--vr-gold)">Open</span>
                </Link>
              )}
              {b.paymentStatus === "PAYMENT_PENDING" && !b.livePayment && (
                <button type="button" onClick={checkNow} disabled={checking} className={cn(lightButton, "h-11 w-full text-[13.5px]")}>
                  {checking ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4 text-(--vr-gold-ink)" />}I have paid — check again
                </button>
              )}
              {b.canPayNow && <PayNow token={token} link={link} amount={b.balance > 0 ? b.balance : b.total} guestPhone={b.guestPhone} again={againUrl(token, b)} onChanged={reload} />}
            </div>
          )}

          {/* ── The booking ── */}
          <section aria-label="Your booking" className={cn(card, "overflow-hidden lg:col-start-1 lg:row-span-2 lg:row-start-1")}>
            <dl className="divide-y divide-(--vr-line)">
              <Row k={b.rooms.length > 1 ? "Rooms" : "Room"} v={roomsLine} strong sub={b.roomHeld || ["CANCELLED", "NO_SHOW", "CHECKED_OUT"].includes(b.status) ? undefined : "Not held until paid"} />
              <Row k="Check-in" v={dayLong(b.checkIn)} sub={`from ${b.checkInTime}`} />
              <Row k="Check-out" v={dayLong(b.checkOut)} sub={`by ${b.checkoutTime}`} />
              <Row k="Stay" v={`${nightsText(b.nights)} · ${guestsText(b.adults, b.children)}`} />
              {b.paid > 0 && <Row k="Amount paid" v={tzs(b.paid)} strong />}
              {(b.paid === 0 || b.balance > 0) && <Row k={b.paid > 0 ? "Total" : "Amount"} v={tzs(b.total)} strong={b.paid === 0} />}
              {b.paid > 0 && b.balance > 0 && <Row k="Still to pay" v={tzs(b.balance)} />}
              <Row k="Payment" v={paymentWord(b)} badge={b.paymentStatus === "PAID" ? "ok" : b.paymentStatus === "PAYMENT_PENDING" ? "wait" : b.paymentStatus === "PAYMENT_FAILED" || b.paymentStatus === "PAYMENT_EXPIRED" || !b.roomHeld ? "warn" : undefined} />
              {b.ntzsReference && <Row k="Payment reference" v={b.ntzsReference} mono />}
              {b.holdUntil && b.paid === 0 && <Row k="Room held until" v={hotelClock(b.holdUntil, b.timezone)} />}
              {b.arrivalTime && <Row k="Arriving around" v={b.arrivalTime} />}
              {b.pickup && <Row k="Airport pickup" v={`${hotelClock(b.pickup.at, b.timezone)}${b.pickup.flightNumber ? ` · flight ${b.pickup.flightNumber}` : ""}`} sub={b.pickup.place} />}
              {b.specialRequest && <Row k="Your request" v={b.specialRequest} />}
            </dl>
          </section>

          {/* ── What to do next ── */}
          <aside className={cn("space-y-3 lg:col-start-2", toDo ? "lg:row-start-2" : "lg:row-span-2 lg:row-start-1")}>
            <div className={cn(card, "p-3")}>
              <Link href={b.bookingLink} className={cn(darkButton, "h-12 w-full text-[14.5px]")}><BedDouble className="size-4 text-(--vr-gold)" />View booking</Link>
              <div className="mt-1.5 divide-y divide-(--vr-line) px-1">
                <button type="button" onClick={() => window.print()} className={rowLink}><Download className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">Download confirmation</span><ChevronRight className="size-4 text-(--vr-muted)" /></button>
                <button type="button" onClick={addToCalendar} className={rowLink}><CalendarPlus className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">Add to calendar</span><ChevronRight className="size-4 text-(--vr-muted)" /></button>
                {b.stayLink && <Link href={b.stayLink} className={rowLink}><UtensilsCrossed className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">Your stay page — menu, requests, bill</span><ChevronRight className="size-4 text-(--vr-muted)" /></Link>}
                {b.hotel.phone && <a href={telHref(b.hotel.phone)} className={rowLink}><Phone className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">Call us <span className="tabular-nums text-(--vr-muted)">{b.hotel.phone}</span></span><ChevronRight className="size-4 text-(--vr-muted)" /></a>}
                {b.hotel.whatsapp && <a href={waHref(b.hotel.whatsapp, `Hello, this is about my booking ${b.reference}.`)} target="_blank" rel="noopener" className={rowLink}><MessageCircle className="size-[18px] shrink-0 text-(--vr-gold-ink)" /><span className="flex-1">WhatsApp us</span><ChevronRight className="size-4 text-(--vr-muted)" /></a>}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <PrintSheet b={b} title={h.title} payment={paymentWord(b)} />
    </main>
  );
}

function Row({ k, v, sub, strong, mono, badge }: { k: string; v: string; sub?: string; strong?: boolean; mono?: boolean; badge?: "ok" | "wait" | "warn" }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5">
      <dt className="shrink-0 pt-px text-[13px] text-(--vr-muted)">{k}</dt>
      <dd className="min-w-0 text-right">
        {badge ? (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold",
            badge === "ok" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : badge === "wait" ? "bg-(--vr-gold-soft) text-(--vr-ink) ring-1 ring-(--vr-gold)/40" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200")}>
            {badge === "ok" && <CircleCheck className="size-3.5" />}{v}
          </span>
        ) : (
          <span className={cn("block break-words text-[14px]", strong ? "font-semibold" : "font-medium", mono && "font-mono text-[13px]")}>{v}</span>
        )}
        {sub && <span className="mt-0.5 block text-[12px] text-(--vr-muted)">{sub}</span>}
      </dd>
    </div>
  );
}

/**
 * "Pay now" for what is still owed (worked out on the server) — a payment request to the guest's phone. A booking made
 * to pay later is checked again first: its room was just taken → "choose again"; moved to another room at another
 * price → the new price is shown and they press again.
 */
function PayNow({ token, link, amount, guestPhone, again, onChanged }: {
  token: string; link: { ref: string; key: string }; amount: number; guestPhone: string | null; again: string; onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [who] = useWho();
  const [typed, setTyped] = useState<string | null>(null);
  const phone = typed ?? who?.phone ?? guestPhone ?? "";
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [pending, start] = useTransition();
  const key = useRef<string | null>(null);
  const pay = () => start(async () => {
    setError(null);
    if (!payPhoneOk(phone)) { setError("Enter your mobile-money number, e.g. 0712 345 678."); return; }
    key.current ??= newKey();
    const r = await qrPayNowAction(token, link, { phone: phone.trim(), clientKey: key.current }).catch(() => null);
    if (!r) { toast.error(OFFLINE); return; }
    if (!r.ok) {
      key.current = null; setError(r.error); toast.error(r.error);
      setTaken(r.code === "UNAVAILABLE");
      if (r.code === "CONFLICT" || r.code === "UNAVAILABLE") await onChanged();
      return;
    }
    key.current = null;
    router.push(`/pay/${r.data.pay}`);
  });
  return (
    <section aria-labelledby="pay-now" className={cn(card, "space-y-3 p-4")}>
      <div className="flex items-start justify-between gap-3">
        <div className="leading-tight">
          <h2 id="pay-now" className="flex items-center gap-2 font-display text-[22px] font-semibold"><Smartphone className="size-5 text-(--vr-gold-ink)" />Pay now</h2>
          <p className="mt-1 text-[12.5px] text-(--vr-muted)">Secure your booking now</p>
        </div>
        <p className="shrink-0 text-[17px] font-semibold tabular-nums">{tzs(amount)}</p>
      </div>
      <NetworkMarks label={null} />
      <label className="block">
        <span className="text-[12px] font-medium text-(--vr-ink)/75">Mobile-money number</span>
        <input value={phone} onChange={(e) => { setTyped(e.target.value); setError(null); }} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678"
          aria-invalid={!!error} className={cn(input, "mt-1 font-medium tabular-nums")} />
        {error && <span role="alert" className="mt-1 block text-[12px] font-medium text-rose-700">{error}</span>}
      </label>
      {taken && <Link href={again} className={cn(lightButton, "h-11 w-full text-[13.5px]")}><RotateCcw className="size-4 text-(--vr-gold-ink)" />Choose another room</Link>}
      <button type="button" onClick={pay} disabled={pending} className={cn(goldButton, "h-[52px] w-full text-[15px]")}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}Pay {tzs(amount)} now
      </button>
      <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-(--vr-muted)">
        <Lock className="size-3 text-(--vr-gold-ink)" />Secure payment by <span className="font-semibold tracking-wide text-(--vr-ink)/80">NTZS</span>
      </p>
    </section>
  );
}

/** "Choose another room": the rooms free for the same stay and party (its room type first) — not the start again. */
function againUrl(token: string, b: QrConfirmation) {
  return flowUrl(`/b/${token}`, {
    view: "results", type: null, room: null, sheet: false, roomType: b.rooms[0]?.typeSlug ?? null,
    stay: { checkIn: b.checkIn, checkOut: b.checkOut, adults: b.adults, children: b.children },
  });
}

/** The confirmation on paper (Download → print or save as PDF): plain, black on white, every detail on one page. */
function PrintSheet({ b, title, payment }: { b: QrConfirmation; title: string; payment: string }) {
  const rows: [string, string][] = [
    ["Booking reference", b.reference],
    [b.rooms.length > 1 ? "Rooms" : "Room", b.rooms.map((r) => `${r.number} — ${r.typeName}`).join(", ")],
    ["Check-in", `${dayLong(b.checkIn)}, from ${b.checkInTime}`],
    ["Check-out", `${dayLong(b.checkOut)}, by ${b.checkoutTime}`],
    ["Stay", `${nightsText(b.nights)} · ${guestsText(b.adults, b.children)}`],
    ["Total", tzs(b.total)],
    ...(b.paid > 0 ? [["Amount paid", tzs(b.paid)] as [string, string]] : []),
    ...(b.balance > 0 && b.paid > 0 ? [["Still to pay", tzs(b.balance)] as [string, string]] : []),
    ["Payment", payment],
    ...(b.ntzsReference ? [["Payment reference", b.ntzsReference] as [string, string]] : []),
    ...(b.pickup ? [["Airport pickup", `${hotelClock(b.pickup.at, b.timezone)}${b.pickup.flightNumber ? ` · flight ${b.pickup.flightNumber}` : ""}`] as [string, string]] : []),
    ...(b.specialRequest ? [["Your request", b.specialRequest] as [string, string]] : []),
  ];
  return (
    <article className="hidden font-sans text-[#1b1611] [print-color-adjust:exact] print:block">
      <header className="flex items-center justify-between border-b-2 border-[#1b1611] pb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-192.png" alt="" className="size-12 rounded-full bg-[#1d1712]" />
          <div>
            <p className="font-display text-[24px] font-semibold leading-none">{b.hotel.name}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[#6f6457]">Booking confirmation</p>
          </div>
        </div>
        <p className="text-right text-[12px] text-[#6f6457]">{b.hotel.phone}<br />{b.hotel.whatsapp && b.hotel.whatsapp !== b.hotel.phone ? `WhatsApp ${b.hotel.whatsapp}` : ""}</p>
      </header>
      <h1 className="mt-6 font-display text-[30px] font-semibold">{title}</h1>
      <table className="mt-4 w-full border-collapse text-[13px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-[#e8dfd1]">
              <th className="w-[38%] py-2.5 pr-4 text-left font-normal text-[#6f6457]">{k}</th>
              <td className="py-2.5 font-semibold">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 text-[12px] text-[#6f6457]">Please show this booking reference at reception when you arrive. We look forward to welcoming you.</p>
    </article>
  );
}
