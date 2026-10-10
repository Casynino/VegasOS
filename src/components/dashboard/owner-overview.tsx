import { inHouseBalances } from "@/server/services/guest-balances";
import Link from "next/link";
import {
  Armchair, Banknote, BedDouble, Boxes, Building2, CircleDollarSign, HandCoins, Inbox, Percent, Receipt, Store, Tag, Timer, TrendingUp, Trophy, UserX, Users, UtensilsCrossed, Wallet, Wrench,
} from "lucide-react";
import { can, requireUser } from "@/server/auth";
import { tablesOnHome } from "@/server/services/table-performance";
import { commandCenter, type Area } from "@/server/services/command-center";
import { LiveBoard, StaffToday } from "./command-center";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { discountLimit } from "@/lib/discounts";
import { getRoomBoard } from "@/server/services/rooms";
import { getShiftOverview } from "@/server/services/shifts";
import { getFrontDeskSnapshot } from "@/server/services/front-desk";
import { requestStats } from "@/server/services/booking-requests";
import { change, dailyMoney, meetingRoomStats, occupancy, outstanding, previousRange, profitLoss, type Range } from "@/server/services/reporting";
import { addDays, diffDays, isBusinessDate, presetRange, toDbDate, type PeriodPreset } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { friendlyAction } from "@/lib/activity-words";
import {
  AttentionCards, Delta, HeroBanner, Initials, Panel, PanelLink, Pill, RoomsGlance, SectionLabel, StatTile, type AttentionItem,
} from "./kit";
import { AreaTrend, Donut } from "./light-charts";
import { GuestsOwingOnHome, RoomsOnHome } from "./desk-on-home";
import { TablesOnHome } from "./tables-on-home";
import { MoneyCard } from "./money-card";
import { TABLE_META } from "./table-meta";
import { BusinessDetail } from "@/app/staff/(app)/finance/finance-overview";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

const PERIODS: { key: PeriodPreset; label: string }[] = [
  { key: "today", label: msg("Today") }, { key: "yesterday", label: msg("Yesterday") }, { key: "week", label: msg("This week") },
  { key: "month", label: msg("This month") }, { key: "year", label: msg("This year") },
];

/** How long something has waited: "12 min", "2 h 5 min", "3 d" — in the reader's language. */
const since = (m: number, t: T) => (m < 60 ? t("{n} min", { n: m }) : m < 1440 ? (m % 60 ? t("{h} h {m} min", { h: Math.floor(m / 60), m: m % 60 }) : t("{h} h", { h: Math.floor(m / 60) })) : t("{n} d", { n: Math.floor(m / 1440) }));

const friendly = friendlyAction;

/**
 * The owner's view of the hotel (admin & manager): compact banner, quick
 * actions, what needs attention, the rooms today, money and performance,
 * then trends and who is coming and going. Light, soft cards; phone-first.
 */
