import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { checkIn, createReservation, type Actor } from "@/server/services/reservations";
import { confirmOrderPayment, createRestaurantOrder, recordOrderPayment, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { startWaiterShift, transferOrder } from "@/server/services/waiter-work";
import { placesServed, waiterOrders, waiterPerformance } from "@/server/services/waiter-performance";
import { collectionRows, stillToCollect } from "@/server/services/collections";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { chefActor, counterActor, managerActor, receptionistActor, resetBusinessData, roomType, waiterActor, withoutConfirming } from "../support/helpers";

/**
 * Who served what, and the money behind it — for managers, the MD and the owner. Every order has one
 * waiter (the one serving it, after any transfer); the Restaurant Counter records the money, with the
 * waiter who brought it. Facts only: each waiter's orders, value, tables and rooms — never mixed —
 * every payment with its table or room, its waiter and who recorded it, and what is still to collect.
 */
const BEER = "mi_beers_heineken";
const SAFARI = "mi_beers_safari";
const TZ = "Africa/Dar_es_Salaam";
const today = () => businessDateOf(new Date());
let second: Actor;

beforeAll(async () => {
  const role = await db.role.findUniqueOrThrow({ where: { code: "RESTAURANT" }, include: { permissions: { include: { permission: true } } } });
  const u = await db.user.upsert({
    where: { email: "waiter2@vegas.test" }, update: { isActive: true, roleId: role.id },
    create: { email: "waiter2@vegas.test", fullName: "Second Waiter (test)", roleId: role.id, passwordHash: await hashPassword("Waiter12345"), mustChangePassword: false },
  });
  second = { userId: u.id, label: u.fullName, role: role.name, permissions: new Set(role.permissions.map((p) => p.permission.code)) };
});
beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: { in: [BEER, SAFARI] } }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { orderPaymentConfirm: true } });
  await db.restaurantLocation.updateMany({ data: { waiterId: null, isActive: true, blockedAs: null } });
  await db.room.updateMany({ data: { serviceWaiterId: null } });
});
afterAll(async () => {
  await resetBusinessData();
});

/** A waiter's own order at a table — theirs, not paid yet. */
const tableOrder = (waiter: Actor, locationId: string, phone: string, quantity = 1) =>
  createRestaurantOrder({ type: "DINE_IN", locationId, settlement: "UNPAID", items: [{ menuItemId: BEER, quantity }] }, waiter, new Date(), { customerPhone: phone });

/** The kitchen makes it; the waiter serving it takes it out and serves it. */
async function serve(orderId: string, waiter: Actor) {
  const chef = await chefActor();
  await setOrderStatus(orderId, "ACCEPTED", chef);
  for (const i of await db.restaurantOrderItem.findMany({ where: { orderId } })) await setOrderItemPrepared(orderId, i.id, true, chef);
  await setOrderStatus(orderId, "READY", chef);
  await setOrderStatus(orderId, "OUT_FOR_DELIVERY", waiter);
  await setOrderStatus(orderId, "DELIVERED", waiter);
}

/** A guest staying in the hotel now (checked in yesterday). */
async function inHouse() {
  const dd = await roomType("DOUBLE_DELUXE");
  const t = today();
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: "Grace Room", phone: "0716 222 333" }, stay: { kind: "overnight", arrivalDate: addDays(t, -1), departureDate: addDays(t, 1) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await managerActor(), zonedInstant(addDays(t, -1), 12 * 60, TZ));
  await checkIn(r.id, await managerActor(), null, zonedInstant(addDays(t, -1), 15 * 60, TZ));
  return { reservation: await db.reservation.findUniqueOrThrow({ where: { id: r.id } }), room: dd.rooms[0].number };
}

async function onShift(waiter: Actor) {
  if (!(await db.actualShift.findFirst({ where: { userId: waiter.userId!, department: "RESTAURANT", endedAt: null } }))) await startWaiterShift(waiter);
}

const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;

