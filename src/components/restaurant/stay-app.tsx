"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight, Bath, Building2, CalendarCheck, Check, ChevronLeft, ChevronRight, Clock, ConciergeBell, Copy, Images, Loader2, Mail, MapPin, MessageCircle, Phone, Receipt,
  SprayCan, UserRound, UtensilsCrossed, Wifi, Wrench, X,
} from "lucide-react";
import { GUEST_ASKS, GUEST_REQUEST_WORD, REQUEST_TYPE_LABEL, type GuestAskType } from "@/lib/request-meta";
import { askFromStayAction } from "@/app/stay/[token]/actions";
import { askFromRoomQrAction } from "@/app/r/[token]/actions";
import { cn } from "@/lib/utils";
import type { GuestStay } from "@/server/services/guest-comms";
import { Sheet } from "./restaurant-app";

/** What the stay page shows besides the booking itself — prepared on the server from the hotel settings. */
export type StayInfo = {
  hotel: string;
  billHref: string;
  /** "room": opened from the room's QR card. */
  via: "room" | null;
  room: string; types: string; nights: number; meeting: boolean; photo: string; fee: number;
  /** Their room type's photos (the first is `photo`), a line about it, bed, size and what it has. */
  photos: string[]; about: string | null; bed: string | null; size: number | null; amenities: string[];
  when: { inLabel: string; inTime: string; outLabel: string; outTime: string; outDate: string };
  callHref: string | null; waHref: string | null; phoneLabel: string | null;
  /** Only while the guest is staying. */
  wifi: { network: string | null; password: string | null } | null;
  hours: { label: string; value: string }[];
  address: string | null; mapHref: string | null;
  /** Where the guest's requests go (towels, cleaning…) — only while they are staying in a room. */
  ask: { kind: "stay" | "room"; token: string } | null;
};

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
/** "2026-09-28" → "28 Sept". */
const short = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
/** "HONEST" → "Honest" (names typed in capitals read better greeted normally). */
const nice = (n: string) => n.split(/\s+/).map((w) => (/^[A-Z]{2,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w)).join(" ");

const STATE: Record<string, { label: string; dot: string }> = {
  CHECKED_IN: { label: "Checked in", dot: "bg-emerald-400" },
  CONFIRMED: { label: "Confirmed", dot: "bg-emerald-400" },
  RESERVED: { label: "Reserved", dot: "bg-amber-400" },
  INQUIRY: { label: "Enquiry", dot: "bg-white/50" },
  CHECKED_OUT: { label: "Checked out", dot: "bg-white/50" },
  CANCELLED: { label: "Cancelled", dot: "bg-rose-400" },
  NO_SHOW: { label: "Not arrived", dot: "bg-rose-400" },
};
const ORDER_WORD: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "Received", tone: "bg-sky-100 text-sky-800" },
  ACCEPTED: { label: "Preparing", tone: "bg-amber-100 text-amber-800" },
  PREPARING: { label: "Preparing", tone: "bg-amber-100 text-amber-800" },
  READY: { label: "Ready", tone: "bg-emerald-100 text-emerald-800" },
  OUT_FOR_DELIVERY: { label: "On its way", tone: "bg-violet-100 text-violet-800" },
  DELIVERED: { label: "Delivered", tone: "bg-emerald-100 text-emerald-800" },
  COMPLETED: { label: "Delivered", tone: "bg-emerald-100 text-emerald-800" },
  COLLECTED: { label: "Collected", tone: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "Cancelled", tone: "bg-rose-100 text-rose-800" },
};

const card = "rounded-3xl bg-(--vr-card) p-4 ring-1 ring-(--vr-line) sm:p-5";
const caps = "text-[10.5px] font-semibold uppercase tracking-[0.2em] text-(--vr-muted)";

/**
 * The guest's stay, at the top of their page (their link or the room's QR): who and where, the
 * dates, one-tap shortcuts, the bill and their orders — then the menu to order from, right below.
 */
