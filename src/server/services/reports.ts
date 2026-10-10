import "server-only";
import { db } from "../db";
import {
  change, dailyByKind, dailyMoney, expenseSummary, guestMovement, meetingRoomStats, occupancy, onTheBooks, outstanding, previousRange, profitLoss, stayPatterns, topCustomers,
  type Range,
} from "./reporting";
import { tablesOnHome } from "./table-performance";
import { assetSummary, inventoryAlerts } from "./inventory";
import { KIND_LABEL, qtyParts, reasonLabel, type MovementKind } from "@/lib/inventory";
import { spotWord } from "@/lib/delivery-place";
import { businessDayConfig, getSettings } from "../settings";
import { staffPerformance } from "./staff-performance";
import { ORDER_SOURCE } from "./restaurant";
import { addDays, businessRangeBounds, diffDays, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { REPORTS, type Block, type Cell, type Figure, type Report, type ReportKey } from "@/lib/report-types";
import { msg } from "@/i18n/msg";
import { day as hotelDay, textBook, word, type TextArg, type TextArgs, type TextBook, type TextWord } from "@/lib/report-i18n";

// ───────────────────────── helpers ─────────────────────────

const TZ = "Africa/Dar_es_Salaam";
const tzs = (v: number) => formatTZS(v);
const num = (v: number) => v.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const dbr = (r: Range) => ({ gte: toDbDate(r.from), lte: toDbDate(r.to) });
const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);
const hourOf = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(d));
/** "12 Oct" — the labels under a chart's columns. */
const dayMonth = (d: BusinessDate) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const noBrackets = (s: string) => s.replace(/\s*\(.*\)/, "");

// ───────────────────────── the reader's language ─────────────────────────
// A report is made once, in English (its record), and shown in each reader's language: static words are msg()-marked
// English (the document translates them), sentences with values are written with L() into the report's book
// (src/lib/report-i18n.ts) so they can be said again in another language with the very same numbers. Block titles and
// figure labels stay English values — the daily report picks blocks and figures by them.

/** Writes a sentence with values into the report's book; it returns the English the report keeps. */
type Say = ReturnType<typeof textBook>["L"];
/** "3 orders": a count as a word inside a sentence. */
const count = (n: number, one: string, other: string): TextWord => word(n === 1 ? one : other, { n: num(n) });

/** Weekday and month names as en-GB writes them — said in the reader's language. */
const DATE_WORDS = new Set<string>([
  msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat"), msg("Sun"),
  msg("Jan"), msg("Feb"), msg("Mar"), msg("Apr"), msg("May"), msg("Jun"), msg("Jul"), msg("Aug"), msg("Sep"), msg("Sept"), msg("Oct"), msg("Nov"), msg("Dec"),
]);
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const ON_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: TZ });
const at = (d: BusinessDate) => new Date(`${d}T00:00:00Z`);
const dateParts = (fmt: Intl.DateTimeFormat, d: Date): TextArgs =>
  Object.fromEntries(fmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, DATE_WORDS.has(p.value) ? word(p.value) : p.value]));
/** A date as a word — only when its template says exactly what the report has always written (else the plain English). */
const dateWord = (key: string, vars: TextArgs, english: string): TextArg => (textBook().L(key, vars) === english ? word(key, vars) : english);
/** "Mon 12 Oct" */
const dayW = (d: BusinessDate) => dateWord(msg("{weekday} {day} {month}"), dateParts(DAY, at(d)), DAY.format(at(d)));
/** "12 Oct" */
const dayMonthW = (d: BusinessDate) => dateWord(msg("{day} {month}"), dateParts(DAY_MONTH, at(d)), DAY_MONTH.format(at(d)));
/** "Oct 2026", from "2026-10" */
const monthW = (m: string) => dateWord(msg("{month} {year}"), dateParts(MONTH_YEAR, new Date(`${m}-01T00:00:00Z`)), MONTH_YEAR.format(new Date(`${m}-01T00:00:00Z`)));
/** "12 Oct 14:05" (the hotel's time) */
const whenW = (d: Date) => dateWord(msg("{day} {month} {time}"), { ...dateParts(ON_DAY, d), time: clock(d) }, `${ON_DAY.format(d)} ${clock(d)}`);
/** "2 bottles", "1.5 kg" — formatQty's English, the unit said in the reader's language. */
const qtyW = (q: number, unit: string): TextWord => { const p = qtyParts(q, unit); return word(msg("{n} {unit}"), { n: p.n, unit: word(p.unit) }); };
/** "A, B, C" — each said in the reader's language. */
const listOf = (xs: string[]): TextWord => word(xs.map((_, i) => `{w${i}}`).join(", "), Object.fromEntries(xs.map((x, i) => [`w${i}`, word(x)])));

/**
 * Short words that mean something else elsewhere in the app ("Delivery" is an order going out here, not a message being
 * delivered; "Share" is a part of the total, not sharing a link): in a report they are said from "report::<word>".
 */
const REPORT_WORDS = ["Delivery", "Day", "Month", "Sold", "Name", "Share", "Spent"];

/** The report's own writer: every sentence with values goes into its book. */
function sayKit(L: Say, book: TextBook) {
  /** A word on its own (or plain text): its English, kept to be said again. */
  const say = (w: TextArg) => (typeof w === "object" && "k" in w ? L(w.k, w.v) : String(w));
  return {
    L, say,
    /**
     * As it was written — a person's or a company's name, a reason or a note someone typed: the book says it as it is,
     * so it is never taken for a word to translate (a guest called "May" stays "May").
     */
    asIs: (text: string) => {
      if (/[A-Za-z]/.test(text) && !Object.prototype.hasOwnProperty.call(book, text)) book[text] = { k: "{x}", v: { x: text } };
      return text;
    },
    /** "3 orders" on its own. */
    P: (n: number, one: string, other: string) => say(count(n, one, other)),
    day: (d: BusinessDate) => say(dayW(d)),
    dayMonth: (d: BusinessDate) => say(dayMonthW(d)),
    month: (m: string) => say(monthW(m)),
    when: (d: Date) => say(whenW(d)),
    /** A place as the hotel named it ("Table 3 — Inside", "Counter"): its English, said in the reader's words. */
    spot: (name: string) => say(spotWord(name)),
    /** "2 bottles" (formatQty), said in the reader's words. */
    qty: (q: number, unit: string) => say(qtyW(q, unit)),
  };
}
type Kit = ReturnType<typeof sayKit>;

const orderPlace = (o: { location?: { name: string } | null; tableLabel?: string | null; roomNumber?: string | null; type: string }, s: Kit) => {
  const named = o.location?.name ?? o.tableLabel;
  return named != null ? s.spot(named) : o.roomNumber ? s.L(msg("Room {room}"), { room: o.roomNumber }) : o.type === "TAKEAWAY" ? msg("Delivery") : o.type === "PICKUP" ? msg("Pick-up") : msg("Restaurant");
};

/** One colour per department, in a fixed order, everywhere in the reports. */
export const DEPT = {
  rooms: { label: msg("Rooms"), color: "#8b5cf6" },
  restaurant: { label: msg("Food (restaurant)"), color: "#f59e0b" },
  bar: { label: msg("Drinks (bar)"), color: "#0ea5e9" },
  roomService: { label: msg("Room service fees"), color: "#f43f5e" },
  meeting: { label: msg("Meeting room"), color: "#10b981" },
  transport: { label: msg("Transport"), color: "#64748b" },
  other: { label: msg("Other & extras"), color: "#c9a24a" },
} as const;
type DeptKey = keyof typeof DEPT;
const DEPT_KEYS = Object.keys(DEPT) as DeptKey[];

const TYPE_LABEL: Record<string, string> = { DINE_IN: msg("Dine-in (tables)"), ROOM_SERVICE: msg("Room service"), TAKEAWAY: msg("Delivery"), PICKUP: msg("Pick-up") };
const STATUS_WORD: Record<string, string> = {
  PENDING: msg("New"), ACCEPTED: msg("Accepted"), PREPARING: msg("Preparing"), READY: msg("Ready to serve"), OUT_FOR_DELIVERY: msg("Serving"), DELIVERED: msg("Served"), COMPLETED: msg("Done"), COLLECTED: msg("Done"), CANCELLED: msg("Cancelled"),
};
/** An asset's state in a sentence ("Fridge (A-12) · under repair"). */
const ASSET_STATE: Record<string, string> = { IN_USE: msg("in use"), IN_STORE: msg("in store"), UNDER_REPAIR: msg("under repair"), OUT_OF_ORDER: msg("out of order") };

