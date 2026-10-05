"use client";

import { useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { ArrowRight, BedDouble, Check, ChevronRight, Copy, ConciergeBell, Loader2, MapPin, Receipt, Wifi } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import type { GuestStay } from "@/server/services/guest-comms";
import { cn } from "@/lib/utils";
import { darkButton } from "@/components/hotel-qr/ui";
import { dayShort, dayWeek, nightsText, plural, tzs } from "@/components/hotel-qr/lib";
import { BillPayOnline } from "@/components/ordering/bill-pay-online";
import {
  BottomSheet, card, ContactButtons, goldButton, goldDot, HotelFooter, HoursList, PhotoViewer, QuickLink, QuickRow, RoomCard, SheetHead, sectionTitle,
  type HotelInfo,
} from "@/components/room-qr/parts";
import { RoomOptions, type RoomRequests } from "@/components/room-qr/room-options";

/** What the guest's page shows besides the booking itself — prepared on the server from the hotel settings. */
export type StayInfo = {
  hotel: string;
  billHref: string;
  /** "room": opened from the room's QR card (first name only, the stay checked in to the room now). */
  via: "room" | null;
  room: string; types: string; nights: number; meeting: boolean; fee: number;
  /** Their room type's real photos. */
  photos: string[];
  /** The hotel's date today (YYYY-MM-DD): a guest still in past their booked check-out counts from today. */
  today: string;
  /** "14:00", "11:00" — and a meeting's start and end. */
  checkInTime: string; checkoutTime: string; checkoutMinutes: number; meetingTimes: { start: string; end: string } | null;
  lateFee: number;
  /** Only while the guest is staying. */
  wifi: { network: string | null; password: string | null } | null;
  /** Where the guest's requests go (towels, cleaning…) — only while they are staying in a room. */
  ask: { kind: "stay" | "room"; token: string } | null;
  /** Their recent requests, named ("Room change", "Fresh towels"…). */
  requests: RoomRequests;
  /** Pay online (nTZS) for what is owed — the same payment as the bill page, when offered. */
  pay: { due: number; live: string | null; action: (input: { phone: string; clientKey: string }) => Promise<ActionResult<{ pay: string }>> } | null;
  contact: HotelInfo;
  /** Where "Book your next stay" goes. */
  bookHref: string;
};

/** "HONEST" → "Honest" (names typed in capitals read better greeted normally). */
const nice = (n: string) => n.split(/\s+/).map((w) => (/^[A-Z]{2,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w)).join(" ");

const STATE: Record<string, { label: string; dot: string }> = {
  CONFIRMED: { label: "Confirmed", dot: "bg-emerald-400" },
  RESERVED: { label: "Reserved", dot: "bg-amber-400" },
  INQUIRY: { label: "Not paid — not reserved yet", dot: "bg-white/50" },
  CANCELLED: { label: "Cancelled", dot: "bg-rose-400" },
  NO_SHOW: { label: "Not arrived", dot: "bg-rose-400" },
};
const ORDER_WORD: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "Received", tone: "text-(--vr-muted)" },
  ACCEPTED: { label: "Preparing", tone: "text-(--vr-gold-ink)" },
  PREPARING: { label: "Preparing", tone: "text-(--vr-gold-ink)" },
  READY: { label: "Ready", tone: "text-emerald-700" },
  OUT_FOR_DELIVERY: { label: "On its way", tone: "text-(--vr-gold-ink)" },
  DELIVERED: { label: "Delivered", tone: "text-emerald-700" },
  COMPLETED: { label: "Delivered", tone: "text-emerald-700" },
  COLLECTED: { label: "Collected", tone: "text-emerald-700" },
  CANCELLED: { label: "Cancelled", tone: "text-rose-700" },
};

/**
 * YOUR ROOM — the top of the guest's page (the room's QR card or their stay link), in the Hotel QR app's calm look: one
 * dark card with their room's photos, "Welcome, Honest", the room and the dates, one gold button (order food) and a
 * quiet row of links; then the bill, their orders, what they can ask for the room — and the menu right below.
 */
