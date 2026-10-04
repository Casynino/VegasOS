import "server-only";
import { db } from "../db";
import {
  change, dailyByKind, dailyMoney, expenseSummary, guestMovement, meetingRoomStats, occupancy, onTheBooks, outstanding, previousRange, profitLoss, stayPatterns, topCustomers,
  type Range,
} from "./reporting";
import { tablesOnHome } from "./table-performance";
import { assetSummary, inventoryAlerts } from "./inventory";
import { KIND_LABEL, formatQty, reasonLabel, type MovementKind } from "@/lib/inventory";
import { businessDayConfig, getSettings } from "../settings";
import { staffPerformance } from "./staff-performance";
import { ORDER_SOURCE } from "./restaurant";
import { addDays, businessRangeBounds, diffDays, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { REPORTS, type Block, type Cell, type Figure, type Report, type ReportKey } from "@/lib/report-types";

// ───────────────────────── helpers ─────────────────────────

const TZ = "Africa/Dar_es_Salaam";
const tzs = (v: number) => formatTZS(v);
const num = (v: number) => v.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const dbr = (r: Range) => ({ gte: toDbDate(r.from), lte: toDbDate(r.to) });
const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);
const hourOf = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(d));
const shortDay = (d: BusinessDate) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayMonth = (d: BusinessDate) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const when = (d: Date) => `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ }).format(d)} ${clock(d)}`;
const plural = (n: number, w: string, many = `${w}s`) => `${num(n)} ${n === 1 ? w : many}`;
const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const orderPlace = (o: { location?: { name: string } | null; tableLabel?: string | null; roomNumber?: string | null; type: string }) =>
  o.location?.name ?? o.tableLabel ?? (o.roomNumber ? `Room ${o.roomNumber}` : o.type === "TAKEAWAY" ? "Delivery" : o.type === "PICKUP" ? "Pick-up" : "Restaurant");
const noBrackets = (s: string) => s.replace(/\s*\(.*\)/, "");

/** One colour per department, in a fixed order, everywhere in the reports. */
export const DEPT = {
  rooms: { label: "Rooms", color: "#8b5cf6" },
  restaurant: { label: "Food (restaurant)", color: "#f59e0b" },
  bar: { label: "Drinks (bar)", color: "#0ea5e9" },
  roomService: { label: "Room service fees", color: "#f43f5e" },
  meeting: { label: "Meeting room", color: "#10b981" },
  transport: { label: "Transport", color: "#64748b" },
  other: { label: "Other & extras", color: "#c9a24a" },
} as const;
type DeptKey = keyof typeof DEPT;
const DEPT_KEYS = Object.keys(DEPT) as DeptKey[];

const TYPE_LABEL: Record<string, string> = { DINE_IN: "Dine-in (tables)", ROOM_SERVICE: "Room service", TAKEAWAY: "Delivery", PICKUP: "Pick-up" };
const STATUS_WORD: Record<string, string> = {
  PENDING: "New", ACCEPTED: "Accepted", PREPARING: "Preparing", READY: "Ready to serve", OUT_FOR_DELIVERY: "Serving", DELIVERED: "Served", COMPLETED: "Done", COLLECTED: "Done", CANCELLED: "Cancelled",
};

/** Days → the rows of a day-by-day table; a long period (over two months) is summed by month instead. */
function byDayOrMonth<T extends { date: BusinessDate }>(rows: T[], sum: (xs: T[]) => Cell[]): { label: string; rows: Cell[][] } {
  if (rows.length <= 62) return { label: "Day", rows: rows.map((r) => [shortDay(r.date), ...sum([r])]) };
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))];
  return {
    label: "Month",
    rows: months.map((m) => [new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }), ...sum(rows.filter((r) => r.date.startsWith(m)))]),
  };
}

function periodText(r: Range) {
  return r.from === r.to ? formatBusinessDate(r.from, true) : `${formatBusinessDate(r.from)} → ${formatBusinessDate(r.to)}`;
}

// ───────────────────────── the builder ─────────────────────────

/** Build one report for a period (hotel days, 04:00 → 04:00). */
export async function buildReport(key: ReportKey, range: Range, today: BusinessDate): Promise<Report> {
  const meta = REPORTS.find((x) => x.key === key) ?? REPORTS[0];
  const days = diffDays(range.from, range.to) + 1;
  const body = await BUILDERS[meta.key](range, { today, days, prev: previousRange(range) });
  const period = periodText(range);
  return {
    key: meta.key, title: meta.title, blurb: meta.blurb, period, from: range.from, to: range.to, days,
    figures: body.figures, blocks: body.blocks,
    share: [`${meta.title} — ${period}`, ...body.figures.map((f) => `• ${f.label}: ${f.value}${f.sub ? ` (${f.sub})` : ""}`)].join("\n"),
  };
}

type Ctx = { today: BusinessDate; days: number; prev: Range };
type Body = { figures: Figure[]; blocks: Block[] };

const BUILDERS: Record<ReportKey, (r: Range, c: Ctx) => Promise<Body>> = {
  summary, daily, restaurant, items, payments, outstandingReport, tables, rooms, staff, voids, expenses, stores,
} as unknown as Record<ReportKey, (r: Range, c: Ctx) => Promise<Body>>;
// (the key "outstanding" maps to outstandingReport — set just below)
BUILDERS.outstanding = outstandingReport;

/** Money received in a range: payments (− refunds) and on-the-spot sales — the same rule as Finance. */
async function received(r: Range) {
  const [pays, sales] = await Promise.all([
    db.payment.groupBy({ by: ["kind"], where: { businessDate: dbr(r), status: "POSTED" }, _sum: { amount: true } }),
    db.revenueTransaction.aggregate({ where: { businessDate: dbr(r), isVoided: false }, _sum: { amount: true } }),
  ]);
  const inn = pays.find((p) => p.kind === "PAYMENT")?._sum.amount ?? 0;
  const out = pays.find((p) => p.kind === "REFUND")?._sum.amount ?? 0;
  return { payments: inn, refunds: out, sales: sales._sum.amount ?? 0, total: inn - out + (sales._sum.amount ?? 0) };
}

/** Unpaid restaurant orders (not on a room bill) — any date. */
async function unpaidOrders() {
  const rows = await db.restaurantOrder.findMany({
    where: { status: { not: "CANCELLED" }, settlement: { not: "ROOM" } },
    select: { total: true, paidAmount: true },
  });
  const open = rows.filter((o) => o.paidAmount < o.total);
  return { count: open.length, amount: open.reduce((t, o) => t + o.total - o.paidAmount, 0) };
}

