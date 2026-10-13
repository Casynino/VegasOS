import { addDays, diffDays, type BusinessDate } from "@/lib/time/business-date";

/**
 * The plain rules behind Finance's analysis pages: how late a bill is, when a supplier invoice falls due, how many days the
 * money in the accounts lasts, and the few sentences worth reading ("what stands out"). Pure — numbers in, numbers out — so every
 * rule can be tested, and nothing here is ever guessed: a rule that has too little to go on says nothing.
 */

// ───────────────────────── How late, how soon ─────────────────────────

export type AgeBucket = "current" | "week" | "month" | "older";
export const AGE_ORDER: AgeBucket[] = ["current", "week", "month", "older"];

/** A bill by how many days it is late (a guest's bill is due the day they leave; an invoice on its due date). Not late yet = current. */
export function ageBucket(lateDays: number): AgeBucket {
  if (lateDays <= 0) return "current";
  if (lateDays <= 7) return "week";
  if (lateDays <= 30) return "month";
  return "older";
}

export type DueBucket = "overdue" | "week" | "month" | "later" | "none";
export const DUE_ORDER: DueBucket[] = ["overdue", "week", "month", "later", "none"];

/** A supplier invoice by the days left until it falls due (negative = past its date, null = no date set). */
export function dueBucket(dueInDays: number | null): DueBucket {
  if (dueInDays === null) return "none";
  if (dueInDays < 0) return "overdue";
  if (dueInDays <= 7) return "week";
  if (dueInDays <= 30) return "month";
  return "later";
}

/** Whole percent of `part` in `whole`; null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** More days than this is "over a year" — a pace worked out from a few small expenses says nothing about so long. */
export const COVER_CAP_DAYS = 365;

/** How many whole days the money lasts at the recent daily spending. Null when nothing was spent (no pace to measure). */
export function coverDays(money: number, perDay: number): number | null {
  if (!(perDay > 0)) return null;
  return Math.max(0, Math.floor(Math.max(0, money) / perDay));
}

// ───────────────────────── Calendar helpers ─────────────────────────

/** The first day of the month `back` months before the one `date` is in. */
export function monthStart(date: BusinessDate, back: number): BusinessDate {
  const [y, m] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** 1 = Monday … 7 = Sunday, for a calendar date. */
export function weekdayOf(date: BusinessDate): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** The average of each day of the week (Monday first) over the days given, and how many such days there were. */
export function weekdayAverages(rows: { date: BusinessDate; value: number }[]): { weekday: number; average: number; days: number }[] {
  const sums = new Map<number, { total: number; days: number }>();
  for (const r of rows) {
    const w = weekdayOf(r.date);
    const s = sums.get(w) ?? { total: 0, days: 0 };
    s.total += r.value; s.days += 1;
    sums.set(w, s);
  }
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const s = sums.get(weekday);
    return { weekday, average: s && s.days ? Math.round(s.total / s.days) : 0, days: s?.days ?? 0 };
  });
}

/** The last `days` hotel days up to (and not including) `today`, never before the day the live records began. */
export function lookBack(today: BusinessDate, days: number, liveSince: BusinessDate | null): { from: BusinessDate; to: BusinessDate; days: number } | null {
  const to = addDays(today, -1);
  let from = addDays(today, -days);
  if (liveSince && liveSince > from) from = liveSince;
  if (from > to) return null;
  return { from, to, days: diffDays(from, to) + 1 };
}

// ───────────────────────── What stands out ─────────────────────────

/** The longest a bill may be late before it is worth a sentence of its own. */
export const LATE_AFTER_DAYS = 7;
/** Below this many days of records a daily pace says nothing: no "days covered". */
export const MIN_DAYS_FOR_PACE = 7;
const BIG_MOVE = { earned: 10, expenses: 15 };
const DISCOUNT_WORRY = 8;
const TOP_CATEGORY_SHARE = 35;
const CASH_HEAVY = 50;

export type InsightTone = "bad" | "warn" | "info" | "good";
export type InsightKind =
  | "noExpenses" | "netUp" | "netDown" | "earnedUp" | "earnedDown" | "expensesUp" | "expensesDown" | "topCategory"
  | "owedLate" | "suppliersOverdue" | "suppliersDue" | "suppliersShort" | "cover" | "discounts" | "cashShare";

/** One sentence worth reading. Only numbers — the words are made on the page, in the reader's language. */
export interface Insight {
  id: string;
  kind: InsightKind;
  tone: InsightTone;
  amount?: number;
  pct?: number;
  n?: number;
  days?: number;
  name?: string;
  money?: number;
  href?: string;
}

export interface InsightFacts {
  earned: number; earnedBefore: number;
  expenses: number; expensesBefore: number;
  /** Every category that had spending in either period. */
  categories: { name: string; now: number; before: number }[];
  /** Money still owed to the hotel; `late` is what is more than a week late (guests who left, invoices past due, old orders). */
  owed: { total: number; late: number; lateCount: number } | null;
  /** What the hotel owes suppliers; null for a reader who does not deal with suppliers. */
  suppliers: { overdue: number; dueWeek: number } | null;
  /** The accounts' books total; null for a reader who may not see the accounts. */
  money: number | null;
  /** Average recorded spending per day over `spendDays` closed days. */
  spendPerDay: number; spendDays: number;
  roomNet: number; roomDiscount: number;
  received: number; cashReceived: number;
}

