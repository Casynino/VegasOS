import "server-only";
import { db } from "../db";
import { tableFloor } from "./dining-sessions";
import { addDays, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";

type Range = { from: BusinessDate; to: BusinessDate };

/** Where a table stands right now — the colours on the home's table cards. */
export type TableState = "FREE" | "BLOCKED" | "SEATED" | "BILL" | "PAID" | "RESERVED" | "ORDERS";

const minutesSince = (iso: string | null, now: Date) => (iso ? Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000)) : 0);
const TZ = "Africa/Dar_es_Salaam";
/** 12 → "12 min", 95 → "1 h 35 min", 1500 → "1 day". */
const ago = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? "" : "s"}`);
const clock = (d: Date | string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(d));

/**
 * The restaurant floor for the manager's and the MD's home: every table (and the counter) as it is
 * now — who sits there, their bill, a reservation coming — and how each one did in the period:
 * sales, customers, average bill, time at the table, the last 7 days and its latest customers.
 * To watch the floor, not to work it: waiters seat, serve and take the money.
 */
export async function tablesOnHome(today: BusinessDate, range: Range, now = new Date()) {
  const weekFrom = addDays(today, -6);
  const histFrom = addDays(today, -29);
  const from = [range.from, weekFrom, histFrom].sort()[0];
  const to = range.to > today ? range.to : today;
  const [floor, orders, sessions] = await Promise.all([
    tableFloor({ today, now }),
    db.restaurantOrder.findMany({
      where: { businessDate: { gte: toDbDate(from), lte: toDbDate(to) }, status: { not: "CANCELLED" }, OR: [{ locationId: { not: null } }, { sessionId: { not: null } }] },
      select: { locationId: true, total: true, businessDate: true, session: { select: { locationId: true } } },
    }),
    db.diningSession.findMany({
      where: { businessDate: { gte: toDbDate(from), lte: toDbDate(to) }, status: { not: "CANCELLED" } },
      orderBy: { startedAt: "desc" },
      select: {
        id: true, locationId: true, guestCount: true, startedAt: true, paidAt: true, closedAt: true, businessDate: true, status: true,
        guest: { select: { id: true, fullName: true } }, orders: { select: { status: true, total: true } },
      },
    }),
  ]);
  const inRange = (d: BusinessDate) => d >= range.from && d <= range.to;
  const week = eachDate(weekFrom, addDays(today, 1));

  const places = floor.filter((p) => p.kind !== "MAIN").map((p) => {
    const mineOrders = orders.filter((o) => (o.locationId ?? o.session?.locationId) === p.id).map((o) => ({ d: fromDbDate(o.businessDate), total: o.total }));
    const periodOrders = mineOrders.filter((o) => inRange(o.d));
    const mine = sessions.filter((s) => s.locationId === p.id);
    const periodSessions = mine.filter((s) => inRange(fromDbDate(s.businessDate)));
    const stays = periodSessions.map((s) => s.closedAt ?? s.paidAt).map((end, i) => (end ? (end.getTime() - periodSessions[i].startedAt.getTime()) / 60000 : null)).filter((m): m is number => m != null && m > 0);

    const s = p.session;
    const state: TableState = s ? (s.status === "AWAITING_PAYMENT" ? "BILL" : s.status === "PAID" ? "PAID" : "SEATED")
      : p.loose.length ? "ORDERS" : p.blocked ? "BLOCKED" : p.next?.holding ? "RESERVED" : "FREE";
    return {
      id: p.id, kind: p.kind, area: p.area, number: p.number, name: p.name, blocked: p.blocked,
      qrActive: p.qrActive, scans: p.scans, lastScan: p.lastScan,
      state,
      now: s ? {
        sessionId: s.id, customerId: s.customer.id, customer: s.customer.name, guests: s.guestCount, since: clock(s.startedAt), minutes: minutesSince(s.startedAt, now),
        billAsked: s.billRequestedAt ? minutesSince(s.billRequestedAt, now) : null, paidAgo: s.paidAt ? minutesSince(s.paidAt, now) : null,
        total: s.money.total, paid: s.money.paid, onRoom: s.money.onRoom, due: s.money.due,
        orders: s.orders.filter((o) => o.status !== "CANCELLED").map((o) => ({ id: o.id, number: o.number, status: o.status, total: o.total, items: o.items.reduce((t, i) => t + i.qty, 0) })),
      } : null,
      loose: p.loose.map((o) => ({ id: o.id, number: o.number, status: o.status, total: o.total, due: o.due, customer: o.customer, items: o.items.reduce((t, i) => t + i.qty, 0) })),
      next: p.next ? { name: p.next.name, at: clock(p.next.at), guests: p.next.guests, holding: p.next.holding, late: p.next.holding && new Date(p.next.at) < now ? minutesSince(p.next.at, now) : 0 } : null,
      doneToday: p.doneToday,
      period: {
        sales: periodOrders.reduce((t, o) => t + o.total, 0), orders: periodOrders.length,
        customers: periodSessions.length, guests: periodSessions.reduce((t, x) => t + x.guestCount, 0),
        minutes: stays.length ? Math.round(stays.reduce((a, b) => a + b, 0) / stays.length) : null,
      },
      week: week.map((d) => ({ d, sales: mineOrders.filter((o) => o.d === d).reduce((t, o) => t + o.total, 0) })),
      recent: mine.slice(0, 5).map((x) => ({
        id: x.id, customerId: x.guest.id, customer: x.guest.fullName, guests: x.guestCount, date: fromDbDate(x.businessDate), at: clock(x.startedAt),
        total: x.orders.filter((o) => o.status !== "CANCELLED").reduce((t, o) => t + o.total, 0),
        minutes: x.closedAt ?? x.paidAt ? Math.round(((x.closedAt ?? x.paidAt)!.getTime() - x.startedAt.getTime()) / 60000) : null, open: !x.closedAt,
      })),
    };
  });

  const tables = places.filter((p) => p.kind === "TABLE");
  const count = (st: TableState) => places.filter((p) => p.state === st).length;
  const sales = places.reduce((t, p) => t + p.period.sales, 0);
  const customers = places.reduce((t, p) => t + p.period.customers, 0);
  const orderCount = places.reduce((t, p) => t + p.period.orders, 0);
  const allStays = places.flatMap((p) => (p.period.minutes != null ? [p.period.minutes * p.period.customers] : []));
  const staysCount = places.reduce((t, p) => t + (p.period.minutes != null ? p.period.customers : 0), 0);
  const best = [...places].sort((a, b) => b.period.sales - a.period.sales)[0];

  // What a manager may want to look at (the waiters do the work).
  const watch: { tone: "amber" | "violet" | "rose" | "sky"; text: string; id: string }[] = [
    ...places.filter((p) => p.now?.billAsked != null && p.now.billAsked >= 15 && p.state === "BILL").map((p) => ({ tone: "amber" as const, id: p.id, text: `${p.name} has waited ${ago(p.now!.billAsked!)} to pay` })),
    ...places.filter((p) => p.state === "PAID" && (p.now?.paidAgo ?? 0) >= 20).map((p) => ({ tone: "violet" as const, id: p.id, text: `${p.name} paid ${ago(p.now!.paidAgo!)} ago — not cleared yet` })),
    ...places.filter((p) => p.next?.late && p.next.late >= 10 && p.state === "RESERVED").map((p) => ({ tone: "sky" as const, id: p.id, text: `${p.next!.name} (${p.next!.at}) hasn't come to ${p.name} — ${ago(p.next!.late)} late` })),
    ...places.filter((p) => !p.qrActive).map((p) => ({ tone: "rose" as const, id: p.id, text: `${p.name}: QR switched off — customers can't order by scanning` })),
  ];

  return {
    places,
    summary: {
      tables: tables.length, spots: places.length,
      busy: count("SEATED") + count("BILL") + count("PAID") + count("ORDERS"), seated: count("SEATED"), bill: count("BILL"), paid: count("PAID"),
      free: count("FREE"), reserved: count("RESERVED"),
      upcoming: places.filter((p) => p.next && !p.next.holding).length,
      people: places.reduce((t, p) => t + (p.now?.guests ?? 0), 0),
      due: places.reduce((t, p) => t + (p.now?.due ?? 0) + p.loose.reduce((u, o) => u + o.due, 0), 0),
      sales, orders: orderCount, customers, guests: places.reduce((t, p) => t + p.period.guests, 0),
      avgBill: customers ? Math.round(sales / customers) : orderCount ? Math.round(sales / orderCount) : 0,
      minutes: staysCount ? Math.round(allStays.reduce((a, b) => a + b, 0) / staysCount) : null,
      best: best && best.period.sales > 0 ? { name: best.name, sales: best.period.sales } : null,
      unused: places.filter((p) => p.period.sales === 0 && p.period.customers === 0).length,
    },
    watch,
  };
}
export type TablesOnHomeData = Awaited<ReturnType<typeof tablesOnHome>>;
export type HomeTable = TablesOnHomeData["places"][number];
