import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { deliverRoomReportByDate, runRoomReportJob } from "@/server/services/room-report";
import { runDailyReportJob } from "@/server/services/daily-report";
import { reportTroubles } from "@/server/services/report-health";
import { eat, resetBusinessData } from "../support/helpers";

/**
 * The Boss's morning, hour by hour (owner, 2026-10-14: a report of zeros reached the Boss at 04:05 for a day that had sales).
 * The cron times are the ones in vercel.json (UTC → Dar es Salaam): daily 04:05 · 06:15 · 07:00 · 07:35 · 10:00 · 21:00, room 06:30 · 06:50 · 08:00.
 * The WhatsApp provider is replaced by a recorder, so what the Boss would have received is known exactly.
 */
const sent: { at: number; text: string }[] = [];
vi.mock("@/server/services/messaging", async (orig) => ({
  ...(await orig<typeof import("@/server/services/messaging")>()),
  sendMessage: vi.fn(async (req: { text: string }) => { sent.push({ at: Date.now(), text: req.text }); return { ok: true, response: "ok" }; }),
}));

const isDaily = (text: string) => text.includes("Daily business report");
const at = (iso: string) => { const t = eat(iso); vi.setSystemTime(t); return t; };

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], now: eat("2026-10-13T09:00:00") }); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(async () => {
  sent.length = 0;
  vi.setSystemTime(eat("2026-10-13T09:00:00"));
  await resetBusinessData();
  await db.dailyReportVersion.deleteMany();
  await db.notificationDelivery.deleteMany({ where: { purpose: { in: ["DAILY_REPORT", "ROOM_REPORT"] } } });
  await db.roomReport.deleteMany();
  await db.dailyReport.deleteMany();
  await db.hotelSettings.updateMany({ data: { reportEnabled: true, roomReportEnabled: true, reportRecipients: [{ name: "Boss", phone: "255700000001", channel: "WHATSAPP_CALLMEBOT", apiKeyRef: null }] } });
});