export function StayTop({ stay, info }: { stay: GuestStay; info: StayInfo }) {
  const [sheet, setSheet] = useState<"wifi" | "help" | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const photos = info.photos.length ? info.photos : [info.photo];
  const first = nice(stay.guestName.split(/\s+/)[0] ?? "");
  const inHouse = stay.status === "CHECKED_IN";
  const out = stay.status === "CHECKED_OUT";
  const st = STATE[stay.status] ?? STATE.RESERVED;
  const guests = info.meeting ? `${stay.adults} attendee${stay.adults === 1 ? "" : "s"}` : `${stay.adults} adult${stay.adults === 1 ? "" : "s"}${stay.children ? ` · ${stay.children} child${stay.children === 1 ? "" : "ren"}` : ""}`;
  const note = [
    !info.meeting && (info.nights ? `${info.nights} night${info.nights === 1 ? "" : "s"}` : "Day use"),
    guests,
    !info.meeting && (inHouse ? `out ${info.when.outTime}` : out ? null : `in ${info.when.inTime}`),
  ].filter(Boolean).join(" · ");
  const toMenu = () => document.getElementById("order")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const balance = stay.money?.balance ?? 0;

  const greeting = out ? "Thank you for staying" : inHouse ? `Welcome, ${first}` : info.meeting ? "Your meeting" : "Your booking";
  const title = inHouse && info.room ? (info.meeting ? `Meeting room ${info.room}` : `Room ${info.room}`) : out ? `Asante, ${first}` : `Hello, ${first}`;
  const accent = inHouse ? info.types : out ? "Karibu tena — come back soon" : [info.types, info.room && `Room ${info.room}`].filter(Boolean).join(" · ");

  return (
    <>
      {/* ── Who and where: a clean, compact welcome (big screens add a few small photos of the room) ── */}
      <section className="relative mt-3 overflow-hidden rounded-3xl bg-(--vr-dark) text-white sm:mt-4 lg:flex lg:items-center lg:gap-6 lg:p-5 lg:pl-8">
        <div aria-hidden className="absolute -left-10 -top-16 size-52 rounded-full bg-(--vr-gold)/10 blur-3xl" />
        <div className="relative min-w-0 flex-1 p-4 sm:p-6 lg:p-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90"><span className={cn("size-1.5 rounded-full", st.dot)} />{st.label}</span>
            <span className="text-[12.5px] font-medium text-(--vr-gold)">{greeting}</span>
          </div>
          <h1 className="mt-2 font-display text-[30px] font-semibold leading-[1.05] sm:text-[36px] lg:text-[40px]">
            {title}{accent && <span className="ml-2.5 align-middle font-display text-[17px] font-normal italic text-(--vr-gold) sm:text-[20px]">{accent}</span>}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="inline-flex max-w-full items-center gap-2 rounded-full bg-(--vr-gold) py-1 pl-1 pr-3 text-(--vr-ink)">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><CalendarCheck className="size-3.5" /></span>
              <span className="truncate text-[12.5px] font-semibold">{info.meeting ? `${short(stay.arrival)} · ${info.when.inTime}–${info.when.outTime}` : `${short(stay.arrival)} → ${short(info.when.outDate)}`}</span>
            </p>
            <p className="text-[11.5px] leading-snug text-white/60">{note}</p>
          </div>
          {/* What the room has — one quiet line on big screens */}
          {info.amenities.length > 0 && (
            <p className="mt-3 hidden items-center gap-1.5 text-[12px] text-white/55 lg:flex">
              <Check className="size-3.5 shrink-0 text-(--vr-gold)" strokeWidth={3} />
              <span className="truncate">{info.amenities.slice(0, 4).join(" · ")}{info.amenities.length > 4 ? ` · +${info.amenities.length - 4} more` : ""}</span>
            </p>
          )}
        </div>

        {/* Big screens: a small cluster — one photo, two beside it, all of them one tap away */}
        <div className="relative hidden shrink-0 gap-2 lg:flex">
          <button type="button" onClick={() => setViewing(0)} aria-label="Photos of your room" className="group relative h-[148px] w-[210px] overflow-hidden rounded-2xl ring-1 ring-white/10">
            <Image src={photos[0]} alt="" fill sizes="210px" className="object-cover transition duration-700 group-hover:scale-[1.05]" preload />
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium backdrop-blur-md"><Images className="size-3" />{photos.length > 1 ? `${photos.length} photos` : "View"}</span>
          </button>
          {photos.length > 1 && (
            <div className="flex w-[104px] flex-col gap-2">
              {photos.slice(1, 3).map((src, k) => (
                <button key={src} type="button" onClick={() => setViewing(k + 1)} aria-label={`Photo ${k + 2} of your room`} className="group relative h-[70px] overflow-hidden rounded-xl ring-1 ring-white/10">
                  <Image src={src} alt="" fill sizes="104px" className="object-cover transition duration-700 group-hover:scale-[1.06]" />
                  {k === 1 && photos.length > 3 && <span className="absolute inset-0 grid place-items-center bg-black/50 text-[15px] font-semibold">+{photos.length - 3}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      <PhotoViewer photos={photos} start={viewing} title={title} onClose={() => setViewing(null)} />

      {/* ── One tap ── */}
      <nav aria-label="Shortcuts" className="mt-3 grid grid-cols-4 gap-2 sm:gap-3">
        <Shortcut primary icon={UtensilsCrossed} label={stay.canOrder ? "Order food" : "Menu"} sub={stay.canOrder ? (info.meeting ? "To your meeting room" : "To your room") : "See what we serve"} onClick={toMenu} />
        <Shortcut icon={Receipt} label="My bill" sub={stay.money ? (balance > 0 ? `${tzs(balance)} to pay` : "Paid in full") : "Print or download"} href={info.billHref} />
        {info.wifi
          ? <Shortcut icon={Wifi} label="Wi-Fi" sub={info.wifi.network ?? "Ask reception"} onClick={() => setSheet("wifi")} />
          : info.mapHref
            ? <Shortcut icon={MapPin} label="Directions" sub="Find the hotel" href={info.mapHref} external />
            : <Shortcut icon={Clock} label="Hours" sub="Restaurant & bar" onClick={() => setSheet("help")} />}
        <Shortcut icon={ConciergeBell} label={info.ask ? "Ask us" : "Reception"} sub={info.ask ? "Towels, cleaning, help" : info.phoneLabel ?? "Here to help"} onClick={() => setSheet("help")} />
      </nav>

      {/* ── The bill and the orders ── */}
      <div className={cn("mt-3 grid gap-3", stay.orders.length > 0 && "lg:grid-cols-2")}>
        <BillCard stay={stay} info={info} />
        {stay.orders.length > 0 && <OrdersCard orders={stay.orders} />}
      </div>

      {/* ── The menu starts here ── */}
      <div id="order" className="mt-8 scroll-mt-3 lg:mt-10">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-(--vr-gold-ink)">Restaurant & bar</p>
        <h2 className="mt-1 font-display text-[28px] font-semibold leading-none sm:text-[32px]">{stay.canOrder ? "Order food & drinks" : "Our menu"}</h2>
        <p className="mt-1.5 text-[13px] text-(--vr-muted)">
          {stay.canOrder
            ? info.meeting ? "Served in your meeting room and added to its bill." : `Delivered to Room ${info.room} and added to your room bill · delivery ${tzs(info.fee)}.`
            : out ? "We hope to serve you again soon." : "You can order to your room as soon as you have checked in."}
        </p>
      </div>

      {/* ── Wi-Fi, reception ── */}
      <Sheet open={sheet !== null} onClose={() => setSheet(null)} label={sheet === "wifi" ? "Wi-Fi" : "Reception"}>
        <div className="flex px-4 pt-[max(0.9rem,env(safe-area-inset-top))] sm:justify-end sm:pt-4">
          <button type="button" onClick={() => setSheet(null)} aria-label="Back" className="grid size-10 place-items-center rounded-full bg-(--vr-bg) hover:bg-(--vr-line) sm:size-8">
            <ChevronLeft className="size-5 sm:hidden" /><X className="hidden size-4 sm:block" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-7 sm:pb-7">
          {sheet === "wifi" ? <WifiPanel info={info} /> : <HelpPanel info={info} requests={stay.requests} />}
        </div>
      </Sheet>
    </>
  );
}

function Shortcut({ icon: Icon, label, sub, primary, onClick, href, external }: {
  icon: typeof Wifi; label: string; sub: string; primary?: boolean; onClick?: () => void; href?: string; external?: boolean;
}) {
  const cls = cn("group flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl px-1 py-2.5 text-center transition active:scale-[0.97] sm:flex-row sm:justify-start sm:gap-3 sm:px-4 sm:py-3.5 sm:text-left",
    primary ? "bg-(--vr-gold) text-(--vr-ink) shadow-[0_14px_28px_-18px_rgba(160,120,40,0.9)] hover:brightness-105" : "bg-(--vr-card) ring-1 ring-(--vr-line) hover:ring-(--vr-gold)");
  const inner = (
    <>
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full sm:size-10", primary ? "bg-(--vr-dark) text-(--vr-gold)" : "bg-(--vr-gold-soft) text-(--vr-gold-ink)")}><Icon className="size-[17px]" /></span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12px] font-semibold sm:text-[14px]">{label}</span>
        <span className={cn("hidden truncate text-[11.5px] sm:block", primary ? "text-(--vr-ink)/70" : "text-(--vr-muted)")}>{sub}</span>
      </span>
    </>
  );
  if (href) return external ? <a href={href} target="_blank" rel="noopener" className={cls}>{inner}</a> : <Link href={href} className={cls}>{inner}</Link>;
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

function BillCard({ stay, info }: { stay: GuestStay; info: StayInfo }) {
  const [open, setOpen] = useState(false);
  const m = stay.money;
  const share = m && m.total > 0 ? Math.min(100, Math.round((m.paid / m.total) * 100)) : 0;
  return (
    <section aria-label="Your bill" className={card}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[21px] font-semibold leading-none">Your bill</h2>
        {m && m.total > 0 && <span className="text-[11.5px] text-(--vr-muted)">{share}% paid</span>}
      </div>
      {m && m.total > 0 ? (
        <>
          <div className="mt-3.5 flex items-end justify-between gap-3">
            <div>
              <p className={caps}>{m.balance > 0 ? "To pay" : "Balance"}</p>
              <p className={cn("mt-0.5 text-[24px] font-semibold leading-none tabular-nums", m.balance > 0 ? "text-(--vr-ink)" : "text-emerald-700")}>{m.balance > 0 ? tzs(m.balance) : "Paid in full"}</p>
            </div>
            <div className="text-right">
              <p className={caps}>Total</p>
              <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{tzs(m.total)}</p>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-(--vr-line)"><div className="h-full rounded-full bg-(--vr-gold)" style={{ width: `${share}%` }} /></div>
          <p className="mt-1.5 text-[11.5px] text-(--vr-muted)">Paid so far {tzs(m.paid)} · settled at check-out</p>
          {open && (
            <ul className="mt-3 space-y-1.5 border-t border-(--vr-line) pt-3 text-[13px]">
              {m.lines.map((l) => (
                <li key={l.label} className="flex justify-between gap-3"><span className="text-(--vr-muted)">{l.label}</span><span className="tabular-nums">{l.amount < 0 ? "− " : ""}{tzs(Math.abs(l.amount))}</span></li>
              ))}
            </ul>
          )}
          <div className="mt-3.5 flex gap-2">
            <button type="button" onClick={() => setOpen((v) => !v)} className="h-10 shrink-0 rounded-full px-4 text-[12.5px] font-semibold ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold)">{open ? "Hide details" : "Details"}</button>
            <Link href={info.billHref} className="flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-(--vr-dark) px-4 text-[12.5px] font-semibold text-white transition hover:bg-black">
              <Receipt className="size-4 shrink-0 text-(--vr-gold)" /><span className="truncate">Full bill — print or download</span>
            </Link>
          </div>
        </>
      ) : stay.payer ? (
        <p className="mt-3 text-[13.5px] leading-relaxed">Paid by <strong className="font-semibold">{stay.payer}</strong>. Food, drinks and extras you order are added to it.</p>
      ) : (
        <p className="mt-3 text-[13.5px] text-(--vr-muted)">Nothing on your bill yet.</p>
      )}
    </section>
  );
}

function OrdersCard({ orders }: { orders: GuestStay["orders"] }) {
  return (
    <section aria-label="Your orders" className={card}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[21px] font-semibold leading-none">Your orders</h2>
        <span className="text-[11.5px] text-(--vr-muted)">Tap one to follow it</span>
      </div>
      <ul className="mt-2 divide-y divide-(--vr-line)">
        {orders.slice(0, 4).map((o) => {
          const w = ORDER_WORD[o.status] ?? { label: o.status, tone: "bg-(--vr-bg) text-(--vr-muted)" };
          const inner = (
            <>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-(--vr-bg) text-[12px] font-bold tabular-nums">#{o.number.replace(/^ORD-\d{4}-0*/, "")}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13.5px] font-medium">{o.items.join(", ")}</span>
                <span className="text-[12px] tabular-nums text-(--vr-muted)">{tzs(o.total)}</span>
              </span>
              <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", w.tone)}>{w.label}</span>
            </>
          );
          return (
            <li key={o.number}>
              {o.track
                ? <Link href={`/order/${o.track}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-(--vr-bg)">{inner}</Link>
                : <div className="flex items-center gap-3 py-2.5">{inner}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }).catch(() => {}); }}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-(--vr-dark) px-4 text-[12.5px] font-semibold text-white">
      {done ? <Check className="size-4 text-(--vr-gold)" /> : <Copy className="size-4 text-(--vr-gold)" />}{done ? "Copied" : "Copy"}
    </button>
  );
}

function WifiPanel({ info }: { info: StayInfo }) {
  return (
    <>
      <span className="grid size-14 place-items-center rounded-full bg-(--vr-gold-soft) text-(--vr-gold-ink)"><Wifi className="size-7" /></span>
      <h2 className="mt-4 font-display text-[28px] font-semibold leading-none">Wi-Fi</h2>
      <p className="mt-1.5 text-[13.5px] text-(--vr-muted)">Free for guests, in your room and around the hotel.</p>
      {info.wifi?.network ? (
        <div className="mt-5 space-y-2.5">
          <div className="rounded-2xl bg-(--vr-bg) p-4 ring-1 ring-(--vr-line)">
            <p className={caps}>Network</p>
            <p className="mt-1 text-[17px] font-semibold">{info.wifi.network}</p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-(--vr-bg) p-4 ring-1 ring-(--vr-line)">
            <div className="min-w-0 flex-1">
              <p className={caps}>Password</p>
              <p className="mt-1 truncate font-mono text-[18px] font-semibold tracking-wide">{info.wifi.password || "No password"}</p>
            </div>
            {info.wifi.password && <CopyButton text={info.wifi.password} />}
          </div>
        </div>
      ) : (
        <p className="mt-5 rounded-2xl bg-(--vr-bg) p-4 text-[14px] ring-1 ring-(--vr-line)">Ask reception for the Wi-Fi password — they will be happy to help.</p>
      )}
      {info.hours.length > 0 && <Hours hours={info.hours} />}
    </>
  );
}

function HelpPanel({ info, requests }: { info: StayInfo; requests: GuestStay["requests"] }) {
  return (
    <>
      <span className="grid size-14 place-items-center rounded-full bg-(--vr-gold-soft) text-(--vr-gold-ink)"><ConciergeBell className="size-7" /></span>
      <h2 className="mt-4 font-display text-[28px] font-semibold leading-none">Need anything?</h2>
      <p className="mt-1.5 text-[13.5px] text-(--vr-muted)">{info.ask ? "Ask here and reception takes care of it — or call us, day and night." : "Reception is here for you, day and night."} {info.phoneLabel && <span className="whitespace-nowrap font-medium text-(--vr-ink)">{info.phoneLabel}</span>}</p>
      {info.ask && <AskPanel ask={info.ask} requests={requests} />}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {info.callHref && <a href={info.callHref} className="flex h-12 items-center justify-center gap-2 rounded-full bg-(--vr-dark) text-[14px] font-semibold text-white"><Phone className="size-4 text-(--vr-gold)" />Call</a>}
        {info.waHref && <a href={info.waHref} target="_blank" rel="noopener" className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#25D366] text-[14px] font-semibold text-[#073b1f]"><MessageCircle className="size-4" />WhatsApp</a>}
      </div>
      {info.address && (
        <a href={info.mapHref ?? undefined} target={info.mapHref ? "_blank" : undefined} rel="noopener" className="mt-2.5 flex items-start gap-3 rounded-2xl bg-(--vr-bg) p-4 ring-1 ring-(--vr-line)">
          <MapPin className="mt-0.5 size-4 shrink-0 text-(--vr-gold-ink)" />
          <span className="text-[13.5px]">{info.address}{info.mapHref && <span className="mt-0.5 block text-[12px] font-semibold text-(--vr-gold-ink)">Get directions →</span>}</span>
        </a>
      )}
      {info.hours.length > 0 && <Hours hours={info.hours} />}
    </>
  );
}

const ASK_ICON: Record<GuestAskType, typeof Bath> = { TOWELS: Bath, CLEANING: SprayCan, MAINTENANCE: Wrench, GENERAL: MessageCircle };
const REQ_TONE: Record<string, string> = { NEW: "bg-sky-100 text-sky-800", ASSIGNED: "bg-sky-100 text-sky-800", IN_PROGRESS: "bg-amber-100 text-amber-800", COMPLETED: "bg-emerald-100 text-emerald-800", CANCELLED: "bg-rose-100 text-rose-800" };
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Ask reception from the phone: tap what you need, add a word, send — then see it go from Received to On it to Done. */
function AskPanel({ ask, requests }: { ask: NonNullable<StayInfo["ask"]>; requests: GuestStay["requests"] }) {
  const router = useRouter();
  const [type, setType] = useState<GuestAskType | null>(null);
  const [note, setNote] = useState("");
  const [key, setKey] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (t: GuestAskType) => { setType(t); setKey(newKey()); setSent(null); setError(null); };
  const send = () => type && start(async () => {
    const input = { token: ask.token, type, description: note.trim() || undefined, clientKey: key };
    const r = ask.kind === "room" ? await askFromRoomQrAction(input) : await askFromStayAction(input);
    if (!r.ok) { setError(r.error); return; }
    setSent(GUEST_ASKS.find((a) => a.type === type)?.label ?? "Your request");
    setType(null); setNote("");
    router.refresh();
  });
  const chosen = GUEST_ASKS.find((a) => a.type === type);
  return (
    <div className="mt-5">
      <p className={caps}>Ask reception</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {GUEST_ASKS.map((a) => {
          const Icon = ASK_ICON[a.type];
          const on = type === a.type;
          return (
            <button key={a.type} type="button" onClick={() => pick(a.type)} aria-pressed={on}
              className={cn("flex items-start gap-2.5 rounded-2xl p-3 text-left ring-1 transition", on ? "bg-(--vr-dark) text-white ring-(--vr-dark)" : "bg-(--vr-bg) ring-(--vr-line) hover:ring-(--vr-gold)")}>
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", on ? "bg-(--vr-gold) text-(--vr-ink)" : "bg-(--vr-gold-soft) text-(--vr-gold-ink)")}><Icon className="size-4" /></span>
              <span className="min-w-0 leading-tight">
                <span className="block text-[13.5px] font-semibold">{a.label}</span>
                <span className={cn("mt-0.5 block text-[11.5px]", on ? "text-white/60" : "text-(--vr-muted)")}>{a.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {chosen && (
        <div className="mt-2.5 rounded-2xl bg-(--vr-bg) p-3 ring-1 ring-(--vr-line)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} autoFocus
            placeholder={chosen.type === "GENERAL" ? "What do you need?" : "Anything to add? (optional)"}
            className="w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-(--vr-muted)" />
          {error && <p className="mb-2 text-[12.5px] font-medium text-rose-700">{error}</p>}
          <button type="button" onClick={send} disabled={pending || (chosen.type === "GENERAL" && note.trim().length < 2)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-(--vr-dark) text-[14px] font-semibold text-white disabled:opacity-50">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ConciergeBell className="size-4 text-(--vr-gold)" />}Send to reception
          </button>
        </div>
      )}
      {sent && !chosen && (
        <p className="mt-2.5 flex items-center gap-2 rounded-2xl bg-emerald-50 px-3.5 py-3 text-[13px] text-emerald-900 ring-1 ring-emerald-200">
          <Check className="size-4 shrink-0" strokeWidth={3} />{sent} — sent. Reception has it and will be with you soon.
        </p>
      )}
      {requests.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {requests.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-3 rounded-xl px-1 text-[13px]">
              <span className="min-w-0 truncate"><span className="font-medium">{REQUEST_TYPE_LABEL[q.type] ?? "Request"}</span> <span className="text-(--vr-muted)">· {new Date(q.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span></span>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", REQ_TONE[q.status] ?? REQ_TONE.NEW)}>{GUEST_REQUEST_WORD[q.status] ?? "Received"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Hours({ hours }: { hours: StayInfo["hours"] }) {
  return (
    <div className="mt-5">
      <p className={caps}>Opening hours</p>
      <ul className="mt-2 grid grid-cols-2 gap-2">
        {hours.map((h) => (
          <li key={h.label} className="rounded-2xl bg-(--vr-bg) px-3.5 py-2.5 ring-1 ring-(--vr-line)">
            <span className="block text-[11px] text-(--vr-muted)">{h.label}</span>
            <span className="block truncate text-[13.5px] font-semibold">{h.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const EXPLORE = [
  { href: "/rooms", title: "Rooms & suites", text: "See every room", image: "/images/room-red/room-red-05.webp" },
  { href: "/gallery", title: "Gallery", text: "Around the hotel", image: "/images/lobby/lobby-02.webp" },
  { href: "/restaurant", title: "Restaurant", text: "Breakfast to dinner", image: "/images/illustrative/restaurant-warm.webp" },
  { href: "/bar", title: "Bar & lounge", text: "Evening drinks", image: "/images/illustrative/bar-counter.webp" },
  { href: "/meeting-room", title: "Meeting room", text: "For your team", image: "/images/illustrative/meeting-room.webp" },
  { href: "/transport", title: "Airport transfer", text: "To and from the airport", image: "/images/illustrative/dar-city-aerial.webp" },
] as const;

/** After the menu: their details, help, and the rest of the hotel. */
export function StayBottom({ stay, info }: { stay: GuestStay; info: StayInfo }) {
  const details: [typeof UserRound, string, string][] = [
    [UserRound, "Guest", nice(stay.guestName)],
    ...(stay.company ? [[Building2, "Company", stay.company] as [typeof UserRound, string, string]] : []),
    ...(stay.phone ? [[Phone, "Phone", stay.phone] as [typeof UserRound, string, string]] : []),
    ...(stay.email ? [[Mail, "Email", stay.email] as [typeof UserRound, string, string]] : []),
    [CalendarCheck, "Booking", stay.reference],
  ];
  return (
    <div className="mt-12 lg:mt-16">
      <div className="grid gap-3 md:grid-cols-2">
        <section aria-label="Your details" className={card}>
          <h2 className="font-display text-[21px] font-semibold leading-none">Your details</h2>
          <ul className="mt-3 space-y-2.5">
            {details.map(([Icon, label, value]) => (
              <li key={label} className="flex items-center gap-3 text-[13.5px]">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-(--vr-bg) text-(--vr-gold-ink)"><Icon className="size-4" /></span>
                <span className="w-16 shrink-0 text-[12px] text-(--vr-muted)">{label}</span>
                <span className={cn("min-w-0 truncate font-medium", label === "Booking" && "font-mono tracking-wide")}>{value}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Need anything?" className={card}>
          <h2 className="font-display text-[21px] font-semibold leading-none">Need anything?</h2>
          <p className="mt-1.5 text-[13px] text-(--vr-muted)">Reception is here for you, day and night. {info.phoneLabel && <span className="whitespace-nowrap font-medium text-(--vr-ink)">{info.phoneLabel}</span>}</p>
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            {info.callHref && <a href={info.callHref} className="flex h-11 items-center justify-center gap-2 rounded-full bg-(--vr-dark) text-[13.5px] font-semibold text-white"><Phone className="size-4 text-(--vr-gold)" />Call</a>}
            {info.waHref && <a href={info.waHref} target="_blank" rel="noopener" className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#25D366] text-[13.5px] font-semibold text-[#073b1f]"><MessageCircle className="size-4" />WhatsApp</a>}
          </div>
          {info.address && (
            <a href={info.mapHref ?? undefined} target={info.mapHref ? "_blank" : undefined} rel="noopener" className="mt-2.5 flex items-start gap-2.5 rounded-2xl bg-(--vr-bg) p-3 text-[13px] ring-1 ring-(--vr-line)">
              <MapPin className="mt-0.5 size-4 shrink-0 text-(--vr-gold-ink)" />
              <span>{info.address}{info.mapHref && <span className="mt-0.5 block text-[12px] font-semibold text-(--vr-gold-ink)">Get directions →</span>}</span>
            </a>
          )}
        </section>
      </div>

      <section aria-label="Explore the hotel" className="mt-10">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-(--vr-gold-ink)">Discover more</p>
            <h2 className="mt-1 font-display text-[26px] font-semibold leading-none sm:text-[30px]">Explore {info.hotel}</h2>
          </div>
          <Link href="/" className="hidden shrink-0 items-center gap-1 text-[13px] font-medium text-(--vr-gold-ink) hover:underline sm:inline-flex">Our website<ArrowUpRight className="size-4" /></Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {EXPLORE.map((e) => (
            <Link key={e.href} href={e.href} className="group overflow-hidden rounded-2xl bg-(--vr-card) ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold)">
              <span className="relative block aspect-[4/3] overflow-hidden bg-(--vr-line)">
                <Image src={e.image} alt="" fill sizes="(min-width:1280px) 240px, (min-width:640px) 30vw, 50vw" className="object-cover transition duration-700 group-hover:scale-105" />
              </span>
              <span className="block p-3">
                <span className="flex items-center gap-1 text-[13.5px] font-semibold">{e.title}<ArrowUpRight className="size-3.5 text-(--vr-muted) transition group-hover:text-(--vr-gold-ink)" /></span>
                <span className="block truncate text-[11.5px] text-(--vr-muted)">{e.text}</span>
              </span>
            </Link>
          ))}
        </div>
        <Link href="/book" className="mt-3 flex items-center justify-between gap-3 rounded-3xl bg-(--vr-dark) p-4 text-white transition hover:bg-black sm:p-5">
          <span className="flex items-center gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-(--vr-gold) text-(--vr-ink)"><CalendarCheck className="size-5" /></span>
            <span className="leading-tight"><span className="block text-[15px] font-semibold">Book your next stay</span><span className="text-[12.5px] text-white/60">Best rates when you book with us directly</span></span>
          </span>
          <ArrowUpRight className="size-5 shrink-0 text-(--vr-gold)" />
        </Link>
      </section>

      <p className="mt-8 text-center text-[11.5px] text-(--vr-muted)">
        {info.via === "room" ? `This page shows the stay checked in to ${info.meeting ? "this meeting room" : `Room ${info.room}`} right now.` : "This page is private to your booking — please don't share the link."}
      </p>
    </div>
  );
}

/** The room's photos, full screen: swipe or use the arrows, Escape closes. */
function PhotoViewer({ photos, start, title, onClose }: { photos: string[]; start: number | null; title: string; onClose: () => void }) {
  return (
    <AnimatePresence>
      {start !== null && <Viewer key={start} photos={photos} start={start} title={title} onClose={onClose} />}
    </AnimatePresence>
  );
}
function Viewer({ photos, start, title, onClose }: { photos: string[]; start: number; title: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const touch = useRef<number | null>(null);
  const go = (d: number) => setI((x) => (x + d + photos.length) % photos.length);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") setI((x) => (x + 1) % photos.length); if (e.key === "ArrowLeft") setI((x) => (x - 1 + photos.length) % photos.length); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose, photos.length]);
  return (
    <motion.div role="dialog" aria-modal="true" aria-label={`${title} — photos`} className="fixed inset-0 z-[70] flex flex-col bg-[#0c0a08] text-white"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-6">
        <p className="font-display text-[20px]">{title} <span className="ml-2 font-sans text-[12px] text-white/55">{i + 1} / {photos.length}</span></p>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X className="size-5" /></button>
      </div>
      <div className="relative min-h-0 flex-1" onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); touch.current = null; }}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div key={photos[i]} className="absolute inset-0 mx-auto max-w-6xl px-2 sm:px-16" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <div className="relative size-full"><Image src={photos[i]} alt={`${title} — photo ${i + 1}`} fill sizes="100vw" className="object-contain" priority /></div>
          </motion.div>
        </AnimatePresence>
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:grid"><ChevronLeft className="size-5" /></button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 hover:bg-white/20 sm:grid"><ChevronRight className="size-5" /></button>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 [scrollbar-width:none]">
          {photos.map((src, k) => (
            <button key={src} type="button" onClick={() => setI(k)} aria-label={`Photo ${k + 1}`} aria-current={k === i || undefined}
              className={cn("relative h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 transition", k === i ? "ring-(--vr-gold)" : "opacity-55 ring-transparent hover:opacity-90")}>
              <Image src={src} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
