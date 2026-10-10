import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, BedDouble, ConciergeBell, Coffee, KeyRound, LogIn, LogOut, MapPin, MessageCircle, Moon, Phone, Plane, Soup, Users,
  UtensilsCrossed, Wifi, Wine,
} from "lucide-react";
import QRCode from "qrcode";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { formatMinutesLabel } from "@/lib/format";
import { fromDbDate } from "@/lib/time/business-date";
import { prettyPhone } from "@/lib/guest-messages";
import { buttonVariants } from "@/components/ui/button";
import { ensureGuestToken, guestMessage } from "@/server/services/guest-comms";
import { siteOrigin } from "@/server/site-origin";
import { GuestMessenger } from "@/components/staff/reception/guest-messenger";
import { WelcomeCardActions } from "./card-actions";
import { getT, getTFor } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Welcome card") };
}

const GOLD = "#e3bd6a";
const day = (d: string, o: Intl.DateTimeFormatOptions, intl: string) => new Intl.DateTimeFormat(intl, { ...o, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/**
 * The guest's welcome card: their room, dates, Wi-Fi, the hotel's services and a
 * QR to the menu (order to the room). Print it, download it as an image (to send
 * on WhatsApp) or as a PDF, or send the welcome message.
 * The card is the guest's: it is written in the guest's language (Guest.preferredLanguage, like their WhatsApp
 * messages); the buttons around it are in the staff member's own language.
 */
export default async function WelcomeCardPage({ params }: PageProps<"/staff/reservations/[id]/welcome">) {
  await requirePagePermission("reservations.view");
  const { id } = await params;
  const [r, s, services] = await Promise.all([
    db.reservation.findUnique({ where: { id }, include: { guest: true, rooms: { where: { status: { in: ["CHECKED_IN", "CONFIRMED", "RESERVED"] } }, include: { room: true, roomType: true } } } }),
    getSettings(),
    db.hotelService.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!r) notFound();
  // t: the staff member's language (the page around the card) · gt: the guest's (the card itself).
  const [t, gt] = await Promise.all([getT(), getTFor(r.guest.preferredLanguage)]);
  const has = (code: string) => services.some((x) => x.code === code);
  // The guest's own stay link (menu + order to the room): a QR on the card and the WhatsApp welcome.
  const origin = await siteOrigin();
  const link = `${origin}/stay/${await ensureGuestToken(db, r.id)}`;
  const [welcome, sent] = await Promise.all([
    r.status === "CHECKED_IN" ? guestMessage(r.id, "WELCOME", origin) : null,
    db.guestMessage.findMany({ where: { reservationId: r.id }, orderBy: { createdAt: "desc" }, take: 10, include: { sentBy: { select: { fullName: true } } } }),
  ]);
  const qr = await QRCode.toString(`${link}#menu`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b1026", light: "#00000000" } });

  const first = r.guest.fullName.trim().split(/\s+/)[0];
  const short = r.rooms.length > 0 && r.rooms.every((x) => x.isDayUse);
  const arrival = fromDbDate(r.arrivalDate), departure = fromDbDate(r.departureDate);
  const nights = r.rooms.reduce((m, x) => Math.max(m, x.isDayUse ? 0 : x.nights), 0);
  const roomNumbers = r.rooms.map((x) => x.room.number);
  const phone = prettyPhone(s.phone);
  const whatsapp = prettyPhone(s.whatsapp);

  return (
    <div className="mx-auto max-w-[680px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/staff/reservations/${r.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> {t("Back to stay")}</Link>
        <WelcomeCardActions fileName={`Welcome-${first}-Room-${roomNumbers.join("-") || r.reference}`} />
      </div>

      {welcome && (
        <section className="rounded-3xl border border-border/70 bg-card p-4 print:hidden">
          <p className="mb-2 text-sm font-semibold">{t("Send the welcome to {name}'s phone", { name: first })}</p>
          <GuestMessenger reservationId={r.id} guest={{ name: r.guest.fullName, phone: r.guest.phone, email: r.guest.email }} link={link} language={r.guest.preferredLanguage}
            options={[{ type: "WELCOME", label: msg("Welcome & menu"), text: welcome.text, subject: welcome.subject }]}
            sent={sent.map((m) => ({ type: m.type, channel: m.channel, at: m.createdAt.toISOString(), by: m.sentBy?.fullName ?? null }))} />
        </section>
      )}

      {/* ── The card (what is printed and downloaded) — in the guest's language ── */}
      <WelcomeCard t={gt} r={r} s={s} has={has} short={short} arrival={arrival} departure={departure} nights={nights}
        roomNumbers={roomNumbers} first={first} phone={phone} whatsapp={whatsapp} qr={qr} />
    </div>
  );
}

type CardReservation = {
  reference: string; adults: number; children: number;
  rooms: { startAt: Date; endAt: Date; roomType: { name: string } }[];
};
type CardSettings = Awaited<ReturnType<typeof getSettings>>;

/** The card itself (what is printed and downloaded), written with `t` — the guest's language. */
function WelcomeCard({ t, r, s, has, short, arrival, departure, nights, roomNumbers, first, phone, whatsapp, qr }: {
  t: T; r: CardReservation; s: CardSettings; has: (code: string) => boolean; short: boolean; arrival: string; departure: string;
  nights: number; roomNumbers: string[]; first: string; phone: string; whatsapp: string; qr: string;
}) {
  const roomTypes = [...new Set(r.rooms.map((x) => x.roomType.name))].map((x) => t(x)).join(" · ");

  const serviceTiles = [
    ...(has("BREAKFAST") && !short ? [{ icon: Coffee, label: t("Breakfast"), value: s.breakfastHours ? t("Included · {hours}", { hours: s.breakfastHours }) : t("Included") }] : []),
    ...(has("RESTAURANT") ? [{ icon: UtensilsCrossed, label: t("Restaurant"), value: s.restaurantHours ?? t("Open daily") }] : []),
    ...(has("BAR") ? [{ icon: Wine, label: t("Bar & lounge"), value: s.barHours ?? t("Open daily") }] : []),
    { icon: Soup, label: t("Room service"), value: s.roomServiceFee ? t("Order by QR · TZS {fee} delivery", { fee: s.roomServiceFee.toLocaleString("en-US") }) : t("Order by QR") },
    { icon: ConciergeBell, label: t("Reception"), value: s.receptionHours ?? t("24 hours") },
    ...(has("AIRPORT_TRANSFER") ? [{ icon: Plane, label: t("Airport transfer"), value: t("Book at reception") }] : []),
  ];

  return (
    <div className="overflow-x-auto pb-2 print:overflow-visible print:pb-0">
      <article id="welcome-card" lang={t.locale === "zh-CN" ? "zh-CN" : "en"}
        className="relative mx-auto w-[640px] overflow-hidden rounded-[28px] bg-[#0b1026] text-white shadow-[0_40px_80px_-40px_rgba(5,8,25,0.9)] [print-color-adjust:exact] print:shadow-none">
        {/* Night-sky texture behind everything */}
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_30%,rgba(227,189,106,0.16),transparent_45%),radial-gradient(circle_at_10%_75%,rgba(56,97,210,0.22),transparent_50%)]" />
        <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:repeating-linear-gradient(135deg,#e3bd6a_0_1px,transparent_1px_14px)]" />

        {/* Hero: the hotel */}
        <header className="relative h-[270px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/exterior/exterior-02.webp" alt="" className="absolute inset-0 size-full object-cover object-[70%_60%]"
            style={{ maskImage: "linear-gradient(180deg,#000 40%,transparent 100%)", WebkitMaskImage: "linear-gradient(180deg,#000 40%,transparent 100%)" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(11,16,38,0.65) 0%, rgba(11,16,38,0.1) 34%, rgba(11,16,38,0.45) 70%, rgba(11,16,38,0) 100%)" }} />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-7 pt-6">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-full bg-[#0b1026]/80 ring-1 ring-[#e3bd6a]/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/logo-192.png" alt="" className="size-10 rounded-full" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/90">{s.hotelName}</span>
            </div>
            <span className="rounded-full bg-[#0b1026]/70 px-3 py-1 font-mono text-[11px] tracking-wider text-white/85 ring-1 ring-white/20">{r.reference}</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 px-7 pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.42em]" style={{ color: GOLD }}>{t("Welcome to")}</p>
            <h1 className="font-display text-[44px] font-semibold leading-none">{s.hotelName}</h1>
          </div>
        </header>

        <div className="relative space-y-5 px-7 pb-7 pt-4">
          {/* Greeting */}
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-display text-[34px] leading-tight" style={{ color: GOLD }}>{t("Karibu, {name}", { name: first })}</p>
              <p className="mt-1 max-w-[380px] text-[13px] leading-relaxed text-white/70">{t("We are delighted to have you with us. Everything you need for a wonderful stay is right here.")}</p>
            </div>
            <Ornament />
          </div>

          {/* Room & dates */}
          <div className="grid grid-cols-[150px_1fr_1fr] gap-3">
            <div className="flex flex-col justify-between rounded-2xl p-4 text-[#1a1206] shadow-[0_18px_40px_-18px_rgba(227,189,106,0.8)]"
              style={{ background: "linear-gradient(145deg,#f6dc9c 0%,#e3bd6a 45%,#b98a33 100%)" }}>
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em]"><KeyRound className="size-3.5" />{roomNumbers.length > 1 ? t("Rooms") : t("Your room")}</span>
              <span className="font-display text-[46px] font-bold leading-none">{roomNumbers.join(" · ") || "—"}</span>
              <span className="text-[12px] font-semibold leading-tight">{roomTypes}</span>
            </div>
            <DateTile t={t} icon={LogIn} label={short ? t("From") : t("Check-in")} date={arrival}
              time={short ? t.time(r.rooms[0].startAt) : t("from {time}", { time: formatMinutesLabel(s.standardCheckInMinutes) })} />
            <DateTile t={t} icon={LogOut} label={short ? t("Until") : t("Check-out")} date={short ? arrival : departure}
              time={short ? t.time(r.rooms[0].endAt) : t("by {time}", { time: formatMinutesLabel(s.checkoutMinutes) })} />
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <Chip icon={Moon}>{short ? t("Short stay") : t.plural(nights, "{n} night", "{n} nights")}</Chip>
            <Chip icon={Users}>{t.plural(r.adults, "{n} adult", "{n} adults")}{r.children ? ` · ${t.plural(r.children, "{n} child", "{n} children")}` : ""}</Chip>
            <Chip icon={BedDouble}>{roomTypes}</Chip>
            {has("BREAKFAST") && !short && <Chip icon={Coffee}>{t("Breakfast included")}</Chip>}
          </div>

          {/* Wi-Fi */}
          {has("WIFI") && (
            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#e3bd6a]/15 ring-1 ring-[#e3bd6a]/40"><Wifi className="size-5" style={{ color: GOLD }} /></span>
              {s.wifiNetwork ? (
                <div className="grid flex-1 grid-cols-2 gap-4">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">{t("Wi-Fi network")}</p><p className="mt-0.5 text-[15px] font-semibold">{s.wifiNetwork}</p></div>
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">{t("Password")}</p><p className="mt-0.5 font-mono text-[15px] font-semibold">{s.wifiPassword || t("No password")}</p></div>
                </div>
              ) : (
                <div className="flex-1"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">{t("Free Wi-Fi")}</p><p className="mt-0.5 text-[15px] font-semibold">{t("Ask reception for the network and password")}</p></div>
              )}
            </div>
          )}

          {/* Services */}
          <div>
            <SectionTitle>{t("At your service")}</SectionTitle>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {serviceTiles.map((tile) => (
                <div key={tile.label} className="rounded-2xl border border-white/10 bg-linear-to-b from-white/[0.08] to-white/[0.02] p-3.5">
                  <tile.icon className="size-5" style={{ color: GOLD }} />
                  <p className="mt-2 text-[13px] font-semibold">{tile.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-white/60">{tile.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Menu QR */}
          <div className="relative flex items-center gap-5 overflow-hidden rounded-2xl p-4 text-[#0b1026]"
            style={{ background: "linear-gradient(120deg,#fbf3df 0%,#f3e2b8 100%)" }}>
            <div aria-hidden className="absolute -right-10 -top-12 size-40 rounded-full bg-[#e3bd6a]/35" />
            <span className="relative block size-[112px] shrink-0 rounded-xl bg-white p-2.5 shadow-sm [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="relative">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#8a6419]">{t("Scan with your phone")}</p>
              <p className="font-display text-[26px] font-semibold leading-tight">{t("Menu & room service")}</p>
              <p className="mt-1 text-[12.5px] leading-snug text-[#0b1026]/75">{t("See our dishes and drinks and order straight to Room {room} — it goes on your room bill. Your booking details are there too.", { room: roomNumbers.join(", ") })}</p>
            </div>
          </div>

          {/* Contacts */}
          <div className="grid grid-cols-3 gap-2.5 border-t border-white/10 pt-5 text-[12px]">
            <Contact icon={Phone} label={t("Reception")} value={phone || t("Dial 0 from your room")} />
            <Contact icon={MessageCircle} label="WhatsApp" value={whatsapp || phone || "—"} />
            <Contact icon={MapPin} label={t("Find us")} value={[s.addressLine, s.city].filter(Boolean).join(", ") || s.country || "Dar es Salaam"} />
          </div>
          <p className="text-center font-display text-[15px] italic" style={{ color: GOLD }}>{s.tagline ? t(s.tagline) : t("Enjoy your stay — karibu sana!")}</p>
        </div>
      </article>
    </div>
  );
}

function DateTile({ t, icon: Icon, label, date, time }: { t: T; icon: typeof LogIn; label: string; date: string; time: string }) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-2xl border border-white/12 bg-white/[0.06] p-4">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55"><Icon className="size-3.5" />{label}</span>
      <div className="flex items-center gap-3">
        <span className="grid size-[52px] shrink-0 place-items-center rounded-xl bg-white text-center leading-none text-[#0b1026]">
          <span>
            <span className="block text-[9px] font-bold uppercase tracking-wider text-[#a2771f]">{day(date, { month: "short" }, t.intl)}</span>
            <span className="block text-[22px] font-bold">{day(date, { day: "numeric" }, t.intl)}</span>
          </span>
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold">{day(date, { weekday: "long" }, t.intl)}</span>
          <span className="block text-[12px] text-white/60">{day(date, { year: "numeric" }, t.intl)}</span>
        </span>
      </div>
      <span className="text-[13px] font-semibold" style={{ color: GOLD }}>{time}</span>
    </div>
  );
}

function Chip({ icon: Icon, children }: { icon: typeof LogIn; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-white/85"><Icon className="size-3.5" style={{ color: GOLD }} />{children}</span>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
      {children}<span className="h-px flex-1 bg-linear-to-r from-[#e3bd6a]/60 to-transparent" />
    </p>
  );
}

function Contact({ icon: Icon, label, value }: { icon: typeof LogIn; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.07] ring-1 ring-white/12"><Icon className="size-3.5" style={{ color: GOLD }} /></span>
      <span className="min-w-0 leading-tight"><span className="block text-[10px] uppercase tracking-[0.18em] text-white/50">{label}</span><span className="mt-0.5 block font-medium">{value}</span></span>
    </div>
  );
}

/** A small gold crest ornament beside the greeting. */
function Ornament() {
  return (
    <svg width="74" height="40" viewBox="0 0 74 40" aria-hidden className="shrink-0">
      <path d="M2 20h24M48 20h24" stroke="#e3bd6a" strokeOpacity=".6" strokeWidth="1" />
      <path d="M37 6l9 14-9 14-9-14z" fill="none" stroke="#e3bd6a" strokeWidth="1.2" />
      <path d="M37 13l4.5 7-4.5 7-4.5-7z" fill="#e3bd6a" />
    </svg>
  );
}
