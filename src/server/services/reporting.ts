import "server-only";
import { db } from "../db";
import { addDays, diffDays, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { COUNTED_EXPENSE_STATUSES } from "./expenses";
import { EARNED_NIGHT } from "./reservation-financials";
import { MEETING_OPEN_HOURS } from "@/lib/meeting";

/**
 * Reporting services — the single financial & occupancy source of truth.
 * The Boss dashboard, reports and the automated daily report all call these
 * functions; nothing recalculates money elsewhere.
 *
 *   OccupancyService    → occupancy(), roomNightsByDay
 *   RevenueService      → revenue()
 *   ExpenseService      → expenseSummary()
 *   ProfitLossService   → profitLoss()
 *
 * Definitions (documented so every screen agrees):
 * - Room revenue is recognised per business date from the room-night ledger
 *   (reserved/confirmed/in-house/checked-out stays; cancelled & no-show excluded).
 * - Rooms sold = room nights + day-use rooms. Occupancy uses overnight room
 *   nights only ÷ sellable rooms (active rooms minus maintenance/out-of-service blocks).
 * - Guest rooms only: meeting rooms (room type category MEETING_ROOM) are never part of
 *   occupancy or room revenue. They have their own Meeting Room revenue line and
 *   utilisation (booked hours ÷ open hours) — meetingRoomStats().
 * - Net revenue = gross revenue − discounts − refunds.
 * - Payments collected is cash received (payments − refunds); it is NOT revenue.
 * - Estimated profit/loss = net revenue − counted expenses (recorded + approved).
 */

export interface Range { from: BusinessDate; to: BusinessDate } // inclusive

const dbRange = (r: Range) => ({ gte: toDbDate(r.from), lte: toDbDate(r.to) });

export function previousRange(r: Range): Range {
  const len = diffDays(r.from, r.to) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

/** Room types sold by time (meeting rooms) — kept out of guest-room figures. */
async function meetingTypeIds(): Promise<string[]> {
  return (await db.roomType.findMany({ where: { category: "MEETING_ROOM" }, select: { id: true } })).map((t) => t.id);
}

// ─────────────────────────── Occupancy ───────────────────────────

/** Guest-room occupancy (meeting rooms excluded — see meetingRoomStats). */
export async function occupancy(r: Range) {
  const days = eachDate(r.from, addDays(r.to, 1));
  const meetingIds = await meetingTypeIds();
  const guestRoom = { isActive: true, roomType: { category: "GUEST_ROOM" as const } };
  const [activeRooms, blocks, nights] = await Promise.all([
    db.room.count({ where: guestRoom }),
    db.roomBlock.findMany({
      where: { startDate: { lte: toDbDate(r.to) }, OR: [{ endDate: null }, { endDate: { gt: toDbDate(r.from) } }], room: guestRoom },
      select: { roomId: true, startDate: true, endDate: true },
    }),
    db.roomNight.groupBy({ by: ["businessDate", "isDayUse"], where: { businessDate: dbRange(r), ...EARNED_NIGHT, roomTypeId: { notIn: meetingIds } }, _count: true }),
  ]);
  const series = days.map((d) => {
    const blocked = new Set(
      blocks.filter((b) => fromDbDate(b.startDate) <= d && (!b.endDate || fromDbDate(b.endDate) > d)).map((b) => b.roomId),
    ).size;
    const sellable = Math.max(0, activeRooms - blocked);
    const sold = nights.find((n) => fromDbDate(n.businessDate) === d && !n.isDayUse)?._count ?? 0;
    const dayUse = nights.find((n) => fromDbDate(n.businessDate) === d && n.isDayUse)?._count ?? 0;
    return { date: d, sellable, roomNights: sold, dayUse, occupancy: sellable ? (sold / sellable) * 100 : 0 };
  });
  const sellableNights = series.reduce((s, x) => s + x.sellable, 0);
  const roomNights = series.reduce((s, x) => s + x.roomNights, 0);
  const dayUse = series.reduce((s, x) => s + x.dayUse, 0);
  return {
    series,
    activeRooms,
    sellableNights,
    roomNights,
    dayUse,
    roomsSold: roomNights + dayUse,
    occupancy: sellableNights ? (roomNights / sellableNights) * 100 : 0,
  };
}

// ─────────────────────────── Revenue ───────────────────────────

export async function revenue(r: Range) {
  const where = { businessDate: dbRange(r) };
  const meetingIds = await meetingTypeIds();
  // Room revenue is guest rooms only; the meeting room is its own line (same ledger, other category).
  const nightWhere = { ...where, ...EARNED_NIGHT, roomTypeId: { notIn: meetingIds } };
  const meetingWhere = { ...where, ...EARNED_NIGHT, roomTypeId: { in: meetingIds } };
  const [roomAgg, roomByDay, roomByType, roomBySource, other, charges, meetings, refunds, collected, types, sources] = await Promise.all([
    db.roomNight.aggregate({ where: nightWhere, _sum: { grossAmount: true, discountAmount: true, netAmount: true }, _count: true }),
    db.roomNight.groupBy({ by: ["businessDate"], where: nightWhere, _sum: { netAmount: true } }),
    db.roomNight.groupBy({ by: ["roomTypeId", "isDayUse"], where: nightWhere, _sum: { grossAmount: true, discountAmount: true, netAmount: true }, _count: true }),
    db.roomNight.groupBy({ by: ["sourceId"], where: nightWhere, _sum: { netAmount: true }, _count: true }),
    db.revenueTransaction.groupBy({ by: ["kind", "businessDate"], where: { ...where, isVoided: false }, _sum: { amount: true } }),
    db.reservationCharge.groupBy({ by: ["businessDate", "kind"], where: { ...where, isVoided: false }, _sum: { amount: true } }),
    db.roomNight.groupBy({ by: ["businessDate"], where: meetingWhere, _sum: { netAmount: true, discountAmount: true } }),
    db.payment.aggregate({ where: { ...where, status: "POSTED", kind: "REFUND" }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["kind", "methodId"], where: { ...where, status: "POSTED" }, _sum: { amount: true } }),
    db.roomType.findMany({ where: { category: "GUEST_ROOM" }, select: { id: true, name: true, sortOrder: true }, orderBy: { sortOrder: "asc" } }),
    db.bookingSource.findMany({ select: { id: true, name: true, code: true } }),
  ]);

  const sumKind = (k: string) =>
    other.filter((o) => o.kind === k).reduce((s, o) => s + (o._sum.amount ?? 0), 0) +
    charges.filter((c) => c.kind === k).reduce((s, c) => s + (c._sum.amount ?? 0), 0);
  const restaurant = sumKind("RESTAURANT");
  const bar = sumKind("BAR");
  const otherSales = sumKind("OTHER");
  const roomService = sumKind("ROOM_SERVICE");
  const transport = sumKind("TRANSPORT");
  // Meeting Room revenue is net of any discount given on the booking.
  const meeting = meetings.reduce((s, m) => s + (m._sum.netAmount ?? 0), 0);
  const roomGross = roomAgg._sum.grossAmount ?? 0;
  const roomDiscount = roomAgg._sum.discountAmount ?? 0;
  const roomNet = roomAgg._sum.netAmount ?? 0;
  const refundTotal = refunds._sum.amount ?? 0;
  const grossRevenue = roomGross + restaurant + bar + meeting + otherSales + roomService + transport;
  const netRevenue = grossRevenue - roomDiscount - refundTotal;
  const paymentsIn = collected.filter((c) => c.kind === "PAYMENT").reduce((s, c) => s + (c._sum.amount ?? 0), 0);

  // Daily net revenue series (rooms net + other streams) for charts.
  const days = eachDate(r.from, addDays(r.to, 1));
  const daily = days.map((d) => {
    const on = <T extends { businessDate: Date }>(rows: T[]) => rows.filter((x) => fromDbDate(x.businessDate) === d);
    const rooms = on(roomByDay).reduce((s, x) => s + (x._sum.netAmount ?? 0), 0);
    const oth = on(other).reduce((s, x) => s + (x._sum.amount ?? 0), 0) + on(charges).reduce((s, x) => s + (x._sum.amount ?? 0), 0);
    const mtg = on(meetings).reduce((s, x) => s + (x._sum.netAmount ?? 0), 0);
    return { date: d, rooms, other: oth + mtg, total: rooms + oth + mtg };
  });

  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const byType = types.map((t) => {
    const rows = roomByType.filter((x) => x.roomTypeId === t.id);
    const nights = rows.filter((x) => !x.isDayUse).reduce((s, x) => s + x._count, 0);
    const dayUse = rows.filter((x) => x.isDayUse).reduce((s, x) => s + x._count, 0);
    const gross = rows.reduce((s, x) => s + (x._sum.grossAmount ?? 0), 0);
    const discount = rows.reduce((s, x) => s + (x._sum.discountAmount ?? 0), 0);
    const net = rows.reduce((s, x) => s + (x._sum.netAmount ?? 0), 0);
    const sold = nights + dayUse;
    return { roomTypeId: t.id, name: t.name, roomsSold: sold, roomNights: nights, gross, discount, net, averageRate: sold ? Math.round(net / sold) : 0 };
  });
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));
  const bySource = roomBySource
    .map((s) => ({ sourceId: s.sourceId, name: sourceName.get(s.sourceId) ?? "Unknown", roomNights: s._count, net: s._sum.netAmount ?? 0 }))
    .sort((a, b) => b.net - a.net);

  return {
    rooms: { gross: roomGross, discount: roomDiscount, net: roomNet, roomsSold: roomAgg._count },
    restaurant, bar, meeting, other: otherSales, roomService, transport,
    refunds: refundTotal,
    grossRevenue,
    discounts: roomDiscount,
    netRevenue,
    paymentsCollected: paymentsIn - refundTotal,
    paymentsByMethod: collected,
    daily,
    byType,
    bySource,
    typeName,
  };
}