/** Online booking states, calm on the dark dashboard. */
const REQUEST_LOOK: Record<string, { label: string; tone: string }> = {
  NEW: { label: msg("New"), tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  REVIEWING: { label: msg("Looking"), tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  CONTACTED: { label: msg("Called"), tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  CONFIRMED: { label: msg("Agreed"), tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  CONVERTED: { label: msg("Booked"), tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  REJECTED: { label: msg("Rejected"), tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  CANCELLED: { label: msg("Cancelled"), tone: "bg-muted text-muted-foreground" },
};

export async function OwnerOverview({ searchParams, basePath }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  roleLabel: string;
  basePath: string;
}) {
  const user = await requireUser();
  const t = await getT();
  const sp = await searchParams;
  const today = await businessToday();
  const preset = PERIODS.find((p) => p.key === sp.period)?.key;
  const custom = isBusinessDate(sp.from) && isBusinessDate(sp.to) && String(sp.from) <= String(sp.to);
  const range: Range = custom ? { from: String(sp.from), to: String(sp.to) } : presetRange(preset ?? "today", today);
  const periodKey = custom ? "custom" : preset ?? "today";
  const prev = previousRange(range);
  const days = diffDays(range.from, range.to) + 1;
  const trend: Range = days < 14 ? { from: addDays(range.to, -13), to: range.to } : range;

  const inHouse = await inHouseBalances(today);
  // Company invoices: money a company owes (a receivable) — not revenue again, not money in.
  const overdueInvoices = await db.invoice.aggregate({
    where: { reservationId: null, balanceAmount: { gt: 0 }, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }, dueDate: { lt: new Date(`${today}T00:00:00Z`) } },
    _sum: { balanceAmount: true }, _count: true,
  });
  const [pl, plPrev, occ, occPrev, occTrend, trendPl, owed, allRooms, snap, shift, reqs, payments, activity, meeting, latestRequests, qrBooked] = await Promise.all([
    profitLoss(range), profitLoss(prev), occupancy(range), occupancy(prev), occupancy(trend), profitLoss(trend), outstanding(), getRoomBoard(today),
    getFrontDeskSnapshot(today), getShiftOverview(today), requestStats(range.from, range.to),
    db.payment.findMany({
      where: { status: "POSTED" }, orderBy: { receivedAt: "desc" }, take: 5,
      include: { method: true, reservation: { select: { id: true, guest: { select: { fullName: true } } } } },
    }),
    db.auditLog.findMany({ where: { userId: { not: null }, action: { notIn: ["auth.login", "auth.logout"] } }, orderBy: { createdAt: "desc" }, take: 6, include: { user: { select: { fullName: true } } } }),
    meetingRoomStats(range),
    // The latest website / WhatsApp booking requests, newest first.
    db.bookingRequest.findMany({
      orderBy: { createdAt: "desc" }, take: 4,
      select: { id: true, fullName: true, companyName: true, status: true, checkInDate: true, checkOutDate: true, roomCount: true, meetingStartAt: true, createdAt: true, roomType: { select: { name: true } }, source: { select: { name: true } } },
    }),
    // Booked by guests themselves from the Hotel QR in the period (pay now and pay later, by the day they were made).
    db.reservation.groupBy({
      by: ["status"], _count: true,
      where: { source: { code: "HOTEL_QR" }, businessDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) } },
    }),
  ]);
  const qr = {
    booked: qrBooked.reduce((t, g) => t + g._count, 0),
    confirmed: qrBooked.filter((g) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(g.status)).reduce((t, g) => t + g._count, 0),
  };
  // Guest rooms only on the room tiles; the meeting room has its own tile (utilisation, not occupancy).
  const board = allRooms.filter((r) => r.roomType.category === "GUEST_ROOM");
  const rev = pl.revenue;
  const n = (s: string[]) => board.filter((r) => s.includes(r.displayStatus)).length;
  const rooms = { occupied: n(["OCCUPIED"]), reserved: n(["RESERVED"]), ready: n(["AVAILABLE", "READY"]), cleaning: n(["DIRTY", "CLEANING"]), blocked: n(["MAINTENANCE", "OUT_OF_SERVICE"]), total: board.length };
  const tonightPct = rooms.total ? (rooms.occupied / rooms.total) * 100 : 0;
  const periodLabel = days === 1 ? t.date(range.from, true) : t.dateRange(range.from, range.to);
  const vsLabel = days === 1 ? t("yesterday") : t("previous period");
  const now = new Date();
  const extensionsToday = await db.auditLog.count({ where: { action: "reservation.extended", createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } });
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(now));
  const firstName = user.fullName.split(" ")[0];
  const greeting = hour < 12 ? t("Good morning, {name}", { name: firstName }) : hour < 17 ? t("Good afternoon, {name}", { name: firstName }) : t("Good evening, {name}", { name: firstName });
  // What each guest really owes (a group pays its rooms) — the same rule as the front desk.
  const owedBy = new Map(inHouse.rows.map((x) => [x.reservationId, x.outstanding]));
  const departuresOwing = snap.departures.filter((r) => (owedBy.get(r.id) ?? Math.max(0, r.balanceAmount)) > 0);
  const q = (p: string) => (custom ? `from=${range.from}&to=${range.to}` : `period=${p}`);
  const revSpark = trendPl.revenue.daily.map((d) => d.rooms + d.other);

  const overdueNow = snap.departures.filter((r) => r.rooms.some((x) => x.status === "CHECKED_IN" && x.endAt <= now));
  // To follow what reception and the restaurant are doing (the manager watches — reception checks in and out).
  // Today, always (the cards at the top) — the period chosen further down drives the rest.
  const todayOnly = { from: today, to: today }, yesterday = { from: addDays(today, -1), to: addDays(today, -1) };
  const liveOrders = { status: { not: "CANCELLED" as const } };
  const [tables, plToday, cashToday, cashYesterday, occToday, foodToday, foodYesterday] = await Promise.all([
    tablesOnHome(today, todayOnly, now),
    periodKey === "today" ? pl : profitLoss(todayOnly),
    dailyMoney(todayOnly),
    dailyMoney(yesterday),
    periodKey === "today" ? occ : occupancy(todayOnly),
    db.restaurantOrder.aggregate({ where: { businessDate: toDbDate(today), ...liveOrders }, _sum: { foodSubtotal: true, drinksSubtotal: true, serviceFee: true, total: true }, _count: true }),
    db.restaurantOrder.aggregate({ where: { businessDate: toDbDate(addDays(today, -1)), ...liveOrders }, _sum: { total: true } }),
  ]);
  const revToday = plToday.revenue;
  // Money really received today (every account) — the headline (owner, 2026-10-05: "the boss will think we have
  // 160,000 but we don't have the money"). What was earned (rooms sold, food served) is shown beside it, with what
  // guests still owe — earned is not money in hand.
  const receivedToday = cashToday[0]?.received ?? 0;
  const receivedYesterday = cashYesterday[0]?.received ?? 0;
  const owedNow = inHouse.summary.totalOutstanding;
  const profitToday = plToday.estimatedProfit;
  const rateToday = occToday.roomsSold ? Math.round(revToday.rooms.net / occToday.roomsSold) : 0;
  const foodTotal = foodToday._sum.total ?? 0;
  const floor = tables.places.filter((p) => p.kind === "TABLE");
  const tablesAt = (s: (keyof typeof TABLE_META)[]) => floor.filter((p) => s.includes(p.state)).length;
  const slowPay = tables.places.filter((p) => p.state === "BILL" && (p.now?.billAsked ?? 0) >= 15);
  // The Boss's daily report message that did not go out (the report itself is kept).
  const lastReport = await db.dailyReport.findFirst({ orderBy: { businessDate: "desc" }, select: { id: true, generatedAt: true, deliveries: { select: { status: true, sentAt: true } } } });
  const reportFailed = !!lastReport && lastReport.deliveries.some((x) => x.status === "FAILED") && !lastReport.deliveries.some((x) => x.status === "SENT" && x.sentAt && x.sentAt >= lastReport.generatedAt);
  // The command centre: what needs a decision now (timed), the live board and staff activity.
  const command = await commandCenter({
    today, now,
    tablesWaiting: slowPay.map((p) => ({ id: p.id, name: p.name, minutes: p.now?.billAsked ?? 0, due: p.now?.due ?? 0 })),
    tables: { seated: tablesAt(["SEATED", "BILL"]), bill: tablesAt(["BILL"]), free: tablesAt(["FREE"]), total: floor.length },
    shiftOpen: shift.openAll.map((o) => o.user.fullName).join(" & ") || null,
    expensesPending: { count: pl.expenseSummary.pending.count, amount: pl.expenseSummary.pending.amount },
    reportFailedId: reportFailed ? lastReport!.id : null,
    extra: [
      ...(snap.unpaidAfterCheckout.count ? [{ id: "left-unpaid", area: "Guests" as const, tone: "rose" as const, title: t("{n} left without paying in full", { n: snap.unpaidAfterCheckout.count }), detail: t("Balance still open after checkout"), minutes: null, href: "/staff/finance/receivables", act: t("Follow up the money") }] : []),
      // Tables: a very long sitting, paid but not cleared, blocked by a manager.
      ...floor.filter((p) => p.now && p.state !== "PAID" && p.now.minutes >= 180).map((p) => ({ id: `tb-long-${p.id}`, area: "Tables" as const, tone: "sky" as const, title: t("{table} — seated for {time}", { table: p.name, time: since(p.now!.minutes, t) }), detail: `${p.now!.customer} · ${t("{amount} to pay", { amount: formatTZS(p.now!.due) })}`, minutes: p.now!.minutes, href: `/staff/restaurant/tables?table=${p.id}`, act: t("Check on them — bill or more orders?") })),
      ...floor.filter((p) => p.state === "PAID" && (p.now?.paidAgo ?? 0) >= 30).map((p) => ({ id: `tb-paid-${p.id}`, area: "Tables" as const, tone: "amber" as const, title: t("{table} — paid {time} ago, not cleared", { table: p.name, time: since(p.now!.paidAgo!, t) }), detail: `${p.now!.customer} · ${t("the table can't seat new customers")}`, minutes: p.now!.paidAgo!, href: `/staff/restaurant/tables?table=${p.id}`, act: t("Clear the table") })),
      ...floor.filter((p) => p.state === "BLOCKED").map((p) => ({ id: `tb-block-${p.id}`, area: "Tables" as const, tone: "slate" as const, title: `${p.name} — ${p.blocked?.as === "MAINTENANCE" ? t("under maintenance") : t("not available")}`, detail: p.blocked?.reason ?? t("No reason written"), minutes: null, href: `/staff/restaurant/tables?table=${p.id}`, act: t("Reopen it when ready") })),
    ],
  });
  const liveTime = t.time(now);
  // The attention card (as before), now with the timed items: how long each has waited.
  const AREA_ICON: Record<Area, React.ReactNode> = {
    Guests: <Users />, Rooms: <BedDouble />, Restaurant: <UtensilsCrossed />, Tables: <Armchair />, Payments: <HandCoins />,
    Stores: <Boxes />, Maintenance: <Wrench />, Staff: <UserX />, Bookings: <Inbox />,
  };
  // The area chips, in the reader's language (the same words group the rows).
  const AREA_GROUP: Record<Area, string> = { Guests: t("Front desk"), Rooms: t("Rooms"), Restaurant: t("Restaurant"), Tables: t("Restaurant"), Payments: t("Money"), Stores: t("Stores"), Maintenance: t("Maintenance"), Staff: t("Front desk"), Bookings: t("Bookings") };
  const attention: AttentionItem[] = command.decisions.map((d) => ({
    tone: d.tone, icon: AREA_ICON[d.area], group: AREA_GROUP[d.area], title: t(d.title), href: d.href,
    detail: `${t(d.detail)} · ${t(d.act)}`, meta: d.minutes ? t("{time} waiting", { time: since(d.minutes, t) }) : undefined,
  }));
  const movement = [
    ...snap.arrivals.map((r) => ({ id: r.id, name: r.guest.fullName, kind: "Arriving" as const, room: r.rooms.map((x) => x.room.number).join(", "), when: r.eta ?? "—", status: r.status, balance: r.balanceAmount })),
    ...snap.departures.map((r) => ({ id: r.id, name: r.guest.fullName, kind: "Leaving" as const, room: r.rooms.filter((x) => x.status === "CHECKED_IN").map((x) => x.room.number).join(", "), when: t("by {time}", { time: "11:00" }), status: "CHECKED_IN", balance: r.balanceAmount })),
  ];

  return (
    <div className="w-full space-y-6">
      <HeroBanner
        eyebrow={t("Management · {role}", { role: t(user.roleName) })}
        title={greeting}
        subtitle={<>{t.rich("<b>{occupied} of {total}</b> rooms occupied tonight · <g>{received}</g> received today", {
          b: (c) => <strong className="font-semibold text-white">{c}</strong>, g: (c) => <strong className="font-semibold text-emerald-300">{c}</strong>,
        }, { occupied: rooms.occupied, total: rooms.total, received: formatTZS(receivedToday) })}{owedNow > 0 && <> · {t.rich("<a>{owed}</a> not paid yet by guests", { a: (c) => <strong className="font-semibold text-amber-300">{c}</strong> }, { owed: formatTZS(owedNow) })}</>}</>}
      />

      <div>
        <SectionLabel title={t("Needs your attention")} count={attention.length} t={t} />
        <AttentionCards items={attention} t={t} />
      </div>

      {/* ── Rooms today ── */}
      <div>
        <SectionLabel title={t("Rooms today")} href="/staff/rooms" linkLabel={t("Room board")} t={t} />
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <div>
            <RoomsGlance t={t} href="/staff/rooms" total={rooms.total} center={{ value: `${Math.round(tonightPct)}%`, label: t("full tonight"), sub: t("{n} of {total}", { n: rooms.occupied, total: rooms.total }) }} parts={[
              { label: t("Occupied"), value: rooms.occupied, color: "#34d399" },
              { label: t("Booked · arriving"), value: rooms.reserved, color: "#fbbf24" },
              { label: t.ctx("room", "Available"), value: rooms.ready, color: "#38bdf8" },
              { label: t.ctx("room", "Cleaning"), value: rooms.cleaning, color: "#a78bfa" },
              { label: t("Maintenance"), value: rooms.blocked, color: "#fb7185" },
            ]} footer={<div className="space-y-1"><p>{t.rich("{arriving} arriving · {leaving} leaving · <o>{overdue} overdue</o> · {extended} extended (24h)", { o: (c) => <span className={overdueNow.length ? "font-semibold text-rose-300" : ""}>{c}</span> }, { arriving: snap.arrivals.length, leaving: snap.departures.length, overdue: overdueNow.length, extended: extensionsToday })}</p><p>{shift.openAll.length ? t.rich("On the front desk: <b>{names}</b>", { b: (c) => <strong className="text-white">{c}</strong> }, { names: shift.openAll.map((o) => o.user.fullName).join(" & ") }) : t("No reception shift started yet")}</p></div>} />
          </div>
          <MoneyCard title={t("Money today")} href="/staff/reports" linkLabel={t("Today's report")}
            headline={{ value: formatTZS(receivedToday), label: t("Received today — money really in the hotel's accounts"), delta: change(receivedToday, receivedYesterday) }}
            split={[
              { label: t("Received today"), value: receivedToday, color: "#10b981" },
              { label: t("Not paid yet (guests owe)"), value: owedNow, color: "#f59e0b" },
            ]}
            cells={[
              { label: t("Earned today"), icon: <Banknote />, tint: "bg-violet-500/15 text-violet-400", value: formatTZS(plToday.netRevenue), sub: t("rooms sold + food served — paid or not"), href: `/staff/payments?from=${today}&to=${today}` },
              { label: t.ctx("money", "Spent"), icon: <Receipt />, tint: "bg-rose-500/15 text-rose-400", value: formatTZS(plToday.expenses), sub: t.plural(plToday.expenseSummary.count, "{n} expense", "{n} expenses"), href: "/staff/expenses" },
              { label: profitToday >= 0 ? t("Profit (estimate)") : t("Loss (estimate)"), icon: <TrendingUp />, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.8_0.11_82)]", value: formatTZS(Math.abs(profitToday)), sub: t("earned − spent · on paper"), tone: profitToday >= 0 ? "good" : "bad" },
              { label: t("Not paid yet"), icon: <Wallet />, tint: "bg-amber-500/15 text-amber-400", value: formatTZS(owedNow), sub: owedNow ? (departuresOwing.length ? t("guests owe · {n} leaving today", { n: departuresOwing.length }) : t("guests owe · {n} staying", { n: inHouse.summary.owingCount })) : t("guests have paid"), tone: owedNow ? "warn" : undefined, href: "/staff/finance/receivables" },
              { label: t("Income per room"), icon: <BedDouble />, tint: "bg-violet-500/15 text-violet-400", value: formatTZS(rooms.total ? Math.round(revToday.rooms.net / rooms.total) : 0), sub: t("across {n} rooms", { n: rooms.total }) },
              { label: t("Average room rate"), icon: <Tag />, tint: "bg-sky-500/15 text-sky-400", value: rateToday ? formatTZS(rateToday) : t("None yet"), sub: t.plural(occToday.roomsSold, "{n} room sold today", "{n} rooms sold today") },
            ]} />
        </div>
        <div className="mt-4"><RoomsOnHome today={today} rooms={allRooms} discountMax={discountLimit(user.permissions, await getSettings())} /></div>
      </div>

      {/* ── Tables today: the restaurant floor, like the rooms ── */}
      <div>
        <SectionLabel title={t("Tables today")} href="/staff/restaurant/tables" linkLabel={t("The floor")} t={t} />
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <div>
            <RoomsGlance t={t} href="/staff/restaurant/tables" title={t("Tables now")} unit={t("tables")} total={floor.length} center={{ value: `${floor.length ? Math.round((tablesAt(["SEATED", "ORDERS", "BILL", "PAID"]) / floor.length) * 100) : 0}%`, label: t("busy now"), sub: t("{n} of {total}", { n: tablesAt(["SEATED", "ORDERS", "BILL", "PAID"]), total: floor.length }) }} parts={[
              { label: t.ctx("table", TABLE_META.SEATED.label), value: tablesAt(["SEATED", "ORDERS"]), color: TABLE_META.SEATED.hex },
              { label: t.ctx("table", TABLE_META.BILL.label), value: tablesAt(["BILL"]), color: TABLE_META.BILL.hex },
              { label: t.ctx("table", TABLE_META.PAID.label), value: tablesAt(["PAID"]), color: TABLE_META.PAID.hex },
              { label: t.ctx("table", TABLE_META.RESERVED.label), value: tablesAt(["RESERVED"]), color: TABLE_META.RESERVED.hex },
              { label: t.ctx("table", TABLE_META.FREE.label), value: tablesAt(["FREE"]), color: TABLE_META.FREE.hex },
            ]} footer={<div className="space-y-1"><p>{t.plural(tables.summary.people, "{n} person at the tables", "{n} people at the tables")} · {t.plural(tables.summary.upcoming, "{n} reservation later", "{n} reservations later")}</p><p>{tables.summary.due ? t.rich("To pay at the tables: <b>{amount}</b>", { b: (c) => <strong className="text-white">{c}</strong> }, { amount: formatTZS(tables.summary.due) }) : t("Nothing waiting to be paid at the tables")}</p></div>} />
          </div>
          <MoneyCard title={t("Restaurant & bar today")} href="/staff/restaurant" linkLabel={t("Live orders")}
            headline={{ value: formatTZS(foodTotal), label: t.plural(foodToday._count, "{n} order today · every place", "{n} orders today · every place"), delta: change(foodTotal, foodYesterday._sum.total ?? 0) }}
            split={[
              { label: t("Food"), value: foodToday._sum.foodSubtotal ?? 0, color: "#f59e0b" },
              { label: t("Drinks"), value: foodToday._sum.drinksSubtotal ?? 0, color: "#0ea5e9" },
              { label: t("Room service fees"), value: foodToday._sum.serviceFee ?? 0, color: "#f43f5e" },
            ]}
            cells={[
              { label: t("At the tables"), icon: <Store />, tint: "bg-amber-500/15 text-amber-400", value: formatTZS(tables.summary.sales), sub: t.plural(tables.summary.orders, "{n} order", "{n} orders"), href: "/staff/restaurant/tables" },
              { label: t("Customers today"), icon: <Users />, tint: "bg-sky-500/15 text-sky-400", value: String(tables.summary.customers), sub: tables.summary.people ? t("{n} at the tables now", { n: tables.summary.people }) : t("nobody seated now") },
              { label: t("Average bill"), icon: <Receipt />, tint: "bg-violet-500/15 text-violet-400", value: tables.summary.avgBill ? formatTZS(tables.summary.avgBill) : t("None yet"), sub: t("per customer") },
              { label: t("To pay at the tables"), icon: <HandCoins />, tint: "bg-rose-500/15 text-rose-400", value: formatTZS(tables.summary.due), sub: tables.summary.bill ? t("{n} asked for the bill", { n: tables.summary.bill }) : t("not asked yet"), tone: tables.summary.due ? "warn" : undefined, href: "/staff/restaurant/tables" },
              { label: t("Time at the table"), icon: <Timer />, tint: "bg-emerald-500/15 text-emerald-500", value: tables.summary.minutes != null ? t("{n} min", { n: tables.summary.minutes }) : t("None yet"), sub: t("average stay") },
              { label: t("Best table"), icon: <Trophy />, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.8_0.11_82)]", value: tables.summary.best ? tables.summary.best.name.replace(/\s—\s.*/, "") : "—", sub: tables.summary.best ? `${t(tables.summary.best.name.replace(/^.*—\s/, ""))} · ${formatTZS(tables.summary.best.sales)}` : t("no table sales yet") },
            ]} />
        </div>
        <div className="mt-4"><TablesOnHome data={tables} period={t("Today")} canManage={can(user, "restaurant.menu") || can(user, "settings.manage")} canDecide /></div>
      </div>

      {/* ── Every department right now, and what the staff have done today ── */}
      <LiveBoard data={command} time={liveTime} />
      <StaffToday data={command} today={today} />

      {/* ── Money & performance for the chosen period ── */}
      <div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{periodKey === "today" ? t("The business · pick a period") : t("Money · {period}", { period: periodLabel })}</h2>
          <nav aria-label={t("Period")} className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] sm:rounded-full sm:border sm:border-border sm:bg-card sm:p-1">
            {PERIODS.map((p) => (
              <Link key={p.key} href={`${basePath}?period=${p.key}`} aria-current={periodKey === p.key ? "page" : undefined}
                className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors", periodKey === p.key ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground sm:bg-transparent")}>
                {t(p.label)}
              </Link>
            ))}
          </nav>
        </div>
        {/* Today's money is in the cards at the top — these show the other periods. */}
        {periodKey !== "today" && <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatTile label={t("Earned (revenue)")} value={formatTZS(pl.netRevenue)} icon={<CircleDollarSign />} tone="gold" spark={revSpark}
            delta={<Delta value={change(pl.netRevenue, plPrev.netRevenue)} label={vsLabel} t={t} />} href={`/staff/reports?${q(periodKey)}`} />
          <StatTile label={t("Collected (money in)")} value={formatTZS(rev.paymentsCollected)} icon={<Banknote />} tone="emerald" sub={t("Cash, mobile, card & bank")} href={`/staff/payments?from=${range.from}&to=${range.to}`} />
          <StatTile label={t("To collect now")} value={formatTZS(inHouse.summary.totalOutstanding)} icon={<Wallet />} tone="rose"
            sub={inHouse.summary.owingCount ? t.plural(inHouse.summary.owingCount, "{n} guest staying owe · {total} owed in total", "{n} guests staying owe · {total} owed in total", { total: formatTZS(owed.total) }) : owed.total ? t("Guests staying have paid · {total} owed in total", { total: formatTZS(owed.total) }) : t("Guests staying have paid")}
            href="/staff/finance/receivables" />
          <StatTile label={t("Owed by companies")} value={formatTZS(owed.invoices.amount)} icon={<Building2 />} tone="amber"
            sub={owed.invoices.count ? `${t.plural(owed.invoices.count, "{n} unpaid invoice", "{n} unpaid invoices")}${overdueInvoices._count ? ` · ${t("{amount} overdue", { amount: formatTZS(overdueInvoices._sum.balanceAmount ?? 0) })}` : ""}` : t("No unpaid company invoices")}
            href="/staff/finance/receivables" />
          <StatTile label={t("Expenses")} value={formatTZS(pl.expenses)} icon={<Receipt />} tone="rose" sub={t("Costs paid")} href="/staff/expenses" />
          <StatTile label={t("Guest-room occupancy")} value={`${occ.occupancy.toFixed(0)}%`} icon={<Percent />} tone="sky"
            delta={<Delta value={occPrev.sellableNights ? occ.occupancy - occPrev.occupancy : null} unit={` ${t("pts")}`} label={vsLabel} t={t} />}
            sub={`${t("{n} room nights", { n: occ.roomNights })}${meeting.rooms ? ` · ${t("meeting room {pct}% used", { pct: meeting.utilisation.toFixed(0) })} · ${t.plural(meeting.bookings, "{n} booking", "{n} bookings")} · ${formatTZS(meeting.revenue)}` : ""}`} />
        </div>}
      </div>

      <Panel title={t("Occupancy")} subtitle={days < 14 ? t("Last 14 hotel days") : periodLabel} action={<PanelLink href="/staff/reports">{t("Reports")}</PanelLink>}>
        <AreaTrend data={occTrend.series.map((d) => ({ date: d.date, value: d.occupancy }))} unit="percent" color="#8b5cf6" height={230} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t("Arrivals & departures today")} className="lg:col-span-2" action={<PanelLink href="/reception/dashboard">{t("Front desk")}</PanelLink>} bodyClassName="-mx-4 sm:-mx-6">
          {movement.length === 0 ? <p className="px-4 text-sm text-muted-foreground sm:px-6">{t("No more guests arriving or leaving today.")}</p> : (
            // Four guests show (with a peek of the fifth); the rest scroll under the headings.
            <div className="max-h-[17rem] overflow-auto overscroll-contain [scrollbar-width:thin]">
              <table data-stack className="w-full min-w-[520px] text-sm">
                <thead className="sticky top-0 z-10 bg-card"><tr className="text-left text-xs text-muted-foreground"><th className="px-4 pb-2 font-medium sm:px-6">{t("Guest")}</th><th className="pb-2 font-medium">{t("Room")}</th><th className="pb-2 font-medium">{t("When")}</th><th className="pb-2 font-medium">{t("Status")}</th><th className="pb-2 pr-4 text-right font-medium sm:pr-6">{t("Balance")}</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {movement.map((g) => (
                    <tr key={`${g.kind}-${g.id}`} className="transition-colors hover:bg-muted">
                      <td className="px-4 py-3 sm:px-6"><Link href={`/staff/reservations/${g.id}`} className="flex items-center gap-2.5 font-medium text-foreground"><Initials name={g.name} />{g.name}</Link></td>
                      <td className="tabular-nums text-muted-foreground">{g.room || "—"}</td>
                      <td className="text-muted-foreground">{g.when}</td>
                      <td><Pill kind={g.kind === "Arriving" ? g.status : "LATE"}>{g.kind === "Arriving" ? t("Arriving") : t("Leaving")}</Pill></td>
                      <td className="pr-4 text-right sm:pr-6">{g.balance > 0 ? <Pill kind="OWES">{formatTZS(g.balance)}</Pill> : <Pill kind="PAID">{t("Paid")}</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title={t("Where the money comes from")} subtitle={periodLabel}>
          <Donut center={{ label: t("earned"), value: formatTZS(pl.netRevenue).replace("TZS ", "") }} data={[
            { name: t("Rooms"), value: rev.rooms.net }, { name: t("Restaurant"), value: rev.restaurant }, { name: t("Bar"), value: rev.bar },
            { name: t("Meeting room"), value: rev.meeting }, { name: t("Room service"), value: rev.roomService }, { name: t("Transport"), value: rev.transport }, { name: t("Other"), value: rev.other },
          ]} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t("Online bookings")} subtitle={periodLabel} action={<PanelLink href="/staff/booking-requests">{t.ctx("link", "Open")}</PanelLink>}>
          {/* The period in one quiet strip, like the other figures */}
          <div className="grid grid-cols-3 divide-x divide-border/70 rounded-2xl border border-border/70 text-center">
            {([[msg("Received"), reqs.total, "text-sky-600 dark:text-sky-300"], [msg("Booked"), reqs.converted, "text-emerald-600 dark:text-emerald-400"], [msg("Waiting"), reqs.pending, reqs.pending ? "text-amber-600 dark:text-amber-300" : "text-foreground"]] as const).map(([k, v, c]) => (
              <div key={k} className="px-2 py-2.5"><p className={cn("text-xl font-semibold tabular-nums", c)}>{v}</p><p className="text-[11px] text-muted-foreground">{t(k)}</p></div>
            ))}
          </div>
          {reqs.conversionRate !== null && <p className="mt-2.5 text-xs text-muted-foreground">{reqs.bySource.length
            ? t.rich("<b>{pct}%</b> became bookings · most from {source}.", { b: (c) => <strong className="font-semibold text-foreground">{c}</strong> }, { pct: Math.round(reqs.conversionRate), source: t([...reqs.bySource].sort((a, b) => b.count - a.count)[0].name) })
            : t.rich("<b>{pct}%</b> became bookings.", { b: (c) => <strong className="font-semibold text-foreground">{c}</strong> }, { pct: Math.round(reqs.conversionRate) })}</p>}
          {/* Hotel QR bookings are made straight into the reservations (no request first): counted here beside them. */}
          {qr.booked > 0 && (
            <Link href="/staff/hotel-qr" className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs hover:bg-muted">
              <span className="text-muted-foreground">{t("Hotel QR")}</span>
              <span>{t.rich("<b>{booked}</b> booked · <b>{confirmed}</b> confirmed", { b: (c) => <strong className="font-semibold tabular-nums text-foreground">{c}</strong> }, { booked: qr.booked, confirmed: qr.confirmed })}</span>
            </Link>
          )}
          {/* The latest ones, like the payments beside it */}
          {latestRequests.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t("No online bookings yet.")}</p> : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {latestRequests.map((q) => {
                const nights = Math.max(1, Math.round((+q.checkOutDate - +q.checkInDate) / 86_400_000));
                const day = new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${q.checkInDate.toISOString().slice(0, 10)}T00:00:00Z`));
                const st = REQUEST_LOOK[q.status] ?? REQUEST_LOOK.CANCELLED;
                return (
                  <li key={q.id}>
                    <Link href={`/staff/booking-requests/${q.id}`} className="flex items-center gap-3 py-3">
                      <Initials name={q.companyName ?? q.fullName} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{q.companyName ?? q.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">{q.meetingStartAt ? t("Meeting · {date}", { date: day }) : `${day} · ${t.plural(nights, "{n} night", "{n} nights")} · ${q.roomCount > 1 ? `${q.roomCount} × ` : ""}${t(q.roomType.name)}`} · {t(q.source.name)}</span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", st.tone)}>{t.ctx("request", st.label)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title={t("Latest payments")} action={<PanelLink href="/staff/payments" t={t} />}>
          {payments.length === 0 ? <p className="text-sm text-muted-foreground">{t("No payments yet.")}</p> : (
            <ul className="divide-y divide-border text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <Initials name={p.reservation?.guest.fullName ?? "Payment"} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{p.reservation?.guest.fullName ?? t("Payment")}</span>
                    <span className="text-xs text-muted-foreground">{t(p.method.name)} · {t.dateTime(p.receivedAt)}</span></span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", p.kind === "REFUND" ? "text-rose-600" : "text-emerald-600")}>{p.kind === "REFUND" ? "−" : "+"}{formatTZS(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t("What the team is doing")} action={<PanelLink href="/staff/activity" t={t} />}>
          <ul className="space-y-3.5 text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-3">
                <Initials name={a.user?.fullName ?? "?"} />
                <span className="min-w-0"><span className="font-medium text-foreground">{a.user?.fullName}</span> <span className="text-muted-foreground">{t(friendly(a.action))}</span>
                  <span className="block text-xs text-muted-foreground">{t.dateTime(a.createdAt)}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* The business in detail — the same picture as Finance → Overview, for the period chosen above */}
      <div>
        <SectionLabel title={t("The business in detail")} href={`/staff/finance?${periodKey === "custom" ? `from=${range.from}&to=${range.to}` : `period=${periodKey}`}`} linkLabel={t("Finance")} t={t} />
        <BusinessDetail p={{ key: periodKey, from: range.from, to: range.to }} today={today} />
      </div>

      {/* At the bottom: the guests staying who still owe (reception collects it) */}
      <GuestsOwingOnHome balances={inHouse} />

      <p className="pb-2 text-center text-xs text-muted-foreground">{t("Figures come straight from bookings, payments and expenses recorded by staff.")}</p>
    </div>
  );
}