// 1 · The whole business
async function summary(r: Range, c: Ctx): Promise<Body> {
  const [pl, plPrev, occ, owed, unpaid, perDay, money, moneyPrev, top, bestItem, byMethod] = await Promise.all([
    profitLoss(r), profitLoss(c.prev), occupancy(r), outstanding(), unpaidOrders(), dailyByKind(r), received(r), received(c.prev), topCustomers(r, 1),
    db.restaurantOrderItem.groupBy({ by: ["name"], where: { order: { businessDate: dbr(r), status: { not: "CANCELLED" } } }, _sum: { quantity: true, lineTotal: true }, orderBy: { _sum: { lineTotal: "desc" } }, take: 1 }),
    methodTotals(r),
  ]);
  const rev = pl.revenue, prev = plPrev.revenue;
  const dept: Record<DeptKey, [number, number]> = {
    rooms: [rev.rooms.net, prev.rooms.net], restaurant: [rev.restaurant, prev.restaurant], bar: [rev.bar, prev.bar], roomService: [rev.roomService, prev.roomService],
    meeting: [rev.meeting, prev.meeting], transport: [rev.transport, prev.transport], other: [rev.other, prev.other],
  };
  const earned = DEPT_KEYS.reduce((t, k) => t + dept[k][0], 0);
  const bestDay = [...perDay].sort((a, b) => b.total - a.total)[0];
  const bestType = [...rev.byType].sort((a, b) => b.net - a.net)[0];
  const owedNow = owed.total + unpaid.amount;

  const blocks: Block[] = [
    {
      kind: "bars", title: "Income by department", subtitle: `Earned ${c.days === 1 ? "on the day" : "in the period"} · share of the total and against the period before`, money: true,
      items: DEPT_KEYS.map((k) => {
        const [now, before] = dept[k];
        const d = change(now, before);
        return { label: DEPT[k].label, value: now, color: DEPT[k].color, sub: `${pct(now, earned)}%${d != null ? ` · ${d >= 0 ? "+" : ""}${Math.round(d)}% vs before` : ""}` };
      }),
    },
    {
      kind: "statement", title: "Income statement", subtitle: "Earned value, not cash", half: true,
      rows: [
        { label: "Rooms (before discounts)", value: rev.rooms.gross },
        { label: "Food (restaurant)", value: rev.restaurant }, { label: "Drinks (bar)", value: rev.bar },
        { label: "Room service fees", value: rev.roomService }, { label: "Meeting room", value: rev.meeting },
        { label: "Transport", value: rev.transport }, { label: "Other & extras", value: rev.other },
        { label: "Gross income", value: pl.grossRevenue, style: "sub" },
        { label: "Less room discounts", value: -pl.discounts, style: "less" },
        { label: "Less refunds", value: -pl.refunds, style: "less" },
        { label: "Net income", value: pl.netRevenue, style: "total" },
        { label: "Less expenses", value: -pl.expenses, style: "less" },
        { label: pl.estimatedProfit >= 0 ? "Profit (estimate)" : "Loss (estimate)", value: pl.estimatedProfit, style: "grand" },
      ],
    },
    { kind: "bars", title: "Money received, by method", subtitle: "Payments and on-the-spot sales, less refunds", money: true, half: true, items: byMethod, empty: "No money received in this period." },
  ];
  if (c.days > 1) {
    blocks.push({
      kind: "columns", title: c.days > 62 ? "Month by month" : "Day by day", subtitle: "Rooms · restaurant & bar · everything else", money: true,
      points: groupPoints(perDay, (xs) => [
        { name: "Rooms", value: sum(xs, (x) => x.rooms), color: DEPT.rooms.color },
        { name: "Restaurant & bar", value: sum(xs, (x) => x.restaurant + x.bar + x.roomService), color: DEPT.restaurant.color },
        { name: "Other", value: sum(xs, (x) => x.meeting + x.transport + x.other), color: DEPT.other.color },
      ]),
    });
  }
  blocks.push({
    kind: "highlights", title: "Highlights",
    items: [
      ...(c.days > 1 && bestDay && bestDay.total > 0 ? [{ label: "Best day", value: shortDay(bestDay.date), sub: tzs(bestDay.total) }] : []),
      { label: "Best-selling item", value: bestItem[0]?.name ?? "—", sub: bestItem[0] ? `${num(bestItem[0]._sum.quantity ?? 0)} sold · ${tzs(bestItem[0]._sum.lineTotal ?? 0)}` : "Nothing sold" },
      { label: "Best room type", value: bestType && bestType.net > 0 ? bestType.name : "—", sub: bestType && bestType.net > 0 ? `${plural(bestType.roomsSold, "room")} sold · ${tzs(bestType.net)}` : "No rooms sold" },
      { label: "Top customer", value: top[0]?.name ?? "—", sub: top[0] ? tzs(top[0].total) : "No sales yet" },
      { label: "Occupancy", value: `${occ.occupancy.toFixed(1)}%`, sub: `${plural(occ.roomNights, "room night")} of ${num(occ.sellableNights)}` },
      { label: "Kept as profit", value: pl.netRevenue > 0 ? `${pct(Math.max(0, pl.estimatedProfit), pl.netRevenue)}%` : "—", sub: "of net income" },
    ],
  });
  if (c.days > 1) {
    const t = byDayOrMonth(perDay, (xs) => [sum(xs, (x) => x.rooms), sum(xs, (x) => x.restaurant), sum(xs, (x) => x.bar), sum(xs, (x) => x.roomService + x.meeting + x.transport + x.other), sum(xs, (x) => x.total)]);
    blocks.push({
      kind: "table", title: t.label === "Day" ? "Income day by day" : "Income month by month",
      columns: [{ label: t.label }, { label: "Rooms", align: "right", money: true }, { label: "Food", align: "right", money: true }, { label: "Drinks", align: "right", money: true }, { label: "Other", align: "right", money: true }, { label: "Total", align: "right", money: true }],
      rows: t.rows,
      foot: ["Total", sum(perDay, (x) => x.rooms), sum(perDay, (x) => x.restaurant), sum(perDay, (x) => x.bar), sum(perDay, (x) => x.roomService + x.meeting + x.transport + x.other), sum(perDay, (x) => x.total)],
    });
  }
  blocks.push({ kind: "note", text: "Income is counted on the hotel day it is earned (room nights night by night; restaurant, bar and extras when sold or put on a room bill). Money received is cash in: payments and on-the-spot sales, less refunds. Owed is as of now, for all dates." });

  return {
    figures: [
      { label: "Earned (net income)", value: tzs(pl.netRevenue), raw: pl.netRevenue, delta: change(pl.netRevenue, plPrev.netRevenue), tone: "gold" },
      { label: "Money received", value: tzs(money.total), raw: money.total, delta: change(money.total, moneyPrev.total), tone: "emerald" },
      { label: "Expenses", value: tzs(pl.expenses), raw: pl.expenses, delta: change(pl.expenses, plPrev.expenses), invert: true, tone: "rose" },
      { label: pl.estimatedProfit >= 0 ? "Profit (estimate)" : "Loss (estimate)", value: tzs(Math.abs(pl.estimatedProfit)), raw: pl.estimatedProfit, tone: pl.estimatedProfit >= 0 ? "emerald" : "rose" },
      { label: "Owed to the hotel now", value: tzs(owedNow), raw: owedNow, sub: `${plural(owed.reservations.count, "guest")} · ${plural(owed.invoices.count, "invoice")} · ${plural(unpaid.count, "order")}`, tone: owedNow ? "amber" : undefined },
      { label: "Room occupancy", value: `${occ.occupancy.toFixed(1)}%`, raw: Math.round(occ.occupancy * 10) / 10, sub: `${plural(occ.roomsSold, "room")} sold`, tone: "violet" },
    ],
    blocks,
  };
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);

/** Column points for a chart: day by day, or month by month for long periods. */
function groupPoints<T extends { date: BusinessDate }>(rows: T[], parts: (xs: T[]) => { name: string; value: number; color: string }[]) {
  if (rows.length <= 62) return rows.map((r) => ({ label: rows.length > 14 ? dayMonth(r.date).split(" ")[0] : dayMonth(r.date), parts: parts([r]) }));
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))];
  return months.map((m) => ({ label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), parts: parts(rows.filter((r) => r.date.startsWith(m))) }));
}

/** Money in by payment method (payments + sales − refunds). */
async function methodTotals(r: Range) {
  const [pays, sales, methods] = await Promise.all([
    db.payment.groupBy({ by: ["methodId", "kind"], where: { businessDate: dbr(r), status: "POSTED" }, _sum: { amount: true } }),
    db.revenueTransaction.groupBy({ by: ["paymentMethodId"], where: { businessDate: dbr(r), isVoided: false }, _sum: { amount: true } }),
    db.paymentMethod.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(methods.map((m) => [m.id, m.name]));
  const total = new Map<string, number>();
  for (const p of pays) total.set(p.methodId, (total.get(p.methodId) ?? 0) + (p.kind === "REFUND" ? -1 : 1) * (p._sum.amount ?? 0));
  for (const s of sales) total.set(s.paymentMethodId, (total.get(s.paymentMethodId) ?? 0) + (s._sum.amount ?? 0));
  const palette = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#f43f5e", "#64748b", "#c9a24a"];
  const all = [...total.values()].reduce((a, b) => a + b, 0);
  return [...total.entries()].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]).map(([id, v], i) => ({ label: name.get(id) ?? "Other", value: v, color: palette[i % palette.length], sub: `${pct(v, all)}%` }));
}

// 2 · Daily sales
async function daily(r: Range, c: Ctx): Promise<Body> {
  const [perDay, cash, prevDays, orders] = await Promise.all([
    dailyByKind(r), dailyMoney(r), dailyByKind(c.prev),
    db.restaurantOrder.findMany({ where: { businessDate: dbr(r), status: { not: "CANCELLED" } }, select: { createdAt: true, foodSubtotal: true, drinksSubtotal: true, serviceFee: true, total: true } }),
  ]);
  const total = sum(perDay, (d) => d.total), before = sum(prevDays, (d) => d.total);
  const food = sum(perDay, (d) => d.restaurant + d.bar + d.roomService);
  const best = [...perDay].sort((a, b) => b.total - a.total)[0];
  const got = sum(cash, (d) => d.received);
  const blocks: Block[] = [];

  if (c.days === 1) {
    // One day: hour by hour (restaurant & bar orders), and the day's departments.
    const hours = orders.map((o) => hourOf(o.createdAt));
    const lo = Math.min(7, ...hours), hi = Math.max(22, ...hours);
    blocks.push({
      kind: "columns", title: "Restaurant & bar, hour by hour", subtitle: "Orders placed each hour (cancelled left out)", money: true, empty: "No restaurant or bar orders on this day.",
      points: orders.length ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((h) => {
        const xs = orders.filter((o) => hourOf(o.createdAt) === h);
        return { label: `${String(h).padStart(2, "0")}`, parts: [
          { name: "Food", value: sum(xs, (o) => o.foodSubtotal), color: DEPT.restaurant.color },
          { name: "Drinks", value: sum(xs, (o) => o.drinksSubtotal), color: DEPT.bar.color },
          { name: "Room service fees", value: sum(xs, (o) => o.serviceFee), color: DEPT.roomService.color },
        ] };
      }) : [],
    });
    blocks.push({
      kind: "bars", title: "The day by department", money: true,
      items: DEPT_KEYS.map((k) => ({ label: DEPT[k].label, value: perDay[0]?.[k] ?? 0, color: DEPT[k].color, sub: `${pct(perDay[0]?.[k] ?? 0, total)}%` })),
    });
  } else {
    blocks.push({
      kind: "columns", title: c.days > 62 ? "Sales month by month" : "Sales day by day", subtitle: "Stacked by department", money: true,
      points: groupPoints(perDay, (xs) => DEPT_KEYS.map((k) => ({ name: DEPT[k].label, value: sum(xs, (x) => x[k]), color: DEPT[k].color }))),
    });
  }
  const rows = perDay.map((d) => ({ ...d, received: cash.find((x) => x.date === d.date)?.received ?? 0 }));
  const t = byDayOrMonth(rows, (xs) => [sum(xs, (x) => x.rooms), sum(xs, (x) => x.restaurant), sum(xs, (x) => x.bar), sum(xs, (x) => x.roomService), sum(xs, (x) => x.meeting + x.transport + x.other), sum(xs, (x) => x.total), sum(xs, (x) => x.received)]);
  blocks.push({
    kind: "table", title: "Sales by day and department", subtitle: "Earned on each hotel day · received = money in that day",
    columns: [{ label: t.label }, { label: "Rooms", align: "right", money: true }, { label: "Food", align: "right", money: true }, { label: "Drinks", align: "right", money: true }, { label: "Room svc", align: "right", money: true }, { label: "Other", align: "right", money: true }, { label: "Total", align: "right", money: true }, { label: "Received", align: "right", money: true, muted: true }],
    rows: t.rows,
    foot: ["Total", sum(rows, (x) => x.rooms), sum(rows, (x) => x.restaurant), sum(rows, (x) => x.bar), sum(rows, (x) => x.roomService), sum(rows, (x) => x.meeting + x.transport + x.other), total, got],
  });
  return {
    figures: [
      { label: "Total sales", value: tzs(total), raw: total, delta: change(total, before), tone: "gold" },
      c.days > 1 ? { label: "Average per day", value: tzs(Math.round(total / c.days)), raw: Math.round(total / c.days), sub: `${c.days} days` } : { label: "Restaurant & bar orders", value: num(orders.length), raw: orders.length, sub: orders.length ? `average ${tzs(Math.round(sum(orders, (o) => o.total) / orders.length))}` : "none yet" },
      c.days > 1 ? { label: "Best day", value: best && best.total ? shortDay(best.date) : "—", sub: best && best.total ? tzs(best.total) : undefined } : { label: "Vs the day before", value: before ? tzs(before) : "—", sub: "total sales" },
      { label: "Rooms", value: tzs(sum(perDay, (d) => d.rooms)), raw: sum(perDay, (d) => d.rooms), tone: "violet" },
      { label: "Restaurant & bar", value: tzs(food), raw: food, sub: "food, drinks & room service", tone: "amber" },
      { label: "Money received", value: tzs(got), raw: got, tone: "emerald" },
    ],
    blocks,
  };
}

