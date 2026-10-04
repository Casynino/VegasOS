import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { endShift, startShift } from "@/server/services/shifts";
import {
  buildPersonPeriod, generateTeamPeriodReport, lastCompleted, periodOf, previousPeriod, renderTeamText, runStaffPeriodJob, staffReportByToken,
  type PersonPeriodData, type TeamPeriodData,
} from "@/server/services/staff-report";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { managerActor as anyManager, receptionistActor as anyReceptionist, resetBusinessData, roomType } from "../support/helpers";

/**
 * Weekly and monthly reports (owner, 2026-10-04): each person's week and month from their own records, and the report
 * the boss gets — the business (revenue, money in, expenses, rooms, restaurant) and the whole team, each person's own
 * report one tap away. Made once a period has ended, once; facts only.
 */
const TZ = "Africa/Dar_es_Salaam";
const today = () => businessDateOf(new Date());
const signed = <T extends { userId?: string | null }>(a: T) => ({ ...a, userId: a.userId! });
const managerActor = async () => signed(await anyManager()) as Awaited<ReturnType<typeof anyManager>> & { userId: string; permissions: ReadonlySet<string> };
const receptionistActor = async () => signed(await anyReceptionist()) as Awaited<ReturnType<typeof anyReceptionist>> & { userId: string; permissions: ReadonlySet<string> };
let recipients: unknown;
const SITE = process.env.NEXT_PUBLIC_SITE_URL;
process.env.NEXT_PUBLIC_SITE_URL ??= "https://hotel.example";

beforeEach(async () => {
  await resetBusinessData();
  const s = await db.hotelSettings.findFirstOrThrow();
  recipients ??= s.reportRecipients;
  // No real WhatsApp in tests.
  await db.hotelSettings.updateMany({ data: { reportRecipients: [], shiftReportEnabled: true } });
});
afterAll(async () => {
  if (SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  await db.hotelSettings.updateMany({ data: { reportRecipients: (recipients ?? []) as never } });
  await resetBusinessData();
});

/** A receptionist's shift with a check-in and a payment in it. */
async function workedShift() {
  const recep = await receptionistActor();
  await startShift(recep, {});
  const dd = await roomType("DOUBLE_DELUXE");
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: "Week Guest", phone: "0712 777 002" }, stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 2) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await managerActor(), zonedInstant(addDays(today(), -2), 12 * 60, TZ));
  await checkIn(r.id, recep, null);
  await recordReservationPayment({ reservationId: r.id, amount: 40_000, accountId: "acct_cash" }, recep);
  await endShift(recep, "");
  return recep;
}

