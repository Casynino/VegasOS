import "server-only";
import { db } from "../db";
import { addDays, diffDays, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { AGE_ORDER, ageBucket, LATE_AFTER_DAYS, lookBack, monthStart, type AgeBucket } from "@/lib/finance-insights";
import { COUNTED_EXPENSE_STATUSES } from "./expenses";
import { dailyMoney } from "./reporting";

/**
 * What Finance reads to look ahead: who owes the hotel and how late they are, how much the hotel has been spending a day, and
 * the last six months. Reading only. The totals agree with the figures elsewhere (the aging adds up to "still owed", the months
 * come from the same day-by-day money as the Home's chart), and a pace is only given when there are enough days of records.
 */

// ───────────────────────── Who owes the hotel, and how late ─────────────────────────

export interface AgingRow { bucket: AgeBucket; count: number; amount: number }

/**
 * Everything still owed to the hotel, by how late it is — the same bills as "Still owed" (guests who are staying or left owing,
 * company invoices, unpaid restaurant orders), so the rows add up to that figure. A guest's bill is due the day they leave, a
 * company invoice on its due date, a restaurant order the day it was taken; what is not late yet is "current".
 */
export async function receivablesAging(today: BusinessDate) {
  const [stays, invoices, orders] = await Promise.all([
    db.reservation.findMany({ where: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, balanceAmount: { gt: 0 } }, select: { status: true, balanceAmount: true, departureDate: true } }),
    db.invoice.findMany({ where: { reservationId: null, balanceAmount: { gt: 0 }, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, select: { balanceAmount: true, dueDate: true } }),
    db.restaurantOrder.findMany({ where: { status: { not: "CANCELLED" }, settlement: { not: "ROOM" }, paidAmount: { lt: db.restaurantOrder.fields.total } }, select: { total: true, paidAmount: true, businessDate: true } }),
  ]);
  const rows = new Map<AgeBucket, AgingRow>(AGE_ORDER.map((b) => [b, { bucket: b, count: 0, amount: 0 }]));
  const put = (lateDays: number, amount: number) => {
    const r = rows.get(ageBucket(lateDays))!;
    r.count += 1; r.amount += amount;
  };
  for (const s of stays) put(s.status === "CHECKED_OUT" ? diffDays(fromDbDate(s.departureDate), today) : 0, s.balanceAmount);
  for (const i of invoices) put(i.dueDate ? diffDays(fromDbDate(i.dueDate), today) : 0, i.balanceAmount);
  for (const o of orders) put(diffDays(fromDbDate(o.businessDate), today), o.total - o.paidAmount);
  const list = AGE_ORDER.map((b) => rows.get(b)!);
  // More than a week late = the two oldest rows (the 1–7 day row is still fresh).
  const late = list.filter((r) => r.bucket === "month" || r.bucket === "older");
  return {
    rows: list,
    total: list.reduce((s, r) => s + r.amount, 0),
    lateOverWeek: { amount: late.reduce((s, r) => s + r.amount, 0), count: late.reduce((s, r) => s + r.count, 0) },
    afterDays: LATE_AFTER_DAYS,
  };
}
export type ReceivablesAging = Awaited<ReturnType<typeof receivablesAging>>;

// ───────────────────────── How fast the money goes ─────────────────────────

/**
 * The hotel's recorded spending per day over the last 30 closed days (never before the live records began, never today — the
 * day is not over). Null when no day has closed yet. `days` is how many days it is based on, so a reader can see how much to trust it.
 */
export async function recentSpend(today: BusinessDate, liveSince: BusinessDate | null, window = 30) {
  const span = lookBack(today, window, liveSince);
  if (!span) return null;
  const a = await db.expense.aggregate({ where: { businessDate: { gte: toDbDate(span.from), lte: toDbDate(span.to) }, status: { in: COUNTED_EXPENSE_STATUSES } }, _sum: { amount: true } });
  const total = a._sum.amount ?? 0;
  return { from: span.from, to: span.to, days: span.days, total, perDay: total / span.days };
}

// ───────────────────────── The last six months ─────────────────────────

export interface MonthRow { key: string; income: number; expenses: number; received: number }

/**
 * Earned, spent and received month by month for the last `months` months (this month so far included), never before the live
 * records began. The same day-by-day money as the Home's chart; "earned" is net of refunds, like the Earned tile, so the month
 * the tile shows is the month the table shows. The daily rows are
 * returned too, so the pattern of the week can be read from them without asking the database again.
 */
export async function monthlyTrend(today: BusinessDate, liveSince: BusinessDate | null, months = 6) {
  let from = monthStart(today, months - 1);
  if (liveSince && liveSince > from) from = liveSince;
  if (from > today) return { months: [] as MonthRow[], daily: [] as { date: BusinessDate; income: number; expenses: number; received: number }[] };
  const [daily, refunds] = await Promise.all([
    dailyMoney({ from, to: today }),
    db.payment.groupBy({ by: ["businessDate"], where: { businessDate: { gte: toDbDate(from), lte: toDbDate(today) }, status: "POSTED", kind: "REFUND" }, _sum: { amount: true } }),
  ]);
  const byMonth = new Map<string, MonthRow>();
  const month = (key: string) => byMonth.get(key) ?? { key, income: 0, expenses: 0, received: 0 };
  for (const d of daily) {
    const m = month(d.date.slice(0, 7));
    m.income += d.income; m.expenses += d.expenses; m.received += d.received;
    byMonth.set(m.key, m);
  }
  // "Earned" is what the tiles call it: the income of the days less the money given back (dailyMoney leaves refunds out).
  for (const r of refunds) {
    const m = month(fromDbDate(r.businessDate).slice(0, 7));
    m.income -= r._sum.amount ?? 0;
    byMonth.set(m.key, m);
  }
  return { months: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)), daily };
}

/** The closed days of the last `weeks` weeks (today is left out — it is not over), for the pattern of the week. */
export function closedDays<T extends { date: BusinessDate }>(daily: T[], today: BusinessDate, weeks = 8): T[] {
  const from = addDays(today, -weeks * 7);
  return daily.filter((d) => d.date >= from && d.date < today);
}
