import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { changeStayDates, createReservation, previewDateChange } from "@/server/services/reservations";
import { quoteStay } from "@/server/services/pricing";
import { assertNoPromotionConflict } from "@/server/services/pricing-admin";
import { getLedger } from "@/server/services/finance";
import { eat, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/** Date-sensitive pricing & date changes — acceptance 36–40 plus date prices, weekdays and conflicts. */
beforeEach(resetBusinessData);
afterEach(async () => {
  await db.promotion.deleteMany({ where: { id: { not: "promo_website_standard" } } });
  await db.priceRule.deleteMany({});
  await db.hotelSettings.update({ where: { id: 1 }, data: { dateChangeExcessPolicy: "NO_REFUND", dateChangePayNow: true } });
});
const BOOKED = eat("2026-10-01T10:00:00");
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function exec() { return roomType("EXECUTIVE"); } // normal price 100,000
async function octoberPromo(value = 20_000) {
  const t = await exec();
  return db.promotion.create({ data: { name: "October Promotion", type: "FIXED", value, scope: "ROOM_TYPES", roomTypeIds: [t.id], startDate: d("2026-10-01"), endDate: d("2026-10-15"), priority: 20 } });
}
async function book(from: string, to: string, pay: number) {
  const t = await exec();
  const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: "John Michael" }, stay: { kind: "overnight", arrivalDate: from, departureDate: to },
    rooms: [{ roomTypeId: t.id, roomId: t.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }], payment: { amount: pay, methodId: cash.id },
  }, await receptionistActor(), BOOKED);
}
const cash = () => db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });

