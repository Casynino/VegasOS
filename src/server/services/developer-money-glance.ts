import "server-only";
import { db } from "../db";
import { addDays, businessRangeBounds, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { msg } from "@/i18n/msg";
import { assertConsoleAccess, safe, type ConsoleUser } from "./developer-console";
import { consoleFrame, TABLE_DAYS } from "./developer-frame";

/**
 * THE MONEY PART OF THE DEVELOPER HOME (owner, 2026-10-18), for awareness: "Bills, payments and the money book. Finance's work, not yours."
 * COUNTS ONLY. The Developer sees how many bills, payments and money-book lines there are and how they move from day to day, never
 * an amount, a balance, an account number, who paid, a payment's reference or a single payment line. (The old Money part that showed
 * amounts was taken out: the Boss's own reports are where the money is read.)
 *
 * What each figure counts:
 *  - bills: every invoice, by the status it is stored with (the same status the Boss's daily report reads);
 *  - payments: payments of money received (kind PAYMENT, status POSTED) on their hotel day. Refunds, cancelled payments and the
 *    restaurant's on-the-spot sales are different things and are not counted here;
 *  - money-book lines: the ledger entries (transfers, the owner putting money in or taking it out, other income, adjustments),
 *    cancelled ones included, on the hotel day they belong to;
 *  - corrections: a payment cancelled (reversed), a payment's method or account corrected, a ledger line reversed — each counted on the
 *    day it was done. Nothing is ever edited in the book: a mistake is answered by one of these.
 *  - waiting for a person: online (nTZS) payments that came in and could not be matched by themselves (the same condition as
 *    online-payments-admin's "attention").
 *
 * Hotel days run 04:00 → 04:00 (consoleFrame), never from midnight UTC. Every query is bounded by a window or is one count, and each is
 * wrapped in safe(): one that fails leaves that figure null while the rest still draws.
 */

/** The money book and the corrections are looked at this many hotel days back. */
export const LEDGER_DAYS = 30;
/** "How people pay" looks this many hotel days back. */
export const METHOD_DAYS = 30;

/** The bill statuses in plain words (the stored statuses, in the order the page lists them). */
export const INVOICE_STATUS_WORDS: Record<InvoiceStatus, string> = {
  DRAFT: msg("Draft"), ISSUED: msg("Unpaid"), PARTIALLY_PAID: msg("Partly paid"), OVERDUE: msg("Overdue"), PAID: msg("Paid"), CANCELLED: msg("Cancelled"), VOID: msg("Void"),
};
export const INVOICE_STATUS_ORDER: readonly InvoiceStatus[] = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "OVERDUE", "PAID", "CANCELLED", "VOID"];

export interface MoneyGlance {
  today: BusinessDate;
  /** The last 14 hotel days, oldest first, ending today (the two charts' columns). */
  days: BusinessDate[];
  /** When a hotel day starts, as "04:00". */
  dayStart: string;
  /** Every bill ever made, and how many are paid in full. */
  bills: { total: number; paid: number } | null;
  /** The bills in each state (a state with none is listed with 0, in the page's order). */
  billsByStatus: { status: InvoiceStatus; count: number }[] | null;
  /** Payments received over the last 7 hotel days (the sum of the last seven columns of `paymentsPerDay`). */
  payments7d: number | null;
  paymentsPerDay: { date: BusinessDate; count: number }[] | null;
  /** Money-book lines over the last 30 hotel days. */
  ledger30d: number | null;
  ledgerPerDay: { date: BusinessDate; count: number }[] | null;
  /** Corrections over the last 30 hotel days (cancelled payments + corrected payments + reversed ledger lines). */
  corrections30d: number | null;
  /** When the newest ledger line / payment was written (`at` is null when there is none yet). */
  lastLedger: { at: Date | null } | null;
  lastPayment: { at: Date | null } | null;
  /** Online (nTZS) payments that need a person (any age). */
  onlineWaiting: number | null;
  /** Payments by the hotel's own payment methods over the last 30 hotel days, most used first (a method nobody used is left out). */
  byMethod: { id: string; name: string; count: number }[] | null;
}

