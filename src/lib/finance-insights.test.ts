import { describe, expect, it } from "vitest";
import { ageBucket, buildInsights, coverDays, dueBucket, lookBack, monthStart, percent, weekdayAverages, weekdayOf, type InsightFacts } from "./finance-insights";

const quiet: InsightFacts = {
  earned: 0, earnedBefore: 0, expenses: 0, expensesBefore: 0, categories: [], owed: null, suppliers: null, money: null,
  spendPerDay: 0, spendDays: 0, roomNet: 0, roomDiscount: 0, received: 0, cashReceived: 0,
};
const kinds = (f: Partial<InsightFacts>) => buildInsights({ ...quiet, ...f }).map((i) => i.kind);

describe("how late, how soon", () => {
  it("a bill is current until its day has passed, then late by the week, the month, longer", () => {
    expect([-3, 0, 1, 7, 8, 30, 31].map(ageBucket)).toEqual(["current", "current", "week", "week", "month", "month", "older"]);
  });
  it("a supplier invoice is overdue, due this week, this month, later — or has no date", () => {
    expect([-1, 0, 7, 8, 30, 31, null].map(dueBucket)).toEqual(["overdue", "week", "week", "month", "month", "later", "none"]);
  });
  it("percent and cover days never divide by nothing", () => {
    expect(percent(1, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33);
    expect(coverDays(1_000_000, 0)).toBeNull();
    expect(coverDays(1_000_000, 100_000)).toBe(10);
    expect(coverDays(-5, 100)).toBe(0);
  });
});

describe("the calendar", () => {
  it("counts back whole months across a year end", () => {
    expect(monthStart("2026-10-13", 0)).toBe("2026-10-01");
    expect(monthStart("2026-10-13", 5)).toBe("2026-05-01");
    expect(monthStart("2026-02-03", 5)).toBe("2025-09-01");
    expect(monthStart("2026-01-31", 1)).toBe("2025-12-01");
  });
  it("names the day of the week, Monday first", () => {
    expect([weekdayOf("2026-10-12"), weekdayOf("2026-10-13"), weekdayOf("2026-10-18")]).toEqual([1, 2, 7]);
  });
  it("averages each weekday over the days it was seen — a day never seen is zero, not guessed", () => {
    const rows = [{ date: "2026-10-05", value: 100 }, { date: "2026-10-12", value: 300 }, { date: "2026-10-06", value: 50 }];
    const avg = weekdayAverages(rows);
    expect(avg[0]).toEqual({ weekday: 1, average: 200, days: 2 });
    expect(avg[1]).toEqual({ weekday: 2, average: 50, days: 1 });
    expect(avg[2]).toEqual({ weekday: 3, average: 0, days: 0 });
    expect(avg).toHaveLength(7);
  });
  it("looks back only over closed days and never before the records began", () => {
    expect(lookBack("2026-10-13", 30, null)).toEqual({ from: "2026-09-13", to: "2026-10-12", days: 30 });
    expect(lookBack("2026-10-13", 30, "2026-10-12")).toEqual({ from: "2026-10-12", to: "2026-10-12", days: 1 });
    expect(lookBack("2026-10-13", 30, "2026-10-13")).toBeNull();
  });
});

describe("what stands out", () => {
  it("says nothing when there is nothing to say", () => {
    expect(kinds({})).toEqual([]);
  });

  it("income with no expenses recorded is not called a profit", () => {
    expect(kinds({ earned: 956_000 })).toEqual(["noExpenses"]);
  });

  it("net up or down against the recorded expenses", () => {
    expect(buildInsights({ ...quiet, earned: 1_000_000, expenses: 400_000 })[0]).toMatchObject({ kind: "netUp", tone: "good", amount: 600_000, pct: 60 });
    expect(buildInsights({ ...quiet, earned: 100_000, expenses: 400_000 })[0]).toMatchObject({ kind: "netDown", tone: "bad", amount: 300_000 });
  });

  it("a big change needs a previous period with something in it", () => {
    expect(kinds({ earned: 1_000_000, earnedBefore: 0 })).not.toContain("earnedUp");
    expect(kinds({ earned: 1_050_000, earnedBefore: 1_000_000, expenses: 1, expensesBefore: 1 })).not.toContain("earnedUp"); // 5%: not worth saying
    expect(kinds({ earned: 1_200_000, earnedBefore: 1_000_000, expenses: 1, expensesBefore: 1 })).toContain("earnedUp");
    expect(kinds({ earned: 800_000, earnedBefore: 1_000_000, expenses: 1, expensesBefore: 1 })).toContain("earnedDown");
  });

  it("rising expenses name the category that rose most", () => {
    const i = buildInsights({
      ...quiet, earned: 5_000_000, expenses: 1_200_000, expensesBefore: 1_000_000,
      categories: [{ name: "Utilities", now: 500_000, before: 300_000 }, { name: "Food", now: 400_000, before: 400_000 }, { name: "Repairs", now: 300_000, before: 300_000 }],
    }).find((x) => x.kind === "expensesUp");
    expect(i).toMatchObject({ pct: 20, name: "Utilities", amount: 200_000, tone: "warn" });
    // falling expenses are good news
    expect(kinds({ earned: 1, expenses: 700_000, expensesBefore: 1_000_000 })).toContain("expensesDown");
  });

  it("'mostly' names a category only when it really is most of the rise", () => {
    const base = { ...quiet, earned: 5_000_000, expenses: 1_300_000, expensesBefore: 1_000_000 };
    // three categories rose 100,000 each of a 300,000 rise: none is most of it — the plain sentence, no name
    const spread = buildInsights({ ...base, categories: [{ name: "Utilities", now: 200_000, before: 100_000 }, { name: "Food", now: 500_000, before: 400_000 }, { name: "Repairs", now: 200_000, before: 100_000 }, { name: "Other", now: 400_000, before: 400_000 }] }).find((x) => x.kind === "expensesUp");
    expect(spread).toMatchObject({ kind: "expensesUp", pct: 30 });
    expect(spread?.name).toBe(undefined);
    // utilities rose 250,000 of the 300,000
    const mostly = buildInsights({ ...base, categories: [{ name: "Utilities", now: 350_000, before: 100_000 }, { name: "Food", now: 450_000, before: 400_000 }, { name: "Other", now: 500_000, before: 500_000 }] }).find((x) => x.kind === "expensesUp");
    expect(mostly).toMatchObject({ name: "Utilities", amount: 250_000 });
  });

  it("days the money lasts is not claimed beyond a year", () => {
    expect(kinds({ money: 10_000_000, spendPerDay: 10_000, spendDays: 20 })).not.toContain("cover");   // 1,000 days
    expect(kinds({ money: 3_000_000, spendPerDay: 10_000, spendDays: 20 })).toContain("cover");        // 300 days
  });

  it("a category that is more than a third of the spending is named", () => {
    expect(kinds({ earned: 1, expenses: 1_000_000, categories: [{ name: "Staff", now: 600_000, before: 0 }, { name: "Food", now: 400_000, before: 0 }] })).toContain("topCategory");
    expect(kinds({ earned: 1, expenses: 1_000_000, categories: [{ name: "A", now: 300_000, before: 0 }, { name: "B", now: 300_000, before: 0 }, { name: "C", now: 200_000, before: 0 }, { name: "D", now: 200_000, before: 0 }] })).not.toContain("topCategory");
  });

  it("late money owed to the hotel is only mentioned when something is more than a week late", () => {
    expect(kinds({ owed: { total: 500_000, late: 0, lateCount: 0 } })).toEqual([]);
    expect(buildInsights({ ...quiet, owed: { total: 500_000, late: 200_000, lateCount: 2 } })[0]).toMatchObject({ kind: "owedLate", amount: 200_000, n: 2, href: "/staff/finance/receivables" });
  });

  it("suppliers: short of money beats overdue beats due this week; a reader without suppliers hears nothing", () => {
    expect(kinds({ suppliers: { overdue: 300_000, dueWeek: 100_000 }, money: 250_000 })).toContain("suppliersShort");
    expect(kinds({ suppliers: { overdue: 300_000, dueWeek: 100_000 }, money: 5_000_000 })).toEqual(["suppliersOverdue"]);
    expect(kinds({ suppliers: { overdue: 0, dueWeek: 100_000 }, money: 5_000_000 })).toEqual(["suppliersDue"]);
    expect(kinds({ suppliers: { overdue: 0, dueWeek: 0 }, money: 5_000_000 })).toEqual([]);
    expect(kinds({ suppliers: null, money: 0 })).toEqual([]);
  });

  it("days the money lasts: only with a week of records, a pace above zero and a right to see the accounts", () => {
    expect(kinds({ money: 3_000_000, spendPerDay: 100_000, spendDays: 6 })).toEqual([]);     // too early
    expect(kinds({ money: 3_000_000, spendPerDay: 0, spendDays: 20 })).toEqual([]);          // nothing spent: no pace
    expect(kinds({ money: null, spendPerDay: 100_000, spendDays: 20 })).toEqual([]);         // may not see the accounts
    const tone = (money: number) => buildInsights({ ...quiet, money, spendPerDay: 100_000, spendDays: 20 })[0];
    expect(tone(900_000)).toMatchObject({ kind: "cover", days: 9, tone: "bad" });
    expect(tone(2_000_000)).toMatchObject({ days: 20, tone: "warn" });
    expect(tone(9_000_000)).toMatchObject({ days: 90, tone: "info" });
  });

  it("discounts and cash share are named only above their lines", () => {
    expect(kinds({ roomNet: 920_000, roomDiscount: 80_000 })).toContain("discounts");      // 8% of the room price
    expect(kinds({ roomNet: 950_000, roomDiscount: 50_000 })).not.toContain("discounts");
    expect(kinds({ received: 1_000_000, cashReceived: 500_000 })).toContain("cashShare");
    expect(kinds({ received: 1_000_000, cashReceived: 490_000 })).not.toContain("cashShare");
    expect(kinds({ received: 0, cashReceived: 0 })).toEqual([]);
  });

  it("the most serious come first, and no more than the limit", () => {
    const all = buildInsights({
      ...quiet, earned: 100_000, earnedBefore: 1_000_000, expenses: 400_000, expensesBefore: 100_000, categories: [{ name: "Staff", now: 400_000, before: 100_000 }],
      owed: { total: 9, late: 9, lateCount: 1 }, suppliers: { overdue: 5, dueWeek: 0 }, money: 1, spendPerDay: 100_000, spendDays: 10, roomNet: 1, roomDiscount: 1, received: 10, cashReceived: 9,
    }, 4);
    expect(all).toHaveLength(4);
    const order = { bad: 0, warn: 1, info: 2, good: 3 } as const;
    expect(all.map((i) => order[i.tone])).toEqual([...all.map((i) => order[i.tone])].sort((a, b) => a - b));
    expect(all[0].tone).toBe("bad");
  });
});
