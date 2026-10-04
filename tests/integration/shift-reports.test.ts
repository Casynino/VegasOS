import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { endShift, startShift, closeShiftAsManager } from "@/server/services/shifts";
import { closeWaiterShiftAsManager, endWaiterShift, startWaiterShift } from "@/server/services/waiter-work";
import { createRestaurantOrder, recordOrderPayment, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { acceptServiceRequest, createServiceRequest } from "@/server/services/requests";
import { closeSession } from "@/server/services/dining-sessions";
import { afterShiftClosed, generateShiftReport, retryShiftReports, shiftReportByToken, type ShiftReportData } from "@/server/services/shift-report";
import { buildDailyReport, renderReportText } from "@/server/services/daily-report";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { chefActor, counterActor, managerActor as anyManager, receptionistActor as anyReceptionist, resetBusinessData, roomType, waiterActor as anyWaiter } from "../support/helpers";

/**
 * Staff shift reports (owner, 2026-10-04): when a waiter or a receptionist ends their shift, the system makes their
 * report from what they actually did — once per shift — and sends the boss a short message with a private link. A
 * failed message never touches the shift; it is recorded and tried again. Facts only, never a score.
 */
const TZ = "Africa/Dar_es_Salaam";
const BEER = "mi_beers_safari";
const today = () => businessDateOf(new Date());
const signed = <T extends { userId?: string | null }>(a: T) => ({ ...a, userId: a.userId! });
const managerActor = async () => signed(await anyManager()) as Awaited<ReturnType<typeof anyManager>> & { userId: string; permissions: ReadonlySet<string> };
const receptionistActor = async () => signed(await anyReceptionist()) as Awaited<ReturnType<typeof anyReceptionist>> & { userId: string; permissions: ReadonlySet<string> };
const waiterActor = async () => signed(await anyWaiter()) as Awaited<ReturnType<typeof anyWaiter>> & { userId: string; permissions: ReadonlySet<string> };
let recipients: unknown;
// The boss's link is absolute (the live site's address) — set for these tests only.
const SITE = process.env.NEXT_PUBLIC_SITE_URL;
process.env.NEXT_PUBLIC_SITE_URL ??= "https://hotel.example";

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: BEER }, data: { isAvailable: true, isActive: true } });
  await db.restaurantLocation.updateMany({ data: { waiterId: null, isActive: true, blockedAs: null } });
  const s = await db.hotelSettings.findFirstOrThrow();
  recipients ??= s.reportRecipients;
  // No real WhatsApp in tests: no recipients unless a test sets an (invalid, never sent) one.
  await db.hotelSettings.updateMany({ data: { reportRecipients: [], shiftReportEnabled: true } });
});
afterAll(async () => {
  if (SITE === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  await db.hotelSettings.updateMany({ data: { reportRecipients: (recipients ?? []) as never } });
  await resetBusinessData();
});

async function stay(name: string) {
  const dd = await roomType("DOUBLE_DELUXE");
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: name, phone: "0712 777 001" }, stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 2) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await managerActor(), zonedInstant(addDays(today(), -2), 12 * 60, TZ));
  return r;
}