export function StayTop({ stay, info }: { stay: GuestStay; info: StayInfo }) {
  const reduce = useReducedMotion();
  const [sheet, setSheet] = useState<"wifi" | "reception" | "pay" | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const first = nice(stay.guestName.split(/\s+/)[0] ?? "");
  const inHouse = stay.status === "CHECKED_IN";
  const out = stay.status === "CHECKED_OUT";
  const gone = stay.status === "CANCELLED" || stay.status === "NO_SHOW";
  const place = info.meeting ? `Meeting room ${info.room}` : `Room ${info.room}`;
  const due = stay.money?.balance ?? 0;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });

  const hello = inHouse ? "Welcome," : out ? "Thank you," : "Hello,";
  const name = first || (inHouse ? "to your room" : "and welcome");
  const where = (inHouse || out
    ? [info.room && place, !info.meeting && info.types]
    : [info.meeting ? "Your meeting" : "Your booking", !info.meeting && info.types, info.room && place]
  ).filter(Boolean).join(" · ");
  // Still in after the booked check-out day (the extra nights are charged at check-out): no "check-out by" a past date.
  const staysOn = inHouse && !info.meeting && stay.departure < info.today;
  const when = info.meeting && info.meetingTimes
    ? `${dayWeek(stay.arrival)} · ${info.meetingTimes.start}–${info.meetingTimes.end}`
    : staysOn
      ? `Since ${dayShort(stay.arrival)} · booked until ${dayShort(stay.departure)}`
      : [
        `${dayShort(stay.arrival)} → ${dayShort(stay.departure)}`,
        inHouse ? `check-out by ${info.checkoutTime}` : out || gone ? (info.nights ? nightsText(info.nights) : "Day use") : `${info.nights ? nightsText(info.nights) : "Day use"} · check-in from ${info.checkInTime}`,
      ].join(" · ");
  const state = !inHouse && !out ? STATE[stay.status] : undefined;
  // The orders sit under the bill unless they have the second column to themselves (a meeting in use).
  const sideOrders = !!info.ask || !inHouse;

  // The one gold button: order food while staying; pay what is owed before arriving; come back once they have left.
  const payable = !inHouse && !out && !gone && !!info.pay && due > 0;
  const primary = inHouse
    ? { label: stay.canOrder ? "Order food & drinks" : "See our menu", onClick: () => go("order") }
    : payable
      ? info.pay!.live ? { label: "Your payment is on its way", href: `/pay/${info.pay!.live}` } : { label: `Pay ${tzs(due)} now`, onClick: () => setSheet("pay") }
      : out || gone ? { label: "Book your next stay", href: info.bookHref } : { label: "See our menu", onClick: () => go("order") };

  return (
    <>
      <RoomCard photos={info.photos} title={info.room ? place : info.types || info.hotel} onPhotos={setViewing}>
        {state && (
          <p className="mb-3 inline-flex items-center gap-2 text-[12px] font-medium text-white/70"><span className={cn("size-1.5 rounded-full", state.dot)} />{state.label}</p>
        )}
        <h1 className="font-display text-[34px] font-semibold leading-[1.02] tracking-tight lining-nums sm:text-[40px] lg:text-[50px]">
          {hello}<br /><span className="text-(--vr-gold)">{name}</span>
        </h1>
        {where && <p className="mt-3 text-[15px] font-medium text-white/90 lg:mt-4 lg:text-[16px]">{where}</p>}
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/55 lg:text-[13px]">{when}</p>

        <div className="mt-5 max-w-sm">
          {"href" in primary
            ? <Link href={primary.href!} className={goldButton}>{primary.label}<span className={goldDot}><ArrowRight className="size-4" /></span></Link>
            : <button type="button" onClick={primary.onClick} className={goldButton}>{primary.label}<span className={goldDot}><ArrowRight className="size-4" /></span></button>}
        </div>

        <QuickRow>
          {info.ask
            ? <QuickLink icon={BedDouble} label="Your room" onClick={() => go("room")} />
            : <QuickLink icon={Receipt} label="My bill" onClick={() => go("bill")} />}
          {info.wifi
            ? <QuickLink icon={Wifi} label="Wi-Fi" onClick={() => setSheet("wifi")} />
            : info.contact.mapHref && !inHouse ? <QuickLink icon={MapPin} label="Directions" href={info.contact.mapHref} external /> : null}
          <QuickLink icon={ConciergeBell} label="Reception" onClick={() => setSheet("reception")} />
        </QuickRow>
      </RoomCard>
      <PhotoViewer photos={info.photos} start={viewing} title={info.room ? place : info.types || info.hotel} onClose={() => setViewing(null)} />

      {/* ── The bill and the orders; what they can ask for the room (staying) or their booking (before / after) ── */}
      <div className="mt-8 grid gap-8 lg:mt-10 lg:grid-cols-2 lg:gap-6 xl:gap-8">
        <div className="min-w-0">
          <BillCard stay={stay} info={info} payInCard={payable} onPay={() => setSheet("pay")} />
          {sideOrders && stay.orders.length > 0 && <OrdersCard orders={stay.orders} className="mt-8 lg:mt-6" />}
        </div>
        {info.ask
          ? <RoomOptions ask={info.ask} requests={info.requests} departure={stay.departure} today={info.today} checkoutMinutes={info.checkoutMinutes} lateFee={info.lateFee} className="min-w-0" />
          : !inHouse ? <BookingCard stay={stay} info={info} className="min-w-0" />
          : stay.orders.length > 0 && <OrdersCard orders={stay.orders} className="min-w-0" />}
      </div>

      {/* ── The menu starts here ── */}
      <div id="order" className="mt-10 scroll-mt-3 lg:mt-14">
        <h2 className={sectionTitle}>{stay.canOrder ? "Food & drinks" : "Our menu"}</h2>
        <p className="mt-1.5 text-[13px] text-(--vr-muted)">
          {stay.canOrder
            ? info.meeting ? "Served in your meeting room and added to its bill." : `Brought to ${place} and added to your room bill${info.fee ? ` · delivery ${tzs(info.fee)}` : ""}.`
            : out || gone ? "We hope to serve you again soon." : "You can order to your room as soon as you have checked in."}
        </p>
      </div>

      {/* ── Wi-Fi, reception, paying ── */}
      <BottomSheet open={sheet !== null} onClose={() => setSheet(null)} label={sheet === "wifi" ? "Wi-Fi" : sheet === "pay" ? "Pay your bill" : "Reception"}>
        {sheet === "wifi" ? <WifiPanel info={info} />
          : sheet === "pay" && info.pay ? <PayPanel pay={info.pay} />
          : <ReceptionPanel contact={info.contact} />}
      </BottomSheet>
    </>
  );
}

