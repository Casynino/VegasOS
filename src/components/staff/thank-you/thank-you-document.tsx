import Image from "next/image";
import QRCode from "qrcode";
import { BedDouble, Car, CheckCircle2, Coffee, Globe, Mail, MapPin, Phone, Presentation, UtensilsCrossed, Wine } from "lucide-react";
import { formatBusinessDate, formatNumber } from "@/lib/format";
import { THANK_YOU_DEFAULTS, type StaySnapshot } from "@/lib/thank-you";
import { cn } from "@/lib/utils";
import type { HotelSettings } from "@/generated/prisma/client";

const n = (v: number) => formatNumber(v);
const TZ = "Africa/Dar_es_Salaam";
const at = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(iso)) : null);
const firstName = (name: string) => name.trim().split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "") || name;
const websiteUrl = (w: string | null) => (w ? (/^https?:\/\//.test(w) ? w : `https://${w}`) : null);

const SERVICES = [
  { icon: BedDouble, label: "Comfortable rooms" },
  { icon: UtensilsCrossed, label: "Restaurant" },
  { icon: Wine, label: "Bar & lounge" },
  { icon: Coffee, label: "Room service" },
  { icon: Presentation, label: "Meeting room" },
  { icon: Car, label: "Airport transfers" },
];

/**
 * The thank-you note a guest takes home at check-out: a warm message, their
 * stay, what the stay came to and how it was settled, and an invitation to
 * come back. Built from the saved snapshot of the finished stay — the same
 * document on screen, on paper (A4) and as a PDF.
 */
export async function ThankYouDocument({ note, s, preparedAt }: { note: StaySnapshot; s: HotelSettings; preparedAt: Date }) {
  const site = websiteUrl(s.website);
  const qr = site ? await QRCode.toString(site, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#15110c", light: "#00000000" } }) : null;
  const message = (s.thankYouMessage || THANK_YOU_DEFAULTS.message).split(/\n{2,}/);
  const signoff = s.thankYouSignoff || THANK_YOU_DEFAULTS.signoff.replace("Vegas Luxury Hotel", s.hotelName);
  const room = note.rooms[0];
  const rate = room ? room.rate : 0;
  const lines = ([
    ["Room", note.charges.room, room ? (room.dayUse ? "Short stay" : `${note.nights} night${note.nights === 1 ? "" : "s"} × ${n(rate)}`) : ""],
    ["Restaurant", note.charges.restaurant, "Food during your stay"],
    ["Bar", note.charges.bar, "Drinks during your stay"],
    ["Room service", note.charges.roomService, "Delivered to your room"],
    ["Transport", note.charges.transport, "Airport & hotel transport"],
    ["Other services", note.charges.other, "Additional hotel services"],
  ] as const).filter(([, v], i) => i === 0 || v !== 0);
  const settled = note.balance <= 0;
  const address = [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", ");
  const reveal = "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-700 print:animate-none";

  return (
    <article className="thank-you-sheet relative mx-auto w-full max-w-[860px] overflow-hidden rounded-[28px] bg-[#fbf8f2] text-[#1d1a16] shadow-[0_2px_6px_rgba(15,23,42,0.05),0_40px_90px_-40px_rgba(15,23,42,0.6)] print:max-w-none print:rounded-none print:shadow-none"
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
      {/* Hero */}
      <header className="relative h-[300px] overflow-hidden bg-[#15110c] sm:h-[340px] print:h-[300px]">
        <Image src="/images/exterior/exterior-01.webp" alt={`${s.hotelName}`} fill priority sizes="(max-width: 900px) 100vw, 860px" className="object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#15110c] via-[#15110c]/65 to-[#15110c]/25" />
        <div className="relative flex items-start justify-between gap-4 px-7 pt-6 sm:px-10">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.08] ring-1 ring-white/15 backdrop-blur-sm"><Image src="/brand/logo-192.png" alt="" width={40} height={40} /></span>
            <div className="leading-tight text-white">
              <p className="font-display text-xl font-semibold tracking-tight">{s.hotelName}</p>
              {s.tagline && <p className="text-[10px] uppercase tracking-[0.24em] text-[#f0cf86]/85">{s.tagline}</p>}
            </div>
          </div>
          <p className="rounded-full bg-white/[0.08] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/80 ring-1 ring-white/15 backdrop-blur-sm">Guest departure</p>
        </div>
        <div className={cn("absolute inset-x-7 bottom-7 sm:inset-x-10", reveal)}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[#f0cf86]">With our warmest thanks</p>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-[3.25rem]">Thank you, {firstName(note.guest.name)}.</h1>
          <p className="mt-2 max-w-xl text-sm text-white/75">Thank you for choosing {s.hotelName}. It was a pleasure to have you with us.</p>
        </div>
      </header>
      <div className="h-1 bg-gradient-to-r from-[#8a6a25] via-[#f0cf86] to-[#8a6a25]" />

      <div className="space-y-7 px-7 py-8 sm:px-10">
        {/* Message + the stay at a glance */}
        <section className={cn("grid gap-6 sm:grid-cols-[1.25fr_1fr]", reveal)}>
          <div className="space-y-3">
            {message.map((p, i) => <p key={i} className="font-display text-[1.05rem] leading-relaxed text-[#3a332b]">{p}</p>)}
            <p className="whitespace-pre-line pt-1 text-sm font-medium text-[#6b5320]">{signoff}</p>
          </div>
          <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3 rounded-2xl border border-[#eadfca] bg-white/70 p-5 text-sm">
            <Fact k="Guest" v={note.guest.name} wide />
            <Fact k="Reservation" v={note.reference} mono />
            <Fact k="Guests" v={`${note.guests}`} />
            <Fact k={note.rooms.length > 1 ? "Rooms" : "Room"} v={note.rooms.map((r) => r.number).join(", ") || "—"} />
            <Fact k="Room type" v={[...new Set(note.rooms.map((r) => r.type))].join(", ") || "—"} />
            {note.group && <Fact k="Group" v={note.group.name} wide />}
            {!note.group && note.company && <Fact k="Company" v={note.company} wide />}
          </dl>
        </section>

        {/* Your stay */}
        <section className={cn("break-inside-avoid", reveal)}>
          <Heading>Your stay</Heading>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card label="Check-in" value={at(note.checkedInAt) ?? formatBusinessDate(note.arrival, true)} />
            <Card label="Check-out" value={at(note.checkedOutAt) ?? formatBusinessDate(note.departure, true)} />
            <Card label="Length of stay" value={room?.dayUse && note.nights === 0 ? "Short stay" : `${note.nights} night${note.nights === 1 ? "" : "s"}`}
              sub={room ? `${room.type}${rate ? ` · ${s.currency} ${n(rate)} a night` : ""}` : undefined} />
          </div>
        </section>

        {/* Summary of charges */}
        <section className={cn("break-inside-avoid", reveal)}>
          <Heading>Summary of your stay</Heading>
          <div className="overflow-hidden rounded-2xl border border-[#eadfca] bg-white/70">
            <dl className="divide-y divide-[#efe7da] text-sm">
              {lines.map(([k, v, hint]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
                  <dt><span className="font-medium">{k}</span>{hint && <span className="ml-2 text-xs text-[#8a8177]">{hint}</span>}</dt>
                  <dd className="tabular-nums">{n(v)}</dd>
                </div>
              ))}
            </dl>
            <dl className="space-y-1.5 border-t border-[#eadfca] bg-[#f6efe2]/70 px-5 py-4 text-sm">
              <Row k="Subtotal" v={n(note.subtotal)} />
              {note.discount > 0 && <Row k="Discount" v={`− ${n(note.discount)}`} tone="text-emerald-700" />}
              {note.adjustments !== 0 && <Row k="Other adjustments" v={`${note.adjustments < 0 ? "− " : "+ "}${n(Math.abs(note.adjustments))}`} />}
              <Row k="Total stay value" v={`${s.currency} ${n(note.total)}`} strong />
              <Row k="Amount paid" v={n(note.paid)} />
              {note.billedTo && <Row k={`Settled by ${note.billedTo.name}`} v={n(note.billedTo.amount)} />}
            </dl>
            <div className={cn("flex items-center justify-between gap-3 px-5 py-4", settled ? "bg-[#15110c] text-white" : "bg-rose-50 text-rose-800")}>
              <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em]">
                {settled ? <><CheckCircle2 className="size-5 text-[#f0cf86]" />{note.billedTo && note.paid === 0 ? `Settled by ${note.billedTo.name}` : "Paid in full"}</> : "Balance"}
              </span>
              <span className="text-right leading-none"><span className="mr-1 text-xs opacity-60">{s.currency}</span><span className="text-2xl font-semibold tabular-nums">{n(note.balance)}</span></span>
            </div>
          </div>
        </section>

        {/* Welcome back */}
        <section className={cn("break-inside-avoid overflow-hidden rounded-3xl bg-[#15110c] text-white", reveal)}>
          <div className="grid gap-6 p-6 sm:grid-cols-[1fr_auto] sm:p-7">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#f0cf86]">{s.hotelName}</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">{s.thankYouPromoTitle || THANK_YOU_DEFAULTS.promoTitle}</h2>
              <p className="mt-2 max-w-md text-sm text-white/70">{s.thankYouPromoText || THANK_YOU_DEFAULTS.promoText}</p>
              <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SERVICES.map(({ icon: I, label }) => (
                  <li key={label} className="flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-xs ring-1 ring-white/10"><I className="size-4 text-[#f0cf86]" />{label}</li>
                ))}
              </ul>
              <p className="mt-5 text-sm text-white/85">{s.thankYouRebookText || THANK_YOU_DEFAULTS.rebookText}</p>
              {s.website && <p className="mt-1 text-base font-semibold text-[#f0cf86]">{s.website.replace(/^https?:\/\//, "")}</p>}
            </div>
            {qr && (
              <div className="flex flex-col items-center justify-center gap-2 self-center rounded-2xl bg-[#fbf8f2] p-4 text-center text-[#1d1a16]">
                <span className="block size-[108px] [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
                <span className="text-[11px] font-medium leading-tight text-[#6b5320]">Scan to book<br />your next stay</span>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#eadfca] bg-[#f6efe2] px-7 py-5 text-xs text-[#5b534a] sm:px-10">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {address && <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5 text-[#9a7a35]" />{address}</span>}
          {s.phone && <span className="inline-flex items-center gap-1.5"><Phone className="size-3.5 text-[#9a7a35]" />{s.phone}</span>}
          {s.email && <span className="inline-flex items-center gap-1.5"><Mail className="size-3.5 text-[#9a7a35]" />{s.email}</span>}
          {s.website && <span className="inline-flex items-center gap-1.5"><Globe className="size-3.5 text-[#9a7a35]" />{s.website}</span>}
          {s.instagramUrl && <span>Instagram · {s.instagramUrl.replace(/^https?:\/\/(www\.)?instagram\.com\//, "@").replace(/\/$/, "")}</span>}
          {s.facebookUrl && <span>Facebook · {s.facebookUrl.replace(/^https?:\/\/(www\.)?facebook\.com\//, "").replace(/\/$/, "")}</span>}
        </div>
        <p className="mt-2 text-[10px] text-[#8a8177]">Prepared {at(preparedAt.toISOString())} · reservation {note.reference}. Thank you for staying with us.</p>
      </footer>
    </article>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#9a7a35]">{children}<span className="h-px flex-1 bg-[#eadfca]" /></h2>;
}

function Fact({ k, v, mono, wide }: { k: string; v: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a8177]">{k}</dt>
      <dd className={cn("mt-0.5 truncate font-semibold", mono && "font-mono text-[13px]")}>{v}</dd>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#eadfca] bg-white/70 px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a8177]">{label}</p>
      <p className="mt-1 text-[15px] font-semibold leading-snug">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[#8a8177]">{sub}</p>}
    </div>
  );
}

function Row({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: string }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "border-t border-[#eadfca] pt-1.5 text-base font-semibold")}>
      <dt className={strong ? "" : "text-[#6b6157]"}>{k}</dt>
      <dd className={cn("tabular-nums", tone)}>{v}</dd>
    </div>
  );
}
