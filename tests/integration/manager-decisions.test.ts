import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation, extendStayFree } from "@/server/services/reservations";
import { changeRoom } from "@/server/services/room-changes";
import { fromDbDate } from "@/lib/time/business-date";
import { eat, managerActor, receptionistActor, resetBusinessData } from "../support/helpers";

/** Decisions that are the manager's (and the MD's / owner's): free nights, moving a guest for a room problem. */
beforeEach(async () => {
  await resetBusinessData();
  await db.roomAssignment.deleteMany();
});
const BOOKED = eat("2026-10-05T10:00:00");
const roomByNumber = (n: string) => db.room.findUniqueOrThrow({ where: { number: n } });

async function stay(roomNumber: string, from: string, to: string) {
  const room = await roomByNumber(roomNumber);
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: "Grace Mushi" }, stay: { kind: "overnight", arrivalDate: from, departureDate: to },
    rooms: [{ roomTypeId: room.roomTypeId, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await receptionistActor(), BOOKED);
  await checkIn(r.id, await receptionistActor(), null, eat(`${from}T15:00:00`));
  return r;
}

describe("manager decisions on a stay", () => {
  it("free nights: the stay is longer, the bill is not — recorded with the reason", async () => {
    const r = await stay("301", "2026-10-10", "2026-10-12");
    const before = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    await expect(extendStayFree(r.rooms[0].id, "2026-10-14", "VIP", await receptionistActor())).rejects.toThrow(/Only a manager/);
    await extendStayFree(r.rooms[0].id, "2026-10-14", "Loyal guest, noise last night", await managerActor());
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: { include: { nightsLedger: true } } } });
    expect(fromDbDate(after.rooms[0].departureDate)).toBe("2026-10-14");
    expect(after.netAmount).toBe(before.netAmount);
    expect(after.rooms[0].nightsLedger.filter((n) => n.complimentary)).toHaveLength(2);
    expect(await db.auditLog.count({ where: { action: "reservation.extended_free", entityId: r.id } })).toBe(1);
  });

  it("MOVE GUEST — the manager moves 305 → 406 for an AC problem: booking updated, 305 to maintenance, 406 occupied, bill kept, who/why/when recorded", async () => {
    const r = await stay("305", "2026-10-10", "2026-10-13");
    const before = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    const mgr = await managerActor();
    const to = await roomByNumber("406");
    const MOVE = eat("2026-10-11T12:00:00");
    await changeRoom({ reservationRoomId: r.rooms[0].id, toRoomId: to.id, source: "HOTEL", reasonCode: "AC_PROBLEM", note: "AC stopped working" }, mgr, MOVE);
    const rr = await db.reservationRoom.findUniqueOrThrow({ where: { id: r.rooms[0].id } });
    expect(rr.roomId).toBe(to.id);
    expect((await roomByNumber("305")).status).toBe("MAINTENANCE");
    expect((await roomByNumber("406")).status).toBe("OCCUPIED");
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).netAmount).toBe(before.netAmount);
    const move = await db.roomAssignment.findFirstOrThrow({ where: { reservationRoomId: rr.id } });
    expect(move).toMatchObject({ source: "HOTEL", reasonCode: "AC_PROBLEM", changedById: mgr.userId, oldRoomStatus: "MAINTENANCE", charged: 0 });
    expect(move.reason).toMatch(/AC problem: AC stopped working/);
    expect(move.changedAt).toEqual(MOVE);
  });
});