// ─────────────────────────── Expenses ───────────────────────────

export async function expenseSummary(r: Range) {
  const where = { businessDate: dbRange(r), status: { in: COUNTED_EXPENSE_STATUSES } };
  const [agg, byCategory, categories, recent, pending, highValue] = await Promise.all([
    db.expense.aggregate({ where, _sum: { amount: true }, _count: true }),
    db.expense.groupBy({ by: ["categoryId"], where, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } } }),
    db.expenseCategory.findMany({ select: { id: true, name: true } }),
    db.expense.findMany({ where: { businessDate: dbRange(r) }, orderBy: { spentAt: "desc" }, take: 8, include: { category: true, createdBy: { select: { fullName: true } } } }),
    db.expense.aggregate({ where: { status: "PENDING_APPROVAL" }, _sum: { amount: true }, _count: true }),
    db.expense.findMany({ where: { ...where }, orderBy: { amount: "desc" }, take: 3, include: { category: true } }),
  ]);
  const name = new Map(categories.map((c) => [c.id, c.name]));
  return {
    total: agg._sum.amount ?? 0,
    count: agg._count,
    byCategory: byCategory.map((c) => ({ categoryId: c.categoryId, name: name.get(c.categoryId) ?? "Other", amount: c._sum.amount ?? 0 })),
    recent,
    highValue,
    pending: { count: pending._count, amount: pending._sum.amount ?? 0 },
  };
}

