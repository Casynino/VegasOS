import { describe, expect, it } from "vitest";
import { makeT } from "@/i18n/translate";
import server from "@/i18n/catalog/zh-CN/server";
import staff from "@/i18n/catalog/zh-CN/staff";
import common from "@/i18n/catalog/zh-CN/common";
import { msg } from "@/i18n/msg";
import { textBook, word } from "@/lib/report-i18n";
import { renderReportText, type DailyReportData } from "./daily-report";
import { buildShiftDocument, factLine, renderShiftReportText, type ShiftReportData } from "./shift-report";
import { periodLabel, renderTeamText, type TeamPeriodData } from "./staff-report";
import { withLang } from "./report-delivery";

/** Reports go to each recipient in their language — the same frozen figures, only the words change. */
const zh = makeT("zh-CN", { ...common, ...staff, ...server });
const numbers = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).filter((n) => n.length > 1 || /\d/.test(n));

const shift = (): ShiftReportData => {
  const { book, L } = textBook();
  return {
    v: 1,
    shift: { id: "s1", department: "RECEPTION", label: "Morning shift", businessDate: "2026-10-12", startedAt: "2026-10-12T05:00:00.000Z", endedAt: "2026-10-12T13:30:00.000Z", minutes: 510, closedBy: null, byManager: false, closeReason: null, closingNote: "Room 12 asked for towels", replacement: null },
    person: { id: "u1", name: "Asha Mrema", role: "Receptionist" },
    headline: [{ label: msg("Guests checked in"), value: 1 }, { label: msg("Recorded in payments"), value: 50000, money: true }],
    groups: [{ title: msg("Guests"), facts: [{ label: msg("Guests checked in"), value: 1, sub: L("{x}", { x: word(msg("{n} room"), { n: 1 }) }) }] }],
    money: null, records: [],
    handover: [L(msg("Guests in the hotel owed {amount} at the close."), { amount: "TZS 80,000" }), L(msg("Handover note: {note}"), { note: "Room 12 asked for towels" })],
    timeline: [{ at: "2026-10-12T05:00:00.000Z", text: msg("Shift started"), area: msg("Shift") }], timelineMore: false, i18n: book,
  };
};

describe("the shift report message", () => {
  it("stays exactly as before in English", () => {
    const text = renderShiftReportText(shift(), "Vegas Luxury Hotel", "Africa/Dar_es_Salaam", "https://x.test/shift-report/abc");
    expect(text).toContain("*Shift completed*");
    expect(text).toContain("• 1 guest checked in");
    expect(text).toContain("• TZS 50,000 recorded in payments");
    expect(text).toContain("Business date: 12 Oct 2026");
    expect(text).toContain("_Guests in the hotel owed TZS 80,000 at the close._");
    expect(text).toMatch(/\*Full shift report:\* https:\/\/x\.test\/shift-report\/abc$/);
    expect(factLine(shift().headline[0])).toBe("1 guest checked in");
  });

  it("is written in Chinese with the same numbers and a Chinese link", () => {
    const link = withLang("https://x.test/shift-report/abc", "zh-CN");
    const text = renderShiftReportText(shift(), "Vegas Luxury Hotel", "Africa/Dar_es_Salaam", link, zh);
    expect(text).toContain("*班次已结束*");
    expect(text).toContain("• 办理入住的客人：1");
    expect(text).toContain("• 记录的收款：TZS 50,000");
    expect(text).toContain("_交班时在住客人共欠 TZS 80,000。_");
    // What a person typed stays as they wrote it.
    expect(text).toContain("Room 12 asked for towels");
    expect(text).toMatch(/https:\/\/x\.test\/shift-report\/abc\?lang=zh$/);
    const en = renderShiftReportText(shift(), "Vegas Luxury Hotel", "Africa/Dar_es_Salaam", null);
    for (const n of ["50,000", "80,000", "8h 30m"]) { expect(en).toContain(n); expect(text).toContain(n); }
  });

  it("the document says its sentences in Chinese from its book", async () => {
    const { localizeReport } = await import("@/lib/report-i18n");
    const doc = localizeReport(buildShiftDocument(shift(), "Africa/Dar_es_Salaam"), zh);
    expect(doc.title).toBe("班次报告 — Asha Mrema");
    const activity = doc.blocks.find((b) => b.kind === "list" && b.tone === "insight");
    expect(activity && activity.kind === "list" && activity.items).toEqual(["办理入住的客人：1", "记录的收款：TZS 50,000"]);
    const guests = doc.blocks.find((b) => b.kind === "table" && b.title === "客人");
    expect(guests && guests.kind === "table" && guests.rows[0]).toEqual(["办理入住的客人", 1, "1 间房"]);
  });
});

