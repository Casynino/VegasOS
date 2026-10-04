import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { chargeSessionToRoom, closeSession, seatCustomer, sessionById } from "@/server/services/dining-sessions";
import { changeOrderBilling, createRestaurantOrder } from "@/server/services/restaurant";
import { postRoomCharges, voidReservationCharge } from "@/server/services/payments";
import { counterActor, eat, managerActor, receptionistActor, resetBusinessData, waiterActor } from "../support/helpers";

/** One customer, a table and a room in the same visit: the table knows the room, the bill goes where the customer says — once. */
beforeEach(async () => {
  await resetBusinessData();
});
const NOW = eat("2026-10-11T20:00:00");
const BEER = "mi_beers_heineken";

async function stayFor(roomNumber: string, name: string, phone: string) {
  const room = await db.room.findUniqueOrThrow({ where: { number: roomNumber } });
  const r = await createReservation({
    sourceCode: "WALK_IN", guest: { fullName: name, phone }, stay: { kind: "overnight", arrivalDate: "2026-10-11", departureDate: "2026-10-13" },
    rooms: [{ roomTypeId: room.roomTypeId, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await receptionistActor(), eat("2026-10-11T18:00:00"));
  await checkIn(r.id, await receptionistActor(), null, eat("2026-10-11T18:30:00"));
  return db.reservation.findUniqueOrThrow({ where: { id: r.id } });
}

async function eatingAt(locationId: string, name: string, phone: string) {
  const s = await seatCustomer({ locationId, name, phone, guestCount: 1 }, await waiterActor(), NOW);
  const o = await createRestaurantOrder({ type: "DINE_IN", locationId, settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 3 }] }, await waiterActor(), NOW, { customerPhone: phone });
  return { s, o };
}

describe("a customer at a table who also has a room", () => {
  it("eats first, then books a room: the same customer; the table shows the room; the whole bill goes on it, counted once", async () => {
    const { s, o } = await eatingAt("loc_out_3", "Nino Test", "0712 111 222");
    const r = await stayFor("305", "Nino Test", "0712 111 222");
    expect(r.guestId).toBe(s.guestId);
    expect((await sessionById(s.id))!.stays).toEqual([expect.objectContaining({ id: r.id, rooms: "305", foodPayer: null })]);

    const done = await chargeSessionToRoom(s.id, r.id, {}, await waiterActor(), NOW);
    expect(done).toMatchObject({ orders: 1, total: o.total, room: "305" });
    const order = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(order).toMatchObject({ settlement: "ROOM", reservationId: r.id, sessionId: s.id, guestId: s.guestId, tableLabel: expect.stringContaining("3") });
    // Restaurant income once — on the room's bill, never also as a sale.
    expect(await db.revenueTransaction.count({ where: { restaurantOrderId: o.id } })).toBe(0);
    const lines = await db.reservationCharge.findMany({ where: { restaurantOrderId: o.id, isVoided: false } });
    expect(lines.reduce((t, l) => t + l.amount, 0)).toBe(o.total);
    expect(lines.every((l) => l.kind === "BAR" && l.description.includes(order.tableLabel!))).toBe(true);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount).toBe(o.total);
    const view = (await sessionById(s.id))!;
    expect(view.money).toMatchObject({ due: 0, onRoom: o.total });
    expect(view.timeline.some((t) => t.kind === "CHARGED_TO_ROOM" && t.text.includes("305"))).toBe(true);
    expect(await db.auditLog.count({ where: { action: "dining_session.charged_to_room", entityId: s.id } })).toBe(1);
    await closeSession(s.id, { serveRemaining: true }, await waiterActor(), NOW);
    await expect(chargeSessionToRoom(s.id, r.id, {}, await waiterActor(), NOW)).rejects.toThrow(/already ended/);
  });

  it("only the customer's own room — for waiters and reception; a manager may move it to another guest's room, saying why", async () => {
    const { s } = await eatingAt("loc_in_4", "Asha Diner", "0712 333 444");
    const other = await stayFor("306", "Juma Host", "0712 555 666");
    await expect(chargeSessionToRoom(s.id, other.id, {}, await waiterActor(), NOW)).rejects.toThrow(/not this customer's/);
    // Reception cannot attach an unrelated room either (owner, 2026-10-04) — even with a reason.
    await expect(chargeSessionToRoom(s.id, other.id, { reason: "Juma pays for his friend" }, await receptionistActor(), NOW)).rejects.toThrow(/not this customer's/);
    await expect(chargeSessionToRoom(s.id, other.id, {}, await managerActor(), NOW)).rejects.toThrow(/say why/);
    await chargeSessionToRoom(s.id, other.id, { reason: "Juma pays for his friend" }, await managerActor(), NOW);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "restaurant_order.charged_to_room" } });
    expect(log.after).toMatchObject({ roomOfAnotherGuest: "Juma Host", reason: "Juma pays for his friend" });
  });

  it("a waiter putting a counter order on a room must say whose it is (their phone): only that customer's room", async () => {
    const r = await stayFor("307", "Rehema Guest", "0712 777 888");
    const order = (phone?: string) => createRestaurantOrder({ type: "DINE_IN", locationId: "loc_counter_out", settlement: "ROOM", reservationId: r.id, items: [{ menuItemId: BEER, quantity: 1 }] }, waiter, NOW, phone ? { customerPhone: phone } : {});
    const waiter = await waiterActor();
    await expect(order()).rejects.toThrow(/phone number first/);
    await expect(order("0712 999 000")).rejects.toThrow(/not this customer's/);
    expect(await order("0712 777 888")).toMatchObject({ settlement: "ROOM", reservationId: r.id, guestId: r.guestId });
  });
});