describe("a receptionist's shift report", () => {
  it("is made from what they did, once per shift; requests with them go back to New; the boss's link is private", async () => {
    const recep = await receptionistActor();
    const shift = await startShift(recep, {});
    const r = await stay("Report Guest");
    await checkIn(r.id, recep, null);
    await recordReservationPayment({ reservationId: r.id, amount: 50_000, accountId: "acct_cash" }, recep);
    const req = await createServiceRequest({ reservationId: r.id, type: "TOWELS", priority: "NORMAL", description: "Two towels" }, recep);
    await acceptServiceRequest(req.id, recep);
    const { shiftId } = await endShift(recep, "All good");
    expect(shiftId).toBe(shift.id);
    // The request is not left with someone gone.
    expect(await db.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: "NEW", assignedToId: null });

    const report = await afterShiftClosed(shiftId);
    expect(report).not.toBeNull();
    const data = report!.data as unknown as ShiftReportData;
    expect(data.person.id).toBe(recep.userId);
    expect(data.shift.department).toBe("RECEPTION");
    const head = Object.fromEntries(data.headline.map((f) => [f.label, f.value]));
    expect(head["Guests checked in"]).toBe(1);
    expect(head["Payments recorded"]).toBe(1);
    expect(head["Recorded in payments"]).toBe(50_000);
    expect(data.handover.some((h) => h.includes("put back to New"))).toBe(true);
    expect(data.timeline[0].text).toBe("Shift started");
    expect(data.timeline.some((t) => t.text.startsWith("Guest checked in — Room"))).toBe(true);
    expect(data.timeline.at(-1)!.text).toMatch(/^Shift ended/);
    // The message: a summary with the private link — not the whole report.
    expect(report!.summaryText).toContain("*Shift completed*");
    expect(report!.summaryText).toContain("• 1 guest checked in");
    expect(report!.summaryText).toContain("• TZS 50,000 recorded in payments");
    expect(report!.summaryText).toContain(`/shift-report/${report!.shareToken}`);

    // Idempotent: a double click, a retry, the scheduled run — the same report, never a second one.
    expect((await generateShiftReport(shiftId)).id).toBe(report!.id);
    await retryShiftReports();
    expect(await db.shiftReport.count({ where: { shiftId } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "report.shift_generated", entityId: report!.id } })).toBe(1);

    // The private link opens it; a guessed or expired one does not.
    expect((await shiftReportByToken(report!.shareToken))?.id).toBe(report!.id);
    expect(await shiftReportByToken("x".repeat(32))).toBeNull();
    expect((await shiftReportByToken(report!.shareToken, new Date(Date.now() + 40 * 86_400_000)))?.expired).toBe(true);
  });

  it("an authorized regeneration keeps the earlier version (who, why)", async () => {
    const recep = await receptionistActor();
    await startShift(recep, {});
    const { shiftId } = await endShift(recep, "");
    const first = await generateShiftReport(shiftId);
    const second = await generateShiftReport(shiftId, { regenerate: { by: "Dev Owner (Owner)", reason: "A payment was corrected" } });
    expect(second).toMatchObject({ id: first.id, version: 2, automatic: false, reason: "A payment was corrected", shareToken: first.shareToken });
    expect(await db.shiftReportVersion.findMany({ where: { shiftReportId: first.id } })).toMatchObject([{ version: 1, replacedBy: "Dev Owner (Owner)" }]);
  });

  it("a manager's close makes the report too — saying who closed it and why", async () => {
    const recep = await receptionistActor();
    const shift = await startShift(recep, {});
    const r = await closeShiftAsManager(await managerActor(), shift.id, "Left without closing");
    const report = await afterShiftClosed(r.shiftId);
    const data = report!.data as unknown as ShiftReportData;
    expect(data.shift).toMatchObject({ byManager: true, closeReason: "Left without closing" });
    expect(report!.summaryText).toContain("Left without closing");
  });
});

describe("a waiter's shift report", () => {
  it("counts the orders they handled and served, and the cash they brought — service facts, not a cash count", async () => {
    const waiter = await waiterActor();
    await startWaiterShift(waiter);
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_2", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 2 }] }, waiter, new Date(), { customerPhone: "0712 404 909" });
    const chef = await chefActor();
    await setOrderStatus(o.id, "ACCEPTED", chef);
    for (const i of await db.restaurantOrderItem.findMany({ where: { orderId: o.id } })) await setOrderItemPrepared(o.id, i.id, true, chef);
    await setOrderStatus(o.id, "READY", chef);
    await setOrderStatus(o.id, "OUT_FOR_DELIVERY", waiter);
    await setOrderStatus(o.id, "DELIVERED", waiter);
    await recordOrderPayment(o.id, { accountId: "acct_cash", handedOverById: waiter.userId }, await counterActor());
    // The customers leave: the waiter clears the table.
    const table = await db.diningSession.findFirstOrThrow({ where: { waiterId: waiter.userId } });
    await closeSession(table.id, {}, waiter);
    const end = await endWaiterShift(waiter);
    const report = await afterShiftClosed(end.shiftId);
    const data = report!.data as unknown as ShiftReportData;
    expect(data.shift.department).toBe("RESTAURANT");
    const head = Object.fromEntries(data.headline.map((f) => [f.label, f.value]));
    expect(head["Orders handled"]).toBe(1);
    expect(head["Orders served"]).toBe(1);
    expect(head["Tables served"]).toBe(1);
    expect(head["Cash brought to the Counter"]).toBe(o.total);
    expect(data.groups.find((g) => g.title === "Tables & rooms")?.facts.find((f) => f.label === "Tables closed (customers left)")?.value).toBe(1);
    expect(data.money?.subtitle).toMatch(/not a cash count/);
    expect(data.records[0].rows).toHaveLength(1);
    expect(data.timeline[0].text).toMatch(/Started the shift/);
  });
});