/** Days → the rows of a day-by-day table; a long period (over two months) is summed by month instead. */
function byDayOrMonth<T extends { date: BusinessDate }>(rows: T[], sum: (xs: T[]) => Cell[], s: Kit): { label: string; rows: Cell[][] } {
  if (rows.length <= 62) return { label: msg("Day"), rows: rows.map((r) => [s.day(r.date), ...sum([r])]) };
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))];
  return {
    label: msg("Month"),
    rows: months.map((m) => [s.month(m), ...sum(rows.filter((r) => r.date.startsWith(m)))]),
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
  // Every sentence with values is kept with them, to say the report again in the reader's language.
  const { book, L } = textBook(Object.fromEntries(REPORT_WORDS.map((w) => [w, { k: `report::${w}` }])));
  const body = await BUILDERS[meta.key](range, { today, days, prev: previousRange(range), s: sayKit(L, book) });
  const period = periodText(range);
  // The summary to share, kept in the book too: reportTr(t, report.i18n)(report.share) says it in the reader's language.
  const shareVars: TextArgs = { title: word(meta.title), period: range.from === range.to ? hotelDay(range.from, true) : word("{from} → {to}", { from: hotelDay(range.from), to: hotelDay(range.to) }) };
  const shareLines = body.figures.map((f, i) => {
    shareVars[`l${i}`] = word(f.label);
    shareVars[`v${i}`] = word(f.value);
    if (f.sub) shareVars[`s${i}`] = word(f.sub);
    return `• {l${i}}: {v${i}}${f.sub ? ` ({s${i}})` : ""}`;
  });
  return {
    key: meta.key, title: meta.title, blurb: meta.blurb, period, from: range.from, to: range.to, days,
    figures: body.figures, blocks: body.blocks,
    share: L(["{title} — {period}", ...shareLines].join("\n"), shareVars),
    i18n: book,
  };
}

type Ctx = { today: BusinessDate; days: number; prev: Range; s: Kit };
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
  const { L } = c.s;
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
      kind: "bars", title: msg("Income by department"),
      subtitle: c.days === 1 ? msg("Earned on the day · share of the total and against the period before") : msg("Earned in the period · share of the total and against the period before"), money: true,
      items: DEPT_KEYS.map((k) => {
        const [now, before] = dept[k];
        const d = change(now, before);
        return { label: DEPT[k].label, value: now, color: DEPT[k].color, sub: d != null ? L(msg("{pct}% · {change}% vs before"), { pct: pct(now, earned), change: `${d >= 0 ? "+" : ""}${Math.round(d)}` }) : `${pct(now, earned)}%` };
      }),
    },
    {
      kind: "statement", title: msg("Income statement"), subtitle: msg("Earned value, not cash"), half: true,
      rows: [
        { label: msg("Rooms (before discounts)"), value: rev.rooms.gross },
        { label: msg("Food (restaurant)"), value: rev.restaurant }, { label: msg("Drinks (bar)"), value: rev.bar },
        { label: msg("Room service fees"), value: rev.roomService }, { label: msg("Meeting room"), value: rev.meeting },
        { label: msg("Transport"), value: rev.transport }, { label: msg("Other & extras"), value: rev.other },
        { label: msg("Gross income"), value: pl.grossRevenue, style: "sub" },
        { label: msg("Less room discounts"), value: -pl.discounts, style: "less" },
        { label: msg("Less refunds"), value: -pl.refunds, style: "less" },
        { label: msg("Net income"), value: pl.netRevenue, style: "total" },
        { label: msg("Less expenses"), value: -pl.expenses, style: "less" },
        { label: pl.estimatedProfit >= 0 ? msg("Profit (estimate)") : msg("Loss (estimate)"), value: pl.estimatedProfit, style: "grand" },
      ],
    },
    { kind: "bars", title: msg("Money received, by method"), subtitle: msg("Payments and on-the-spot sales, less refunds"), money: true, half: true, items: byMethod, empty: msg("No money received in this period.") },
  ];
  if (c.days > 1) {
    blocks.push({
      kind: "columns", title: c.days > 62 ? msg("Month by month") : msg("Day by day"), subtitle: msg("Rooms · restaurant & bar · everything else"), money: true,
      points: groupPoints(perDay, (xs) => [
        { name: msg("Rooms"), value: sum(xs, (x) => x.rooms), color: DEPT.rooms.color },
        { name: msg("Restaurant & bar"), value: sum(xs, (x) => x.restaurant + x.bar + x.roomService), color: DEPT.restaurant.color },
        { name: msg("Other"), value: sum(xs, (x) => x.meeting + x.transport + x.other), color: DEPT.other.color },
      ]),
    });
  }
  blocks.push({
    kind: "highlights", title: msg("Highlights"),
    items: [
      ...(c.days > 1 && bestDay && bestDay.total > 0 ? [{ label: msg("Best day"), value: c.s.day(bestDay.date), sub: tzs(bestDay.total) }] : []),
      { label: msg("Best-selling item"), value: bestItem[0]?.name ?? "—", sub: bestItem[0] ? L(msg("{n} sold · {amount}"), { n: num(bestItem[0]._sum.quantity ?? 0), amount: tzs(bestItem[0]._sum.lineTotal ?? 0) }) : msg("Nothing sold") },
      { label: msg("Best room type"), value: bestType && bestType.net > 0 ? bestType.name : "—", sub: bestType && bestType.net > 0 ? L(msg("{rooms} sold · {amount}"), { rooms: count(bestType.roomsSold, msg("{n} room"), msg("{n} rooms")), amount: tzs(bestType.net) }) : msg("No rooms sold") },
      { label: msg("Top customer"), value: top[0] ? c.s.asIs(top[0].name) : "—", sub: top[0] ? tzs(top[0].total) : msg("No sales yet") },
      { label: msg("Occupancy"), value: `${occ.occupancy.toFixed(1)}%`, sub: L(msg("{nights} of {total}"), { nights: count(occ.roomNights, msg("{n} room night"), msg("{n} room nights")), total: num(occ.sellableNights) }) },
      { label: msg("Kept as profit"), value: pl.netRevenue > 0 ? `${pct(Math.max(0, pl.estimatedProfit), pl.netRevenue)}%` : "—", sub: msg("of net income") },
    ],
  });
  if (c.days > 1) {
    const t = byDayOrMonth(perDay, (xs) => [sum(xs, (x) => x.rooms), sum(xs, (x) => x.restaurant), sum(xs, (x) => x.bar), sum(xs, (x) => x.roomService + x.meeting + x.transport + x.other), sum(xs, (x) => x.total)], c.s);
    blocks.push({
      kind: "table", title: t.label === "Day" ? msg("Income day by day") : msg("Income month by month"),
      columns: [{ label: t.label }, { label: msg("Rooms"), align: "right", money: true }, { label: msg("Food"), align: "right", money: true }, { label: msg("Drinks"), align: "right", money: true }, { label: msg("Other"), align: "right", money: true }, { label: msg("Total"), align: "right", money: true }],
      rows: t.rows,
      foot: [msg("Total"), sum(perDay, (x) => x.rooms), sum(perDay, (x) => x.restaurant), sum(perDay, (x) => x.bar), sum(perDay, (x) => x.roomService + x.meeting + x.transport + x.other), sum(perDay, (x) => x.total)],
    });
  }
  blocks.push({ kind: "note", text: msg("Income is counted on the hotel day it is earned (room nights night by night; restaurant, bar and extras when sold or put on a room bill). Money received is cash in: payments and on-the-spot sales, less refunds. Owed is as of now, for all dates.") });

  return {
    figures: [
      { label: msg("Earned (net income)"), value: tzs(pl.netRevenue), raw: pl.netRevenue, delta: change(pl.netRevenue, plPrev.netRevenue), tone: "gold" },
      { label: msg("Money received"), value: tzs(money.total), raw: money.total, delta: change(money.total, moneyPrev.total), tone: "emerald" },
      { label: msg("Expenses"), value: tzs(pl.expenses), raw: pl.expenses, delta: change(pl.expenses, plPrev.expenses), invert: true, tone: "rose" },
      { label: pl.estimatedProfit >= 0 ? msg("Profit (estimate)") : msg("Loss (estimate)"), value: tzs(Math.abs(pl.estimatedProfit)), raw: pl.estimatedProfit, tone: pl.estimatedProfit >= 0 ? "emerald" : "rose" },
      {
        label: msg("Owed to the hotel now"), value: tzs(owedNow), raw: owedNow, tone: owedNow ? "amber" : undefined,
        sub: L(msg("{guests} · {invoices} · {orders}"), { guests: count(owed.reservations.count, msg("{n} guest"), msg("{n} guests")), invoices: count(owed.invoices.count, msg("{n} invoice"), msg("{n} invoices")), orders: count(unpaid.count, msg("{n} order"), msg("{n} orders")) }),
      },
      { label: msg("Room occupancy"), value: `${occ.occupancy.toFixed(1)}%`, raw: Math.round(occ.occupancy * 10) / 10, sub: L(msg("{rooms} sold"), { rooms: count(occ.roomsSold, msg("{n} room"), msg("{n} rooms")) }), tone: "violet" },
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
  return [...total.entries()].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]).map(([id, v], i) => ({ label: name.get(id) ?? msg("Other"), value: v, color: palette[i % palette.length], sub: `${pct(v, all)}%` }));
}

