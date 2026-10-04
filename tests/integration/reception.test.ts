import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { assignAndCheckIn, checkOut, createReservation, previewCheckOut } from "@/server/services/reservations";
import { getReceptionBoard } from "@/server/services/front-desk";
import { receptionSearch } from "@/server/services/reception-search";
import { postRoomCharges } from "@/server/services/payments";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(async () => {
  await resetBusinessData();
  await db.roomAssignment.deleteMany();
  await db.bookingRequest.deleteMany();
});

const NOW = eat("2026-10-05T15:00:00");
const LATER = eat("2026-10-06T10:00:00"); // early departure (booked until the 7th)

async function arrival(roomNumber: string, guest = { fullName: "John Michael", phone: "0712 345 678" }) {
  const t = await roomType("DOUBLE_DELUXE");
  const roomId = t.rooms.find((r) => r.number === roomNumber)!.id;
  return createReservation({
    sourceCode: "WEBSITE", guest, status: "CONFIRMED", eta: "17:30",
    stay: { kind: "overnight", arrivalDate: "2026-10-05", departureDate: "2026-10-07" },
    rooms: [{ roomTypeId: t.id, roomId, adults: 2, children: 0 }],
  }, await managerActor(), eat("2026-10-01T10:00:00"));
}

describe("reception: assign & check in", () => {
  it("assigns a different ready room and checks in, in one step", async () => {
    const r = await arrival("204");
    const t = await roomType("DOUBLE_DELUXE");
    const target = t.rooms.find((x) => x.number !== "204")!;
    const recep = await receptionistActor();
    await assignAndCheckIn(r.id, { assignments: [{ reservationRoomId: r.rooms[0].id, roomId: target.id }], guest: { idType: "PASSPORT", idNumber: "AB123" } }, recep, NOW);

    const rr = await db.reservationRoom.findUniqueOrThrow({ where: { id: r.rooms[0].id }, include: { assignments: true, reservation: { include: { guest: true } } } });
    expect(rr).toMatchObject({ roomId: target.id, status: "CHECKED_IN", checkedInById: recep.userId });
    expect(rr.assignments).toHaveLength(1);
    expect(rr.reservation.guest.idNumber).toBe("AB123");
    expect((await db.room.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("OCCUPIED");
    expect(await db.auditLog.count({ where: { action: "reservation.checked_in", entityId: r.id } })).toBe(1);
  });

  it("saves corrections made at the desk, logs them, and never wipes a detail left blank", async () => {
    const r = await arrival("204", { fullName: "Known Guest", phone: "0700 111 222" });
    await db.guest.update({ where: { id: r.guestId }, data: { idNumber: "ORIGINAL", nationality: "Kenyan" } });
    await assignAndCheckIn(r.id, { guest: { idNumber: "CORRECTED", phone: "0799999999", nationality: "" } }, await receptionistActor(), NOW);
    const g = await db.guest.findUniqueOrThrow({ where: { id: r.guestId } });
    expect(g).toMatchObject({ idNumber: "CORRECTED", phone: "+255799999999", nationality: "Kenyan" });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "guest.updated_at_checkin", entityId: r.guestId } });
    expect(log.before).toMatchObject({ idNumber: "ORIGINAL", phone: "+255700111222" });
  });

  it("refuses a dirty room unless an authorised override with a reason is given — and rolls back the move", async () => {
    const r = await arrival("204");
    const t = await roomType("DOUBLE_DELUXE");
    const dirty = t.rooms.find((x) => x.number !== "204")!;
    await db.room.update({ where: { id: dirty.id }, data: { status: "DIRTY" } });
    const move = { assignments: [{ reservationRoomId: r.rooms[0].id, roomId: dirty.id }] };

    await expect(assignAndCheckIn(r.id, move, await receptionistActor(), NOW)).rejects.toThrow(/dirty/);
    await expect(assignAndCheckIn(r.id, { ...move, notReadyOverride: "Inspected, just not updated" }, await receptionistActor(), NOW)).rejects.toThrow(/dirty/);
    const untouched = await db.reservationRoom.findUniqueOrThrow({ where: { id: r.rooms[0].id } });
    expect(untouched).toMatchObject({ status: "CONFIRMED", roomId: r.rooms[0].roomId }); // the failed move was rolled back

    const res = await assignAndCheckIn(r.id, { ...move, notReadyOverride: "Inspected by manager" }, await managerActor(), NOW);
    expect(res.warnings.join(" ")).toMatch(/override/);
    expect(await db.auditLog.count({ where: { action: "reservation.checkin_not_ready_override" } })).toBe(1);
  });

  it("the board offers only same-type rooms that are free, flagging readiness", async () => {
    const r = await arrival("204");
    await arrival("205", { fullName: "Other Guest", phone: "0700 000 555" });
    const board = await getReceptionBoard("2026-10-05", NOW);
    const card = board.arrivals.find((a) => a.id === r.id)!;
    const numbers = card.rooms[0].options.map((o) => o.number);
    expect(numbers).toContain("204");
    expect(numbers).not.toContain("205");
    expect(card.rooms[0].current).toMatchObject({ number: "204", ready: true });
  });
});

