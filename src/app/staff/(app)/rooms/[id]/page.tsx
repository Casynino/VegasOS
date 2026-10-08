import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft, ArrowRight, BedDouble, BrushCleaning, CalendarClock, ChefHat, CircleDollarSign, ClipboardList, Crown, FileText, History, LogIn, LogOut, MessageCircle, Moon, Phone, Receipt, Repeat, Users, UtensilsCrossed, Wallet, Wine, Wrench,
} from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { getRoomBoard } from "@/server/services/rooms";
import { accountOptions } from "@/server/services/payment-accounts";
import { billMenu, STATUS_LABEL } from "@/server/services/restaurant";
import { recentChargeItems } from "@/server/services/payments";
import { roomControl, type RoomControl, type RoomEvent } from "@/server/services/room-control";
import { RoomActionsCard } from "@/components/staff/rooms/room-grid";
import { roomGridPerms, roomQrInfo } from "../room-page-data";
import { RoomQrSide } from "./room-qr-side";
import { addDays, fromDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { moveReasonLabel } from "@/lib/room-change";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Room") };
}
export const dynamic = "force-dynamic";

/** The room's state at a glance: label, colours. */
const LIVE: Record<string, { label: string; tone: string; dot: string }> = {
  AVAILABLE: { label: msg("Available"), tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/40", dot: "bg-emerald-400" },
  READY: { label: msg("Clean & ready"), tone: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/40", dot: "bg-emerald-400" },
  ARRIVING: { label: msg("Reserved · arriving today"), tone: "bg-amber-500/15 text-amber-300 ring-amber-400/40", dot: "bg-amber-400" },
  OCCUPIED: { label: msg("Occupied"), tone: "bg-sky-500/15 text-sky-300 ring-sky-400/40", dot: "bg-sky-400" },
  DUE_OUT: { label: msg("Checkout due today"), tone: "bg-violet-500/15 text-violet-300 ring-violet-400/40", dot: "bg-violet-400" },
  OVERDUE: { label: msg("Checkout overdue"), tone: "bg-rose-500/20 text-rose-300 ring-rose-400/50", dot: "bg-rose-400" },
  DIRTY: { label: msg("Needs cleaning"), tone: "bg-orange-500/15 text-orange-300 ring-orange-400/40", dot: "bg-orange-400" },
  CLEANING: { label: msg("Cleaning"), tone: "bg-violet-500/15 text-violet-300 ring-violet-400/40", dot: "bg-violet-400" },
  MAINTENANCE: { label: msg("Maintenance"), tone: "bg-rose-500/15 text-rose-300 ring-rose-400/40", dot: "bg-rose-400" },
  OUT_OF_SERVICE: { label: msg("Out of service"), tone: "bg-zinc-500/20 text-zinc-300 ring-zinc-400/40", dot: "bg-zinc-400" },
};

/**
 * The room control page — the central view of one physical room (also where a staff
 * member lands when they scan the room's QR): its type, price and live status, the guest
 * in it, the live bill and orders, what can be done now (the same actions as the rooms
 * board: check in / out, payments, orders, add nights, change room, cleaning, maintenance),
 * and everything that happened in the room.
 */
export default async function RoomPage({ params }: PageProps<"/staff/rooms/[id]">) {
  const user = await requirePagePermission("rooms.view");
  const t = await getT();
  const { id } = await params;
  const today = await businessToday();
  const [c, board, methods, menu, recent, qr, perms] = await Promise.all([
    roomControl(id, today), getRoomBoard(today), accountOptions("payments"), can(user, "restaurant.orders") ? billMenu() : null,
    can(user, "payments.record") ? recentChargeItems() : [], roomQrInfo(), roomGridPerms(user),
  ]);
  if (!c) notFound();
  const boardRoom = board.find((r) => r.id === id) ?? null;
  const [nights, moves] = await Promise.all([
    db.roomNight.findMany({
      // (A booking to pay later holds no room — its priced nights are not stays in this room.)
      where: { roomId: id, reservationRoom: { status: { not: "INQUIRY" } } }, orderBy: { businessDate: "desc" }, take: 400,
      select: { businessDate: true, netAmount: true, reservationRoom: { select: { reservation: { select: { id: true, reference: true, guest: { select: { fullName: true } } } } } } },
    }),
    db.roomAssignment.findMany({ where: { fromRoomId: id, source: "HOTEL" }, select: { reasonCode: true } }),
  ]);
  // Stays in this room: consecutive nights of the same booking.
  const stays: { id: string; ref: string; guest: string; from: string; to: string; nights: number; income: number }[] = [];
  for (const n of [...nights].reverse()) {
    const r = n.reservationRoom.reservation;
    const d = fromDbDate(n.businessDate);
    const last = stays.at(-1);
    if (last && last.id === r.id && addDays(last.to, 1) === d) { last.to = d; last.nights++; last.income += n.netAmount; }
    else stays.push({ id: r.id, ref: r.reference, guest: r.guest.fullName, from: d, to: d, nights: 1, income: n.netAmount });
  }
  stays.reverse();
  const live = LIVE[c.live] ?? LIVE.AVAILABLE;
  const tz = c.timezone;
  const when = (iso: string) => new Intl.DateTimeFormat(t.intl, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));
  const stay = c.stay;
  const progress = stay?.progress ?? null;
  const wa = stay?.guest.phone ? `https://wa.me/${stay.guest.phone.replace(/\D/g, "")}` : null;
  const photo = boardRoom?.roomType.photo ?? null;
  const bill = c.bill;
  const extras = bill ? bill.sections.reduce((sum, sec) => sum + sec.total, 0) : 0;

  return (
    <div className="w-full space-y-5">
      <Link href="/staff/rooms" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> {t("Rooms")}</Link>

      {/* ── Header ── */}
      <section className="relative isolate overflow-hidden rounded-3xl bg-[#0f1220] text-white shadow-[0_30px_60px_-35px_rgba(0,0,0,0.9)]">
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="absolute inset-0 -z-10 size-full object-cover opacity-45" />
        )}
        <div className="absolute inset-0 -z-10 bg-linear-to-r from-[#0b0e1a] via-[#0b0e1a]/85 to-[#0b0e1a]/30" />
        <div className="flex flex-wrap items-end justify-between gap-5 p-6 sm:p-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[oklch(0.8_0.12_80)]">{c.meeting ? t("Meeting room") : t("Room")}</p>
            <h1 className="font-display text-6xl font-semibold leading-none tabular-nums sm:text-7xl">{c.room.number}</h1>
            <p className="mt-2 text-base font-medium">{t(c.room.roomType.name)}{c.room.floor != null ? <span className="text-white/60"> · {t("Floor {floor}", { floor: c.room.floor })}</span> : null}</p>
            <p className="text-sm text-white/70">{formatTZS(c.room.roomType.baseRate)} {c.meeting ? t("per booking") : t("per night")} · {t.plural(c.room.roomType.maxAdults, "up to {n} adult", "up to {n} adults")}{c.room.roomType.bedType ? ` · ${t(c.room.roomType.bedType)}` : ""}</p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-base font-semibold ring-1", live.tone)}><span className={cn("size-2.5 rounded-full", live.dot, (c.live === "OVERDUE" || c.live === "ARRIVING") && "animate-pulse")} />{t(live.label)}</span>
            {stay?.inHouse && bill && !bill.payer && bill.balance > 0 && <span className="rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300 ring-1 ring-rose-400/40">{t("Payment pending · {amount}", { amount: formatTZS(bill.balance) })}</span>}
            {bill?.payer && <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/15">{t("Paid by {payer}", { payer: payerName(bill.payer, t) })}</span>}
            {c.room.statusNote && !stay && <span className="text-xs text-white/60">{t("Note: {note}", { note: t(c.room.statusNote) })}</span>}
          </div>
        </div>
        {progress != null && stay && (
          <div className="border-t border-white/10 px-6 py-4 sm:px-8">
            <div className="flex justify-between text-xs text-white/60"><span>{t("In {when}", { when: when(stay.checkIn) })}</span><span>{t("Out {when}", { when: when(stay.checkOut) })}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className={cn("h-full rounded-full", c.overdue ? "bg-rose-400" : "bg-[oklch(0.8_0.12_80)]")} style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── Actions (first on phones, a sticky side column on wide screens) ── */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:self-start">
          <section className="rounded-3xl border border-border/70 bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("What you can do now")}</p>
            {stay && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/staff/reservations/${stay.reservationId}`} className={buttonVariants({ size: "sm", variant: "outline" })}><ClipboardList />{t("Booking")}</Link>
                <Link href={`/staff/reservations/${stay.reservationId}/proforma?print=1`} className={buttonVariants({ size: "sm", variant: "outline" })}><FileText />{t("Print bill")}</Link>
                {stay.guest.phone && <a href={`tel:${stay.guest.phone}`} className={buttonVariants({ size: "sm", variant: "outline" })}><Phone />{t("Call")}</a>}
                {wa && <a href={wa} target="_blank" rel="noopener" className={cn(buttonVariants({ size: "sm" }), "bg-[#25D366] text-[#073b1f] hover:bg-[#1fbe5b]")}><MessageCircle />WhatsApp</a>}
              </div>
            )}
          </section>
          {boardRoom && <RoomActionsCard room={boardRoom} perms={perms} today={today} methods={methods} menu={menu} recent={recent} qr={qr} />}
          <RoomQrSide roomId={id} number={c.room.number} meeting={c.meeting} qr={qr} />
        </aside>

        {/* ── The room now ── */}
        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-1">
          {stay ? <GuestCard c={c} when={when} t={t} /> : <EmptyRoom c={c} when={when} t={t} />}
          {bill && stay && <BillCard c={c} extras={extras} when={when} t={t} />}
          {c.orders.length > 0 && <OrdersCard c={c} when={when} t={t} />}
          <Timeline events={c.timeline} when={when} t={t} />

          {/* ── Who stayed here ── */}
          <section className="rounded-3xl border border-border/70 bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><History className="size-4 text-muted-foreground" />{t("Who stayed here")}</h2>
            {moves.length > 1 && (
              <p className="mb-3 flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                <Wrench className="size-4" />{t("Guests were moved out of this room {n} times because of a room problem ({reasons}).", { n: moves.length, reasons: [...new Set(moves.map((m) => t(moveReasonLabel(m.reasonCode))))].join(", ") })}
              </p>
            )}
            {stays.length === 0 ? <p className="text-sm text-muted-foreground">{t("No stays yet.")}</p> : (
              <ul className="divide-y divide-border/60 text-sm">
                {stays.slice(0, 30).map((s, i) => (
                  <li key={`${s.id}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><Link href={`/staff/reservations/${s.id}`} className="font-medium hover:underline">{s.guest}</Link> <span className="font-mono text-xs text-muted-foreground">{s.ref}</span></span>
                    <span className="text-xs text-muted-foreground">{t.date(s.from)} → {t.date(addDays(s.to, 1))} · {t.plural(s.nights, "{n} night", "{n} nights")} · {formatTZS(s.income)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

type When = (iso: string) => string;

/** Who pays the bill: a company's or group's name as written — the service's fallback words in the reader's language. */
const payerName = (payer: string, t: T) => (payer === "the group" || payer === "the company" ? t(payer) : payer);
/** "Cash · Main till" — hotel-configured names, each in the reader's language. */
const labels = (text: string, t: T) => text.split(" · ").map((x) => t(x)).join(" · ");
/** An order line "2 × Chips": the dish in the reader's language. */
const itemLine = (line: string, t: T) => {
  const i = line.indexOf(" × ");
  return i < 0 ? t(line) : `${line.slice(0, i)} × ${t(line.slice(i + 3))}`;
};
/** A timeline event's title (written in English by the room-control service) in the reader's language. */
function eventTitle(e: RoomEvent, t: T): string {
  let m: RegExpMatchArray | null;
  switch (e.kind) {
    case "status": return e.title.split(" → ").map((x) => t(x)).join(" → ");
    case "in": return (m = e.title.match(/^(.*) checked in$/)) ? t("{name} checked in", { name: m[1] }) : e.title;
    case "out": return (m = e.title.match(/^(.*) checked out$/)) ? t("{name} checked out", { name: m[1] }) : e.title;
    case "move": return (m = e.title.match(/^Guest moved (.+) → (.+)$/)) ? t("Guest moved {from} → {to}", { from: m[1], to: m[2] }) : e.title;
    case "order": return (m = e.title.match(/^Order (.+)$/)) ? t("Order {number}", { number: m[1] }) : e.title;
    case "charge": {
      const i = e.title.indexOf(" · ");
      return i < 0 ? e.title : `${t(e.title.slice(0, i))}${e.title.slice(i)}`;
    }
    default: return t(e.title);
  }
}
/** Its detail: payment accounts and dishes translated, a quick maintenance reason in the reader's language; notes, reasons and references as written. */
const eventDetail = (e: RoomEvent, t: T) => e.kind === "payment" ? labels(e.detail ?? "", t) : e.kind === "order" ? (e.detail ?? "").split(", ").map((x) => itemLine(x, t)).join(", ") : e.kind === "status" && e.detail ? t(e.detail) : e.detail;

function GuestCard({ c, when, t }: { c: RoomControl; when: When; t: T }) {
  const s = c.stay!;
  const initials = s.guest.fullName.replace(/\(.*\)/, "").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className={cn("grid size-14 shrink-0 place-items-center rounded-2xl text-lg font-bold text-white", s.inHouse ? "bg-sky-500" : "bg-amber-500")}>{initials}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{s.inHouse ? t("Current guest") : t("Arriving today")}</p>
          <p className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            <Link href={`/staff/guests/${s.guest.id}`} className="hover:underline">{s.guest.fullName}</Link>
            {s.guest.vip && <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.75_0.13_80)]/20 px-2 py-0.5 text-[10px] font-bold text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]"><Crown className="size-3" />VIP</span>}
          </p>
          <p className="text-sm text-muted-foreground">
            <Link href={`/staff/reservations/${s.reservationId}`} className="font-mono hover:underline">{s.reference}</Link>
            {s.guest.phone && <> · <a href={`tel:${s.guest.phone}`} className="hover:underline">{s.guest.phone}</a></>}
            {s.company && <> · {s.company}</>}{s.groupName && <> · {t("Group {name}", { name: s.groupName })}</>}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact icon={LogIn} label={s.checkedIn ? t("Checked in") : t("Check-in")} value={when(s.checkIn)} sub={s.checkedInBy ? t("by {name}", { name: s.checkedInBy }) : undefined} />
        <Fact icon={LogOut} label={t("Check-out")} value={when(s.checkOut)} tone={c.overdue ? "warn" : undefined} />
        <Fact icon={Moon} label={s.nights ? t("Nights") : t("Stay")} value={s.nights ? t.plural(s.nights, "{n} night", "{n} nights") : t("Short stay")} />
        <Fact icon={Users} label={t("Guests")} value={`${t.plural(s.adults, "{n} adult", "{n} adults")}${s.children ? ` · ${t.plural(s.children, "{n} child", "{n} children")}` : ""}`} />
      </dl>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Money label={t("Room rate")} value={s.nights ? t("{amount} / night", { amount: formatTZS(s.rate) }) : formatTZS(s.rate)} />
        <Money label={t("Discount")} value={s.roomDiscount ? `− ${formatTZS(s.roomDiscount)}` : "—"} />
        <Money label={t("Room total")} value={formatTZS(s.roomNet)} />
        <Money label={t("Balance")} value={c.bill?.payer ? t("Paid by {payer}", { payer: payerName(c.bill.payer, t) }) : c.bill && c.bill.balance > 0 ? formatTZS(c.bill.balance) : t("Paid")} tone={c.bill && !c.bill.payer && c.bill.balance > 0 ? "due" : "ok"} />
      </div>
      {(s.requests || s.notes) && (
        <div className="mt-3 space-y-1.5 text-sm">
          {s.requests && <p className="rounded-xl bg-muted px-3 py-2">{t("Guest asked: {text}", { text: s.requests })}</p>}
          {s.notes && <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">{t("Staff note: {text}", { text: s.notes })}</p>}
        </div>
      )}
    </section>
  );
}

function EmptyRoom({ c, when, t }: { c: RoomControl; when: When; t: T }) {
  const st = c.room.status;
  const [icon, title, text] = st === "DIRTY" ? [BrushCleaning, t("Needs cleaning"), t("The last guest has left. Start cleaning, then mark it clean & ready.")]
    : st === "CLEANING" ? [BrushCleaning, t("Housekeeping is cleaning"), t("Mark it clean & ready when it is done — then it can be sold.")]
    : st === "MAINTENANCE" || st === "OUT_OF_SERVICE" ? [Wrench, st === "MAINTENANCE" ? t("Under maintenance") : t("Out of service"), (c.room.statusNote ? t(c.room.statusNote) : t("Off sale until it is fixed."))]
    : [BedDouble, t("Empty and ready for a guest"), t("Check a walk-in guest in, or reserve it for later dates.")];
  const Icon = icon;
  return (
    <section className="flex items-center gap-4 rounded-3xl border border-border/70 bg-card p-5">
      <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-muted"><Icon className="size-6 text-muted-foreground" /></span>
      <div>
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("Since {when}", { when: when(c.room.statusChangedAt) })}</p>
      </div>
    </section>
  );
}

function BillCard({ c, extras, when, t }: { c: RoomControl; extras: number; when: When; t: T }) {
  const b = c.bill!;
  const icons: Record<string, typeof UtensilsCrossed> = { Restaurant: UtensilsCrossed, Bar: Wine, "Room service": ChefHat, "Services & extras": Receipt };
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Wallet className="size-4 text-muted-foreground" />{t("Room bill")}</h2>
        <span className="text-xs text-muted-foreground">{t("Updates with every order, charge and payment")}</span>
      </div>

      {/* Summary */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={t("Accommodation")} value={formatTZS(b.accommodation.gross)} />
        <Tile label={t("Food, drinks & services")} value={formatTZS(extras)} />
        <Tile label={t("Total")} value={formatTZS(b.total)} strong />
        <Tile label={b.payer ? t("Paid by {payer}", { payer: payerName(b.payer, t) }) : b.balance > 0 ? t("Balance due") : t("Balance")} value={b.payer ? formatTZS(b.total) : b.balance > 0 ? formatTZS(b.balance) : t("Paid in full")} tone={b.payer ? undefined : b.balance > 0 ? "due" : "ok"} />
      </div>

      {/* Lines */}
      <div className="mt-4 divide-y divide-border/60 rounded-2xl border border-border/70">
        <Section icon={BedDouble} name={t("Accommodation")} total={b.accommodation.gross}>
          <Line text={b.accommodation.dayUse ? t("Room {room} · short stay", { room: c.room.number }) : t.plural(b.accommodation.nights, "Room {room} · {n} night × {rate}", "Room {room} · {n} nights × {rate}", { room: c.room.number, rate: formatTZS(b.accommodation.rate) })} amount={b.accommodation.gross} />
        </Section>
        {b.sections.map((sec) => (
          <Section key={sec.name} icon={icons[sec.name] ?? Receipt} name={t(sec.name)} total={sec.total}>
            {sec.lines.map((l) => <Line key={l.id} text={l.description} sub={`${when(l.at)}${l.by ? ` · ${l.by}` : ""}`} amount={l.amount} />)}
          </Section>
        ))}
        {b.discount > 0 && <Section icon={CircleDollarSign} name={t("Discounts")} total={-b.discount}><Line text={t("Room discount")} amount={-b.discount} /></Section>}
        <Section icon={Wallet} name={t("Payments")} total={-b.paid}>
          {b.payments.length === 0 ? <p className="px-4 pb-3 text-xs text-muted-foreground">{t("No payments yet.")}</p>
            : b.payments.map((p) => <Line key={p.id} text={`${p.refund ? t("Refund") : t("Payment")} · ${labels(p.how, t)}`} sub={`${when(p.at)} · ${p.by}${p.reversed ? ` · ${t("reversed")}` : ""}`} amount={p.refund ? p.amount : -p.amount} muted={p.reversed} />)}
        </Section>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-semibold">{b.payer ? t("Billed to {payer}", { payer: payerName(b.payer, t) }) : t("Balance")}</span>
          <span className={cn("text-lg font-bold tabular-nums", !b.payer && b.balance > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{b.payer ? formatTZS(b.total) : b.balance > 0 ? formatTZS(b.balance) : t("Paid in full")}</span>
        </div>
      </div>
    </section>
  );
}

function OrdersCard({ c, when, t }: { c: RoomControl; when: When; t: T }) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><UtensilsCrossed className="size-4 text-muted-foreground" />{t("Restaurant & bar orders")} <span className="font-normal text-muted-foreground">· {c.orders.length}</span></h2>
      <ul className="space-y-2">
        {c.orders.map((o) => (
          <li key={o.id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 px-3 py-2.5 text-sm", o.status === "CANCELLED" && "opacity-60")}>
            <span className="min-w-0 leading-tight">
              <span className="block font-medium">{o.items.map((i) => itemLine(i, t)).join(", ")}</span>
              <span className="text-xs text-muted-foreground"><span className="font-mono">{o.number}</span> · {when(o.createdAt)}{o.source === "ROOM_QR" ? ` · ${t("ordered from the room QR")}` : o.source === "GUEST_LINK" ? ` · ${t("ordered from the guest's link")}` : ""}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", o.status === "CANCELLED" ? "bg-muted text-muted-foreground" : ["DELIVERED", "COMPLETED", "COLLECTED"].includes(o.status) ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-300")}>{t(STATUS_LABEL[o.status])}</span>
              <span className={cn("font-semibold tabular-nums", o.status === "CANCELLED" && "line-through")}>{formatTZS(o.total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const EVENT_ICON: Record<RoomEvent["kind"], typeof LogIn> = { in: LogIn, out: LogOut, status: BrushCleaning, move: Repeat, charge: Receipt, order: UtensilsCrossed, payment: Wallet, change: CalendarClock };
const EVENT_TONE: Record<RoomEvent["kind"], string> = {
  in: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", out: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  status: "bg-orange-500/15 text-orange-700 dark:text-orange-300", move: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  charge: "bg-amber-500/15 text-amber-700 dark:text-amber-300", order: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  payment: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", change: "bg-muted text-muted-foreground",
};

function Timeline({ events, when, t }: { events: RoomEvent[]; when: When; t: T }) {
  const first = events.slice(0, 14), rest = events.slice(14);
  const row = (e: RoomEvent, i: number) => {
    const Icon = EVENT_ICON[e.kind];
    const body = (
      <>
        <span className={cn("absolute -left-[2.05rem] top-0.5 grid size-6 place-items-center rounded-full ring-4 ring-card", EVENT_TONE[e.kind])}><Icon className="size-3" /></span>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{eventTitle(e, t)}</p>
            <p className="text-xs text-muted-foreground">{when(e.at)}{e.by ? ` · ${e.by === "System" || e.by === "Guest (online)" ? t(e.by) : e.by}` : ""}{e.detail ? ` · ${eventDetail(e, t)}` : ""}</p>
          </div>
          {e.amount ? <span className={cn("shrink-0 text-sm font-semibold tabular-nums", e.kind === "payment" && e.amount > 0 && "text-emerald-600 dark:text-emerald-400")}>{e.kind === "payment" && e.amount > 0 ? "+" : ""}{formatTZS(e.amount)}</span> : null}
        </div>
      </>
    );
    return <li key={`${e.at}-${i}`} className="relative">{e.href ? <Link href={e.href} className="block hover:opacity-80">{body}</Link> : body}</li>;
  };
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold"><History className="size-4 text-muted-foreground" />{t("Room activity")}</h2>
      {events.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing yet.")}</p> : (
        <>
          <ol className="relative ml-3 space-y-3.5 border-l border-border/80 pl-5">{first.map(row)}</ol>
          {rest.length > 0 && (
            <details className="group mt-3">
              <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground hover:text-foreground">{t("Show {n} older", { n: rest.length })} <ArrowRight className="inline size-3.5 transition group-open:rotate-90" /></summary>
              <ol className="relative ml-3 mt-3 space-y-3.5 border-l border-border/80 pl-5">{rest.map((e, i) => row(e, i + first.length))}</ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function Fact({ icon: Icon, label, value, sub, tone }: { icon: typeof LogIn; label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <div className={cn("rounded-2xl px-3 py-2.5", tone === "warn" ? "bg-rose-500/10" : "bg-muted/70")}>
      <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="size-3.5" />{label}</dt>
      <dd className={cn("mt-0.5 text-sm font-semibold", tone === "warn" && "text-rose-600 dark:text-rose-400")}>{value}</dd>
      {sub && <dd className="text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}
function Money({ label, value, tone }: { label: string; value: string; tone?: "due" | "ok" }) {
  return (
    <div className="rounded-2xl border border-border/70 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("font-semibold tabular-nums", tone === "due" && "text-rose-600 dark:text-rose-400", tone === "ok" && "text-emerald-600 dark:text-emerald-400")}>{value}</p>
    </div>
  );
}
function Tile({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "due" | "ok" }) {
  return (
    <div className={cn("rounded-2xl px-3 py-3", strong ? "bg-foreground text-background" : tone === "due" ? "bg-rose-500/10" : tone === "ok" ? "bg-emerald-500/10" : "bg-muted/70")}>
      <p className={cn("text-[11px]", strong ? "text-background/70" : "text-muted-foreground")}>{label}</p>
      <p className={cn("mt-0.5 text-base font-bold tabular-nums", tone === "due" && "text-rose-600 dark:text-rose-400", tone === "ok" && "text-emerald-600 dark:text-emerald-400")}>{value}</p>
    </div>
  );
}
function Section({ icon: Icon, name, total, children }: { icon: typeof LogIn; name: string; total: number; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center justify-between px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5"><Icon className="size-3.5" />{name}</span><span className="tabular-nums">{total < 0 ? "− " : ""}{formatTZS(Math.abs(total))}</span>
      </p>
      <div className="pb-2">{children}</div>
    </div>
  );
}
function Line({ text, sub, amount, muted }: { text: string; sub?: string; amount: number; muted?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-4 py-1.5 text-sm", muted && "opacity-50 line-through")}>
      <span className="min-w-0 leading-tight"><span className="block">{text}</span>{sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}</span>
      <span className="shrink-0 tabular-nums">{amount < 0 ? "− " : ""}{formatTZS(Math.abs(amount))}</span>
    </div>
  );
}