// 2 · Daily sales
async function daily(r: Range, c: Ctx): Promise<Body> {
  const { L } = c.s;
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
      kind: "columns", title: msg("Restaurant & bar, hour by hour"), subtitle: msg("Orders placed each hour (cancelled left out)"), money: true, empty: msg("No restaurant or bar orders on this day."),
      points: orders.length ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((h) => {
        const xs = orders.filter((o) => hourOf(o.createdAt) === h);
        return { label: `${String(h).padStart(2, "0")}`, parts: [
          { name: msg("Food"), value: sum(xs, (o) => o.foodSubtotal), color: DEPT.restaurant.color },
          { name: msg("Drinks"), value: sum(xs, (o) => o.drinksSubtotal), color: DEPT.bar.color },
          { name: msg("Room service fees"), value: sum(xs, (o) => o.serviceFee), color: DEPT.roomService.color },
        ] };
      }) : [],
    });
    blocks.push({
      kind: "bars", title: msg("The day by department"), money: true,
      items: DEPT_KEYS.map((k) => ({ label: DEPT[k].label, value: perDay[0]?.[k] ?? 0, color: DEPT[k].color, sub: `${pct(perDay[0]?.[k] ?? 0, total)}%` })),
    });
  } else {
    blocks.push({
      kind: "columns", title: c.days > 62 ? msg("Sales month by month") : msg("Sales day by day"), subtitle: msg("Stacked by department"), money: true,
      points: groupPoints(perDay, (xs) => DEPT_KEYS.map((k) => ({ name: DEPT[k].label, value: sum(xs, (x) => x[k]), color: DEPT[k].color }))),
    });
  }
  const rows = perDay.map((d) => ({ ...d, received: cash.find((x) => x.date === d.date)?.received ?? 0 }));
  const t = byDayOrMonth(rows, (xs) => [sum(xs, (x) => x.rooms), sum(xs, (x) => x.restaurant), sum(xs, (x) => x.bar), sum(xs, (x) => x.roomService), sum(xs, (x) => x.meeting + x.transport + x.other), sum(xs, (x) => x.total), sum(xs, (x) => x.received)], c.s);
  blocks.push({
    kind: "table", title: msg("Sales by day and department"), subtitle: msg("Earned on each hotel day · received = money in that day"),
    columns: [{ label: t.label }, { label: msg("Rooms"), align: "right", money: true }, { label: msg("Food"), align: "right", money: true }, { label: msg("Drinks"), align: "right", money: true }, { label: msg("Room svc"), align: "right", money: true }, { label: msg("Other"), align: "right", money: true }, { label: msg("Total"), align: "right", money: true }, { label: msg("Received"), align: "right", money: true, muted: true }],
    rows: t.rows,
    foot: [msg("Total"), sum(rows, (x) => x.rooms), sum(rows, (x) => x.restaurant), sum(rows, (x) => x.bar), sum(rows, (x) => x.roomService), sum(rows, (x) => x.meeting + x.transport + x.other), total, got],
  });
  return {
    figures: [
      { label: msg("Total sales"), value: tzs(total), raw: total, delta: change(total, before), tone: "gold" },
      c.days > 1
        ? { label: msg("Average per day"), value: tzs(Math.round(total / c.days)), raw: Math.round(total / c.days), sub: L(msg("{n} days"), { n: c.days }) }
        : { label: msg("Restaurant & bar orders"), value: num(orders.length), raw: orders.length, sub: orders.length ? L(msg("average {amount}"), { amount: tzs(Math.round(sum(orders, (o) => o.total) / orders.length)) }) : msg("none yet") },
      c.days > 1
        ? { label: msg("Best day"), value: best && best.total ? c.s.day(best.date) : "—", sub: best && best.total ? tzs(best.total) : undefined }
        : { label: msg("Vs the day before"), value: before ? tzs(before) : "—", sub: msg("total sales") },
      { label: msg("Rooms"), value: tzs(sum(perDay, (d) => d.rooms)), raw: sum(perDay, (d) => d.rooms), tone: "violet" },
      { label: msg("Restaurant & bar"), value: tzs(food), raw: food, sub: msg("food, drinks & room service"), tone: "amber" },
      { label: msg("Money received"), value: tzs(got), raw: got, tone: "emerald" },
    ],
    blocks,
  };
}