describe("each waiter's performance — who served which table and room", () => {
  it("counts each waiter's served orders, value, tables and rooms — never mixed; a transfer moves the order to the new waiter", async () => {
    const waiter = await waiterActor();
    const { reservation, room } = await inHouse();

    // The waiter: Table 2 inside, and room service to the guest's room (on the room bill).
    const a1 = await tableOrder(waiter, "loc_in_2", "0712 100 201", 2);
    await serve(a1.id, waiter);
    const a2 = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: reservation.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { guestId: reservation.guestId });
    await serve(a2.id, waiter);
    // The second waiter: Table 3 outside.
    const b1 = await tableOrder(second, "loc_out_3", "0712 100 202");
    await serve(b1.id, second);
    // The waiter starts Table 4 inside, then hands that order to the second waiter, who serves it.
    const moved = await tableOrder(waiter, "loc_in_4", "0712 100 203", 3);
    await onShift(second);
    await transferOrder(moved.id, second.userId!, "Going on break", waiter);
    await serve(moved.id, second);

    const t = today();
    const perf = await waiterPerformance(t, t);
    const mine = perf.waiters.find((w) => w.id === waiter.userId)!;
    const theirs = perf.waiters.find((w) => w.id === second.userId)!;

    expect(mine).toMatchObject({
      name: "Waiter", orders: 2, served: 2, going: 0, cancelled: 0, servedValue: a1.total + a2.total,
      tables: ["Table 2 — Inside"], rooms: [room],
      settle: { paid: { count: 0, value: 0 }, onRoom: { count: 1, value: a2.total }, unpaid: { count: 1, value: a1.total } },
      transfers: { ordersOut: 1, ordersIn: 0 },
    });
    expect(theirs).toMatchObject({
      name: "Second Waiter", orders: 2, served: 2, servedValue: b1.total + moved.total,
      tables: ["Table 3 — Outside", "Table 4 — Inside"], rooms: [],
      settle: { unpaid: { count: 2, value: b1.total + moved.total }, onRoom: { count: 0, value: 0 } },
      transfers: { ordersIn: 1, ordersOut: 0 },
    });
    // Nothing is counted twice, and nothing is missed.
    expect(perf.totals).toMatchObject({ orders: 4, served: 4, servedValue: a1.total + a2.total + b1.total + moved.total });
    expect(perf.noWaiter.orders).toBe(0);
    // Someone else on the team, who served nothing, shows plain zeros.
    for (const w of perf.waiters.filter((x) => x.id !== waiter.userId && x.id !== second.userId)) {
      expect(w).toMatchObject({ orders: 0, served: 0, servedValue: 0, tables: [], rooms: [] });
    }

    // One waiter's own list: their orders only, each with its place — the order handed on is the colleague's now.
    const detail = (await waiterOrders(waiter.userId!, t, t))!;
    expect(detail.facts).toMatchObject({ orders: 2, servedValue: a1.total + a2.total });
    expect(detail.orders.map((o) => o.id).sort()).toEqual([a1.id, a2.id].sort());
    expect(detail.orders.find((o) => o.id === a1.id)).toMatchObject({ place: "Table 2 — Inside", placeKind: "TABLE", total: a1.total, served: true, pay: "UNPAID", due: a1.total });
    expect(detail.orders.find((o) => o.id === a2.id)).toMatchObject({ place: `Room ${room}`, placeKind: "ROOM", served: true, pay: "ROOM", reservation: reservation.reference });
    expect(detail.handOvers).toHaveLength(1);
    expect(detail.handOvers[0]).toMatchObject({ scope: "ORDER", direction: "OUT", from: "Waiter", to: "Second Waiter", what: shortNo(moved.number), reason: "Going on break", orderId: moved.id });
    const theirDetail = (await waiterOrders(second.userId!, t, t))!;
    expect(theirDetail.orders.map((o) => o.id).sort()).toEqual([b1.id, moved.id].sort());
    expect(theirDetail.handOvers[0]).toMatchObject({ direction: "IN", from: "Waiter", to: "Second Waiter" });

    // The other way round: every table and room, and who served it.
    const places = await placesServed(t, t);
    const at = (label: string) => places.find((p) => p.label === label)!;
    expect(at("Table 2 — Inside").by).toEqual([{ id: waiter.userId, name: "Waiter", orders: 1, served: 1, value: a1.total }]);
    expect(at(`Room ${room}`)).toMatchObject({ kind: "ROOM", value: a2.total, by: [{ id: waiter.userId, name: "Waiter", orders: 1, served: 1, value: a2.total }] });
    expect(at("Table 3 — Outside").by).toEqual([{ id: second.userId, name: "Second Waiter", orders: 1, served: 1, value: b1.total }]);
    expect(at("Table 4 — Inside").by).toEqual([{ id: second.userId, name: "Second Waiter", orders: 1, served: 1, value: moved.total }]);
  });
});