describe("closing a room for dates", () => {
  it("refuses dates a guest is booked in; closes free dates; the closure can be cancelled — all audited", async () => {
    const { planRoomClosure, cancelRoomClosure } = await import("@/server/services/room-decisions");
    const { findAvailableRooms } = await import("@/server/services/availability");
    const { businessDateOf, addDays } = await import("@/lib/time/business-date");
    const today = businessDateOf(new Date());
    const room = await roomByNumber("401");
    await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Booked Guest" }, stay: { kind: "overnight", arrivalDate: addDays(today, 5), departureDate: addDays(today, 7) },
      rooms: [{ roomTypeId: room.roomTypeId, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, await receptionistActor());
    const mgr = await managerActor();
    await expect(planRoomClosure({ roomId: room.id, from: addDays(today, 4), to: addDays(today, 6), type: "MAINTENANCE", reason: "Painting" }, await receptionistActor())).rejects.toThrow(/Only a manager/);
    await expect(planRoomClosure({ roomId: room.id, from: addDays(today, 4), to: addDays(today, 6), type: "MAINTENANCE", reason: "Painting" }, mgr)).rejects.toThrow(/booked in those dates: Booked Guest/);
    const c = await planRoomClosure({ roomId: room.id, from: addDays(today, 1), to: addDays(today, 3), type: "MAINTENANCE", reason: "Painting" }, mgr);
    const stay = { arrivalDate: addDays(today, 1), departureDate: addDays(today, 2), startAt: new Date(Date.now() + 86_400_000), endAt: new Date(Date.now() + 2 * 86_400_000), isDayUse: false };
    expect((await findAvailableRooms({ stay, roomIds: [room.id] })).length).toBe(0);
    await cancelRoomClosure(c.id, "Painter postponed", mgr);
    expect((await findAvailableRooms({ stay, roomIds: [room.id] })).length).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: room.id, action: { in: ["room.closure_planned", "room.closure_cancelled"] } } })).toBe(2);
    await db.roomBlock.deleteMany({ where: { roomId: room.id } });
  });
});

describe("staff supervision", () => {
  it("says what each person did today in plain words, by department", async () => {
    const { commandCenter } = await import("@/server/services/command-center");
    const { businessDateOf } = await import("@/lib/time/business-date");
    const today = businessDateOf(new Date());
    const { addDays } = await import("@/lib/time/business-date");
    const room = await roomByNumber("303");
    const rec = await receptionistActor();
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Walk In" }, stay: { kind: "overnight", arrivalDate: today, departureDate: addDays(today, 1) },
      rooms: [{ roomTypeId: room.roomTypeId, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, rec);
    await checkIn(r.id, rec);
    const c = await commandCenter({ today, now: new Date(), tablesWaiting: [], tables: { seated: 0, bill: 0, free: 0, total: 0 }, shiftOpen: null, expensesPending: { count: 0, amount: 0 }, reportFailedId: null });
    const reception = c.activity.find((g) => g.department === "Reception")!;
    expect(reception.people[0].things).toEqual(expect.arrayContaining(["Checked in 1 guest", "Created 1 reservation"]));
    expect(reception.people[0].id).toBe(rec.userId);
  });
});

describe("letting a guest leave owing", () => {
  it("reception cannot check out owing — until a manager allows it (up to that amount), recorded with who and why", async () => {
    const { approveLeaveOwing, checkOut } = await import("@/server/services/reservations");
    const r = await stay("304", "2026-10-10", "2026-10-12");
    const rec = await receptionistActor(), mgr = await managerActor();
    const OUT = eat("2026-10-12T10:00:00");
    await expect(checkOut(r.id, rec, { chargeOverstay: true }, OUT)).rejects.toThrow(/only a manager can let a guest leave owing/);
    await expect(approveLeaveOwing(r.id, "ok", rec)).rejects.toThrow(/Only a manager/);
    const a = await approveLeaveOwing(r.id, "Company pays Friday", mgr);
    expect(a.upTo).toBeGreaterThan(0);
    await checkOut(r.id, rec, { chargeOverstay: true }, OUT);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("CHECKED_OUT");
    expect(after.balanceAmount).toBe(a.upTo);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "reservation.checked_out" } });
    expect(log.after).toMatchObject({ unpaidAccepted: true, overrideReason: expect.stringMatching(/Approved by .*: Company pays Friday/) });
  });
});