// 3 · Restaurant & bar (food, beverage and room-service revenue)
async function restaurant(r: Range, c: Ctx): Promise<Body> {
  const { L, P } = c.s;
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
      return { label: label(k), value: sum(xs, (o) => o.total), color: colors[i % colors.length], sub: L(msg("{orders} · {pct}%"), { orders: count(xs.length, msg("{n} order"), msg("{n} orders")), pct: pct(sum(xs, (o) => o.total), totalSales) }) };
    }).sort((a, b) => b.value - a.value);
  };
  const settle = (o: (typeof orders)[number]) => (o.settlement === "ROOM" ? msg("On room bills") : o.paidAmount >= o.total ? msg("Paid") : msg("Not paid yet"));
  const hours = orders.map((o) => hourOf(o.createdAt));
  const lo = Math.min(7, ...hours), hi = Math.max(22, ...hours);
  const recorded = pl.revenue.restaurant + pl.revenue.bar + pl.revenue.roomService;

  const blocks: Block[] = [
    { kind: "bars", title: msg("Food and drinks"), subtitle: msg("What was ordered, before any payment"), money: true, half: true, items: [
      { label: msg("Food"), value: food, color: DEPT.restaurant.color, sub: `${pct(food, food + drinks)}%` },
      { label: msg("Drinks"), value: drinks, color: DEPT.bar.color, sub: `${pct(drinks, food + drinks)}%` },
      { label: msg("Room service fees"), value: fees, color: DEPT.roomService.color, sub: P(rs.length, msg("{n} room service order"), msg("{n} room service orders")) },
    ] },
    { kind: "bars", title: msg("By kind of order"), money: true, half: true, items: group((o) => o.type, (k) => TYPE_LABEL[k] ?? k, ["#f59e0b", "#f43f5e", "#0ea5e9", "#10b981"]), empty: msg("No orders.") },
    { kind: "bars", title: msg("Where the orders came from"), money: true, half: true, items: group((o) => o.source, (k) => ORDER_SOURCE[k] ?? k, ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#64748b", "#c9a24a"]), empty: msg("No orders.") },
    { kind: "bars", title: msg("How they are paid"), money: true, half: true, items: group(settle, (k) => k, ["#10b981", "#8b5cf6", "#f43f5e"]).map((x) => ({ ...x, color: x.label === "Paid" ? "#10b981" : x.label === "On room bills" ? "#8b5cf6" : "#f43f5e" })), empty: msg("No orders.") },
    {
      kind: "columns", title: msg("Busy hours"), subtitle: c.days > 1 ? msg("Sales by the hour the order was placed — all days together") : msg("Sales by the hour the order was placed"), money: true, empty: msg("No orders in this period."),
      points: orders.length ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((h) => {
        const xs = orders.filter((o) => hourOf(o.createdAt) === h);
        return { label: String(h).padStart(2, "0"), parts: [{ name: msg("Food"), value: sum(xs, (o) => o.foodSubtotal), color: DEPT.restaurant.color }, { name: msg("Drinks"), value: sum(xs, (o) => o.drinksSubtotal), color: DEPT.bar.color }] };
      }) : [],
    },
  ];
  if (c.days > 1) {
    const perDay = eachDay(r).map((d) => {
      const xs = orders.filter((o) => fromDbDate(o.businessDate) === d);
      return { date: d, n: xs.length, food: sum(xs, (o) => o.foodSubtotal), drinks: sum(xs, (o) => o.drinksSubtotal), fees: sum(xs, (o) => o.serviceFee), total: sum(xs, (o) => o.total) };
    });
    const t = byDayOrMonth(perDay, (xs) => [sum(xs, (x) => x.n), sum(xs, (x) => x.food), sum(xs, (x) => x.drinks), sum(xs, (x) => x.fees), sum(xs, (x) => x.total)], c.s);
    t.rows = t.rows.filter((row) => row[1] !== 0);
    blocks.push({
      kind: "table", title: t.label === "Day" ? msg("Restaurant & bar by day") : msg("Restaurant & bar by month"), subtitle: msg("Days with no orders are left out"), empty: msg("No orders in this period."),
      columns: [{ label: t.label }, { label: msg("Orders"), align: "right" }, { label: msg("Food"), align: "right", money: true }, { label: msg("Drinks"), align: "right", money: true }, { label: msg("Room svc fees"), align: "right", money: true }, { label: msg("Total"), align: "right", money: true }],
      rows: t.rows, foot: [msg("Total"), orders.length, food, drinks, fees, totalSales],
    });
  }
  blocks.push({
    kind: "table", title: msg("Room service orders"), subtitle: msg("Food and drinks brought to the rooms"), empty: msg("No room service in this period."),
    columns: [{ label: msg("Order") }, { label: msg("When") }, { label: msg("Room") }, { label: msg("Guest") }, { label: msg("Items"), align: "right" }, { label: msg("Status") }, { label: msg("Fee"), align: "right", money: true }, { label: msg("Total"), align: "right", money: true }],
    rows: rs.slice(-40).reverse().map((o) => [shortNo(o.number), c.s.when(o.createdAt), o.roomNumber ? L(msg("Room {room}"), { room: o.roomNumber }) : "—", c.s.asIs(o.guest?.fullName ?? o.customerName ?? "—"), sum(o.items, (i) => i.quantity), STATUS_WORD[o.status] ?? o.status, o.serviceFee, o.total]),
    foot: rs.length ? [msg("Total"), "", "", "", sum(rs, (o) => sum(o.items, (i) => i.quantity)), "", sum(rs, (o) => o.serviceFee), sum(rs, (o) => o.total)] : undefined,
    more: Math.max(0, rs.length - 40),
  });
  blocks.push({
    kind: "note",
    text: L(msg("These are orders placed (cancelled ones left out). Finance counts restaurant income when it is paid or put on a room bill: {recorded} recorded for this period (food {food}, drinks {drinks}, room service fees {fees})."), {
      recorded: tzs(recorded), food: tzs(pl.revenue.restaurant), drinks: tzs(pl.revenue.bar), fees: tzs(pl.revenue.roomService),
    }),
  });

  const foodPrev = prevAgg._sum.foodSubtotal ?? 0, drinksPrev = prevAgg._sum.drinksSubtotal ?? 0;
  return {
    figures: [
      { label: msg("Food sales"), value: tzs(food), raw: food, delta: change(food, foodPrev), tone: "amber" },
      { label: msg("Drink sales"), value: tzs(drinks), raw: drinks, delta: change(drinks, drinksPrev), tone: "sky" },
      { label: msg("Room service"), value: tzs(sum(rs, (o) => o.total)), raw: sum(rs, (o) => o.total), sub: L(msg("{orders} · fees {amount}"), { orders: count(rs.length, msg("{n} order"), msg("{n} orders")), amount: tzs(fees) }), tone: "rose" },
      { label: msg("Orders"), value: num(orders.length), raw: orders.length, delta: change(orders.length, prevAgg._count), sub: orders.length ? L(msg("average {amount}"), { amount: tzs(Math.round(totalSales / orders.length)) }) : undefined },
      { label: msg("Items sold"), value: num(itemsSold), raw: itemsSold, sub: orders.length ? L(msg("{n} per order"), { n: (itemsSold / orders.length).toFixed(1) }) : undefined },
      { label: msg("Kitchen speed"), value: prep != null ? L(msg("{n} min"), { n: prep }) : "—", sub: delivery != null ? L(msg("preparing · {n} min to serve"), { n: delivery }) : msg("preparing (accepted → ready)"), tone: "emerald" },
      { label: msg("Still to pay"), value: tzs(toPay), raw: toPay, sub: L(msg("{orders} not finished"), { orders: count(running, msg("{n} order"), msg("{n} orders")) }), tone: toPay ? "rose" : "slate", invert: true },
      {
        label: msg("Cancelled · discounts"), value: `${num(cancelled._count)} · ${tzs(discounted._sum.discountAmount ?? 0)}`, raw: discounted._sum.discountAmount ?? 0,
        sub: L(msg("cancelled {amount} · {bills} discounted"), { amount: tzs(cancelled._sum.total ?? 0), bills: count(discounted._count, msg("{n} bill"), msg("{n} bills")) }), tone: "slate", invert: true,
      },
    ],
    blocks,
  };
}

const eachDay = (r: Range) => Array.from({ length: diffDays(r.from, r.to) + 1 }, (_, i) => addDays(r.from, i));

// 4 · Best-selling items
async function items(r: Range, c: Ctx): Promise<Body> {
  const { L } = c.s;
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
      { label: msg("Items sold"), value: num(qty), raw: qty, delta: change(qty, sum(prevRows, (x) => x._sum.quantity ?? 0)), tone: "gold" },
      { label: msg("Sales from items"), value: tzs(total), raw: total },
      { label: msg("Different items"), value: num(rows.length), raw: rows.length, sub: L(msg("of {n} on the menu"), { n: menu.length }) },
      { label: msg("Best seller"), value: rows[0]?.name ?? "—", sub: rows[0] ? L(msg("{n} sold · {amount}"), { n: num(rows[0]._sum.quantity ?? 0), amount: tzs(rows[0]._sum.lineTotal ?? 0) }) : undefined, tone: "amber" },
      { label: msg("Best drink"), value: bestDrink?.name ?? "—", sub: bestDrink ? L(msg("{n} sold"), { n: num(bestDrink._sum.quantity ?? 0) }) : undefined, tone: "sky" },
      { label: msg("Not sold"), value: num(unsold.length), raw: unsold.length, sub: msg("menu items with no sale"), tone: unsold.length ? "rose" : undefined },
    ],
    blocks: [
      { kind: "bars", title: msg("Top 10 by sales"), money: true, half: true, empty: msg("Nothing sold in this period."),
        items: rows.slice(0, 10).map((x) => ({ label: x.name, value: x._sum.lineTotal ?? 0, color: x.type === "DRINK" ? DEPT.bar.color : DEPT.restaurant.color, sub: L(msg("{n} sold"), { n: num(x._sum.quantity ?? 0) }) })) },
      { kind: "bars", title: msg("Food and drinks"), money: true, half: true, items: [
        { label: L(msg("Food · {items}"), { items: count(sum(foods, (x) => x._sum.quantity ?? 0), msg("{n} item"), msg("{n} items")) }), value: sum(foods, (x) => x._sum.lineTotal ?? 0), color: DEPT.restaurant.color, sub: `${pct(sum(foods, (x) => x._sum.lineTotal ?? 0), total)}%` },
        { label: L(msg("Drinks · {items}"), { items: count(sum(drinks, (x) => x._sum.quantity ?? 0), msg("{n} item"), msg("{n} items")) }), value: sum(drinks, (x) => x._sum.lineTotal ?? 0), color: DEPT.bar.color, sub: `${pct(sum(drinks, (x) => x._sum.lineTotal ?? 0), total)}%` },
      ] },
      {
        kind: "table", title: msg("Every item sold"), subtitle: msg("Best first, by money"), empty: msg("Nothing sold in this period."),
        columns: [{ label: "#", align: "right", muted: true }, { label: msg("Item") }, { label: msg("Kind") }, { label: msg("Sold"), align: "right" }, { label: msg("On orders"), align: "right", muted: true }, { label: msg("Average price"), align: "right", money: true, muted: true }, { label: msg("Sales"), align: "right", money: true }, { label: msg("Share"), align: "right" }, { label: msg("Vs before"), align: "right", muted: true }],
        rows: rows.map((x, i) => {
          const q = x._sum.quantity ?? 0, before = prevRows.find((p) => p.name === x.name)?._sum.quantity ?? 0;
          const d = change(q, before);
          return [i + 1, x.name, x.type === "DRINK" ? msg("Drink") : msg("Food"), q, x._count, q ? Math.round((x._sum.lineTotal ?? 0) / q) : 0, x._sum.lineTotal ?? 0, `${pct(x._sum.lineTotal ?? 0, total)}%`, d == null ? (before ? "—" : msg("new")) : `${d >= 0 ? "+" : ""}${Math.round(d)}%`];
        }),
        foot: rows.length ? ["", msg("Total"), "", qty, "", "", total, "100%", ""] : undefined,
      },
      {
        kind: "table", title: msg("Not sold in this period"), subtitle: msg("Active menu items nobody ordered — worth a look"), empty: msg("Every menu item sold at least once."),
        columns: [{ label: msg("Item") }, { label: msg("Category") }, { label: msg("Kind") }, { label: msg("Price"), align: "right", money: true }, { label: msg("On the menu now") }],
        rows: unsold.slice(0, 60).map((m) => [m.name, m.category.name, m.type === "DRINK" ? msg("Drink") : msg("Food"), m.price, m.isAvailable ? msg("Yes") : msg("Switched off")]),
        more: Math.max(0, unsold.length - 60),
      },
    ],
  };
}

