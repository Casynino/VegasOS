"use client";

import { useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { ArrowRight, BedDouble, Check, ChevronRight, Copy, ConciergeBell, Loader2, MapPin, Receipt, Wifi } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import type { GuestStay } from "@/server/services/guest-comms";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { orderItemName } from "@/i18n/content";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";
import { darkButton } from "@/components/hotel-qr/ui";
import { qrSvg } from "@/lib/qr-svg";
import { dayShort, dayWeek, tzs } from "@/components/hotel-qr/lib";
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

/** A business date in the guest's language: "12 Oct" / "10月12日" — and with the weekday: "Mon 12 Oct" / "10月12日周一". */
const dayShortIn = (d: string, t: T) =>
  t.locale === "en" ? dayShort(d) : new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const dayWeekIn = (d: string, t: T) => (t.locale === "en" ? dayWeek(d) : t.dayMonth(d));
const nightsIn = (n: number, t: T) => t.plural(n, "{n} night", "{n} nights");

const STATE: Record<string, { label: string; dot: string }> = {
  CONFIRMED: { label: msg("Confirmed"), dot: "bg-emerald-400" },
  RESERVED: { label: msg("Reserved"), dot: "bg-amber-400" },
  INQUIRY: { label: msg("Not paid — not reserved yet"), dot: "bg-white/50" },
  CANCELLED: { label: msg("Cancelled"), dot: "bg-rose-400" },
  NO_SHOW: { label: msg("Not arrived"), dot: "bg-rose-400" },
};
const ORDER_WORD: Record<string, { label: string; tone: string }> = {
  PENDING: { label: msg("Received"), tone: "text-(--vr-muted)" },
  ACCEPTED: { label: msg("Preparing"), tone: "text-(--vr-gold-ink)" },
  PREPARING: { label: msg("Preparing"), tone: "text-(--vr-gold-ink)" },
  READY: { label: msg("Ready"), tone: "text-emerald-700" },
  OUT_FOR_DELIVERY: { label: msg("On its way"), tone: "text-(--vr-gold-ink)" },
  DELIVERED: { label: msg("Delivered"), tone: "text-emerald-700" },
  COMPLETED: { label: msg("Delivered"), tone: "text-emerald-700" },
  COLLECTED: { label: msg("Collected"), tone: "text-emerald-700" },
  CANCELLED: { label: msg("Cancelled"), tone: "text-rose-700" },
};

/**
 * YOUR ROOM — the top of the guest's page (the room's QR card or their stay link), in the Hotel QR app's calm look: one
 * dark card with their room's photos, "Welcome, Honest", the room and the dates, one gold button (order food) and a
 * quiet row of links; then the bill, their orders, what they can ask for the room — and the menu right below.
 */
export function StayTop({ stay, info }: { stay: GuestStay; info: StayInfo }) {
  const t = useT();
  const reduce = useReducedMotion();
  const [sheet, setSheet] = useState<"wifi" | "reception" | "pay" | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const first = nice(stay.guestName.split(/\s+/)[0] ?? "");
  const inHouse = stay.status === "CHECKED_IN";
  const out = stay.status === "CHECKED_OUT";
  const gone = stay.status === "CANCELLED" || stay.status === "NO_SHOW";
  const place = info.meeting ? t("Meeting room {room}", { room: info.room }) : t("Room {room}", { room: info.room });
  const due = stay.money?.balance ?? 0;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });

  const hello = inHouse ? t("Welcome,") : out ? t("Thank you,") : t("Hello,");
  const name = first || (inHouse ? t("to your room") : t("and welcome"));
  const where = (inHouse || out
    ? [info.room && place, !info.meeting && info.types]
    : [info.meeting ? t("Your meeting") : t("Your booking"), !info.meeting && info.types, info.room && place]
  ).filter(Boolean).join(" · ");
  // Still in after the booked check-out day (the extra nights are charged at check-out): no "check-out by" a past date.
  const staysOn = inHouse && !info.meeting && stay.departure < info.today;
  const nights = info.nights ? nightsIn(info.nights, t) : t("Day use");
  const when = info.meeting && info.meetingTimes
    ? `${dayWeekIn(stay.arrival, t)} · ${info.meetingTimes.start}–${info.meetingTimes.end}`
    : staysOn
      ? t("Since {from} · booked until {to}", { from: dayShortIn(stay.arrival, t), to: dayShortIn(stay.departure, t) })
      : [
        `${dayShortIn(stay.arrival, t)} → ${dayShortIn(stay.departure, t)}`,
        inHouse ? t("check-out by {time}", { time: info.checkoutTime }) : out || gone ? nights : `${nights} · ${t("check-in from {time}", { time: info.checkInTime })}`,
      ].join(" · ");
  const state = !inHouse && !out ? STATE[stay.status] : undefined;
  // The orders sit under the bill unless they have the second column to themselves (a meeting in use).
  const sideOrders = !!info.ask || !inHouse;

  // The one gold button: order food while staying; pay what is owed before arriving; come back once they have left.
  const payable = !inHouse && !out && !gone && !!info.pay && due > 0;
  const primary = inHouse
    ? { label: stay.canOrder ? t("Order food & drinks") : t("See our menu"), onClick: () => go("order") }
    : payable
      ? info.pay!.live ? { label: t("Your payment is on its way"), href: `/pay/${info.pay!.live}` } : { label: t("Pay {amount} now", { amount: tzs(due) }), onClick: () => setSheet("pay") }
      : out || gone ? { label: t("Book your next stay"), href: info.bookHref } : { label: t("See our menu"), onClick: () => go("order") };

  return (
    <>
      <RoomCard photos={info.photos} title={info.room ? place : info.types || info.hotel} onPhotos={setViewing}>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90">
          <span className={cn("size-1.5 rounded-full", state ? state.dot : inHouse ? "bg-emerald-400" : "bg-white/40")} />{state ? t(state.label) : inHouse ? t("Staying now") : out ? t("Checked out") : t("Your stay")}
        </p>
        <h1 className="mt-2.5 font-display text-[23px] leading-[1.08] lining-nums sm:text-[30px]">
          {hello}<br /><span className="text-(--vr-gold)">{name}</span>
        </h1>
        {where && <p className="mt-1.5 text-[12.5px] font-medium text-white/90 sm:text-[13.5px]">{where}</p>}
        <p className="mt-0.5 text-[11px] leading-snug text-white/55 sm:text-[12px]">{when}</p>

        <div className="mt-3">
          {"href" in primary
            ? <Link href={primary.href!} className={goldButton}><span className={goldDot}><ArrowRight className="size-3.5" /></span><span className="truncate">{primary.label}</span></Link>
            : <button type="button" onClick={primary.onClick} className={goldButton}><span className={goldDot}><ArrowRight className="size-3.5" /></span><span className="truncate">{primary.label}</span></button>}
        </div>
      </RoomCard>

        <QuickRow>
          {info.ask
            ? <QuickLink icon={BedDouble} label={t("Your room")} onClick={() => go("room")} />
            : <QuickLink icon={Receipt} label={t("My bill")} onClick={() => go("bill")} />}
          {info.wifi
            ? <QuickLink icon={Wifi} label="Wi-Fi" onClick={() => setSheet("wifi")} />
            : info.contact.mapHref && !inHouse ? <QuickLink icon={MapPin} label={t("Directions")} href={info.contact.mapHref} external /> : null}
          <QuickLink icon={ConciergeBell} label={t("Reception")} onClick={() => setSheet("reception")} />
        </QuickRow>
      {/* In the room: the Wi-Fi right away — no tapping around for it (owner, 2026-10-06). */}
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
        <h2 className={sectionTitle}>{stay.canOrder ? t("Food & drinks") : t("Our menu")}</h2>
        <p className="mt-1.5 text-[13px] text-(--vr-muted)">
          {stay.canOrder
            ? info.meeting ? t("Served in your meeting room and added to its bill.")
              : info.fee ? t("Brought to {place} and added to your room bill · delivery {amount}.", { place, amount: tzs(info.fee) }) : t("Brought to {place} and added to your room bill.", { place })
            : out || gone ? t("We hope to serve you again soon.") : t("You can order to your room as soon as you have checked in.")}
        </p>
      </div>

      {/* ── Wi-Fi, reception, paying ── */}
      <BottomSheet open={sheet !== null} onClose={() => setSheet(null)} label={sheet === "wifi" ? "Wi-Fi" : sheet === "pay" ? t("Pay your bill") : t("Reception")}>
        {sheet === "wifi" ? <WifiPanel info={info} />
          : sheet === "pay" && info.pay ? <PayPanel pay={info.pay} />
          : <ReceptionPanel contact={info.contact} />}
      </BottomSheet>
    </>
  );
}