describe("changing who pays", () => {
  it("room → restaurant (no money taken now) → room again: always with a reason, never charged twice, all in the history", async () => {
    const { s, o } = await eatingAt("loc_out_2", "Nino Test", "0712 111 222");
    const r = await stayFor("305", "Nino Test", "0712 111 222");
    await chargeSessionToRoom(s.id, r.id, {}, await waiterActor(), NOW);
    await expect(changeOrderBilling(o.id, null, "They want to pay cash", await waiterActor(), NOW)).rejects.toThrow(/reception and managers/);
    await expect(changeOrderBilling(o.id, null, "", await managerActor(), NOW)).rejects.toThrow(/Say why/);
    expect(await changeOrderBilling(o.id, null, "They want to pay cash", await managerActor(), NOW)).toMatchObject({ from: "Room 305", to: "Restaurant" });
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ settlement: "UNPAID", paidAmount: 0 });
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount).toBe(0);
    expect((await sessionById(s.id))!.money.due).toBe(o.total);

    await changeOrderBilling(o.id, r.id, "Changed their mind — on the room", await receptionistActor(), NOW);
    expect(await db.reservationCharge.count({ where: { restaurantOrderId: o.id, isVoided: false } })).toBe(1);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount).toBe(o.total);
    const changes = await db.auditLog.findMany({ where: { action: "restaurant_order.billing_changed", entityId: o.id }, orderBy: { createdAt: "asc" } });
    expect(changes.map((c) => c.after)).toEqual([
      expect.objectContaining({ billing: "Restaurant", amount: o.total, reason: "They want to pay cash" }),
      expect.objectContaining({ billing: "Room 305", reason: "Changed their mind — on the room" }),
    ]);
  });

  it("an order's line cannot be removed from the room tab, and food is not typed in while the guest's table order is open", async () => {
    const { s, o } = await eatingAt("loc_in_2", "Nino Test", "0712 111 222");
    const r = await stayFor("305", "Nino Test", "0712 111 222");
    await expect(postRoomCharges({ reservationId: r.id, lines: [{ type: "RESTAURANT", item: "Dinner", qty: 1, unitPrice: 30_000 }] }, await receptionistActor())).rejects.toThrow(/not on the room yet/);
    await chargeSessionToRoom(s.id, r.id, {}, await waiterActor(), NOW);
    const line = await db.reservationCharge.findFirstOrThrow({ where: { restaurantOrderId: o.id } });
    await expect(voidReservationCharge(line.id, "Wrong", await managerActor())).rejects.toThrow(/restaurant order/);
  });
});