// 5 · Payment collection
async function payments(r: Range, c: Ctx): Promise<Body> {
  const { L, P, asIs } = c.s;
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
      at: p.receivedAt,
      what: p.kind === "REFUND" ? msg("Refund") : p.invoice ? L(msg("Invoice {number}"), { number: p.invoice.number }) : p.reservation ? L(msg("Booking {reference}"), { reference: p.reservation.reference }) : msg("Payment"),
      who: asIs(p.corporateCustomer?.companyName ?? p.reservation?.guest.fullName ?? "—"), method: p.method.name, account: p.account.name, by: p.recordedBy, amount: p.kind === "REFUND" ? -p.amount : p.amount,
    })),
    ...sales.map((s) => ({
      at: s.occurredAt, what: s.restaurantOrder ? L(msg("Order {no}"), { no: shortNo(s.restaurantOrder.number) }) : s.category.name, who: asIs(s.restaurantOrder?.customerName ?? s.description ?? "—"),
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
      { label: msg("Money received"), value: tzs(total), raw: total, delta: change(total, prevIn.total), tone: "emerald" },
      { label: msg("From guests & companies"), value: tzs(inn), raw: inn, sub: P(pays.filter((p) => p.kind === "PAYMENT").length, msg("{n} payment"), msg("{n} payments")) },
      { label: msg("From sales on the spot"), value: tzs(salesIn), raw: salesIn, sub: L(msg("{sales} · restaurant, bar & extras"), { sales: count(sales.length, msg("{n} sale"), msg("{n} sales")) }) },
      { label: msg("Refunds"), value: tzs(refunds), raw: refunds, invert: true, tone: refunds ? "rose" : undefined, sub: P(pays.filter((p) => p.kind === "REFUND").length, msg("{n} refund"), msg("{n} refunds")) },
      { label: msg("Transactions"), value: num(rows.length), raw: rows.length, sub: rows.length ? L(msg("average {amount}"), { amount: tzs(Math.round(total / rows.length)) }) : undefined },
      { label: msg("Waiting for reception"), value: tzs(toConfirm._sum.amount ?? 0), raw: toConfirm._sum.amount ?? 0, sub: L(msg("{payments} to confirm (any date)"), { payments: count(toConfirm._count, msg("{n} waiter payment"), msg("{n} waiter payments")) }), tone: toConfirm._count ? "amber" : undefined },
    ],
    blocks: [
      { kind: "bars", title: msg("By payment method"), money: true, half: true, items: byMethod, empty: msg("No money received.") },
      { kind: "bars", title: msg("By account (where the money is)"), money: true, half: true, empty: msg("No money received."),
        items: [...byAccount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: k, value: v, color: palette[i % palette.length], sub: `${pct(v, total)}%` })) },
      { kind: "table", title: msg("Collected by"), subtitle: msg("Who recorded the money"), empty: msg("Nobody recorded money in this period."),
        columns: [{ label: msg("Staff") }, { label: msg("Transactions"), align: "right" }, { label: msg("Amount"), align: "right", money: true }, { label: msg("Share"), align: "right" }],
        rows: [...byStaff.values()].sort((a, b) => b.amount - a.amount).map((s) => [asIs(noBrackets(s.name)), s.n, s.amount, `${pct(s.amount, total)}%`]),
        foot: rows.length ? [msg("Total"), rows.length, total, "100%"] : undefined, half: true },
      { kind: "table", title: msg("Every transaction"), subtitle: msg("Newest first"), empty: msg("No transactions in this period."),
        columns: [{ label: msg("When") }, { label: msg("For") }, { label: msg("Customer") }, { label: msg("Method") }, { label: msg("Account"), muted: true }, { label: msg("By"), muted: true }, { label: msg("Amount"), align: "right", money: true }],
        rows: rows.slice(0, 80).map((x) => [c.s.when(x.at), x.what, x.who, x.method, x.account, asIs(noBrackets(x.by.fullName)), x.amount]),
        foot: rows.length ? [msg("Total"), "", "", "", "", "", total] : undefined, more: Math.max(0, rows.length - 80) },
    ],
  };
}

// 6 · Outstanding (as of now)
async function outstandingReport(_r: Range, c: Ctx): Promise<Body> {
  const { L, P, asIs } = c.s;
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
      { label: msg("Owed to the hotel"), value: tzs(total), raw: total, tone: total ? "rose" : "emerald", sub: msg("as of now, all dates") },
      { label: msg("Guests staying"), value: tzs(sum(staying, (g) => g.balanceAmount)), raw: sum(staying, (g) => g.balanceAmount), sub: P(staying.length, msg("{n} booking"), msg("{n} bookings")) },
      { label: msg("Guests who left owing"), value: tzs(sum(left, (g) => g.balanceAmount)), raw: sum(left, (g) => g.balanceAmount), sub: P(left.length, msg("{n} booking"), msg("{n} bookings")), tone: left.length ? "amber" : undefined },
      {
        label: msg("Companies (invoices)"), value: tzs(owed.invoices.amount), raw: owed.invoices.amount,
        sub: overdue.length ? L(msg("{invoices} · {n} overdue"), { invoices: count(invoices.length, msg("{n} invoice"), msg("{n} invoices")), n: overdue.length }) : P(invoices.length, msg("{n} invoice"), msg("{n} invoices")),
      },
      { label: msg("Restaurant orders unpaid"), value: tzs(unpaid), raw: unpaid, sub: P(open.length, msg("{n} order"), msg("{n} orders")), tone: open.length ? "amber" : undefined },
      { label: msg("Oldest debt"), value: oldest ? P(oldest, msg("{n} day"), msg("{n} days")) : "—", raw: oldest, sub: msg("since the order / checkout / due date") },
    ],
    blocks: [
      { kind: "bars", title: msg("Where the money is owed"), money: true, items: [
        { label: msg("Guests staying"), value: sum(staying, (g) => g.balanceAmount), color: "#8b5cf6" },
        { label: msg("Guests who left"), value: sum(left, (g) => g.balanceAmount), color: "#f43f5e" },
        { label: msg("Companies"), value: owed.invoices.amount, color: "#0ea5e9" },
        { label: msg("Restaurant orders"), value: unpaid, color: "#f59e0b" },
      ] },
      { kind: "table", title: msg("Unpaid restaurant orders"), subtitle: msg("Not on a room bill — to collect from the customer"), empty: msg("Every restaurant order is paid."),
        columns: [{ label: msg("Order") }, { label: msg("Date") }, { label: msg("Where") }, { label: msg("Customer") }, { label: msg("Status") }, { label: msg("Total"), align: "right", money: true }, { label: msg("Paid"), align: "right", money: true, muted: true }, { label: msg("To pay"), align: "right", money: true }, { label: msg("Age"), align: "right", muted: true }],
        rows: open.slice(0, 60).map((o) => [shortNo(o.number), c.s.day(fromDbDate(o.businessDate)), orderPlace(o, c.s), asIs(o.guest?.fullName ?? o.customerName ?? "—"), STATUS_WORD[o.status] ?? o.status, o.total, o.paidAmount, o.total - o.paidAmount, age(o.businessDate) ? P(age(o.businessDate), msg("{n} day"), msg("{n} days")) : msg("today")]),
        foot: open.length ? [msg("Total"), "", "", "", "", sum(open, (o) => o.total), sum(open, (o) => o.paidAmount), unpaid, ""] : undefined, more: Math.max(0, open.length - 60) },
      { kind: "table", title: msg("Guests owing"), subtitle: msg("Staying now, or left without paying in full"), empty: msg("No guest owes the hotel."),
        columns: [{ label: msg("Booking") }, { label: msg("Guest") }, { label: msg("Room") }, { label: msg("Status") }, { label: msg("Bill"), align: "right", money: true, muted: true }, { label: msg("Owes"), align: "right", money: true }],
        rows: guests.slice(0, 60).map((g) => [g.reference, asIs(g.guest.fullName), g.rooms.map((x) => x.room.number).join(", ") || (g.kind === "MEETING" ? msg("Meeting") : "—"), g.status === "CHECKED_IN" ? msg("Staying") : L(msg("Left {date}"), { date: dayMonthW(fromDbDate(g.departureDate)) }), g.netAmount, g.balanceAmount]),
        foot: guests.length ? [msg("Total"), "", "", "", sum(guests, (g) => g.netAmount), sum(guests, (g) => g.balanceAmount)] : undefined, more: Math.max(0, guests.length - 60) },
      { kind: "table", title: msg("Company invoices unpaid"), empty: msg("No company owes the hotel."),
        columns: [{ label: msg("Invoice") }, { label: msg("Company") }, { label: msg("Issued") }, { label: msg("Due") }, { label: msg("Total"), align: "right", money: true, muted: true }, { label: msg("Balance"), align: "right", money: true }],
        rows: invoices.map((i) => [
          i.number, asIs(i.corporateCustomer?.companyName ?? "—"), i.issueDate ? c.s.dayMonth(fromDbDate(i.issueDate)) : "—",
          i.dueDate ? (fromDbDate(i.dueDate) < c.today ? L(msg("{date} · overdue"), { date: dayMonthW(fromDbDate(i.dueDate)) }) : c.s.dayMonth(fromDbDate(i.dueDate))) : "—",
          i.netAmount, i.balanceAmount,
        ]),
        foot: invoices.length ? [msg("Total"), "", "", "", sum(invoices, (i) => i.netAmount), sum(invoices, (i) => i.balanceAmount)] : undefined },
    ],
  };
}