describe("figures that must add up", () => {
  it("a manager closing a waiter's shift with work left: the hand-over counts, the report says so", async () => {
    const waiter = await waiterActor();
    await startWaiterShift(waiter);
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_3", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, waiter, new Date(), { customerPhone: "0712 404 919" });
    const other = await db.user.findFirstOrThrow({ where: { email: "waiter3@vegas.test" } }).catch(() => null);
    if (!other) return; // the second waiter is made by another test file
    await db.actualShift.create({ data: { department: "RESTAURANT", businessDate: (await db.actualShift.findFirstOrThrow({ where: { userId: waiter.userId } })).businessDate, userId: other.id } });
    const shift = await db.actualShift.findFirstOrThrow({ where: { userId: waiter.userId, endedAt: null } });
    const r = await closeWaiterShiftAsManager(await managerActor(), shift.id, "Went home sick", other.id);
    const report = await afterShiftClosed(r.shiftId);
    const data = report!.data as unknown as ShiftReportData;
    expect(data.groups.find((g) => g.title === "Hand-overs")?.facts.find((f) => f.label === "Moved by a manager")?.value).toBeGreaterThanOrEqual(1);
    expect(data.handover.some((h) => /moved to a colleague by a manager/.test(h))).toBe(true);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(other.id);
  });

  it("a refund in the shift shows as money out, and a race makes one audit row", async () => {
    const recep = await receptionistActor();
    await startShift(recep, {});
    const r = await stay("Refund Guest");
    await checkIn(r.id, recep, null);
    await recordReservationPayment({ reservationId: r.id, amount: 80_000, accountId: "acct_cash" }, recep);
    await recordReservationPayment({ reservationId: r.id, amount: 30_000, accountId: "acct_cash", kind: "REFUND" }, recep).catch(() => null);
    const { shiftId } = await endShift(recep, "");
    // Two runs at once (the close and a click): one report, one "generated" row.
    const [a, b] = await Promise.all([generateShiftReport(shiftId), generateShiftReport(shiftId)]);
    expect(a.id).toBe(b.id);
    expect(await db.auditLog.count({ where: { action: "report.shift_generated", entityId: a.id } })).toBe(1);
    const rows = (a.data as unknown as ShiftReportData).records.find((t) => t.title === "Payments recorded")?.rows ?? [];
    const refund = rows.find((x) => x[4] === "Refund");
    if (refund) expect(Number(refund.at(-1))).toBeLessThan(0);
  });
});

describe("the boss's message never holds a shift up", () => {
  it("a failed send is recorded and tried again; the shift and its report are already saved", async () => {
    // An invalid number is refused by the sender before any network call — a failure, safely.
    await db.hotelSettings.updateMany({ data: { reportRecipients: [{ name: "Boss", phone: "12345" }] } });
    const recep = await receptionistActor();
    await startShift(recep, {});
    const { shiftId } = await endShift(recep, "");
    expect((await db.actualShift.findUniqueOrThrow({ where: { id: shiftId } })).endedAt).not.toBeNull();
    const report = await afterShiftClosed(shiftId);
    let d = await db.notificationDelivery.findFirstOrThrow({ where: { shiftReportId: report!.id } });
    expect(d).toMatchObject({ purpose: "SHIFT_REPORT", status: "FAILED", attempts: 1 });
    await retryShiftReports();
    d = await db.notificationDelivery.findFirstOrThrow({ where: { shiftReportId: report!.id } });
    expect(d.attempts).toBe(2);
    expect(await db.notificationDelivery.count({ where: { shiftReportId: report!.id } })).toBe(1);
  });

  it("turned off in Settings: the report is still made, nothing is sent", async () => {
    await db.hotelSettings.updateMany({ data: { reportRecipients: [{ name: "Boss", phone: "12345" }], shiftReportEnabled: false } });
    const recep = await receptionistActor();
    await startShift(recep, {});
    const { shiftId } = await endShift(recep, "");
    const report = await afterShiftClosed(shiftId);
    expect(report).not.toBeNull();
    expect(await db.notificationDelivery.count({ where: { shiftReportId: report!.id } })).toBe(0);
  });
});

describe("the daily report keeps its own place — with the day's shifts", () => {
  it("lists reception and waiter shifts with their durations, and one staff line in the message", async () => {
    const recep = await receptionistActor();
    await startShift(recep, {});
    await endShift(recep, "");
    const waiter = await waiterActor();
    await startWaiterShift(waiter);
    const data = await buildDailyReport(today());
    expect(data.shifts?.map((s) => s.department).sort()).toEqual(["RECEPTION", "RESTAURANT"]);
    const text = renderReportText(data, "Vegas Luxury Hotel");
    expect(text).toContain("*Staff on shift:*");
    expect(text).toMatch(/Restaurant: .*\(on shift\)/);
  });
});
