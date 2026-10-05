import type { Metadata } from "next";
import Link from "next/link";
import { Ban, Banknote, BedDouble, CalendarClock, CalendarPlus, CalendarRange, Clock, DoorOpen, List, LogIn, LogOut, Plane, QrCode, Search, Users } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { refreshBookingStates } from "@/server/services/booking-holds";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { addDays, fromDbDate, toDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatDateTime, formatShortDate, formatTZS } from "@/lib/format";
import { friendlyAction } from "@/lib/activity-words";
import { MEETING_STATUS_LABEL, timeRange } from "@/lib/meeting";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import type { Prisma } from "@/generated/prisma/client";
import { EmptyState } from "@/components/staff/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reservations" };
const PAGE = 40;
const TZ = "Africa/Dar_es_Salaam";
const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);

const VIEWS = [
  { key: "arrivals", label: "Arriving today", hint: "Still to check in", icon: LogIn, tone: "text-sky-600 bg-sky-500/12 dark:text-sky-300", ring: "ring-sky-500/50" },
  { key: "inhouse", label: "In the hotel", hint: "Checked in now", icon: BedDouble, tone: "text-emerald-600 bg-emerald-500/12 dark:text-emerald-300", ring: "ring-emerald-500/50" },
  { key: "departures", label: "Leaving today", hint: "Incl. overdue", icon: LogOut, tone: "text-rose-600 bg-rose-500/12 dark:text-rose-300", ring: "ring-rose-500/50" },
  { key: "upcoming", label: "Coming soon", hint: "Future bookings", icon: CalendarClock, tone: "text-violet-600 bg-violet-500/12 dark:text-violet-300", ring: "ring-violet-500/50" },
  { key: "all", label: "All bookings", hint: "Newest first", icon: List, tone: "text-muted-foreground bg-muted", ring: "ring-foreground/30" },
] as const;
type View = (typeof VIEWS)[number]["key"];