// 7 · Table utilisation
async function tables(r: Range, c: Ctx): Promise<Body> {
  const { L, P } = c.s;
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
  const minutes = (m: number | null) => (m != null ? L(msg("{n} min"), { n: m }) : "—");
  return {
    figures: [
      { label: msg("Table sales"), value: tzs(summary.sales), raw: summary.sales, sub: L(msg("{orders} at tables & the counter"), { orders: count(summary.orders, msg("{n} order"), msg("{n} orders")) }), tone: "gold" },
      { label: msg("Customers seated"), value: num(summary.customers), raw: summary.customers, sub: P(summary.guests, msg("{n} person"), msg("{n} people")) },
      { label: msg("Average bill"), value: summary.avgBill ? tzs(summary.avgBill) : "—", raw: summary.avgBill, sub: msg("per customer") },
      { label: msg("Time at the table"), value: minutes(summary.minutes), raw: summary.minutes ?? 0, sub: msg("average, seated → cleared") },
      { label: msg("Turns per table"), value: turns.toFixed(1), raw: Math.round(turns * 10) / 10, sub: msg("customers per table per day"), tone: "violet" },
      {
        label: msg("Busiest table"), value: busiest && busiest.p.period.customers ? c.s.spot(busiest.p.name.replace(/\s—\s.*/, "")) : "—",
        sub: busiest && busiest.p.period.customers ? L(msg("{area} · {customers}"), { area: word(busiest.p.name.replace(/^.*—\s/, "")), customers: count(busiest.p.period.customers, msg("{n} customer"), msg("{n} customers")) }) : msg("nobody seated yet"), tone: "emerald",
      },
      { label: msg("Discounts given"), value: tzs(totalDiscounts), raw: totalDiscounts, sub: msg("on table and counter bills"), tone: "rose", invert: true },
      { label: msg("Cancelled orders"), value: num(totalCancelled), raw: totalCancelled, sub: msg("at tables and the counter"), tone: "slate", invert: true },
    ],
    blocks: [
      { kind: "bars", title: msg("Sales by table"), money: true, empty: msg("No table sales in this period."),
        items: rows.filter((x) => x.p.period.sales > 0).map((x) => ({ label: c.s.spot(x.p.name), value: x.p.period.sales, color: x.p.area === "INSIDE" ? "#8b5cf6" : x.p.kind === "COUNTER" ? "#f59e0b" : "#0ea5e9", sub: P(x.p.period.customers, msg("{n} customer"), msg("{n} customers")) })) },
      { kind: "bars", title: msg("Busy hours"), subtitle: msg("When customers sit down"), half: true, empty: msg("Nobody seated in this period."),
        items: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([h, n]) => ({ label: `${String(h).padStart(2, "0")}:00`, value: n, color: "#0ea5e9" })) },
      { kind: "table", title: msg("Every table"), subtitle: L(msg("Unused in the period: {n}"), { n: summary.unused }),
        columns: [{ label: msg("Table") }, { label: msg("Customers"), align: "right" }, { label: msg("People"), align: "right" }, { label: msg("Orders"), align: "right", muted: true }, { label: msg("Sales"), align: "right", money: true }, { label: msg("Collected"), align: "right", money: true }, { label: msg("Discounts"), align: "right", money: true }, { label: msg("Cancelled"), align: "right", muted: true }, { label: msg("Average bill"), align: "right", money: true }, { label: msg("Average time"), align: "right" }, { label: msg("Hours used"), align: "right", muted: true }, { label: msg("Turns / day"), align: "right" }, { label: msg("Share"), align: "right", muted: true }],
        rows: rows.map((x) => [c.s.spot(x.p.name), x.p.period.customers, x.p.period.guests, x.p.period.orders, x.p.period.sales, ex(x.p.id).paid, ex(x.p.id).discounts, ex(x.p.id).cancelled, x.p.period.customers ? Math.round(x.p.period.sales / x.p.period.customers) : 0, minutes(x.p.period.minutes), x.hours ? x.hours.toFixed(1) : "—", x.turns ? x.turns.toFixed(1) : "—", `${pct(x.p.period.sales, summary.sales)}%`]),
        foot: [msg("Total"), summary.customers, summary.guests, summary.orders, summary.sales, [...extra.values()].reduce((t, x) => t + x.paid, 0), totalDiscounts, totalCancelled, summary.avgBill, minutes(summary.minutes), sum(rows, (x) => x.hours).toFixed(1), turns.toFixed(1), "100%"] },
      { kind: "note", text: msg("A customer = one party seated at a table (from scanning the QR or being seated by a waiter) until the table is cleared. Turns per day = customers ÷ days in the period. The counter serves orders without seating, so it shows orders only.") },
    ],
  };
}

// 8 · Rooms & bookings
async function rooms(r: Range, c: Ctx): Promise<Body> {
  const { L, P } = c.s;
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
      kind: "columns", title: msg("Occupancy by day"), subtitle: msg("Rooms sold each night (guest rooms)"), empty: msg("No nights."),
      points: groupPoints(occ.series, (xs) => [{ name: msg("Nights sold"), value: sum(xs, (x) => x.roomNights), color: DEPT.rooms.color }, { name: msg("Short time"), value: sum(xs, (x) => x.dayUse), color: "#c4b5fd" }]),
    });
  }
  blocks.push(
    { kind: "table", title: msg("Room types"), columns: [{ label: msg("Room type") }, { label: msg("Rooms sold"), align: "right" }, { label: msg("Nights"), align: "right" }, { label: msg("Gross"), align: "right", money: true, muted: true }, { label: msg("Discounts"), align: "right", money: true, muted: true }, { label: msg("Net"), align: "right", money: true }, { label: msg("Average rate"), align: "right", money: true }],
      rows: rev.byType.map((t) => [t.name, t.roomsSold, t.roomNights, t.gross, t.discount, t.net, t.averageRate || null]),
      foot: [msg("Total"), occ.roomsSold, occ.roomNights, rev.rooms.gross, rev.rooms.discount, rev.rooms.net, adr || null] },
    { kind: "table", title: msg("Where bookings come from"), subtitle: msg("Bookings made in the period · room nights earned"), half: true, empty: msg("No bookings in this period."),
      columns: [{ label: msg("Source") }, { label: msg("Bookings"), align: "right" }, { label: msg("Cancelled / no-show"), align: "right", muted: true }, { label: msg("Nights"), align: "right" }, { label: msg("Room income"), align: "right", money: true }],
      rows: sourceRows },
    { kind: "highlights", title: msg("Guests and bookings"), items: [
      { label: msg("Check-ins"), value: num(moves.checkIns) }, { label: msg("Check-outs"), value: num(moves.checkOuts) },
      { label: msg("New bookings"), value: num(moves.newBookings) }, { label: msg("Cancellations"), value: num(moves.cancellations), sub: P(moves.noShows, msg("{n} no-show"), msg("{n} no-shows")) },
      { label: msg("In house now"), value: num(moves.inHouse), sub: msg("guest bookings") },
      {
        label: msg("Average stay"), value: patterns.stays ? L(msg("{n} nights"), { n: patterns.averageNights.toFixed(1) }) : "—",
        sub: patterns.stays ? L(msg("booked {days} days ahead · {guests} guests"), { days: patterns.averageLeadDays.toFixed(0), guests: patterns.averageGuests.toFixed(1) }) : undefined,
      },
    ] },
    { kind: "columns", title: msg("On the books — the next 14 nights"),
      subtitle: L(msg("Rooms already booked, of {rooms} · next 30 nights: {nights}, {amount}"), { rooms: books.activeRooms, nights: count(books.next30.nights, msg("{n} night"), msg("{n} nights")), amount: tzs(books.next30.amount) }),
      points: books.series.map((d) => ({ label: dayMonth(d.date).split(" ")[0], parts: [{ name: msg("Rooms booked"), value: d.rooms, color: DEPT.rooms.color }] })) },
  );
  if (meeting.rooms > 0) {
    blocks.push({ kind: "highlights", title: msg("Meeting room"), items: [
      { label: msg("Used"), value: `${meeting.utilisation.toFixed(0)}%`, sub: L(msg("{booked} of {open} open hours"), { booked: meeting.bookedHours, open: meeting.openHours }) },
      { label: msg("Bookings"), value: num(meeting.bookings), sub: L(msg("{n} completed"), { n: meeting.completed }) },
      { label: msg("Cancelled"), value: num(meeting.cancelled), sub: L(msg("{n} no-shows"), { n: meeting.noShows }) },
      { label: msg("Income"), value: tzs(meeting.revenue) },
    ] });
  }
  return {
    figures: [
      { label: msg("Occupancy"), value: `${occ.occupancy.toFixed(1)}%`, raw: Math.round(occ.occupancy * 10) / 10, delta: occPrev.sellableNights ? occ.occupancy - occPrev.occupancy : null, sub: L(msg("{nights} of {total}"), { nights: count(occ.roomNights, msg("{n} night"), msg("{n} nights")), total: num(occ.sellableNights) }), tone: "violet" },
      { label: msg("Room income (net)"), value: tzs(rev.rooms.net), raw: rev.rooms.net, sub: rev.rooms.discount ? L(msg("after {amount} discounts"), { amount: tzs(rev.rooms.discount) }) : msg("no discounts"), tone: "gold" },
      { label: msg("Rooms sold"), value: num(occ.roomsSold), raw: occ.roomsSold, sub: L(msg("{nights} nights · {short} short time"), { nights: num(occ.roomNights), short: num(occ.dayUse) }) },
      { label: msg("Average room rate"), value: adr ? tzs(adr) : "—", raw: adr, sub: msg("income ÷ rooms sold") },
      { label: msg("Income per room"), value: revpar ? tzs(revpar) : "—", raw: revpar, sub: msg("income ÷ rooms available") },
      { label: msg("Check-ins · outs"), value: `${num(moves.checkIns)} · ${num(moves.checkOuts)}`, sub: P(moves.newBookings, msg("{n} new booking"), msg("{n} new bookings")) },
    ],
    blocks,
  };
}