// ─────────────────────────── Outstanding ───────────────────────────

export async function outstanding() {
  const owed = { balanceAmount: { gt: 0 }, status: { in: ["CHECKED_IN" as const, "CHECKED_OUT" as const] } };
  const [reservations, invoices, meetings] = await Promise.all([
    // Owed = guests who stayed (or are staying). A booking not yet arrived is only a price, not a debt.
    db.reservation.aggregate({ where: { ...owed, kind: "STAY" }, _sum: { balanceAmount: true }, _count: true }),
    db.invoice.aggregate({ where: { reservationId: null, balanceAmount: { gt: 0 }, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, _sum: { balanceAmount: true }, _count: true }),
    db.reservation.aggregate({ where: { ...owed, kind: "MEETING" }, _sum: { balanceAmount: true }, _count: true }),
  ]);
  const total = (reservations._sum.balanceAmount ?? 0) + (invoices._sum.balanceAmount ?? 0) + (meetings._sum.balanceAmount ?? 0);
  return {
    total,
    reservations: { count: reservations._count, amount: reservations._sum.balanceAmount ?? 0 },
    invoices: { count: invoices._count, amount: invoices._sum.balanceAmount ?? 0 },
    meetings: { count: meetings._count, amount: meetings._sum.balanceAmount ?? 0 },
  };
}

// ─────────────────────────── Profit & loss ───────────────────────────

export async function profitLoss(r: Range) {
  const [rev, exp] = await Promise.all([revenue(r), expenseSummary(r)]);
  return {
    grossRevenue: rev.grossRevenue,
    discounts: rev.discounts,
    refunds: rev.refunds,
    netRevenue: rev.netRevenue,
    expenses: exp.total,
    estimatedProfit: rev.netRevenue - exp.total,
    revenue: rev,
    expenseSummary: exp,
  };
}

/** % change vs previous period — only when the previous value is a meaningful base. */
export function change(current: number, previous: number): number | null {
  if (!previous || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Guest movement for a range: check-ins, check-outs, new bookings, cancellations, no-shows. */
export async function guestMovement(r: Range) {
  const where = dbRange(r);
  // Guests (guest rooms) only — meeting room bookings have their own figures (meetingRoomStats).
  const guestRoom = { roomType: { category: "GUEST_ROOM" as const } };
  const [checkIns, checkOuts, newBookings, cancellations, noShows, inHouse] = await Promise.all([
    db.reservationRoom.count({ where: { checkedInAt: { not: null }, arrivalDate: where, ...guestRoom } }),
    db.reservationRoom.count({ where: { status: "CHECKED_OUT", departureDate: where, ...guestRoom } }),
    db.reservation.count({ where: { businessDate: where, kind: "STAY" } }),
    db.reservation.count({ where: { status: "CANCELLED", cancelledAt: { not: null }, arrivalDate: where, kind: "STAY" } }),
    db.reservation.count({ where: { status: "NO_SHOW", arrivalDate: where, kind: "STAY" } }),
    db.reservation.count({ where: { status: "CHECKED_IN", kind: "STAY" } }),
  ]);
  return { checkIns, checkOuts, newBookings, cancellations, noShows, inHouse };
}

// ─────────────────────────── Meeting room ───────────────────────────

/**
 * Meeting room performance for a range — kept apart from guest-room occupancy.
 * Bookings / completed / cancelled / no-show count meeting reservations by their
 * meeting date; revenue is the Meeting Room line (earned when the meeting starts);
 * utilisation = booked hours of meetings held or booked ÷ (meeting rooms × open
 * hours a day × days).
 */
export async function meetingRoomStats(r: Range) {
  const where = dbRange(r);
  const days = diffDays(r.from, r.to) + 1;
  const meetingIds = await meetingTypeIds();
  const [rooms, reservations, rev] = await Promise.all([
    db.room.count({ where: { isActive: true, roomType: { category: "MEETING_ROOM", isActive: true } } }),
    db.reservationRoom.findMany({
      where: { arrivalDate: where, roomType: { category: "MEETING_ROOM" } },
      select: { status: true, startAt: true, endAt: true, checkedInAt: true, checkedOutAt: true },
    }),
    db.roomNight.aggregate({ where: { businessDate: where, ...EARNED_NIGHT, roomTypeId: { in: meetingIds } }, _sum: { netAmount: true } }),
  ]);
  const live = reservations.filter((x) => ["RESERVED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(x.status));
  const hours = live.reduce((s, x) => {
    const start = x.checkedInAt ?? x.startAt, end = x.checkedOutAt ?? x.endAt;
    return s + Math.max(0, end.getTime() - start.getTime()) / 3_600_000;
  }, 0);
  const openHours = rooms * MEETING_OPEN_HOURS * days;
  return {
    rooms,
    bookings: live.length + reservations.filter((x) => x.status === "NO_SHOW").length,
    completed: reservations.filter((x) => x.status === "CHECKED_OUT").length,
    inUse: reservations.filter((x) => x.status === "CHECKED_IN").length,
    upcoming: reservations.filter((x) => x.status === "RESERVED" || x.status === "CONFIRMED").length,
    cancelled: reservations.filter((x) => x.status === "CANCELLED").length,
    noShows: reservations.filter((x) => x.status === "NO_SHOW").length,
    revenue: rev._sum.netAmount ?? 0,
    bookedHours: Math.round(hours * 10) / 10,
    openHours,
    utilisation: openHours ? Math.min(100, (hours / openHours) * 100) : 0,
  };
}

// ─────────────────────────── Day by day (finance charts) ───────────────────────────

/**
 * Each hotel day in the range: what was earned (as the income totals), spent (counted expenses)
 * and received (payments + on-the-spot sales − refunds, as "money received") — the same rules as
 * the totals, so the chart always adds up to the figures above it.
 */
export async function dailyMoney(r: Range) {
  const where = { businessDate: dbRange(r) };
  const [rev, exp, pays, sales] = await Promise.all([
    revenue(r),
    db.expense.groupBy({ by: ["businessDate"], where: { ...where, status: { in: COUNTED_EXPENSE_STATUSES } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["businessDate", "kind"], where: { ...where, status: "POSTED" }, _sum: { amount: true } }),
    db.revenueTransaction.groupBy({ by: ["businessDate"], where: { ...where, isVoided: false }, _sum: { amount: true } }),
  ]);
  const on = <T extends { businessDate: Date }>(rows: T[], d: string) => rows.filter((x) => fromDbDate(x.businessDate) === d);
  return rev.daily.map((d) => {
    const paid = on(pays, d.date).reduce((s, p) => s + (p.kind === "REFUND" ? -1 : 1) * (p._sum.amount ?? 0), 0);
    const sold = on(sales, d.date).reduce((s, x) => s + (x._sum.amount ?? 0), 0);
    return { date: d.date, income: d.total, expenses: on(exp, d.date).reduce((s, x) => s + (x._sum.amount ?? 0), 0), received: paid + sold };
  });
}

/**
 * Income per hotel day, department by department — the same ledgers and rules as revenue()
 * (room nights, meeting nights, sales and room charges), so each day adds up to its total.
 */
export async function dailyByKind(r: Range) {
  const where = { businessDate: dbRange(r) };
  const meetingIds = await meetingTypeIds();
  const [rooms, meetings, sales, charges] = await Promise.all([
    db.roomNight.groupBy({ by: ["businessDate"], where: { ...where, ...EARNED_NIGHT, roomTypeId: { notIn: meetingIds } }, _sum: { netAmount: true } }),
    db.roomNight.groupBy({ by: ["businessDate"], where: { ...where, ...EARNED_NIGHT, roomTypeId: { in: meetingIds } }, _sum: { netAmount: true } }),
    db.revenueTransaction.groupBy({ by: ["kind", "businessDate"], where: { ...where, isVoided: false }, _sum: { amount: true } }),
    db.reservationCharge.groupBy({ by: ["businessDate", "kind"], where: { ...where, isVoided: false }, _sum: { amount: true } }),
  ]);
  return eachDate(r.from, addDays(r.to, 1)).map((d) => {
    const on = <T extends { businessDate: Date }>(rows: T[]) => rows.filter((x) => fromDbDate(x.businessDate) === d);
    const kind = (k: string) => on(sales).filter((x) => x.kind === k).reduce((t, x) => t + (x._sum.amount ?? 0), 0) + on(charges).filter((x) => x.kind === k).reduce((t, x) => t + (x._sum.amount ?? 0), 0);
    const row = {
      date: d,
      rooms: on(rooms).reduce((t, x) => t + (x._sum.netAmount ?? 0), 0),
      restaurant: kind("RESTAURANT"), bar: kind("BAR"), roomService: kind("ROOM_SERVICE"),
      meeting: on(meetings).reduce((t, x) => t + (x._sum.netAmount ?? 0), 0),
      transport: kind("TRANSPORT"), other: kind("OTHER"),
    };
    return { ...row, total: row.rooms + row.restaurant + row.bar + row.roomService + row.meeting + row.transport + row.other };
  });
}

/** The restaurant & bar in a range: orders, sales, the average order and the best sellers (cancelled orders left out). */
export async function restaurantSummary(r: Range) {
  const where = { businessDate: dbRange(r), status: { not: "CANCELLED" as const } };
  const [agg, items] = await Promise.all([
    db.restaurantOrder.aggregate({ where, _sum: { total: true }, _count: true }),
    db.restaurantOrderItem.groupBy({ by: ["name", "type"], where: { order: where }, _sum: { quantity: true, lineTotal: true }, orderBy: { _sum: { lineTotal: "desc" } }, take: 5 }),
  ]);
  const orders = agg._count, sales = agg._sum.total ?? 0;
  return {
    orders, sales, averageOrder: orders ? Math.round(sales / orders) : 0,
    best: items.map((i) => ({ name: i.name, drink: i.type === "DRINK", quantity: i._sum.quantity ?? 0, amount: i._sum.lineTotal ?? 0 })),
  };
}

/** Guest rooms already booked for the coming nights (and the room income on the books) — from the nights stored with each booking. */
export async function onTheBooks(today: BusinessDate, nights = 14) {
  const meetingIds = await meetingTypeIds();
  const booked = { reservationRoom: { status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] as ("RESERVED" | "CONFIRMED" | "CHECKED_IN")[] } }, roomTypeId: { notIn: meetingIds } };
  const to = addDays(today, nights - 1);
  const [activeRooms, perNight, month] = await Promise.all([
    db.room.count({ where: { isActive: true, roomType: { category: "GUEST_ROOM" } } }),
    db.roomNight.groupBy({ by: ["businessDate"], where: { businessDate: dbRange({ from: today, to }), isDayUse: false, ...booked }, _count: true, _sum: { netAmount: true } }),
    db.roomNight.aggregate({ where: { businessDate: dbRange({ from: today, to: addDays(today, 29) }), ...booked }, _count: true, _sum: { netAmount: true } }),
  ]);
  const series = eachDate(today, addDays(to, 1)).map((d) => {
    const row = perNight.find((x) => fromDbDate(x.businessDate) === d);
    return { date: d, rooms: row?._count ?? 0, amount: row?._sum.netAmount ?? 0 };
  });
  return { activeRooms, series, next30: { nights: month._count, amount: month._sum.netAmount ?? 0 } };
}

/** How guests booked in a range: how long they stay and how far ahead they book (stays arriving in the range, cancelled ones left out). */
export async function stayPatterns(r: Range) {
  const rows = await db.reservation.findMany({
    where: { kind: "STAY", arrivalDate: dbRange(r), status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    select: { arrivalDate: true, departureDate: true, businessDate: true, rooms: { where: { status: { not: "CANCELLED" } }, select: { adults: true, children: true } } },
  });
  const n = rows.length;
  const avg = (f: (x: (typeof rows)[number]) => number) => (n ? rows.reduce((s, x) => s + f(x), 0) / n : 0);
  return {
    stays: n,
    averageNights: avg((x) => Math.max(1, diffDays(fromDbDate(x.arrivalDate), fromDbDate(x.departureDate)))),
    averageLeadDays: avg((x) => Math.max(0, diffDays(fromDbDate(x.businessDate), fromDbDate(x.arrivalDate)))),
    averageGuests: avg((x) => x.rooms.reduce((s, room) => s + room.adults + room.children, 0)),
  };
}

/** The customers who spent the most in a range: rooms (nights earned) + restaurant & bar orders. */
export async function topCustomers(r: Range, take = 5) {
  const where = { businessDate: dbRange(r) };
  const [nights, orders] = await Promise.all([
    db.roomNight.groupBy({ by: ["reservationRoomId"], where: { ...where, ...EARNED_NIGHT }, _sum: { netAmount: true } }),
    db.restaurantOrder.groupBy({ by: ["guestId"], where: { ...where, status: { not: "CANCELLED" }, guestId: { not: null } }, _sum: { total: true } }),
  ]);
  const owners = await db.reservationRoom.findMany({ where: { id: { in: nights.map((x) => x.reservationRoomId) } }, select: { id: true, reservation: { select: { guestId: true } } } });
  const guestOf = new Map(owners.map((o) => [o.id, o.reservation.guestId]));
  const spend = new Map<string, { rooms: number; food: number }>();
  const add = (id: string, k: "rooms" | "food", v: number) => { const s = spend.get(id) ?? { rooms: 0, food: 0 }; s[k] += v; spend.set(id, s); };
  for (const x of nights) { const g = guestOf.get(x.reservationRoomId); if (g) add(g, "rooms", x._sum.netAmount ?? 0); }
  for (const x of orders) if (x.guestId) add(x.guestId, "food", x._sum.total ?? 0);
  const top = [...spend.entries()].map(([id, s]) => ({ id, ...s, total: s.rooms + s.food })).filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, take);
  const people = await db.guest.findMany({ where: { id: { in: top.map((x) => x.id) } }, select: { id: true, fullName: true, vip: true } });
  const who = new Map(people.map((p) => [p.id, p]));
  return top.map((x) => ({ ...x, name: who.get(x.id)?.fullName ?? "Customer", vip: who.get(x.id)?.vip ?? false }));
}