describe("periods", () => {
  it("a week runs Monday → Sunday; a month is the calendar month; the last completed one is before today's", () => {
    expect(periodOf("WEEK", "2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" }); // a Sunday
    expect(periodOf("WEEK", "2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-11" }); // a Monday
    expect(periodOf("MONTH", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodOf("MONTH", "2026-12-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(lastCompleted("WEEK", "2026-10-05")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(lastCompleted("MONTH", "2026-10-01")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("compares with the week / month before — and, so far, with the same part of it", () => {
    expect(previousPeriod("WEEK", "2026-09-28", "2026-10-04")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(previousPeriod("WEEK", "2026-09-28", "2026-09-30")).toEqual({ from: "2026-09-21", to: "2026-09-23" }); // Mon–Wed vs Mon–Wed
    expect(previousPeriod("MONTH", "2026-10-01", "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriod("MONTH", "2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod("MONTH", "2026-02-01", "2026-02-28")).toEqual({ from: "2026-01-01", to: "2026-01-31" }); // the whole of January
    expect(previousPeriod("MONTH", "2026-03-01", "2026-03-10")).toEqual({ from: "2026-02-01", to: "2026-02-10" });
    expect(previousPeriod("MONTH", "2026-03-01", "2026-03-30")).toEqual({ from: "2026-02-01", to: "2026-02-28" }); // capped
  });
});

describe("one person's week", () => {
  it("counts their shifts, hours and what they did — the same facts as their shift reports", async () => {
    const recep = await workedShift();
    const { from } = periodOf("WEEK", today());
    const d: PersonPeriodData = await buildPersonPeriod(recep.userId, "WEEK", from, today(), { live: true });
    expect(d.department).toBe("RECEPTION");
    expect(d.totals.shifts).toBe(1);
    expect(d.shifts).toHaveLength(1);
    const head = Object.fromEntries(d.headline.map((f) => [f.label, f.value]));
    expect(head["Shifts"]).toBe(1);
    expect(head["Guests checked in"]).toBe(1);
    expect(head["Recorded in payments"]).toBe(40_000);
    // Day by day: today has the check-in and the money.
    const day = d.days.find((x) => x.date === today())!;
    expect(day.a).toBe(1);
    expect(day.money).toBe(40_000);
  });
});

describe("the boss's weekly report", () => {
  it("holds the business and the team, is made once, and opens by a private link", async () => {
    const recep = await workedShift();
    const { from, to } = periodOf("WEEK", today());
    const r = await generateTeamPeriodReport("WEEK", from, to);
    expect(r).not.toBeNull();
    const d = r!.data as unknown as TeamPeriodData;
    expect(d.business).toBeDefined();
    expect(d.business!.received).toBeGreaterThanOrEqual(40_000);
    expect(d.business!.guests.checkIns).toBeGreaterThanOrEqual(1);
    expect(d.people.map((p) => p.userId)).toEqual([recep.userId]);
    // Each person has their own report, linked from the team's.
    const own = await db.staffReport.findUniqueOrThrow({ where: { id: d.people[0].reportId } });
    expect(own.userId).toBe(recep.userId);
    expect(own.key).toBe(`WEEK:${from}:${recep.userId}`);
    // The message: the business first, then the team, then the link.
    expect(r!.summaryText).toContain("*Weekly report*");
    expect(r!.summaryText).toContain("*Revenue TZS");
    expect(r!.summaryText).toContain("*Money received:*");
    expect(r!.summaryText).toContain("*Reception*");
    expect(r!.summaryText).toMatch(/\*Full report:\* https:\/\/\S+\/staff-report\/[A-Za-z0-9_-]{24,}/);
    // Made once.
    const again = await generateTeamPeriodReport("WEEK", from, to);
    expect(again!.id).toBe(r!.id);
    expect(await db.staffReport.count({ where: { userId: null } })).toBe(1);
    // The private link.
    expect((await staffReportByToken(r!.shareToken))?.id).toBe(r!.id);
    expect(await staffReportByToken("not-a-token")).toBeNull();
    expect((await staffReportByToken(r!.shareToken, new Date(Date.now() + 60 * 86_400_000)))?.expired).toBe(true);
  });

  it("waits while a shift of the period is still open", async () => {
    const recep = await receptionistActor();
    await startShift(recep, {});
    const { from, to } = periodOf("WEEK", today());
    expect(await generateTeamPeriodReport("WEEK", from, to)).toBeNull();
    await endShift(recep, "");
    expect(await generateTeamPeriodReport("WEEK", from, to)).not.toBeNull();
  });

  it("the message stays short and always keeps its link", () => {
    const people = Array.from({ length: 80 }, (_, i) => ({ userId: `u${i}`, name: `Person number ${i} with a long name`, role: "Waiter", department: "RESTAURANT" as const, reportId: "x", token: "t", shifts: 6, minutes: 3000, headline: [{ label: "Orders handled", value: 120 }, { label: "Orders served / delivered", value: 110 }] }));
    const text = renderTeamText({ v: 1, kind: "MONTH", from: "2026-09-01", to: "2026-09-30", label: "September 2026", people }, "Vegas", "https://hotel.example/staff-report/abc");
    expect(text.length).toBeLessThanOrEqual(3500);
    expect(text.endsWith("https://hotel.example/staff-report/abc")).toBe(true);
  });
});

describe("the scheduled run", () => {
  it("makes last week's and last month's reports once; a second run makes nothing new", async () => {
    const first = await runStaffPeriodJob(new Date(), 30_000);
    expect(first.made).toHaveLength(2);
    const week = lastCompleted("WEEK", today()), month = lastCompleted("MONTH", today());
    expect(await db.staffReport.findUnique({ where: { key: `WEEK:${week.from}:TEAM` } })).not.toBeNull();
    expect(await db.staffReport.findUnique({ where: { key: `MONTH:${month.from}:TEAM` } })).not.toBeNull();
    const second = await runStaffPeriodJob(new Date(), 30_000);
    expect(second.made).toHaveLength(0);
  });
});