// 9 · Staff activity
async function staff(r: Range, c: Ctx): Promise<Body> {
  const { L, asIs } = c.s;
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
      { label: msg("Staff active"), value: num(active.length), raw: active.length, sub: L(msg("of {n} on the team"), { n: people.length }) },
      { label: msg("Actions recorded"), value: num(actions), raw: actions, sub: active.length ? L(msg("{n} per person"), { n: Math.round(actions / active.length) }) : undefined, tone: "violet" },
      { label: msg("Money handled"), value: tzs(money), raw: money, sub: msg("payments & sales recorded"), tone: "emerald" },
      { label: msg("Check-ins · outs"), value: `${num(sum(people, (p) => p.checkIns))} · ${num(sum(people, (p) => p.checkOuts))}` },
      { label: msg("Orders placed"), value: num(sum(people, (p) => p.orders)), raw: sum(people, (p) => p.orders), sub: msg("by staff (not customers' QR)") },
      { label: msg("Most active"), value: top ? asIs(noBrackets(top.name)) : "—", sub: top ? L(msg("{role} · {actions}"), { role: word(top.role), actions: count(top.actions, msg("{n} action"), msg("{n} actions")) }) : undefined, tone: "gold" },
    ],
    blocks: [
      { kind: "bars", title: msg("Work by person"), subtitle: msg("Actions recorded in the system"), empty: msg("Nobody recorded any work in this period."),
        items: active.slice(0, 12).map((p) => ({ label: asIs(noBrackets(p.name)), value: p.actions, color: colors[p.department] ?? "#64748b", sub: p.usualStart ? L(msg("{role} · starts ~{time}"), { role: word(p.role), time: p.usualStart }) : p.role })) },
      { kind: "table", title: msg("Everyone on the team"), subtitle: msg("Usual start = the typical time of their first action on the days they worked"),
        columns: [{ label: msg("Name") }, { label: msg("Role") }, { label: msg("Days"), align: "right" }, { label: msg("Usual start"), align: "right" }, { label: msg("Shifts"), align: "right", muted: true }, { label: msg("Actions"), align: "right" }, { label: msg("Check-ins"), align: "right", muted: true }, { label: msg("Check-outs"), align: "right", muted: true }, { label: msg("Bookings"), align: "right", muted: true }, { label: msg("Orders"), align: "right", muted: true }, { label: msg("Money handled"), align: "right", money: true }],
        rows: people.map((p) => [asIs(noBrackets(p.name)), p.role, `${p.daysActive}/${c.days}`, p.usualStart ?? "—", shifts.find((s) => s.userId === p.id)?._count ?? 0, p.actions, p.checkIns, p.checkOuts, p.bookings, p.orders, p.money]),
        foot: [msg("Total"), "", "", "", sum(shifts, (s) => s._count), actions, sum(people, (p) => p.checkIns), sum(people, (p) => p.checkOuts), sum(people, (p) => p.bookings), sum(people, (p) => p.orders), money] },
      { kind: "note", text: msg("For visibility and fairness, not punishment: actions are what each person recorded in the system (bookings, payments, orders, check-ins…). Finance → Staff shows each person day by day.") },
    ],
  };
}

// 10 · Cancellations & voids
async function voids(r: Range, c: Ctx): Promise<Body> {
  const { L, P, asIs } = c.s;
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
    return { at: x.createdAt, order: x.entityId ? shortNo(orderNo.get(x.entityId) ?? "") : "—", item: b.item?.replace(/ @ \d+$/, "") ?? msg("Item"), n: a.removed ?? 1, amount: a.amount ?? 0, reason: a.reason ?? "—", by: x.user?.fullName ?? x.actorLabel ?? "—" };
  });
  const cancelled = bookings.filter((b) => b.status === "CANCELLED"), noShows = bookings.filter((b) => b.status === "NO_SHOW");
  const reversed = sum(pays, (p) => p.amount) + sum(orderPays, (p) => p.amount);
  const none = msg("None — nothing to worry about.");
  return {
    figures: [
      { label: msg("Cancelled orders"), value: num(orders.length), raw: orders.length, sub: tzs(sum(orders, (o) => o.total)), invert: true, tone: orders.length ? "rose" : undefined },
      { label: msg("Items removed from orders"), value: num(sum(removedRows, (x) => x.n)), raw: sum(removedRows, (x) => x.n), sub: tzs(sum(removedRows, (x) => x.amount)), tone: removedRows.length ? "amber" : undefined },
      { label: msg("Voided sales"), value: tzs(sum(sales, (s) => s.amount)), raw: sum(sales, (s) => s.amount), sub: P(sales.length, msg("{n} sale"), msg("{n} sales")), tone: sales.length ? "rose" : undefined },
      { label: msg("Reversed payments"), value: tzs(reversed), raw: reversed, sub: P(pays.length + orderPays.length, msg("{n} payment"), msg("{n} payments")), tone: reversed ? "rose" : undefined },
      { label: msg("Cancelled bookings"), value: num(cancelled.length), raw: cancelled.length, sub: tzs(sum(cancelled, (b) => b.netAmount)), tone: cancelled.length ? "amber" : undefined },
      { label: msg("No-shows"), value: num(noShows.length), raw: noShows.length, sub: tzs(sum(noShows, (b) => b.netAmount)), tone: noShows.length ? "amber" : undefined },
    ],
    blocks: [
      { kind: "table", title: msg("Cancelled restaurant orders"), empty: none,
        columns: [{ label: msg("Order") }, { label: msg("Placed") }, { label: msg("Where") }, { label: msg("Customer") }, { label: msg("Reason") }, { label: msg("By"), muted: true }, { label: msg("Value"), align: "right", money: true }],
        rows: orders.map((o) => [shortNo(o.number), c.s.when(o.createdAt), orderPlace(o, c.s), asIs(o.customerName ?? "—"), asIs(o.cancelReason ?? "—"), o.cancelledBy ? asIs(noBrackets(o.cancelledBy.fullName)) : "—", o.total]),
        foot: orders.length ? [msg("Total"), "", "", "", "", "", sum(orders, (o) => o.total)] : undefined },
      { kind: "table", title: msg("Items removed from orders"), subtitle: msg("After the order was placed"), empty: none,
        columns: [{ label: msg("When") }, { label: msg("Order") }, { label: msg("Item") }, { label: msg("Qty"), align: "right" }, { label: msg("Reason") }, { label: msg("By"), muted: true }, { label: msg("Value"), align: "right", money: true }],
        rows: removedRows.map((x) => [c.s.when(x.at), x.order, x.item, x.n, asIs(x.reason), asIs(noBrackets(x.by)), x.amount]),
        foot: removedRows.length ? [msg("Total"), "", "", sum(removedRows, (x) => x.n), "", "", sum(removedRows, (x) => x.amount)] : undefined },
      { kind: "table", title: msg("Voided sales"), empty: none, half: true,
        columns: [{ label: msg("When") }, { label: msg("Sale") }, { label: msg("Reason") }, { label: msg("Recorded by"), muted: true }, { label: msg("Amount"), align: "right", money: true }],
        rows: sales.map((s) => [c.s.when(s.occurredAt), s.description ? asIs(s.description) : s.category.name, asIs(s.voidReason ?? "—"), asIs(noBrackets(s.recordedBy.fullName)), s.amount]) },
      { kind: "table", title: msg("Reversed payments"), empty: none, half: true,
        columns: [{ label: msg("When") }, { label: msg("For") }, { label: msg("Method") }, { label: msg("Reason") }, { label: msg("By"), muted: true }, { label: msg("Amount"), align: "right", money: true }],
        rows: [
          ...pays.map((p) => [c.s.when(p.reversedAt ?? p.receivedAt), p.reservation ? `${p.reservation.guest.fullName} · ${p.reservation.reference}` : p.kind === "REFUND" ? msg("Refund") : msg("Payment"), p.method.name, asIs(p.reversalReason ?? "—"), p.reversedBy ? asIs(noBrackets(p.reversedBy.fullName)) : "—", p.amount] as Cell[]),
          ...orderPays.map((p) => [c.s.when(p.reversedAt!), L(msg("Order {no}"), { no: shortNo(p.order.number) }), p.paymentMethod.name, asIs(p.reverseReason ?? "—"), p.reversedBy ? asIs(noBrackets(p.reversedBy.fullName)) : "—", p.amount] as Cell[]),
        ] },
      { kind: "table", title: msg("Cancelled bookings and no-shows"), empty: none,
        columns: [{ label: msg("Booking") }, { label: msg("Guest") }, { label: msg("Arrival") }, { label: msg("Source"), muted: true }, { label: msg("What") }, { label: msg("Reason") }, { label: msg("Value"), align: "right", money: true }],
        rows: bookings.map((b) => [b.reference, asIs(b.guest.fullName), c.s.dayMonth(fromDbDate(b.arrivalDate)), b.source.name, b.status === "NO_SHOW" ? msg("No-show") : msg("Cancelled"), asIs(b.cancelReason ?? "—"), b.netAmount]) },
      { kind: "table", title: msg("Voided room charges and expenses"), empty: none,
        columns: [{ label: msg("What") }, { label: msg("For") }, { label: msg("Reason") }, { label: msg("Amount"), align: "right", money: true }],
        rows: [
          ...charges.map((x) => [x.description, `${x.reservation.guest.fullName} · ${x.reservation.reference}`, asIs(x.voidReason ?? "—"), x.amount] as Cell[]),
          ...spent.map((x) => [x.number ? L(msg("Expense {number}"), { number: x.number }) : msg("Expense"), L(msg("{category} · {description}"), { category: word(x.category.name), description: x.description }), asIs(x.voidReason ?? "—"), x.amount] as Cell[]),
        ] },
    ],
  };
}

