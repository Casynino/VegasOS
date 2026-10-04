import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { changeRoom, quoteRoomChange, roomChangeOptions } from "@/server/services/room-changes";
import { getLedger } from "@/server/services/finance";
import { eat, managerActor, receptionistActor, resetBusinessData } from "../support/helpers";

/** Room changes — before check-in anyone, availability only (dearer: pay extra; cheaper: same price). After check-in only a free move for a room problem. */
beforeEach(resetBusinessData);
const BOOKED = eat("2026-10-05T10:00:00");
const method = (code: string) => db.paymentMethod.findUniqueOrThrow({ where: { code } });
const roomByNumber = (n: string) => db.room.findUniqueOrThrow({ where: { number: n } });

async function book(roomNumber: string, from: string, to: string, pay: number | null, name = "John Michael") {
  const room = await db.room.findUniqueOrThrow({ where: { number: roomNumber } });
  const cash = await method("CASH");
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: name }, stay: { kind: "overnight", arrivalDate: from, departureDate: to },
    rooms: [{ roomTypeId: room.roomTypeId, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
    payment: pay ? { amount: pay, methodId: cash.id } : null,
  }, await receptionistActor(), BOOKED);
}

describe("room changes", () => {
  it("TEST 1 — pre-check-in upgrade 301 → 302: pay 40,000 then the room changes; audit kept", async () => {
    const r = await book("301", "2026-10-10", "2026-10-11", 60_000);
    const to = await roomByNumber("302");
    const q = await quoteRoomChange(r.rooms[0].id, to.id, BOOKED);
    expect(q).toMatchObject({ oldPrice: 60_000, newPrice: 100_000, difference: 40_000, payNow: true });
    const rec = await receptionistActor();
    await expect(changeRoom({ reservationRoomId: r.rooms[0].id, toRoomId: to.id, source: "CUSTOMER" }, rec, BOOKED)).rejects.toThrow(/must pay the difference of TZS 40,000/);
    const cash = await method("CASH");
    const res = await changeRoom({ reservationRoomId: r.rooms[0].id, toRoomId: to.id, source: "CUSTOMER", payment: { methodId: cash.id } }, rec, BOOKED);
    expect(res.charged).toBe(40_000);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: { include: { assignments: true } }, payments: true } });
    expect(after.rooms[0].roomId).toBe(to.id);
    expect(after).toMatchObject({ netAmount: 100_000, paidAmount: 100_000, balanceAmount: 0 });
    expect(after.payments).toHaveLength(2);
    expect(after.rooms[0].assignments[0]).toMatchObject({ source: "CUSTOMER", oldPrice: 60_000, newStandardPrice: 100_000, charged: 40_000 });
    expect(await db.auditLog.count({ where: { entityId: r.id, action: "reservation.room_changed" } })).toBe(1);
  });

  it("TEST 2 — pre-check-in move to a cheaper room: the difference is shown, the price stays the same, no refund", async () => {
    const a = await book("404", "2026-10-10", "2026-10-11", 120_000);
    const dd = await roomByNumber("204");
    expect((await quoteRoomChange(a.rooms[0].id, dd.id, BOOKED)).difference).toBe(-40_000);
    const res = await changeRoom({ reservationRoomId: a.rooms[0].id, toRoomId: dd.id, source: "CUSTOMER", downgrade: "CREDIT" }, await receptionistActor(), BOOKED);
    expect(res.charged).toBe(0);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: a.id }, include: { payments: true, rooms: true } });
    expect(after.rooms[0].roomId).toBe(dd.id);
    expect(after).toMatchObject({ netAmount: 120_000, balanceAmount: 0 });
    expect(after.payments).toHaveLength(1);
  });

  it("TEST 3 — a checked-in guest cannot change room on request — not by reception, not by a manager", async () => {
    const r = await book("301", "2026-10-10", "2026-10-15", 300_000);
    await checkIn(r.id, await receptionistActor(), null, eat("2026-10-10T15:00:00"));
    const to = await roomByNumber("404");
    const bank = await method("BANK");
    for (const actor of [await receptionistActor(), await managerActor()]) {
      await expect(changeRoom({ reservationRoomId: r.rooms[0].id, toRoomId: to.id, source: "CUSTOMER", payment: { methodId: bank.id } }, actor, eat("2026-10-12T12:30:00")))
        .rejects.toThrow(/cannot change room on request/);
    }
  });

  it("TEST 4 + 6 — room problem (AC): anyone moves the guest free; slept nights stay in 301; old room maintenance, new room occupied", async () => {
    const r = await book("301", "2026-10-10", "2026-10-15", 300_000);
    await checkIn(r.id, await receptionistActor(), null, eat("2026-10-10T15:00:00"));
    const to = await roomByNumber("404");
    const MOVE = eat("2026-10-12T12:30:00");
    await expect(changeRoom({ reservationRoomId: r.rooms[0].id, toRoomId: to.id, source: "HOTEL" }, await receptionistActor(), MOVE)).rejects.toThrow(/why/);
    const opts = await roomChangeOptions(r.rooms[0].id, MOVE);
    expect(opts.options.find((o) => o.number === "404")).toMatchObject({ nights: 3, difference: 180_000 });
    const res = await changeRoom({ reservationRoomId: r.rooms[0].id, toRoomId: to.id, source: "HOTEL", reasonCode: "AC_PROBLEM", note: "AC broken" }, await receptionistActor(), MOVE);
    expect(res).toMatchObject({ charged: 0, compensation: 180_000 });
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { charges: true } });
    expect(after.charges).toHaveLength(0);
    expect(after.netAmount).toBe(300_000);
    const from = await roomByNumber("301");
    const nights = await db.roomNight.findMany({ where: { reservationRoomId: r.rooms[0].id }, orderBy: { businessDate: "asc" } });
    expect(nights.map((n) => n.roomId)).toEqual([from.id, from.id, to.id, to.id, to.id]);
    expect(nights.every((n) => n.netAmount === 60_000)).toBe(true);
    expect((await roomByNumber("301")).status).toBe("MAINTENANCE");
    expect((await roomByNumber("404")).status).toBe("OCCUPIED");
    expect(await db.shiftHandoverNote.count({ where: { kind: "MANAGER", body: { contains: "AC problem" } } })).toBe(1);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "reservation.room_changed" } });
    expect(log.after).toMatchObject({ source: "Hotel-initiated", charged: 0 });
    const rows = (await getLedger({ from: "2026-10-10", to: "2026-10-14", view: "income" })).rows.filter((x) => x.source === "ROOM");
    expect(rows.find((x) => x.businessDate === "2026-10-10")?.description).toMatch(/^Room 301/);
    expect(rows.find((x) => x.businessDate === "2026-10-12")?.description).toMatch(/^Room 404/);
  });

  it("TEST 5 — the wanted room is booked for those dates: rejected, and it is not offered", async () => {
    const r = await book("301", "2026-10-10", "2026-10-12", null);
    await book("404", "2026-10-11", "2026-10-13", null, "Other Guest");
    const to = await roomByNumber("404");
    await expect(changeRoom({ reservationRoomId: r.rooms[0].id, toRoomId: to.id, source: "CUSTOMER" }, await receptionistActor(), BOOKED)).rejects.toThrow(/no longer available/);
    const opts = await roomChangeOptions(r.rooms[0].id, BOOKED);
    expect(opts.options.some((o) => o.number === "404")).toBe(false);
    expect(opts.options.length).toBeGreaterThan(0);
  });

  it("TEST 7 — reception never types a price: the charge is the system's difference, whatever the room", async () => {
    const r = await book("301", "2026-10-10", "2026-10-11", 60_000);
    const twin = await roomByNumber("101");
    const cash = await method("CASH");
    const res = await changeRoom({ reservationRoomId: r.rooms[0].id, toRoomId: twin.id, source: "CUSTOMER", payment: { methodId: cash.id } }, await receptionistActor(), BOOKED);
    expect(res.charged).toBe((await db.roomType.findUniqueOrThrow({ where: { code: "TWIN" } })).baseRate - 60_000);
    // Unpaid (pending) booking: no payment needed — the new price simply applies.
    const p = await book("302", "2026-10-20", "2026-10-21", null, "Pending Guest");
    const suite = await roomByNumber("404");
    await changeRoom({ reservationRoomId: p.rooms[0].id, toRoomId: suite.id, source: "CUSTOMER" }, await receptionistActor(), BOOKED);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: p.id } })).netAmount).toBe(120_000);
  });
});
