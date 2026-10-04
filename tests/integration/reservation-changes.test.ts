import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  changeDiscount, changeStayDates, checkIn, createReservation, noteLateArrival, previewDateChange, reassignRoom, reinstateNoShow, releaseNoShow,
} from "@/server/services/reservations";
import { correctPayment } from "@/server/services/payments";
import { noShowCutoff, processNoShows } from "@/server/services/booking-holds";
import { findAvailableRooms } from "@/server/services/availability";
import { getLedger } from "@/server/services/finance";
import { financeHistory } from "@/server/services/finance-history";
import { overnightStay } from "@/lib/time/stay";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/** Reservation changes, date changes, payment corrections, late arrivals and no-shows — scenarios A–H. */
beforeEach(resetBusinessData);
const BOOKED = eat("2026-10-05T10:00:00");
const WIDE = { from: "2026-01-01", to: "2027-12-31" };
const method = (code: string) => db.paymentMethod.findUniqueOrThrow({ where: { code } });

async function paidBooking(from = "2026-10-10", to = "2026-10-12", roomNumber = "204", name = "John Michael", amount = 160_000) {
  const dd = await roomType("DOUBLE_DELUXE");
  const room = dd.rooms.find((x) => x.number === roomNumber)!;
  const cash = await method("CASH");
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: name }, stay: { kind: "overnight", arrivalDate: from, departureDate: to },
    rooms: [{ roomTypeId: dd.id, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
    payment: { amount, methodId: cash.id },
  }, await receptionistActor(), BOOKED);
}

