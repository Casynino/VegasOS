import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings } from "../settings";
import { addDays, businessDayBounds, diffDays, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { EARNED_NIGHT } from "./reservation-financials";
import { owedToHotel, profitLoss } from "./reporting";
import { paymentsByMethod } from "./finance";
import { billsAsOf, checkedInWithin, owedAtClose, paymentsReceived, recordChecks, roomList, type OwingLine, type PaymentLine, type Received } from "./room-sales";
import type { BillState } from "@/lib/payment-status";

/**
 * The DAILY ROOM REPORT's figures for one business day (04:00 → 04:00), from the real reservation, check-in and
 * payment records. Never invents a number: what is not known is left out or flagged.
 *
 * The one rule that matters: a NEW SALE is a guest-room check-in inside the period (a 4-night stay is one new sale,
 * on its check-in day only). A CONTINUING stay checked in before the period and is still in house at its end. A
 * CHECK-OUT left in the period. OCCUPIED = every room that had a guest at any time in the period. Room NIGHTS are
 * the nights those new sales cover. The meeting room is never counted.
 *
 * A room sale, the room income of a night, a payment and what is still owed are four different things — the rules
 * are written once in room-sales.ts and this report only reads them.
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

/** What a booking had paid and still owed as the day closed (money is paid against the booking, not one room). */
type BillPart = {
  /** Extras on the room bill up to that day (restaurant, bar, laundry …). */
  extras: number; paid: number;
  /** Moved onto a company invoice — owed by the company, not money received. */
  company: number; owed: number; status: BillState;
  /** Other rooms of the same booking that are not in this row — the paid and owed amounts cover them too. */
  also: string | null;
  /** A discount on the whole bill given on a later day: off the price shown (as it is now), still owed that day. */
  discountLater?: number;
};
/** A booking sold (checked in) in the period: its rooms together, the price of the whole stay, and its bill. */
export type SoldStay = BillPart & {
  rooms: string; types: string; guest: string; reference: string; checkedInAt: string; walkIn: boolean;
  nights: number; dayUse: boolean; rate: number | null; mixed: boolean; gross: number; discount: number; total: number;
};
/** A booking that checked in before the period and is still in house — never a new sale. */
export type StayingStay = BillPart & {
  rooms: string; types: string; guest: string; reference: string; checkedInAt: string; departure: string; nights: number;
  /** This day's night of the stay — the part of it that is this day's room income; null = no night on record. */
  tonight: number | null;
  /** The agreed room charge for the whole stay, after discount. */
  total: number;
};
/** The room money of the day, stay by stay — sales, payments and what is owed, kept apart. */
export type RoomMoney = {
  sold: SoldStay[]; staying: StayingStay[];
  /** Every payment recorded against a room booking this day, with the day its room was sold. */
  payments: PaymentLine[]; received: Received;
  /** Room guests who still owed as the day closed, and the total. */
  owing: OwingLine[]; owed: number;
  /** New check-ins (rooms): guests who walked in, and guests with a reservation. */
  checkIns: { walkIns: number; reservations: number };
  /** This day's room income, by where it came from: rooms sold today, continuing stays, other nights. */
  income: { sold: number; staying: number; other: number };
  /** Records that do not add up or were changed after the day closed — shown, never corrected by guessing. */
  notes: string[];
};

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
  /** Stay-by-stay room money. Reports made before it was added have none and are shown as they were made. */
  rooms?: RoomMoney;
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
        reservation: {
          select: {
            id: true, reference: true, source: { select: { code: true } }, guest: { select: { fullName: true } },
            rooms: { where: { ...guest, status: { in: [...stayStatuses] } }, select: { id: true, room: { select: { number: true } } } },
          },
        },
        checkedInBy: { select: { id: true, fullName: true } }, checkedOutBy: { select: { id: true, fullName: true } },
        nightsLedger: { select: { netAmount: true, grossAmount: true, businessDate: true }, orderBy: { businessDate: "asc" } },
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

  // ── money (this day) ──
  const reservationIds = [...new Set(stays.map((s) => s.reservation.id))];
  const stayKind = { reservation: { kind: "STAY" as const } };
  const [recognizedAgg, paid, refunded, reversed, payBy, bills, pay, owing, notes] = await Promise.all([
    db.roomNight.aggregate({ where: { businessDate: dbDate, ...EARNED_NIGHT, roomTypeId: { notIn: meetingIds } }, _sum: { netAmount: true } }),
    db.payment.aggregate({ where: { businessDate: dbDate, status: "POSTED", kind: "PAYMENT", ...stayKind }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { businessDate: dbDate, status: "POSTED", kind: "REFUND", ...stayKind }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { status: "REVERSED", reversalBusinessDate: dbDate, ...stayKind }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["recordedById"], where: { businessDate: dbDate, status: "POSTED", kind: "PAYMENT", ...stayKind }, _sum: { amount: true }, _count: true }),
    // Each booking's bill as this day closed — a payment made on a later day is not in it.
    billsAsOf(reservationIds, date),
    paymentsReceived(date, cfg),
    owedAtClose(date, cfg),
    recordChecks(date, cfg, reservationIds),
  ]);
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
  const money = {
    expected: sum(newStays, (s) => s.netAmount), gross: sum(newStays, (s) => s.grossAmount), discounts: sum(newStays, (s) => s.discountAmount),
    recognized: recognizedAgg._sum.netAmount ?? 0, collected: paid._sum.amount ?? 0, refunds: refunded._sum.amount ?? 0, reversed: reversed._sum.amount ?? 0,
    // What the guests of this period's rooms owed as the day closed.
    outstanding: sum([...bills.values()], (b) => Math.max(0, b.owed)),
  };

  // The bill belongs to the booking: on a booking of several rooms it is counted once, on its first room.
  const billed = new Set<string>();
  const checkouts: CheckoutRow[] = outs.map((s) => {
    const bill = billed.has(s.reservation.id) ? undefined : bills.get(s.reservation.id);
    billed.add(s.reservation.id);
    return {
      room: s.room.number, type: s.roomType.name, at: s.checkedOutAt!.toISOString(), reference: s.reservation.reference,
      charges: bill?.total ?? 0, paid: bill?.paid ?? 0, outstanding: Math.max(0, bill?.owed ?? 0), roomNow: s.room.status, by: s.checkedOutBy?.fullName ?? null,
    };
  });

  // ── stay by stay: what was sold, what continues, with each booking's bill as the day closed ──
  type Stay = (typeof stays)[number];
  const byBooking = (xs: Stay[]) => {
    const m = new Map<string, Stay[]>();
    for (const x of xs) m.set(x.reservation.id, [...(m.get(x.reservation.id) ?? []), x]);
    return [...m.values()];
  };
  const nightOn = (s: Stay) => s.nightsLedger.find((x) => fromDbDate(x.businessDate) === date)?.netAmount ?? null;
  const billPart = (rs: Stay[]): BillPart => {
    const b = rs[0].reservation, bill = bills.get(b.id), mine = new Set(rs.map((s) => s.id));
    return {
      extras: bill?.extras ?? 0, paid: bill?.paid ?? 0, company: bill?.company ?? 0, owed: bill?.owed ?? 0, status: bill?.status ?? "NOTHING_DUE",
      also: roomList(b.rooms.filter((r) => !mine.has(r.id)).map((r) => r.room.number)) || null,
      ...(bill?.discountLater ? { discountLater: bill.discountLater } : {}),
    };
  };
  const named = (rs: Stay[]) => ({
    rooms: roomList(rs.map((s) => s.room.number)), types: [...new Set(rs.map((s) => s.roomType.name))].join(", "),
    guest: rs[0].reservation.guest.fullName, reference: rs[0].reservation.reference, checkedInAt: rs[0].checkedInAt!.toISOString(),
  });
  const soldStays: SoldStay[] = byBooking(newStays).map((rs) => {
    const per = rs.flatMap((s) => s.nightsLedger.map((x) => x.netAmount));
    const mixed = per.some((x) => x !== per[0]);
    return {
      ...named(rs), ...billPart(rs), walkIn: rs[0].reservation.source.code === "WALK_IN",
      nights: sum(rs, (s) => (s.isDayUse ? 0 : s.nights)), dayUse: rs.every((s) => s.isDayUse),
      rate: per.length ? (mixed ? Math.round(sum(per, (x) => x) / per.length) : per[0]) : null, mixed,
      gross: sum(rs, (s) => s.grossAmount), discount: sum(rs, (s) => s.discountAmount), total: sum(rs, (s) => s.netAmount),
    };
  });
  const stayingStays: StayingStay[] = byBooking(continuingStays).map((rs) => {
    const tonight = rs.map(nightOn).filter((x): x is number => x !== null);
    return {
      ...named(rs), ...billPart(rs), departure: rs.map((s) => fromDbDate(s.departureDate)).sort().at(-1)!, nights: sum(rs, (s) => s.nights),
      tonight: tonight.length ? sum(tonight, (x) => x) : null, total: sum(rs, (s) => s.netAmount),
    };
  });
  const walkIns = newStays.filter((s) => s.reservation.source.code === "WALK_IN").length;
  const incomeSold = sum(newStays, (s) => nightOn(s) ?? 0), incomeStaying = sum(before, (s) => nightOn(s) ?? 0);
  const roomMoney: RoomMoney = {
    sold: soldStays, staying: stayingStays, payments: pay.lines, received: pay.received, owing: owing.lines, owed: owing.owed,
    checkIns: { walkIns, reservations: newStays.length - walkIns },
    income: { sold: incomeSold, staying: incomeStaying, other: money.recognized - incomeSold - incomeStaying },
    notes,
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
    if (s.reservation.source.code === "WALK_IN") p.walkIns++;
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
    return db.reservationRoom.count({ where: checkedInWithin(b.start, b.end) });
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
    money, day: dayFigures, rooms: roomMoney, sales, rates, continuing, checkouts, status, trend, staff: [...people.values()].map(({ id: _id, ...r }) => r), unknownRates,
  };
}
