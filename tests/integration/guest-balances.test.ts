import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, checkOut, createReservation, previewCheckOut } from "@/server/services/reservations";
import { addReservationCharge, correctPayment, recordReservationPayment } from "@/server/services/payments";
import { inHouseBalances } from "@/server/services/guest-balances";
import { endShift, startShift } from "@/server/services/shifts";
import { getLedger } from "@/server/services/finance";
import { paymentStatus } from "@/lib/payment-status";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/** Booked ≠ paid ≠ income · checked in ≠ paid · outstanding ≠ collected · checkout needs zero outstanding. */
beforeEach(resetBusinessData);
afterEach(async () => { await db.priceRule.deleteMany({}); });
const BOOKED = eat("2026-09-20T10:00:00");
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const method = (code: string) => db.paymentMethod.findUniqueOrThrow({ where: { code } });

async function stay() {
  const t = await roomType("EXECUTIVE"); // 100,000; 26 Sept is a 120,000 night
  await db.priceRule.create({ data: { name: "Busy night", scope: "ROOM_TYPES", roomTypeIds: [t.id], price: 120_000, startDate: d("2026-09-26"), endDate: d("2026-09-26") } });
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: "John" }, stay: { kind: "overnight", arrivalDate: "2026-09-25", departureDate: "2026-09-28" },
    rooms: [{ roomTypeId: t.id, roomId: t.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await receptionistActor(), BOOKED);
  return r;
}

describe("guest balances — booked, paid, income, outstanding", () => {
  it("a checked-in guest who has not paid owes money night by night; nothing is shown as collected", async () => {
    const r = await stay();
    expect(r.netAmount).toBe(320_000); // 100k + 120k + 100k — each night its own price
    expect(paymentStatus(r)).toBe("UNPAID");
    await checkIn(r.id, await receptionistActor(), null, eat("2026-09-25T15:00:00"));
    const night1 = await inHouseBalances("2026-09-25");
    expect(night1.owing[0]).toMatchObject({ outstanding: 320_000, owedSoFar: 100_000, paid: 0, status: "UNPAID" });
    expect((await inHouseBalances("2026-09-26")).owing[0].owedSoFar).toBe(220_000);
    expect((await inHouseBalances("2026-09-27")).owing[0].owedSoFar).toBe(320_000);
    const ledger = await getLedger({ from: "2026-09-25", to: "2026-09-27" });
    expect(ledger.totals.income).toBe(320_000); // earned (revenue)
    expect(ledger.totals.moneyIn).toBe(0); // nothing collected
  });

  it("one payment does not make the guest fully paid; payment status and stay status stay separate", async () => {
    const r = await stay();
    await checkIn(r.id, await receptionistActor(), null, eat("2026-09-25T15:00:00"));
    await recordReservationPayment({ reservationId: r.id, amount: 100_000, methodId: (await method("CASH")).id }, await receptionistActor());
    let b = await inHouseBalances("2026-09-26");
    expect(b.owing[0]).toMatchObject({ outstanding: 220_000, paid: 100_000, status: "PART_PAID" });
    expect(b.summary).toMatchObject({ guestsCheckedIn: 1, owingCount: 1, fullyPaid: 0, totalOutstanding: 220_000 });
    await recordReservationPayment({ reservationId: r.id, amount: 220_000, methodId: (await method("BANK")).id }, await receptionistActor());
    b = await inHouseBalances("2026-09-26");
    expect(b.owing).toHaveLength(0);
    expect(b.rows[0].status).toBe("PAID");
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CHECKED_IN"); // paid, still staying
  });

  it("checkout shows room / restaurant / bar separately and needs zero outstanding; the room then goes to cleaning", async () => {
    const r = await stay();
    await checkIn(r.id, await receptionistActor(), null, eat("2026-09-25T15:00:00"));
    const rec = await receptionistActor();
    await addReservationCharge({ reservationId: r.id, description: "Dinner", amount: 50_000, category: "RESTAURANT" }, rec);
    await addReservationCharge({ reservationId: r.id, description: "Drinks", amount: 30_000, category: "BAR" }, rec);
    await recordReservationPayment({ reservationId: r.id, amount: 320_000, methodId: (await method("CASH")).id }, rec);
    const LEAVE = eat("2026-09-28T10:00:00");
    const p = await previewCheckOut(r.id, {}, LEAVE);
    expect(p).toMatchObject({ gross: 320_000, chargesByKind: { restaurant: 50_000, bar: 30_000, other: 0 }, total: 400_000, paid: 320_000, balance: 80_000 });
    await expect(checkOut(r.id, rec, {}, LEAVE)).rejects.toThrow(/still owes TZS 80,000/);
    await checkOut(r.id, rec, { payment: { amount: 80_000, methodId: (await method("CASH")).id } }, LEAVE);
    expect((await db.room.findUniqueOrThrow({ where: { id: r.rooms[0].roomId } })).status).toBe("DIRTY");
  });

  it("ending a shift records who still owes (for its report) — no automatic money note any more", async () => {
    const r = await stay();
    await checkIn(r.id, await receptionistActor(), null, eat("2026-09-25T15:00:00"));
    const rec = await receptionistActor();
    const actor = { ...rec, userId: rec.userId!, permissions: rec.permissions! };
    await startShift(actor, {});
    const { shiftId } = await endShift(actor, "All quiet");
    const ended = await db.auditLog.findFirstOrThrow({ where: { action: "shift.ended", entityId: shiftId } });
    expect(ended.after).toMatchObject({ guestsOwing: 1, totalOutstanding: 320_000 });
    expect(await db.shiftHandoverNote.count({ where: { body: { contains: "MONEY TO COLLECT" } } })).toBe(0);
    // What the receptionist wrote for the next shift is still a note.
    expect(await db.shiftHandoverNote.count({ where: { body: "All quiet" } })).toBe(1);
  });

  it("payment amount is locked; reception may correct the method, only a manager the reference", async () => {
    const r = await stay();
    const p = await recordReservationPayment({ reservationId: r.id, amount: 100_000, methodId: (await method("BANK")).id, reference: "NMB-1" }, await receptionistActor());
    const mobile = await method("MOBILE_MONEY");
    await expect(correctPayment({ paymentId: p.id, methodId: mobile.id, reference: "CRDB-9", reason: "wrong ref" }, await receptionistActor())).rejects.toThrow(/Only a manager/);
    await correctPayment({ paymentId: p.id, methodId: mobile.id, reason: "Wrong destination selected" }, await receptionistActor());
    await correctPayment({ paymentId: p.id, methodId: mobile.id, reference: "CRDB-9", reason: "Reference typo" }, await managerActor());
    const after = await db.payment.findUniqueOrThrow({ where: { id: p.id }, include: { corrections: true } });
    expect(after).toMatchObject({ amount: 100_000, reference: "CRDB-9" });
    expect(after.corrections).toHaveLength(2);
  });
});
