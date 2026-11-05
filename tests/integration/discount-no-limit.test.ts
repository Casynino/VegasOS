import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { assertRoomDiscount, changeDiscount, createReservation } from "@/server/services/reservations";
import { discountLimit, NO_DISCOUNT_LIMIT, roomDiscountLimit } from "@/lib/discounts";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType, waiterActor } from "../support/helpers";

/**
 * There is NO maximum staff discount (owner, 2026-11-05): not a hotel limit (it was 20,000 a night), not a room type's own
 * (the Twin room had 40,000). Who may give a discount is unchanged. The only bound is the price: a night never goes below zero.
 */
beforeEach(resetBusinessData);
const BOOKED = eat("2026-10-05T10:00:00");

async function book(typeCode: string, discountPerNight: number, name = "Amina Juma", [arrivalDate, departureDate] = ["2026-10-10", "2026-10-12"]) {
  const type = await roomType(typeCode);
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: name }, stay: { kind: "overnight", arrivalDate, departureDate },
    rooms: [{ roomTypeId: type.id, roomId: type.rooms[0].id, adults: 1, children: 0, discountPerNight, discountReason: "Agreed with the guest" }],
  }, await receptionistActor(), BOOKED);
}
const row = async (reservationRoomId: string) => db.reservationRoom.findUniqueOrThrow({ where: { id: reservationRoomId } });