// 3 · Restaurant & bar (food, beverage and room-service revenue)
async function restaurant(r: Range, c: Ctx): Promise<Body> {
  const [orders, prevAgg, pl] = await Promise.all([
    db.restaurantOrder.findMany({
      where: { businessDate: dbr(r), status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" },
      select: {
        number: true, type: true, source: true, status: true, settlement: true, businessDate: true, createdAt: true, acceptedAt: true, readyAt: true, deliveredAt: true,
        foodSubtotal: true, drinksSubtotal: true, serviceFee: true, total: true, paidAmount: true, roomNumber: true, customerName: true, tableLabel: true,
        location: { select: { name: true } }, guest: { select: { fullName: true } }, items: { select: { quantity: true } },
      },
    }),
    db.restaurantOrder.aggregate({ where: { businessDate: dbr(c.prev), status: { not: "CANCELLED" } }, _sum: { foodSubtotal: true, drinksSubtotal: true, total: true }, _count: true }),
    profitLoss(r),
  ]);
  // Cancelled orders and discounts given (a manager's decisions), and what is still to pay.
  const [cancelled, discounted] = await Promise.all([
    db.restaurantOrder.aggregate({ where: { businessDate: dbr(r), status: "CANCELLED" }, _count: true, _sum: { total: true } }),
    db.restaurantOrder.aggregate({ where: { businessDate: dbr(r), status: { not: "CANCELLED" }, discountAmount: { gt: 0 } }, _count: true, _sum: { discountAmount: true } }),
  ]);
  const toPay = orders.filter((o) => o.settlement !== "ROOM").reduce((t, o) => t + Math.max(0, o.total - o.paidAmount), 0);
  const running = orders.filter((o) => !["COMPLETED", "COLLECTED"].includes(o.status)).length;
  const food = sum(orders, (o) => o.foodSubtotal), drinks = sum(orders, (o) => o.drinksSubtotal), fees = sum(orders, (o) => o.serviceFee);
  const totalSales = sum(orders, (o) => o.total);
  const rs = orders.filter((o) => o.type === "ROOM_SERVICE");
  const itemsSold = sum(orders, (o) => sum(o.items, (i) => i.quantity));
  const mins = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60000) : null);
  const prep = mins(orders.filter((o) => o.acceptedAt && o.readyAt).map((o) => o.readyAt!.getTime() - o.acceptedAt!.getTime()));
  const delivery = mins(orders.filter((o) => o.readyAt && o.deliveredAt).map((o) => o.deliveredAt!.getTime() - o.readyAt!.getTime()));
  const group = (f: (o: (typeof orders)[number]) => string, label: (k: string) => string, colors: string[]) => {
    const keys = [...new Set(orders.map(f))];
    return keys.map((k, i) => {
      const xs = orders.filter((o) => f(o) === k);
      return { label: label(k), value: sum(xs, (o) => o.total), color: colors[i % colors.length], sub: `${plural(xs.length, "order")} · ${pct(sum(xs, (o) => o.total), totalSales)}%` };
    }).sort((a, b) => b.value - a.value);
  };
  const settle = (o: (typeof orders)[number]) => (o.settlement === "ROOM" ? "On room bills" : o.paidAmount >= o.total ? "Paid" : "Not paid yet");
  const hours = orders.map((o) => hourOf(o.createdAt));
  const lo = Math.min(7, ...hours), hi = Math.max(22, ...hours);
  const recorded = pl.revenue.restaurant + pl.revenue.bar + pl.revenue.roomService;

  const blocks: Block[] = [
    { kind: "bars", title: "Food and drinks", subtitle: "What was ordered, before any payment", money: true, half: true, items: [
      { label: "Food", value: food, color: DEPT.restaurant.color, sub: `${pct(food, food + drinks)}%` },
      { label: "Drinks", value: drinks, color: DEPT.bar.color, sub: `${pct(drinks, food + drinks)}%` },
      { label: "Room service fees", value: fees, color: DEPT.roomService.color, sub: plural(rs.length, "room service order") },
    ] },
    { kind: "bars", title: "By kind of order", money: true, half: true, items: group((o) => o.type, (k) => TYPE_LABEL[k] ?? k, ["#f59e0b", "#f43f5e", "#0ea5e9", "#10b981"]), empty: "No orders." },
    { kind: "bars", title: "Where the orders came from", money: true, half: true, items: group((o) => o.source, (k) => ORDER_SOURCE[k] ?? k, ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#64748b", "#c9a24a"]), empty: "No orders." },
    { kind: "bars", title: "How they are paid", money: true, half: true, items: group(settle, (k) => k, ["#10b981", "#8b5cf6", "#f43f5e"]).map((x) => ({ ...x, color: x.label === "Paid" ? "#10b981" : x.label === "On room bills" ? "#8b5cf6" : "#f43f5e" })), empty: "No orders." },
    {
      kind: "columns", title: "Busy hours", subtitle: `Sales by the hour the order was placed${c.days > 1 ? " — all days together" : ""}`, money: true, empty: "No orders in this period.",
      points: orders.length ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((h) => {
        const xs = orders.filter((o) => hourOf(o.createdAt) === h);
        return { label: String(h).padStart(2, "0"), parts: [{ name: "Food", value: sum(xs, (o) => o.foodSubtotal), color: DEPT.restaurant.color }, { name: "Drinks", value: sum(xs, (o) => o.drinksSubtotal), color: DEPT.bar.color }] };
      }) : [],
    },
  ];
  if (c.days > 1) {
    const perDay = eachDay(r).map((d) => {
      const xs = orders.filter((o) => fromDbDate(o.businessDate) === d);
      return { date: d, n: xs.length, food: sum(xs, (o) => o.foodSubtotal), drinks: sum(xs, (o) => o.drinksSubtotal), fees: sum(xs, (o) => o.serviceFee), total: sum(xs, (o) => o.total) };
    });
    const t = byDayOrMonth(perDay, (xs) => [sum(xs, (x) => x.n), sum(xs, (x) => x.food), sum(xs, (x) => x.drinks), sum(xs, (x) => x.fees), sum(xs, (x) => x.total)]);
    t.rows = t.rows.filter((row) => row[1] !== 0);
    blocks.push({
      kind: "table", title: t.label === "Day" ? "Restaurant & bar by day" : "Restaurant & bar by month", subtitle: "Days with no orders are left out", empty: "No orders in this period.",
      columns: [{ label: t.label }, { label: "Orders", align: "right" }, { label: "Food", align: "right", money: true }, { label: "Drinks", align: "right", money: true }, { label: "Room svc fees", align: "right", money: true }, { label: "Total", align: "right", money: true }],
      rows: t.rows, foot: ["Total", orders.length, food, drinks, fees, totalSales],
    });
  }
  blocks.push({
    kind: "table", title: "Room service orders", subtitle: "Food and drinks brought to the rooms", empty: "No room service in this period.",
    columns: [{ label: "Order" }, { label: "When" }, { label: "Room" }, { label: "Guest" }, { label: "Items", align: "right" }, { label: "Status" }, { label: "Fee", align: "right", money: true }, { label: "Total", align: "right", money: true }],
    rows: rs.slice(-40).reverse().map((o) => [shortNo(o.number), when(o.createdAt), o.roomNumber ? `Room ${o.roomNumber}` : "—", o.guest?.fullName ?? o.customerName ?? "—", sum(o.items, (i) => i.quantity), STATUS_WORD[o.status] ?? o.status, o.serviceFee, o.total]),
    foot: rs.length ? ["Total", "", "", "", sum(rs, (o) => sum(o.items, (i) => i.quantity)), "", sum(rs, (o) => o.serviceFee), sum(rs, (o) => o.total)] : undefined,
    more: Math.max(0, rs.length - 40),
  });
  blocks.push({ kind: "note", text: `These are orders placed (cancelled ones left out). Finance counts restaurant income when it is paid or put on a room bill: ${tzs(recorded)} recorded for this period (food ${tzs(pl.revenue.restaurant)}, drinks ${tzs(pl.revenue.bar)}, room service fees ${tzs(pl.revenue.roomService)}).` });

  const foodPrev = prevAgg._sum.foodSubtotal ?? 0, drinksPrev = prevAgg._sum.drinksSubtotal ?? 0;
  return {
    figures: [
      { label: "Food sales", value: tzs(food), raw: food, delta: change(food, foodPrev), tone: "amber" },
      { label: "Drink sales", value: tzs(drinks), raw: drinks, delta: change(drinks, drinksPrev), tone: "sky" },
      { label: "Room service", value: tzs(sum(rs, (o) => o.total)), raw: sum(rs, (o) => o.total), sub: `${plural(rs.length, "order")} · fees ${tzs(fees)}`, tone: "rose" },
      { label: "Orders", value: num(orders.length), raw: orders.length, delta: change(orders.length, prevAgg._count), sub: orders.length ? `average ${tzs(Math.round(totalSales / orders.length))}` : undefined },
      { label: "Items sold", value: num(itemsSold), raw: itemsSold, sub: orders.length ? `${(itemsSold / orders.length).toFixed(1)} per order` : undefined },
      { label: "Kitchen speed", value: prep != null ? `${prep} min` : "—", sub: delivery != null ? `preparing · ${delivery} min to serve` : "preparing (accepted → ready)", tone: "emerald" },
      { label: "Still to pay", value: tzs(toPay), raw: toPay, sub: `${plural(running, "order")} not finished`, tone: toPay ? "rose" : "slate", invert: true },
      { label: "Cancelled · discounts", value: `${num(cancelled._count)} · ${tzs(discounted._sum.discountAmount ?? 0)}`, raw: discounted._sum.discountAmount ?? 0, sub: `cancelled ${tzs(cancelled._sum.total ?? 0)} · ${plural(discounted._count, "bill")} discounted`, tone: "slate", invert: true },
    ],
    blocks,
  };
}

const eachDay = (r: Range) => Array.from({ length: diffDays(r.from, r.to) + 1 }, (_, i) => addDays(r.from, i));

// 4 · Best-selling items
async function items(r: Range, c: Ctx): Promise<Body> {
  const live = { businessDate: dbr(r), status: { not: "CANCELLED" as const } };
  const [rows, prevRows, menu] = await Promise.all([
    db.restaurantOrderItem.groupBy({ by: ["name", "type"], where: { order: live }, _sum: { quantity: true, lineTotal: true }, _count: true, orderBy: { _sum: { lineTotal: "desc" } } }),
    db.restaurantOrderItem.groupBy({ by: ["name"], where: { order: { businessDate: dbr(c.prev), status: { not: "CANCELLED" } } }, _sum: { quantity: true } }),
    db.menuItem.findMany({ where: { isActive: true }, select: { name: true, price: true, type: true, isAvailable: true, category: { select: { name: true } } }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }] }),
  ]);
  const total = sum(rows, (x) => x._sum.lineTotal ?? 0);
  const qty = sum(rows, (x) => x._sum.quantity ?? 0);
  const foods = rows.filter((x) => x.type !== "DRINK"), drinks = rows.filter((x) => x.type === "DRINK");
  const sold = new Set(rows.map((x) => x.name));
  const unsold = menu.filter((m) => !sold.has(m.name));
  const bestDrink = drinks[0];
  return {
    figures: [
      { label: "Items sold", value: num(qty), raw: qty, delta: change(qty, sum(prevRows, (x) => x._sum.quantity ?? 0)), tone: "gold" },
      { label: "Sales from items", value: tzs(total), raw: total },
      { label: "Different items", value: num(rows.length), raw: rows.length, sub: `of ${menu.length} on the menu` },
      { label: "Best seller", value: rows[0]?.name ?? "—", sub: rows[0] ? `${num(rows[0]._sum.quantity ?? 0)} sold · ${tzs(rows[0]._sum.lineTotal ?? 0)}` : undefined, tone: "amber" },
      { label: "Best drink", value: bestDrink?.name ?? "—", sub: bestDrink ? `${num(bestDrink._sum.quantity ?? 0)} sold` : undefined, tone: "sky" },
      { label: "Not sold", value: num(unsold.length), raw: unsold.length, sub: "menu items with no sale", tone: unsold.length ? "rose" : undefined },
    ],
    blocks: [
      { kind: "bars", title: "Top 10 by sales", money: true, half: true, empty: "Nothing sold in this period.",
        items: rows.slice(0, 10).map((x) => ({ label: x.name, value: x._sum.lineTotal ?? 0, color: x.type === "DRINK" ? DEPT.bar.color : DEPT.restaurant.color, sub: `${num(x._sum.quantity ?? 0)} sold` })) },
      { kind: "bars", title: "Food and drinks", money: true, half: true, items: [
        { label: `Food · ${plural(sum(foods, (x) => x._sum.quantity ?? 0), "item")}`, value: sum(foods, (x) => x._sum.lineTotal ?? 0), color: DEPT.restaurant.color, sub: `${pct(sum(foods, (x) => x._sum.lineTotal ?? 0), total)}%` },
        { label: `Drinks · ${plural(sum(drinks, (x) => x._sum.quantity ?? 0), "item")}`, value: sum(drinks, (x) => x._sum.lineTotal ?? 0), color: DEPT.bar.color, sub: `${pct(sum(drinks, (x) => x._sum.lineTotal ?? 0), total)}%` },
      ] },
      {
        kind: "table", title: "Every item sold", subtitle: "Best first, by money", empty: "Nothing sold in this period.",
        columns: [{ label: "#", align: "right", muted: true }, { label: "Item" }, { label: "Kind" }, { label: "Sold", align: "right" }, { label: "On orders", align: "right", muted: true }, { label: "Average price", align: "right", money: true, muted: true }, { label: "Sales", align: "right", money: true }, { label: "Share", align: "right" }, { label: "Vs before", align: "right", muted: true }],
        rows: rows.map((x, i) => {
          const q = x._sum.quantity ?? 0, before = prevRows.find((p) => p.name === x.name)?._sum.quantity ?? 0;
          const d = change(q, before);
          return [i + 1, x.name, x.type === "DRINK" ? "Drink" : "Food", q, x._count, q ? Math.round((x._sum.lineTotal ?? 0) / q) : 0, x._sum.lineTotal ?? 0, `${pct(x._sum.lineTotal ?? 0, total)}%`, d == null ? (before ? "—" : "new") : `${d >= 0 ? "+" : ""}${Math.round(d)}%`];
        }),
        foot: rows.length ? ["", "Total", "", qty, "", "", total, "100%", ""] : undefined,
      },
      {
        kind: "table", title: "Not sold in this period", subtitle: "Active menu items nobody ordered — worth a look", empty: "Every menu item sold at least once.",
        columns: [{ label: "Item" }, { label: "Category" }, { label: "Kind" }, { label: "Price", align: "right", money: true }, { label: "On the menu now" }],
        rows: unsold.slice(0, 60).map((m) => [m.name, m.category.name, m.type === "DRINK" ? "Drink" : "Food", m.price, m.isAvailable ? "Yes" : "Switched off"]),
        more: Math.max(0, unsold.length - 60),
      },
    ],
  };
}