describe("the Boss's morning reports", () => {
  it("a room report sent by hand while the day was still running never replaces the real one: the Boss gets exactly one daily report (at 07:00) and the final room report (at 06:30)", async () => {
    // 13 Oct, 15:00 — someone sends the room report by hand for the day that is still running. (It also leaves an empty placeholder daily report.)
    at("2026-10-13T15:00:00");
    await deliverRoomReportByDate("2026-10-13", { manual: true });
    expect(sent).toHaveLength(1);
    const early = await db.roomReport.findUniqueOrThrow({ where: { businessDate: new Date("2026-10-13T00:00:00Z") } });
    expect(early).toMatchObject({ version: 1, automatic: false });

    // 14 Oct — every scheduled run of the morning, in order.
    const dayClosed = eat("2026-10-14T04:00:00").getTime();
    const daily = async (time: string) => { await runDailyReportJob(at(`2026-10-14T${time}`)); };
    const room = async (time: string) => { await runRoomReportJob(at(`2026-10-14T${time}`)); };
    await daily("04:05:00");
    // 04:05: nothing goes out — the day only just closed, and the hand-made placeholder is not a report.
    expect(sent.filter((m) => isDaily(m.text))).toHaveLength(0);
    await daily("06:15:00");
    await room("06:30:00");
    await room("06:50:00");
    await daily("07:00:00");
    await daily("07:35:00");
    await room("08:00:00");
    await daily("10:00:00");
    at("2026-10-14T21:00:00");
    await runDailyReportJob(new Date());

    // The daily report: ONE message, sent at 07:00, made after the day closed.
    const dailyMessages = sent.filter((m) => isDaily(m.text));
    expect(dailyMessages).toHaveLength(1);
    expect(dailyMessages[0].at).toBe(eat("2026-10-14T07:00:00").getTime());
    const d = await db.dailyReport.findUniqueOrThrow({ where: { businessDate: new Date("2026-10-13T00:00:00Z") } });
    expect(d).toMatchObject({ automatic: true });
    expect(d.generatedAt.getTime()).toBeGreaterThanOrEqual(dayClosed);

    // The room report: the early one (15:00) and the real one (06:30) — and nothing after.
    const roomMessages = sent.filter((m) => !isDaily(m.text));
    expect(roomMessages.map((m) => m.at)).toEqual([eat("2026-10-13T15:00:00").getTime(), eat("2026-10-14T06:30:00").getTime()]);
    const r = await db.roomReport.findUniqueOrThrow({ where: { businessDate: new Date("2026-10-13T00:00:00Z") } });
    expect(r).toMatchObject({ version: 2, automatic: true });
    expect(r.generatedAt.getTime()).toBeGreaterThanOrEqual(dayClosed);
    expect((r.history as unknown[]).length).toBe(1);

    // The Boss's home has nothing to warn about.
    expect(await reportTroubles(eat("2026-10-14T09:00:00"))).toEqual({ daily: null, room: null });
  });

  it("with no reports at all, the Boss's home says so once the time has passed — the room report from 07:00, the daily report from 08:00", async () => {
    expect(await reportTroubles(eat("2026-10-14T06:00:00"))).toEqual({ daily: null, room: null });
    expect(await reportTroubles(eat("2026-10-14T07:30:00"))).toEqual({ daily: null, room: { kind: "missing" } });
    expect(await reportTroubles(eat("2026-10-14T09:00:00"))).toEqual({ daily: { kind: "missing", id: null }, room: { kind: "missing" } });
  });

  it("between 00:00 and 03:59 the hotel day is still yesterday, but a report that was due the morning before is already late — decided from the due instant, not the clock hour", async () => {
    // 14 Oct 02:00: the hotel day is still the 13th, so the last closed day is the 12th, whose reports were due on the 13th (room 07:00, daily 08:00).
    expect(await reportTroubles(eat("2026-10-14T02:00:00"))).toEqual({ daily: { kind: "missing", id: null }, room: { kind: "missing" } });
    expect(await reportTroubles(eat("2026-10-14T00:00:00"))).toEqual({ daily: { kind: "missing", id: null }, room: { kind: "missing" } });
    expect(await reportTroubles(eat("2026-10-14T03:59:00"))).toEqual({ daily: { kind: "missing", id: null }, room: { kind: "missing" } });
    // 04:00 the day turns: the 13th is the last closed day and its reports are not due until the morning
    expect(await reportTroubles(eat("2026-10-14T04:00:00"))).toEqual({ daily: null, room: null });
    expect(await reportTroubles(eat("2026-10-14T06:00:00"))).toEqual({ daily: null, room: null });
    // a report that was made for the 12th but never sent is "unsent" at 02:00 too
    const made = await db.dailyReport.create({ data: { businessDate: new Date("2026-10-12T00:00:00Z"), data: {}, summaryText: "x", generatedAt: eat("2026-10-13T07:00:00"), automatic: true } });
    expect(await reportTroubles(eat("2026-10-14T02:00:00"))).toEqual({ daily: { kind: "unsent", id: made.id }, room: { kind: "missing" } });
  });

  it("a report that exists but never reached the Boss is flagged with its own page; one that reached him is not; nobody to receive them means no warning", async () => {
    at("2026-10-14T07:00:00");
    // The report is made, but the provider is down: nothing is sent.
    const m = await import("@/server/services/messaging");
    vi.mocked(m.sendMessage).mockImplementation(async () => ({ ok: false, error: "provider down" }));
    await runDailyReportJob(new Date());
    const made = await db.dailyReport.findUniqueOrThrow({ where: { businessDate: new Date("2026-10-13T00:00:00Z") }, select: { id: true } });
    expect((await reportTroubles(eat("2026-10-14T07:10:00"))).daily).toEqual({ kind: "failed", id: made.id });

    // The provider is back: the 07:35 retry reaches the Boss and the warning goes.
    vi.mocked(m.sendMessage).mockImplementation(async (req: { text: string }) => { sent.push({ at: Date.now(), text: req.text }); return { ok: true, response: "ok" }; });
    await runDailyReportJob(at("2026-10-14T07:35:00"));
    expect((await reportTroubles(eat("2026-10-14T09:00:00"))).daily).toBeNull();
    expect(sent.filter((x) => isDaily(x.text))).toHaveLength(1);

    await db.hotelSettings.updateMany({ data: { reportRecipients: [] } });
    expect(await reportTroubles(eat("2026-10-15T09:00:00"))).toEqual({ daily: null, room: null });
  });
});
