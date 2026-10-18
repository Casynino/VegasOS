import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});

import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { INVOICE_STATUS_ORDER, INVOICE_STATUS_WORDS, moneyGlance, type MoneyGlance } from "@/server/services/developer-money-glance";
import { MoneyGlanceTab } from "@/app/staff/(app)/developer/tab-money-glance";
import { loadCatalog } from "@/i18n/catalog";
import mine from "@/i18n/catalog/zh-CN/staff/developer-money-glance";
import { makeT } from "@/i18n/translate";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { eat } from "../support/helpers";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * The Money part of the Developer Home (bills, payments and the money book, COUNTS ONLY), against a real database. A far-away year keeps
 * these rows apart from every other test file's; the figures are compared with direct counts of the rows built here (and, for the
 * all-time ones, with the change the new rows make). No amount, name, reference, phone or account number may leave the service or reach the page.
 */

const NOW = eat("2041-03-10T12:00:00");
const TODAY = "2041-03-10";
const day = (n: number) => addDays(TODAY, -n);
const en = makeT("en", null);
const when = (d: Date) => en.dateTime(d, "Africa/Dar_es_Salaam");

const AMOUNT = 7654321;
const SECRETS = [String(AMOUNT), "REF-SECRET-123", "Juma Kimaro", "Mama Zawadi", "Typed by mistake", "took the money", "255700999888", "Customer typed"];

let dev: MadeUser, rec: MadeUser, boss: MadeUser;
const as = async (u: MadeUser) => { browser.reset(); await makeSession(u.id); return (await getCurrentUser()) as CurrentUser; };

const ids = { payments: [] as string[], corrections: [] as string[], ledger: [] as string[], invoices: [] as string[], online: [] as string[] };
const methods: Record<string, { id: string; accountId: string; name: string }> = {};
let ledgerAccountId = "";

const base = {
  invoices: { total: 0, paid: 0, byStatus: {} as Record<string, number> },
  online: 0,
};