// 5 · Payment collection
async function payments(r: Range, c: Ctx): Promise<Body> {
  const [pays, sales, toConfirm, byMethod, prevIn] = await Promise.all([
    db.payment.findMany({
      where: { businessDate: dbr(r), status: "POSTED" }, orderBy: { receivedAt: "desc" },
      select: {
        kind: true, amount: true, receivedAt: true, reference: true, method: { select: { name: true } }, account: { select: { name: true } }, recordedBy: { select: { id: true, fullName: true } },
        reservation: { select: { reference: true, guest: { select: { fullName: true } } } }, invoice: { select: { number: true } }, corporateCustomer: { select: { companyName: true } },
      },
    }),
    db.revenueTransaction.findMany({
      where: { businessDate: dbr(r), isVoided: false }, orderBy: { occurredAt: "desc" },
      select: { amount: true, occurredAt: true, kind: true, description: true, paymentMethod: { select: { name: true } }, account: { select: { name: true } }, recordedBy: { select: { id: true, fullName: true } }, category: { select: { name: true } }, restaurantOrder: { select: { number: true, customerName: true } } },
    }),
    db.restaurantOrderPayment.aggregate({ where: { status: "POSTED", confirmedAt: null }, _sum: { amount: true }, _count: true }),
    methodTotals(r),
    received(c.prev),
  ]);
  const rows = [
    ...pays.map((p) => ({
      at: p.receivedAt, what: p.kind === "REFUND" ? "Refund" : p.invoice ? `Invoice ${p.invoice.number}` : p.reservation ? `Booking ${p.reservation.reference}` : "Payment",
      who: p.corporateCustomer?.companyName ?? p.reservation?.guest.fullName ?? "—", method: p.method.name, account: p.account.name, by: p.recordedBy, amount: p.kind === "REFUND" ? -p.amount : p.amount,
    })),
    ...sales.map((s) => ({
      at: s.occurredAt, what: s.restaurantOrder ? `Order ${shortNo(s.restaurantOrder.number)}` : s.category.name, who: s.restaurantOrder?.customerName ?? s.description ?? "—",
      method: s.paymentMethod.name, account: s.account.name, by: s.recordedBy, amount: s.amount,
    })),
  ].sort((a, b) => +b.at - +a.at);
  const inn = sum(pays.filter((p) => p.kind === "PAYMENT"), (p) => p.amount), refunds = sum(pays.filter((p) => p.kind === "REFUND"), (p) => p.amount);
  const salesIn = sum(sales, (s) => s.amount);
  const total = inn - refunds + salesIn;
  const byAccount = new Map<string, number>();
  for (const x of rows) byAccount.set(x.account, (byAccount.get(x.account) ?? 0) + x.amount);
  const byStaff = new Map<string, { name: string; n: number; amount: number }>();
  for (const x of rows) { const s = byStaff.get(x.by.id) ?? { name: x.by.fullName, n: 0, amount: 0 }; s.n += 1; s.amount += x.amount; byStaff.set(x.by.id, s); }
  const palette = ["#10b981", "#0ea5e9", "#8b5cf6", "#f59e0b", "#f43f5e", "#64748b"];

  return {
    figures: [
      { label: "Money received", value: tzs(total), raw: total, delta: change(total, prevIn.total), tone: "emerald" },
      { label: "From guests & companies", value: tzs(inn), raw: inn, sub: plural(pays.filter((p) => p.kind === "PAYMENT").length, "payment") },
      { label: "From sales on the spot", value: tzs(salesIn), raw: salesIn, sub: `${plural(sales.length, "sale")} · restaurant, bar & extras` },
      { label: "Refunds", value: tzs(refunds), raw: refunds, invert: true, tone: refunds ? "rose" : undefined, sub: plural(pays.filter((p) => p.kind === "REFUND").length, "refund") },
      { label: "Transactions", value: num(rows.length), raw: rows.length, sub: rows.length ? `average ${tzs(Math.round(total / rows.length))}` : undefined },
      { label: "Waiting for reception", value: tzs(toConfirm._sum.amount ?? 0), raw: toConfirm._sum.amount ?? 0, sub: `${plural(toConfirm._count, "waiter payment")} to confirm (any date)`, tone: toConfirm._count ? "amber" : undefined },
    ],
    blocks: [
      { kind: "bars", title: "By payment method", money: true, half: true, items: byMethod, empty: "No money received." },
      { kind: "bars", title: "By account (where the money is)", money: true, half: true, empty: "No money received.",
        items: [...byAccount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: k, value: v, color: palette[i % palette.length], sub: `${pct(v, total)}%` })) },
      { kind: "table", title: "Collected by", subtitle: "Who recorded the money", empty: "Nobody recorded money in this period.",
        columns: [{ label: "Staff" }, { label: "Transactions", align: "right" }, { label: "Amount", align: "right", money: true }, { label: "Share", align: "right" }],
        rows: [...byStaff.values()].sort((a, b) => b.amount - a.amount).map((s) => [noBrackets(s.name), s.n, s.amount, `${pct(s.amount, total)}%`]),
        foot: rows.length ? ["Total", rows.length, total, "100%"] : undefined, half: true },
      { kind: "table", title: "Every transaction", subtitle: "Newest first", empty: "No transactions in this period.",
        columns: [{ label: "When" }, { label: "For" }, { label: "Customer" }, { label: "Method" }, { label: "Account", muted: true }, { label: "By", muted: true }, { label: "Amount", align: "right", money: true }],
        rows: rows.slice(0, 80).map((x) => [when(x.at), x.what, x.who, x.method, x.account, noBrackets(x.by.fullName), x.amount]),
        foot: rows.length ? ["Total", "", "", "", "", "", total] : undefined, more: Math.max(0, rows.length - 80) },
    ],
  };
}

