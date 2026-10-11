import { describe, expect, it } from "vitest";
import { makeT } from "@/i18n/translate";
import server from "@/i18n/catalog/zh-CN/server";
import staff from "@/i18n/catalog/zh-CN/staff";
import common from "@/i18n/catalog/zh-CN/common";
import { msg } from "@/i18n/msg";
import { textBook, word } from "@/lib/report-i18n";
import { renderReportText, type DailyReportData } from "./daily-report";
import { buildShiftDocument, factLine, renderShiftReportText, type ShiftReportData } from "./shift-report";
import { periodLabel, renderPersonPeriodText, renderTeamText, type BusinessPeriod, type PersonPeriodData, type TeamPeriodData } from "./staff-report";
import { renderRoomReportText } from "./room-report";
import type { RoomReportData } from "./room-report-data";
import { withLang } from "./report-delivery";
import { fitsWhatsApp } from "@/lib/wa-fit";

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
  it("is short in English, with the link last", () => {
    const text = renderShiftReportText(shift(), "Vegas Luxury Hotel", "Africa/Dar_es_Salaam", "https://x.test/shift-report/abc");
    expect(text).toContain("*Shift completed*");
    expect(text).toContain("• 1 guest checked in");
    expect(text).toContain("• TZS 50,000 recorded in payments");
    expect(text).toContain("Business date: 12 Oct 2026");
    expect(text).toContain("_Guests in the hotel owed TZS 80,000 at the close._");
    expect(text).toContain("*Shift:* 08:00 → 16:30 (8h 30m)");
    expect(text.endsWith("\n\n*Full shift report:*\nhttps://x.test/shift-report/abc")).toBe(true);
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
    // What the hotel earned, spent and has left — one figure a line.
    expect(text).toContain("*Income:* TZS 2,570,000\n  Rooms 2,000,000 · Restaurant 450,000 · Bar 120,000\n*Expenses:* TZS 300,000\n*Net profit:* TZS 2,270,000\n*Money received:* TZS 1,900,000\n*Still owed:* TZS 640,000");
    expect(text).toContain("*Occupancy:* 18 rooms — 62.1%");
    expect(text).toContain("• 2 guest(s) past checkout time");
    expect(text).toContain("*Restaurant & bar:* 14 orders");
    // The link is the last thing in the message, under its own label.
    expect(text.endsWith("\n\n*Full report:*\nhttps://x.test/staff/reports/daily/r1")).toBe(true);
  });

  it("says the same numbers in Chinese", () => {
    const text = renderReportText(data, "Vegas Luxury Hotel", "https://x.test/staff/reports/daily/r1?lang=zh", zh);
    expect(text).toContain("*每日业务报告*");
    expect(text).toContain("*收入：* TZS 2,570,000\n*支出：* TZS 300,000\n*净利润：* TZS 2,270,000\n*已收款项：* TZS 1,900,000\n*仍欠：* TZS 640,000");
    // Chinese costs more to send, so the message keeps the money and the link; the rest is in the full report.
    expect(fitsWhatsApp(text)).toBe(true);
    expect(text.endsWith("\n\n*完整报告：*\nhttps://x.test/staff/reports/daily/r1?lang=zh")).toBe(true);
    const en = renderReportText(data, "Vegas Luxury Hotel", null);
    for (const n of ["2,570,000", "1,900,000", "640,000", "300,000", "2,270,000"]) { expect(en).toContain(n); expect(text).toContain(n); }
    expect(numbers(text).length).toBeGreaterThanOrEqual(5);
  });

  it("never leaves a heading with nothing under it when it is shortened", () => {
    // Long attention items: the short form is one line that reads on its own.
    const { book, L } = textBook();
    const long = { ...data, attention: [L(msg("Handover note: {note}"), { note: "x".repeat(400) }), msg("No reception shift was recorded")], i18n: book } as unknown as DailyReportData;
    const text = renderReportText(long, "Vegas Luxury Hotel", "https://x.test/daily-report/r1");
    expect(text).toContain("*Attention:* 2 in the full report");
    expect(text).not.toContain("*Attention (2)*");
    expect(text.endsWith("\n\n*Full report:*\nhttps://x.test/daily-report/r1")).toBe(true);
    for (const line of renderReportText(long, "Vegas Luxury Hotel", "https://x.test/daily-report/r1?lang=zh", zh).split("\n")) expect(line).not.toBe("*需要关注（2）*");
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

// ───────────────────────── Short, and the link always arrives ─────────────────────────

const LINK = "https://www.vegashoteltz.com/room-report/3gLeGfpZdIZWfnSrrTlfKD03Bg8Kwg4k";
const tail = (label: string, link = LINK) => `\n\n*${label}*\n${link}`;

describe("the daily room report message", () => {
  const sale = (room: string, type: string) => ({ room, type, checkedInAt: "2026-10-09T12:00:00.000Z", nights: 1, dayUse: false, rate: 100_000, mixed: false, total: 100_000, gross: 100_000, discount: 0, reference: `R-${room}`, by: "Asha" });
  const report = (rooms: [string, string][], withDay = true): RoomReportData => ({
    date: "2026-10-09", periodStart: "2026-10-09T01:00:00.000Z", periodEnd: "2026-10-10T01:00:00.000Z", generatedAt: "2026-10-10T03:30:00.000Z", timezone: "Africa/Dar_es_Salaam",
    guestRooms: 29,
    perf: { occupied: 27, newSales: rooms.length, continuing: Math.max(0, 27 - rooms.length), checkedOut: 5, available: 2, occupancyPct: 93, nightsSold: rooms.length },
    money: { expected: 2_600_000, gross: 2_600_000, discounts: 0, recognized: 2_600_000, collected: 2_000_000, refunds: 0, reversed: 0, outstanding: 600_000 },
    ...(withDay ? { day: { income: { rooms: 2_300_000, restaurant: 200_000, bar: 45_000, roomService: 0, meeting: 0, transport: 0, other: 0, refunds: 0, total: 2_545_000 }, expenses: { total: 120_000, byCategory: [] }, profit: 2_425_000, received: 2_605_000, owed: 688_000 } } : {}),
    sales: rooms.map(([room, type]) => sale(room, type)),
    rates: [], continuing: [], checkouts: [], status: [], trend: [], staff: [], unknownRates: 0,
  });

  it("is the day in a few lines, room numbers written out, the link last", () => {
    const text = renderRoomReportText(report([["104", "Double Deluxe"], ["103", "Double Deluxe"], ["201", "Executive Suite"]]), "Vegas Luxury Hotel", LINK);
    expect(text).toBe([
      "*VEGAS LUXURY HOTEL*",
      "*Daily room report* · 9 Oct 2026",
      "",
      "*Rooms occupied:* 27 of 29 (93%)",
      "*New check-ins:* 3",
      "*Continuing stays:* 24",
      "*Checked out:* 5",
      "",
      "*Income:* TZS 2,545,000",
      "*Expenses:* TZS 120,000",
      "*Net profit:* TZS 2,425,000",
      "*Money received:* TZS 2,605,000",
      "*Still owed:* TZS 688,000",
      "",
      "*Rooms sold today*",
      "• Double Deluxe (2): 103, 104",
      "• Executive Suite (1): 201",
      "",
      "*Full report:*",
      LINK,
    ].join("\n"));
    expect(fitsWhatsApp(text)).toBe(true);
  });

  it("still arrives whole, with its link, on a day every room was sold", () => {
    const rooms: [string, string][] = [
      ...Array.from({ length: 12 }, (_, i): [string, string] => [String(101 + i), "Double Deluxe"]),
      ...Array.from({ length: 8 }, (_, i): [string, string] => [String(201 + i * 2), "Twin Executive Room"]),
      ...Array.from({ length: 6 }, (_, i): [string, string] => [String(301 + i), "Executive Suite"]),
      ...Array.from({ length: 3 }, (_, i): [string, string] => [String(401 + i * 3), "Standard Single Room"]),
    ];
    const text = renderRoomReportText(report(rooms), "Vegas Luxury Hotel", LINK);
    expect(fitsWhatsApp(text)).toBe(true);
    expect(text.endsWith(tail("Full report:"))).toBe(true);
    expect(text).toContain("*Net profit:* TZS 2,425,000");
    // Every room type is named with its rooms.
    expect(text).toContain("• Double Deluxe (12): 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112");
    expect(text).toContain("• Standard Single Room (3): 401, 404, 407");

    // With less room (a long hotel name), the same rooms are written as ranges — and the link still arrives.
    const tight = renderRoomReportText(report(rooms), "Vegas Luxury Hotel & Conference Centre, Dar es Salaam — Kariakoo Branch", LINK);
    expect(fitsWhatsApp(tight)).toBe(true);
    expect(tight.endsWith(tail("Full report:"))).toBe(true);
    expect(tight).toContain("• Double Deluxe (12): 101-112");
    expect(tight).toContain("• Executive Suite (6): 301-306");
    expect(tight).toContain("*Still owed:* TZS 688,000");
  });

  it("shows a loss with its sign, and an older report without the day's money", () => {
    const loss = report([["103", "Double Deluxe"]]);
    loss.day!.profit = -80_000;
    expect(renderRoomReportText(loss, "Vegas", LINK)).toContain("*Net profit:* − TZS 80,000");
    const old = renderRoomReportText(report([["103", "Double Deluxe"]], false), "Vegas", null);
    expect(old).toContain("*Room income:* TZS 2,600,000\n*Money received:* TZS 2,000,000\n*Still owed:* TZS 600,000");
    expect(old).not.toContain("http");
  });
});

describe("every report message arrives whole, the link last — also on the longest day", () => {
  const fact = (label: string, value: number, money = false) => ({ label: msg(label), value, ...(money ? { money: true } : {}) });
  const FACTS = [fact("Guests checked in", 14), fact("Recorded in payments", 3_450_000, true), fact("Guests checked in", 11), fact("Recorded in payments", 980_000, true), fact("Guests checked in", 9), fact("Recorded in payments", 120_000, true), fact("Guests checked in", 7), fact("Recorded in payments", 60_000, true), fact("Guests checked in", 3)];
  const note = "The guest in room 204 will pay the balance tomorrow morning before nine; the manager agreed and the receipt book is in the top drawer. ".repeat(3);
  const business: BusinessPeriod = {
    revenue: { total: 78_450_000, prev: 70_100_000, rooms: 52_000_000, restaurant: 14_000_000, bar: 6_450_000, roomService: 2_000_000, meeting: 1_500_000, transport: 1_500_000, other: 1_000_000, discounts: 400_000, refunds: 250_000 },
    received: 74_000_000, prevReceived: 69_000_000, expenses: 21_300_000, prevExpenses: 19_000_000, result: 57_150_000, prevResult: 51_100_000, outstanding: 4_450_000,
    rooms: { occupancy: 81.4, prevOccupancy: 77, roomNights: 708, sellable: 870, adr: 73_446 },
    guests: { checkIns: 412, checkOuts: 405, newBookings: 388, cancellations: 9, noShows: 4 },
    restaurant: { orders: 1_904, prevOrders: 1_700, sales: 22_450_000, averageOrder: 11_790, best: [] },
    expensesByCategory: [], days: [],
  };
  const people = (n: number): TeamPeriodData["people"] => Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`, name: `Mwanaidi Abdallah Kilonzo ${i + 1}`, role: "Receptionist", department: i % 2 ? "RESTAURANT" as const : "RECEPTION" as const, reportId: "r", token: "t", shifts: 22, minutes: 10_000, headline: FACTS.slice(0, 4),
  }));
  const arrives = (text: string, label: string, link = LINK) => { expect(fitsWhatsApp(text)).toBe(true); expect(text.endsWith(tail(label, link))).toBe(true); };

  it("the shift report", () => {
    const d = shift();
    d.headline = FACTS; d.shift.byManager = true; d.shift.closedBy = "Mariam Juma"; d.shift.closeReason = note;
    const { book, L } = textBook();
    d.handover = [L(msg("Handover note: {note}"), { note }), L(msg("Handover note: {note}"), { note })]; d.i18n = book;
    const en = renderShiftReportText(d, "Vegas Luxury Hotel", "Africa/Dar_es_Salaam", LINK);
    arrives(en, "Full shift report:");
    expect(en).toContain("• 14 guests checked in");
    arrives(renderShiftReportText(d, "Vegas Luxury Hotel", "Africa/Dar_es_Salaam", `${LINK}?lang=zh`, zh), "完整班次报告：", `${LINK}?lang=zh`);
  });

  it("the daily report", () => {
    const { book, L } = textBook();
    const busy = {
      businessDate: "2026-10-12",
      hotel: { occupancy: 100, roomsSold: 29, roomNights: 29, roomsAvailableNow: 0, sellable: 29 },
      rooms: { occupied: 29, total: 29, adr: 88_000 },
      guests: { checkIns: 26, checkOuts: 24, newBookings: 31, cancellations: 2, noShows: 1, inHouse: 54 },
      revenue: { roomGross: 2_600_000, roomDiscounts: 150_000, roomNet: 2_450_000, restaurant: 1_450_000, bar: 920_000, roomService: 310_000, transport: 240_000, meeting: 600_000, other: 85_000, refunds: 0, total: 6_055_000 },
      money: { collected: 5_900_000, outstanding: 1_640_000 },
      expenses: { total: 2_300_000, byCategory: [], highValue: [] },
      profitLoss: { netRevenue: 6_055_000, expenses: 2_300_000, estimated: 3_755_000 },
      staff: { scheduled: null, actual: [], actions: [] },
      attention: [L(msg("Handover note: {note}"), { note }), msg("No reception shift was recorded"), msg("No reception shift was recorded")],
      restaurant: { orders: 214, food: 1_450_000, drinks: 920_000, roomService: 310_000 },
      i18n: book,
    } as unknown as DailyReportData;
    const en = renderReportText(busy, "Vegas Luxury Hotel", LINK);
    arrives(en, "Full report:");
    expect(en).toContain("*Income:* TZS 6,055,000");
    expect(en).toContain("*Net profit:* TZS 3,755,000");
    arrives(renderReportText(busy, "Vegas Luxury Hotel", `${LINK}?lang=zh`, zh), "完整报告：", `${LINK}?lang=zh`);
  });

  it("the weekly / monthly report", () => {
    const d: TeamPeriodData = { v: 1, kind: "MONTH", from: "2026-09-01", to: "2026-09-30", label: "September 2026", business, people: people(14) };
    const en = renderTeamText(d, "Vegas Luxury Hotel", LINK);
    arrives(en, "Full report:");
    expect(en).toContain("*Income:* TZS 78,450,000 (+12%)\n*Expenses:* TZS 21,300,000\n*Net profit:* TZS 57,150,000\n*Money received:* TZS 74,000,000\n*Still owed (today):* TZS 4,450,000");
    arrives(renderTeamText(d, "Vegas Luxury Hotel", `${LINK}?lang=zh`, zh), "完整报告：", `${LINK}?lang=zh`);
    // A small team is listed by name.
    const small = renderTeamText({ ...d, people: people(2) }, "Vegas Luxury Hotel", LINK);
    arrives(small, "Full report:");
    expect(small).toContain("• Mwanaidi Abdallah Kilonzo 1: 22 shifts, 166h 40m");
  });

  it("one person's week or month", () => {
    const d = { v: 1, kind: "WEEK", from: "2026-10-05", to: "2026-10-11", label: "5 Oct 2026 – 11 Oct 2026", person: { id: "u1", name: "Mwanaidi Abdallah Kilonzo", role: "Receptionist" }, department: "RECEPTION", totals: { shifts: 6, minutes: 3_000, days: 6 }, headline: [...FACTS, ...FACTS], groups: [], money: null, records: [], days: [], series: { a: "", b: "" }, shifts: [] } as unknown as PersonPeriodData;
    arrives(renderPersonPeriodText(d, "Vegas Luxury Hotel", LINK), "Full report:");
    arrives(renderPersonPeriodText(d, "Vegas Luxury Hotel", `${LINK}?lang=zh`, zh), "完整报告：", `${LINK}?lang=zh`);
  });
});