// 11 · Expenses
async function expenses(r: Range, c: Ctx): Promise<Body> {
  const { L, say, asIs } = c.s;
  const [ex, exPrev, list] = await Promise.all([
    expenseSummary(r), expenseSummary(c.prev),
    db.expense.findMany({ where: { businessDate: dbr(r), status: { not: "VOIDED" } }, orderBy: { spentAt: "desc" },
      select: { number: true, amount: true, spentAt: true, description: true, payee: true, status: true, category: { select: { name: true } }, paymentMethod: { select: { name: true } }, createdBy: { select: { fullName: true } } } }),
  ]);
  const palette = ["#f43f5e", "#f59e0b", "#8b5cf6", "#0ea5e9", "#10b981", "#64748b", "#c9a24a", "#ec4899"];
  const STATUS: Record<string, string> = { RECORDED: msg("Recorded"), PENDING_APPROVAL: msg("Waiting approval"), APPROVED: msg("Approved"), REJECTED: msg("Rejected"), CORRECTION_REQUESTED: msg("To correct") };
  const top = ex.byCategory[0];
  return {
    figures: [
      { label: msg("Spent"), value: tzs(ex.total), raw: ex.total, delta: change(ex.total, exPrev.total), invert: true, tone: "rose" },
      { label: msg("Expenses"), value: num(ex.count), raw: ex.count, sub: ex.count ? L(msg("average {amount}"), { amount: tzs(Math.round(ex.total / ex.count)) }) : undefined },
      { label: msg("Per day"), value: tzs(Math.round(ex.total / c.days)), raw: Math.round(ex.total / c.days), sub: say(word(c.days === 1 ? msg("{n} day") : msg("{n} days"), { n: c.days })) },
      { label: msg("Biggest category"), value: top?.name ?? "—", sub: top ? `${tzs(top.amount)} · ${pct(top.amount, ex.total)}%` : undefined, tone: "amber" },
      { label: msg("Biggest single expense"), value: ex.highValue[0] ? tzs(ex.highValue[0].amount) : "—", sub: ex.highValue[0] ? asIs(ex.highValue[0].description) : undefined },
      { label: msg("Waiting for approval"), value: tzs(ex.pending.amount), raw: ex.pending.amount, sub: L(msg("{expenses} (any date)"), { expenses: count(ex.pending.count, msg("{n} expense"), msg("{n} expenses")) }), tone: ex.pending.count ? "amber" : undefined },
    ],
    blocks: [
      { kind: "bars", title: msg("By category"), money: true, empty: msg("No expenses in this period."),
        items: ex.byCategory.map((x, i) => ({ label: x.name, value: x.amount, color: palette[i % palette.length], sub: `${pct(x.amount, ex.total)}%` })) },
      { kind: "table", title: msg("Every expense"), subtitle: msg("Newest first · rejected and waiting ones are listed but not counted"), empty: msg("No expenses in this period."),
        columns: [{ label: msg("When") }, { label: msg("No."), muted: true }, { label: msg("Category") }, { label: msg("What") }, { label: msg("Paid to"), muted: true }, { label: msg("Method"), muted: true }, { label: msg("By"), muted: true }, { label: msg("Status") }, { label: msg("Amount"), align: "right", money: true }],
        rows: list.slice(0, 120).map((x) => [c.s.when(x.spentAt), x.number ?? "—", x.category.name, asIs(x.description), asIs(x.payee ?? "—"), x.paymentMethod?.name ?? "—", asIs(noBrackets(x.createdBy.fullName)), STATUS[x.status] ?? x.status, x.amount]),
        foot: list.length ? [msg("Counted total"), "", "", "", "", "", "", "", ex.total] : undefined, more: Math.max(0, list.length - 120) },
    ],
  };
}

/** Stock, waste & assets: what came in and went out of the stores, by department and item; waste; counts; what to buy; assets. */
async function stores(r: Range, c: Ctx): Promise<Body> {
  const { L, say } = c.s;
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
    { label: msg("Stock received"), value: formatTZS(received), raw: received, tone: "emerald", sub: L(msg("{n} deliveries"), { n: moves.filter((m) => m.kind === "RECEIVE").length }) },
    { label: msg("Stock used"), value: formatTZS(used), raw: used, tone: "amber", sub: sold ? L(msg("{amount} by dishes sold"), { amount: formatTZS(sold) }) : msg("by the departments") },
    { label: msg("Waste"), value: formatTZS(waste), raw: waste, tone: "rose", invert: true, sub: say(word(wasteRows.length === 1 ? msg("{n} record") : msg("{n} records"), { n: wasteRows.length })) },
    { label: msg("Count corrections"), value: `${counted < 0 ? "−" : ""}${formatTZS(Math.abs(counted))}`, raw: counted, tone: "slate", sub: msg("counted vs system") },
    { label: msg("Stock value now"), value: formatTZS(stock), raw: stock, tone: "gold", sub: msg("at the last price paid") },
    { label: msg("To buy"), value: `${alerts.out.length + alerts.low.length}`, raw: alerts.out.length + alerts.low.length, tone: alerts.out.length ? "rose" : "sky", sub: L(msg("{out} out · {low} low"), { out: alerts.out.length, low: alerts.low.length }) },
    { label: msg("Assets"), value: `${assets.units}`, raw: assets.units, tone: "violet", sub: L(msg("{records} records · {moved} moved"), { records: assets.records, moved: assets.moved }) },
    { label: msg("Equipment in repair"), value: `${assets.underRepair + assets.outOfOrder}`, raw: assets.underRepair + assets.outOfOrder, tone: assets.outOfOrder ? "rose" : "slate", invert: true, sub: L(msg("{n} out of order"), { n: assets.outOfOrder }) },
  ];
  const assetLine = (a: (typeof assets.needsAttention)[number]) => {
    const status = word(ASSET_STATE[a.status] ?? a.status.toLowerCase().replace(/_/g, " "));
    return a.location
      ? L(msg("{name} ({code}) — {location} · {status}"), { name: a.name, code: a.code, location: a.location, status })
      : L(msg("{name} ({code}) · {status}"), { name: a.name, code: a.code, status });
  };
  const blocks: Block[] = [
    { kind: "bars", title: msg("Used by department"), subtitle: msg("Value taken out (work and dishes sold)"), money: true, half: true, empty: msg("Nothing used."), items: [...dept.entries()].filter(([, x]) => x.out).sort((a, b) => b[1].out - a[1].out).map(([k, x]) => ({ label: k, value: x.out, sub: x.waste ? L(msg("waste {amount}"), { amount: formatTZS(x.waste) }) : undefined })) },
    { kind: "bars", title: msg("Received by department"), subtitle: msg("Value of deliveries"), money: true, half: true, empty: msg("No deliveries."), items: [...dept.entries()].filter(([, x]) => x.in).sort((a, b) => b[1].in - a[1].in).map(([k, x]) => ({ label: k, value: x.in })) },
    {
      kind: "table", title: msg("Stock movement by item"), subtitle: msg("In, out and wasted in each item's own unit"), empty: msg("Nothing moved in this period."),
      columns: [{ label: msg("Item") }, { label: msg("Department"), muted: true }, { label: msg("Received"), align: "right" }, { label: msg("Used"), align: "right" }, { label: msg("Wasted"), align: "right" }, { label: msg("Used value"), align: "right", money: true }],
      rows: [...byItem.values()].sort((a, b) => b.outV - a.outV).map((x) => [x.name, x.dept, x.inQ ? c.s.qty(x.inQ, x.unit) : "—", x.outQ ? c.s.qty(x.outQ, x.unit) : "—", x.wasteQ ? c.s.qty(x.wasteQ, x.unit) : "—", x.outV] as Cell[]),
    },
    { kind: "bars", title: msg("Waste by reason"), money: true, half: true, empty: msg("No waste — well done."), items: [...wasteBy.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, color: "#f43f5e" })) },
    {
      kind: "list", title: msg("Stock to buy now"), tone: "attention",
      items: [
        ...alerts.out.map((i) => L(msg("Out of stock: {item} ({department})"), { item: i.name, department: word(i.department.name) })),
        ...alerts.low.map((i) => L(msg("Low: {item} {qty} — minimum {min}"), { item: i.name, qty: qtyW(i.quantity, i.unit), min: qtyW(i.minStock ?? 0, i.unit) })),
      ].slice(0, 20),
    },
    ...(assets.needsAttention.length ? [{ kind: "list" as const, title: msg("Equipment needing attention"), tone: "attention" as const, items: assets.needsAttention.map(assetLine) }] : []),
    {
      kind: "note",
      text: L(msg("Kinds of movement: {kinds}. Values use the price paid at the time. Waste only counts once a manager approved it."), { kinds: listOf(Object.values(KIND_LABEL as Record<MovementKind, string>)) }),
    },
  ];
  return { figures, blocks };
}
