import "server-only";
import { inHouseBalances } from "./guest-balances";
import { db } from "../db";
import { audit } from "../audit";
import { getSettings, businessDayConfig } from "../settings";
import { businessDateOf, businessDayBounds, fromDbDate, localParts, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { assetSummary, inventoryAlerts, inventoryDay } from "./inventory";
import { guestMovement, meetingRoomStats, occupancy, outstanding, profitLoss } from "./reporting";
import { paymentsByMethod, staffActivity } from "./finance";
import { deliverToRecipients } from "./report-delivery";
import { Prisma } from "@/generated/prisma/client";

/**
 * DailyReportService — builds the Boss's end-of-day report for a closed hotel
 * business day by combining the same reporting services as the dashboard.
 * Stores the structured result + WhatsApp text, then delivers it with
 * per-recipient tracking. A failed delivery never loses the report.
 */

export interface DailyReportData {
  businessDate: BusinessDate;
  hotel: { occupancy: number; roomsSold: number; roomNights: number; roomsAvailableNow: number; sellable: number };
  guests: { checkIns: number; checkOuts: number; newBookings: number; cancellations: number; noShows: number; inHouse: number };
  revenue: { roomGross: number; roomDiscounts: number; roomNet: number; restaurant: number; bar: number; /** Room-service delivery fees (reports before Sept 2026 have none). */ roomService?: number; /** Guest transport (reports before Sept 2026 have none). */ transport?: number; meeting: number; other: number; refunds: number; total: number };
  money: {
    collected: number; outstanding: number;
    /** Payments + on-the-spot sales − refunds, by how they were paid. */
    byMethod?: { method: string; amount: number }[];
    /** Of which paid by companies against their invoices. */
    companyPayments?: number;
    /** Company invoices issued that day (earned earlier or today — owed, not money in). */
    companyInvoiced?: number;
    /** Guests staying at report time who still owe (not collected money). */
    inHouseOutstanding?: number; inHouseOwing?: number;
    /** Restaurant orders not paid yet (included in outstanding). */
    restaurantUnpaid?: number;
  };
  /** Rooms at report time, room income split, average room rate (room income ÷ rooms sold). */
  rooms?: { total: number; occupied: number; available: number; cleaning: number; outOfOrder: number; adr: number; income: number; companyCredit: number; direct: number };
  /** Per staff member: check-ins, check-outs, bookings, payments taken, expenses recorded. */
  people?: { name: string; checkIns: number; checkOuts: number; bookings: number; payments: number; expenses: number }[];
  /** Meeting room that day (reports before Sept 2026 have none): bookings, completed, cancelled, revenue, use. */
  meetingRoom?: { bookings: number; completed: number; cancelled: number; noShows: number; revenue: number; bookedHours: number; utilisation: number };
  /** Arrivals due that day and what happened to them; changes made to bookings and payments. */
  arrivals?: { expected: number; checkedIn: number; late: number; noShow: number };
  changes?: {
    dates: number; rooms: number; paymentCorrections: number; discounts: number;
    /** Room changes by who asked, free hotel moves, paid upgrades and the extra room money from them. */
    roomMoves?: { customer: number; hotel: number; freeHotel: number; paidUpgrades: number; upgradeRevenue: number; compensation: number };
  };
  /** Cash counts that day with a difference. */
  cashDifferences?: { account: string; difference: number; by: string }[];
  expenses: { total: number; byCategory: { name: string; amount: number }[]; highValue: { description: string; category: string; amount: number }[] };
  profitLoss: { netRevenue: number; expenses: number; estimated: number };
  staff: { scheduled: string | null; actual: { name: string; start: string; end: string | null; replacement: boolean }[]; actions: { name: string; count: number }[] };
  attention: string[];
  /** Every shift of the day, waiters and reception, with its report (reports before Oct 2026 have none). */
  shifts?: { id: string; name: string; role: string; department: "RECEPTION" | "RESTAURANT"; start: string; end: string | null; minutes: number; reportId: string | null }[];
  /** Restaurant & bar orders placed that day (reports before Sept 2026 have none). */
  restaurant?: { orders: number; food: number; drinks: number; roomService: number };
  /** New bookings that day by where they came from. */
  sources?: { name: string; count: number }[];
  /** The stores that day (reports before Oct 2026 have none): received, used (and by recipes), waste, count corrections, alerts. */
  stores?: {
    receivedValue: number; receivedLines: number; usedValue: number; usedItems: number; soldValue: number; wasteValue: number; wasteLines: number;
    countDifferenceValue: number; value: number; low: number; out: number; pendingWaste: number; lowItems: string[]; outItems: string[];
    topUsed: { name: string; qty: string; value: number }[];
  };
  /** Assets that day: moved, under repair, out of order. */
  assets?: { records: number; moved: number; underRepair: number; outOfOrder: number; needsAttention: { name: string; code: string; location: string | null; status: string }[] };
  /** How the operation ran: late orders, rooms waiting for cleaning, maintenance issues, waiter money not confirmed. */
  operations?: { delayedOrders: number; roomsWaitingCleaning: number; maintenanceIssues: number; paymentsToConfirm: number };
}

export async function buildDailyReport(date: BusinessDate): Promise<DailyReportData> {
  const range = { from: date, to: date };
  const d = toDbDate(date);
  const [pl, occ, moves, owed, schedule, shifts, actions, overdue, maintenance, dirty, pendingExp, unpaidInHouse] = await Promise.all([
    profitLoss(range), occupancy(range), guestMovement(range), outstanding(),
    db.shiftSchedule.findUnique({ where: { businessDate: d }, include: { scheduledUser: { select: { fullName: true } } } }),
    db.actualShift.findMany({ where: { businessDate: d }, include: { user: { select: { fullName: true, role: { select: { name: true } } } }, report: { select: { id: true } } }, orderBy: { startedAt: "asc" } }),
    db.auditLog.groupBy({ by: ["userId"], where: { businessDate: d, userId: { not: null } }, _count: true, orderBy: { _count: { userId: "desc" } }, take: 5 }),
    db.invoice.aggregate({ where: { status: "OVERDUE" }, _count: true, _sum: { balanceAmount: true } }),
    db.room.findMany({ where: { isActive: true, status: { in: ["MAINTENANCE", "OUT_OF_SERVICE"] } }, select: { number: true } }),
    db.room.findMany({ where: { isActive: true, status: { in: ["DIRTY", "CLEANING"] } }, select: { number: true } }),
    db.expense.count({ where: { status: "PENDING_APPROVAL" } }),
    db.reservation.aggregate({ where: { status: "CHECKED_IN", balanceAmount: { gt: 0 } }, _count: true, _sum: { balanceAmount: true } }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: actions.map((a) => a.userId!).filter(Boolean) } }, select: { id: true, fullName: true } });
  const [byMethod, people, roomStatus, companyNights, companyPays, counts, invoiced] = await Promise.all([
    paymentsByMethod(date, date),
    staffActivity(date, date),
    db.room.groupBy({ by: ["status"], where: { isActive: true, roomType: { category: "GUEST_ROOM" } }, _count: true }),
    // Room income on company credit: nights of stays the company pays the room for.
    db.roomNight.aggregate({
      where: { businessDate: d, reservationRoom: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, roomType: { category: "GUEST_ROOM" }, reservation: { corporateCustomerId: { not: null }, OR: [{ billTo: "COMPANY" }, { billTo: "GROUP" }, { billTo: "SPLIT", companyCovers: { has: "ROOM" } }] } } },
      _sum: { netAmount: true },
    }),
    db.payment.aggregate({ where: { businessDate: d, status: "POSTED", kind: "PAYMENT", invoiceId: { not: null }, corporateCustomerId: { not: null } }, _sum: { amount: true } }),
    db.cashCount.findMany({ where: { businessDate: d, difference: { not: 0 } }, include: { account: true, countedBy: { select: { fullName: true } } } }),
    db.invoice.aggregate({ where: { issueDate: d, reservationId: null, corporateCustomerId: { not: null }, status: { notIn: ["DRAFT", "CANCELLED", "VOID"] } }, _sum: { netAmount: true } }),
  ]);
  // Arrivals due today: checked in / still expected (late notice) / no-show.
  const due = await db.reservationRoom.findMany({ where: { arrivalDate: d, status: { notIn: ["CANCELLED", "INQUIRY"] } }, select: { status: true, reservation: { select: { lateArrivalNotedAt: true } } } });
  const [dateChanges, roomChanges, corrections] = await Promise.all([
    db.auditLog.count({ where: { businessDate: d, action: "reservation.dates_changed" } }),
    db.auditLog.findMany({ where: { businessDate: d, action: { in: ["reservation.room_changed", "reservation.room_assigned"] } }, select: { action: true, after: true } }),
    db.paymentCorrection.count({ where: { businessDate: d } }),
  ]);
  const staying = await inHouseBalances(date);
  const [food, bySource, sourceNames, openOrders] = await Promise.all([
    db.restaurantOrder.aggregate({ where: { businessDate: d, status: { not: "CANCELLED" } }, _count: true, _sum: { foodSubtotal: true, drinksSubtotal: true, serviceFee: true } }),
    db.reservation.groupBy({ by: ["sourceId"], where: { businessDate: d, status: { notIn: ["CANCELLED", "INQUIRY"] } }, _count: true }),
    db.bookingSource.findMany({ select: { id: true, name: true } }),
    // Restaurant orders not paid (not on a room bill) — owed to the hotel too.
    db.restaurantOrder.findMany({ where: { status: { not: "CANCELLED" }, settlement: { not: "ROOM" } }, select: { total: true, paidAmount: true } }),
  ]);
  const unpaidOrders = openOrders.reduce((t, o) => t + Math.max(0, o.total - o.paidAmount), 0);
  const st = (xs: string[]) => roomStatus.filter((r) => xs.includes(r.status)).reduce((n, r) => n + r._count, 0);
  const settings = await getSettings();
  const threshold = settings.expenseApprovalThreshold;
  const rev = pl.revenue;
  const availableNow = await db.room.count({ where: { isActive: true, status: { in: ["AVAILABLE", "READY"] }, roomType: { category: "GUEST_ROOM" } } });
  const meeting = await meetingRoomStats(range);
  const time = (x: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: settings.timezone }).format(x);

  // The stores, assets and how the operation ran.
  const bounds = businessDayBounds(date, businessDayConfig(settings));
  const [storesDay, storesAlerts, assetSum, dayOrders, stockItems, toConfirm] = await Promise.all([
    inventoryDay(date, date), inventoryAlerts(date), assetSummary(bounds.start, bounds.end),
    db.restaurantOrder.findMany({ where: { businessDate: d, status: { not: "CANCELLED" } }, select: { createdAt: true, acceptedAt: true, readyAt: true } }),
    db.inventoryItem.findMany({ where: { isActive: true }, select: { quantity: true, costPerUnit: true } }),
    db.restaurantOrderPayment.count({ where: { status: "POSTED", confirmedAt: null } }),
  ]);
  const reportAt = new Date(Math.min(Date.now(), bounds.end.getTime()));
  // Late: more than 25 minutes from accepted (or placed) to ready — or still not ready that long after.
  const delayedOrders = dayOrders.filter((o) => ((o.readyAt ?? reportAt).getTime() - (o.acceptedAt ?? o.createdAt).getTime()) / 60000 > 25).length;
  const { formatQty } = await import("@/lib/inventory");

  const attention: string[] = [];
  if (owed.total > 0) attention.push(`Unpaid balances TZS ${fmt(owed.total)} (${owed.reservations.count + owed.invoices.count + owed.meetings.count})`);
  if ((unpaidInHouse._count ?? 0) > 0) attention.push(`${unpaidInHouse._count} in-house guest(s) owe TZS ${fmt(unpaidInHouse._sum.balanceAmount ?? 0)}`);
  if (overdue._count > 0) attention.push(`${overdue._count} overdue corporate invoice(s): TZS ${fmt(overdue._sum.balanceAmount ?? 0)}`);
  if (maintenance.length) attention.push(`Maintenance / out of service: ${maintenance.map((r) => r.number).join(", ")}`);
  if (dirty.length) attention.push(`Rooms awaiting cleaning: ${dirty.map((r) => r.number).join(", ")}`);
  if (pendingExp) attention.push(`${pendingExp} expense(s) waiting for approval`);
  const overdueGuests = await db.reservationRoom.count({ where: { status: "CHECKED_IN", departureDate: { lte: d }, roomType: { category: "GUEST_ROOM" } } });
  if (overdueGuests) attention.push(`${overdueGuests} guest(s) past checkout time`);
  if (storesAlerts.out.length) attention.push(`Out of stock: ${storesAlerts.out.slice(0, 6).map((i) => i.name).join(", ")}`);
  if (storesAlerts.low.length) attention.push(`Low stock: ${storesAlerts.low.slice(0, 6).map((i) => `${i.name} ${formatQty(i.quantity, i.unit)}`).join(", ")}`);
  if (storesAlerts.pendingWaste) attention.push(`${storesAlerts.pendingWaste} waste report(s) waiting for a manager`);
  if (assetSum.outOfOrder) attention.push(`${assetSum.outOfOrder} asset(s) out of order`);
  const desk = shifts.filter((s) => s.department === "RECEPTION");
  if (desk.length === 0) attention.push("No reception shift was recorded");
  if (schedule && desk.length && !desk.some((s) => s.userId === schedule.scheduledUserId)) attention.push(`Scheduled receptionist (${schedule.scheduledUser.fullName}) did not work the shift`);

  return {
    businessDate: date,
    hotel: { occupancy: round1(occ.occupancy), roomsSold: occ.roomsSold, roomNights: occ.roomNights, roomsAvailableNow: availableNow, sellable: occ.sellableNights },
    guests: moves,
    meetingRoom: meeting.rooms ? {
      bookings: meeting.bookings, completed: meeting.completed, cancelled: meeting.cancelled, noShows: meeting.noShows,
      revenue: meeting.revenue, bookedHours: meeting.bookedHours, utilisation: round1(meeting.utilisation),
    } : undefined,
    revenue: {
      roomGross: rev.rooms.gross, roomDiscounts: rev.rooms.discount, roomNet: rev.rooms.net,
      restaurant: rev.restaurant, bar: rev.bar, roomService: rev.roomService, transport: rev.transport, meeting: rev.meeting, other: rev.other, refunds: rev.refunds, total: pl.netRevenue,
    },
    money: {
      // Money in = payments + on-the-spot sales − refunds (the same rule as Finance and the lines by method).
      collected: byMethod.total, outstanding: owed.total + unpaidOrders, restaurantUnpaid: unpaidOrders,
      byMethod: byMethod.rows.filter((m) => m.amount !== 0).map((m) => ({ method: m.method, amount: m.amount })),
      companyPayments: companyPays._sum.amount ?? 0,
      companyInvoiced: invoiced._sum.netAmount ?? 0,
      inHouseOutstanding: staying.summary.totalOutstanding, inHouseOwing: staying.summary.owingCount,
    },
    rooms: {
      total: roomStatus.reduce((n, r) => n + r._count, 0), occupied: occ.roomNights, available: st(["AVAILABLE", "READY"]),
      cleaning: st(["DIRTY", "CLEANING"]), outOfOrder: st(["MAINTENANCE", "OUT_OF_SERVICE"]),
      adr: occ.roomsSold ? Math.round(rev.rooms.net / occ.roomsSold) : 0, income: rev.rooms.net,
      companyCredit: companyNights._sum.netAmount ?? 0, direct: rev.rooms.net - (companyNights._sum.netAmount ?? 0),
    },
    people: people.filter((x) => x.checkIns + x.checkOuts + x.bookings + x.payments + x.expenses > 0)
      .map((x) => ({ name: x.name, checkIns: x.checkIns, checkOuts: x.checkOuts, bookings: x.bookings, payments: x.payments + x.sales - x.refunds, expenses: x.expenses })),
    arrivals: {
      expected: due.length,
      checkedIn: due.filter((x) => x.status === "CHECKED_IN" || x.status === "CHECKED_OUT").length,
      late: due.filter((x) => (x.status === "RESERVED" || x.status === "CONFIRMED") && x.reservation.lateArrivalNotedAt).length,
      noShow: due.filter((x) => x.status === "NO_SHOW").length,
    },
    changes: (() => {
      const moves = roomChanges.filter((m) => m.action === "reservation.room_changed").map((m) => (m.after ?? {}) as { source?: string; charged?: number; compensation?: number });
      const hotel = moves.filter((m) => m.source === "Hotel-initiated");
      return {
        dates: dateChanges, rooms: roomChanges.length, paymentCorrections: corrections, discounts: rev.rooms.discount,
        roomMoves: {
          customer: moves.length - hotel.length, hotel: hotel.length, freeHotel: hotel.filter((m) => (m.charged ?? 0) === 0).length,
          paidUpgrades: moves.filter((m) => (m.charged ?? 0) > 0).length, upgradeRevenue: moves.reduce((t, m) => t + Math.max(0, m.charged ?? 0), 0),
          compensation: hotel.reduce((t, m) => t + (m.compensation ?? 0), 0),
        },
      };
    })(),
    cashDifferences: counts.map((c) => ({ account: c.account.name, difference: c.difference, by: c.countedBy.fullName })),
    expenses: {
      total: pl.expenses,
      byCategory: pl.expenseSummary.byCategory.map((c) => ({ name: c.name, amount: c.amount })),
      highValue: pl.expenseSummary.highValue.filter((e) => e.amount >= threshold).map((e) => ({ description: e.description, category: e.category.name, amount: e.amount })),
    },
    profitLoss: { netRevenue: pl.netRevenue, expenses: pl.expenses, estimated: pl.estimatedProfit },
    staff: {
      scheduled: schedule?.scheduledUser.fullName ?? null,
      actual: shifts.filter((s) => s.department === "RECEPTION").map((s) => ({ name: s.user.fullName, start: time(s.startedAt), end: s.endedAt ? time(s.endedAt) : null, replacement: s.isReplacement })),
      actions: actions.map((a) => ({ name: users.find((u) => u.id === a.userId)?.fullName ?? "Staff", count: a._count })),
    },
    attention,
    shifts: shifts.map((s) => ({
      id: s.id, name: s.user.fullName, role: s.user.role.name, department: s.department, start: time(s.startedAt), end: s.endedAt ? time(s.endedAt) : null,
      minutes: Math.max(0, Math.round(((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / 60000)), reportId: s.report?.id ?? null,
    })),
    restaurant: { orders: food._count, food: food._sum.foodSubtotal ?? 0, drinks: food._sum.drinksSubtotal ?? 0, roomService: food._sum.serviceFee ?? 0 },
    sources: bySource.map((x) => ({ name: sourceNames.find((n) => n.id === x.sourceId)?.name ?? "Other", count: x._count })).sort((a, b) => b.count - a.count),
    stores: {
      receivedValue: storesDay.receivedValue, receivedLines: storesDay.receivedLines, usedValue: storesDay.usedValue, usedItems: storesDay.usedItems,
      soldValue: storesDay.soldValue, wasteValue: storesDay.wasteValue, wasteLines: storesDay.wasteLines, countDifferenceValue: storesDay.countDifferenceValue,
      value: stockItems.reduce((t, i) => t + Math.max(0, Math.round(i.quantity * i.costPerUnit)), 0),
      low: storesAlerts.low.length + storesAlerts.reorder.length, out: storesAlerts.out.length, pendingWaste: storesAlerts.pendingWaste,
      lowItems: [...storesAlerts.low, ...storesAlerts.reorder].slice(0, 10).map((i) => `${i.name} ${formatQty(i.quantity, i.unit)}`),
      outItems: storesAlerts.out.slice(0, 10).map((i) => i.name),
      topUsed: storesDay.topUsed.map((u) => ({ name: u.name, qty: formatQty(u.qty, u.unit), value: u.value })),
    },
    assets: { records: assetSum.records, moved: assetSum.moved, underRepair: assetSum.underRepair, outOfOrder: assetSum.outOfOrder, needsAttention: assetSum.needsAttention },
    operations: { delayedOrders, roomsWaitingCleaning: dirty.length, maintenanceIssues: maintenance.length + assetSum.underRepair + assetSum.outOfOrder, paymentsToConfirm: toConfirm },
  };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-TZ");
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The Boss's phone message (CallMeBot / WhatsApp: *bold*, _italic_): the most important numbers first,
 * short lines, TZS throughout, only what earned something, and a link to the full report.
 * Same numbers as the dashboard and Finance.
 */
export function renderReportText(r: DailyReportData, hotelName: string, link?: string | null): string {
  const date = new Date(`${r.businessDate}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const tz = (v: number) => `TZS ${v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;
  const dept = ([
    ["Rooms", r.revenue.roomNet], ["Restaurant", r.revenue.restaurant], ["Bar", r.revenue.bar], ["Room service", r.revenue.roomService ?? 0],
    ["Meeting room", r.revenue.meeting], ["Transport", r.revenue.transport ?? 0], ["Other", r.revenue.other],
  ] as const).filter(([, v]) => v !== 0);
  const rooms = r.rooms;
  const sold = rooms ? rooms.occupied : r.hotel.roomNights;
  const lines = [
    `*${hotelName.toUpperCase()}*`,
    `*Daily business report* · ${date}`,
    "_hotel day 04:00 → 04:00_",
    "",
    `*Revenue ${tz(r.revenue.total)}*`,
    ...(dept.length ? dept.map(([k, v]) => `  ${k}: ${fmt(v)}`) : ["  No revenue recorded"]),
    r.revenue.roomDiscounts ? `  (room discounts given: ${fmt(r.revenue.roomDiscounts)})` : null,
    r.revenue.refunds ? `  (refunds: −${fmt(r.revenue.refunds)})` : null,
    "",
    `*Payments collected:* ${tz(r.money.collected)}`,
    `*Outstanding (all):* ${tz(r.money.outstanding)}`,
    `*Expenses:* ${tz(r.expenses.total)}`,
    `*Net operating result:* ${tz(r.profitLoss.estimated)}`,
    "",
    `*Occupancy:* ${sold}${rooms ? ` / ${rooms.total}` : ""} rooms — ${r.hotel.occupancy}%${rooms?.adr ? ` · avg rate ${fmt(rooms.adr)}` : ""}`,
    `*Check-ins:* ${r.guests.checkIns} · *Check-outs:* ${r.guests.checkOuts} · *New bookings:* ${r.guests.newBookings}`,
    r.restaurant ? `*Restaurant & bar:* ${r.restaurant.orders} order${r.restaurant.orders === 1 ? "" : "s"}` : null,
    r.sources?.length ? `*Bookings from:* ${r.sources.slice(0, 4).map((x) => `${x.name} ${x.count}`).join(" · ")}` : null,
    r.meetingRoom && (r.meetingRoom.bookings || r.meetingRoom.revenue) ? `*Meeting room:* ${r.meetingRoom.bookings} booking${r.meetingRoom.bookings === 1 ? "" : "s"} · ${tz(r.meetingRoom.revenue)}` : null,
    r.stores ? `*Stores:* received ${tz(r.stores.receivedValue)} · used ${tz(r.stores.usedValue)}${r.stores.wasteValue ? ` · waste ${tz(r.stores.wasteValue)}` : ""}` : null,
    r.stores && (r.stores.low || r.stores.out) ? `  Low stock ${r.stores.low} · out of stock ${r.stores.out}` : null,
    r.assets && (r.assets.moved || r.assets.underRepair || r.assets.outOfOrder) ? `*Assets:* moved ${r.assets.moved} · in repair ${r.assets.underRepair + r.assets.outOfOrder}` : null,
    r.operations ? `*Operations:* late orders ${r.operations.delayedOrders} · rooms to clean ${r.operations.roomsWaitingCleaning} · maintenance ${r.operations.maintenanceIssues}` : null,
    ...staffLines(r),
    "",
    r.attention.length ? `*Attention (${r.attention.length})*` : "*Nothing needs attention.*",
    ...r.attention.slice(0, 5).map((a) => `• ${a}`),
    r.attention.length > 5 ? `• …and ${r.attention.length - 5} more in the full report` : null,
    link ? `\n*Full report:* ${link}` : null,
  ];
  return lines.filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 3500);
}

/** "Reception: Sarah 12h 12m · John 10h 45m" — who worked the day, each department on its line (their shift reports are linked in the full report). */
function staffLines(r: DailyReportData) {
  if (!r.shifts?.length) return [];
  const dur = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  const line = (dept: "RECEPTION" | "RESTAURANT", label: string) => {
    const xs = r.shifts!.filter((s) => s.department === dept);
    return xs.length ? `  ${label}: ${xs.map((s) => `${s.name.split(" ")[0]} ${dur(s.minutes)}${s.end ? "" : " (on shift)"}`).join(" · ")}` : null;
  };
  return ["*Staff on shift:*", line("RECEPTION", "Reception"), line("RESTAURANT", "Restaurant")].filter((x): x is string => !!x);
}

/** Where the full report opens (the live site; this computer's address while testing). */
async function reportLink(id: string) {
  try {
    const { siteOrigin } = await import("../site-origin");
    return `${await siteOrigin()}/staff/reports/daily/${id}`;
  } catch {
    const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    return base ? `${base}/staff/reports/daily/${id}` : null;
  }
}

/**
 * Generate (or regenerate) and store the report for a business date — a permanent snapshot: the
 * numbers, the full document and the message. Regenerating keeps the earlier version (who replaced
 * it, when, why) and records a new version.
 */
export async function generateDailyReport(date: BusinessDate, who: string | { by: string; automatic?: boolean; reason?: string | null } = "system") {
  const o = typeof who === "string" ? { by: who, automatic: who === "system", reason: null } : { automatic: false, reason: null, ...who };
  const settings = await getSettings();
  const data = await buildDailyReport(date);
  const { buildDailyDocument } = await import("./daily-document");
  const document = await buildDailyDocument(date, data);
  const json = (v: unknown) => v as Prisma.InputJsonValue;
  const existing = await db.dailyReport.findUnique({ where: { businessDate: toDbDate(date) } });
  const report = await db.$transaction(async (tx) => {
    if (existing) {
      await tx.dailyReportVersion.create({
        data: {
          dailyReportId: existing.id, version: existing.version, data: json(existing.data), document: existing.document === null ? undefined : json(existing.document),
          summaryText: existing.summaryText, generatedAt: existing.generatedAt, generatedBy: existing.generatedBy, automatic: existing.automatic, reason: existing.reason, replacedBy: o.by,
        },
      });
      return tx.dailyReport.update({
        where: { id: existing.id },
        data: { data: json(data), document: json(document), summaryText: "", generatedAt: new Date(), generatedBy: o.by, automatic: o.automatic, reason: o.reason, version: existing.version + 1 },
      });
    }
    return tx.dailyReport.create({ data: { businessDate: toDbDate(date), data: json(data), document: json(document), summaryText: "", generatedBy: o.by, automatic: o.automatic, reason: o.reason } });
  });
  const summaryText = renderReportText(data, settings.hotelName, await reportLink(report.id));
  const saved = await db.dailyReport.update({ where: { id: report.id }, data: { summaryText } });
  await audit(db, { label: o.by }, {
    action: existing ? "report.daily_regenerated" : "report.daily_generated", entityType: "DailyReport", entityId: report.id,
    before: existing ? { version: existing.version, generatedBy: existing.generatedBy } : undefined,
    after: { businessDate: date, version: saved.version, automatic: o.automatic, reason: o.reason },
  });
  return saved;
}

/** Create delivery rows for each configured recipient (if missing) and attempt sending those not yet sent. */
export async function deliverDailyReport(reportId: string, opts: { force?: boolean; manual?: boolean; deadline?: number } = {}) {
  const report = await db.dailyReport.findUniqueOrThrow({ where: { id: reportId }, include: { deliveries: true } });
  return deliverToRecipients({ link: { dailyReportId: report.id }, purpose: "DAILY_REPORT", text: report.summaryText, generatedAt: report.generatedAt, deliveries: report.deliveries, force: opts.force, manual: opts.manual, deadline: opts.deadline });
}

/** When the day's report is made and sent (hotel time). */
export const REPORT_HOUR = 21;

/**
 * Cron entry point. At 21:00 (and any run until the 04:00 close) it makes the day's report once,
 * automatically, and sends it; later runs only retry sends that failed — never a second report or a
 * duplicate message. Runs earlier in the day only retry the last report's failed sends.
 */
export async function runDailyReportJob(now = new Date(), deadline?: number) {
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  if (!settings.reportEnabled) return { skipped: "disabled", businessDate: today };
  const hour = localParts(now, cfg.timezone).hour;
  if (hour < REPORT_HOUR && hour >= 4) {
    const last = await db.dailyReport.findFirst({ where: { businessDate: { lt: toDbDate(today) } }, orderBy: { businessDate: "desc" } });
    if (!last) return { skipped: "not yet 21:00", businessDate: today };
    return { businessDate: fromDbDate(last.businessDate), reportId: last.id, generated: false, delivery: await deliverDailyReport(last.id, { deadline }) };
  }
  const existing = await db.dailyReport.findUnique({ where: { businessDate: toDbDate(today) } });
  const report = existing?.automatic ? existing
    : await generateDailyReport(today, { by: "system", automatic: true, reason: existing ? "The 21:00 automatic report" : null });
  const delivery = await deliverDailyReport(report.id, { deadline });
  return { businessDate: today, reportId: report.id, generated: !existing?.automatic, delivery };
}