const TONE_ORDER: Record<InsightTone, number> = { bad: 0, warn: 1, info: 2, good: 3 };
const changePct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

/**
 * The few things worth a reader's time, most serious first. Every rule needs a meaningful base (a previous period with
 * something in it, enough days of records) — with too little to go on it stays silent rather than guess.
 */
export function buildInsights(f: InsightFacts, max = 6): Insight[] {
  const out: Insight[] = [];
  const add = (i: Omit<Insight, "id">) => out.push({ ...i, id: i.kind });

  // The result of the period. "Net" is earned less the expenses recorded — it is not a profit while costs go unrecorded.
  if (f.earned > 0 && f.expenses === 0) add({ kind: "noExpenses", tone: "warn", amount: f.earned });
  else if (f.earned > 0 || f.expenses > 0) {
    const net = f.earned - f.expenses;
    if (net >= 0) add({ kind: "netUp", tone: "good", amount: net, pct: percent(net, f.earned) ?? undefined });
    else add({ kind: "netDown", tone: "bad", amount: -net });
  }

  const earnedMove = changePct(f.earned, f.earnedBefore);
  if (earnedMove !== null && earnedMove >= BIG_MOVE.earned) add({ kind: "earnedUp", tone: "good", pct: Math.round(earnedMove) });
  if (earnedMove !== null && earnedMove <= -BIG_MOVE.earned) add({ kind: "earnedDown", tone: "warn", pct: Math.round(-earnedMove) });

  const spendMove = changePct(f.expenses, f.expensesBefore);
  if (spendMove !== null && spendMove >= BIG_MOVE.expenses) {
    const grew = f.categories.map((c) => ({ ...c, rise: c.now - c.before })).filter((c) => c.rise > 0).sort((a, b) => b.rise - a.rise)[0];
    // "mostly X" only when X really is most of the rise
    const mostly = grew && grew.rise * 2 > f.expenses - f.expensesBefore ? grew : undefined;
    add({ kind: "expensesUp", tone: "warn", pct: Math.round(spendMove), name: mostly?.name, amount: mostly?.rise });
  }
  if (spendMove !== null && spendMove <= -BIG_MOVE.expenses) add({ kind: "expensesDown", tone: "good", pct: Math.round(-spendMove) });

  const biggest = [...f.categories].sort((a, b) => b.now - a.now)[0];
  const share = biggest ? percent(biggest.now, f.expenses) : null;
  if (biggest && share !== null && share >= TOP_CATEGORY_SHARE) add({ kind: "topCategory", tone: "info", name: biggest.name, pct: share });

  // Money owed to the hotel, and money the hotel owes.
  if (f.owed && f.owed.late > 0) add({ kind: "owedLate", tone: "warn", amount: f.owed.late, n: f.owed.lateCount, href: "/staff/finance/receivables" });
  if (f.suppliers) {
    const due = f.suppliers.overdue + f.suppliers.dueWeek;
    if (f.money !== null && due > 0 && f.money < due) add({ kind: "suppliersShort", tone: "bad", amount: due, money: f.money, href: "/staff/procurement?tab=invoices" });
    else if (f.suppliers.overdue > 0) add({ kind: "suppliersOverdue", tone: "bad", amount: f.suppliers.overdue, href: "/staff/procurement?tab=invoices" });
    else if (f.suppliers.dueWeek > 0) add({ kind: "suppliersDue", tone: "info", amount: f.suppliers.dueWeek, href: "/staff/procurement?tab=invoices" });
  }

  // How long the money lasts at the recent pace of recorded spending.
  if (f.money !== null && f.spendDays >= MIN_DAYS_FOR_PACE) {
    const days = coverDays(f.money, f.spendPerDay);
    if (days !== null && days <= COVER_CAP_DAYS) add({ kind: "cover", tone: days < 14 ? "bad" : days < 30 ? "warn" : "info", days, amount: Math.round(f.spendPerDay), n: f.spendDays });
  }

  // Habits worth a look.
  const discountShare = percent(f.roomDiscount, f.roomNet + f.roomDiscount);
  if (discountShare !== null && discountShare >= DISCOUNT_WORRY) add({ kind: "discounts", tone: "warn", pct: discountShare, amount: f.roomDiscount });
  const cashShare = percent(f.cashReceived, f.received);
  if (cashShare !== null && cashShare >= CASH_HEAVY) add({ kind: "cashShare", tone: "info", pct: cashShare, amount: f.cashReceived });

  return out.map((x, i) => ({ x, i })).sort((a, b) => TONE_ORDER[a.x.tone] - TONE_ORDER[b.x.tone] || a.i - b.i).slice(0, max).map((r) => r.x);
}