// 6 · Outstanding (as of now)
async function outstandingReport(_r: Range, c: Ctx): Promise<Body> {
  const [orders, guests, invoices, owed] = await Promise.all([
    db.restaurantOrder.findMany({
      where: { status: { not: "CANCELLED" }, settlement: { not: "ROOM" } }, orderBy: { createdAt: "asc" },
      select: { number: true, total: true, paidAmount: true, businessDate: true, createdAt: true, customerName: true, customerPhone: true, type: true, tableLabel: true, roomNumber: true, status: true, location: { select: { name: true } }, guest: { select: { fullName: true } } },
    }),
    db.reservation.findMany({
      where: { balanceAmount: { gt: 0 }, status: { in: ["CHECKED_IN", "CHECKED_OUT"] } }, orderBy: { balanceAmount: "desc" },
      select: { reference: true, kind: true, status: true, balanceAmount: true, netAmount: true, departureDate: true, guest: { select: { fullName: true, phone: true } }, rooms: { select: { room: { select: { number: true } } } } },
    }),
    db.invoice.findMany({
      where: { reservationId: null, balanceAmount: { gt: 0 }, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, orderBy: { dueDate: "asc" },
      select: { number: true, issueDate: true, dueDate: true, netAmount: true, balanceAmount: true, corporateCustomer: { select: { companyName: true } } },
    }),
    outstanding(),
  ]);
  const open = orders.filter((o) => o.paidAmount < o.total);
  const age = (d: Date) => Math.max(0, diffDays(fromDbDate(d), c.today));
  const unpaid = sum(open, (o) => o.total - o.paidAmount);
  const staying = guests.filter((g) => g.status === "CHECKED_IN"), left = guests.filter((g) => g.status === "CHECKED_OUT");
  const total = owed.total + unpaid;
  const oldest = Math.max(0, ...open.map((o) => age(o.businessDate)), ...left.map((g) => age(g.departureDate)), ...invoices.filter((i) => i.dueDate).map((i) => age(i.dueDate!)));
  const overdue = invoices.filter((i) => i.dueDate && fromDbDate(i.dueDate) < c.today);
  return {
    figures: [
      { label: "Owed to the hotel", value: tzs(total), raw: total, tone: total ? "rose" : "emerald", sub: "as of now, all dates" },
      { label: "Guests staying", value: tzs(sum(staying, (g) => g.balanceAmount)), raw: sum(staying, (g) => g.balanceAmount), sub: plural(staying.length, "booking") },
      { label: "Guests who left owing", value: tzs(sum(left, (g) => g.balanceAmount)), raw: sum(left, (g) => g.balanceAmount), sub: plural(left.length, "booking"), tone: left.length ? "amber" : undefined },
      { label: "Companies (invoices)", value: tzs(owed.invoices.amount), raw: owed.invoices.amount, sub: `${plural(invoices.length, "invoice")}${overdue.length ? ` · ${overdue.length} overdue` : ""}` },
      { label: "Restaurant orders unpaid", value: tzs(unpaid), raw: unpaid, sub: plural(open.length, "order"), tone: open.length ? "amber" : undefined },
      { label: "Oldest debt", value: oldest ? plural(oldest, "day") : "—", raw: oldest, sub: "since the order / checkout / due date" },
    ],
    blocks: [
      { kind: "bars", title: "Where the money is owed", money: true, items: [
        { label: "Guests staying", value: sum(staying, (g) => g.balanceAmount), color: "#8b5cf6" },
        { label: "Guests who left", value: sum(left, (g) => g.balanceAmount), color: "#f43f5e" },
        { label: "Companies", value: owed.invoices.amount, color: "#0ea5e9" },
        { label: "Restaurant orders", value: unpaid, color: "#f59e0b" },
      ] },
      { kind: "table", title: "Unpaid restaurant orders", subtitle: "Not on a room bill — to collect from the customer", empty: "Every restaurant order is paid.",
        columns: [{ label: "Order" }, { label: "Date" }, { label: "Where" }, { label: "Customer" }, { label: "Status" }, { label: "Total", align: "right", money: true }, { label: "Paid", align: "right", money: true, muted: true }, { label: "To pay", align: "right", money: true }, { label: "Age", align: "right", muted: true }],
        rows: open.slice(0, 60).map((o) => [shortNo(o.number), shortDay(fromDbDate(o.businessDate)), orderPlace(o), o.guest?.fullName ?? o.customerName ?? "—", STATUS_WORD[o.status] ?? o.status, o.total, o.paidAmount, o.total - o.paidAmount, age(o.businessDate) ? plural(age(o.businessDate), "day") : "today"]),
        foot: open.length ? ["Total", "", "", "", "", sum(open, (o) => o.total), sum(open, (o) => o.paidAmount), unpaid, ""] : undefined, more: Math.max(0, open.length - 60) },
      { kind: "table", title: "Guests owing", subtitle: "Staying now, or left without paying in full", empty: "No guest owes the hotel.",
        columns: [{ label: "Booking" }, { label: "Guest" }, { label: "Room" }, { label: "Status" }, { label: "Bill", align: "right", money: true, muted: true }, { label: "Owes", align: "right", money: true }],
        rows: guests.slice(0, 60).map((g) => [g.reference, g.guest.fullName, g.rooms.map((x) => x.room.number).join(", ") || (g.kind === "MEETING" ? "Meeting" : "—"), g.status === "CHECKED_IN" ? "Staying" : `Left ${dayMonth(fromDbDate(g.departureDate))}`, g.netAmount, g.balanceAmount]),
        foot: guests.length ? ["Total", "", "", "", sum(guests, (g) => g.netAmount), sum(guests, (g) => g.balanceAmount)] : undefined, more: Math.max(0, guests.length - 60) },
      { kind: "table", title: "Company invoices unpaid", empty: "No company owes the hotel.",
        columns: [{ label: "Invoice" }, { label: "Company" }, { label: "Issued" }, { label: "Due" }, { label: "Total", align: "right", money: true, muted: true }, { label: "Balance", align: "right", money: true }],
        rows: invoices.map((i) => [i.number, i.corporateCustomer?.companyName ?? "—", i.issueDate ? dayMonth(fromDbDate(i.issueDate)) : "—", i.dueDate ? `${dayMonth(fromDbDate(i.dueDate))}${fromDbDate(i.dueDate) < c.today ? " · overdue" : ""}` : "—", i.netAmount, i.balanceAmount]),
        foot: invoices.length ? ["Total", "", "", "", sum(invoices, (i) => i.netAmount), sum(invoices, (i) => i.balanceAmount)] : undefined },
    ],
  };
}

// 7 · Table utilisation
async function tables(r: Range, c: Ctx): Promise<Body> {
  const [{ places, summary }, placeOrders, sessions, settings] = await Promise.all([
    tablesOnHome(c.today, r),
    db.restaurantOrder.findMany({ where: { businessDate: dbr(r), locationId: { not: null } }, select: { locationId: true, status: true, discountAmount: true, paidAmount: true } }),
    db.diningSession.findMany({ where: { businessDate: dbr(r) }, select: { startedAt: true } }),
    getSettings(),
  ]);
  // Discounts, cancelled orders and money collected, per place.
  const extra = new Map<string, { discounts: number; cancelled: number; paid: number }>();
  for (const o of placeOrders) {
    const x = extra.get(o.locationId!) ?? { discounts: 0, cancelled: 0, paid: 0 };
    if (o.status === "CANCELLED") x.cancelled += 1; else { x.discounts += o.discountAmount; x.paid += o.paidAmount; }
    extra.set(o.locationId!, x);
  }
  const ex = (id: string) => extra.get(id) ?? { discounts: 0, cancelled: 0, paid: 0 };
  const totalDiscounts = [...extra.values()].reduce((t, x) => t + x.discounts, 0);
  const totalCancelled = [...extra.values()].reduce((t, x) => t + x.cancelled, 0);
  // When customers sit down (busy hours).
  const hourOf = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: settings.timezone }).format(d));
  const hours = new Map<number, number>();
  for (const x of sessions) hours.set(hourOf(x.startedAt), (hours.get(hourOf(x.startedAt)) ?? 0) + 1);
  const rows = places.map((p) => {
    const hours = p.period.minutes != null ? (p.period.minutes * p.period.customers) / 60 : 0;
    return { p, hours, turns: p.period.customers / c.days };
  }).sort((a, b) => b.p.period.sales - a.p.period.sales);
  const busiest = [...rows].sort((a, b) => b.p.period.customers - a.p.period.customers)[0];
  const tablesOnly = rows.filter((x) => x.p.kind === "TABLE");
  const turns = tablesOnly.length ? sum(tablesOnly, (x) => x.turns) / tablesOnly.length : 0;
  return {
    figures: [
      { label: "Table sales", value: tzs(summary.sales), raw: summary.sales, sub: `${plural(summary.orders, "order")} at tables & the counter`, tone: "gold" },
      { label: "Customers seated", value: num(summary.customers), raw: summary.customers, sub: `${plural(summary.guests, "person", "people")}` },
      { label: "Average bill", value: summary.avgBill ? tzs(summary.avgBill) : "—", raw: summary.avgBill, sub: "per customer" },
      { label: "Time at the table", value: summary.minutes != null ? `${summary.minutes} min` : "—", raw: summary.minutes ?? 0, sub: "average, seated → cleared" },
      { label: "Turns per table", value: turns.toFixed(1), raw: Math.round(turns * 10) / 10, sub: "customers per table per day", tone: "violet" },
      { label: "Busiest table", value: busiest && busiest.p.period.customers ? busiest.p.name.replace(/\s—\s.*/, "") : "—", sub: busiest && busiest.p.period.customers ? `${busiest.p.name.replace(/^.*—\s/, "")} · ${plural(busiest.p.period.customers, "customer")}` : "nobody seated yet", tone: "emerald" },
      { label: "Discounts given", value: tzs(totalDiscounts), raw: totalDiscounts, sub: "on table and counter bills", tone: "rose", invert: true },
      { label: "Cancelled orders", value: num(totalCancelled), raw: totalCancelled, sub: "at tables and the counter", tone: "slate", invert: true },
    ],
    blocks: [
      { kind: "bars", title: "Sales by table", money: true, empty: "No table sales in this period.",
        items: rows.filter((x) => x.p.period.sales > 0).map((x) => ({ label: x.p.name, value: x.p.period.sales, color: x.p.area === "INSIDE" ? "#8b5cf6" : x.p.kind === "COUNTER" ? "#f59e0b" : "#0ea5e9", sub: `${plural(x.p.period.customers, "customer")}` })) },
      { kind: "bars", title: "Busy hours", subtitle: "When customers sit down", half: true, empty: "Nobody seated in this period.",
        items: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([h, n]) => ({ label: `${String(h).padStart(2, "0")}:00`, value: n, color: "#0ea5e9" })) },
      { kind: "table", title: "Every table", subtitle: `Unused in the period: ${summary.unused}`,
        columns: [{ label: "Table" }, { label: "Customers", align: "right" }, { label: "People", align: "right" }, { label: "Orders", align: "right", muted: true }, { label: "Sales", align: "right", money: true }, { label: "Collected", align: "right", money: true }, { label: "Discounts", align: "right", money: true }, { label: "Cancelled", align: "right", muted: true }, { label: "Average bill", align: "right", money: true }, { label: "Average time", align: "right" }, { label: "Hours used", align: "right", muted: true }, { label: "Turns / day", align: "right" }, { label: "Share", align: "right", muted: true }],
        rows: rows.map((x) => [x.p.name, x.p.period.customers, x.p.period.guests, x.p.period.orders, x.p.period.sales, ex(x.p.id).paid, ex(x.p.id).discounts, ex(x.p.id).cancelled, x.p.period.customers ? Math.round(x.p.period.sales / x.p.period.customers) : 0, x.p.period.minutes != null ? `${x.p.period.minutes} min` : "—", x.hours ? x.hours.toFixed(1) : "—", x.turns ? x.turns.toFixed(1) : "—", `${pct(x.p.period.sales, summary.sales)}%`]),
        foot: ["Total", summary.customers, summary.guests, summary.orders, summary.sales, [...extra.values()].reduce((t, x) => t + x.paid, 0), totalDiscounts, totalCancelled, summary.avgBill, summary.minutes != null ? `${summary.minutes} min` : "—", sum(rows, (x) => x.hours).toFixed(1), turns.toFixed(1), "100%"] },
      { kind: "note", text: "A customer = one party seated at a table (from scanning the QR or being seated by a waiter) until the table is cleared. Turns per day = customers ÷ days in the period. The counter serves orders without seating, so it shows orders only." },
    ],
  };
}