describe("collections — every payment says which table, which waiter, who recorded it", () => {
  it("the Counter records a payment brought by the waiter: served by the waiter, recorded by the Restaurant Counter, brought by the waiter, at the table", async () => {
    const [waiter, counter] = [await waiterActor(), await counterActor()];
    const o = await tableOrder(waiter, "loc_in_2", "0712 200 301", 2);
    await serve(o.id, waiter);
    await recordOrderPayment(o.id, { accountId: "acct_cash", reference: "TBL-2", handedOverById: waiter.userId }, counter);

    const t = today();
    const { rows } = await collectionRows({ from: t, to: t });
    const row = rows.find((r) => r.orderId === o.id)!;
    expect(row).toMatchObject({
      source: "RESTAURANT", amount: o.total, reference: "TBL-2", status: "COLLECTED", confirmed: true,
      orderNo: shortNo(o.number), place: "Table 2 — Inside", placeKind: "TABLE",
      servedBy: "Waiter", servedByFull: "Waiter",
      atCounter: true, recordedBy: "Restaurant Counter", collector: "Restaurant Counter", broughtBy: "Waiter",
    });
    // Served, paid in full: completed — and the waiter's facts say so.
    const perf = await waiterPerformance(t, t);
    expect(perf.waiters.find((w) => w.id === waiter.userId)).toMatchObject({ served: 1, settle: { paid: { count: 1, value: o.total }, unpaid: { count: 0, value: 0 } } });
    const mine = (await waiterOrders(waiter.userId!, t, t))!.orders[0];
    expect(mine).toMatchObject({ pay: "PAID", due: 0 });
    expect(mine.payments).toEqual([expect.objectContaining({ amount: o.total, confirmed: true, by: "Restaurant Counter", broughtBy: "Waiter" })]);
  });

  it("every payment is final as it is recorded (nothing to confirm); one waiter's payments only, when asked", async () => {
    const [waiter, counter, desk] = [await waiterActor(), await counterActor(), await receptionistActor()];
    const mine = await tableOrder(waiter, "loc_in_5", "0712 200 302");
    const theirs = await tableOrder(second, "loc_out_6", "0712 200 303");
    await serve(mine.id, waiter);
    await serve(theirs.id, second);
    await recordOrderPayment(mine.id, { accountId: "acct_cash", handedOverById: waiter.userId }, counter);
    // Even recorded by an account that may not confirm: final at once — nobody confirms payments by hand.
    await recordOrderPayment(theirs.id, { accountId: "acct_cash", handedOverById: second.userId }, withoutConfirming(counter));

    const t = today();
    const row = (await collectionRows({ from: t, to: t })).rows.find((r) => r.orderId === theirs.id)!;
    expect(row).toMatchObject({ status: "COLLECTED", confirmed: true, place: "Table 6 — Outside", servedByFull: "Second Waiter", broughtBy: "Second Waiter", recordedBy: "Restaurant Counter" });
    const theirsOnly = await collectionRows({ from: t, to: t, servedById: second.userId });
    expect(theirsOnly.rows.map((r) => r.orderId)).toEqual([theirs.id]);
    expect((await collectionRows({ from: t, to: t, status: "TO_CONFIRM" })).rows).toEqual([]);
    await expect(confirmOrderPayment(row.id, desk)).rejects.toThrow(/already confirmed/);
    expect((await waiterPerformance(t, t)).waiters.find((w) => w.id === second.userId)!.settle.paid).toEqual({ count: 1, value: theirs.total });
  });
});

describe("still to collect", () => {
  it("a served, unpaid order shows with its waiter, its place and what is due — and is gone once paid; a room-bill order never shows", async () => {
    const [waiter, counter] = [await waiterActor(), await counterActor()];
    const { reservation } = await inHouse();
    const o = await tableOrder(waiter, "loc_in_3", "0712 300 401", 2);
    await serve(o.id, waiter);
    const onRoom = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: reservation.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { guestId: reservation.guestId });
    await serve(onRoom.id, waiter);
    const theirs = await tableOrder(second, "loc_out_2", "0712 300 402");

    const due = await stillToCollect();
    expect(due.rows.map((r) => r.id).sort()).toEqual([o.id, theirs.id].sort());
    expect(due.rows.find((r) => r.id === o.id)).toMatchObject({
      orderNo: shortNo(o.number), place: "Table 3 — Inside", placeKind: "TABLE",
      servedBy: "Waiter", servedByFull: "Waiter", servedById: waiter.userId,
      status: "DELIVERED", step: "Served · to pay", total: o.total, paid: 0, due: o.total, online: null,
    });
    expect(due.rows.find((r) => r.id === theirs.id)).toMatchObject({ servedById: second.userId, place: "Table 2 — Outside", due: theirs.total });
    expect(due.toCollect).toEqual({ count: 2, amount: o.total + theirs.total });
    expect(due.byWaiter).toEqual(expect.arrayContaining([
      { id: waiter.userId, name: "Waiter", orders: 1, amount: o.total },
      { id: second.userId, name: "Second Waiter", orders: 1, amount: theirs.total },
    ]));
    expect((await stillToCollect({ servedById: waiter.userId })).rows.map((r) => r.id)).toEqual([o.id]);

    await recordOrderPayment(o.id, { accountId: "acct_cash", handedOverById: waiter.userId }, counter);
    const after = await stillToCollect();
    expect(after.rows.map((r) => r.id)).toEqual([theirs.id]);
    expect(after.toCollect).toEqual({ count: 1, amount: theirs.total });
    expect(after.byWaiter.map((w) => w.id)).toEqual([second.userId]);
    expect((await stillToCollect({ servedById: waiter.userId })).rows).toEqual([]);
  });
});
