import { describe, expect, it } from "vitest";
import { reportTrouble, type ReportFacts } from "./report-trouble";

const made = new Date("2026-10-14T04:00:00Z");
const base: ReportFacts = { enabled: true, hasRecipients: true, hour: 9, dueByHour: 8, report: { generatedAt: made, deliveries: [] } };
const sent = (at: string) => ({ status: "SENT", sentAt: new Date(at) });

describe("what is wrong with a report meant for the Boss", () => {
  it("nothing when it reached the Boss (a send of THIS version)", () => {
    expect(reportTrouble({ ...base, report: { generatedAt: made, deliveries: [sent("2026-10-14T04:05:00Z")] } })).toBeNull();
  });
  it("an earlier version's send does not count: a report made again must be sent again", () => {
    expect(reportTrouble({ ...base, report: { generatedAt: made, deliveries: [sent("2026-10-14T01:05:00Z")] } })).toBe("unsent");
  });
  it("a failed send is flagged at once, before the report's time", () => {
    expect(reportTrouble({ ...base, hour: 5, report: { generatedAt: made, deliveries: [{ status: "FAILED", sentAt: null }] } })).toBe("failed");
  });
  it("a report that is made but not sent is flagged only once its time has passed", () => {
    expect(reportTrouble({ ...base, hour: 7 })).toBeNull();
    expect(reportTrouble({ ...base, hour: 8 })).toBe("unsent");
  });
  it("a report that was never made is flagged only once its time has passed", () => {
    expect(reportTrouble({ ...base, hour: 7, report: null })).toBeNull();
    expect(reportTrouble({ ...base, hour: 8, report: null })).toBe("missing");
  });
  it("says nothing when reports are off or nobody receives them", () => {
    expect(reportTrouble({ ...base, report: null, enabled: false })).toBeNull();
    expect(reportTrouble({ ...base, report: null, hasRecipients: false })).toBeNull();
  });
  it("a failed attempt followed by a later successful one is fine", () => {
    expect(reportTrouble({ ...base, report: { generatedAt: made, deliveries: [{ status: "FAILED", sentAt: null }, sent("2026-10-14T05:00:00Z")] } })).toBeNull();
  });
});