function BillCard({ stay, info, payInCard, onPay }: { stay: GuestStay; info: StayInfo; payInCard: boolean; onPay: () => void }) {
  const m = stay.money;
  const owed = (m?.balance ?? 0) > 0;
  return (
    <section id="bill" aria-labelledby="bill-title" className="scroll-mt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="bill-title" className={sectionTitle}>Your bill</h2>
          <p className="mt-1.5 text-[13px] text-(--vr-muted)">{stay.status === "CHECKED_IN" ? "Extras are added as you go." : "Your stay and what is paid."}</p>
        </div>
        <Link href={info.billHref} className="-mt-2.5 inline-flex min-h-11 shrink-0 items-center gap-0.5 text-[13px] font-medium text-(--vr-gold-ink) hover:underline">Full bill<ChevronRight className="size-4" /></Link>
      </div>
      <div className={cn(card, "mt-3 p-4 sm:p-5")}>
        {m && m.total > 0 ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] text-(--vr-muted)">{owed ? "To pay" : "Balance"}</p>
                <p className={cn("mt-1 whitespace-nowrap text-[24px] font-semibold leading-none tabular-nums min-[360px]:text-[26px]", !owed && "text-emerald-700")}>{owed ? tzs(m.balance) : "Paid in full"}</p>
              </div>
              <p className="shrink-0 text-right text-[12px] leading-snug text-(--vr-muted)">Paid <span className="tabular-nums">{tzs(m.paid)}</span><br />of <span className="tabular-nums">{tzs(m.total)}</span></p>
            </div>
            <dl className="mt-4 divide-y divide-(--vr-line) border-t border-(--vr-line)">
              {m.lines.map((l) => (
                <div key={l.label} className="flex items-baseline justify-between gap-3 py-2.5 text-[13.5px]">
                  <dt className="text-(--vr-muted)">{l.label}</dt>
                  <dd className="tabular-nums">{l.amount < 0 ? "− " : ""}{tzs(Math.abs(l.amount))}</dd>
                </div>
              ))}
            </dl>
            {owed && payInCard ? (
              // Before arriving the card's gold button pays (or follows the payment on its way) — one button, not two.
              <p className="mt-2 text-[12px] text-(--vr-muted)">{info.pay?.live ? "Your payment is on its way — follow it from the button above." : "Pay from the button above, or at reception."}</p>
            ) : owed && info.pay?.live ? (
              <Link href={`/pay/${info.pay.live}`} className={cn(darkButton, "mt-3 h-12 w-full justify-between px-5 text-[14px]")}>
                <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin text-(--vr-gold) motion-reduce:animate-none" />Your payment is on its way</span>
                <span className="text-[12.5px] text-(--vr-gold)">Open</span>
              </Link>
            ) : owed && info.pay ? (
              <button type="button" onClick={onPay} className={cn(darkButton, "mt-3 h-12 w-full text-[14.5px]")}>Pay {tzs(m.balance)} now<ArrowRight className="size-4 text-(--vr-gold)" /></button>
            ) : (
              <p className="mt-2 text-[12px] text-(--vr-muted)">{owed ? "Pay at reception, any time before you leave." : "Thank you."}</p>
            )}
          </>
        ) : stay.payer ? (
          <p className="text-[14px] leading-relaxed">Paid by <strong className="font-semibold">{stay.payer}</strong>. Food, drinks and extras you order are added to it.</p>
        ) : (
          <p className="text-[14px] text-(--vr-muted)">Nothing on your bill yet.</p>
        )}
      </div>
    </section>
  );
}

