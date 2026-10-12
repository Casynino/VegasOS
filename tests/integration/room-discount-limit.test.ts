import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { assertRoomDiscount, changeDiscount, createReservation } from "@/server/services/reservations";
import { setRoomTypeDiscountLimit } from "@/server/services/pricing-admin";
import { roomDiscountLimit } from "@/lib/discounts";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType, waiterActor } from "../support/helpers";

/**
 * A room type can have its own staff discount limit: every room follows the hotel's limit (20,000 a night),
 * the Twin room allows up to 40,000. The server decides — the buttons only mirror it.
 */
beforeEach(resetBusinessData);
const BOOKED = eat("2026-10-05T10:00:00");
/** Other dates, so a second booking of the same room is refused for its discount and not for the room being taken. */
const LATER: [string, string] = ["2026-10-20", "2026-10-22"];

async function book(typeCode: string, discountPerNight: number, name = "Amina Juma", [arrivalDate, departureDate] = ["2026-10-10", "2026-10-12"]) {
  const type = await roomType(typeCode);
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: name }, stay: { kind: "overnight", arrivalDate, departureDate },
    rooms: [{ roomTypeId: type.id, roomId: type.rooms[0].id, adults: 1, children: 0, discountPerNight, discountReason: "Agreed with the guest" }],
  }, await receptionistActor(), BOOKED);
}

/** Give one room type its own limit for the length of a test, then put back what it had. */
async function withTypeLimit<T>(typeCode: string, limit: number | null, fn: () => Promise<T>): Promise<T> {
  const before = await db.roomType.findUniqueOrThrow({ where: { code: typeCode }, select: { manualDiscountMax: true } });
  await db.roomType.update({ where: { code: typeCode }, data: { manualDiscountMax: limit } });
  try { return await fn(); } finally { await db.roomType.update({ where: { code: typeCode }, data: { manualDiscountMax: before.manualDiscountMax } }); }
}

