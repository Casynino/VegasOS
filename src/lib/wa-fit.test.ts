import { describe, expect, it } from "vitest";
import { WA_MAX_CHARS, WA_MAX_ENCODED, encodedLength, fitsWhatsApp, keepLink, reportMessage, roomRanges } from "./wa-fit";

const LINK = "https://www.vegashoteltz.com/room-report/3gLeGfpZdIZWfnSrrTlfKD03Bg8Kwg4k";
const long = (n: number, word = "Room 204 paid in cash at the desk") => Array.from({ length: n }, (_, i) => `• ${i + 1}. ${word}`);

describe("reportMessage — short, and the link always arrives", () => {
  it("puts the link last, on its own line under its label", () => {
    const text = reportMessage([["*VEGAS*", "", "*Income:* TZS 1,000"]], LINK, "Full report:");
    expect(text).toBe(`*VEGAS*\n\n*Income:* TZS 1,000\n\n*Full report:*\n${LINK}`);
  });

  it("sends the fullest version that fits", () => {
    const full = ["*VEGAS*", ...long(40)], short = ["*VEGAS*", ...long(3)];
    const text = reportMessage([full, short], LINK, "Full report:");
    expect(text).toContain("• 3. Room 204");
    expect(text).not.toContain("• 4. ");
    expect(text.endsWith(LINK)).toBe(true);
    expect(reportMessage([short, ["*VEGAS*"]], LINK, "Full report:")).toContain("• 3. Room 204");
  });

  it("leaves lines out — never the link — when even the shortest version is too long", () => {
    const text = reportMessage([["*VEGAS*", ...long(60)]], LINK, "Full report:");
    expect(fitsWhatsApp(text)).toBe(true);
    expect(text.endsWith(`\n\n*Full report:*\n${LINK}`)).toBe(true);
    expect(text.startsWith("*VEGAS*\n• 1. ")).toBe(true);
    // Whole lines only.
    expect(text.split("\n").filter((l) => l.startsWith("• ")).every((l) => l.endsWith("at the desk"))).toBe(true);
  });

  it("cuts one endless line, still with the whole link", () => {
    const text = reportMessage([["x".repeat(5000)]], LINK, "Full report:");
    expect(fitsWhatsApp(text)).toBe(true);
    expect(text.endsWith(LINK)).toBe(true);
  });

  it("counts what a Chinese message really costs to send", () => {
    expect(encodedLength("收入")).toBe(18);
    const text = reportMessage([["*酒店*", ...long(30, "客人已在前台用现金付清房费")]], `${LINK}?lang=zh`, "完整报告：");
    expect(encodedLength(text)).toBeLessThanOrEqual(WA_MAX_ENCODED);
    expect([...text].length).toBeLessThanOrEqual(WA_MAX_CHARS);
    expect(text.endsWith(`*完整报告：*\n${LINK}?lang=zh`)).toBe(true);
  });

  it("without a link it is only the summary", () => {
    expect(reportMessage([["a", null, false, undefined, "b"]], null, "Full report:")).toBe("a\nb");
  });
});

describe("keepLink — the last check before a message is sent", () => {
  it("leaves a message that fits exactly as it is", () => {
    const text = `*VEGAS*\nIncome 1,000\n\n*Full report:*\n${LINK}`;
    expect(keepLink(text)).toBe(text);
  });

  it("keeps the link of the message that arrived cut on 11 Oct 2026", () => {
    // The old room report: a long text, the link near its end, a footer under it.
    const old = ["*VEGAS LUXURY HOTEL*", "*DAILY ROOM REPORT*", ...long(30), "", "*VIEW FULL DAILY ROOM REPORT*", LINK, "", "Vegas Luxury Hotel", "Automated Management Report"].join("\n");
    expect(fitsWhatsApp(old)).toBe(false);
    const text = keepLink(old);
    expect(fitsWhatsApp(text)).toBe(true);
    expect(text.endsWith(LINK)).toBe(true);
    expect(text.startsWith("*VEGAS LUXURY HOTEL*\n*DAILY ROOM REPORT*\n• 1. ")).toBe(true);
  });

  it("keeps the label written before the link", () => {
    const text = keepLink([...long(40), "", `*Full shift report:* ${LINK}`].join("\n"));
    expect(fitsWhatsApp(text)).toBe(true);
    expect(text.endsWith(`\n\n*Full shift report:*\n${LINK}`)).toBe(true);
  });

  it("keeps what was written under a link near the top", () => {
    const text = keepLink(["*VEGAS*", `Full report: ${LINK}`, "", ...long(40)].join("\n"));
    expect(fitsWhatsApp(text)).toBe(true);
    expect(text.startsWith("*VEGAS*\n\n• 1. ")).toBe(true);
    expect(text.endsWith(`\n\nFull report:\n${LINK}`)).toBe(true);
  });

  it("shortens a long text that has no link", () => {
    expect(fitsWhatsApp(keepLink(long(60).join("\n")))).toBe(true);
  });
});

describe("roomRanges", () => {
  it("writes rooms that follow each other as a range", () => {
    expect(roomRanges(["105", "103", "104", "108"])).toBe("103-105, 108");
    expect(roomRanges(["101", "102"])).toBe("101, 102");
    expect(roomRanges(["201"])).toBe("201");
    expect(roomRanges([])).toBe("");
    expect(roomRanges(["A1", "A2", "A3", "9", "10", "11"])).toBe("9-11, A1, A2, A3");
  });
});