/** Narrow any view by payment / booking state. */
const FILTERS = [
  { key: "", label: "Everything" },
  { key: "pending", label: "Pending · unpaid" },
  // Booked online to pay later (or an enquiry): whoever pays first gets the room.
  { key: "notheld", label: "Not paid · room not held" },
  { key: "paid", label: "Confirmed · paid" },
  { key: "owes", label: "Owes money" },
  { key: "company", label: "Company invoice" },
  // Booked by the guest from the Hotel QR ("Scan to book your stay").
  { key: "qr", label: "Hotel QR" },
  { key: "in", label: "Checked in" },
  { key: "out", label: "Checked out" },
  { key: "late", label: "Late arrival" },
  { key: "noshow", label: "No-show · action required" },
  { key: "cancelled", label: "Cancelled / no-show" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];
const BY_FILTER: Record<Filter, Prisma.ReservationWhereInput> = {
  "": {},
  pending: { status: "RESERVED" },
  notheld: { status: "INQUIRY" },
  paid: { status: "CONFIRMED" },
  owes: { balanceAmount: { gt: 0 }, status: { in: ["CHECKED_IN", "CHECKED_OUT", "CONFIRMED", "RESERVED", "INQUIRY"] } },
  company: { billTo: { not: "GUEST" } },
  qr: { source: { code: "HOTEL_QR" } },
  in: { status: "CHECKED_IN" },
  out: { status: "CHECKED_OUT" },
  cancelled: { status: { in: ["CANCELLED", "NO_SHOW"] } },
  noshow: { status: "NO_SHOW", rooms: { some: { status: "NO_SHOW", releasedAt: null } } },
  late: { lateArrivalNotedAt: { not: null }, status: { in: ["RESERVED", "CONFIRMED", "INQUIRY"] } },
};

/** The card's thin bar and soft tint, from its status colour (like the room tiles). */
function colourOf(tone: string) {
  const all = [
    ["rose", "bg-rose-500", "from-rose-500/[0.08]"], ["amber", "bg-amber-400", "from-amber-400/[0.09]"], ["orange", "bg-orange-400", "from-orange-400/[0.08]"],
    ["emerald", "bg-emerald-500", "from-emerald-500/[0.07]"], ["sky", "bg-sky-500", "from-sky-500/[0.07]"], ["violet", "bg-violet-400", "from-violet-400/[0.08]"],
  ] as const;
  const hit = all.find(([k]) => tone.includes(k));
  return hit ? { bar: hit[1], tint: hit[2] } : { bar: "bg-zinc-400", tint: "from-zinc-400/[0.05]" };
}

/**
 * Everyone booked at the hotel: who arrives today, who is in the hotel, who
 * leaves today, who is coming — each row says what is happening and offers the
 * next step (check in, open stay, check out).
 */
export default async function ReservationsPage({ searchParams }: PageProps<"/staff/reservations">) {
  const user = await requirePagePermission("reservations.view");
  await refreshBookingStates();
  const sp = await searchParams;
  const view: View = VIEWS.find((v) => v.key === sp.view)?.key ?? "arrivals";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const filter: Filter = FILTERS.find((f) => f.key === sp.f)?.key ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const now = new Date();
  const todayStr = await businessToday(now);
  const today = toDbDate(todayStr);

  const byView: Record<View, Prisma.ReservationWhereInput> = {
    // Arriving: stays running today, and short-time / meeting bookings for today (they start and end the same day).
    // (Booked to pay later — no room held — they still arrive: listed too.)
    arrivals: { rooms: { some: { status: { in: ["RESERVED", "CONFIRMED", "INQUIRY"] }, OR: [{ arrivalDate: { lte: today }, departureDate: { gt: today } }, { arrivalDate: today, isDayUse: true }] } }, status: { in: ["RESERVED", "CONFIRMED", "INQUIRY"] } },
    inhouse: { status: "CHECKED_IN" },
    departures: { rooms: { some: { status: "CHECKED_IN", departureDate: { lte: today } } } },
    upcoming: { arrivalDate: { gt: today }, status: { in: ["RESERVED", "CONFIRMED", "INQUIRY"] } },
    all: {},
  };
  const digits = q.replace(/\D/g, "");
  const search: Prisma.ReservationWhereInput = q ? {
    OR: [
      { reference: { contains: q, mode: "insensitive" } },
      { externalReference: { contains: q, mode: "insensitive" } },
      { guest: { fullName: { contains: q, mode: "insensitive" } } },
      { companyName: { contains: q, mode: "insensitive" } },
      { guests: { some: { guest: { fullName: { contains: q, mode: "insensitive" } } } } },
      { group: { OR: [{ name: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }] } },
      { corporateCustomer: { companyName: { contains: q, mode: "insensitive" } } },
      ...(digits.length >= 4 ? [{ guest: { phone: { contains: digits.slice(-9) } } }] : []),
      { rooms: { some: { room: { number: q } } } },
      { rooms: { some: { roomType: { name: { contains: q, mode: "insensitive" } } } } },
      // A date (2026-09-30) finds bookings running that day.
      ...(/^\d{4}-\d{2}-\d{2}$/.test(q) ? [{ arrivalDate: { lte: toDbDate(q) }, departureDate: { gte: toDbDate(q) } }] : []),
    ],
  } : {};
  const where: Prisma.ReservationWhereInput = { AND: [q ? search : byView[view], BY_FILTER[filter]] };

  const [rows, total, counts] = await Promise.all([
    db.reservation.findMany({
      where,
      include: {
        guest: { select: { fullName: true, phone: true } }, source: { select: { name: true, code: true } },
        corporateCustomer: { select: { companyName: true } }, createdBy: { select: { fullName: true } }, group: { select: { id: true, name: true } },
        rooms: { where: { status: { notIn: ["CANCELLED"] } }, include: { room: { select: { number: true } }, roomType: { select: { name: true, category: true } } } },
        trips: { where: { status: { not: "CANCELLED" } }, select: { id: true } },
      },
      orderBy: view === "all" || q ? { createdAt: "desc" } : view === "inhouse" || view === "departures" ? { departureDate: "asc" } : [{ arrivalDate: "asc" }, { eta: "asc" }],
      take: PAGE,
      skip: (page - 1) * PAGE,
    }),
    db.reservation.count({ where }),
    Promise.all(VIEWS.map((v) => db.reservation.count({ where: byView[v.key] }))),
  ]);
  // Managers and the MD follow reception's work here; reception books, checks in and out.
  const watching = can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");
  const desk = watching ? await (async () => {
    const [made, ins, outs, paid, cancels, feed] = await Promise.all([
      db.reservation.count({ where: { businessDate: today, kind: "STAY" } }),
      db.auditLog.count({ where: { businessDate: today, action: { in: ["reservation.checked_in", "reservation.walk_in"] } } }),
      db.auditLog.count({ where: { businessDate: today, action: "reservation.checked_out" } }),
      db.payment.aggregate({ where: { businessDate: today, status: "POSTED", kind: "PAYMENT", reservationId: { not: null } }, _sum: { amount: true }, _count: true }),
      db.reservation.count({ where: { OR: [{ status: "CANCELLED", cancelledAt: { gte: new Date(`${todayStr}T01:00:00Z`) } }, { status: "NO_SHOW", noShowAt: { gte: new Date(`${todayStr}T01:00:00Z`) } }] } }),
      db.auditLog.findMany({ where: { businessDate: today, entityType: "Reservation", userId: { not: null } }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, action: true, entityId: true, createdAt: true, user: { select: { fullName: true } } } }),
    ]);
    return { made, ins, outs, paid: paid._sum.amount ?? 0, payments: paid._count, cancels, feed };
  })() : null;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (params: Record<string, string>) => `?${new URLSearchParams({ view, ...(q && { q }), ...(filter && { f: filter }), ...params })}`;

  /** What is happening with this booking right now, and the next step for reception. */
  /** A booking waiting for its guest: late, coming late, today, or in some days (null: none of these). */
  function upcomingSituation(r: (typeof rows)[number], arrival: string, departure: string, nightsLabel: string) {
    const checkIn = { href: `/staff/check-in?id=${r.id}#workspace`, perm: can(user, "reservations.check_in") };
    if (arrival < todayStr && departure > todayStr) return { tag: "Late", tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300", note: `Was due ${formatBusinessDate(arrival)}`, action: { label: "Check in", ...checkIn } };
    if (arrival <= todayStr && r.lateArrivalNotedAt) return { tag: "Late arrival", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300", note: `${r.eta ? `Around ${r.eta} · ` : ""}room kept`, action: { label: "Check in", ...checkIn } };
    if (arrival === todayStr) return { tag: "Expected today", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300", note: r.eta ? `Around ${r.eta} · ${nightsLabel}` : nightsLabel, action: { label: "Check in", ...checkIn } };
    const days = Math.round((Date.parse(arrival) - Date.parse(todayStr)) / 86_400_000);
    if (days > 0) return { tag: days === 1 ? "Tomorrow" : `In ${days} days`, tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300", note: `${nightsLabel}${r.eta ? ` · around ${r.eta}` : ""}`, action: { label: "Prepare", ...checkIn } };
    return null;
  }

  function situation(r: (typeof rows)[number]) {
    const live = r.rooms.filter((x) => x.status === "CHECKED_IN");
    if (r.kind === "MEETING") {
      // Meeting room: by time, in meeting words.
      const m = r.rooms[0];
      const time = m ? timeRange(m.startAt, m.endAt) : "";
      const open = { href: `/staff/reservations/${r.id}`, perm: true };
      if (r.status === "CHECKED_IN") return m && m.endAt <= now
        ? { tag: "Running over", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300", note: `Meeting ${time}`, action: { label: "Complete", ...open } }
        : { tag: "In use", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", note: `Meeting ${time}`, action: { label: "Complete", ...open } };
      if (["RESERVED", "CONFIRMED", "INQUIRY"].includes(r.status)) {
        const d = fromDbDate(r.arrivalDate);
        const days = Math.round((Date.parse(d) - Date.parse(todayStr)) / 86_400_000);
        return { tag: days === 0 ? "Meeting today" : days === 1 ? "Tomorrow" : days > 0 ? `In ${days} days` : "Missed", tone: days < 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300", note: `Meeting ${time}`, action: { label: days === 0 ? "Start" : "Open", ...open } };
      }
      return { tag: MEETING_STATUS_LABEL[r.status], tone: RESERVATION_STATUS_META[r.status].className, note: `Meeting ${time}`, action: null };
    }
    const arrival = fromDbDate(r.arrivalDate), departure = fromDbDate(r.departureDate);
    const nights = r.rooms.reduce((m, x) => Math.max(m, x.nights), 0);
    const nightsLabel = `${nights} night${nights === 1 ? "" : "s"}`;
    if (r.status === "CHECKED_IN" && live.length) {
      const out = live.reduce((m, x) => (x.endAt > m ? x.endAt : m), live[0].endAt);
      const outDate = fromDbDate(live.reduce((m, x) => (x.departureDate > m ? x.departureDate : m), live[0].departureDate));
      const stay = { href: `/staff/check-out?id=${r.id}#workspace`, perm: can(user, "reservations.check_out") };
      if (live.some((x) => x.endAt <= now)) return { tag: "Overdue", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300", note: `Should have left ${outDate === todayStr ? "at" : `${formatBusinessDate(outDate)},`} ${hhmm(out)}`, action: { label: "Check out", ...stay } };
      if (outDate <= todayStr) return { tag: "Leaving today", tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300", note: `Checkout ${hhmm(out)}`, action: { label: "Check out", ...stay } };
      return { tag: "In the hotel", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", note: `Leaves ${outDate === addDays(todayStr, 1) ? "tomorrow" : formatBusinessDate(outDate)} · ${hhmm(out)}`, action: { label: "Open stay", ...stay } };
    }
    if (["RESERVED", "CONFIRMED", "INQUIRY"].includes(r.status)) {
      const when = upcomingSituation(r, arrival, departure, nightsLabel);
      // Not paid, no room held (booked online to pay later, or an enquiry): said first — whoever pays first gets the room.
      if (when && r.status === "INQUIRY") return { ...when, tag: RESERVATION_STATUS_META.INQUIRY.label, tone: RESERVATION_STATUS_META.INQUIRY.className, note: `${when.tag} · ${when.note}` };
      if (when) return when;
    }
    if (r.status === "NO_SHOW") {
      const held = r.rooms.some((x) => x.status === "NO_SHOW" && !x.releasedAt);
      return held
        ? { tag: "No-show · action required", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300", note: "Room still held — keep or release", action: { label: "Decide", href: `/staff/reservations/${r.id}`, perm: true } }
        : { tag: "No-show · room released", tone: "bg-orange-600/10 text-orange-700 dark:text-orange-300", note: nightsLabel, action: null };
    }
    const meta = RESERVATION_STATUS_META[r.status];
    return { tag: meta.label, tone: meta.className, note: nightsLabel, action: null };
  }

  // Coming soon: group under the arrival date.
  const groups: { date: string | null; rows: typeof rows }[] = [];
  for (const r of rows) {
    const date = view === "upcoming" && !q ? fromDbDate(r.arrivalDate) : null;
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.rows.push(r); else groups.push({ date, rows: [r] });
  }

  return (
    <div className="w-full space-y-5">
      {/* Slim header */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-violet-400 to-indigo-600 text-white shadow-[0_10px_24px_-12px_rgb(139_92_246)]"><CalendarRange className="size-6" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">Reservations · {user.roleName}</p>
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">Reservations</h1>
              <p className="text-xs text-muted-foreground">{watching ? "Everyone booked at the hotel — and what reception is doing with them today." : "Everyone booked — who arrives, who is here, who leaves and who is coming."}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/staff/reservations/calendar" className={buttonVariants({ variant: "outline", size: "sm" })}><CalendarRange /> Room schedule</Link>
            <Link href="/staff/groups" className={buttonVariants({ variant: "outline", size: "sm" })}><Users /> Groups</Link>
            {!watching && can(user, "reservations.create") && can(user, "reservations.check_in") && <Link href="/staff/reservations/new?mode=walkin" className={buttonVariants({ variant: "outline", size: "sm" })}><DoorOpen /> Walk-in</Link>}
            {!watching && can(user, "reservations.create") && <Link href="/staff/reservations/new" className={buttonVariants({ size: "sm" })}><CalendarPlus /> New booking</Link>}
          </div>
        </div>
      </section>

      {/* Managers: what reception did today */}
      {desk && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-3">
            {[
              { label: "Bookings made today", value: String(desk.made), icon: CalendarPlus, tint: "bg-violet-500/15 text-violet-400" },
              { label: "Checked in today", value: String(desk.ins), icon: LogIn, tint: "bg-sky-500/15 text-sky-400" },
              { label: "Checked out today", value: String(desk.outs), icon: LogOut, tint: "bg-rose-500/15 text-rose-400" },
              { label: "Money received on bookings", value: formatTZS(desk.paid), sub: `${desk.payments} payment${desk.payments === 1 ? "" : "s"}`, icon: Banknote, tint: "bg-emerald-500/15 text-emerald-500", tone: "text-emerald-600 dark:text-emerald-400" },
              { label: "Still to arrive today", value: String(counts[0]), icon: Clock, tint: "bg-amber-500/15 text-amber-400" },
              { label: "Cancelled · no-shows today", value: String(desk.cancels), icon: Ban, tint: "bg-muted text-muted-foreground" },
            ].map((c) => (
              <div key={c.label} className="min-w-0 bg-card px-4 py-3.5">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3", c.tint)}><c.icon /></span><span className="truncate">{c.label}</span></p>
                <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", c.tone)}>{c.value}</p>
                {c.sub && <p className="truncate text-[11px] text-muted-foreground">{c.sub}</p>}
              </div>
            ))}
          </div>
          <div className="rounded-3xl border border-border/70 bg-card p-4">
            <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" /><span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" /></span>Reception, today</p>
            {desk.feed.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Nothing done on bookings yet today.</p> : (
              <ul className="space-y-1.5">
                {desk.feed.map((a) => (
                  <li key={a.id}>
                    <Link href={a.entityId ? `/staff/reservations/${a.entityId}` : "#"} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs transition-colors hover:bg-muted/50">
                      <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{hhmm(a.createdAt)}</span>
                      <span className="min-w-0 flex-1 truncate"><strong className="font-semibold">{a.user?.fullName.replace(/\s*\(.*\)/, "")}</strong> <span className="text-muted-foreground">{friendlyAction(a.action)}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* View cards */}
      <nav aria-label="Reservation views" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {VIEWS.map((v, i) => {
          const on = !q && view === v.key;
          const I = v.icon;
          return (
            <Link key={v.key} href={`?view=${v.key}`} aria-current={on ? "page" : undefined}
              className={cn("flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-18px_rgba(15,23,42,0.4)]",
                on && cn("ring-2", v.ring), i === 4 && "col-span-2 sm:col-span-1")}>
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5", v.tone)}><I /></span>
              <span className="min-w-0">
                <span className="block text-2xl font-bold leading-none tabular-nums">{counts[i]}</span>
                <span className="mt-1 block truncate text-xs font-semibold">{v.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{v.hint}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <nav aria-label="Filter" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
        <div className="flex w-max gap-1 rounded-2xl border border-border/70 bg-card p-1">
          {FILTERS.map((f) => (
            <Link key={f.key} href={`?${new URLSearchParams({ view, ...(q && { q }), ...(f.key && { f: f.key }) })}`} aria-current={filter === f.key ? "true" : undefined}
              className={cn("whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors", filter === f.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{f.label}</Link>
          ))}
        </div>
      </nav>

      <form className="relative">
        <input type="hidden" name="view" value={view} />
        {filter && <input type="hidden" name="f" value={filter} />}
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={q} placeholder="Search every booking: name, company, phone, reference, room (102) or date (2026-09-30)" className="h-11 rounded-2xl bg-card pl-10" aria-label="Search reservations" />
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={q ? `No reservations match "${q}"` : view === "arrivals" ? "Nobody left to arrive today" : view === "departures" ? "Nobody left to check out today" : view === "inhouse" ? "No guests in the hotel" : "Nothing here yet"}
          description={q ? "Check the spelling or search by phone number or reference." : "Bookings from reception and the website appear here."}
          action={!watching && can(user, "reservations.create") && !q ? <Link href="/staff/reservations/new" className={buttonVariants()}>New booking</Link> : undefined}
        />
      ) : (
        <div className="@container">
          {/* One even flow of small cards; coming soon puts a date tile before each day's arrivals. */}
          <ul className="grid grid-cols-1 gap-2.5 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4 @7xl:grid-cols-5">
            {groups.map((g) => [
              g.date && (
                <li key={`day-${g.date}`} className="flex items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-3.5 py-2.5">
                  <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{Number(g.date.slice(8))}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{g.date === addDays(todayStr, 1) ? "Tomorrow" : new Date(`${g.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{new Date(`${g.date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })} · {g.rows.length} arriving</span>
                  </span>
                </li>
              ),
              ...g.rows.map((r) => {
                  const s = situation(r);
                  const c = colourOf(s.tone);
                  const arrival = fromDbDate(r.arrivalDate), departure = fromDbDate(r.departureDate);
                  const meeting = r.kind === "MEETING";
                  const first = r.rooms[0];
                  const who = meeting && r.companyName ? r.companyName : r.guest.fullName;
                  // Who pays, in plain words: a group or company room never shows as the guest owing.
                  const money = r.billTo === "GROUP" ? { text: `Group pays${r.group ? ` · ${r.group.name}` : ""}`, cls: "text-violet-700 dark:text-violet-300" }
                    : r.billTo !== "GUEST" ? { text: `Company invoice${r.corporateCustomer ? ` · ${r.corporateCustomer.companyName}` : ""}`, cls: "text-violet-700 dark:text-violet-300" }
                      : r.balanceAmount > 0 ? { text: `${r.paidAmount > 0 ? "Part paid · owes" : r.status === "RESERVED" ? "Unpaid · owes" : "Owes"} ${formatTZS(r.balanceAmount)}`, cls: "text-rose-600 dark:text-rose-400" }
                        : r.balanceAmount < 0 ? { text: `Credit ${formatTZS(-r.balanceAmount)}`, cls: "text-amber-700 dark:text-amber-400" }
                          : r.netAmount > 0 ? { text: "Paid in full", cls: "text-emerald-700 dark:text-emerald-400" } : { text: "Nothing to pay", cls: "text-muted-foreground" };
                  const urgent = c.bar === "bg-rose-500";
                  return (
                    <li key={r.id} className={cn("group/card relative flex flex-col overflow-hidden rounded-xl border bg-card bg-linear-to-br to-transparent to-60% py-2.5 pl-3.5 pr-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_12px_26px_-16px_rgba(15,23,42,0.6)] dark:bg-white/[0.035]",
                      urgent ? "border-rose-500/25 hover:border-rose-500/60" : "border-slate-200 hover:border-foreground/20 dark:border-white/[0.12]", c.tint)}>
                      <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r-full", c.bar)} />
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-baseline gap-1.5">
                          <span className="text-lg font-semibold leading-none tracking-tight tabular-nums">{first?.room.number ?? "—"}</span>
                          <span className="truncate text-[10px] text-muted-foreground">{first ? (meeting ? "Meeting room" : first.roomType.name) : "Room to assign"}{r.rooms.length > 1 && ` +${r.rooms.length - 1}`}</span>
                        </span>
                        <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold", s.tone)}>{s.tag}</span>
                      </div>
                      <Link href={`/staff/reservations/${r.id}`} className="mt-1.5 block truncate text-sm font-semibold leading-tight after:absolute after:inset-0">{who}</Link>
                      {meeting && r.companyName && <p className="truncate text-[10px] text-muted-foreground">{r.guest.fullName}</p>}
                      <p className="mt-1 flex min-w-0 items-center gap-1 text-xs tabular-nums">
                        <CalendarRange className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">{meeting ? `${formatShortDate(arrival)} · ${first ? timeRange(first.startAt, first.endAt) : ""}` : `${formatShortDate(arrival)} → ${formatShortDate(departure)}`}</span>
                        {r.trips.length > 0 && <Plane className="size-3 shrink-0 text-sky-500" aria-label="Airport pickup" />}
                      </p>
                      <p className={cn("truncate pl-4 text-[10px]", urgent ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{s.note}</p>
                      <div className="min-h-2.5 flex-1" />
                      <div className="flex items-center justify-between gap-2 border-t border-dashed border-border/70 pt-2">
                        <div className="min-w-0">
                          <p className={cn("truncate text-xs font-semibold tabular-nums", money.cls)}>{money.text}</p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {formatTZS(r.netAmount)} · <span className="font-mono">{r.reference}</span> · {r.source.code === "HOTEL_QR" && <QrCode className="-mt-px mr-0.5 inline size-2.5 text-[oklch(0.8_0.11_82)]" aria-hidden />}{r.source.name}
                            {r.status === "RESERVED" && r.holdUntil ? ` · held till ${formatDateTime(r.holdUntil)}` : ""}
                          </p>
                        </div>
                        {s.action?.perm && !watching && (
                          <Link href={s.action.href} className={cn(buttonVariants({ size: "sm", variant: s.action.label === "Open stay" || s.action.label === "Prepare" ? "outline" : "default" }), "relative z-10 h-7 shrink-0 rounded-lg px-2.5 text-xs")}>{s.action.label}</Link>
                        )}
                      </div>
                    </li>
                  );
              }),
            ])}
          </ul>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {pages} · {total} bookings</span>
          <div className="flex gap-2">
            {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={link({ page: String(page - 1) })}>Previous</Link>}
            {page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={link({ page: String(page + 1) })}>Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