/**
 * Before they arrive (or after they leave) — only ever on their own private link (the room card shows a stay that is
 * checked in): the booking itself, in plain rows.
 */
function BookingCard({ stay, info, className }: { stay: GuestStay; info: StayInfo; className?: string }) {
  const people = info.meeting
    ? plural(stay.adults, "attendee")
    : `${plural(stay.adults, "adult")}${stay.children ? ` · ${plural(stay.children, "child", "children")}` : ""}`;
  const rows: [string, string][] = [
    ["Booking", stay.reference],
    ["Guest", nice(stay.guestName)],
    ...(stay.company ? [["Company", stay.company] as [string, string]] : []),
    [info.meeting ? "Meeting room" : stay.rooms.length > 1 ? "Rooms" : "Room", [info.room, !info.meeting && info.types].filter(Boolean).join(" · ") || "—"],
    [info.meeting ? "Attendees" : "Guests", people],
    ...(info.meeting && info.meetingTimes
      ? [["When", `${dayWeek(stay.arrival)} · ${info.meetingTimes.start}–${info.meetingTimes.end}`] as [string, string]]
      : [["Check-in", `${dayWeek(stay.arrival)} · from ${info.checkInTime}`], ["Check-out", `${dayWeek(stay.departure)} · by ${info.checkoutTime}`]] as [string, string][]),
  ];
  return (
    <section aria-labelledby="booking-title" className={className}>
      <h2 id="booking-title" className={sectionTitle}>{info.meeting ? "Your meeting" : "Your booking"}</h2>
      <p className="mt-1.5 text-[13px] text-(--vr-muted)">{stay.phone ? `We will reach you on ${stay.phone}.` : "Questions? Reception is here day and night."}</p>
      <dl className={cn(card, "mt-3 divide-y divide-(--vr-line) px-4 sm:px-5")}>
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="shrink-0 text-[13px] text-(--vr-muted)">{label}</dt>
            <dd className={cn("min-w-0 truncate text-right text-[14px] font-medium", label === "Booking" && "font-mono tracking-wide")}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function OrdersCard({ orders, className }: { orders: GuestStay["orders"]; className?: string }) {
  return (
    <section aria-labelledby="orders-title" className={className}>
      <h2 id="orders-title" className={sectionTitle}>Your orders</h2>
      <p className="mt-1.5 text-[13px] text-(--vr-muted)">{orders.some((o) => o.track) ? "Tap one to follow it." : "From the kitchen and the bar."}</p>
      <ul className={cn(card, "mt-3 divide-y divide-(--vr-line) px-4 sm:px-5")}>
        {orders.slice(0, 4).map((o) => {
          const w = ORDER_WORD[o.status] ?? { label: o.status, tone: "text-(--vr-muted)" };
          const inner = (
            <>
              <span className="w-9 shrink-0 text-[13px] font-semibold tabular-nums text-(--vr-muted)">#{o.number.replace(/^ORD-\d{4}-0*/, "")}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[14px] font-medium">{o.items.join(", ")}</span>
                <span className="mt-0.5 block text-[12.5px] tabular-nums text-(--vr-muted)">{tzs(o.total)}</span>
              </span>
              <span className={cn("shrink-0 text-[12.5px] font-semibold", w.tone)}>{w.label}</span>
            </>
          );
          return (
            <li key={o.number}>
              {o.track
                ? <Link href={`/order/${o.track}`} className="group flex min-h-[60px] items-center gap-3 py-2.5">{inner}<ChevronRight className="-mr-1 size-4 shrink-0 text-(--vr-muted) transition group-hover:text-(--vr-gold-ink)" /></Link>
                : <div className="flex min-h-[60px] items-center gap-3 py-2.5">{inner}</div>}
            </li>
          );
        })}
      </ul>
      {orders.length > 4 && <p className="mt-2 px-1 text-[12px] text-(--vr-muted)">and {orders.length - 4} earlier — all on your bill.</p>}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }).catch(() => {}); }}
      className={cn(darkButton, "h-11 shrink-0 px-4 text-[13px]")}>
      {done ? <Check className="size-4 text-(--vr-gold)" /> : <Copy className="size-4 text-(--vr-gold)" />}{done ? "Copied" : "Copy"}
    </button>
  );
}