describe("the daily report message", () => {
  const { book, L } = textBook();
  const data = {
    businessDate: "2026-10-12",
    hotel: { occupancy: 62.1, roomsSold: 18, roomNights: 18, roomsAvailableNow: 9, sellable: 29 },
    guests: { checkIns: 5, checkOuts: 3, newBookings: 4, cancellations: 0, noShows: 0, inHouse: 17 },
    revenue: { roomGross: 2_000_000, roomDiscounts: 0, roomNet: 2_000_000, restaurant: 450_000, bar: 120_000, roomService: 0, transport: 0, meeting: 0, other: 0, refunds: 0, total: 2_570_000 },
    money: { collected: 1_900_000, outstanding: 640_000 },
    expenses: { total: 300_000, byCategory: [], highValue: [] },
    profitLoss: { netRevenue: 2_570_000, expenses: 300_000, estimated: 2_270_000 },
    staff: { scheduled: null, actual: [], actions: [] },
    attention: [L(msg("{n} guest(s) past checkout time"), { n: 2 }), msg("No reception shift was recorded")],
    restaurant: { orders: 14, food: 450_000, drinks: 120_000, roomService: 0 },
    i18n: book,
  } as DailyReportData;

  it("keeps its English", () => {
    const text = renderReportText(data, "Vegas Luxury Hotel", "https://x.test/staff/reports/daily/r1");
    expect(text).toContain("*Daily business report* · Mon, 12 Oct 2026");
    expect(text).toContain("*Revenue TZS 2,570,000*");
    expect(text).toContain("*Occupancy:* 18 rooms — 62.1%");
    expect(text).toContain("• 2 guest(s) past checkout time");
    expect(text).toContain("*Restaurant & bar:* 14 orders");
  });

  it("says the same numbers in Chinese", () => {
    const text = renderReportText(data, "Vegas Luxury Hotel", "https://x.test/staff/reports/daily/r1?lang=zh", zh);
    expect(text).toContain("*每日业务报告*");
    expect(text).toContain("*收入 TZS 2,570,000*");
    expect(text).toContain("• 2 位客人已过退房时间");
    expect(text).toContain("• 没有记录前台班次");
    expect(text).toContain("*餐厅与酒吧：* 14 个订单");
    const en = renderReportText(data, "Vegas Luxury Hotel", null);
    for (const n of ["2,570,000", "1,900,000", "640,000", "300,000", "2,270,000", "62.1"]) { expect(en).toContain(n); expect(text).toContain(n); }
    expect(numbers(text).length).toBeGreaterThan(5);
  });
});

describe("the weekly / monthly team message", () => {
  const team: TeamPeriodData = {
    v: 1, kind: "MONTH", from: "2026-09-01", to: "2026-09-30", label: "September 2026",
    people: [{ userId: "u1", name: "Asha Mrema", role: "Receptionist", department: "RECEPTION", reportId: "r", token: "t", shifts: 22, minutes: 10_000, headline: [{ label: msg("Guests checked in"), value: 40 }] }],
  };

  it("keeps its English and says it in Chinese", () => {
    const en = renderTeamText(team, "Vegas", null);
    expect(en).toContain("*Monthly report*\nSeptember 2026");
    expect(en).toContain("• Asha Mrema: 22 shifts, 166h 40m — 40 guests checked in");
    const cn = renderTeamText(team, "Vegas", null, zh);
    expect(cn).toContain("*月报*");
    expect(cn).toContain(periodLabel("MONTH", "2026-09-01", "2026-09-30", zh));
    expect(cn).toContain("• Asha Mrema: 22 个班次, 166h 40m — 办理入住的客人：40");
  });
});
