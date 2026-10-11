import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings } from "../settings";
import { addDays, businessDayBounds, diffDays, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { EARNED_NIGHT } from "./reservation-financials";
import { owedToHotel, profitLoss } from "./reporting";
import { paymentsByMethod } from "./finance";

/**
 * The DAILY ROOM REPORT's figures for one business day (04:00 → 04:00), from the real reservation, check-in and
 * payment records. Never invents a number: what is not known is left out or flagged.
 *
 * The one rule that matters: a NEW SALE is a guest-room check-in inside the period (a 4-night stay is one new sale,
 * on its check-in day only). A CONTINUING stay checked in before the period and is still in house at its end. A
 * CHECK-OUT left in the period. OCCUPIED = every room that had a guest at any time in the period. Room NIGHTS are
 * the nights those new sales cover. The meeting room is never counted.
 */

/** The whole hotel's money for one day, in the Boss's words: what it earned, what it spent, what is left. */
export type DayMoney = {
  income: { rooms: number; restaurant: number; bar: number; roomService: number; meeting: number; transport: number; other: number; refunds: number; total: number };
  expenses: { total: number; byCategory: { name: string; amount: number }[] };
  /** Income minus expenses. */
  profit: number;
  /** Money that came in that day (payments and on-the-spot sales, less refunds) and what is still owed to the hotel. */
  received: number; owed: number;
};

/**
 * Income, expenses and net profit of one business day — the same services as the daily report and the Boss's
 * dashboard, so the two reports can never disagree. Nothing is calculated here.
 */
export async function dayMoney(date: BusinessDate): Promise<DayMoney> {
  const [pl, received, owed] = await Promise.all([profitLoss({ from: date, to: date }), paymentsByMethod(date, date), owedToHotel()]);
  const r = pl.revenue;
  return {
    income: { rooms: r.rooms.net, restaurant: r.restaurant, bar: r.bar, roomService: r.roomService, meeting: r.meeting, transport: r.transport, other: r.other, refunds: r.refunds, total: pl.netRevenue },
    expenses: { total: pl.expenses, byCategory: pl.expenseSummary.byCategory.filter((c) => c.amount > 0).map((c) => ({ name: c.name, amount: c.amount })) },
    profit: pl.estimatedProfit, received: received.total, owed,
  };
}

/** A report made before the day's money was kept with it reads those figures from the books now. */
export async function withDayMoney(d: RoomReportData): Promise<RoomReportData> {
  return d.day ? d : { ...d, day: await dayMoney(d.date) };
}

export type SaleRow = {
  room: string; type: string; checkedInAt: string; nights: number; dayUse: boolean;
  /** Rate per night (the average when the nights were priced differently — then `mixed`); null = unknown. */
  rate: number | null; mixed: boolean; total: number; gross: number; discount: number; reference: string; by: string | null;
};
export type RateGroup = { rate: number; stays: number; nights: number; expected: number };
export type ContinuingRow = {
  room: string; type: string; arrival: string; departure: string; nights: number; elapsed: number; remaining: number; status: string;
};
export type CheckoutRow = {
  room: string; type: string; at: string; reference: string; charges: number; paid: number; outstanding: number; roomNow: string; by: string | null;
};
export type StaffRow = { name: string; shift: string | null; checkIns: number; checkOuts: number; walkIns: number; payments: number; collected: number };

export type RoomReportData = {
  date: string;
  periodStart: string; periodEnd: string;
  generatedAt: string;
  timezone: string;
  guestRooms: number;
  perf: { occupied: number; newSales: number; continuing: number; checkedOut: number; available: number; occupancyPct: number; nightsSold: number };
  money: { expected: number; gross: number; discounts: number; recognized: number; collected: number; refunds: number; reversed: number; outstanding: number };
  /** The whole hotel's money for the day. Reports made before 11 Oct 2026 have none — it is then read from the books when shown. */
  day?: DayMoney;
  sales: SaleRow[];
  rates: RateGroup[];
  continuing: ContinuingRow[];
  checkouts: CheckoutRow[];
  status: { key: string; label: string; count: number }[];
  trend: { date: string; occupied: number; sold: number; revenue: number }[];
  staff: StaffRow[];
  unknownRates: number;
};

const STATUS_LABEL: [string, string, string[]][] = [
  ["READY", "Available & ready for sale", ["AVAILABLE", "READY"]],
  ["OCCUPIED", "Occupied", ["OCCUPIED"]],
  ["RESERVED", "Reserved", ["RESERVED"]],
  ["DIRTY", "Dirty (checked out, not ready)", ["DIRTY"]],
  ["CLEANING", "Being cleaned", ["CLEANING"]],
  ["MAINTENANCE", "Maintenance", ["MAINTENANCE"]],
  ["OUT_OF_SERVICE", "Out of service", ["OUT_OF_SERVICE"]],
];

export async function buildRoomReportData(date: BusinessDate): Promise<RoomReportData> {
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const { start, end } = businessDayBounds(date, cfg);
  const guest = { roomType: { category: "GUEST_ROOM" as const } };
  const stayStatuses = ["CHECKED_IN", "CHECKED_OUT"] as const;
  const dbDate = toDbDate(date);

  const [meetingTypes, stays, rooms] = await Promise.all([
    db.roomType.findMany({ where: { category: "MEETING_ROOM" }, select: { id: true } }),
    db.reservationRoom.findMany({
      where: {
        ...guest, status: { in: [...stayStatuses] }, checkedInAt: { lt: end, not: null },
        OR: [{ checkedOutAt: null }, { checkedOutAt: { gte: start } }],
      },
      select: {
        id: true, status: true, checkedInAt: true, checkedOutAt: true, arrivalDate: true, departureDate: true, nights: true, isDayUse: true,
        grossAmount: true, discountAmount: true, netAmount: true,
        room: { select: { number: true, status: true } }, roomType: { select: { name: true } },
        reservation: { select: { id: true, reference: true, netAmount: true, paidAmount: true, balanceAmount: true, source: { select: { name: true } } } },
        checkedInBy: { select: { id: true, fullName: true } }, checkedOutBy: { select: { id: true, fullName: true } },
        nightsLedger: { select: { netAmount: true, grossAmount: true }, orderBy: { businessDate: "asc" } },
      },
      orderBy: { checkedInAt: "asc" },
    }),
    db.room.findMany({ where: { isActive: true, ...guest }, select: { status: true } }),
  ]);
  const meetingIds = meetingTypes.map((m) => m.id);

  const inPeriod = (d: Date | null) => !!d && d >= start && d < end;
  const newStays = stays.filter((s) => inPeriod(s.checkedInAt));
  const before = stays.filter((s) => s.checkedInAt! < start);
  const continuingStays = before.filter((s) => !s.checkedOutAt || s.checkedOutAt >= end);
  const outs = stays.filter((s) => inPeriod(s.checkedOutAt));
  const occupiedRooms = new Set(stays.map((s) => s.room.number));

  // ── new sales + the nightly-rate groups ──
  let unknownRates = 0;
  const groups = new Map<number, { stays: Set<string>; nights: number; expected: number }>();
  const sales: SaleRow[] = newStays.map((s) => {
    const nights = s.isDayUse || s.nights === 0 ? 0 : s.nights;
    const per = s.nightsLedger.map((n) => n.netAmount);
    let rate: number | null = null; let mixed = false;
    if (per.length) {
      mixed = per.some((p) => p !== per[0]);
      rate = mixed ? Math.round(per.reduce((a, b) => a + b, 0) / per.length) : per[0];
      for (const p of per) {
        const g = groups.get(p) ?? { stays: new Set<string>(), nights: 0, expected: 0 };
        g.stays.add(s.id); g.nights += 1; g.expected += p; groups.set(p, g);
      }
    } else unknownRates++;
    return {
      room: s.room.number, type: s.roomType.name, checkedInAt: s.checkedInAt!.toISOString(), nights, dayUse: s.isDayUse,
      rate, mixed, total: s.netAmount, gross: s.grossAmount, discount: s.discountAmount, reference: s.reservation.reference, by: s.checkedInBy?.fullName ?? null,
    };
  });
  const rates: RateGroup[] = [...groups.entries()].map(([rate, g]) => ({ rate, stays: g.stays.size, nights: g.nights, expected: g.expected })).sort((a, b) => b.rate - a.rate);

  // ── continuing + checkouts ──
  const elapsedAt = (arr: Date) => Math.max(0, diffDays(fromDbDate(arr), date) + 1);
  const continuing: ContinuingRow[] = continuingStays.map((s) => {
    const elapsed = Math.min(s.nights, elapsedAt(s.arrivalDate));
    return {
      room: s.room.number, type: s.roomType.name, arrival: fromDbDate(s.arrivalDate), departure: fromDbDate(s.departureDate),
      nights: s.nights, elapsed, remaining: Math.max(0, s.nights - elapsed), status: fromDbDate(s.departureDate) <= date ? "Due to leave / overstaying" : "In house",
    };
  });
  const checkouts: CheckoutRow[] = outs.map((s) => ({
    room: s.room.number, type: s.roomType.name, at: s.checkedOutAt!.toISOString(), reference: s.reservation.reference,
    charges: s.reservation.netAmount, paid: s.reservation.paidAmount, outstanding: Math.max(0, s.reservation.balanceAmount), roomNow: s.room.status, by: s.checkedOutBy?.fullName ?? null,
  }));

  // ── money (this day) ──
  const periodStays = stays;
  const reservationIds = [...new Set(periodStays.map((s) => s.reservation.id))];
  const stayKind = { reservation: { kind: "STAY" as const } };
  const [recognizedAgg, paid, refunded, reversed, outstandingRows, payBy] = await Promise.all([
    db.roomNight.aggregate({ where: { businessDate: dbDate, ...EARNED_NIGHT, roomTypeId: { notIn: meetingIds } }, _sum: { netAmount: true } }),
    db.payment.aggregate({ where: { businessDate: dbDate, status: "POSTED", kind: "PAYMENT", ...stayKind }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { businessDate: dbDate, status: "POSTED", kind: "REFUND", ...stayKind }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { status: "REVERSED", reversalBusinessDate: dbDate, ...stayKind }, _sum: { amount: true } }),
    reservationIds.length ? db.reservation.findMany({ where: { id: { in: reservationIds }, balanceAmount: { gt: 0 } }, select: { balanceAmount: true } }) : Promise.resolve([]),
    db.payment.groupBy({ by: ["recordedById"], where: { businessDate: dbDate, status: "POSTED", kind: "PAYMENT", ...stayKind }, _sum: { amount: true }, _count: true }),
  ]);
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
  const money = {
    expected: sum(newStays, (s) => s.netAmount), gross: sum(newStays, (s) => s.grossAmount), discounts: sum(newStays, (s) => s.discountAmount),
    recognized: recognizedAgg._sum.netAmount ?? 0, collected: paid._sum.amount ?? 0, refunds: refunded._sum.amount ?? 0, reversed: reversed._sum.amount ?? 0,
    outstanding: sum(outstandingRows, (r) => r.balanceAmount),
  };

  // ── room status now ──
  const status = STATUS_LABEL.map(([key, label, from]) => ({ key, label, count: rooms.filter((r) => from.includes(r.status)).length }));
  const available = status.find((x) => x.key === "READY")?.count ?? 0;

  // ── staff ──
  const people = new Map<string, StaffRow & { id: string }>();
  const person = (id: string, name: string) => {
    let p = people.get(id);
    if (!p) people.set(id, p = { id, name, shift: null, checkIns: 0, checkOuts: 0, walkIns: 0, payments: 0, collected: 0 });
    return p;
  };
  for (const s of newStays) if (s.checkedInBy) {
    const p = person(s.checkedInBy.id, s.checkedInBy.fullName); p.checkIns++;
    if (s.reservation.source.name.toLowerCase().includes("walk")) p.walkIns++;
  }
  for (const s of outs) if (s.checkedOutBy) person(s.checkedOutBy.id, s.checkedOutBy.fullName).checkOuts++;
  const payerIds = payBy.map((p) => p.recordedById);
  const payers = payerIds.length ? await db.user.findMany({ where: { id: { in: payerIds } }, select: { id: true, fullName: true } }) : [];
  for (const p of payBy) {
    const u = payers.find((x) => x.id === p.recordedById);
    if (!u) continue;
    const row = person(u.id, u.fullName); row.payments += p._count; row.collected += p._sum.amount ?? 0;
  }
  const shifts = people.size ? await db.actualShift.findMany({ where: { businessDate: dbDate, department: "RECEPTION", userId: { in: [...people.keys()] } }, select: { userId: true, startedAt: true, endedAt: true } }) : [];
  const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: settings.timezone }).format(d);
  for (const sh of shifts) {
    const p = people.get(sh.userId);
    if (p) p.shift = `${clock(sh.startedAt)} – ${sh.endedAt ? clock(sh.endedAt) : "still open"}`;
  }

  // ── trend: the last 7 days, only from real nights ──
  const trendDates = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6));
  const nights = await db.roomNight.groupBy({
    by: ["businessDate"], where: { businessDate: { gte: toDbDate(trendDates[0]), lte: dbDate }, ...EARNED_NIGHT, roomTypeId: { notIn: meetingIds } },
    _count: true, _sum: { netAmount: true },
  });
  const sold = await Promise.all(trendDates.map(async (d) => {
    const b = businessDayBounds(d, cfg);
    return db.reservationRoom.count({ where: { ...guest, status: { in: [...stayStatuses] }, checkedInAt: { gte: b.start, lt: b.end } } });
  }));
  const trend = trendDates.map((d, i) => {
    const n = nights.find((x) => fromDbDate(x.businessDate) === d);
    return { date: d, occupied: n?._count ?? 0, sold: sold[i], revenue: n?._sum.netAmount ?? 0 };
  });

  const guestRooms = rooms.length;
  const dayFigures = await dayMoney(date);
  return {
    date, periodStart: start.toISOString(), periodEnd: end.toISOString(), generatedAt: new Date().toISOString(), timezone: settings.timezone, guestRooms,
    perf: {
      occupied: occupiedRooms.size, newSales: newStays.length, continuing: continuingStays.length, checkedOut: outs.length, available,
      occupancyPct: guestRooms ? Math.round((occupiedRooms.size / guestRooms) * 100) : 0,
      nightsSold: sum(sales, (s) => (s.dayUse ? 0 : s.nights)),
    },
    money, day: dayFigures, sales, rates, continuing, checkouts, status, trend, staff: [...people.values()].map(({ id: _id, ...r }) => r), unknownRates,
  };
}
