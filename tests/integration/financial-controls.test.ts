import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { cancelReservation, changeDiscount, checkIn, checkOut, createReservation, markNoShow, previewCheckOut, releaseNoShow } from "@/server/services/reservations";
import { recordReservationPayment, reversePayment } from "@/server/services/payments";
import { changeRoomStatus } from "@/server/services/rooms";
import { expireUnpaidHolds } from "@/server/services/booking-holds";
import { findAvailableRooms } from "@/server/services/availability";
import { recordCompanyPayment, receivablesBoard } from "@/server/services/company-billing";
import { correctExpense, recordExpense } from "@/server/services/expenses";
import { getLedger } from "@/server/services/finance";
import { financeHistory } from "@/server/services/finance-history";
import { overnightStay } from "@/lib/time/stay";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/**
 * "Staff operate the hotel, the system controls the money" — the 13 acceptance
 * scenarios from the financial-control brief, end to end.
 */
beforeEach(resetBusinessData);
afterEach(async () => { await db.promotion.deleteMany({ where: { id: { not: "promo_website_standard" } } }); });

const BOOKED = eat("2026-10-05T10:00:00");
const ARRIVE = eat("2026-10-10T15:00:00");
const WIDE = { from: "2026-01-01", to: "2027-12-31" };
const method = (code: string) => db.paymentMethod.findUniqueOrThrow({ where: { code } });

