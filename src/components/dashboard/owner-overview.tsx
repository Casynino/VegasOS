import { inHouseBalances } from "@/server/services/guest-balances";
import Link from "next/link";
import {
  Armchair, Banknote, BedDouble, Boxes, Building2, CircleDollarSign, HandCoins, Inbox, Percent, Receipt, Store, Tag, Timer, TrendingUp, Trophy, UserX, Users, UtensilsCrossed, Wallet, Wrench,
} from "lucide-react";
import { can, requireUser } from "@/server/auth";
import { tablesOnHome } from "@/server/services/table-performance";
import { ago, commandCenter, type Area } from "@/server/services/command-center";
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
import { formatBusinessDate, formatDateRange, formatDateTime, formatTZS } from "@/lib/format";
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

const PERIODS: { key: PeriodPreset; label: string }[] = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" }, { key: "week", label: "This week" },
  { key: "month", label: "This month" }, { key: "year", label: "This year" },
];

const friendly = friendlyAction;

/**
 * The owner's view of the hotel (admin & manager): compact banner, quick
 * actions, what needs attention, the rooms today, money and performance,
 * then trends and who is coming and going. Light, soft cards; phone-first.
 */
/** Online booking states, calm on the dark dashboard. */
const REQUEST_LOOK: Record<string, { label: string; tone: string }> = {
  NEW: { label: "New", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  REVIEWING: { label: "Looking", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  CONTACTED: { label: "Called", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  CONFIRMED: { label: "Agreed", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  CONVERTED: { label: "Booked", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  REJECTED: { label: "Rejected", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  CANCELLED: { label: "Cancelled", tone: "bg-muted text-muted-foreground" },
};

export async function OwnerOverview({ searchParams, basePath }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  roleLabel: string;
  basePath: string;
}) {
  const user = await requireUser();
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
  const periodLabel = days === 1 ? formatBusinessDate(range.from, true) : formatDateRange(range.from, range.to);
  const vsLabel = days === 1 ? "yesterday" : "previous period";
  const now = new Date();
  const extensionsToday = await db.auditLog.count({ where: { action: "reservation.extended", createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } });
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
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
      ...(snap.unpaidAfterCheckout.count ? [{ id: "left-unpaid", area: "Guests" as const, tone: "rose" as const, title: `${snap.unpaidAfterCheckout.count} left without paying in full`, detail: "Balance still open after checkout", minutes: null, href: "/staff/finance/receivables", act: "Follow up the money" }] : []),
      // Tables: a very long sitting, paid but not cleared, blocked by a manager.
      ...floor.filter((p) => p.now && p.state !== "PAID" && p.now.minutes >= 180).map((p) => ({ id: `tb-long-${p.id}`, area: "Tables" as const, tone: "sky" as const, title: `${p.name} — seated for ${ago(p.now!.minutes)}`, detail: `${p.now!.customer} · ${formatTZS(p.now!.due)} to pay`, minutes: p.now!.minutes, href: `/staff/restaurant/tables?table=${p.id}`, act: "Check on them — bill or more orders?" })),
      ...floor.filter((p) => p.state === "PAID" && (p.now?.paidAgo ?? 0) >= 30).map((p) => ({ id: `tb-paid-${p.id}`, area: "Tables" as const, tone: "amber" as const, title: `${p.name} — paid ${ago(p.now!.paidAgo!)} ago, not cleared`, detail: `${p.now!.customer} · the table can't seat new customers`, minutes: p.now!.paidAgo!, href: `/staff/restaurant/tables?table=${p.id}`, act: "Clear the table" })),
      ...floor.filter((p) => p.state === "BLOCKED").map((p) => ({ id: `tb-block-${p.id}`, area: "Tables" as const, tone: "slate" as const, title: `${p.name} — ${p.blocked?.as === "MAINTENANCE" ? "under maintenance" : "not available"}`, detail: p.blocked?.reason ?? "No reason written", minutes: null, href: `/staff/restaurant/tables?table=${p.id}`, act: "Reopen it when ready" })),
    ],
  });
  const liveTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(now);
  // The attention card (as before), now with the timed items: how long each has waited.
  const AREA_ICON: Record<Area, React.ReactNode> = {
    Guests: <Users />, Rooms: <BedDouble />, Restaurant: <UtensilsCrossed />, Tables: <Armchair />, Payments: <HandCoins />,
    Stores: <Boxes />, Maintenance: <Wrench />, Staff: <UserX />, Bookings: <Inbox />,
  };
  const AREA_GROUP: Record<Area, string> = { Guests: "Front desk", Rooms: "Rooms", Restaurant: "Restaurant", Tables: "Restaurant", Payments: "Money", Stores: "Stores", Maintenance: "Maintenance", Staff: "Front desk", Bookings: "Bookings" };
  const attention: AttentionItem[] = command.decisions.map((d) => ({
    tone: d.tone, icon: AREA_ICON[d.area], group: AREA_GROUP[d.area], title: d.title, href: d.href,
    detail: `${d.detail} · ${d.act}`, meta: d.minutes ? `${ago(d.minutes)} waiting` : undefined,
  }));
  const movement = [
    ...snap.arrivals.map((r) => ({ id: r.id, name: r.guest.fullName, kind: "Arriving" as const, room: r.rooms.map((x) => x.room.number).join(", "), when: r.eta ?? "—", status: r.status, balance: r.balanceAmount })),
    ...snap.departures.map((r) => ({ id: r.id, name: r.guest.fullName, kind: "Leaving" as const, room: r.rooms.filter((x) => x.status === "CHECKED_IN").map((x) => x.room.number).join(", "), when: "by 11:00", status: "CHECKED_IN", balance: r.balanceAmount })),
  ];

  return (
    <div className="w-full space-y-6">
      <HeroBanner
        eyebrow={`Management · ${user.roleName}`}
        title={`${greeting}, ${user.fullName.split(" ")[0]}`}
        subtitle={<><strong className="font-semibold text-white">{rooms.occupied} of {rooms.total}</strong> rooms occupied tonight · <strong className="font-semibold text-emerald-300">{formatTZS(receivedToday)}</strong> received today{owedNow > 0 && <> · <strong className="font-semibold text-amber-300">{formatTZS(owedNow)}</strong> not paid yet by guests</>}</>}
      />

      <div>
        <SectionLabel title="Needs your attention" count={attention.length} />
        <AttentionCards items={attention} />
      </div>

      {/* ── Rooms today ── */}
      <div>
        <SectionLabel title="Rooms today" href="/staff/rooms" linkLabel="Room board" />
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <div>
            <RoomsGlance href="/staff/rooms" total={rooms.total} center={{ value: `${Math.round(tonightPct)}%`, label: "full tonight", sub: `${rooms.occupied} of ${rooms.total}` }} parts={[
              { label: "Occupied", value: rooms.occupied, color: "#34d399" },
              { label: "Booked · arriving", value: rooms.reserved, color: "#fbbf24" },
              { label: "Available", value: rooms.ready, color: "#38bdf8" },
              { label: "Cleaning", value: rooms.cleaning, color: "#a78bfa" },
              { label: "Maintenance", value: rooms.blocked, color: "#fb7185" },
            ]} footer={<div className="space-y-1"><p>{snap.arrivals.length} arriving · {snap.departures.length} leaving · <span className={overdueNow.length ? "font-semibold text-rose-300" : ""}>{overdueNow.length} overdue</span> · {extensionsToday} extended (24h)</p><p>{shift.openAll.length ? <>On the front desk: <strong className="text-white">{shift.openAll.map((o) => o.user.fullName).join(" & ")}</strong></> : "No reception shift started yet"}</p></div>} />
          </div>
          <MoneyCard title="Money today" href="/staff/reports" linkLabel="Today's report"
            headline={{ value: formatTZS(receivedToday), label: "Received today — money really in the hotel's accounts", delta: change(receivedToday, receivedYesterday) }}
            split={[
              { label: "Received today", value: receivedToday, color: "#10b981" },
              { label: "Not paid yet (guests owe)", value: owedNow, color: "#f59e0b" },
            ]}
            cells={[
              { label: "Earned today", icon: <Banknote />, tint: "bg-violet-500/15 text-violet-400", value: formatTZS(plToday.netRevenue), sub: "rooms sold + food served — paid or not", href: `/staff/payments?from=${today}&to=${today}` },
              { label: "Spent", icon: <Receipt />, tint: "bg-rose-500/15 text-rose-400", value: formatTZS(plToday.expenses), sub: `${plToday.expenseSummary.count} expense${plToday.expenseSummary.count === 1 ? "" : "s"}`, href: "/staff/expenses" },
              { label: profitToday >= 0 ? "Profit (estimate)" : "Loss (estimate)", icon: <TrendingUp />, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.8_0.11_82)]", value: formatTZS(Math.abs(profitToday)), sub: "earned − spent · on paper", tone: profitToday >= 0 ? "good" : "bad" },
              { label: "Not paid yet", icon: <Wallet />, tint: "bg-amber-500/15 text-amber-400", value: formatTZS(owedNow), sub: owedNow ? `guests owe · ${departuresOwing.length ? `${departuresOwing.length} leaving today` : `${inHouse.summary.owingCount} staying`}` : "guests have paid", tone: owedNow ? "warn" : undefined, href: "/staff/finance/receivables" },
              { label: "Income per room", icon: <BedDouble />, tint: "bg-violet-500/15 text-violet-400", value: formatTZS(rooms.total ? Math.round(revToday.rooms.net / rooms.total) : 0), sub: `across ${rooms.total} rooms` },
              { label: "Average room rate", icon: <Tag />, tint: "bg-sky-500/15 text-sky-400", value: rateToday ? formatTZS(rateToday) : "None yet", sub: `${occToday.roomsSold} room${occToday.roomsSold === 1 ? "" : "s"} sold today` },
            ]} />
        </div>
        <div className="mt-4"><RoomsOnHome today={today} rooms={allRooms} discountMax={discountLimit(user.permissions, await getSettings())} /></div>
      </div>

      {/* ── Tables today: the restaurant floor, like the rooms ── */}
      <div>
        <SectionLabel title="Tables today" href="/staff/restaurant/tables" linkLabel="The floor" />
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <div>
            <RoomsGlance href="/staff/restaurant/tables" title="Tables now" unit="tables" total={floor.length} center={{ value: `${floor.length ? Math.round((tablesAt(["SEATED", "ORDERS", "BILL", "PAID"]) / floor.length) * 100) : 0}%`, label: "busy now", sub: `${tablesAt(["SEATED", "ORDERS", "BILL", "PAID"])} of ${floor.length}` }} parts={[
              { label: "Seated", value: tablesAt(["SEATED", "ORDERS"]), color: TABLE_META.SEATED.hex },
              { label: "Waiting to pay", value: tablesAt(["BILL"]), color: TABLE_META.BILL.hex },
              { label: "Paid · to clear", value: tablesAt(["PAID"]), color: TABLE_META.PAID.hex },
              { label: "Reserved", value: tablesAt(["RESERVED"]), color: TABLE_META.RESERVED.hex },
              { label: "Free", value: tablesAt(["FREE"]), color: TABLE_META.FREE.hex },
            ]} footer={<div className="space-y-1"><p>{tables.summary.people} {tables.summary.people === 1 ? "person" : "people"} at the tables · {tables.summary.upcoming} reservation{tables.summary.upcoming === 1 ? "" : "s"} later</p><p>{tables.summary.due ? <>To pay at the tables: <strong className="text-white">{formatTZS(tables.summary.due)}</strong></> : "Nothing waiting to be paid at the tables"}</p></div>} />
          </div>
          <MoneyCard title="Restaurant & bar today" href="/staff/restaurant" linkLabel="Live orders"
            headline={{ value: formatTZS(foodTotal), label: `${foodToday._count} order${foodToday._count === 1 ? "" : "s"} today · every place`, delta: change(foodTotal, foodYesterday._sum.total ?? 0) }}
            split={[
              { label: "Food", value: foodToday._sum.foodSubtotal ?? 0, color: "#f59e0b" },
              { label: "Drinks", value: foodToday._sum.drinksSubtotal ?? 0, color: "#0ea5e9" },
              { label: "Room service fees", value: foodToday._sum.serviceFee ?? 0, color: "#f43f5e" },
            ]}
            cells={[
              { label: "At the tables", icon: <Store />, tint: "bg-amber-500/15 text-amber-400", value: formatTZS(tables.summary.sales), sub: `${tables.summary.orders} order${tables.summary.orders === 1 ? "" : "s"}`, href: "/staff/restaurant/tables" },
              { label: "Customers today", icon: <Users />, tint: "bg-sky-500/15 text-sky-400", value: String(tables.summary.customers), sub: tables.summary.people ? `${tables.summary.people} at the tables now` : "nobody seated now" },
              { label: "Average bill", icon: <Receipt />, tint: "bg-violet-500/15 text-violet-400", value: tables.summary.avgBill ? formatTZS(tables.summary.avgBill) : "None yet", sub: "per customer" },
              { label: "To pay at the tables", icon: <HandCoins />, tint: "bg-rose-500/15 text-rose-400", value: formatTZS(tables.summary.due), sub: tables.summary.bill ? `${tables.summary.bill} asked for the bill` : "not asked yet", tone: tables.summary.due ? "warn" : undefined, href: "/staff/restaurant/tables" },
              { label: "Time at the table", icon: <Timer />, tint: "bg-emerald-500/15 text-emerald-500", value: tables.summary.minutes != null ? `${tables.summary.minutes} min` : "None yet", sub: "average stay" },
              { label: "Best table", icon: <Trophy />, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.8_0.11_82)]", value: tables.summary.best ? tables.summary.best.name.replace(/\s—\s.*/, "") : "—", sub: tables.summary.best ? `${tables.summary.best.name.replace(/^.*—\s/, "")} · ${formatTZS(tables.summary.best.sales)}` : "no table sales yet" },
            ]} />
        </div>
        <div className="mt-4"><TablesOnHome data={tables} period="Today" canManage={can(user, "restaurant.menu") || can(user, "settings.manage")} canDecide /></div>
      </div>

      {/* ── Every department right now, and what the staff have done today ── */}
      <LiveBoard data={command} time={liveTime} />
      <StaffToday data={command} today={today} />

      {/* ── Money & performance for the chosen period ── */}
      <div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{periodKey === "today" ? "The business · pick a period" : `Money · ${periodLabel}`}</h2>
          <nav aria-label="Period" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] sm:rounded-full sm:border sm:border-border sm:bg-card sm:p-1">
            {PERIODS.map((p) => (
              <Link key={p.key} href={`${basePath}?period=${p.key}`} aria-current={periodKey === p.key ? "page" : undefined}
                className={cn("shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors", periodKey === p.key ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground sm:bg-transparent")}>
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
        {/* Today's money is in the cards at the top — these show the other periods. */}
        {periodKey !== "today" && <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Earned (revenue)" value={formatTZS(pl.netRevenue)} icon={<CircleDollarSign />} tone="gold" spark={revSpark}
            delta={<Delta value={change(pl.netRevenue, plPrev.netRevenue)} label={vsLabel} />} href={`/staff/reports?${q(periodKey)}`} />
          <StatTile label="Collected (money in)" value={formatTZS(rev.paymentsCollected)} icon={<Banknote />} tone="emerald" sub="Cash, mobile, card & bank" href={`/staff/payments?from=${range.from}&to=${range.to}`} />
          <StatTile label="To collect now" value={formatTZS(inHouse.summary.totalOutstanding)} icon={<Wallet />} tone="rose"
            sub={inHouse.summary.owingCount ? `${inHouse.summary.owingCount} guest${inHouse.summary.owingCount === 1 ? "" : "s"} staying owe · ${formatTZS(owed.total)} owed in total` : `Guests staying have paid${owed.total ? ` · ${formatTZS(owed.total)} owed in total` : ""}`}
            href="/staff/finance/receivables" />
          <StatTile label="Owed by companies" value={formatTZS(owed.invoices.amount)} icon={<Building2 />} tone="amber"
            sub={owed.invoices.count ? `${owed.invoices.count} unpaid invoice${owed.invoices.count === 1 ? "" : "s"}${overdueInvoices._count ? ` · ${formatTZS(overdueInvoices._sum.balanceAmount ?? 0)} overdue` : ""}` : "No unpaid company invoices"}
            href="/staff/finance/receivables" />
          <StatTile label="Expenses" value={formatTZS(pl.expenses)} icon={<Receipt />} tone="rose" sub="Costs paid" href="/staff/expenses" />
          <StatTile label="Guest-room occupancy" value={`${occ.occupancy.toFixed(0)}%`} icon={<Percent />} tone="sky"
            delta={<Delta value={occPrev.sellableNights ? occ.occupancy - occPrev.occupancy : null} unit=" pts" label={vsLabel} />}
            sub={`${occ.roomNights} room nights${meeting.rooms ? ` · meeting room ${meeting.utilisation.toFixed(0)}% used · ${meeting.bookings} booking${meeting.bookings === 1 ? "" : "s"} · ${formatTZS(meeting.revenue)}` : ""}`} />
        </div>}
      </div>

      <Panel title="Occupancy" subtitle={days < 14 ? "Last 14 hotel days" : periodLabel} action={<PanelLink href="/staff/reports">Reports</PanelLink>}>
        <AreaTrend data={occTrend.series.map((d) => ({ date: d.date, value: d.occupancy }))} unit="percent" color="#8b5cf6" height={230} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Arrivals & departures today" className="lg:col-span-2" action={<PanelLink href="/reception/dashboard">Front desk</PanelLink>} bodyClassName="-mx-4 sm:-mx-6">
          {movement.length === 0 ? <p className="px-4 text-sm text-muted-foreground sm:px-6">No more guests arriving or leaving today.</p> : (
            // Four guests show (with a peek of the fifth); the rest scroll under the headings.
            <div className="max-h-[17rem] overflow-auto overscroll-contain [scrollbar-width:thin]">
              <table data-stack className="w-full min-w-[520px] text-sm">
                <thead className="sticky top-0 z-10 bg-card"><tr className="text-left text-xs text-muted-foreground"><th className="px-4 pb-2 font-medium sm:px-6">Guest</th><th className="pb-2 font-medium">Room</th><th className="pb-2 font-medium">When</th><th className="pb-2 font-medium">Status</th><th className="pb-2 pr-4 text-right font-medium sm:pr-6">Balance</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {movement.map((g) => (
                    <tr key={`${g.kind}-${g.id}`} className="transition-colors hover:bg-muted">
                      <td className="px-4 py-3 sm:px-6"><Link href={`/staff/reservations/${g.id}`} className="flex items-center gap-2.5 font-medium text-foreground"><Initials name={g.name} />{g.name}</Link></td>
                      <td className="tabular-nums text-muted-foreground">{g.room || "—"}</td>
                      <td className="text-muted-foreground">{g.when}</td>
                      <td><Pill kind={g.kind === "Arriving" ? g.status : "LATE"}>{g.kind}</Pill></td>
                      <td className="pr-4 text-right sm:pr-6">{g.balance > 0 ? <Pill kind="OWES">{formatTZS(g.balance)}</Pill> : <Pill kind="PAID">Paid</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Where the money comes from" subtitle={periodLabel}>
          <Donut center={{ label: "earned", value: formatTZS(pl.netRevenue).replace("TZS ", "") }} data={[
            { name: "Rooms", value: rev.rooms.net }, { name: "Restaurant", value: rev.restaurant }, { name: "Bar", value: rev.bar },
            { name: "Meeting room", value: rev.meeting }, { name: "Room service", value: rev.roomService }, { name: "Transport", value: rev.transport }, { name: "Other", value: rev.other },
          ]} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Online bookings" subtitle={periodLabel} action={<PanelLink href="/staff/booking-requests">Open</PanelLink>}>
          {/* The period in one quiet strip, like the other figures */}
          <div className="grid grid-cols-3 divide-x divide-border/70 rounded-2xl border border-border/70 text-center">
            {([["Received", reqs.total, "text-sky-600 dark:text-sky-300"], ["Booked", reqs.converted, "text-emerald-600 dark:text-emerald-400"], ["Waiting", reqs.pending, reqs.pending ? "text-amber-600 dark:text-amber-300" : "text-foreground"]] as const).map(([k, v, c]) => (
              <div key={k} className="px-2 py-2.5"><p className={cn("text-xl font-semibold tabular-nums", c)}>{v}</p><p className="text-[11px] text-muted-foreground">{k}</p></div>
            ))}
          </div>
          {reqs.conversionRate !== null && <p className="mt-2.5 text-xs text-muted-foreground"><strong className="font-semibold text-foreground">{Math.round(reqs.conversionRate)}%</strong> became bookings{reqs.bySource.length ? ` · most from ${[...reqs.bySource].sort((a, b) => b.count - a.count)[0].name}` : ""}.</p>}
          {/* Hotel QR bookings are made straight into the reservations (no request first): counted here beside them. */}
          {qr.booked > 0 && (
            <Link href="/staff/hotel-qr" className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs hover:bg-muted">
              <span className="text-muted-foreground">Hotel QR</span>
              <span><strong className="font-semibold tabular-nums text-foreground">{qr.booked}</strong> booked · <strong className="font-semibold tabular-nums text-foreground">{qr.confirmed}</strong> confirmed</span>
            </Link>
          )}
          {/* The latest ones, like the payments beside it */}
          {latestRequests.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No online bookings yet.</p> : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {latestRequests.map((q) => {
                const nights = Math.max(1, Math.round((+q.checkOutDate - +q.checkInDate) / 86_400_000));
                const day = formatBusinessDate(q.checkInDate.toISOString().slice(0, 10)).replace(/^\w+,?\s*/, "").replace(/\s\d{4}$/, "");
                const st = REQUEST_LOOK[q.status] ?? REQUEST_LOOK.CANCELLED;
                return (
                  <li key={q.id}>
                    <Link href={`/staff/booking-requests/${q.id}`} className="flex items-center gap-3 py-3">
                      <Initials name={q.companyName ?? q.fullName} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{q.companyName ?? q.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">{q.meetingStartAt ? `Meeting · ${day}` : `${day} · ${nights} night${nights === 1 ? "" : "s"} · ${q.roomCount > 1 ? `${q.roomCount} × ` : ""}${q.roomType.name}`} · {q.source.name}</span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", st.tone)}>{st.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Latest payments" action={<PanelLink href="/staff/payments" />}>
          {payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
            <ul className="divide-y divide-border text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-3">
                  <Initials name={p.reservation?.guest.fullName ?? "Payment"} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium text-foreground">{p.reservation?.guest.fullName ?? "Payment"}</span>
                    <span className="text-xs text-muted-foreground">{p.method.name} · {formatDateTime(p.receivedAt)}</span></span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", p.kind === "REFUND" ? "text-rose-600" : "text-emerald-600")}>{p.kind === "REFUND" ? "−" : "+"}{formatTZS(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="What the team is doing" action={<PanelLink href="/staff/activity" />}>
          <ul className="space-y-3.5 text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-3">
                <Initials name={a.user?.fullName ?? "?"} />
                <span className="min-w-0"><span className="font-medium text-foreground">{a.user?.fullName}</span> <span className="text-muted-foreground">{friendly(a.action)}</span>
                  <span className="block text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* The business in detail — the same picture as Finance → Overview, for the period chosen above */}
      <div>
        <SectionLabel title="The business in detail" href={`/staff/finance?${periodKey === "custom" ? `from=${range.from}&to=${range.to}` : `period=${periodKey}`}`} linkLabel="Finance" />
        <BusinessDetail p={{ key: periodKey, from: range.from, to: range.to }} today={today} />
      </div>

      {/* At the bottom: the guests staying who still owe (reception collects it) */}
      <GuestsOwingOnHome balances={inHouse} />

      <p className="pb-2 text-center text-xs text-muted-foreground">Figures come straight from bookings, payments and expenses recorded by staff.</p>
    </div>
  );
}
