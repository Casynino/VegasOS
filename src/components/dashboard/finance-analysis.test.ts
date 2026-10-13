import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { englishT as t, makeT } from "@/i18n/translate";
import { buildInsights } from "@/lib/finance-insights";
import type { ReceivablesAging } from "@/server/services/finance-outlook";
import { InsightsPanel, OutlookView, TrendsView, type OutlookProps } from "./finance-analysis";

/**
 * The analysis views draw, in English and in Chinese, with real-looking figures — and say the plain words (no raw {placeholder},
 * no "undefined", "NaN" or "Infinity") whether there is a lot to show or nothing at all.
 */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const clean = (html: string) => { expect(html).not.toMatch(/undefined|NaN|Infinity|\{[a-z]+\}/); };

const aging: ReceivablesAging = { rows: [
  { bucket: "current", count: 4, amount: 150_000 }, { bucket: "week", count: 2, amount: 90_000 }, { bucket: "month", count: 1, amount: 30_000 }, { bucket: "older", count: 0, amount: 0 },
], total: 270_000, lateOverWeek: { amount: 30_000, count: 1 }, afterDays: 7 };
const suppliers: NonNullable<OutlookProps["suppliers"]> = {
  owed: { count: 3, amount: 410_000 }, overdue: { count: 1, amount: 300_000 }, disputed: 0, top: [],
  due: [{ bucket: "overdue", count: 1, amount: 300_000 }, { bucket: "week", count: 1, amount: 50_000 }, { bucket: "month", count: 1, amount: 60_000 }, { bucket: "later", count: 0, amount: 0 }, { bucket: "none", count: 0, amount: 0 }],
  next: [{ supplier: "Mwenge Furniture", number: "INV-1", dueOn: "2026-10-10", owed: 300_000, late: true, disputed: false }, { supplier: "Kariakoo Linen", number: "INV-2", dueOn: "2026-10-20", owed: 50_000, late: false, disputed: true }],
};
const links = { receivables: "/staff/finance/receivables", procurement: "/staff/procurement?tab=invoices", accounts: "/staff/finance/accounts", expenses: "/staff/expenses" };

describe("what stands out", () => {
  it("writes each sentence in plain words, with the amounts", () => {
    const insights = buildInsights({
      earned: 956_000, earnedBefore: 700_000, expenses: 400_000, expensesBefore: 300_000,
      categories: [{ name: "Utilities", now: 250_000, before: 100_000 }, { name: "Food", now: 150_000, before: 200_000 }],
      owed: { total: 270_000, late: 30_000, lateCount: 1 }, suppliers: { overdue: 300_000, dueWeek: 50_000 }, money: 250_000,
      spendPerDay: 20_000, spendDays: 10, roomNet: 900_000, roomDiscount: 100_000, received: 696_000, cashReceived: 400_000,
    }, 12);
    const html = renderToStaticMarkup(createElement(InsightsPanel, { insights, t, period: "1–13 Oct" }));
    clean(html);
    const words = text(html);
    expect(words).toContain("What stands out");
    expect(words).toContain("TZS 556,000 above the expenses recorded");
    expect(words).toContain("Earned is up 37% on the previous period");
    expect(words).toContain("Expenses are up 33% on the previous period — mostly Utilities, TZS 150,000 more");
    expect(words).toContain("TZS 30,000 owed to the hotel is more than a week late (1 bill)");
    expect(words).toContain("TZS 350,000 is due to suppliers now or within a week, and the accounts hold TZS 250,000");
    expect(words).toContain("Room discounts took 10% of the room price");
    expect(words).toContain("57% of the money received was cash");
    // the one that can be acted on is a link
    expect(html).toContain('href="/staff/finance/receivables"');
  });

  it("draws nothing at all when there is nothing to say", () => {
    expect(renderToStaticMarkup(createElement(InsightsPanel, { insights: [], t, period: "" }))).toBe("");
  });

  it("speaks Chinese too, with the amounts in place", () => {
    const zh = makeT("zh-CN", { "Earned is up {pct}% on the previous period.": "营收比上一期增长 {pct}%。", "What stands out": "值得关注", "Read from the figures below — nothing is guessed. {period}": "根据下方数字得出——没有任何猜测。{period}" });
    const html = renderToStaticMarkup(createElement(InsightsPanel, { insights: buildInsights({ earned: 1_200_000, earnedBefore: 1_000_000, expenses: 1, expensesBefore: 1, categories: [], owed: null, suppliers: null, money: null, spendPerDay: 0, spendDays: 0, roomNet: 0, roomDiscount: 0, received: 0, cashReceived: 0 }), t: zh, period: "" }));
    expect(text(html)).toContain("值得关注");
    expect(text(html)).toContain("营收比上一期增长 20%。");
  });
});