async function book(opts: { nights?: number; discount?: number; roomId?: string | null; payment?: { amount: number; methodId: string } | null; from?: string; name?: string } = {}) {
  const dd = await roomType("DOUBLE_DELUXE");
  const from = opts.from ?? "2026-10-10";
  const to = new Date(`${from}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + (opts.nights ?? 1));
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: opts.name ?? "John Michael" },
    stay: { kind: "overnight", arrivalDate: from, departureDate: to.toISOString().slice(0, 10) },
    rooms: [{ roomTypeId: dd.id, roomId: opts.roomId ?? null, adults: 1, children: 0, discountPerNight: opts.discount ?? 0 }],
    payment: opts.payment ?? null,
  }, await receptionistActor(), BOOKED);
}
const roomRows = async () => (await getLedger(WIDE)).rows.filter((r) => r.source === "ROOM");

describe("financial controls — acceptance", () => {
  it("TEST 1 — normal room: checking in records 80,000 room income; reception has no way to set a price", async () => {
    const r = await book();
    expect(await roomRows()).toHaveLength(0); // booked, not yet earned
    await checkIn(r.id, await receptionistActor(), null, ARRIVE);
    const [row] = await roomRows();
    expect(row).toMatchObject({ income: 80_000, gross: 80_000, discount: 0, via: "Check-in" });
    const rec = await receptionistActor();
    expect(rec.permissions?.has("pricing.manage")).toBe(false);
    // A discount above the hotel's limit is refused (the price itself is never typed).
    await expect(changeDiscount(r.rooms[0].id, 50_000, "friend", rec)).rejects.toThrow();
  });

  it("TEST 2 — Admin 10% promotion is applied automatically: 80,000 − 8,000 = 72,000", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    await db.promotion.create({ data: { name: "10% OFF Double Deluxe", type: "PERCENT", value: 10, scope: "ROOM_TYPES", roomTypeIds: [dd.id] } });
    const r = await book();
    expect(r.netAmount).toBe(72_000);
    await checkIn(r.id, await receptionistActor(), null, ARRIVE);
    const [row] = await roomRows();
    expect(row).toMatchObject({ gross: 80_000, discount: 8_000, income: 72_000 });
    expect(row.note).toContain("10% OFF Double Deluxe");
  });

  it("TEST 3 — manual discount shows in the ledger as base − discount = final, with who gave it", async () => {
    const r = await book({ discount: 10_000 });
    await checkIn(r.id, await receptionistActor(), null, ARRIVE);
    const [row] = await roomRows();
    expect(row).toMatchObject({ gross: 80_000, discount: 10_000, income: 70_000 });
    expect(row.note).toMatch(/Discount −10,000 by Asha/);
    const audit = await db.auditLog.findFirst({ where: { entityId: r.id, action: "reservation.discount_changed" } });
    expect(audit?.after).toMatchObject({ discountPerNight: 10_000 });
  });

  it("TEST 4 + 5 — a payment is in the ledger; reception cannot reverse it; an admin reversal is a separate line and the original stays", async () => {
    const r = await book({ discount: 10_000 });
    await checkIn(r.id, await receptionistActor(), null, ARRIVE);
    const mobile = await method("MOBILE_MONEY");
    const p = await recordReservationPayment({ reservationId: r.id, amount: 70_000, methodId: mobile.id, reference: "MPESA-1" }, await receptionistActor());
    let ledger = await getLedger(WIDE);
    expect(ledger.rows.find((x) => x.source === "PAYMENT")).toMatchObject({ moneyIn: 70_000, by: expect.stringContaining("Asha") });
    await expect(reversePayment(p.id, "mistake", await receptionistActor())).rejects.toThrow(/Only a manager/);

    await reversePayment(p.id, "Incorrect payment entry", await managerActor());
    ledger = await getLedger(WIDE);
    const original = ledger.rows.find((x) => x.id === `p-${p.id}`)!;
    const reversal = ledger.rows.find((x) => x.id === `r-${p.id}`)!;
    expect(original).toMatchObject({ moneyIn: 70_000, tag: "Reversed later" });
    expect(reversal).toMatchObject({ source: "REVERSAL", moneyOut: 70_000 });
    expect(reversal.note).toContain("Incorrect payment entry");
    expect(ledger.totals.moneyIn - ledger.totals.moneyOut).toBe(0);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: p.id, action: "payment.reversed" }, include: { user: true } });
    expect(log.user?.email).toBe("manager@vegas.test");
    expect(log.after).toMatchObject({ reason: "Incorrect payment entry" });
  });

  it("TEST 6 — an unpaid booking is pending and holds the room only until the hold expires", async () => {
    const r = await book();
    expect(r.status).toBe("RESERVED");
    expect(r.holdUntil?.getTime()).toBe(BOOKED.getTime() + 24 * 3_600_000);
    const stay = overnightStay({ arrivalDate: "2026-10-10", departureDate: "2026-10-11" });
    const taken = r.rooms[0].roomId;
    expect((await findAvailableRooms({ stay })).some((x) => x.id === taken)).toBe(false);
    expect(await expireUnpaidHolds(eat("2026-10-05T20:00:00"))).toBe(0); // still inside the hold
    expect(await expireUnpaidHolds(eat("2026-10-06T10:01:00"))).toBe(1);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelReason).toMatch(/hold expired/);
    expect((await findAvailableRooms({ stay })).some((x) => x.id === taken)).toBe(true);
  });

  it("TEST 7 — paying confirms the booking and blocks the room; overlapping dates are refused, back-to-back are fine", async () => {
    const r = await book({ nights: 2 });
    const cash = await method("CASH");
    await recordReservationPayment({ reservationId: r.id, amount: 20_000, methodId: cash.id }, await receptionistActor());
    const paid = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(paid.status).toBe("CONFIRMED");
    expect(paid.holdUntil).toBeNull();
    expect(await expireUnpaidHolds(eat("2026-10-09T10:00:00"))).toBe(0);
    const room = r.rooms[0].roomId;
    await expect(book({ from: "2026-10-11", roomId: room, name: "Sarah Ali" })).rejects.toThrow(/no longer available|just booked/);
    const next = await book({ from: "2026-10-12", nights: 2, roomId: room, name: "Sarah Ali" });
    expect(next.rooms[0].roomId).toBe(room);
  });

  it("TEST 8 + 9 — check-in occupies the room and earns the income; reception cannot undo it", async () => {
    const r = await book();
    await checkIn(r.id, await receptionistActor(), null, ARRIVE);
    const room = await db.room.findUniqueOrThrow({ where: { id: r.rooms[0].roomId } });
    expect(room.status).toBe("OCCUPIED");
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CHECKED_IN");
    await expect(cancelReservation(r.id, await managerActor(), "undo")).rejects.toThrow(/cannot be cancelled/);
    const rec = await receptionistActor();
    await expect(changeRoomStatus(room.id, "AVAILABLE", { ...rec, permissions: rec.permissions! })).rejects.toThrow(/guest in it/);
    expect((await roomRows()).reduce((s, x) => s + x.income, 0)).toBe(80_000);
  });

  it("TEST 10 — checkout needs the balance paid; then the room goes to cleaning", async () => {
    const r = await book({ nights: 2 });
    await checkIn(r.id, await receptionistActor(), null, ARRIVE);
    const cash = await method("CASH");
    await recordReservationPayment({ reservationId: r.id, amount: 120_000, methodId: cash.id }, await receptionistActor());
    const LEAVE = eat("2026-10-12T10:00:00");
    expect((await previewCheckOut(r.id, {}, LEAVE)).balance).toBe(40_000);
    await expect(checkOut(r.id, await receptionistActor(), {}, LEAVE)).rejects.toThrow(/still owes TZS 40,000/);
    await checkOut(r.id, await receptionistActor(), { payment: { amount: 40_000, methodId: cash.id } }, LEAVE);
    expect((await db.room.findUniqueOrThrow({ where: { id: r.rooms[0].roomId } })).status).toBe("DIRTY");
  });

  it("TEST 11 + 12 — company invoice: income and receivable 500,000, no cash; the company pays; income is not counted again", async () => {
    const c = await db.corporateCustomer.create({ data: { companyName: "ABC Company Ltd", paymentTermDays: 30 } });
    const ex = await roomType("EXECUTIVE");
    const r = await createReservation({
      sourceCode: "CORPORATE", guest: { fullName: "Staff Member" }, corporateCustomerId: c.id, billing: { billTo: "COMPANY" },
      stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-15" },
      rooms: [{ roomTypeId: ex.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, await receptionistActor(), BOOKED);
    expect(r.status).toBe("CONFIRMED"); // billed to a company: secured without cash
    await checkIn(r.id, await receptionistActor(), null, ARRIVE);
    await checkOut(r.id, await receptionistActor(), {}, eat("2026-10-15T10:00:00"));
    let ledger = await getLedger(WIDE);
    expect(ledger.totals.income).toBe(500_000);
    expect(ledger.totals.moneyIn).toBe(0);
    expect((await receivablesBoard("2026-10-15")).total).toBe(500_000);
    const bank = await method("BANK");
    await recordCompanyPayment({ companyId: c.id, amount: 500_000, methodId: bank.id, reference: "BANK-1" }, await managerActor());
    ledger = await getLedger(WIDE);
    expect(ledger.totals.income).toBe(500_000);
    expect(ledger.totals.moneyIn).toBe(500_000);
    expect((await receivablesBoard("2026-10-15")).total).toBe(0);
  });

  it("TEST 13 — an expense edit keeps the story: ledger shows the new amount, history shows 50,000 → 55,000, who and why", async () => {
    const cat = await db.expenseCategory.findFirstOrThrow();
    const cash = await method("CASH");
    const rec = await receptionistActor();
    const e = await recordExpense({ categoryId: cat.id, amount: 50_000, description: "Supplier goods", paymentMethodId: cash.id }, rec as never);
    await correctExpense(e.id, { categoryId: cat.id, amount: 55_000, description: "Supplier goods", paymentMethodId: cash.id }, rec as never, "Corrected supplier receipt");
    const ledger = await getLedger({ from: "2026-01-01", to: "2027-12-31", view: "expense" });
    expect(ledger.totals.expense).toBe(55_000);
    const today = new Date(Date.now() - 4 * 3_600_000 + 3 * 3_600_000).toISOString().slice(0, 10);
    const [item] = await financeHistory({ from: "2026-01-01", to: today > "2027-12-31" ? today : "2027-12-31", group: "expenses", q: "edited" });
    expect(item.who).toContain("Asha");
    expect(item.reason).toBe("Corrected supplier receipt");
    expect(item.changes).toContainEqual({ field: "Amount", from: "50,000", to: "55,000" });
  });

  it("paid no-show keeps the payment as income (policy); cancelling can instead leave a refund due", async () => {
    const cash = await method("CASH");
    const a = await book({ payment: { amount: 80_000, methodId: cash.id } });
    expect(a.status).toBe("CONFIRMED");
    await markNoShow(a.id, await managerActor(), eat("2026-10-11T10:00:00"));
    expect((await db.reservation.findUniqueOrThrow({ where: { id: a.id } })).balanceAmount).toBe(-80_000); // room still held, nothing decided yet
    await releaseNoShow(a.id, await managerActor());
    const na = await db.reservation.findUniqueOrThrow({ where: { id: a.id }, include: { charges: true } });
    expect(na.status).toBe("NO_SHOW");
    expect(na.balanceAmount).toBe(0);
    expect(na.charges[0]).toMatchObject({ category: "NO_SHOW", amount: 80_000 });

    const b = await book({ payment: { amount: 30_000, methodId: cash.id }, from: "2026-10-20", name: "Peter" });
    await cancelReservation(b.id, await managerActor(), "Change of plans", { keepPayment: false });
    const nb = await db.reservation.findUniqueOrThrow({ where: { id: b.id } });
    expect(nb.status).toBe("CANCELLED");
    expect(nb.balanceAmount).toBe(-30_000); // refund due — the payment stays on record
    expect(await db.payment.count({ where: { reservationId: b.id, status: "POSTED" } })).toBe(1);
  });
});
