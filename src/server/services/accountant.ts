import "server-only";
import { db } from "../db";
import { getSettings, businessDayConfig } from "../settings";
import { businessRangeBounds, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { accountBalances, paymentsByMethod } from "./finance";
import { outstanding, profitLoss, unpaidOrders } from "./reporting";
import { accountSummaries } from "./payment-accounts";
import { handoverTotals, whoHoldsCash } from "./cash-handover";
import { CASH_HANDOVER_ON } from "@/lib/cash-handover";

/** What the handover figures are while the feature is off: nothing waits, nothing is held, nothing was received. */
export const NO_HANDOVERS = { waitingCount: 0, waitingExpected: 0, waitingDeclared: 0, returned: 0, receivedCount: 0, received: 0, receivedExpected: 0, short: 0, over: 0, withDifference: 0 };

/**
 * Finance's dashboard numbers. Four different things are kept apart on purpose and never added together:
 *   EARNED    what the hotel earned (nights, food, drinks, services) — before anyone paid;
 *   RECEIVED  money that really came in (payments + on-the-spot sales − refunds) — and, of that, cash by who took it;
 *   OWED      earned and not paid yet, on any date;
 *   BALANCES  what each account's own records add up to (opening + in − out) — never a bank statement.
 * Cash in a person's hands is a fifth figure: cash recorded by staff and not yet received by Finance.
 * The net result is earned − the expenses recorded in the same period; costs nobody recorded are not in it.
 */
export type OverviewFilter = { accountId?: string | null; staffId?: string | null };

/** Cash taken in a period, by where it came from: the front desk (rooms), the restaurant and other sales. Refunds taken off. */
async function cashBySource(from: BusinessDate, to: BusinessDate, f: OverviewFilter) {
  const cfg = businessDayConfig(await getSettings());
  const bounds = businessRangeBounds(from, to, cfg);
  const bd = { gte: toDbDate(from), lte: toDbDate(to) };
  const cash = { account: { kind: "CASH" as const, ...(f.accountId && { id: f.accountId }) } };
  const [rooms, restaurant, sales] = await Promise.all([
    db.payment.groupBy({ by: ["kind"], where: { businessDate: bd, status: "POSTED", ...(f.staffId && { recordedById: f.staffId }), ...cash }, _sum: { amount: true } }),
    db.restaurantOrderPayment.aggregate({ where: { collectedAt: { gte: bounds.start, lt: bounds.end }, status: "POSTED", ...(f.staffId && { collectedById: f.staffId }), ...cash }, _sum: { amount: true } }),
    // A restaurant payment's own sales are that payment: only sales recorded on their own are other cash.
    db.revenueTransaction.aggregate({ where: { businessDate: bd, orderPaymentId: null, isVoided: false, ...(f.staffId && { recordedById: f.staffId }), ...cash }, _sum: { amount: true } }),
  ]);
  const roomsIn = rooms.filter((r) => r.kind === "PAYMENT").reduce((s, r) => s + (r._sum.amount ?? 0), 0);
  const roomsOut = rooms.filter((r) => r.kind === "REFUND").reduce((s, r) => s + (r._sum.amount ?? 0), 0);
  const out = { rooms: roomsIn - roomsOut, restaurant: restaurant._sum.amount ?? 0, other: sales._sum.amount ?? 0 };
  return { ...out, total: out.rooms + out.restaurant + out.other };
}

export async function accountantOverview(range: { from: BusinessDate; to: BusinessDate }, today: BusinessDate, f: OverviewFilter = {}) {
  const [pl, methods, accounts, balances, owed, unpaid, cash, handovers, holders, pendingExpenses, openCounts, staff] = await Promise.all([
    profitLoss(range),
    paymentsByMethod(range.from, range.to),
    accountSummaries(range.from, range.to),
    accountBalances(today),
    outstanding(),
    unpaidOrders(),
    cashBySource(range.from, range.to, f),
    CASH_HANDOVER_ON ? handoverTotals(range.from, range.to) : Promise.resolve(NO_HANDOVERS),
    CASH_HANDOVER_ON ? whoHoldsCash() : Promise.resolve([] as Awaited<ReturnType<typeof whoHoldsCash>>),
    db.expense.aggregate({ where: { status: "PENDING_APPROVAL" }, _count: true, _sum: { amount: true } }),
    db.cashCount.count({ where: { status: "OPEN" } }),
    // The people who take cash and hand it over (the staff filter)
    db.user.findMany({ where: { isActive: true, role: { permissions: { some: { permission: { code: "cash.handover.submit" } } } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const rev = pl.revenue;
  const shown = f.accountId ? accounts.filter((a) => a.id === f.accountId) : accounts;
  const heldNow = holders.reduce((s, h) => s + h.expected, 0);
  const awaiting = holders.reduce((s, h) => s + h.waitingAmount, 0);
  return {
    earned: {
      rooms: rev.rooms.net, restaurant: rev.restaurant + rev.roomService, bar: rev.bar, meeting: rev.meeting, other: rev.other + rev.transport,
      total: pl.netRevenue, discounts: rev.discounts, refunds: rev.refunds,
    },
    expenses: { total: pl.expenses, pendingCount: pendingExpenses._count, pendingAmount: pendingExpenses._sum.amount ?? 0 },
    /** Earned − the expenses recorded in the period. Not a profit: costs nobody recorded are not in it. */
    netResult: pl.netRevenue - pl.expenses,
    received: { total: methods.total, byMethod: methods.rows.filter((r) => r.amount !== 0), byAccount: shown.filter((a) => a.received !== 0 || a.count > 0).map((a) => ({ id: a.id, name: a.name, kind: a.kind, received: a.received, moneyIn: a.moneyIn, moneyOut: a.moneyOut, count: a.count })) },
    cash,
    owed: { guests: owed.reservations, companies: owed.invoices, meetings: owed.meetings, restaurant: unpaid, total: owed.total + unpaid.amount },
    balances: balances.filter((b) => (f.accountId ? b.id === f.accountId : true)),
    handovers: { ...handovers, heldNow, awaiting },
    holders,
    openCashCounts: openCounts,
    staff,
  };
}
export type AccountantOverview = Awaited<ReturnType<typeof accountantOverview>>;