let g: MoneyGlance;

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Glance Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Glance" });
  boss = await makeUser("OWNER", { fullName: "Boss Glance" });
  for (const m of await db.paymentMethod.findMany()) methods[m.code] = { id: m.id, accountId: m.accountId!, name: m.name };
  ledgerAccountId = (await db.moneyAccount.findFirstOrThrow({ orderBy: { code: "asc" } })).id;

  // what is already in the database (the all-time figures are checked as a change)
  const inv = await db.invoice.groupBy({ by: ["status"], _count: true });
  base.invoices.total = inv.reduce((n, r) => n + r._count, 0);
  base.invoices.paid = inv.find((r) => r.status === "PAID")?._count ?? 0;
  for (const s of INVOICE_STATUS_ORDER) base.invoices.byStatus[s] = inv.find((r) => r.status === s)?._count ?? 0;
  base.online = await db.mobilePayment.count({ where: { attentionAt: { not: null }, resolvedAt: null } });

  // bills: 2 unpaid, 1 partly paid, 2 paid, 1 cancelled, 1 draft
  let n = 0;
  for (const status of ["ISSUED", "ISSUED", "PARTIALLY_PAID", "PAID", "PAID", "CANCELLED", "DRAFT"] as const) {
    const i = await db.invoice.create({ data: { number: `WC-INV-${++n}`, status, grossAmount: AMOUNT, netAmount: AMOUNT, paidAmount: status === "PAID" ? AMOUNT : 0, balanceAmount: status === "PAID" ? 0 : AMOUNT, notes: "Mama Zawadi pays on Friday", createdById: rec.id } });
    ids.invoices.push(i.id);
  }

  // payments of money received: 3 today (2 cash, 1 mobile), 1 cash 3 days ago, 1 mobile 10 days ago, 1 cash 20 days ago, 1 cash 40 days ago
  const pay = async (over: Record<string, unknown>) => {
    const p = await db.payment.create({
      data: { kind: "PAYMENT", status: "POSTED", amount: AMOUNT, methodId: methods.CASH.id, accountId: methods.CASH.accountId, reference: "REF-SECRET-123", notes: "Payer Juma Kimaro", businessDate: toDbDate(TODAY), receivedAt: eat("2041-03-10T09:00:00"), createdAt: eat("2041-03-10T09:00:00"), recordedById: rec.id, ...over } as never,
    });
    ids.payments.push(p.id);
    return p;
  };
  await pay({});
  await pay({});
  await pay({ methodId: methods.MOBILE_MONEY.id, accountId: methods.MOBILE_MONEY.accountId, createdAt: eat("2041-03-10T11:55:00") }); // the newest one: 5 minutes before NOW
  await pay({ businessDate: toDbDate(day(3)), createdAt: eat("2041-03-07T10:00:00") });
  await pay({ businessDate: toDbDate(day(10)), methodId: methods.MOBILE_MONEY.id, accountId: methods.MOBILE_MONEY.accountId, createdAt: eat("2041-02-28T10:00:00") });
  await pay({ businessDate: toDbDate(day(20)), createdAt: eat("2041-02-18T10:00:00") });
  await pay({ businessDate: toDbDate(day(40)), createdAt: eat("2041-01-29T10:00:00") });
  // not payments of money received: a refund today, a cancelled payment (cancelled yesterday: a correction), a payment cancelled long ago
  await pay({ kind: "REFUND", methodId: methods.CARD.id, accountId: methods.CARD.accountId });
  const cancelled = await pay({ status: "REVERSED", methodId: methods.CARD.id, accountId: methods.CARD.accountId, businessDate: toDbDate(day(1)), reversedAt: eat("2041-03-09T10:00:00"), reversedById: rec.id, reversalReason: "Typed by mistake", reversalBusinessDate: toDbDate(day(1)) });
  await pay({ status: "REVERSED", methodId: methods.CARD.id, accountId: methods.CARD.accountId, businessDate: toDbDate(day(41)), reversedAt: eat("2041-01-28T10:00:00"), reversedById: rec.id, reversalReason: "Typed by mistake", reversalBusinessDate: toDbDate(day(40)) });

  // payment corrections: one yesterday (counted), one 45 days ago (not)
  for (const d of [1, 45]) {
    const c = await db.paymentCorrection.create({ data: { paymentId: cancelled.id, fromMethodId: methods.CASH.id, toMethodId: methods.BANK.id, amount: AMOUNT, reason: "Typed by mistake", changedById: rec.id, changedAt: eat("2041-03-09T10:00:00"), businessDate: toDbDate(day(d)) } });
    ids.corrections.push(c.id);
  }

  // the money book: 2 today, 1 two days ago, 1 five days ago (reversed yesterday), 1 twenty days ago, 1 forty days ago (reversed forty days ago)
  let l = 0;
  const line = async (over: Record<string, unknown>) => {
    const e = await db.ledgerEntry.create({
      data: { number: `LG-WC-${++l}`, kind: "OTHER_INCOME", amount: AMOUNT, accountId: ledgerAccountId, description: "Owner took the money out", reference: "REF-SECRET-123", businessDate: toDbDate(TODAY), createdAt: eat("2041-03-10T08:00:00"), createdById: rec.id, ...over } as never,
    });
    ids.ledger.push(e.id);
  };
  await line({});
  await line({ createdAt: eat("2041-03-10T11:30:00") }); // the newest line: 30 minutes before NOW
  await line({ businessDate: toDbDate(day(2)), createdAt: eat("2041-03-08T08:00:00") });
  await line({ businessDate: toDbDate(day(5)), createdAt: eat("2041-03-05T08:00:00"), status: "REVERSED", reversedAt: eat("2041-03-09T10:00:00"), reversedById: rec.id, reversalReason: "Typed by mistake" });
  await line({ businessDate: toDbDate(day(20)), createdAt: eat("2041-02-18T08:00:00") });
  await line({ businessDate: toDbDate(day(40)), createdAt: eat("2041-01-29T08:00:00"), status: "REVERSED", reversedAt: eat("2041-01-30T10:00:00"), reversedById: rec.id, reversalReason: "Typed by mistake" });

  // online payments: two need a person, one was settled by a person, one is only waiting for the customer
  const mp = async (over: Record<string, unknown>) => {
    const m = await db.mobilePayment.create({ data: { amount: AMOUNT, phone: "255700999888", purpose: "RESERVATION", status: "COMPLETED", lastError: "Customer typed the wrong number", ...over } as never });
    ids.online.push(m.id);
  };
  await mp({ attentionAt: eat("2041-03-10T09:00:00") });
  await mp({ attentionAt: eat("2041-03-09T09:00:00") });
  await mp({ attentionAt: eat("2041-03-08T09:00:00"), resolvedAt: eat("2041-03-08T10:00:00") });
  await mp({ status: "PENDING" });

  g = await moneyGlance(await as(dev), NOW);
});