describe("the cash outlook", () => {
  it("shows the money, who owes how late, what falls due, the pace and the rooms booked ahead", () => {
    const html = renderToStaticMarkup(createElement(OutlookView, {
      t, money: 2_000_000, aging, suppliers, pace: { days: 10, total: 400_000, perDay: 40_000 }, pending: { count: 2, amount: 120_000 },
      booked: { nights: 18, amount: 1_440_000 }, links,
    }));
    clean(html);
    const words = text(html);
    expect(words).toContain("In the accounts TZS 2,000,000");
    expect(words).toContain("Owed to the hotel TZS 270,000");
    expect(words).toContain("Owed to suppliers TZS 410,000");
    expect(words).toContain("Days the money lasts 50 at the recent pace of TZS 40,000 a day");
    expect(words).toContain("Not late yet");
    expect(words).toContain("1–7 days late");
    expect(words).toContain("More than 30 days late");
    expect(words).toContain("Past its due date");
    expect(words).toContain("Mwenge Furniture");
    expect(words).toContain("late");
    expect(words).toContain("disputed");
    expect(words).toContain("18");
    expect(words).toContain("TZS 1,440,000");
  });

  it("a hotel with no records yet says so, without a figure it cannot know", () => {
    const html = renderToStaticMarkup(createElement(OutlookView, {
      t, money: 0, aging: { rows: [], total: 0, lateOverWeek: { amount: 0, count: 0 }, afterDays: 7 }, suppliers: null, pace: null, pending: { count: 0, amount: 0 }, booked: { nights: 0, amount: 0 }, links: {},
    }));
    clean(html);
    const words = text(html);
    expect(words).toContain("Nobody owes the hotel anything.");
    expect(words).toContain("No day has closed since the records began");
    expect(words).toContain("No rooms are booked for the next 30 nights.");
    expect(words).toContain("Days the money lasts — needs 7 days of records");
  });

  it("a short record keeps the pace out of it", () => {
    const html = renderToStaticMarkup(createElement(OutlookView, {
      t, money: 500_000, aging: null, suppliers: null, pace: { days: 1, total: 80_000, perDay: 80_000 }, pending: { count: 0, amount: 0 }, booked: null, links: {},
    }));
    clean(html);
    expect(text(html)).toContain("Only 1 closed day of records so far");
    expect(text(html)).not.toContain("TZS 80,000 a day");
  });
});

describe("the trends", () => {
  const kpis = [{ label: "Occupancy", value: "42%", sub: "13 of 31 room nights" }, { label: "Average room rate", value: "—" }];
  it("shows the months with their net and the movement of each part", () => {
    const html = renderToStaticMarkup(createElement(TrendsView, {
      t, kpis,
      months: [{ key: "2026-09", income: 2_000_000, expenses: 1_500_000, received: 1_800_000 }, { key: "2026-10", income: 956_000, expenses: 0, received: 696_000 }],
      streams: [{ name: "Rooms", now: 900_000, before: 600_000 }, { name: "Bar", now: 0, before: 50_000 }, { name: "Meeting room", now: 56_000, before: 0 }],
      categories: [{ name: "Utilities", now: 250_000, before: 100_000 }],
      weekdays: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, average: weekday === 6 ? 120_000 : 60_000, days: 4 })), closedDays: 28, weeks: 8,
      links: { ledger: "/staff/finance/ledger", expenses: "/staff/expenses" },
    }));
    clean(html);
    const words = text(html);
    expect(words).toContain("September 2026");
    expect(words).toContain("October 2026");
    expect(words).toContain("TZS 500,000");                   // September's net result
    expect(words).toContain("75%");                           // September: spent 75% of earned
    expect(words).toContain("+TZS 300,000 (+50%)");           // rooms against before
    expect(words).toContain("−TZS 50,000 (−100%)");           // the bar earned nothing this time
    expect(words).toContain("new");                           // the meeting room had nothing before
    expect(words).toContain("Saturday");
    expect(words).toContain("42%");
  });

  it("with too few days, the week pattern waits; with no months, it says there are no records", () => {
    const html = renderToStaticMarkup(createElement(TrendsView, { t, kpis: [], months: [], streams: [], categories: [], weekdays: null, closedDays: 1, weeks: 8, links: {} }));
    clean(html);
    expect(text(html)).toContain("No records yet.");
    expect(text(html)).toContain("Only 1 closed day of records so far");
    expect(text(html)).toContain("Nothing in this period or the one before.");
  });
});
