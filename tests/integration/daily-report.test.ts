import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { generateDailyReport, runDailyReportJob } from "@/server/services/daily-report";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { resetBusinessData } from "../support/helpers";

const TZ = "Africa/Dar_es_Salaam";

beforeEach(async () => {
  await resetBusinessData();
  await db.dailyReportVersion.deleteMany();
  await db.notificationDelivery.deleteMany({ where: { purpose: "DAILY_REPORT" } });
  await db.dailyReport.deleteMany();
  await db.hotelSettings.updateMany({ data: { reportEnabled: true, reportRecipients: [] } });
});

describe("the automatic daily report", () => {
  it("07:00: made once automatically for the hotel day that just closed, with the full document; running again changes nothing; before 07:00 it only retries sending", async () => {
    const at7 = zonedInstant("2026-10-13", 7 * 60, TZ);
    const first = await runDailyReportJob(at7);
    expect(first).toMatchObject({ businessDate: "2026-10-12", generated: true });
    const r = await db.dailyReport.findUniqueOrThrow({ where: { id: first.reportId! } });
    expect(r).toMatchObject({ automatic: true, version: 1, generatedBy: "system" });
    const doc = r.document as { title: string; figures: { label: string }[]; blocks: { kind: string; title?: string }[] };
    expect(doc.title).toBe("Daily business report");
    expect(doc.figures.map((f) => f.label)).toEqual(["Income", "Expenses", "Net profit", "Money received", "Still owed", "Occupancy"]);
    for (const t of ["Money", "Rooms & guests", "Restaurant & bar", "Meeting room & transport", "Staff & records"]) expect(doc.blocks.some((b) => b.kind === "section" && b.title === t)).toBe(true);
    expect(r.summaryText).toContain("*Daily business report*");

    // Twice at 07:00 (or later that day): the same report, no new version.
    const again = await runDailyReportJob(zonedInstant("2026-10-13", 7 * 60 + 20, TZ));
    expect(again).toMatchObject({ reportId: first.reportId, generated: false });
    expect(await db.dailyReport.count()).toBe(1);
    expect(await db.dailyReportVersion.count()).toBe(0);

    // The next morning before 07:00: nothing new is made yet — the last report is only sent again where it failed.
    const morning = await runDailyReportJob(zonedInstant("2026-10-14", 5 * 60, TZ));
    expect(morning).toMatchObject({ reportId: first.reportId, generated: false });
    expect(await db.dailyReport.count()).toBe(1);
  });

  it("regenerating keeps the earlier version (who, when, why); a report made by hand is replaced by the 07:00 automatic one", async () => {
    const day = businessDateOf(zonedInstant("2026-10-14", 12 * 60, TZ));
    const manual = await generateDailyReport(day, { by: "Dev Admin (Managing Director (MD))", automatic: false, reason: null });
    expect(manual).toMatchObject({ version: 1, automatic: false });
    const redo = await generateDailyReport(day, { by: "Dev Admin (Managing Director (MD))", automatic: false, reason: "A payment was corrected" });
    expect(redo).toMatchObject({ id: manual.id, version: 2, reason: "A payment was corrected" });
    const kept = await db.dailyReportVersion.findFirstOrThrow({ where: { dailyReportId: manual.id } });
    expect(kept).toMatchObject({ version: 1, replacedBy: "Dev Admin (Managing Director (MD))" });

    const auto = await runDailyReportJob(zonedInstant(addDays(day, 1), 7 * 60, TZ));
    expect(auto).toMatchObject({ reportId: manual.id, generated: true });
    expect(await db.dailyReport.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ version: 3, automatic: true });
    expect(await db.dailyReportVersion.count({ where: { dailyReportId: manual.id } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: "report.daily_regenerated", entityId: manual.id } })).toBe(2);
  });

  it("04:05: a report made by hand earlier in the day (an unfinished picture) is never sent by the early run — only the 07:00 automatic report goes out", async () => {
    // Someone pressed "make the report" for 13 Oct while that day was still running: nothing was sent, and it holds only what was recorded so far.
    const handmade = await generateDailyReport("2026-10-13", { by: "Dev Admin (Managing Director (MD))", automatic: false, reason: null });
    expect(handmade.automatic).toBe(false);

    // 04:05 on 14 Oct (the cron that sent a report of zeros): it must not pick that report up.
    const early = await runDailyReportJob(zonedInstant("2026-10-14", 4 * 60 + 5, TZ));
    expect(early).toMatchObject({ skipped: "not yet 07:00" });
    expect(early).not.toHaveProperty("delivery");

    // 07:00: the automatic report replaces it with the real figures, and that is what is sent.
    const seven = await runDailyReportJob(zonedInstant("2026-10-14", 7 * 60, TZ));
    expect(seven).toMatchObject({ reportId: handmade.id, generated: true, businessDate: "2026-10-13" });
    expect(await db.dailyReport.findUniqueOrThrow({ where: { id: handmade.id } })).toMatchObject({ automatic: true, version: 2 });
  });
});