afterAll(async () => {
  browser.reset();
  await db.paymentCorrection.deleteMany({ where: { id: { in: ids.corrections } } }).catch(() => undefined);
  await db.payment.deleteMany({ where: { id: { in: ids.payments } } }).catch(() => undefined);
  await db.ledgerEntry.deleteMany({ where: { id: { in: ids.ledger } } }).catch(() => undefined);
  await db.invoice.deleteMany({ where: { id: { in: ids.invoices } } }).catch(() => undefined);
  await db.mobilePayment.deleteMany({ where: { id: { in: ids.online } } }).catch(() => undefined);
  await removeMadeUsers();
});

const draw = (data: MoneyGlance, t = en) => renderToStaticMarkup(createElement(MoneyGlanceTab, { t, g: data, when, now: NOW }));

describe("Money (counts only): the figures", () => {
  it("bills: all of them, how many are paid in full, and how many are in each state", () => {
    expect(g.bills).toEqual({ total: base.invoices.total + 7, paid: base.invoices.paid + 2 });
    const direct = (status: string) => db.invoice.count({ where: { status: status as never } });
    return Promise.all(g.billsByStatus!.map(async (b) => expect(b.count, b.status).toBe(await direct(b.status)))).then(() => {
      expect(g.billsByStatus!.map((b) => b.status)).toEqual([...INVOICE_STATUS_ORDER]);
      const add = { ISSUED: 2, PARTIALLY_PAID: 1, PAID: 2, CANCELLED: 1, DRAFT: 1, OVERDUE: 0, VOID: 0 } as Record<string, number>;
      for (const b of g.billsByStatus!) expect(b.count, b.status).toBe(base.invoices.byStatus[b.status] + add[b.status]);
      expect(g.billsByStatus!.reduce((n, b) => n + b.count, 0)).toBe(g.bills!.total);
    });
  });

  it("payments per day are the payments of money received on their hotel day (refunds and cancelled ones are not payments), 14 days, oldest first", async () => {
    expect(g.days).toHaveLength(14);
    expect(g.days[13]).toBe(TODAY);
    expect(g.paymentsPerDay!.map((d) => d.date)).toEqual(g.days);
    for (const d of g.paymentsPerDay!) {
      const direct = await db.payment.count({ where: { kind: "PAYMENT", status: "POSTED", businessDate: toDbDate(d.date) } });
      expect(d.count, d.date).toBe(direct);
    }
    const by = Object.fromEntries(g.paymentsPerDay!.map((d) => [d.date, d.count]));
    expect(by[TODAY]).toBe(3); // the refund is not one of them
    expect(by[day(3)]).toBe(1);
    expect(by[day(10)]).toBe(1);
    expect(by[day(1)]).toBe(0); // the one that was cancelled
  });

  it("payments (7 days) are the last seven hotel days of those", async () => {
    expect(g.payments7d).toBe(4);
    expect(g.payments7d).toBe(await db.payment.count({ where: { kind: "PAYMENT", status: "POSTED", businessDate: { gte: toDbDate(day(6)), lte: toDbDate(TODAY) } } }));
  });

  it("the hotel day starts at 04:00: at 03:30 the day is still yesterday, so today's payments are not in the week yet", async () => {
    const early = await moneyGlance(await as(dev), eat("2041-03-10T03:30:00"));
    expect(early.today).toBe(day(1));
    expect(early.days[13]).toBe(day(1));
    expect(early.payments7d).toBe(1); // only the one three days ago (the 10th has not begun)
    const edge = await moneyGlance(await as(dev), eat("2041-03-10T04:00:00"));
    expect(edge.today).toBe(TODAY);
    expect(edge.payments7d).toBe(4);
  });

  it("money-book lines: per day, and over 30 days (a cancelled line is still a line; one from 40 days ago is not in the window)", async () => {
    const by = Object.fromEntries(g.ledgerPerDay!.map((d) => [d.date, d.count]));
    expect(by[TODAY]).toBe(2);
    expect(by[day(2)]).toBe(1);
    expect(by[day(5)]).toBe(1);
    for (const d of g.ledgerPerDay!) expect(d.count, d.date).toBe(await db.ledgerEntry.count({ where: { businessDate: toDbDate(d.date) } }));
    expect(g.ledger30d).toBe(5);
    expect(g.ledger30d).toBe(await db.ledgerEntry.count({ where: { businessDate: { gte: toDbDate(day(29)), lte: toDbDate(TODAY) } } }));
  });

  it("corrections (30 days): a payment cancelled + a payment's method corrected + a money-book line reversed — each on the day it was done, none from before the window", async () => {
    expect(g.corrections30d).toBe(3);
    const direct =
      await db.payment.count({ where: { reversalBusinessDate: { gte: toDbDate(day(29)), lte: toDbDate(TODAY) } } })
      + await db.paymentCorrection.count({ where: { businessDate: { gte: toDbDate(day(29)), lte: toDbDate(TODAY) } } })
      + await db.ledgerEntry.count({ where: { status: "REVERSED", reversedAt: { gte: eat(`${day(29)}T04:00:00`) } } });
    expect(g.corrections30d).toBe(direct);
  });

  it("the last ledger line, the last payment and the online payments that wait for a person", async () => {
    expect(g.lastLedger!.at).toEqual(eat("2041-03-10T11:30:00"));
    expect(g.lastLedger!.at).toEqual((await db.ledgerEntry.findFirst({ orderBy: { createdAt: "desc" } }))!.createdAt);
    expect(g.lastPayment!.at).toEqual(eat("2041-03-10T11:55:00"));
    expect(g.lastPayment!.at).toEqual((await db.payment.findFirst({ where: { kind: "PAYMENT", status: "POSTED" }, orderBy: { createdAt: "desc" } }))!.createdAt);
    expect(g.onlineWaiting).toBe(base.online + 2);
    expect(g.onlineWaiting).toBe(await db.mobilePayment.count({ where: { attentionAt: { not: null }, resolvedAt: null } }));
  });

  it("how people pay: the payments of the last 30 days by the hotel's own method names, most used first", async () => {
    expect(g.byMethod!.map((m) => [m.name, m.count])).toEqual([[methods.CASH.name, 4], [methods.MOBILE_MONEY.name, 2]]);
    const direct = await db.payment.count({ where: { kind: "PAYMENT", status: "POSTED", businessDate: { gte: toDbDate(day(29)), lte: toDbDate(TODAY) } } });
    expect(g.byMethod!.reduce((n, m) => n + m.count, 0)).toBe(direct);
  });

  it("with no payments at all in a window the part still reads: zeros and an empty list, not nulls", async () => {
    const far = await moneyGlance(await as(dev), eat("2051-01-10T12:00:00"));
    expect(far.payments7d).toBe(0);
    expect(far.ledger30d).toBe(0);
    expect(far.corrections30d).toBe(0);
    expect(far.byMethod).toEqual([]);
    expect(far.paymentsPerDay!.every((d) => d.count === 0)).toBe(true);
    const html = draw(far);
    expect(html).toContain("No payments were recorded during these 14 days.");
    expect(html).toContain("No payments were recorded in the last 30 days.");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });
});

