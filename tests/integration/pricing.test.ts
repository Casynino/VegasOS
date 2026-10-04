import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation, extendStay } from "@/server/services/reservations";
import { eat, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

const NOW = eat("2026-10-05T10:00:00");
const guest = { fullName: "Price Guest", phone: "0711000077" };

beforeEach(resetBusinessData);
// Keep only the migrated website price; every test adds its own promotions.
afterEach(async () => {
  await db.promotion.deleteMany({ where: { id: { not: "promo_website_standard" } } });
  await db.roomType.update({ where: { code: "DOUBLE_DELUXE" }, data: { baseRate: 80_000 } });
});

const book = async (from: string, to: string, roomId?: string) => {
  const dd = await roomType("DOUBLE_DELUXE");
  return createReservation(
    { sourceCode: "PHONE", guest, stay: { kind: "overnight", arrivalDate: from, departureDate: to }, rooms: [{ roomTypeId: dd.id, roomId: roomId ?? null, adults: 1, children: 0 }] },
    await receptionistActor(), NOW,
  );
};

describe("pricing engine", () => {
  it("a promotion for all rooms is applied by the server and snapshotted on every night", async () => {
    await db.promotion.create({ data: { name: "September Promotion", type: "PERCENT", value: 10, scope: "ALL" } });
    const r = await book("2026-10-10", "2026-10-12");
    expect(r.grossAmount).toBe(160_000);
    expect(r.discountAmount).toBe(16_000);
    expect(r.netAmount).toBe(144_000);
    expect(r.rooms[0].promotionName).toBe("September Promotion");
    const nights = await db.roomNight.findMany({ where: { reservationRoomId: r.rooms[0].id } });
    expect(nights.every((n) => n.promoDiscount === 8_000 && n.manualDiscount === 0 && n.netAmount === 72_000)).toBe(true);
  });

  it("the most specific promotion wins and promotions never stack", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const room204 = dd.rooms.find((x) => x.number === "204")!;
    await db.promotion.create({ data: { name: "All rooms", type: "PERCENT", value: 10, scope: "ALL" } });
    await db.promotion.create({ data: { name: "Double Deluxe deal", type: "FIXED", value: 5_000, scope: "ROOM_TYPES", roomTypeIds: [dd.id] } });
    await db.promotion.create({ data: { name: "Room 204", type: "PERCENT", value: 20, scope: "ROOMS", roomIds: [room204.id] } });
    const in204 = await book("2026-10-10", "2026-10-11", room204.id);
    expect(in204.netAmount).toBe(64_000); // room promotion only (not 10% + 20%)
    const other = await book("2026-10-10", "2026-10-11");
    expect(other.netAmount).toBe(75_000); // room-type promotion beats the all-rooms one
  });

  it("scheduled promotions only price the nights inside their dates", async () => {
    await db.promotion.create({ data: { name: "Weekend", type: "FIXED", value: 20_000, scope: "ALL", startDate: new Date("2026-10-11"), endDate: new Date("2026-10-11") } });
    const r = await book("2026-10-10", "2026-10-13"); // nights 10, 11, 12
    expect(r.netAmount).toBe(80_000 + 60_000 + 80_000);
  });

  it("changing the price never touches existing bookings; extension nights use the new price", async () => {
    const promo = await db.promotion.create({ data: { name: "10% off", type: "PERCENT", value: 10, scope: "ALL" } });
    const r = await book("2026-10-10", "2026-10-12");
    expect(r.netAmount).toBe(144_000);

    // Admin ends the promotion and raises the price.
    await db.promotion.update({ where: { id: promo.id }, data: { isActive: false } });
    await db.roomType.update({ where: { code: "DOUBLE_DELUXE" }, data: { baseRate: 90_000 } });
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).netAmount).toBe(144_000);

    await extendStay(r.rooms[0].id, "2026-10-14", await receptionistActor());
    const nights = await db.roomNight.findMany({ where: { reservationRoomId: r.rooms[0].id }, orderBy: { businessDate: "asc" } });
    expect(nights.map((n) => n.netAmount)).toEqual([72_000, 72_000, 90_000, 90_000]);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).netAmount).toBe(324_000);
  });
});