describe("date-sensitive pricing", () => {
  it("36 + 40 — discounted → non-discounted: extra 20,000 is paid; the original 80,000 payment is never edited", async () => {
    await octoberPromo();
    const r = await book("2026-10-10", "2026-10-11", 80_000);
    expect(r.netAmount).toBe(80_000);
    const p = await previewDateChange(r.rooms[0].id, { arrivalDate: "2026-10-20", departureDate: "2026-10-21" });
    expect(p.newNights).toEqual([{ date: "2026-10-20", base: 100_000, discount: 0, net: 100_000, note: null }]);
    expect(p.money).toMatchObject({ additional: 20_000, dueNow: 20_000, excess: 0 });
    await expect(changeStayDates(r.rooms[0].id, { arrivalDate: "2026-10-20", departureDate: "2026-10-21" }, await receptionistActor(), { reason: "x" })).rejects.toThrow(/Receive the extra payment/);
    await changeStayDates(r.rooms[0].id, { arrivalDate: "2026-10-20", departureDate: "2026-10-21" }, await receptionistActor(), { reason: "Customer asked", payment: { methodId: (await cash()).id } });
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { payments: { orderBy: { receivedAt: "asc" } } } });
    expect(after).toMatchObject({ netAmount: 100_000, paidAmount: 100_000, balanceAmount: 0 });
    expect(after.payments.map((x) => x.amount)).toEqual([80_000, 20_000]); // original untouched, extra is its own payment
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "reservation.dates_changed" } });
    expect(log.before).toMatchObject({ net: 80_000, nightPrices: ["2026-10-10: 100,000 − 20,000 = 80,000 (October Promotion)"] });
    expect(log.after).toMatchObject({ net: 100_000, additionalPaid: 20_000, nightPrices: ["2026-10-20: 100,000 = 100,000"] });
    // Revenue is not doubled: only the new nights exist.
    expect(await db.roomNight.count({ where: { reservationRoomId: r.rooms[0].id } })).toBe(1);
  });

  it("37 — discounted → another discounted date: same price, nothing extra", async () => {
    await octoberPromo();
    const r = await book("2026-10-10", "2026-10-11", 80_000);
    const p = await previewDateChange(r.rooms[0].id, { arrivalDate: "2026-10-12", departureDate: "2026-10-13" });
    expect(p.money).toMatchObject({ additional: 0, dueNow: 0, excess: 0 });
    await changeStayDates(r.rooms[0].id, { arrivalDate: "2026-10-12", departureDate: "2026-10-13" }, await receptionistActor(), { reason: "Customer asked" });
    expect(await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ netAmount: 80_000, balanceAmount: 0 });
  });

  it("38 — non-discounted → discounted: 20,000 paid beyond the new price follows the hotel policy (kept, or a credit) — never lost", async () => {
    await octoberPromo();
    const r = await book("2026-10-20", "2026-10-21", 100_000);
    const p = await previewDateChange(r.rooms[0].id, { arrivalDate: "2026-10-10", departureDate: "2026-10-11" });
    expect(p.money).toMatchObject({ excess: 20_000, policy: "NO_REFUND", kept: 20_000 });
    await changeStayDates(r.rooms[0].id, { arrivalDate: "2026-10-10", departureDate: "2026-10-11" }, await receptionistActor(), { reason: "Customer asked" });
    const kept = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { charges: true, payments: true } });
    expect(kept.charges[0]).toMatchObject({ category: "DATE_CHANGE_KEPT", amount: 20_000 });
    expect(kept).toMatchObject({ paidAmount: 100_000, balanceAmount: 0 });

    await db.hotelSettings.update({ where: { id: 1 }, data: { dateChangeExcessPolicy: "CREDIT" } });
    const r2 = await book("2026-10-21", "2026-10-22", 100_000);
    await changeStayDates(r2.rooms[0].id, { arrivalDate: "2026-10-11", departureDate: "2026-10-12" }, await receptionistActor(), { reason: "Customer asked" });
    const credit = await db.reservation.findUniqueOrThrow({ where: { id: r2.id }, include: { payments: true } });
    expect(credit.balanceAmount).toBe(-20_000); // owed back — a refund would be a separate payment
    expect(credit.payments).toHaveLength(1);
  });

  it("39 — different prices every night: 100k + 120k → 120k + 150k = 50,000 extra, worked out by the system", async () => {
    const t = await exec();
    await db.priceRule.create({ data: { name: "Busy night", scope: "ROOM_TYPES", roomTypeIds: [t.id], price: 120_000, startDate: d("2026-10-11"), endDate: d("2026-10-11") } });
    await db.priceRule.create({ data: { name: "Festival", scope: "ROOM_TYPES", roomTypeIds: [t.id], price: 120_000, startDate: d("2026-10-20"), endDate: d("2026-10-20") } });
    await db.priceRule.create({ data: { name: "Festival peak", scope: "ROOM_TYPES", roomTypeIds: [t.id], price: 150_000, startDate: d("2026-10-21"), endDate: d("2026-10-21") } });
    const r = await book("2026-10-10", "2026-10-12", 220_000);
    expect(r.netAmount).toBe(220_000);
    const p = await previewDateChange(r.rooms[0].id, { arrivalDate: "2026-10-20", departureDate: "2026-10-22" });
    expect(p.newNights.map((n) => n.net)).toEqual([120_000, 150_000]);
    expect(p.money.dueNow).toBe(50_000);
    await changeStayDates(r.rooms[0].id, { arrivalDate: "2026-10-20", departureDate: "2026-10-22" }, await receptionistActor(), { reason: "Customer asked", payment: { methodId: (await cash()).id } });
    const nights = await db.roomNight.findMany({ where: { reservationRoomId: r.rooms[0].id }, orderBy: { businessDate: "asc" } });
    expect(nights.map((n) => [n.priceRuleName, n.netAmount])).toEqual([["Festival", 120_000], ["Festival peak", 150_000]]);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).paidAmount).toBe(270_000);
  });

  it("weekend price by day of the week, with a promotion on top, night by night", async () => {
    const t = await exec();
    await db.priceRule.create({ data: { name: "Weekend", scope: "ROOM_TYPES", roomTypeIds: [t.id], price: 120_000, startDate: d("2026-01-01"), endDate: d("2026-12-31"), daysOfWeek: [5, 6] } });
    await db.promotion.create({ data: { name: "10% October", type: "PERCENT", value: 10, scope: "ALL", startDate: d("2026-10-01"), endDate: d("2026-10-15"), priority: 10 } });
    // Thu 15, Fri 16, Sat 17 Oct 2026
    const q = await quoteStay(db, { dates: ["2026-10-15", "2026-10-16", "2026-10-17"], base: t.baseRate, roomTypeId: t.id, roomId: null, channel: "STAFF" });
    expect(q.nights.map((n) => [n.base, n.promoDiscount, n.net])).toEqual([[100_000, 10_000, 90_000], [120_000, 0, 120_000], [120_000, 0, 120_000]]);
  });

  it("two promotions with the same priority on the same rooms and nights are refused; a higher priority is fine", async () => {
    const t = await exec();
    await octoberPromo();
    const clash = { id: "new", name: "Clash", scope: "ALL" as const, roomTypeIds: [], roomIds: [], channel: "ALL" as const, startDate: "2026-10-10", endDate: "2026-10-20", daysOfWeek: [], priority: 20 };
    await expect(db.$transaction((tx) => assertNoPromotionConflict(tx, clash))).rejects.toThrow(/Pricing conflict/);
    await expect(db.$transaction((tx) => assertNoPromotionConflict(tx, { ...clash, priority: 30 }))).resolves.toBeUndefined();
    await expect(db.$transaction((tx) => assertNoPromotionConflict(tx, { ...clash, startDate: "2026-10-16" }))).resolves.toBeUndefined();
    const standard = (await roomType("STANDARD")).id;
    await expect(db.$transaction((tx) => assertNoPromotionConflict(tx, { ...clash, scope: "ROOM_TYPES", roomTypeIds: [standard] }))).resolves.toBeUndefined();
    await expect(db.$transaction((tx) => assertNoPromotionConflict(tx, { ...clash, scope: "ROOM_TYPES", roomTypeIds: [t.id] }))).rejects.toThrow(/Pricing conflict/);
  });

  it("the ledger shows the date price and promotion behind each night", async () => {
    const t = await exec();
    await db.priceRule.create({ data: { name: "Holiday", scope: "ROOM_TYPES", roomTypeIds: [t.id], price: 150_000, startDate: d("2026-10-10"), endDate: d("2026-10-10") } });
    const r = await book("2026-10-10", "2026-10-11", 150_000);
    const { checkIn } = await import("@/server/services/reservations");
    await checkIn(r.id, await receptionistActor(), null, eat("2026-10-10T15:00:00"));
    const [row] = (await getLedger({ from: "2026-10-10", to: "2026-10-10", view: "income" })).rows;
    expect(row).toMatchObject({ gross: 150_000, income: 150_000 });
    expect(row.note).toContain("Holiday price");
  });
});