describe("reservation changes & no-shows", () => {
  it("A — paid date change: availability checked, dates moved, original kept in history, payment untouched", async () => {
    const r = await paidBooking();
    const rr = r.rooms[0];
    const preview = await previewDateChange(rr.id, { arrivalDate: "2026-10-15", departureDate: "2026-10-17" });
    expect(preview.sameRoomFree).toBe(true);
    expect(preview.difference).toBe(0);
    await changeStayDates(rr.id, { arrivalDate: "2026-10-15", departureDate: "2026-10-17" }, await receptionistActor(), { reason: "Customer requested date change" });
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { payments: true, rooms: true } });
    expect(after.rooms[0].arrivalDate.toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(after.payments).toHaveLength(1);
    expect(after.paidAmount).toBe(160_000);
    expect(after.balanceAmount).toBe(0);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "reservation.dates_changed" }, include: { user: true } });
    expect(log.before).toMatchObject({ arrival: "2026-10-10", departure: "2026-10-12" });
    expect(log.after).toMatchObject({ arrival: "2026-10-15", departure: "2026-10-17", reason: "Customer requested date change" });
    expect(log.user?.email).toBe("asha@vegas.test");
  });

  it("A2 — the room is taken on the new dates: rejected, other rooms offered; the price difference is worked out by the system", async () => {
    const r = await paidBooking();
    await paidBooking("2026-10-15", "2026-10-17", "204", "Sarah Ali");
    const preview = await previewDateChange(r.rooms[0].id, { arrivalDate: "2026-10-15", departureDate: "2026-10-17" });
    expect(preview.sameRoomFree).toBe(false);
    expect(preview.alternatives.length).toBeGreaterThan(0);
    await expect(changeStayDates(r.rooms[0].id, { arrivalDate: "2026-10-15", departureDate: "2026-10-17" }, await receptionistActor(), { reason: "x" })).rejects.toThrow(/not available/);
    const exec = (await roomType("EXECUTIVE")).rooms[0];
    const up = await previewDateChange(r.rooms[0].id, { arrivalDate: "2026-10-15", departureDate: "2026-10-17" }, exec.id);
    expect(up.difference).toBe(40_000); // 2 × 100,000 − 2 × 80,000
    await expect(changeStayDates(r.rooms[0].id, { arrivalDate: "2026-10-15", departureDate: "2026-10-17" }, await receptionistActor(), { roomId: exec.id, reason: "Room 204 taken" })).rejects.toThrow(/Receive the extra payment/);
    const cash = await method("CASH");
    await changeStayDates(r.rooms[0].id, { arrivalDate: "2026-10-15", departureDate: "2026-10-17" }, await receptionistActor(), { roomId: exec.id, reason: "Room 204 taken", payment: { methodId: cash.id } });
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { payments: { orderBy: { receivedAt: "asc" } } } });
    expect(after.netAmount).toBe(200_000);
    expect(after.payments.map((x) => x.amount)).toEqual([160_000, 40_000]); // the extra is its own payment; the first is unchanged
    expect(after.balanceAmount).toBe(0);
  });

  it("B — room change is allowed only into a free room", async () => {
    const r = await paidBooking();
    await paidBooking("2026-10-11", "2026-10-13", "205", "Other Guest");
    const dd = await roomType("DOUBLE_DELUXE");
    const room205 = dd.rooms.find((x) => x.number === "205")!;
    const room206 = dd.rooms.find((x) => x.number === "206")!;
    await expect(reassignRoom(r.rooms[0].id, room205.id, await receptionistActor(), "guest asked")).rejects.toThrow(/not free/);
    await reassignRoom(r.rooms[0].id, room206.id, await receptionistActor(), "guest asked");
    expect((await db.reservationRoom.findUniqueOrThrow({ where: { id: r.rooms[0].id } })).roomId).toBe(room206.id);
  });

  it("C — wrong account corrected (Cash → CRDB) keeps the amount, shows in the ledger and history", async () => {
    const r = await paidBooking();
    const p = (await db.payment.findFirstOrThrow({ where: { reservationId: r.id } }));
    expect(p.accountId).toBe("acct_cash");
    const crdb = await db.moneyAccount.findUniqueOrThrow({ where: { code: "BANK" } });
    await correctPayment({ paymentId: p.id, accountId: crdb.id, reason: "Wrong payment account selected" }, await receptionistActor());
    const after = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ accountId: crdb.id, methodId: (await method("BANK")).id, amount: 160_000, reference: null, status: "POSTED" });
    const fix = await db.paymentCorrection.findFirstOrThrow({ where: { paymentId: p.id } });
    expect(fix).toMatchObject({ fromAccountId: "acct_cash", toAccountId: crdb.id, amount: 160_000, reason: "Wrong payment account selected" });
    const ledger = await getLedger(WIDE);
    const change = ledger.rows.find((x) => x.source === "CORRECTION")!;
    expect(change.category).toBe("Cash → CRDB Bank");
    expect(change.note).toContain("Wrong payment account selected");
    expect(ledger.totals.moneyIn).toBe(160_000); // still one payment
    const [h] = await financeHistory({ ...WIDE, group: "payments" });
    expect(h.changes).toContainEqual({ field: "Account", from: "Cash", to: "CRDB Bank" });
  });

  it("D — reception cannot lower the price beyond the discount rules (80,000 → 70,000 only as an authorised discount)", async () => {
    const r = await paidBooking();
    await expect(changeDiscount(r.rooms[0].id, 50_000, "friend", await receptionistActor())).rejects.toThrow();
    const rec = await receptionistActor();
    expect(rec.permissions?.has("pricing.manage")).toBe(false);
    expect(rec.permissions?.has("payments.reverse")).toBe(false);
  });

  it("E + G — paid no-show at the cut-off keeps the room held; releasing frees it for another guest; the booking stays as NO SHOW", async () => {
    const r = await paidBooking();
    const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
    const cutoff = noShowCutoff("2026-10-10", settings);
    expect(cutoff.toISOString()).toBe(eat("2026-10-11T01:00:00").toISOString());
    expect(await processNoShows(eat("2026-10-11T00:30:00"))).toBe(0);
    expect(await processNoShows(eat("2026-10-11T01:05:00"))).toBe(1);
    const stay = overnightStay({ arrivalDate: "2026-10-11", departureDate: "2026-10-12" });
    const room = r.rooms[0].roomId;
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("NO_SHOW");
    expect((await findAvailableRooms({ stay })).some((x) => x.id === room)).toBe(false); // still held
    await expect(releaseNoShow(r.id, await receptionistActor())).rejects.toThrow(/Only a manager/);
    await releaseNoShow(r.id, await managerActor());
    expect((await findAvailableRooms({ stay })).some((x) => x.id === room)).toBe(true);
    const next = await paidBooking("2026-10-11", "2026-10-12", "204", "Walk-in Guest", 80_000);
    expect(next.rooms[0].roomId).toBe(room);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { payments: true } });
    expect(after.status).toBe("NO_SHOW");
    expect(after.payments[0].status).toBe("POSTED"); // payment retained
    expect(after.balanceAmount).toBe(0); // kept as income per policy, refund 0
    await expect(reinstateNoShow(r.id, "arrived", await receptionistActor())).rejects.toThrow(/released/);
  });

  it("F — late arrival notice keeps the room past the cut-off; the guest checks in at midnight", async () => {
    const r = await paidBooking();
    await noteLateArrival(r.id, { eta: "23:30", note: "Flight delayed, arriving at midnight" }, await receptionistActor(), eat("2026-10-10T18:00:00"));
    expect(await processNoShows(eat("2026-10-11T01:30:00"))).toBe(0);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CONFIRMED");
    await checkIn(r.id, await receptionistActor(), null, eat("2026-10-11T00:10:00"));
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CHECKED_IN");
  });

  it("F2 — a no-show whose room was not released can be reinstated when the guest calls", async () => {
    const r = await paidBooking();
    await processNoShows(eat("2026-10-11T01:05:00"));
    await reinstateNoShow(r.id, "Guest called: coming at 2am", await receptionistActor());
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("CONFIRMED");
    expect(after.lateArrivalNote).toBe("Guest called: coming at 2am");
  });

  it("H — every change carries original value, new value, user, time and reason", async () => {
    const r = await paidBooking();
    await changeStayDates(r.rooms[0].id, { arrivalDate: "2026-10-12", departureDate: "2026-10-14" }, await receptionistActor(), { reason: "Customer asked" });
    const items = await financeHistory({ ...WIDE, group: "bookings" });
    const item = items.find((i) => i.label.includes("dates"))!;
    expect(item.who).toContain("Asha");
    expect(item.reason).toBe("Customer asked");
    expect(item.changes).toContainEqual({ field: "Arrival", from: "2026-10-10", to: "2026-10-12" });
    expect(item.at).toBeInstanceOf(Date);
  });
});
