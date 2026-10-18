import "server-only";
import { db } from "../db";
import { addDays, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { MoneyAccountKind, WithdrawalStatus } from "@/generated/prisma/enums";
import { msg } from "@/i18n/msg";
import { WITHDRAWAL_IN_FLIGHT, type WithdrawalStatusCode } from "@/lib/withdrawals";
import type { AgeBucket } from "@/lib/finance-insights";
import { assertConsoleAccess, safe, type ConsoleUser } from "./developer-console";
import { consoleFrame, TABLE_DAYS } from "./developer-frame";
import { dailyMoney, expenseSummary } from "./reporting";
import { accountBalances } from "./finance";
import { receivablesAging } from "./finance-outlook";
import { inHouseBalances } from "./guest-balances";
import { leftOwingNow } from "./front-desk";
import { onlinePaymentTotals } from "./online-payments-admin";

/**
 * THE MONEY TAB (owner, 2026-10-18): where the money is, read-only. The Developer never writes money, and this tab only reads.
 * Every figure that exists in the Boss's reports is taken from the same service — money received (reporting.dailyMoney), what guests
 * in the house owe (guest-balances), what guests left owing (the front desk's figure), what is owed by lateness (finance-outlook),
 * the accounts' balances (finance.accountBalances), expenses waiting (reporting.expenseSummary), online payments (online-payments-admin).
 * The split of "received" by how it was paid has no shared service, so it is counted here from the same two ledgers dailyMoney reads
 * (posted payments less refunds, and on-the-spot sales that are not voided); each day's parts are checked against dailyMoney's total.
 *
 * Sale ≠ room income ≠ payment ≠ still owed: the labels on the tab say which of them each figure is. Days are the hotel's days
 * (04:00 → 04:00). No account number, phone number or message text is read.
 */

/** How the money came in, grouped as the Boss reads it. */
export const METHOD_GROUPS = ["cash", "mobile", "bank", "card", "other"] as const;
export type MethodGroup = (typeof METHOD_GROUPS)[number];
export const METHOD_GROUP_WORDS: Record<MethodGroup, string> = { cash: msg("Cash"), mobile: msg("Mobile money"), bank: msg("Bank"), card: msg("Card"), other: msg("Other") };
/** A payment method's code → its group (a method nobody planned for is "other"). */
export const methodGroupOf = (code: string | null | undefined): MethodGroup =>
  code === "CASH" ? "cash" : code === "MOBILE_MONEY" ? "mobile" : code === "BANK" ? "bank" : code === "CARD" ? "card" : "other";

export const MONEY_ROWS = { payments: 15, corrections: 10, withdrawals: 10 } as const;
/** Voids, reversals and corrections are looked for this many hotel days back. */
export const CORRECTION_DAYS = 30;
/** Payments are looked for this many hotel days back. */
export const PAYMENT_DAYS = 30;
/** Failed withdrawals are counted this many days back (pending ones at any age). */
export const WITHDRAWAL_DAYS = 30;

export const CORRECTION_WORDS: Record<string, string> = {
  "payment.reversed": msg("Payment cancelled (reversed)"),
  "payment.method_corrected": msg("Payment method or account corrected"),
  "revenue.voided": msg("Sale cancelled"),
  "revenue.account_corrected": msg("Sale account corrected"),
  "expense.voided": msg("Expense cancelled"),
  "expense.corrected": msg("Expense corrected"),
};

export const ACCOUNT_KIND_WORDS: Record<MoneyAccountKind, string> = {
  CASH: msg("Cash"), BANK: msg("Bank"), MOBILE_MONEY: msg("Mobile money"), CARD: msg("Card"), PETTY_CASH: msg("Petty cash"), OTHER: msg("Other"),
};

export const AGING_WORDS: Record<AgeBucket, string> = {
  current: msg("Not late yet"), week: msg("1–7 days late"), month: msg("8–30 days late"), older: msg("Over 30 days late"),
};

export type MoneyByGroup = Record<MethodGroup, number>;
const zeroGroups = (): MoneyByGroup => ({ cash: 0, mobile: 0, bank: 0, card: 0, other: 0 });

export interface PaymentLine {
  id: string;
  at: Date;
  /** PAYMENT and REFUND come from the payment records; SALE is an on-the-spot sale (restaurant, bar…) paid at once. */
  kind: "PAYMENT" | "REFUND" | "SALE";
  /** The booking's code, the invoice's number, the company, or what the sale was ("Restaurant · ORD-…"). */
  forWhat: string | null;
  method: string;
  /** The hotel account's name — never its number. */
  account: string;
  amount: number;
  by: string;
  /** Cancelled afterwards as a recording mistake (listed, never counted). */
  reversed: boolean;
}

export interface CorrectionLine { id: string; at: Date; what: string; by: string; amount: number | null; reason: string | null }

export interface MoneyData {
  today: BusinessDate;
  dayStart: string;
  days: BusinessDate[];
  /** Money received = payments recorded, minus refunds, plus on-the-spot sales — the Boss's "received" (reporting.dailyMoney). */
  received: { today: number; week: number; byMethodToday: MoneyByGroup; byMethodWeek: MoneyByGroup } | null;
  /**
   * What guests in the house owe right now. `amount` is the balance of each guest's WHOLE booking (all booked nights and extras, less
   * what they paid — what reception collects); `soFar` is the part of it that is for the nights stayed so far (the shifts page's
   * "for the nights so far").
   */
  owedInHouse: { amount: number; soFar: number; guests: number } | null;
  /** What guests who already left still owe. */
  leftOwing: { amount: number; guests: number } | null;
  /** Online (nTZS) payments: waiting for the customer (made in the last 7 days) and needing a person (any time). */
  online: { waiting: number; needPerson: number } | null;
  withdrawals: { pending: number; notConfirmed: number; failed: number } | null;
  expensesWaiting: { count: number; amount: number } | null;
  receivedPerDay: { date: BusinessDate; total: number; byMethod: MoneyByGroup }[] | null;
  incomePerDay: { date: BusinessDate; income: number; received: number }[] | null;
  /** The last 7 days' received money by method, biggest first (parts with nothing left out). */
  methodShare: { group: MethodGroup; amount: number; percent: number }[] | null;
  aging: { rows: { bucket: AgeBucket; count: number; amount: number }[]; total: number } | null;
  payments: PaymentLine[] | null;
  corrections: CorrectionLine[] | null;
  accounts: { id: string; name: string; kind: MoneyAccountKind; balance: number }[] | null;
  withdrawalList: { id: string; number: string | null; at: Date; amount: number; destination: string; status: WithdrawalStatusCode }[] | null;
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function moneyData(user: ConsoleUser, now = new Date()): Promise<MoneyData> {
  assertConsoleAccess(user);
  const f = await consoleFrame(now);
  const { today, days } = f;
  const range = { from: days[0], to: today };
  const dbRange = { gte: toDbDate(days[0]), lte: toDbDate(today) };
  const since = (n: number) => toDbDate(addDays(today, -n));

  const [daily, payByMethod, saleByMethod, methods, inHouse, leftOwing, online, wdPending, wdFailed, expenses, aging, paymentRows, saleRows, auditRows, accounts, withdrawalRows] = await Promise.all([
    safe(() => dailyMoney(range)),
    safe(() => db.payment.groupBy({ by: ["businessDate", "kind", "methodId"], where: { businessDate: dbRange, status: "POSTED" }, _sum: { amount: true } })),
    safe(() => db.revenueTransaction.groupBy({ by: ["businessDate", "paymentMethodId"], where: { businessDate: dbRange, isVoided: false }, _sum: { amount: true } })),
    safe(() => db.paymentMethod.findMany({ select: { id: true, code: true } })),
    safe(() => inHouseBalances(today)),
    safe(() => leftOwingNow()),
    safe(() => onlinePaymentTotals(addDays(today, -(TABLE_DAYS - 1)), today)),
    safe(() => db.withdrawal.groupBy({ by: ["status"], where: { status: { in: WITHDRAWAL_IN_FLIGHT as WithdrawalStatus[] } }, _count: true })),
    safe(() => db.withdrawal.groupBy({ by: ["status"], where: { status: { in: ["FAILED", "REJECTED"] }, createdAt: { gte: new Date(now.getTime() - WITHDRAWAL_DAYS * 24 * 3600_000) } }, _count: true })),
    safe(() => expenseSummary({ from: today, to: today })),
    safe(() => receivablesAging(today)),
    safe(() => db.payment.findMany({
      where: { businessDate: { gte: since(PAYMENT_DAYS) } }, orderBy: [{ businessDate: "desc" }, { receivedAt: "desc" }, { id: "desc" }], take: MONEY_ROWS.payments,
      select: {
        id: true, kind: true, status: true, amount: true, receivedAt: true, method: { select: { name: true } }, account: { select: { name: true } }, recordedBy: { select: { fullName: true } },
        reservation: { select: { reference: true } }, invoice: { select: { number: true } }, corporateCustomer: { select: { companyName: true } },
      },
    })),
    safe(() => db.revenueTransaction.findMany({
      where: { businessDate: { gte: since(PAYMENT_DAYS) }, isVoided: false }, orderBy: [{ businessDate: "desc" }, { occurredAt: "desc" }, { id: "desc" }], take: MONEY_ROWS.payments,
      select: {
        id: true, amount: true, occurredAt: true, category: { select: { name: true } }, paymentMethod: { select: { name: true } }, account: { select: { name: true } },
        recordedBy: { select: { fullName: true } }, restaurantOrder: { select: { number: true } },
      },
    })),
    safe(() => db.auditLog.findMany({
      where: { action: { in: Object.keys(CORRECTION_WORDS) }, businessDate: { gte: since(CORRECTION_DAYS) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MONEY_ROWS.corrections,
      select: { id: true, createdAt: true, action: true, actorLabel: true, before: true, after: true },
    })),
    safe(() => accountBalances()),
    safe(() => db.withdrawal.findMany({
      where: { status: { in: ["SUBMITTING", "UNKNOWN", "PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW", "COMPLETED", "FAILED", "REJECTED"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MONEY_ROWS.withdrawals,
      select: { id: true, number: true, createdAt: true, amount: true, destinationKind: true, status: true },
    })),
  ]);

  // ── received, by how it was paid, per day (each day's parts add up to the Boss's "received" for that day) ──
  let receivedPerDay: MoneyData["receivedPerDay"] = null;
  if (daily && payByMethod && saleByMethod && methods) {
    const groupOf = new Map(methods.map((m) => [m.id, methodGroupOf(m.code)]));
    const perDay = new Map<BusinessDate, MoneyByGroup>(days.map((d) => [d, zeroGroups()]));
    for (const p of payByMethod) {
      const row = perDay.get(fromDbDate(p.businessDate));
      if (row) row[groupOf.get(p.methodId) ?? "other"] += (p.kind === "REFUND" ? -1 : 1) * (p._sum.amount ?? 0);
    }
    for (const s of saleByMethod) {
      const row = perDay.get(fromDbDate(s.businessDate));
      if (row) row[groupOf.get(s.paymentMethodId) ?? "other"] += s._sum.amount ?? 0;
    }
    receivedPerDay = daily.map((d) => {
      const byMethod = perDay.get(d.date) ?? zeroGroups();
      // The Boss's figure is the total; anything the two ledgers do not account for by method is shown as "Other", never hidden.
      byMethod.other += d.received - METHOD_GROUPS.reduce((n, g) => n + byMethod[g], 0);
      return { date: d.date, total: d.received, byMethod };
    });
  }
  const sumGroups = (rows: { byMethod: MoneyByGroup }[]) => rows.reduce((acc, r) => { for (const g of METHOD_GROUPS) acc[g] += r.byMethod[g]; return acc; }, zeroGroups());
  const week = receivedPerDay ? receivedPerDay.slice(-TABLE_DAYS) : null;
  const received = receivedPerDay && week
    ? { today: receivedPerDay[receivedPerDay.length - 1].total, week: week.reduce((n, d) => n + d.total, 0), byMethodToday: { ...receivedPerDay[receivedPerDay.length - 1].byMethod }, byMethodWeek: sumGroups(week) }
    : null;
  const weekTotal = received ? METHOD_GROUPS.reduce((n, g) => n + Math.max(0, received.byMethodWeek[g]), 0) : 0;
  const methodShare = received
    ? METHOD_GROUPS.filter((g) => received.byMethodWeek[g] > 0).map((g) => ({ group: g, amount: received.byMethodWeek[g], percent: weekTotal ? Math.round((received.byMethodWeek[g] / weekTotal) * 100) : 0 }))
        .sort((a, b) => b.amount - a.amount)
    : null;

  // ── withdrawals ──
  const wdCount = (rows: { status: WithdrawalStatus; _count: number }[], ...of: WithdrawalStatus[]) => rows.filter((r) => of.includes(r.status)).reduce((n, r) => n + r._count, 0);
  const withdrawals = wdPending && wdFailed
    ? { pending: wdCount(wdPending, "SUBMITTING", "PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW"), notConfirmed: wdCount(wdPending, "UNKNOWN"), failed: wdCount(wdFailed, "FAILED", "REJECTED") }
    : null;

  // ── the last payments (payments, refunds and on-the-spot sales, newest first) ──
  const payments: PaymentLine[] | null = paymentRows && saleRows
    ? [
        ...paymentRows.map((p): PaymentLine => ({
          id: p.id, at: p.receivedAt, kind: p.kind, forWhat: p.reservation?.reference ?? p.invoice?.number ?? p.corporateCustomer?.companyName ?? null,
          method: p.method.name, account: p.account.name, amount: p.amount, by: p.recordedBy.fullName, reversed: p.status === "REVERSED",
        })),
        ...saleRows.map((s): PaymentLine => ({
          id: s.id, at: s.occurredAt, kind: "SALE", forWhat: [s.category.name, s.restaurantOrder?.number].filter(Boolean).join(" · ") || null,
          method: s.paymentMethod.name, account: s.account.name, amount: s.amount, by: s.recordedBy.fullName, reversed: false,
        })),
      ].sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id)).slice(0, MONEY_ROWS.payments)
    : null;

  const corrections = auditRows
    ? auditRows.map((r): CorrectionLine => {
        const before = record(r.before), after = record(r.after);
        const amount = typeof before.amount === "number" ? before.amount : typeof after.amount === "number" ? after.amount : null;
        const reason = typeof after.reason === "string" && after.reason.trim() ? after.reason.trim().slice(0, 120) : null;
        return { id: r.id, at: r.createdAt, what: CORRECTION_WORDS[r.action] ?? r.action, by: r.actorLabel ?? "—", amount, reason };
      })
    : null;

  return {
    today, dayStart: f.dayStart, days,
    received,
    owedInHouse: inHouse ? { amount: inHouse.summary.totalOutstanding, soFar: inHouse.summary.totalOwedSoFar, guests: inHouse.summary.owingCount } : null,
    leftOwing: leftOwing ? { amount: leftOwing.amount, guests: leftOwing.count } : null,
    online: online ? { waiting: online.pending, needPerson: online.attention } : null,
    withdrawals,
    expensesWaiting: expenses ? { count: expenses.pending.count, amount: expenses.pending.amount } : null,
    receivedPerDay,
    incomePerDay: daily ? daily.map((d) => ({ date: d.date, income: d.income, received: d.received })) : null,
    methodShare,
    aging: aging ? { rows: aging.rows.map((r) => ({ bucket: r.bucket, count: r.count, amount: r.amount })), total: aging.total } : null,
    payments, corrections,
    accounts: accounts ? accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind as MoneyAccountKind, balance: a.balance })) : null,
    withdrawalList: withdrawalRows
      ? withdrawalRows.map((w) => ({
          id: w.id, number: w.number, at: w.createdAt, amount: w.amount, status: w.status as WithdrawalStatusCode,
          destination: w.destinationKind === "BANK" ? msg("Bank") : w.destinationKind === "PHONE" ? msg("Mobile money") : msg("Other"),
        }))
      : null,
  };
}
