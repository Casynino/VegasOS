import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings, liveSinceDate } from "../settings";
import { addDays, eachDate, fromDbDate, localParts, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { accountBalances } from "./finance";
import { handoverTotals } from "./cash-handover";
import { inHouseBalances } from "./guest-balances";
import { financeQueue } from "./procurement-desk";
import { purchasingPosition } from "./procurement";
import type { Range } from "./reporting";

/**
 * What Finance's Home reads that the other money pages do not already give: the list of what needs Finance now, the
 * suppliers' side (what is owed, what is late), and how the bookings behave. Reading only. The money figures themselves
 * (earned, received, owed, expenses) come from the shared services — one source for every number, so the Home never
 * disagrees with the Finance desk, the ledger or the daily report.
 */

// ───────────────────────── What needs Finance now ─────────────────────────

export type NeedTone = "rose" | "amber" | "sky" | "slate";
export type NeedGroup = "Purchases" | "Cash" | "Expenses" | "Money owed" | "Online payments" | "Reports" | "Accounts";
export type NeedKind =
  | "authorize" | "verify" | "pay" | "supplierOverdue" | "supplierDisputed"
  | "handoverWaiting" | "handoverReturned" | "cashCount" | "expenses"
  | "companyOverdue" | "guestsOwing" | "departuresOwing" | "online" | "withdrawal"
  | "reportFailed" | "reportMissing" | "accountNegative";

/** One thing waiting for Finance. Words are made on the page, in the reader's language — this is data only. */
export interface FinanceNeed {
  id: string;
  kind: NeedKind;
  tone: NeedTone;
  group: NeedGroup;
  count: number;
  amount: number | null;
  /** Always a page this person can open (the right is checked before an item is made). */
  href: string;
  /** An account's name. */
  name?: string;
}

const OPEN_SUPPLIER_INVOICE = ["RECEIVED", "VERIFIED", "DISPUTED", "PART_PAID"];
const TONE_ORDER: Record<NeedTone, number> = { rose: 0, amber: 1, sky: 2, slate: 3 };

/** The supplier invoices not fully paid: what is owed, what is past due, what is disputed, and who is owed most. */
export async function supplierSnapshot(today: BusinessDate) {
  const open = await db.supplierInvoice.findMany({
    where: { status: { in: OPEN_SUPPLIER_INVOICE } },
    select: { amount: true, paidAmount: true, dueOn: true, status: true, supplierName: true, supplier: { select: { name: true } } },
  });
  const t = toDbDate(today).getTime();
  const owedOf = (i: { amount: number; paidAmount: number }) => i.amount - i.paidAmount;
  const overdue = open.filter((i) => i.dueOn && i.dueOn.getTime() < t);
  const bySupplier = new Map<string, number>();
  for (const i of open) {
    const name = i.supplier?.name ?? i.supplierName ?? "—";
    bySupplier.set(name, (bySupplier.get(name) ?? 0) + owedOf(i));
  }
  return {
    owed: { count: open.length, amount: open.reduce((s, i) => s + owedOf(i), 0) },
    overdue: { count: overdue.length, amount: overdue.reduce((s, i) => s + owedOf(i), 0) },
    disputed: open.filter((i) => i.status === "DISPUTED").length,
    top: [...bySupplier.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
}

/**
 * Everything waiting for Finance, most urgent first (money at risk, then decisions, then things to know). An item is made only
 * for a person who holds the right to open its page and act, so the Home never shows a card that ends in "forbidden".
 */
export async function financeNeeds(today: BusinessDate, perms: ReadonlySet<string>, now = new Date()): Promise<FinanceNeed[]> {
  const has = (...codes: string[]) => codes.some((c) => perms.has(c));
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const yesterday = addDays(today, -1);
  const hour = localParts(now, cfg.timezone).hour;
  const live = liveSinceDate(settings);

  const [queue, suppliers, handovers, cashCounts, expenses, companyOverdue, leftOwing, inHouse, online, withdrawals, lastReport, yesterdayReport, balances] = await Promise.all([
    has("purchases.authorize", "purchases.pay") ? financeQueue() : null,
    has("purchases.pay") ? supplierSnapshot(today) : null,
    has("cash.handover.view", "cash.handover.review") ? handoverTotals(today, today) : null,
    has("finance.view") ? db.cashCount.count({ where: { status: "OPEN" } }) : 0,
    has("expenses.view_all", "expenses.approve") ? db.expense.aggregate({ where: { status: "PENDING_APPROVAL" }, _count: true, _sum: { amount: true } }) : null,
    has("finance.view", "corporate.view") ? db.invoice.aggregate({ where: { reservationId: null, balanceAmount: { gt: 0 }, dueDate: { lt: toDbDate(today) }, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, _count: true, _sum: { balanceAmount: true } }) : null,
    has("finance.view") ? db.reservation.aggregate({ where: { status: "CHECKED_OUT", kind: "STAY", balanceAmount: { gt: 0 } }, _count: true, _sum: { balanceAmount: true } }) : null,
    has("reservations.view") ? inHouseBalances(today) : null,
    has("finance.view") ? db.mobilePayment.count({ where: { attentionAt: { not: null }, resolvedAt: null } }) : 0,
    has("withdrawals.manage") ? db.withdrawal.count({ where: { status: "UNKNOWN" } }) : 0,
    has("reports.view") ? db.dailyReport.findFirst({ orderBy: { businessDate: "desc" }, select: { id: true, generatedAt: true, deliveries: { where: { purpose: "DAILY_REPORT" }, select: { status: true, sentAt: true } } } }) : null,
    has("reports.view") ? db.dailyReport.findUnique({ where: { businessDate: toDbDate(yesterday) }, select: { id: true } }) : null,
    has("ledger.view", "finance.view") ? accountBalances(today) : [],
  ]);

  const out: FinanceNeed[] = [];
  const add = (n: Omit<FinanceNeed, "id" | "amount"> & { amount?: number | null }) => out.push({ ...n, id: n.name ? `${n.kind}:${n.name}` : n.kind, amount: n.amount ?? null });

  // Purchases — decisions that stop the Accountant, and suppliers who are waiting for their money.
  if (queue && has("purchases.authorize") && queue.authorize > 0) add({ kind: "authorize", tone: "amber", group: "Purchases", count: queue.authorize, href: "/staff/procurement?tab=authorize" });
  if (queue && has("purchases.pay") && queue.verify > 0) add({ kind: "verify", tone: "amber", group: "Purchases", count: queue.verify, amount: queue.verifyAmount, href: "/staff/procurement?tab=invoices" });
  if (queue && has("purchases.pay") && queue.pay > 0) add({ kind: "pay", tone: "amber", group: "Purchases", count: queue.pay, amount: queue.payAmount, href: "/staff/procurement?tab=invoices" });
  if (suppliers && suppliers.overdue.count > 0) add({ kind: "supplierOverdue", tone: "rose", group: "Purchases", count: suppliers.overdue.count, amount: suppliers.overdue.amount, href: "/staff/procurement?tab=invoices" });
  if (suppliers && suppliers.disputed > 0) add({ kind: "supplierDisputed", tone: "rose", group: "Purchases", count: suppliers.disputed, href: "/staff/procurement?tab=invoices" });

  // Cash
  if (handovers && handovers.waitingCount > 0) add({ kind: "handoverWaiting", tone: "amber", group: "Cash", count: handovers.waitingCount, amount: handovers.waitingExpected, href: "/staff/accountant/handovers?status=SUBMITTED" });
  if (handovers && handovers.returned > 0) add({ kind: "handoverReturned", tone: "slate", group: "Cash", count: handovers.returned, href: "/staff/accountant/handovers?status=RETURNED" });
  if (cashCounts > 0) add({ kind: "cashCount", tone: "rose", group: "Cash", count: cashCounts, href: "/staff/finance/accounts" });

  // Expenses
  if (expenses && expenses._count > 0) add({ kind: "expenses", tone: "amber", group: "Expenses", count: expenses._count, amount: expenses._sum.amount ?? 0, href: "/staff/expenses?status=PENDING_APPROVAL" });

  // Money owed to the hotel (always "right now", whatever period the page shows)
  if (companyOverdue && companyOverdue._count > 0) add({ kind: "companyOverdue", tone: "rose", group: "Money owed", count: companyOverdue._count, amount: companyOverdue._sum.balanceAmount ?? 0, href: "/staff/finance/receivables" });
  if (leftOwing && leftOwing._count > 0) add({ kind: "guestsOwing", tone: "rose", group: "Money owed", count: leftOwing._count, amount: leftOwing._sum.balanceAmount ?? 0, href: "/staff/finance/receivables" });
  if (inHouse) {
    // A stay a company pays for (all or part) is worked out at check-out: its balance is not the guest's to pay here.
    const leaving = inHouse.owing.filter((r) => r.departure <= today && !r.companyPays);
    if (leaving.length) add({ kind: "departuresOwing", tone: "amber", group: "Money owed", count: leaving.length, amount: leaving.reduce((s, r) => s + r.outstanding, 0), href: "/staff/reservations?view=departures&f=owes" });
  }

  // Online payments and withdrawals
  if (online > 0) add({ kind: "online", tone: "rose", group: "Online payments", count: online, href: "/staff/finance/online?status=attention" });
  if (withdrawals > 0) add({ kind: "withdrawal", tone: "rose", group: "Online payments", count: withdrawals, href: "/staff/finance/withdraw?status=unconfirmed" });

  // Reports: the Boss's daily message that did not go out, and the report that was not made after 07:00.
  if (lastReport && lastReport.deliveries.some((d) => d.status === "FAILED") && !lastReport.deliveries.some((d) => d.status === "SENT" && d.sentAt && d.sentAt >= lastReport.generatedAt)) {
    add({ kind: "reportFailed", tone: "amber", group: "Reports", count: 1, href: `/staff/reports/daily/${lastReport.id}` });
  }
  if (has("reports.view") && settings.reportEnabled && !yesterdayReport && hour >= 8 && hour < 24 && (!live || yesterday >= live)) {
    add({ kind: "reportMissing", tone: "amber", group: "Reports", count: 1, href: "/staff/reports/daily" });
  }

  // An account below zero — the hotel's own records (opening + in − out), worth a look.
  for (const b of balances.filter((x) => x.balance < 0).slice(0, 3)) {
    add({ kind: "accountNegative", tone: "rose", group: "Accounts", count: 1, amount: b.balance, name: b.name, href: `/staff/finance/accounts/${b.id}` });
  }

  return out.map((n, i) => ({ n, i })).sort((a, b) => TONE_ORDER[a.n.tone] - TONE_ORDER[b.n.tone] || a.i - b.i).map((x) => x.n);
}

// ───────────────────────── Purchases ─────────────────────────

/** Asked → approved → ordered → invoiced → paid → still owed (each its own figure, never added up) plus the suppliers' side. */
export async function purchasesPanel(today: BusinessDate) {
  const [position, suppliers] = await Promise.all([purchasingPosition(), supplierSnapshot(today)]);
  return { position, suppliers };
}

// ───────────────────────── Bookings ─────────────────────────

/**
 * How the bookings made in the period behave: how many per day, and — by channel — how many were made and what became of them
 * so far (arrived, cancelled, no-show, still to come). Stays only; the meeting room has its own figures.
 */
export async function bookingActivity(range: Range) {
  const where = { businessDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) }, kind: "STAY" as const };
  const [perDay, bySource, sources] = await Promise.all([
    db.reservation.groupBy({ by: ["businessDate"], where, _count: true }),
    db.reservation.groupBy({ by: ["sourceId", "status"], where, _count: true }),
    db.bookingSource.findMany({ select: { id: true, name: true } }),
  ]);
  const day = new Map(perDay.map((d) => [fromDbDate(d.businessDate), d._count]));
  const series = eachDate(range.from, addDays(range.to, 1)).map((date) => ({ date, value: day.get(date) ?? 0 }));
  const name = new Map(sources.map((s) => [s.id, s.name]));
  const rows = new Map<string, { name: string; made: number; arrived: number; cancelled: number; noShow: number; waiting: number }>();
  for (const g of bySource) {
    const r = rows.get(g.sourceId) ?? { name: name.get(g.sourceId) ?? "—", made: 0, arrived: 0, cancelled: 0, noShow: 0, waiting: 0 };
    r.made += g._count;
    if (g.status === "CHECKED_IN" || g.status === "CHECKED_OUT") r.arrived += g._count;
    else if (g.status === "CANCELLED") r.cancelled += g._count;
    else if (g.status === "NO_SHOW") r.noShow += g._count;
    else r.waiting += g._count;
    rows.set(g.sourceId, r);
  }
  const sourcesOut = [...rows.values()].sort((a, b) => b.made - a.made);
  const made = sourcesOut.reduce((s, r) => s + r.made, 0);
  return { series, sources: sourcesOut, made, cancelled: sourcesOut.reduce((s, r) => s + r.cancelled, 0), noShow: sourcesOut.reduce((s, r) => s + r.noShow, 0) };
}

// ───────────────────────── Discounts ─────────────────────────

/** What was given away in the period: restaurant discounts (room discounts and refunds come with the income figures). */
export async function restaurantDiscounts(range: Range) {
  const a = await db.restaurantOrder.aggregate({
    where: { businessDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) }, discountAmount: { gt: 0 }, status: { not: "CANCELLED" } },
    _count: true, _sum: { discountAmount: true },
  });
  return { count: a._count, amount: a._sum.discountAmount ?? 0 };
}