describe("reception: search & checkout", () => {
  it("finds a reservation by first name, phone in any format, reference or room", async () => {
    const r = await arrival("204");
    for (const q of ["john", "michael JOHN", "0712345678", "+255 712 345 678", r.reference.slice(-4), "204"]) {
      const res = await receptionSearch(q);
      expect(res?.reservations.map((x) => x.id), q).toContain(r.id);
    }
  });

  it("an unpaid checkout needs an authorised override with a reason", async () => {
    const r = await arrival("204");
    const mgr = await managerActor();
    await assignAndCheckIn(r.id, { guest: { idNumber: "X1" } }, mgr, NOW);
    await expect(checkOut(r.id, await receptionistActor(), { allowBalance: true, earlyReason: "plans" }, LATER)).rejects.toThrow(/only a manager/);
    await expect(checkOut(r.id, mgr, { allowBalance: true, earlyReason: "plans" }, LATER)).rejects.toThrow(/reason/);
    const res = await checkOut(r.id, mgr, { allowBalance: true, earlyReason: "plans", overrideReason: "Pays by M-Pesa tomorrow" }, LATER);
    expect(res.balance).toBeGreaterThan(0);
    const room = await db.room.findUniqueOrThrow({ where: { id: r.rooms[0].roomId } });
    expect(room.status).toBe("DIRTY");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "reservation.checked_out", entityId: r.id } });
    expect(JSON.stringify(log.after)).toContain("Pays by M-Pesa tomorrow");
  });
});

describe("reception: one-screen checkout", () => {
  const ON_TIME = eat("2026-10-07T10:30:00");
  const DAY_AFTER = eat("2026-10-08T10:30:00"); // stayed a night past the 7th without an extension

  async function inHouse() {
    const r = await arrival("204");
    await assignAndCheckIn(r.id, { guest: { idNumber: "X1" } }, await managerActor(), NOW);
    return db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: true } });
  }
  const cash = () => db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });

  it("records the payment and checks out in one step; the room goes to cleaning", async () => {
    const r = await inHouse();
    const preview = await previewCheckOut(r.id, {}, ON_TIME);
    expect(preview.balance).toBe(r.balanceAmount);
    await checkOut(r.id, await receptionistActor(), { payment: { amount: preview.balance, methodId: (await cash()).id, reference: "R-1" } }, ON_TIME);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after).toMatchObject({ status: "CHECKED_OUT", balanceAmount: 0 });
    expect(await db.payment.count({ where: { reservationId: r.id, reference: "R-1" } })).toBe(1);
    expect((await db.room.findUniqueOrThrow({ where: { id: r.rooms[0].roomId } })).status).toBe("DIRTY");
  });

  it("a short payment without a manager leaves nothing half-done", async () => {
    const r = await inHouse();
    await expect(checkOut(r.id, await receptionistActor(), { payment: { amount: 1000, methodId: (await cash()).id } }, ON_TIME)).rejects.toThrow(/still owes/);
    expect(await db.payment.count({ where: { reservationId: r.id } })).toBe(0);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CHECKED_IN");
  });

  it("previews the final bill without changing anything", async () => {
    const r = await inHouse();
    const p = await previewCheckOut(r.id, {}, DAY_AFTER);
    expect(p.overstayNights).toBe(1);
    expect(p.total).toBe(r.netAmount + p.overstayAmount);
    const still = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: true } });
    expect(still.status).toBe("CHECKED_IN");
    expect(still.netAmount).toBe(r.netAmount);
    expect(await db.auditLog.count({ where: { action: "reservation.checked_out", entityId: r.id } })).toBe(0);
  });

  it("an overstayed night is only charged if staff choose to", async () => {
    const r = await inHouse();
    const waived = await previewCheckOut(r.id, { chargeOverstay: false }, DAY_AFTER);
    expect(waived.total).toBe(r.netAmount);
    await checkOut(r.id, await managerActor(), { chargeOverstay: false, payment: { amount: waived.balance, methodId: (await cash()).id } }, DAY_AFTER);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: true } });
    expect(after.netAmount).toBe(r.netAmount);
    expect(after.rooms[0].nights).toBe(2);
  });
});

describe("reception: room charges", () => {
  it("posts several items to the room in one go, counts them as restaurant/bar income, and can take payment at once", async () => {
    const r = await arrival("204");
    const mgr = await managerActor();
    await assignAndCheckIn(r.id, { guest: { idNumber: "X1" } }, mgr, NOW);
    const before = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });

    const res = await postRoomCharges({ reservationId: r.id, lines: [
      { type: "ROOM_SERVICE", item: "Breakfast", qty: 2, unitPrice: 15_000 },
      { type: "MINIBAR", item: "Soda", qty: 3, unitPrice: 2_000 },
    ] }, await receptionistActor());
    expect(res.total).toBe(36_000);
    const charges = await db.reservationCharge.findMany({ where: { reservationId: r.id }, orderBy: { amount: "desc" } });
    expect(charges.map((c) => [c.description, c.amount, c.kind])).toEqual([["2 × Breakfast", 30_000, "RESTAURANT"], ["3 × Soda", 6_000, "BAR"]]);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).balanceAmount).toBe(before.balanceAmount + 36_000);

    const paidNow = await postRoomCharges({ reservationId: r.id, lines: [{ type: "LAUNDRY", item: "Shirts", qty: 1, unitPrice: 8_000 }], pay: { methodId: cash.id } }, await receptionistActor());
    expect(paidNow.paid).toBe(8_000);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).balanceAmount).toBe(before.balanceAmount + 36_000);
  });
});