describe("a room type's own discount limit", () => {
  it("the limit for one room: the type's own when it has one, the hotel's otherwise; nobody without the right gets one", () => {
    expect(roomDiscountLimit(20_000, null)).toBe(20_000);
    expect(roomDiscountLimit(20_000, undefined)).toBe(20_000);
    expect(roomDiscountLimit(20_000, 40_000)).toBe(40_000);
    expect(roomDiscountLimit(20_000, 10_000)).toBe(10_000);
    expect(roomDiscountLimit(20_000, 0)).toBe(0);
    expect(roomDiscountLimit(0, 40_000)).toBe(0);
  });

  it("only the Twin room is set to 40,000; the other rooms follow the hotel's limit", async () => {
    const types = await db.roomType.findMany({ select: { code: true, manualDiscountMax: true } });
    expect(types.find((t) => t.code === "TWIN")?.manualDiscountMax).toBe(40_000);
    expect(types.filter((t) => t.code !== "TWIN").every((t) => t.manualDiscountMax === null)).toBe(true);
    expect((await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).manualDiscountMax).toBe(20_000);
  });

  it("the Twin room takes 40,000 off a night; 45,000 is refused and says the Twin's limit", async () => {
    const r = await book("TWIN", 40_000);
    const nights = await db.roomNight.findMany({ where: { reservationRoomId: r.rooms[0].id } });
    expect(nights).toHaveLength(2);
    expect(nights.every((n) => n.grossAmount === 160_000 && n.manualDiscount === 40_000 && n.netAmount === 120_000)).toBe(true);
    await expect(book("TWIN", 45_000, "Baraka Said", LATER)).rejects.toThrow(/40,000/);
  });

  it("every other room stops at the hotel's 20,000", async () => {
    const r = await book("EXECUTIVE", 20_000);
    expect((await db.reservationRoom.findUniqueOrThrow({ where: { id: r.rooms[0].id } })).discountPerNight).toBe(20_000);
    await expect(book("EXECUTIVE_SUITE", 25_000, "Baraka Said")).rejects.toThrow(/20,000/);
    await expect(book("DOUBLE_DELUXE", 40_000, "Neema Paul")).rejects.toThrow(/20,000/);
  });

  it("changing the discount of a booked room follows that room's limit", async () => {
    const reception = await receptionistActor();
    const twin = (await book("TWIN", 0)).rooms[0];
    await changeDiscount(twin.id, 35_000, "Agreed", reception);
    await changeDiscount(twin.id, 40_000, "Agreed", reception);
    expect((await db.reservationRoom.findUniqueOrThrow({ where: { id: twin.id } })).discountPerNight).toBe(40_000);
    await expect(changeDiscount(twin.id, 45_000, "Agreed", reception)).rejects.toThrow(/40,000/);
    expect((await db.reservationRoom.findUniqueOrThrow({ where: { id: twin.id } })).discountPerNight).toBe(40_000);

    const suite = (await book("EXECUTIVE_SUITE", 0, "Baraka Said")).rooms[0];
    await expect(changeDiscount(suite.id, 25_000, "Agreed", reception)).rejects.toThrow(/20,000/);
    await changeDiscount(suite.id, 20_000, "Agreed", reception);
    expect((await db.reservationRoom.findUniqueOrThrow({ where: { id: suite.id } })).discountPerNight).toBe(20_000);
  });

  it("someone who may not give discounts cannot give one on the Twin either", async () => {
    const twin = (await book("TWIN", 0)).rooms[0];
    await expect(assertRoomDiscount(twin.id, 5_000, await waiterActor())).rejects.toThrow(/not allowed to give discounts/);
    // The hotel switched reception's discounts off: the Twin's own limit does not bring them back.
    await db.hotelSettings.update({ where: { id: 1 }, data: { receptionCanDiscount: false } });
    try {
      await expect(changeDiscount(twin.id, 5_000, "Agreed", await receptionistActor())).rejects.toThrow(/not allowed to give discounts/);
    } finally {
      await db.hotelSettings.update({ where: { id: 1 }, data: { receptionCanDiscount: true } });
    }
  });

  it("a room type can also be given a smaller limit, or none at all", async () => {
    await withTypeLimit("EXECUTIVE", 10_000, async () => {
      await expect(book("EXECUTIVE", 15_000)).rejects.toThrow(/10,000/);
      const r = await book("EXECUTIVE", 10_000);
      expect((await db.reservationRoom.findUniqueOrThrow({ where: { id: r.rooms[0].id } })).discountPerNight).toBe(10_000);
    });
    await withTypeLimit("EXECUTIVE", 0, async () => {
      await expect(book("EXECUTIVE", 5_000, "Baraka Said", LATER)).rejects.toThrow(/No discount can be given on this room/);
    });
  });

  it("the Admin gives a room its own limit, and takes it away again — written to the history once", async () => {
    const admin = await managerActor();
    const exec = await roomType("EXECUTIVE");
    const log = () => db.auditLog.findMany({ where: { action: "pricing.room_discount_limit", entityId: exec.id }, orderBy: { createdAt: "asc" } });
    const mark = (await log()).length;
    try {
      expect(await db.$transaction((tx) => setRoomTypeDiscountLimit(tx, exec.id, 30_000, admin))).toEqual({ changed: true });
      const r = await book("EXECUTIVE", 30_000);
      expect((await db.reservationRoom.findUniqueOrThrow({ where: { id: r.rooms[0].id } })).discountPerNight).toBe(30_000);
      await expect(book("EXECUTIVE", 35_000, "Baraka Said", LATER)).rejects.toThrow(/30,000/);
      // Saving the same limit again changes nothing and writes nothing.
      expect(await db.$transaction((tx) => setRoomTypeDiscountLimit(tx, exec.id, 30_000, admin))).toEqual({ changed: false });
      expect((await log()).slice(mark)).toHaveLength(1);
      expect((await log()).at(-1)).toMatchObject({ userId: admin.userId, before: { manualDiscountMax: null }, after: { manualDiscountMax: 30_000 } });

      // Empty = back on the hotel's limit. The discount the first booking already has is not touched.
      expect(await db.$transaction((tx) => setRoomTypeDiscountLimit(tx, exec.id, null, admin))).toEqual({ changed: true });
      await expect(book("EXECUTIVE", 25_000, "Baraka Said", LATER)).rejects.toThrow(/20,000/);
      expect((await db.reservationRoom.findUniqueOrThrow({ where: { id: r.rooms[0].id } })).discountPerNight).toBe(30_000);
      expect((await log()).at(-1)).toMatchObject({ before: { manualDiscountMax: 30_000 }, after: { manualDiscountMax: null } });

      await expect(db.$transaction((tx) => setRoomTypeDiscountLimit(tx, exec.id, -1, admin))).rejects.toThrow(/valid amount/);
      await expect(db.$transaction((tx) => setRoomTypeDiscountLimit(tx, exec.id, 1500.5, admin))).rejects.toThrow(/valid amount/);
      await expect(db.$transaction((tx) => setRoomTypeDiscountLimit(tx, "no-such-room-type", 30_000, admin))).rejects.toThrow(/not found/);
      expect((await db.roomType.findUniqueOrThrow({ where: { id: exec.id } })).manualDiscountMax).toBeNull();
    } finally {
      await db.roomType.update({ where: { id: exec.id }, data: { manualDiscountMax: null } });
    }
  });

  it("when the guest is moving to another room, the room they move to decides", async () => {
    const reception = await receptionistActor();
    const twinRoom = (await roomType("TWIN")).rooms[0];
    const execRoom = (await roomType("EXECUTIVE")).rooms[0];
    const suite = (await book("EXECUTIVE_SUITE", 0)).rooms[0];
    await expect(assertRoomDiscount(suite.id, 40_000, reception, twinRoom.id)).resolves.toBeUndefined();
    await expect(assertRoomDiscount(suite.id, 45_000, reception, twinRoom.id)).rejects.toThrow(/40,000/);
    const twin = (await book("TWIN", 0, "Baraka Said")).rooms[0];
    await expect(assertRoomDiscount(twin.id, 25_000, reception, execRoom.id)).rejects.toThrow(/20,000/);
    // Taking a discount away is never refused.
    await expect(assertRoomDiscount(twin.id, 0, await waiterActor())).resolves.toBeUndefined();
  });
});