/** One count per hotel day for every day of the window (a day with none is 0). */
const perDay = (days: BusinessDate[], rows: { businessDate: Date; _count: number }[]): { date: BusinessDate; count: number }[] => {
  const by = new Map<BusinessDate, number>();
  for (const r of rows) by.set(fromDbDate(r.businessDate), (by.get(fromDbDate(r.businessDate)) ?? 0) + r._count);
  return days.map((date) => ({ date, count: by.get(date) ?? 0 }));
};

export async function moneyGlance(user: ConsoleUser, now = new Date()): Promise<MoneyGlance> {
  assertConsoleAccess(user);
  const f = await consoleFrame(now);
  const { today, days } = f;
  const from30 = addDays(today, -(LEDGER_DAYS - 1));
  const range14 = { gte: toDbDate(days[0]), lte: toDbDate(today) };
  const range30 = { gte: toDbDate(from30), lte: toDbDate(today) };
  const rangeMethods = { gte: toDbDate(addDays(today, -(METHOD_DAYS - 1))), lte: toDbDate(today) };
  const since30 = businessRangeBounds(from30, today, f.cfg).start;
  const received = { kind: "PAYMENT", status: "POSTED" } as const;

  const [invoices, payDays, ledgerDays, ledger30, ledgerReversed, payReversed, payCorrected, lastLedger, lastPayment, online, methodCounts, methods] = await Promise.all([
    safe(() => db.invoice.groupBy({ by: ["status"], _count: true })),
    safe(() => db.payment.groupBy({ by: ["businessDate"], where: { ...received, businessDate: range14 }, _count: true })),
    safe(() => db.ledgerEntry.groupBy({ by: ["businessDate"], where: { businessDate: range14 }, _count: true })),
    safe(() => db.ledgerEntry.count({ where: { businessDate: range30 } })),
    safe(() => db.ledgerEntry.count({ where: { status: "REVERSED", reversedAt: { gte: since30 } } })),
    safe(() => db.payment.count({ where: { reversalBusinessDate: range30 } })),
    safe(() => db.paymentCorrection.count({ where: { businessDate: range30 } })),
    safe(async () => ({ at: (await db.ledgerEntry.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true } }))?.createdAt ?? null })),
    safe(async () => ({ at: (await db.payment.findFirst({ where: received, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true } }))?.createdAt ?? null })),
    safe(() => db.mobilePayment.count({ where: { attentionAt: { not: null }, resolvedAt: null } })),
    safe(() => db.payment.groupBy({ by: ["methodId"], where: { ...received, businessDate: rangeMethods }, _count: true })),
    safe(() => db.paymentMethod.findMany({ select: { id: true, name: true } })),
  ]);

  const paymentsPerDay = payDays ? perDay(days, payDays) : null;
  const ledgerPerDay = ledgerDays ? perDay(days, ledgerDays) : null;
  const countOf = (...of: InvoiceStatus[]) => (invoices ?? []).filter((r) => of.includes(r.status)).reduce((n, r) => n + r._count, 0);
  const nameOf = new Map((methods ?? []).map((m) => [m.id, m.name]));

  return {
    today, days, dayStart: f.dayStart,
    bills: invoices ? { total: countOf(...INVOICE_STATUS_ORDER), paid: countOf("PAID") } : null,
    billsByStatus: invoices ? INVOICE_STATUS_ORDER.map((status) => ({ status, count: countOf(status) })) : null,
    payments7d: paymentsPerDay ? paymentsPerDay.slice(-TABLE_DAYS).reduce((n, d) => n + d.count, 0) : null,
    paymentsPerDay,
    ledger30d: ledger30,
    ledgerPerDay,
    corrections30d: ledgerReversed !== null && payReversed !== null && payCorrected !== null ? ledgerReversed + payReversed + payCorrected : null,
    lastLedger,
    lastPayment,
    onlineWaiting: online,
    byMethod: methodCounts && methods
      ? methodCounts.map((m) => ({ id: m.methodId, name: nameOf.get(m.methodId) ?? msg("Other"), count: m._count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      : null,
  };
}