function WifiPanel({ info }: { info: StayInfo }) {
  return (
    <>
      <SheetHead title="Wi-Fi" text="Free for guests, in your room and around the hotel." />
      {info.wifi?.network ? (
        <dl className="mt-4 divide-y divide-(--vr-line) border-y border-(--vr-line)">
          <div className="flex min-h-14 items-center justify-between gap-3 py-2.5">
            <dt className="text-[13px] text-(--vr-muted)">Network</dt>
            <dd className="min-w-0 truncate text-right text-[16px] font-semibold">{info.wifi.network}</dd>
          </div>
          <div className="flex min-h-14 items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <dt className="text-[13px] text-(--vr-muted)">Password</dt>
              <dd className="mt-0.5 truncate font-mono text-[17px] font-semibold tracking-wide">{info.wifi.password || "No password"}</dd>
            </div>
            {info.wifi.password && <CopyButton text={info.wifi.password} />}
          </div>
        </dl>
      ) : (
        <p className="mt-4 border-y border-(--vr-line) py-3.5 text-[14px]">Ask reception for the Wi-Fi password — they will be happy to help.</p>
      )}
    </>
  );
}

function ReceptionPanel({ contact }: { contact: HotelInfo }) {
  return (
    <>
      <SheetHead title="Reception" text={<>Here for you, day and night.{contact.phoneLabel && <> <span className="whitespace-nowrap font-medium text-(--vr-ink)">{contact.phoneLabel}</span></>}</>} />
      <ContactButtons info={contact} className="mt-4" />
      <HoursList hours={contact.hours} className="mt-3 border-t border-(--vr-line)" />
      {contact.address && (
        <p className="mt-1 flex items-start gap-2 border-t border-(--vr-line) pt-3 text-[13px] text-(--vr-muted)">
          <MapPin className="mt-0.5 size-4 shrink-0 text-(--vr-gold-ink)" />
          <span>{contact.address}{contact.mapHref && <> · <a href={contact.mapHref} target="_blank" rel="noopener" className="font-semibold text-(--vr-gold-ink) hover:underline">Directions</a></>}</span>
        </p>
      )}
    </>
  );
}

/** Pay online for what is owed — the bill page's own payment (amount worked out on the server), in a sheet. */
function PayPanel({ pay }: { pay: NonNullable<StayInfo["pay"]> }) {
  return (
    <>
      <SheetHead title="Pay your bill" text={<><strong className="font-semibold tabular-nums text-(--vr-ink)">{tzs(pay.due)}</strong> — what you owe right now, from your phone with mobile money.</>} />
      {/* The bill page's own form, without its card and title (the sheet is the card) */}
      <div className="mt-4">
        <BillPayOnline due={pay.due} live={pay.live} action={pay.action} bare />
      </div>
    </>
  );
}

/** After the menu: the hotel, compact — hours, reception, the address. */
export function StayBottom({ stay, info }: { stay: GuestStay; info: StayInfo }) {
  const place = info.meeting ? "this meeting room" : `Room ${info.room}`;
  return (
    <HotelFooter info={info.contact}
      note={info.via === "room" ? `This page shows the stay checked in to ${place} right now.` : `Booking ${stay.reference} · this page is private to your booking — please don't share the link.`} />
  );
}
