import { describe, expect, it } from "vitest";
import { englishT, makeT } from "@/i18n/translate";
import { day, localizeReport, reportTr, textBook, word } from "./report-i18n";
import { formatRecipientLine, langWord, parseRecipientLine } from "./report-recipients";
import type { Report } from "./report-types";
import { formatBusinessDate } from "./format";

const zh = makeT("zh-CN", {
  "{n} guest": "{n} 位客人",
  "{n} guests": "{n} 位客人",
  "{guests} checked out still owing {amount}": "{guests}已退房但仍欠 {amount}",
  "Hotel day {date} 04:00": "酒店营业日 {date} 04:00",
  "Room {room}": "房间 {room}",
  Occupancy: "入住率",
  Total: "合计",
  Arrivals: "抵达",
  Guest: "客人",
});

describe("report sentences in the reader's language", () => {
  it("keeps the English as written and says it again with the same numbers", () => {
    const { book, L } = textBook();
    const en = L("{guests} checked out still owing {amount}", { guests: word("{n} guests", { n: 3 }), amount: "TZS 80,000" });
    expect(en).toBe("3 guests checked out still owing TZS 80,000");
    expect(reportTr(zh, book)(en)).toBe("3 位客人已退房但仍欠 TZS 80,000");
    // English readers get the text exactly as kept.
    expect(reportTr(englishT, book)(en)).toBe(en);
  });

  it("writes hotel days the reader's way", () => {
    const { book, L } = textBook();
    const en = L("Hotel day {date} 04:00", { date: day("2026-10-12") });
    expect(en).toBe(`Hotel day ${formatBusinessDate("2026-10-12")} 04:00`);
    expect(reportTr(zh, book)(en)).toBe(`酒店营业日 ${zh.date("2026-10-12")} 04:00`);
  });

  it("joins parts and falls back to the word itself (names, unknown words stay as they are)", () => {
    const { book, L } = textBook();
    const en = L("{0}, {1}", { 0: word("Room {room}", { room: "12" }), 1: word("Room {room}", { room: "14" }) });
    expect(en).toBe("Room 12, Room 14");
    const tr = reportTr(zh, book);
    expect(tr(en)).toBe("房间 12, 房间 14");
    expect(tr("Asha Mrema")).toBe("Asha Mrema");
    expect(tr("Occupancy")).toBe("入住率");
  });

  it("text without values is not kept (it translates by itself)", () => {
    const { book, L } = textBook();
    expect(L("Occupancy")).toBe("Occupancy");
    expect(book).toEqual({});
  });
});

describe("a whole report document", () => {
  const { book, L } = textBook();
  const report: Report = {
    key: "summary", title: "Daily business report", blurb: "", period: "Monday, 12 October 2026", from: "2026-10-12", to: "2026-10-12", days: 1,
    figures: [{ label: "Occupancy", value: "62%", raw: 62, sub: L("{guests} checked out still owing {amount}", { guests: word("{n} guest", { n: 1 }), amount: "TZS 5,000" }) }],
    blocks: [{ kind: "table", title: "Arrivals", columns: [{ label: "Guest" }, { label: "Total", align: "right", money: true }], rows: [["Asha Mrema", 120000]], foot: ["Total", 120000] }],
    share: "", i18n: book,
  };

  it("is shown in Chinese with every number unchanged", () => {
    const r = localizeReport(report, zh);
    expect(r.figures[0]).toMatchObject({ label: "入住率", value: "62%", raw: 62, sub: "1 位客人已退房但仍欠 TZS 5,000" });
    expect(r.period).toBe(zh.date("2026-10-12", true));
    const table = r.blocks[0];
    expect(table.kind === "table" && table.columns.map((c) => c.label)).toEqual(["客人", "合计"]);
    expect(table.kind === "table" && table.rows[0]).toEqual(["Asha Mrema", 120000]);
    expect(table.kind === "table" && table.foot).toEqual(["合计", 120000]);
  });

  it("is the very same object for English readers", () => {
    expect(localizeReport(report, englishT)).toBe(report);
  });
});

describe("report recipients typed in Settings", () => {
  it("reads a language word anywhere after the phone", () => {
    expect(parseRecipientLine("Boss, +255 710 223 344, zh")).toEqual({ name: "Boss", phone: "+255710223344", apiKeyRef: null, lang: "zh-CN" });
    expect(parseRecipientLine("Boss, +255710223344, CALLMEBOT_KEY_BOSS, 中文")).toEqual({ name: "Boss", phone: "+255710223344", apiKeyRef: "CALLMEBOT_KEY_BOSS", lang: "zh-CN" });
    expect(parseRecipientLine("Owner, +255710000000, Chinese, KEY_2")).toMatchObject({ apiKeyRef: "KEY_2", lang: "zh-CN" });
    expect(parseRecipientLine("MD, +255710000001, en")).toMatchObject({ lang: "en", apiKeyRef: null });
  });

  it("keeps old lines English and rejects a line without a phone", () => {
    expect(parseRecipientLine("Boss, +255710223344")).toEqual({ name: "Boss", phone: "+255710223344", apiKeyRef: null, lang: null });
    expect(parseRecipientLine("Boss, zh")).toBeNull();
    expect(langWord("CHINESE")).toBe("zh-CN");
    expect(langWord("CALLMEBOT_KEY")).toBeNull();
  });

  it("shows a saved recipient back the same way", () => {
    expect(formatRecipientLine({ name: "Boss", phone: "+255710223344", apiKeyRef: null, lang: "zh-CN" })).toBe("Boss, +255710223344, zh");
    expect(formatRecipientLine({ name: "Boss", phone: "+255710223344", apiKeyRef: "KEY" })).toBe("Boss, +255710223344, KEY");
    expect(formatRecipientLine({ phone: "+255710223344", lang: "en" })).toBe(", +255710223344");
    const back = parseRecipientLine(formatRecipientLine({ name: "Boss", phone: "+255710223344", apiKeyRef: "KEY", lang: "zh-CN" }));
    expect(back).toEqual({ name: "Boss", phone: "+255710223344", apiKeyRef: "KEY", lang: "zh-CN" });
  });
});
