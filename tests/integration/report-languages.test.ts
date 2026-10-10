import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// No real WhatsApp: every message the reports send is caught here (to whom, and what it says).
const sent: { to: string; text: string }[] = [];
vi.mock("@/server/services/messaging", () => ({
  sendMessage: vi.fn(async (req: { to: string; text: string }) => { sent.push({ to: req.to, text: req.text }); return { ok: true, response: "queued" }; }),
}));

import { db } from "@/server/db";
import { deliverDailyReport, generateDailyReport } from "@/server/services/daily-report";
import { afterShiftClosed } from "@/server/services/shift-report";
import { endShift, startShift } from "@/server/services/shifts";
import { businessDateOf } from "@/lib/time/business-date";
import { receptionistActor as anyReceptionist, resetBusinessData } from "../support/helpers";

/**
 * Reports in each recipient's language (owner, 2026-10-06): the boss reads them in Chinese while the MD reads English —
 * one report, the same numbers, only the words (and the link's ?lang=zh) differ.
 */
const EN = "+255710000001";
const ZH = "+255710000002";
let recipients: unknown;
const SITE = process.env.NEXT_PUBLIC_SITE_URL;
process.env.NEXT_PUBLIC_SITE_URL ??= "https://hotel.example";
const amounts = (s: string) => [...s.matchAll(/TZS\s?−?[\d,]+/g)].map((m) => m[0].replace(/\s/g, ""));

beforeEach(async () => {
  await resetBusinessData();
  sent.length = 0;
  const s = await db.hotelSettings.findFirstOrThrow();
  recipients ??= s.reportRecipients;
  await db.hotelSettings.updateMany({
    data: { reportEnabled: true, shiftReportEnabled: true, reportRecipients: [{ name: "MD", phone: EN, channel: "WHATSAPP_CALLMEBOT" }, { name: "Boss", phone: ZH, channel: "WHATSAPP_CALLMEBOT", lang: "zh-CN" }] },
  });
});

afterAll(async () => {
  if (recipients !== undefined) await db.hotelSettings.updateMany({ data: { reportRecipients: recipients as object } });
  if (SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("the daily report goes to each recipient in their language", () => {
  it("English as kept, Chinese for the Chinese reader — the same amounts, a Chinese link", async () => {
    const report = await generateDailyReport(businessDateOf(new Date()), { by: "Test", automatic: false });
    await deliverDailyReport(report.id, { manual: true });
    const en = sent.find((m) => m.to === EN)!;
    const zh = sent.find((m) => m.to === ZH)!;
    expect(en.text).toBe(report.summaryText);
    expect(en.text).toContain("*Daily business report*");
    expect(zh.text).toContain("*每日业务报告*");
    expect(zh.text).not.toContain("*Daily business report*");
    expect(zh.text).toMatch(/\/staff\/reports\/daily\/\S+\?lang=zh/);
    expect(amounts(zh.text)).toEqual(amounts(en.text));
    // The report itself (its version and figures) is untouched by the language.
    expect((await db.dailyReport.findUniqueOrThrow({ where: { id: report.id } })).summaryText).toBe(report.summaryText);
    expect(await db.notificationDelivery.count({ where: { dailyReportId: report.id, status: "SENT" } })).toBe(2);
  });
});

describe("a shift report goes to each recipient in their language", () => {
  it("the boss gets it in Chinese with the private link in Chinese", async () => {
    const recep = { ...(await anyReceptionist()) } as Awaited<ReturnType<typeof anyReceptionist>> & { userId: string; permissions: ReadonlySet<string> };
    await startShift(recep, {});
    const { shiftId } = await endShift(recep, "");
    const report = await afterShiftClosed(shiftId);
    expect(report).not.toBeNull();
    const en = sent.find((m) => m.to === EN)!;
    const zh = sent.find((m) => m.to === ZH)!;
    expect(en.text).toContain("*Shift completed*");
    expect(zh.text).toContain("*班次已结束*");
    expect(zh.text).toContain(`/shift-report/${report!.shareToken}?lang=zh`);
    expect(en.text).toContain(`/shift-report/${report!.shareToken}`);
    expect(en.text).not.toContain("?lang=zh");
  });
});