describe("the staff discount has no maximum", () => {
  it("whoever may give a discount has no cap; whoever may not has none to give; a room type's own number is ignored", () => {
    const reception = new Set(["reservations.edit"]);
    const manager = new Set(["reservations.edit", "reservations.discount_override"]);
    const boss = new Set(["pricing.manage"]);
    for (const p of [reception, manager, boss]) expect(discountLimit(p)).toBe(NO_DISCOUNT_LIMIT);
    expect(discountLimit(new Set(["restaurant.orders"]))).toBe(0);
    expect(discountLimit(undefined)).toBe(0);
    // The hotel's switches still decide who may.
    expect(discountLimit(reception, { receptionCanDiscount: false, managerCanDiscount: true })).toBe(0);
    expect(discountLimit(manager, { receptionCanDiscount: true, managerCanDiscount: false })).toBe(0);
    // A room type's own limit (the old Twin 40,000) changes nothing now.
    expect(roomDiscountLimit(NO_DISCOUNT_LIMIT, 40_000)).toBe(NO_DISCOUNT_LIMIT);
    expect(roomDiscountLimit(NO_DISCOUNT_LIMIT, 0)).toBe(NO_DISCOUNT_LIMIT);
    expect(roomDiscountLimit(0, 40_000)).toBe(0);
  });

  it("reception books with a discount far above the old 20,000 and 40,000; the totals add up", async () => {
    const type = await roomType("TWIN");
    const off = type.baseRate - 10_000; // far above the old limits, still under the price
    const r = await book("TWIN", off);
    const rr = await row(r.rooms[0].id);
    expect(rr.discountPerNight).toBe(off);
    expect(rr.grossAmount).toBe(type.baseRate * 2);
    expect(rr.discountAmount).toBe(off * 2);
    expect(rr.netAmount).toBe(10_000 * 2);
    const nights = await db.roomNight.findMany({ where: { reservationRoomId: rr.id } });
    expect(nights).toHaveLength(2);
    expect(nights.every((n) => n.manualDiscount === off && n.netAmount === 10_000)).toBe(true);
    // The booking carries the same money: what is owed is the net, nothing is marked paid.
    const res = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(res.netAmount).toBe(20_000);
    expect(res.balanceAmount).toBe(20_000);
    expect(res.paidAmount).toBe(0);
  });

  it("other rooms are the same (they stopped at 20,000 before)", async () => {
    for (const code of ["EXECUTIVE", "EXECUTIVE_SUITE", "DOUBLE_DELUXE"]) {
      const type = await roomType(code);
      const off = Math.min(60_000, type.baseRate);
      const r = await book(code, off, `Guest ${code}`);
      expect((await row(r.rooms[0].id)).discountPerNight).toBe(off);
    }
  });

  it("a discount bigger than the price takes the night to zero, never below it — and the saved discount is what was really taken off", async () => {
    const type = await roomType("TWIN");
    const r = await book("TWIN", type.baseRate * 5);
    const rr = await row(r.rooms[0].id);
    expect(rr.discountPerNight).toBe(type.baseRate);
    expect(rr.netAmount).toBe(0);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).netAmount).toBe(0);
  });

  it("changing the discount of a booked room: any amount, for reception and for a manager; recorded with who, how much and why", async () => {
    const reception = await receptionistActor();
    const manager = await managerActor();
    const type = await roomType("EXECUTIVE_SUITE");
    const rr0 = (await book("EXECUTIVE_SUITE", 0)).rooms[0];
    await changeDiscount(rr0.id, 45_000, "Agreed", reception);
    expect((await row(rr0.id)).discountPerNight).toBe(Math.min(45_000, type.baseRate));
    await changeDiscount(rr0.id, 70_000, "Boss said so", manager);
    const after = await row(rr0.id);
    expect(after.discountPerNight).toBe(Math.min(70_000, type.baseRate));
    expect(after.netAmount).toBe((type.baseRate - after.discountPerNight) * after.nights);
    expect(after).toMatchObject({ discountReason: "Boss said so", discountSetById: manager.userId, discountOverridden: true });
    const log = await db.auditLog.findMany({ where: { action: "reservation.discount_changed", entityId: rr0.reservationId }, orderBy: { createdAt: "asc" } });
    expect(log).toHaveLength(2);
    expect(log.at(-1)).toMatchObject({ userId: manager.userId, after: { discountPerNight: after.discountPerNight, reason: "Boss said so" } });
  });

  it("an old limit still sitting in the database (a room type's, the hotel's) blocks nothing", async () => {
    const type = await roomType("EXECUTIVE");
    await db.roomType.update({ where: { id: type.id }, data: { manualDiscountMax: 1_000 } });
    await db.hotelSettings.update({ where: { id: 1 }, data: { manualDiscountMax: 1_000 } });
    try {
      const rr = (await book("EXECUTIVE", 50_000)).rooms[0];
      expect((await row(rr.id)).discountPerNight).toBe(Math.min(50_000, type.baseRate));
      await changeDiscount(rr.id, 60_000, "Agreed", await receptionistActor());
      expect((await row(rr.id)).discountPerNight).toBe(Math.min(60_000, type.baseRate));
    } finally {
      await db.roomType.update({ where: { id: type.id }, data: { manualDiscountMax: null } });
      await db.hotelSettings.update({ where: { id: 1 }, data: { manualDiscountMax: 20_000 } });
    }
  });

  it("who may give a discount is unchanged: a waiter may not, and the hotel's switch for reception still works", async () => {
    const rr = (await book("TWIN", 0)).rooms[0];
    await expect(assertRoomDiscount(rr.id, 5_000, await waiterActor())).rejects.toThrow(/not allowed to give discounts/);
    await expect(changeDiscount(rr.id, 5_000, "Agreed", await waiterActor())).rejects.toThrow(/not allowed to give discounts/);
    await db.hotelSettings.update({ where: { id: 1 }, data: { receptionCanDiscount: false } });
    try {
      await expect(changeDiscount(rr.id, 5_000, "Agreed", await receptionistActor())).rejects.toThrow(/not allowed to give discounts/);
      await expect(book("EXECUTIVE", 5_000, "Baraka Said")).rejects.toThrow(/not allowed to give discounts/);
    } finally {
      await db.hotelSettings.update({ where: { id: 1 }, data: { receptionCanDiscount: true } });
    }
    // Taking a discount away is never refused.
    await expect(assertRoomDiscount(rr.id, 0, await waiterActor())).resolves.toBeUndefined();
  });
});
