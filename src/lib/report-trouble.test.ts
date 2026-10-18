import { describe, expect, it } from "vitest";
import { reportDueAt, reportIsLate, reportTrouble, type ReportFacts } from "./report-trouble";

const made = new Date("2026-10-14T04:00:00Z");
const base: ReportFacts = { enabled: true, hasRecipients: true, late: true, report: { generatedAt: made, deliveries: [] } };
const sent = (at: string) => ({ status: "SENT", sentAt: new Date(at) });

describe("what is wrong with a report meant for the Boss", () => {
  it("nothing when it reached the Boss (a send of THIS version)", () => {
    expect(reportTrouble({ ...base, report: { generatedAt: made, deliveries: [sent("2026-10-14T04:05:00Z")] } })).toBeNull();
  });
  it("an earlier version's send does not count: a report made again must be sent again", () => {
    expect(reportTrouble({ ...base, report: { generatedAt: made, deliveries: [sent("2026-10-14T01:05:00Z")] } })).toBe("unsent");
  });
  it("a failed send is flagged at once, before the report's time", () => {
    expect(reportTrouble({ ...base, late: false, report: { generatedAt: made, deliveries: [{ status: "FAILED", sentAt: null }] } })).toBe("failed");
  });
  it("a report that is made but not sent is flagged only once its time has passed", () => {
    expect(reportTrouble({ ...base, late: false })).toBeNull();
    expect(reportTrouble({ ...base, late: true })).toBe("unsent");
  });
  it("a report that was never made is flagged only once its time has passed", () => {
    expect(reportTrouble({ ...base, late: false, report: null })).toBeNull();
    expect(reportTrouble({ ...base, late: true, report: null })).toBe("missing");
  });
  it("says nothing when reports are off or nobody receives them", () => {
    expect(reportTrouble({ ...base, report: null, enabled: false })).toBeNull();
    expect(reportTrouble({ ...base, report: null, hasRecipients: false })).toBeNull();
  });
  it("a failed attempt followed by a later successful one is fine", () => {
    expect(reportTrouble({ ...base, report: { generatedAt: made, deliveries: [{ status: "FAILED", sentAt: null }, sent("2026-10-14T05:00:00Z")] } })).toBeNull();
  });
});

describe("when a report is due: an INSTANT, not a clock hour", () => {
  const tz = "Africa/Dar_es_Salaam"; // UTC+3, no daylight saving
  it("the report of business day X is due on the NEXT calendar day, from its hour, in the hotel's time", () => {
    expect(reportDueAt("2026-10-13", 8, tz).toISOString()).toBe("2026-10-14T05:00:00.000Z"); // 14 Oct 08:00 hotel time
    expect(reportDueAt("2026-10-13", 7, tz).toISOString()).toBe("2026-10-14T04:00:00.000Z");
    expect(reportDueAt("2026-12-31", 8, tz).toISOString()).toBe("2027-01-01T05:00:00.000Z"); // across a year
  });
  it("is late from the due instant on, and not a minute before", () => {
    expect(reportIsLate("2026-10-13", new Date("2026-10-14T04:59:59Z"), 8, tz)).toBe(false);
    expect(reportIsLate("2026-10-13", new Date("2026-10-14T05:00:00Z"), 8, tz)).toBe(true);
  });
  it("between 00:00 and 03:59 the report of the day before yesterday is already late (the business date is still yesterday's)", () => {
    // 14 Oct 02:00 hotel time: the hotel day is still the 13th, so the last closed day is the 12th, whose report was due on the 13th at 08:00
    const now = new Date("2026-10-13T23:00:00Z");
    expect(reportIsLate("2026-10-12", now, 8, tz)).toBe(true);
    expect(reportIsLate("2026-10-12", now, 7, tz)).toBe(true);
    // ...while the 13th's own report is not due before 14 Oct 08:00
    expect(reportIsLate("2026-10-13", now, 8, tz)).toBe(false);
  });
  it("a day long past is late at any hour", () => {
    expect(reportIsLate("2026-10-01", new Date("2026-10-14T00:30:00Z"), 8, tz)).toBe(true);
  });
});