describe("Money (counts only): nothing but counts leaves the service", () => {
  it("it carries exactly the counts, days and times it is meant to — no amount, name, reference, phone or account number", async () => {
    expect(Object.keys(g).sort()).toEqual(["bills", "billsByStatus", "byMethod", "corrections30d", "dayStart", "days", "lastLedger", "lastPayment", "ledger30d", "ledgerPerDay", "onlineWaiting", "payments7d", "paymentsPerDay", "today"]);
    const json = JSON.stringify(g);
    for (const w of SECRETS) expect(json, w).not.toContain(w);
    for (const a of await db.moneyAccount.findMany({ select: { accountNumber: true, holderName: true } })) {
      if (a.accountNumber) expect(json, a.accountNumber).not.toContain(a.accountNumber);
      if (a.holderName) expect(json, a.holderName).not.toContain(a.holderName);
    }
    expect(json).not.toMatch(/amount|balance|reference|phone|account|password|token|secret/i);
  });

  it("it only reads: the money tables are unchanged around a call, and nothing is written to the audit trail", async () => {
    const count = async () => [
      await db.invoice.count(), await db.payment.count(), await db.paymentCorrection.count(), await db.ledgerEntry.count(), await db.mobilePayment.count(),
      await db.revenueTransaction.count(), await db.moneyAccount.count(), await db.auditLog.count({ where: { action: { not: "auth.login" } } }),
    ];
    const user = await as(dev);
    const audit = await db.auditLog.count();
    const before = await count();
    await moneyGlance(user, NOW);
    await moneyGlance(user, eat("2041-03-10T03:30:00"));
    expect(await count()).toEqual(before);
    expect(await db.auditLog.count()).toBe(audit);
  });

  it("only the Developer — not while working as someone, not without the right — may read it", async () => {
    for (const who of [rec, boss]) {
      const e = await thrownBy(async () => moneyGlance(await as(who), NOW));
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
    const user = await as(dev);
    for (const caller of [{ ...user, workAs: { userId: rec.id } }, { ...user, permissions: new Set<never>() }]) {
      const e = await thrownBy(() => moneyGlance(caller as never, NOW));
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("a figure that cannot be read is null and the rest still draws", async () => {
    const spy = vi.spyOn(db.ledgerEntry, "count").mockRejectedValue(new Error("boom"));
    const spy2 = vi.spyOn(db.payment, "groupBy").mockRejectedValue(new Error("boom"));
    try {
      const part = await moneyGlance(await as(dev), NOW);
      expect(part.ledger30d).toBeNull();
      expect(part.corrections30d).toBeNull();
      expect(part.paymentsPerDay).toBeNull();
      expect(part.payments7d).toBeNull();
      expect(part.byMethod).toBeNull();
      expect(part.bills).not.toBeNull();
      expect(part.ledgerPerDay).not.toBeNull();
      expect(part.onlineWaiting).toBe(base.online + 2);
      const html = draw(part);
      expect(html).toContain("This could not be read just now.");
      expect(html).toContain("Bills by status");
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("undefined");
    } finally { spy.mockRestore(); spy2.mockRestore(); }
  });
});

describe("Money (counts only): the page", () => {
  it("English: the four cards, the four panels and the money book are drawn with the real numbers — and no money, name or reference", () => {
    const html = draw(g);
    for (const w of [
      "Bills issued", `${g.bills!.paid} paid in full`, "All time", "Every bill the system has made, and how many are settled.",
      "Payments (7 days)", "recorded by reception and Finance", "Money in",
      "Money-book lines (30 days)", "lines in the money book", "The money book is never edited: a mistake is answered by a new line.",
      "Corrections (30 days)", "lines that reverse an earlier one",
      "Payments recorded per day", "Last 14 days, by the day the money was received.",
      "Money-book lines per day", "Every line in the ledger, last 14 days.",
      "Bills by status", "How many bills are in each state.", "Partly paid", "Paid", "Unpaid", "Cancelled", "Draft",
      "The money book", "Ledger activity and payments waiting.", "Last ledger line", "30 min ago", "Lines in 30 days", "Corrections in 30 days", "Last payment recorded", "5 min ago", "Online payments waiting for a person",
      "A correction is a line that reverses an earlier one.",
      "How people pay", "Payments on hotel bills by method, last 30 days.", methods.CASH.name, methods.MOBILE_MONEY.name, "Show the numbers",
    ]) expect(html, w).toContain(w);
    for (const w of SECRETS) expect(html, w).not.toContain(w);
    expect(html).not.toMatch(/TZS|Sparkle/);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });

  it("the hover text of each day's bar and the numbers under the chart carry the counts of that day", () => {
    const html = draw(g);
    expect(html).toContain("10 Mar: 3");
    expect(html).toContain("7 Mar: 1");
  });

  it("a part with nothing read shows dashes and says so, not NaN or undefined", () => {
    const none: MoneyGlance = { ...g, bills: null, billsByStatus: null, payments7d: null, paymentsPerDay: null, ledger30d: null, ledgerPerDay: null, corrections30d: null, lastLedger: null, lastPayment: null, onlineWaiting: null, byMethod: null };
    const html = draw(none);
    expect(html).toContain("This could not be read just now.");
    expect(html).toContain("—");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });

  it("none yet: no ledger line and no payment says 'None yet'", () => {
    const html = draw({ ...g, lastLedger: { at: null }, lastPayment: { at: null } });
    expect(html).toContain("None yet");
    expect(html).not.toContain("undefined");
  });

  it("中文: every word is Chinese, with no English left over and no 'undefined' or 'NaN'", async () => {
    const zh = makeT("zh-CN", { ...(await loadCatalog("zh-CN", ["common", "staff"])), ...mine });
    const html = draw(g, zh);
    for (const w of ["已开账单", "付款笔数（7 天）", "资金账簿条目（30 天）", "更正（30 天）", "每天记录的付款笔数", "每天的资金账簿条目", "按状态统计的账单", "资金账簿", "客人如何付款", "最近一条账簿记录", "最近一笔付款记录", "等待人工处理的在线付款", "已付款", "部分付款"]) expect(html, w).toContain(w);
    for (const w of ["Bills issued", "Payments (7 days)", "Money-book lines", "Corrections (30 days)", "Bills by status", "How people pay", "Last ledger line", "Last payment recorded", "Payments recorded per day", "paid in full", "Lines in 30 days"]) expect(html, w).not.toContain(w);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
    for (const w of SECRETS) expect(html, w).not.toContain(w);
    // the status words are the shared ones, in Chinese too
    for (const s of INVOICE_STATUS_ORDER) expect(zh.has(INVOICE_STATUS_WORDS[s]), s).toBe(true);
  });

  it("every English string of this part has a Chinese entry", async () => {
    const zh = { ...(await loadCatalog("zh-CN", ["common", "staff"])), ...mine };
    const t = makeT("zh-CN", zh);
    for (const key of Object.keys(mine)) expect(t.has(key), key).toBe(true);
    for (const s of INVOICE_STATUS_ORDER) expect(t(INVOICE_STATUS_WORDS[s]), s).not.toBe(INVOICE_STATUS_WORDS[s]);
    expect(t("Bank transfer")).not.toBe("Bank transfer");
  });
});