// 8 · Rooms & bookings
async function rooms(r: Range, c: Ctx): Promise<Body> {
  const [pl, occ, occPrev, moves, meeting, patterns, books, bookings, sources] = await Promise.all([
    profitLoss(r), occupancy(r), occupancy(c.prev), guestMovement(r), meetingRoomStats(r), stayPatterns(r), onTheBooks(c.today, 14),
    db.reservation.groupBy({ by: ["sourceId", "status"], where: { businessDate: dbr(r) }, _count: true }),
    db.bookingSource.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const rev = pl.revenue;
  const adr = occ.roomsSold ? Math.round(rev.rooms.net / occ.roomsSold) : 0;
  const revpar = occ.sellableNights ? Math.round(rev.rooms.net / occ.sellableNights) : 0;
  const sourceRows = sources.map((s) => {
    const xs = bookings.filter((b) => b.sourceId === s.id);
    const nr = rev.bySource.find((x) => x.sourceId === s.id);
    return [s.name, sum(xs, (b) => b._count), sum(xs.filter((b) => b.status === "CANCELLED" || b.status === "NO_SHOW"), (b) => b._count), nr?.roomNights ?? 0, nr?.net ?? 0] as Cell[];
  }).filter((x) => (x[1] as number) || (x[3] as number));
  const blocks: Block[] = [];
  if (c.days > 1) {
    blocks.push({
      kind: "columns", title: "Occupancy by day", subtitle: "Rooms sold each night (guest rooms)", empty: "No nights.",
      points: groupPoints(occ.series, (xs) => [{ name: "Nights sold", value: sum(xs, (x) => x.roomNights), color: DEPT.rooms.color }, { name: "Short time", value: sum(xs, (x) => x.dayUse), color: "#c4b5fd" }]),
    });
  }
  blocks.push(
    { kind: "table", title: "Room types", columns: [{ label: "Room type" }, { label: "Rooms sold", align: "right" }, { label: "Nights", align: "right" }, { label: "Gross", align: "right", money: true, muted: true }, { label: "Discounts", align: "right", money: true, muted: true }, { label: "Net", align: "right", money: true }, { label: "Average rate", align: "right", money: true }],
      rows: rev.byType.map((t) => [t.name, t.roomsSold, t.roomNights, t.gross, t.discount, t.net, t.averageRate || null]),
      foot: ["Total", occ.roomsSold, occ.roomNights, rev.rooms.gross, rev.rooms.discount, rev.rooms.net, adr || null] },
    { kind: "table", title: "Where bookings come from", subtitle: "Bookings made in the period · room nights earned", half: true, empty: "No bookings in this period.",
      columns: [{ label: "Source" }, { label: "Bookings", align: "right" }, { label: "Cancelled / no-show", align: "right", muted: true }, { label: "Nights", align: "right" }, { label: "Room income", align: "right", money: true }],
      rows: sourceRows },
    { kind: "highlights", title: "Guests and bookings", items: [
      { label: "Check-ins", value: num(moves.checkIns) }, { label: "Check-outs", value: num(moves.checkOuts) },
      { label: "New bookings", value: num(moves.newBookings) }, { label: "Cancellations", value: num(moves.cancellations), sub: `${num(moves.noShows)} no-show${moves.noShows === 1 ? "" : "s"}` },
      { label: "In house now", value: num(moves.inHouse), sub: "guest bookings" },
      { label: "Average stay", value: patterns.stays ? `${patterns.averageNights.toFixed(1)} nights` : "—", sub: patterns.stays ? `booked ${patterns.averageLeadDays.toFixed(0)} days ahead · ${patterns.averageGuests.toFixed(1)} guests` : undefined },
    ] },
    { kind: "columns", title: "On the books — the next 14 nights", subtitle: `Rooms already booked, of ${books.activeRooms} · next 30 nights: ${plural(books.next30.nights, "night")}, ${tzs(books.next30.amount)}`,
      points: books.series.map((d) => ({ label: dayMonth(d.date).split(" ")[0], parts: [{ name: "Rooms booked", value: d.rooms, color: DEPT.rooms.color }] })) },
  );
  if (meeting.rooms > 0) {
    blocks.push({ kind: "highlights", title: "Meeting room", items: [
      { label: "Used", value: `${meeting.utilisation.toFixed(0)}%`, sub: `${meeting.bookedHours} of ${meeting.openHours} open hours` },
      { label: "Bookings", value: num(meeting.bookings), sub: `${meeting.completed} completed` },
      { label: "Cancelled", value: num(meeting.cancelled), sub: `${meeting.noShows} no-shows` },
      { label: "Income", value: tzs(meeting.revenue) },
    ] });
  }
  return {
    figures: [
      { label: "Occupancy", value: `${occ.occupancy.toFixed(1)}%`, raw: Math.round(occ.occupancy * 10) / 10, delta: occPrev.sellableNights ? occ.occupancy - occPrev.occupancy : null, sub: `${plural(occ.roomNights, "night")} of ${num(occ.sellableNights)}`, tone: "violet" },
      { label: "Room income (net)", value: tzs(rev.rooms.net), raw: rev.rooms.net, sub: rev.rooms.discount ? `after ${tzs(rev.rooms.discount)} discounts` : "no discounts", tone: "gold" },
      { label: "Rooms sold", value: num(occ.roomsSold), raw: occ.roomsSold, sub: `${num(occ.roomNights)} nights · ${num(occ.dayUse)} short time` },
      { label: "Average room rate", value: adr ? tzs(adr) : "—", raw: adr, sub: "income ÷ rooms sold" },
      { label: "Income per room", value: revpar ? tzs(revpar) : "—", raw: revpar, sub: "income ÷ rooms available" },
      { label: "Check-ins · outs", value: `${num(moves.checkIns)} · ${num(moves.checkOuts)}`, sub: `${plural(moves.newBookings, "new booking")}` },
    ],
    blocks,
  };
}

// 9 · Staff activity
async function staff(r: Range, c: Ctx): Promise<Body> {
  const [{ people }, shifts] = await Promise.all([
    staffPerformance(r),
    db.actualShift.groupBy({ by: ["userId"], where: { businessDate: dbr(r) }, _count: true }),
  ]);
  const active = people.filter((p) => p.actions > 0 || p.money);
  const actions = sum(active, (p) => p.actions);
  const money = sum(active, (p) => p.money);
  const top = active[0];
  const colors: Record<string, string> = { Management: "#c9a24a", "Front office": "#8b5cf6", Restaurant: "#f59e0b", Transport: "#64748b" };
  return {
    figures: [
      { label: "Staff active", value: num(active.length), raw: active.length, sub: `of ${people.length} on the team` },
      { label: "Actions recorded", value: num(actions), raw: actions, sub: active.length ? `${Math.round(actions / active.length)} per person` : undefined, tone: "violet" },
      { label: "Money handled", value: tzs(money), raw: money, sub: "payments & sales recorded", tone: "emerald" },
      { label: "Check-ins · outs", value: `${num(sum(people, (p) => p.checkIns))} · ${num(sum(people, (p) => p.checkOuts))}` },
      { label: "Orders placed", value: num(sum(people, (p) => p.orders)), raw: sum(people, (p) => p.orders), sub: "by staff (not customers' QR)" },
      { label: "Most active", value: top ? noBrackets(top.name) : "—", sub: top ? `${top.role} · ${plural(top.actions, "action")}` : undefined, tone: "gold" },
    ],
    blocks: [
      { kind: "bars", title: "Work by person", subtitle: "Actions recorded in the system", empty: "Nobody recorded any work in this period.",
        items: active.slice(0, 12).map((p) => ({ label: noBrackets(p.name), value: p.actions, color: colors[p.department] ?? "#64748b", sub: `${p.role}${p.usualStart ? ` · starts ~${p.usualStart}` : ""}` })) },
      { kind: "table", title: "Everyone on the team", subtitle: `Usual start = the typical time of their first action on the days they worked`,
        columns: [{ label: "Name" }, { label: "Role" }, { label: "Days", align: "right" }, { label: "Usual start", align: "right" }, { label: "Shifts", align: "right", muted: true }, { label: "Actions", align: "right" }, { label: "Check-ins", align: "right", muted: true }, { label: "Check-outs", align: "right", muted: true }, { label: "Bookings", align: "right", muted: true }, { label: "Orders", align: "right", muted: true }, { label: "Money handled", align: "right", money: true }],
        rows: people.map((p) => [noBrackets(p.name), p.role, `${p.daysActive}/${c.days}`, p.usualStart ?? "—", shifts.find((s) => s.userId === p.id)?._count ?? 0, p.actions, p.checkIns, p.checkOuts, p.bookings, p.orders, p.money]),
        foot: ["Total", "", "", "", sum(shifts, (s) => s._count), actions, sum(people, (p) => p.checkIns), sum(people, (p) => p.checkOuts), sum(people, (p) => p.bookings), sum(people, (p) => p.orders), money] },
      { kind: "note", text: "For visibility and fairness, not punishment: actions are what each person recorded in the system (bookings, payments, orders, check-ins…). Finance → Staff shows each person day by day." },
    ],
  };
}

// 10 · Cancellations & voids
async function voids(r: Range): Promise<Body> {
  const bounds = businessRangeBounds(r.from, r.to);
  const inRange = { gte: bounds.start, lt: bounds.end };
  const [orders, removed, sales, pays, orderPays, charges, bookings, spent] = await Promise.all([
    db.restaurantOrder.findMany({ where: { status: "CANCELLED", businessDate: dbr(r) }, orderBy: { createdAt: "desc" },
      select: { number: true, total: true, createdAt: true, cancelledAt: true, cancelReason: true, type: true, tableLabel: true, roomNumber: true, customerName: true, location: { select: { name: true } }, cancelledBy: { select: { fullName: true } } } }),
    db.auditLog.findMany({ where: { action: "restaurant_order.item_removed", businessDate: dbr(r) }, orderBy: { createdAt: "desc" }, select: { entityId: true, before: true, after: true, createdAt: true, user: { select: { fullName: true } }, actorLabel: true } }),
    db.revenueTransaction.findMany({ where: { isVoided: true, businessDate: dbr(r) }, orderBy: { occurredAt: "desc" }, select: { amount: true, occurredAt: true, voidReason: true, description: true, category: { select: { name: true } }, recordedBy: { select: { fullName: true } } } }),
    db.payment.findMany({ where: { status: "REVERSED", OR: [{ reversalBusinessDate: dbr(r) }, { reversalBusinessDate: null, businessDate: dbr(r) }] }, orderBy: { receivedAt: "desc" },
      select: { amount: true, kind: true, receivedAt: true, reversedAt: true, reversalReason: true, method: { select: { name: true } }, reversedBy: { select: { fullName: true } }, reservation: { select: { reference: true, guest: { select: { fullName: true } } } } } }),
    db.restaurantOrderPayment.findMany({ where: { status: "REVERSED", reversedAt: inRange }, orderBy: { reversedAt: "desc" }, select: { amount: true, reversedAt: true, reverseReason: true, order: { select: { number: true } }, reversedBy: { select: { fullName: true } }, paymentMethod: { select: { name: true } } } }),
    db.reservationCharge.findMany({ where: { isVoided: true, businessDate: dbr(r) }, select: { description: true, amount: true, voidReason: true, reservation: { select: { reference: true, guest: { select: { fullName: true } } } } } }),
    db.reservation.findMany({ where: { OR: [{ status: "CANCELLED", cancelledAt: inRange }, { status: "NO_SHOW", noShowAt: inRange }] }, orderBy: { arrivalDate: "asc" },
      select: { reference: true, status: true, cancelReason: true, cancelledAt: true, noShowAt: true, arrivalDate: true, netAmount: true, guest: { select: { fullName: true } }, source: { select: { name: true } } } }),
    db.expense.findMany({ where: { status: "VOIDED", voidedAt: inRange }, select: { number: true, amount: true, description: true, voidReason: true, voidedAt: true, category: { select: { name: true } } } }),
  ]);
  const orderNo = new Map((await db.restaurantOrder.findMany({ where: { id: { in: removed.map((x) => x.entityId).filter((x): x is string => !!x) } }, select: { id: true, number: true } })).map((o) => [o.id, o.number]));
  const removedRows = removed.map((x) => {
    const a = (x.after ?? {}) as { amount?: number; removed?: number; reason?: string };
    const b = (x.before ?? {}) as { item?: string };
    return { at: x.createdAt, order: x.entityId ? shortNo(orderNo.get(x.entityId) ?? "") : "—", item: b.item?.replace(/ @ \d+$/, "") ?? "Item", n: a.removed ?? 1, amount: a.amount ?? 0, reason: a.reason ?? "—", by: x.user?.fullName ?? x.actorLabel ?? "—" };
  });
  const cancelled = bookings.filter((b) => b.status === "CANCELLED"), noShows = bookings.filter((b) => b.status === "NO_SHOW");
  const reversed = sum(pays, (p) => p.amount) + sum(orderPays, (p) => p.amount);
  const none = "None — nothing to worry about.";
  return {
    figures: [
      { label: "Cancelled orders", value: num(orders.length), raw: orders.length, sub: tzs(sum(orders, (o) => o.total)), invert: true, tone: orders.length ? "rose" : undefined },
      { label: "Items removed from orders", value: num(sum(removedRows, (x) => x.n)), raw: sum(removedRows, (x) => x.n), sub: tzs(sum(removedRows, (x) => x.amount)), tone: removedRows.length ? "amber" : undefined },
      { label: "Voided sales", value: tzs(sum(sales, (s) => s.amount)), raw: sum(sales, (s) => s.amount), sub: plural(sales.length, "sale"), tone: sales.length ? "rose" : undefined },
      { label: "Reversed payments", value: tzs(reversed), raw: reversed, sub: plural(pays.length + orderPays.length, "payment"), tone: reversed ? "rose" : undefined },
      { label: "Cancelled bookings", value: num(cancelled.length), raw: cancelled.length, sub: tzs(sum(cancelled, (b) => b.netAmount)), tone: cancelled.length ? "amber" : undefined },
      { label: "No-shows", value: num(noShows.length), raw: noShows.length, sub: tzs(sum(noShows, (b) => b.netAmount)), tone: noShows.length ? "amber" : undefined },
    ],
    blocks: [
      { kind: "table", title: "Cancelled restaurant orders", empty: none,
        columns: [{ label: "Order" }, { label: "Placed" }, { label: "Where" }, { label: "Customer" }, { label: "Reason" }, { label: "By", muted: true }, { label: "Value", align: "right", money: true }],
        rows: orders.map((o) => [shortNo(o.number), when(o.createdAt), orderPlace(o), o.customerName ?? "—", o.cancelReason ?? "—", o.cancelledBy ? noBrackets(o.cancelledBy.fullName) : "—", o.total]),
        foot: orders.length ? ["Total", "", "", "", "", "", sum(orders, (o) => o.total)] : undefined },
      { kind: "table", title: "Items removed from orders", subtitle: "After the order was placed", empty: none,
        columns: [{ label: "When" }, { label: "Order" }, { label: "Item" }, { label: "Qty", align: "right" }, { label: "Reason" }, { label: "By", muted: true }, { label: "Value", align: "right", money: true }],
        rows: removedRows.map((x) => [when(x.at), x.order, x.item, x.n, x.reason, noBrackets(x.by), x.amount]),
        foot: removedRows.length ? ["Total", "", "", sum(removedRows, (x) => x.n), "", "", sum(removedRows, (x) => x.amount)] : undefined },
      { kind: "table", title: "Voided sales", empty: none, half: true,
        columns: [{ label: "When" }, { label: "Sale" }, { label: "Reason" }, { label: "Recorded by", muted: true }, { label: "Amount", align: "right", money: true }],
        rows: sales.map((s) => [when(s.occurredAt), s.description ?? s.category.name, s.voidReason ?? "—", noBrackets(s.recordedBy.fullName), s.amount]) },
      { kind: "table", title: "Reversed payments", empty: none, half: true,
        columns: [{ label: "When" }, { label: "For" }, { label: "Method" }, { label: "Reason" }, { label: "By", muted: true }, { label: "Amount", align: "right", money: true }],
        rows: [
          ...pays.map((p) => [when(p.reversedAt ?? p.receivedAt), p.reservation ? `${p.reservation.guest.fullName} · ${p.reservation.reference}` : p.kind === "REFUND" ? "Refund" : "Payment", p.method.name, p.reversalReason ?? "—", p.reversedBy ? noBrackets(p.reversedBy.fullName) : "—", p.amount] as Cell[]),
          ...orderPays.map((p) => [when(p.reversedAt!), `Order ${shortNo(p.order.number)}`, p.paymentMethod.name, p.reverseReason ?? "—", p.reversedBy ? noBrackets(p.reversedBy.fullName) : "—", p.amount] as Cell[]),
        ] },
      { kind: "table", title: "Cancelled bookings and no-shows", empty: none,
        columns: [{ label: "Booking" }, { label: "Guest" }, { label: "Arrival" }, { label: "Source", muted: true }, { label: "What" }, { label: "Reason" }, { label: "Value", align: "right", money: true }],
        rows: bookings.map((b) => [b.reference, b.guest.fullName, dayMonth(fromDbDate(b.arrivalDate)), b.source.name, b.status === "NO_SHOW" ? "No-show" : "Cancelled", b.cancelReason ?? "—", b.netAmount]) },
      { kind: "table", title: "Voided room charges and expenses", empty: none,
        columns: [{ label: "What" }, { label: "For" }, { label: "Reason" }, { label: "Amount", align: "right", money: true }],
        rows: [
          ...charges.map((x) => [x.description, `${x.reservation.guest.fullName} · ${x.reservation.reference}`, x.voidReason ?? "—", x.amount] as Cell[]),
          ...spent.map((x) => [`Expense ${x.number ?? ""}`.trim(), `${x.category.name} · ${x.description}`, x.voidReason ?? "—", x.amount] as Cell[]),
        ] },
    ],
  };
}

// 11 · Expenses
async function expenses(r: Range, c: Ctx): Promise<Body> {
  const [ex, exPrev, list] = await Promise.all([
    expenseSummary(r), expenseSummary(c.prev),
    db.expense.findMany({ where: { businessDate: dbr(r), status: { not: "VOIDED" } }, orderBy: { spentAt: "desc" },
      select: { number: true, amount: true, spentAt: true, description: true, payee: true, status: true, category: { select: { name: true } }, paymentMethod: { select: { name: true } }, createdBy: { select: { fullName: true } } } }),
  ]);
  const palette = ["#f43f5e", "#f59e0b", "#8b5cf6", "#0ea5e9", "#10b981", "#64748b", "#c9a24a", "#ec4899"];
  const STATUS: Record<string, string> = { RECORDED: "Recorded", PENDING_APPROVAL: "Waiting approval", APPROVED: "Approved", REJECTED: "Rejected", CORRECTION_REQUESTED: "To correct" };
  const top = ex.byCategory[0];
  return {
    figures: [
      { label: "Spent", value: tzs(ex.total), raw: ex.total, delta: change(ex.total, exPrev.total), invert: true, tone: "rose" },
      { label: "Expenses", value: num(ex.count), raw: ex.count, sub: ex.count ? `average ${tzs(Math.round(ex.total / ex.count))}` : undefined },
      { label: "Per day", value: tzs(Math.round(ex.total / c.days)), raw: Math.round(ex.total / c.days), sub: `${c.days} day${c.days === 1 ? "" : "s"}` },
      { label: "Biggest category", value: top?.name ?? "—", sub: top ? `${tzs(top.amount)} · ${pct(top.amount, ex.total)}%` : undefined, tone: "amber" },
      { label: "Biggest single expense", value: ex.highValue[0] ? tzs(ex.highValue[0].amount) : "—", sub: ex.highValue[0]?.description },
      { label: "Waiting for approval", value: tzs(ex.pending.amount), raw: ex.pending.amount, sub: `${plural(ex.pending.count, "expense")} (any date)`, tone: ex.pending.count ? "amber" : undefined },
    ],
    blocks: [
      { kind: "bars", title: "By category", money: true, empty: "No expenses in this period.",
        items: ex.byCategory.map((x, i) => ({ label: x.name, value: x.amount, color: palette[i % palette.length], sub: `${pct(x.amount, ex.total)}%` })) },
      { kind: "table", title: "Every expense", subtitle: "Newest first · rejected and waiting ones are listed but not counted", empty: "No expenses in this period.",
        columns: [{ label: "When" }, { label: "No.", muted: true }, { label: "Category" }, { label: "What" }, { label: "Paid to", muted: true }, { label: "Method", muted: true }, { label: "By", muted: true }, { label: "Status" }, { label: "Amount", align: "right", money: true }],
        rows: list.slice(0, 120).map((x) => [when(x.spentAt), x.number ?? "—", x.category.name, x.description, x.payee ?? "—", x.paymentMethod?.name ?? "—", noBrackets(x.createdBy.fullName), STATUS[x.status] ?? x.status, x.amount]),
        foot: list.length ? ["Counted total", "", "", "", "", "", "", "", ex.total] : undefined, more: Math.max(0, list.length - 120) },
    ],
  };
}

/** Stock, waste & assets: what came in and went out of the stores, by department and item; waste; counts; what to buy; assets. */
async function stores(r: Range): Promise<Body> {
  const { start, end } = businessRangeBounds(r.from, r.to, businessDayConfig(await getSettings()));
  const [moves, alerts, assets, items] = await Promise.all([
    db.inventoryMovement.findMany({
      where: { status: "POSTED", recordedAt: { gte: start, lt: end } },
      select: { kind: true, reason: true, change: true, totalCost: true, unit: true, item: { select: { id: true, name: true, unit: true, department: { select: { name: true } } } } },
    }),
    inventoryAlerts(r.to), assetSummary(start, end),
    db.inventoryItem.findMany({ where: { isActive: true }, select: { quantity: true, costPerUnit: true } }),
  ]);
  const val = (ks: string[]) => moves.filter((m) => ks.includes(m.kind)).reduce((t, m) => t + (m.totalCost ?? 0), 0);
  const received = val(["RECEIVE"]), used = val(["USE", "SALE"]), sold = val(["SALE"]), waste = val(["WASTE"]);
  const counted = moves.filter((m) => m.kind === "COUNT").reduce((t, m) => t + Math.sign(m.change) * (m.totalCost ?? 0), 0);
  const stock = items.reduce((t, i) => t + Math.max(0, Math.round(i.quantity * i.costPerUnit)), 0);
  // By department: in, out, waste.
  const dept = new Map<string, { in: number; out: number; waste: number }>();
  for (const m of moves) {
    const k = m.item.department.name; const x = dept.get(k) ?? { in: 0, out: 0, waste: 0 };
    if (m.kind === "RECEIVE") x.in += m.totalCost ?? 0; else if (m.kind === "USE" || m.kind === "SALE") x.out += m.totalCost ?? 0; else if (m.kind === "WASTE") x.waste += m.totalCost ?? 0;
    dept.set(k, x);
  }
  // By item: quantity in and out, waste.
  const byItem = new Map<string, { name: string; dept: string; unit: string; inQ: number; outQ: number; wasteQ: number; outV: number }>();
  for (const m of moves) {
    const x = byItem.get(m.item.id) ?? { name: m.item.name, dept: m.item.department.name, unit: m.item.unit, inQ: 0, outQ: 0, wasteQ: 0, outV: 0 };
    if (m.kind === "RECEIVE") x.inQ += m.change; else if (m.kind === "USE" || m.kind === "SALE") { x.outQ -= m.change; x.outV += m.totalCost ?? 0; } else if (m.kind === "WASTE") x.wasteQ -= m.change;
    byItem.set(m.item.id, x);
  }
  const wasteRows = moves.filter((m) => m.kind === "WASTE");
  const wasteBy = new Map<string, number>();
  for (const m of wasteRows) wasteBy.set(reasonLabel(m.reason), (wasteBy.get(reasonLabel(m.reason)) ?? 0) + (m.totalCost ?? 0));
  const figures: Figure[] = [
    { label: "Stock received", value: formatTZS(received), raw: received, tone: "emerald", sub: `${moves.filter((m) => m.kind === "RECEIVE").length} deliveries` },
    { label: "Stock used", value: formatTZS(used), raw: used, tone: "amber", sub: sold ? `${formatTZS(sold)} by dishes sold` : "by the departments" },
    { label: "Waste", value: formatTZS(waste), raw: waste, tone: "rose", invert: true, sub: `${wasteRows.length} record${wasteRows.length === 1 ? "" : "s"}` },
    { label: "Count corrections", value: `${counted < 0 ? "−" : ""}${formatTZS(Math.abs(counted))}`, raw: counted, tone: "slate", sub: "counted vs system" },
    { label: "Stock value now", value: formatTZS(stock), raw: stock, tone: "gold", sub: "at the last price paid" },
    { label: "To buy", value: `${alerts.out.length + alerts.low.length}`, raw: alerts.out.length + alerts.low.length, tone: alerts.out.length ? "rose" : "sky", sub: `${alerts.out.length} out · ${alerts.low.length} low` },
    { label: "Assets", value: `${assets.units}`, raw: assets.units, tone: "violet", sub: `${assets.records} records · ${assets.moved} moved` },
    { label: "Equipment in repair", value: `${assets.underRepair + assets.outOfOrder}`, raw: assets.underRepair + assets.outOfOrder, tone: assets.outOfOrder ? "rose" : "slate", invert: true, sub: `${assets.outOfOrder} out of order` },
  ];
  const blocks: Block[] = [
    { kind: "bars", title: "Used by department", subtitle: "Value taken out (work and dishes sold)", money: true, half: true, empty: "Nothing used.", items: [...dept.entries()].filter(([, x]) => x.out).sort((a, b) => b[1].out - a[1].out).map(([k, x]) => ({ label: k, value: x.out, sub: x.waste ? `waste ${formatTZS(x.waste)}` : undefined })) },
    { kind: "bars", title: "Received by department", subtitle: "Value of deliveries", money: true, half: true, empty: "No deliveries.", items: [...dept.entries()].filter(([, x]) => x.in).sort((a, b) => b[1].in - a[1].in).map(([k, x]) => ({ label: k, value: x.in })) },
    {
      kind: "table", title: "Stock movement by item", subtitle: "In, out and wasted in each item's own unit", empty: "Nothing moved in this period.",
      columns: [{ label: "Item" }, { label: "Department", muted: true }, { label: "Received", align: "right" }, { label: "Used", align: "right" }, { label: "Wasted", align: "right" }, { label: "Used value", align: "right", money: true }],
      rows: [...byItem.values()].sort((a, b) => b.outV - a.outV).map((x) => [x.name, x.dept, x.inQ ? formatQty(x.inQ, x.unit) : "—", x.outQ ? formatQty(x.outQ, x.unit) : "—", x.wasteQ ? formatQty(x.wasteQ, x.unit) : "—", x.outV] as Cell[]),
    },
    { kind: "bars", title: "Waste by reason", money: true, half: true, empty: "No waste — well done.", items: [...wasteBy.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, color: "#f43f5e" })) },
    { kind: "list", title: "Stock to buy now", tone: "attention", items: [...alerts.out.map((i) => `Out of stock: ${i.name} (${i.department.name})`), ...alerts.low.map((i) => `Low: ${i.name} ${formatQty(i.quantity, i.unit)} — minimum ${formatQty(i.minStock ?? 0, i.unit)}`)].slice(0, 20) },
    ...(assets.needsAttention.length ? [{ kind: "list" as const, title: "Equipment needing attention", tone: "attention" as const, items: assets.needsAttention.map((a) => `${a.name} (${a.code})${a.location ? ` — ${a.location}` : ""} · ${a.status.toLowerCase().replace(/_/g, " ")}`) }] : []),
    { kind: "note", text: `Kinds of movement: ${Object.values(KIND_LABEL as Record<MovementKind, string>).join(", ")}. Values use the price paid at the time. Waste only counts once a manager approved it.` },
  ];
  return { figures, blocks };
}