describe("the manager's restaurant powers", () => {
  it("adds a table (next number, own QR), switches it off with a reason and back on", async () => {
    const { addTable, setTableInUse } = await import("@/server/services/restaurant-locations");
    const mgr = await managerActor();
    const t = await addTable({ area: "INSIDE" }, mgr);
    try {
      const row = await db.restaurantLocation.findUniqueOrThrow({ where: { id: t.id } });
      const before = await db.restaurantLocation.count({ where: { kind: "TABLE", area: "INSIDE", number: { gte: row.number! } } });
      expect(before).toBe(1);
      expect(row).toMatchObject({ kind: "TABLE", isActive: true, qrActive: true, name: `Table ${row.number} — Inside` });
      await expect(setTableInUse(t.id, false, "", mgr)).rejects.toThrow(/Say why/);
      await expect(addTable({ area: "INSIDE" }, await receptionistActor())).rejects.toThrow(/Only a manager/);
      await setTableInUse(t.id, false, "Broken leg", mgr);
      expect(await db.restaurantLocation.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ isActive: false, qrActive: false });
      await setTableInUse(t.id, true, null, mgr);
      expect(await db.auditLog.count({ where: { entityId: t.id, action: { startsWith: "restaurant_table." } } })).toBe(3);
    } finally {
      await db.restaurantLocation.delete({ where: { id: t.id } });
    }
  });

  it("hands an order to a waiter (in its history) and a complaint needs a resolution to close", async () => {
    const { createRestaurantOrder, assignOrder, waitersToAssign } = await import("@/server/services/restaurant");
    const { createServiceRequest, updateServiceRequest } = await import("@/server/services/requests");
    const mgr = await managerActor();
    const o = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "Table 4", settlement: "UNPAID", items: [{ menuItemId: "mi_beers_heineken", quantity: 1 }] }, await receptionistActor());
    const waiter = (await waitersToAssign())[0];
    expect(waiter).toBeTruthy();
    await expect(assignOrder(o.id, waiter.id, await receptionistActor())).rejects.toThrow(/Only a manager/);
    await assignOrder(o.id, waiter.id, mgr);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.id);
    expect(await db.restaurantOrderEvent.count({ where: { orderId: o.id, note: { startsWith: "The manager gave it to" } } })).toBe(1);
    const c = await createServiceRequest({ type: "COMPLAINT", priority: "HIGH", description: "Beer was warm", orderId: o.id }, { userId: mgr.userId!, label: mgr.label });
    try {
      await expect(updateServiceRequest(c.id, { status: "COMPLETED" }, { userId: mgr.userId!, label: mgr.label })).rejects.toThrow(/how the complaint was resolved/);
      await updateServiceRequest(c.id, { status: "COMPLETED", resolution: "Replaced with a cold one" }, { userId: mgr.userId!, label: mgr.label });
      expect(await db.serviceRequest.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "COMPLETED", resolution: "Replaced with a cold one", orderId: o.id });
    } finally {
      await db.serviceRequest.deleteMany({ where: { id: c.id } });
    }
  });
});

describe("the manager's table controls", () => {
  it("blocks a free table (nobody seated, no QR orders, nobody moved in) and reopens it — audited", async () => {
    const { setTableBlocked, activeLocation } = await import("@/server/services/restaurant-locations");
    const { seatCustomer } = await import("@/server/services/dining-sessions");
    const mgr = await managerActor();
    const t = await db.restaurantLocation.findUniqueOrThrow({ where: { id: "loc_in_5" } });
    try {
      await expect(setTableBlocked(t.id, "MAINTENANCE", "", mgr)).rejects.toThrow(/Say why/);
      await expect(setTableBlocked(t.id, "MAINTENANCE", "Broken leg", await receptionistActor())).rejects.toThrow(/Only a manager/);
      await setTableBlocked(t.id, "MAINTENANCE", "Broken leg", mgr);
      await expect(seatCustomer({ locationId: t.id, name: "Asha Test", phone: "0712 000 111", guestCount: 2 }, mgr)).rejects.toThrow(/under maintenance/);
      await expect(activeLocation(t.qrToken)).rejects.toThrow(/not available right now/);
      await setTableBlocked(t.id, null, null, mgr);
      expect(await db.restaurantLocation.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ blockedAs: null });
      expect(await db.auditLog.count({ where: { entityId: t.id, action: { in: ["restaurant_table.blocked", "restaurant_table.reopened"] } } })).toBe(2);
    } finally {
      await db.restaurantLocation.update({ where: { id: t.id }, data: { blockedAs: null, blockedReason: null, blockedAt: null, blockedById: null } });
    }
  });

  it("puts a waiter in charge of a table: its open orders and the next ones go to them", async () => {
    const { seatCustomer } = await import("@/server/services/dining-sessions");
    const { createRestaurantOrder, assignSessionWaiter, waitersToAssign } = await import("@/server/services/restaurant");
    const mgr = await managerActor();
    await db.restaurantLocation.updateMany({ data: { isActive: true, blockedAs: null } });
    const s = await seatCustomer({ locationId: "loc_in_6", name: "Table Guest", phone: "0712 000 222", guestCount: 2 }, mgr);
    const first = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_6", settlement: "UNPAID", customerName: "Table Guest", items: [{ menuItemId: "mi_beers_heineken", quantity: 1 }] }, await receptionistActor(), new Date(), { sessionId: s.id });
    const waiter = (await waitersToAssign())[0];
    const r = await assignSessionWaiter(s.id, waiter.id, mgr);
    expect(r.orders).toBe(1);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: first.id } })).assignedToId).toBe(waiter.id);
    const next = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_6", settlement: "UNPAID", customerName: "Table Guest", items: [{ menuItemId: "mi_beers_heineken", quantity: 1 }] }, await receptionistActor(), new Date(), { sessionId: s.id });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: next.id } })).assignedToId).toBe(waiter.id);
    try {
      // The waiter stays with the table: the next customer seated there is theirs too.
      const { closeSession } = await import("@/server/services/dining-sessions");
      await db.restaurantOrder.updateMany({ where: { sessionId: s.id }, data: { status: "CANCELLED" } });
      await closeSession(s.id, { note: "test" }, mgr).catch(() => db.diningSession.update({ where: { id: s.id }, data: { status: "CLOSED", openAtId: null } }));
      const s2 = await seatCustomer({ locationId: "loc_in_6", name: "Next Guest", phone: "0712 000 333", guestCount: 1 }, mgr);
      expect((await db.diningSession.findUniqueOrThrow({ where: { id: s2.id } })).waiterId).toBe(waiter.id);
    } finally {
      await db.restaurantLocation.update({ where: { id: "loc_in_6" }, data: { waiterId: null } });
    }
  });

  it("room service from a room goes to the waiter a manager put in charge of that room", async () => {
    const { createRestaurantOrder, assignRoomServiceWaiter, waitersToAssign } = await import("@/server/services/restaurant");
    const r = await stay("306", "2026-10-10", "2026-10-12");
    const room = await roomByNumber("306");
    const waiter = (await waitersToAssign())[0];
    await expect(assignRoomServiceWaiter(room.id, waiter.id, await receptionistActor())).rejects.toThrow(/Only a manager/);
    await assignRoomServiceWaiter(room.id, waiter.id, await managerActor());
    try {
      const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: "mi_beers_heineken", quantity: 1 }] }, await receptionistActor(), eat("2026-10-11T12:00:00"));
      expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.id);
    } finally {
      await db.room.update({ where: { id: room.id }, data: { serviceWaiterId: null } });
    }
  });
});