describe("one customer", () => {
  it("found by their second number too, and their real name replaces 'Table guest'", async () => {
    const g = await db.guest.create({ data: { fullName: "Table guest", phone: "+255712000001", altPhone: "+255712000002" } });
    const s = await seatCustomer({ locationId: "loc_out_6", name: "Neema Real", phone: "0712 000 002", guestCount: 1 }, await waiterActor(), NOW);
    expect(s.guestId).toBe(g.id);
    expect((await db.guest.findUniqueOrThrow({ where: { id: g.id } })).fullName).toBe("Neema Real");
  });
});

describe("each waiter's own day", () => {
  it("counts what each waiter handled — orders, customers, what went on rooms, their tables — service facts only; the money is the Counter's", async () => {
    const { waiterDay } = await import("@/server/services/waiter-day");
    const { assignTableWaiter, recordOrderPayment } = await import("@/server/services/restaurant");
    const { businessToday } = await import("@/server/settings");
    const [waiter, counter] = [await waiterActor(), await counterActor()];
    const now = new Date();
    const today = await businessToday(now);
    await assignTableWaiter("loc_in_5", waiter.userId!, await managerActor(), now);
    const a = await seatCustomer({ locationId: "loc_in_5", name: "Paying Guest", phone: "0712 101 202", guestCount: 2 }, waiter, now);
    const paid = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_5", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 2 }] }, waiter, now, { customerPhone: "0712 101 202" });
    // The waiter brings the money; the Restaurant Counter records it.
    await recordOrderPayment(paid.id, { accountId: "acct_cash", handedOverById: waiter.userId }, counter, now);
    const r = await stayFor("306", "Room Guest", "0712 303 404");
    const s = await seatCustomer({ locationId: "loc_out_6", name: "Room Guest", phone: "0712 303 404", guestCount: 1 }, waiter, now);
    const onRoom = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_6", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, waiter, now, { customerPhone: "0712 303 404" });
    await chargeSessionToRoom(s.id, r.id, {}, waiter, now);

    const [mine] = await waiterDay(today, { userId: waiter.userId });
    expect(mine).toMatchObject({ orders: 2, customers: 2, onRooms: onRoom.total, roomOrders: 1, value: paid.total + onRoom.total, tables: [expect.stringContaining("5")] });
    // Still the waiter's order — the payment is the Counter's (brought by the waiter), never the waiter's.
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: paid.id } })).assignedToId).toBe(waiter.userId);
    expect(await db.restaurantOrderPayment.findFirstOrThrow({ where: { orderId: paid.id } })).toMatchObject({ collectedById: counter.userId, atCounter: true, handedOverById: waiter.userId });
    const everyone = await waiterDay(today);
    expect(everyone.find((w) => w.id === waiter.userId)).toMatchObject({ orders: 2, value: paid.total + onRoom.total });
    expect(everyone.some((w) => w.id === counter.userId)).toBe(false); // the Counter is not a waiter
    expect(a.id).toBeTruthy();
  });
});