function BillCard({ stay, info, payInCard, onPay }: { stay: GuestStay; info: StayInfo; payInCard: boolean; onPay: () => void }) {
  const t = useT();
  const m = stay.money;
  const owed = (m?.balance ?? 0) > 0;
  return (
    <section id="bill" aria-labelledby="bill-title" className="scroll-mt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="bill-title" className={sectionTitle}>{t("Your bill")}</h2>
          <p className="mt-1.5 text-[13px] text-(--vr-muted)">{stay.status === "CHECKED_IN" ? t("Extras are added as you go.") : t("Your stay and what is paid.")}</p>
        </div>
        <Link href={info.billHref} className="-mt-2.5 inline-flex min-h-11 shrink-0 items-center gap-0.5 text-[13px] font-medium text-(--vr-gold-ink) hover:underline">{t("Full bill")}<ChevronRight className="size-4" /></Link>
      </div>
      <div className={cn(card, "mt-3 p-4 sm:p-5")}>
        {m && m.total > 0 ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12.5px] text-(--vr-muted)">{owed ? t("To pay") : t("Balance")}</p>
                <p className={cn("mt-1 whitespace-nowrap text-[24px] font-semibold leading-none tabular-nums min-[360px]:text-[26px]", !owed && "text-emerald-700")}>{owed ? tzs(m.balance) : t("Paid in full")}</p>
              </div>
              <p className="shrink-0 text-right text-[12px] leading-snug text-(--vr-muted)">
                {t.rich("Paid <n>{amount}</n>", { n: (c) => <span className="tabular-nums">{c}</span> }, { amount: tzs(m.paid) })}<br />
                {t.rich("of <n>{amount}</n>", { n: (c) => <span className="tabular-nums">{c}</span> }, { amount: tzs(m.total) })}
              </p>
            </div>
            <dl className="mt-4 divide-y divide-(--vr-line) border-t border-(--vr-line)">
              {m.lines.map((l) => (
                <div key={l.label} className="flex items-baseline justify-between gap-3 py-2.5 text-[13.5px]">
                  <dt className="text-(--vr-muted)">{t(l.label)}</dt>
                  <dd className="tabular-nums">{l.amount < 0 ? "− " : ""}{tzs(Math.abs(l.amount))}</dd>
                </div>
              ))}
            </dl>
            {owed && payInCard ? (
              // Before arriving the card's gold button pays (or follows the payment on its way) — one button, not two.
              <p className="mt-2 text-[12px] text-(--vr-muted)">{info.pay?.live ? t("Your payment is on its way — follow it from the button above.") : t("Pay from the button above, or at reception.")}</p>
            ) : owed && info.pay?.live ? (
              <Link href={`/pay/${info.pay.live}`} className={cn(darkButton, "mt-3 h-12 w-full justify-between px-5 text-[14px]")}>
                <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin text-(--vr-gold) motion-reduce:animate-none" />{t("Your payment is on its way")}</span>
                <span className="text-[12.5px] text-(--vr-gold)">{t("Open")}</span>
              </Link>
            ) : owed && info.pay ? (
              <button type="button" onClick={onPay} className={cn(darkButton, "mt-3 h-12 w-full text-[14.5px]")}>{t("Pay {amount} now", { amount: tzs(m.balance) })}<ArrowRight className="size-4 text-(--vr-gold)" /></button>
            ) : (
              <p className="mt-2 text-[12px] text-(--vr-muted)">
                {/* Not paid and not arrived: nothing holds the room yet — paying is what reserves it. */}
                {!owed ? t("Thank you.") : stay.status === "INQUIRY" ? t("Not reserved until paid — call reception to pay and secure it.") : t("Pay at reception, any time before you leave.")}
              </p>
            )}
          </>
        ) : stay.payer ? (
          <p className="text-[14px] leading-relaxed">{t.rich("Paid by <b>{payer}</b>. Food, drinks and extras you order are added to it.", { b: (c) => <strong className="font-semibold">{c}</strong> }, { payer: stay.payer })}</p>
        ) : (
          <p className="text-[14px] text-(--vr-muted)">{t("Nothing on your bill yet.")}</p>
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
  const t = useT();
  const people = info.meeting
    ? t.plural(stay.adults, "{n} attendee", "{n} attendees")
    : `${t.plural(stay.adults, "{n} adult", "{n} adults")}${stay.children ? ` · ${t.plural(stay.children, "{n} child", "{n} children")}` : ""}`;
  // The row names stay English (the key and the "Booking" check); each is shown in the guest's language.
  const rows: [string, string][] = [
    [msg("Booking"), stay.reference],
    [msg("Guest"), nice(stay.guestName)],
    ...(stay.company ? [[msg("Company"), stay.company] as [string, string]] : []),
    [info.meeting ? msg("Meeting room") : stay.rooms.length > 1 ? msg("Rooms") : msg("Room"), [info.room, !info.meeting && info.types].filter(Boolean).join(" · ") || "—"],
    [info.meeting ? msg("Attendees") : msg("Guests"), people],
    ...(info.meeting && info.meetingTimes
      ? [[msg("When"), `${dayWeekIn(stay.arrival, t)} · ${info.meetingTimes.start}–${info.meetingTimes.end}`] as [string, string]]
      : [
        [msg("Check-in"), t("{day} · from {time}", { day: dayWeekIn(stay.arrival, t), time: info.checkInTime })],
        [msg("Check-out"), t("{day} · by {time}", { day: dayWeekIn(stay.departure, t), time: info.checkoutTime })],
      ] as [string, string][]),
  ];
  return (
    <section aria-labelledby="booking-title" className={className}>
      <h2 id="booking-title" className={sectionTitle}>{info.meeting ? t("Your meeting") : t("Your booking")}</h2>
      <p className="mt-1.5 text-[13px] text-(--vr-muted)">{stay.phone ? t("We will reach you on {phone}.", { phone: stay.phone }) : t("Questions? Reception is here day and night.")}</p>
      <dl className={cn(card, "mt-3 divide-y divide-(--vr-line) px-4 sm:px-5")}>
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="shrink-0 text-[13px] text-(--vr-muted)">{t(label)}</dt>
            <dd className={cn("min-w-0 truncate text-right text-[14px] font-medium", label === "Booking" && "font-mono tracking-wide")}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function OrdersCard({ orders, className }: { orders: GuestStay["orders"]; className?: string }) {
  const t = useT();
  return (
    <section aria-labelledby="orders-title" className={className}>
      <h2 id="orders-title" className={sectionTitle}>{t("Your orders")}</h2>
      <p className="mt-1.5 text-[13px] text-(--vr-muted)">{orders.some((o) => o.track) ? t("Tap one to follow it.") : t("From the kitchen and the bar.")}</p>
      <ul className={cn(card, "mt-3 divide-y divide-(--vr-line) px-4 sm:px-5")}>
        {orders.slice(0, 4).map((o) => {
          const w = ORDER_WORD[o.status] ?? { label: o.status, tone: "text-(--vr-muted)" };
          const inner = (
            <>
              <span className="w-9 shrink-0 text-[13px] font-semibold tabular-nums text-(--vr-muted)">#{o.number.replace(/^ORD-\d{4}-0*/, "")}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[14px] font-medium">{o.items.map((i) => `${i.quantity} × ${orderItemName(i, t)}`).join(t.locale === "zh-CN" ? "、" : ", ")}</span>
                <span className="mt-0.5 block text-[12.5px] tabular-nums text-(--vr-muted)">{tzs(o.total)}</span>
              </span>
              <span className={cn("shrink-0 text-[12.5px] font-semibold", w.tone)}>{t(w.label)}</span>
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
      {orders.length > 4 && <p className="mt-2 px-1 text-[12px] text-(--vr-muted)">{t("and {n} earlier — all on your bill.", { n: orders.length - 4 })}</p>}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={label} onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }).catch(() => {}); }}
      className={cn(darkButton, "h-11 shrink-0 px-4 text-[13px]")}>
      {done ? <Check className="size-4 text-(--vr-gold)" /> : <Copy className="size-4 text-(--vr-gold)" />}<span aria-live="polite">{done ? t("Copied") : t("Copy")}</span>
    </button>
  );
}

/** Wi-Fi join code (the standard "WIFI:" format phones read): scanned by a laptop's or a partner's phone camera. */
const wifiCode = (network: string, password: string | null) => {
  const esc = (v: string) => v.replace(/([\\;,:"])/g, "\\$1");
  return password ? `WIFI:T:WPA;S:${esc(network)};P:${esc(password)};;` : `WIFI:T:nopass;S:${esc(network)};;`;
};

/** The network and the password, each with its own Copy — the card and the sheet show the same rows. */
function WifiRows({ network, password, className }: { network: string; password: string | null; className?: string }) {
  const t = useT();
  return (
    <dl className={cn("divide-y divide-(--vr-line)", className)}>
      <div className="flex min-h-16 items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <dt className="text-[13px] text-(--vr-muted)">{t("Wi-Fi name")}</dt>
          <dd className="mt-1 truncate text-[18px] font-semibold">{network}</dd>
        </div>
        <CopyButton text={network} label={t("Copy the network name")} />
      </div>
      <div className="flex min-h-16 items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <dt className="text-[13px] text-(--vr-muted)">{t("Password")}</dt>
          <dd className="mt-1 truncate font-mono text-[19px] font-semibold tracking-wide">{password || t("No password")}</dd>
        </div>
        {password && <CopyButton text={password} label={t("Copy the password")} />}
      </div>
    </dl>
  );
}

/**
 * THE WI-FI — opened from the Wi-Fi button while the guest stays (owner, 2026-10-06: shown when they tap it, not on the
 * page): the Wi-Fi name and the password, each to copy, how to join, and a code to join another device.
 */
function WifiPanel({ info }: { info: StayInfo }) {
  const t = useT();
  const [qr, setQr] = useState(false);
  const w = info.wifi;
  return (
    <>
      <SheetHead title="Wi-Fi" text={t("Free in your room and around the hotel.")} />
      {w?.network ? (
        <>
          <WifiRows network={w.network} password={w.password} className="mt-4 border-y border-(--vr-line)" />
          <p className="mt-3 text-[13px] leading-snug text-(--vr-muted)">
            {w.password
              ? t("Open your phone's Wi-Fi settings, choose {network} and paste the password.", { network: w.network })
              : t("Open your phone's Wi-Fi settings and choose {network}.", { network: w.network })}
          </p>
          <button type="button" onClick={() => setQr((v) => !v)} aria-expanded={qr}
            className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 text-left text-[13px] font-medium text-(--vr-gold-ink)">
            {qr ? t("Hide the code") : t("Connect another device — scan a code")}<ChevronRight className={cn("size-4 transition-transform", qr && "rotate-90")} />
          </button>
          {qr && (
            <div className="flex flex-col items-center gap-2 pb-2 pt-1">
              <div className="size-44 rounded-2xl bg-white p-3 ring-1 ring-(--vr-line)" role="img" aria-label={t("Wi-Fi code for {network}", { network: w.network })}
                dangerouslySetInnerHTML={{ __html: qrSvg(wifiCode(w.network, w.password), "#14110c", "M") }} />
              <p className="text-center text-[12.5px] text-(--vr-muted)">{t("Point the other phone's camera at it to join.")}</p>
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 border-y border-(--vr-line) py-3.5 text-[14px]">{t("Ask reception for the Wi-Fi password — they will be happy to help.")}</p>
      )}
    </>
  );
}

function ReceptionPanel({ contact }: { contact: HotelInfo }) {
  const t = useT();
  return (
    <>
      <SheetHead title={t("Reception")} text={<>{t("Here for you, day and night.")}{contact.phoneLabel && <> <span className="whitespace-nowrap font-medium text-(--vr-ink)">{contact.phoneLabel}</span></>}</>} />
      <ContactButtons info={contact} className="mt-4" />
      <HoursList hours={contact.hours} className="mt-3 border-t border-(--vr-line)" />
      {contact.address && (
        <p className="mt-1 flex items-start gap-2 border-t border-(--vr-line) pt-3 text-[13px] text-(--vr-muted)">
          <MapPin className="mt-0.5 size-4 shrink-0 text-(--vr-gold-ink)" />
          <span>{contact.address}{contact.mapHref && <> · <a href={contact.mapHref} target="_blank" rel="noopener" className="font-semibold text-(--vr-gold-ink) hover:underline">{t("Directions")}</a></>}</span>
        </p>
      )}
    </>
  );
}

/** Pay online for what is owed — the bill page's own payment (amount worked out on the server), in a sheet. */
function PayPanel({ pay }: { pay: NonNullable<StayInfo["pay"]> }) {
  const t = useT();
  return (
    <>
      <SheetHead title={t("Pay your bill")} text={t.rich("<b>{amount}</b> — what you owe right now, from your phone with mobile money.", { b: (c) => <strong className="font-semibold tabular-nums text-(--vr-ink)">{c}</strong> }, { amount: tzs(pay.due) })} />
      {/* The bill page's own form, without its card and title (the sheet is the card) */}
      <div className="mt-4">
        <BillPayOnline due={pay.due} live={pay.live} action={pay.action} bare />
      </div>
    </>
  );
}

/** After the menu: the hotel, compact — hours, reception, the address. */
export function StayBottom({ stay, info }: { stay: GuestStay; info: StayInfo }) {
  const t = useT();
  const place = info.meeting ? t("this meeting room") : t("Room {room}", { room: info.room });
  return (
    <HotelFooter info={info.contact}
      note={info.via === "room"
        ? t("This page shows the stay checked in to {place} right now.", { place })
        : t("Booking {reference} · this page is private to your booking — please don't share the link.", { reference: stay.reference })} />
  );
}