describe("a discount on the whole room bill", () => {
  it("splits over the nights and the food so each department's income stays right; never more than is owed", async () => {
    const { discountStayBill } = await import("@/server/services/reservations");
    const { createRestaurantOrder } = await import("@/server/services/restaurant");
    const r = await stay("307", "2026-10-10", "2026-10-12");
    await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: "mi_beers_heineken", quantity: 2 }] }, await receptionistActor(), eat("2026-10-10T20:00:00"));
    const before = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: true, charges: true } });
    const roomNet = before.rooms.reduce((t, x) => t + x.netAmount, 0);
    const food = before.charges.reduce((t, c) => t + c.amount, 0);
    expect(food).toBeGreaterThan(0);
    const mgr = await managerActor();
    await expect(discountStayBill(r.id, { amount: before.balanceAmount + 1, reason: "Too much" }, mgr)).rejects.toThrow(/can't be more than what is still to pay/);
    await expect(discountStayBill(r.id, { amount: 1000, reason: "x" }, mgr)).rejects.toThrow(/Say why/);
    await expect(discountStayBill(r.id, { amount: 1000, reason: "Loyal guest" }, await receptionistActor())).rejects.toThrow(/Only a manager/);
    const res = await discountStayBill(r.id, { amount: 20_000, reason: "Service problem" }, mgr, eat("2026-10-11T10:00:00"));
    expect(res.amount).toBe(20_000);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: true, charges: true } });
    expect(after.netAmount).toBe(before.netAmount - 20_000);
    expect(after.balanceAmount).toBe(before.balanceAmount - 20_000);
    // In proportion: the room's share off the nights, the food's share as a credit line on the bill.
    const roomOff = roomNet - after.rooms.reduce((t, x) => t + x.netAmount, 0);
    const credits = after.charges.filter((c) => c.category === "BILL_DISCOUNT");
    expect(roomOff + credits.reduce((t, c) => t - c.amount, 0)).toBe(20_000);
    expect(Math.abs(roomOff - Math.round((20_000 * roomNet) / (roomNet + food)))).toBeLessThanOrEqual(1);
    expect(credits.every((c) => c.amount < 0 && c.description.includes("Service problem"))).toBe(true);
    expect(await db.auditLog.count({ where: { entityId: r.id, action: "reservation.bill_discounted" } })).toBe(1);
  });
});