describe("payment records by who recorded them", () => {
  it("counts only real payments, each to the account that recorded it (the Counter, reception) — never to the waiter who brought it; a reversal stays on record but is not counted; room charges are apart", async () => {
    const { collectionRows, collectionTotals } = await import("@/server/services/collections");
    const { addOrderItems, recordOrderPayment, reverseOrderPayment } = await import("@/server/services/restaurant");
    const { businessToday } = await import("@/server/settings");
    const [waiter, counter, desk] = [await waiterActor(), await counterActor(), await receptionistActor()];
    const now = new Date();
    const today = await businessToday(now);

    // One order, paid in two parts: 2 beers at the Restaurant Counter (the waiter brought the cash), the 3rd beer (added later) by reception.
    await seatCustomer({ locationId: "loc_in_4", name: "Split Payer", phone: "0712 505 606", guestCount: 1 }, waiter, now);
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_4", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 2 }] }, waiter, now, { customerPhone: "0712 505 606" });
    await recordOrderPayment(o.id, { accountId: "acct_cash", handedOverById: waiter.userId }, counter, now);
    await addOrderItems(o.id, [{ menuItemId: BEER, quantity: 1 }], waiter, now);
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, desk, now);
    // Both recorded at the same instant: found by who recorded them, not by time.
    const first = await db.restaurantOrderPayment.findFirstOrThrow({ where: { orderId: o.id, collectedById: counter.userId } });
    const second = await db.restaurantOrderPayment.findFirstOrThrow({ where: { orderId: o.id, collectedById: desk.userId } });
    expect(await db.restaurantOrderPayment.count({ where: { orderId: o.id } })).toBe(2);
    expect(first.amount + second.amount).toBe((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).total);
    expect([first, second].map((p) => [p.atCounter, p.handedOverById])).toEqual([[true, waiter.userId], [false, null]]);

    // A room guest's order put on the room by the waiter: handled, not collected.
    const r = await stayFor("306", "Room Guest", "0712 707 808");
    const s = await seatCustomer({ locationId: "loc_out_6", name: "Room Guest", phone: "0712 707 808", guestCount: 1 }, waiter, now);
    const onRoom = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_6", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, waiter, now, { customerPhone: "0712 707 808" });
    await chargeSessionToRoom(s.id, r.id, {}, waiter, now);

    let t = await collectionTotals(today, today, { collectorIds: [waiter.userId!, counter.userId!, desk.userId!] });
    expect(t.of(counter.userId!)).toMatchObject({ collected: first.amount, payments: 1, toConfirm: 0, roomCharges: 0, reversed: 0 });
    expect(t.of(desk.userId!)).toMatchObject({ collected: second.amount, payments: 1, toConfirm: 0, roomCharges: 0 });
    expect(t.of(waiter.userId!)).toMatchObject({ collected: 0, payments: 0, roomCharges: onRoom.total, roomOrders: 1 });
    expect(t.of(counter.userId!).byKind).toEqual([{ name: "Cash", amount: first.amount }]);

    // A manager reverses the Counter's payment: it stays in the records, marked, and no longer counts.
    await reverseOrderPayment(first.id, "Wrong payment entry", await managerActor(), now);
    t = await collectionTotals(today, today, { collectorIds: [counter.userId!] });
    expect(t.of(counter.userId!)).toMatchObject({ collected: 0, payments: 0, reversed: first.amount, reversedCount: 1 });
    const theirs = await collectionRows({ from: today, to: today, collectorId: counter.userId });
    // Shown as the Restaurant Counter (never a person), with the waiter who brought the money as a note.
    expect(theirs.rows).toEqual([expect.objectContaining({ id: first.id, status: "REVERSED", reverseReason: "Payment reversed: Wrong payment entry", collector: "Restaurant Counter", atCounter: true, broughtBy: "Waiter", role: null })]);
    expect(theirs.rows[0].order?.payments.map((p) => p.by).sort()).toEqual([(desk.label ?? "").replace(/\s*\(.*\)/, ""), "Restaurant Counter"].sort());
    expect((await collectionRows({ from: today, to: today, collectorId: counter.userId, status: "COLLECTED" })).count).toBe(0);
    expect((await collectionRows({ from: today, to: today, collectorId: waiter.userId })).count).toBe(0); // the waiter has no payment records
    expect((await collectionRows({ from: today, to: today, q: o.number.slice(-3) })).count).toBe(2);
  });
});
