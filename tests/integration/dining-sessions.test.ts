import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createRestaurantOrder, orderBill, recordOrderPayment, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { placeLocationOrder } from "@/server/services/restaurant-locations";
import {
  addSessionMember, closeSession, customerRequestBill, guestTableState, moveSession, requestSessionBill, seatAtTable, seatCustomer, seatReservation, sessionById,
  tableFloor, tableHistory, takeSessionPayment,
} from "@/server/services/dining-sessions";
import { createTableReservation, listTableReservations, moveTableReservation, setTableReservationStatus, updateTableReservation } from "@/server/services/table-reservations";
import { addDays, businessDateOf, localParts } from "@/lib/time/business-date";
import { chefActor, counterActor, managerActor, receptionistActor, resetBusinessData, waiterActor } from "../support/helpers";

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: { in: [BIRYANI, SAFARI] } }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { publicOrderingEnabled: true, orderPaymentConfirm: false } });
  await db.restaurantLocation.updateMany({ data: { qrActive: true, isActive: true } });
});

const TZ = "Africa/Dar_es_Salaam";
const BIRYANI = "mi_main_courses_chicken_biryani";
const SAFARI = "mi_beers_safari";
let n = 0;
const key = () => `${(++n).toString(16).padStart(8, "0")}${"c".repeat(24)}`;
const spot = (id: string) => db.restaurantLocation.findUniqueOrThrow({ where: { id } });
const open = (locationId: string) => db.diningSession.findUnique({ where: { openAtId: locationId } });
const today = () => businessDateOf(new Date());
/** The hotel's date and "HH:MM" for an instant. */
const clock = (d: Date) => {
  const p = localParts(d, TZ);
  return { date: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, time: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}` };
};

async function serve(orderId: string) {
  const [chef, waiter] = [await chefActor(), await waiterActor()];
  await setOrderStatus(orderId, "PREPARING", chef);
  for (const i of await db.restaurantOrderItem.findMany({ where: { orderId, preparedAt: null } })) await setOrderItemPrepared(orderId, i.id, true, chef);
  await setOrderStatus(orderId, "READY", chef);
  await setOrderStatus(orderId, "OUT_FOR_DELIVERY", waiter);
  await setOrderStatus(orderId, "DELIVERED", waiter);
}
async function order(token: string, seatToken: string | null, qty = 1, item = SAFARI) {
  return placeLocationOrder(token, { clientKey: key(), items: [{ menuItemId: item, quantity: qty }], seatToken });
}

describe("a customer's time at a table (the QR)", () => {
  it("scan → say who you are once → the table is theirs → order again and again → one bill → pay → staff clear the table → the next customer starts fresh", async () => {
    const t3 = await spot("loc_out_3");
    expect((await guestTableState(t3.id, null)).state).toBe("free");

    const john = await seatAtTable(t3.qrToken, { name: "John Michael", phone: "0712 100 200" }, null);
    expect(john).toMatchObject({ state: "seated", name: "John M.", table: "Table 3 — Outside" });
    const s1 = (await open(t3.id))!;
    expect(s1).toMatchObject({ status: "ACTIVE", source: "QR", locationId: t3.id, guestCount: 1 });
    expect(await db.diningSessionMember.count({ where: { sessionId: s1.id, primary: true } })).toBe(1);

    // Three orders, never asked again — all the same customer, table and session.
    const o1 = await order(t3.qrToken, john.token, 1, BIRYANI);
    const o2 = await order(t3.qrToken, john.token, 2);
    const o3 = await order(t3.qrToken, john.token, 1);
    for (const o of [o1, o2, o3]) expect(o).toMatchObject({ sessionId: s1.id, locationId: t3.id, customerName: "John Michael", source: "TABLE_QR" });
    expect(await db.guest.count({ where: { phone: o1.customerPhone! } })).toBe(1);

    // Scanning again on the same phone: their own table, running bill.
    const mine = await guestTableState(t3.id, john.token);
    expect(mine).toMatchObject({ state: "mine", mine: { name: "John", table: "Table 3 — Outside", total: o1.total + o2.total + o3.total, due: o1.total + o2.total + o3.total } });
    expect(mine.mine!.orders).toHaveLength(3);
    // Same person, another phone: welcome back — no second session, no second customer.
    const again = await seatAtTable(t3.qrToken, { name: "Johnny", phone: "+255712100200" }, null);
    expect(again.state).toBe("welcome_back");
    expect(await db.diningSession.count()).toBe(1);
    // Someone else scanning the table never takes it over.
    const sarahTry = await seatAtTable(t3.qrToken, { name: "Sarah", phone: "0755 300 400" }, null);
    expect(sarahTry).toMatchObject({ state: "in_use", token: null });
    expect((await guestTableState(t3.id, null)).state).toBe("in_use");
    await expect(order(t3.qrToken, null)).rejects.toThrow(/who you are/);

    // Food served, nobody touching the phone: the table stays theirs.
    for (const o of [o1, o2, o3]) await serve(o.id);
    expect((await open(t3.id))?.status).toBe("ACTIVE");

    // "I'm done" → waiting for the payment. Nobody can clear the table while money is due.
    expect((await customerRequestBill(john.token)).status).toBe("AWAITING_PAYMENT");
    await expect(closeSession(s1.id, {}, await waiterActor())).rejects.toThrow(/still to pay/);
    const bill = await orderBill(o2.id, "table");
    expect(bill!.orders.map((o) => o.id)).toEqual([o1.id, o2.id, o3.id]);
    // The waiter brings the money to the Restaurant Counter, which records it (never the waiter).
    await expect(takeSessionPayment(s1.id, { accountId: "acct_cash" }, await waiterActor())).rejects.toThrow(/cannot record payments/);
    const [waiter, counter] = [await waiterActor(), await counterActor()];
    const paid = await takeSessionPayment(s1.id, { accountId: "acct_cash", handedOverById: waiter.userId }, counter);
    expect(paid).toMatchObject({ amount: bill!.totals.due, orders: 3, status: "PAID" });
    // Each order's payment is the Counter's, brought by the waiter.
    const pays = await db.restaurantOrderPayment.findMany({ where: { orderId: { in: [o1.id, o2.id, o3.id] } } });
    expect(pays).toHaveLength(3);
    for (const p of pays) expect(p).toMatchObject({ atCounter: true, collectedById: counter.userId, handedOverById: waiter.userId });
    // Paid — but the table is theirs until staff see them leave and clear it.
    expect((await open(t3.id))?.status).toBe("PAID");
    expect((await guestTableState(t3.id, null)).state).toBe("in_use");
    await closeSession(s1.id, {}, await receptionistActor());
    const closed = await db.diningSession.findUniqueOrThrow({ where: { id: s1.id } });
    expect(closed).toMatchObject({ status: "CLOSED", openAtId: null });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedById).not.toBeNull();
    expect(await open(t3.id)).toBeNull();
    for (const o of [o1, o2, o3]) expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("COMPLETED");
    // John's old seat no longer orders.
    await expect(order(t3.qrToken, john.token)).rejects.toThrow(/who you are/);

    // Sarah scans the same QR later: a new session — her orders never mix with John's.
    const sarah = await seatAtTable(t3.qrToken, { name: "Sarah Michael", phone: "0755 300 400" }, null);
    expect(sarah.state).toBe("seated");
    const s2 = (await open(t3.id))!;
    expect(s2.id).not.toBe(s1.id);
    expect(s2.number).not.toBe(s1.number);
    const so = await order(t3.qrToken, sarah.token);
    expect(so.sessionId).toBe(s2.id);
    expect((await orderBill(so.id, "table"))!.orders.map((o) => o.id)).toEqual([so.id]);
    expect((await sessionById(s1.id))!.orders).toHaveLength(3); // John's history stays
    expect((await tableHistory(t3.id)).map((h) => h.customer)).toEqual(["John Michael"]);
  });

  it("paid but a dish is still coming: PAID; clearing waits until it is served; ordering more opens the bill again; never cleared by itself", async () => {
    const t = await spot("loc_in_4");
    const seat = await seatAtTable(t.qrToken, { name: "Grace", phone: "0713 555 666" }, null);
    const a = await order(t.qrToken, seat.token);
    await serve(a.id);
    const b = await order(t.qrToken, seat.token);
    const s = (await open(t.id))!;
    await customerRequestBill(seat.token);
    // More after asking for the bill: open for ordering again.
    const c = await order(t.qrToken, seat.token);
    expect((await open(t.id))?.status).toBe("ACTIVE");
    await requestSessionBill(s.id, await waiterActor());
    expect((await takeSessionPayment(s.id, { accountId: "acct_cash" }, await counterActor())).status).toBe("PAID");
    expect((await open(t.id))?.status).toBe("PAID");
    await serve(b.id);
    await expect(closeSession(s.id, {}, await waiterActor())).rejects.toThrow(/not marked served/);
    await serve(c.id);
    expect((await open(t.id))?.status).toBe("PAID"); // everything paid and served: still theirs
    await closeSession(s.id, {}, await waiterActor());
    expect(await open(t.id)).toBeNull();
    expect((await db.diningSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CLOSED");
  });

  it("paid and gone, but the screen still says a dish is coming: staff clear it saying they got everything — the orders are marked served, in their history", async () => {
    const t = await spot("loc_out_6");
    const seat = await seatAtTable(t.qrToken, { name: "Rose", phone: "0715 123 456" }, null);
    const a = await order(t.qrToken, seat.token, 2);
    const b = await order(t.qrToken, seat.token, 1, BIRYANI);
    const s = (await open(t.id))!;
    await takeSessionPayment(s.id, { accountId: "acct_cash" }, await counterActor());
    await expect(closeSession(s.id, {}, await receptionistActor())).rejects.toThrow(/not marked served/);
    // Reception never marks food served — the waiter says they got everything.
    await expect(closeSession(s.id, { serveRemaining: true }, await receptionistActor())).rejects.toThrow(/A waiter confirms/);
    await closeSession(s.id, { serveRemaining: true }, await waiterActor());
    expect(await open(t.id)).toBeNull();
    for (const o of [a, b]) {
      expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("COMPLETED");
      expect(await db.restaurantOrderEvent.count({ where: { orderId: o.id, note: { startsWith: "Marked served when the table was cleared" } } })).toBe(1);
    }
    // Never with money due.
    const t2 = await spot("loc_out_5");
    const seat2 = await seatAtTable(t2.qrToken, { name: "Mo", phone: "0715 654 321" }, null);
    await order(t2.qrToken, seat2.token);
    await expect(closeSession((await open(t2.id))!.id, { serveRemaining: true }, await waiterActor())).rejects.toThrow(/still to pay/);
  });

  it("nothing ordered: the customer stays on the table until staff remove them (the session is cancelled)", async () => {
    const t = await spot("loc_in_5");
    const seat = await seatAtTable(t.qrToken, { name: "Paul", phone: "0714 777 888" }, null);
    expect((await customerRequestBill(seat.token)).status).toBe("AWAITING_PAYMENT");
    expect((await open(t.id))?.status).toBe("AWAITING_PAYMENT");
    await closeSession((await open(t.id))!.id, {}, await waiterActor());
    expect(await open(t.id)).toBeNull();
    await expect(order(t.qrToken, seat.token)).rejects.toThrow(/who you are/);
    const s = await seatCustomer({ locationId: t.id, name: "Anna", phone: "0714 777 999", guestCount: 2 }, await waiterActor());
    await expect(closeSession(s.id, {}, await chefActor())).rejects.toThrow(/waiters, reception and managers/);
    await closeSession(s.id, {}, await waiterActor());
    expect((await db.diningSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CANCELLED");
  });
});

describe("staff at the tables", () => {
  it("a waiter seats a walk-in; two people seating the same table at once — only one wins", async () => {
    const waiter = await waiterActor();
    const [a, b] = await Promise.allSettled([
      seatCustomer({ locationId: "loc_in_1", name: "Ali", phone: "0711 000 001", guestCount: 3 }, waiter),
      seatCustomer({ locationId: "loc_in_1", name: "Bea", phone: "0711 000 002", guestCount: 2 }, await receptionistActor()),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(await db.diningSession.count({ where: { openAtId: "loc_in_1" } })).toBe(1);
    const lost = (a.status === "rejected" ? a : b) as PromiseRejectedResult;
    expect(String(lost.reason)).toMatch(/already has a customer|just seated/);
    await expect(seatCustomer({ locationId: "loc_in_2", name: "Chef", phone: "0711 000 003" }, await chefActor())).rejects.toThrow(/waiters, reception and managers/);
    await expect(seatCustomer({ locationId: "loc_counter_out", name: "Counter", phone: "0711 000 004" }, waiter)).rejects.toThrow(/Only tables/);
  });

  it("a waiter's order at a free table starts the customer's session; a friend's order there joins the same table and bill", async () => {
    const waiter = await waiterActor();
    const o1 = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_1", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { customerPhone: "0716 111 111" });
    const s = (await open("loc_out_1"))!;
    expect(s).toMatchObject({ source: "ORDER", id: o1.sessionId });
    const o2 = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_1", settlement: "UNPAID", customerName: "Friend", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { customerPhone: "0716 222 222" });
    expect(o2.sessionId).toBe(s.id);
    expect(await db.diningSessionMember.count({ where: { sessionId: s.id } })).toBe(2);
    // The counter and the main QR stay as they were: no sessions.
    const counter = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_counter_out", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { customerPhone: "0716 333 333" });
    expect(counter.sessionId).toBeNull();
    const main = await placeLocationOrder((await spot("loc_main")).qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Walk", phone: "0716 444 444" });
    expect(main.sessionId).toBeNull();
  });

  it("the waiter adds someone to the table: they can order from the QR too, on the same bill", async () => {
    const t = await spot("loc_out_4");
    const s = await seatCustomer({ locationId: t.id, name: "John", phone: "0717 000 100", guestCount: 4 }, await waiterActor());
    expect((await seatAtTable(t.qrToken, { name: "Mary", phone: "0717 000 200" }, null)).state).toBe("in_use");
    await addSessionMember(s.id, { name: "Mary", phone: "0717 000 200" }, await waiterActor());
    await expect(addSessionMember(s.id, { name: "Mary", phone: "0717 000 200" }, await waiterActor())).rejects.toThrow(/already on this table/);
    const mary = await seatAtTable(t.qrToken, { name: "Mary", phone: "0717 000 200" }, null);
    expect(mary.state).toBe("welcome_back");
    const o = await order(t.qrToken, mary.token);
    expect(o).toMatchObject({ sessionId: s.id, customerName: "Mary" });
    expect((await sessionById(s.id))!.timeline.map((x) => x.kind)).toEqual(expect.arrayContaining(["STARTED", "MEMBER_ADDED", "ORDER"]));
  });

  it("move the customer: same session and bill, orders still coming follow, served ones keep their table; the old table is free; every move is kept", async () => {
    const waiter = await waiterActor();
    const t3 = await spot("loc_out_3");
    const seat = await seatAtTable(t3.qrToken, { name: "John Michael", phone: "0712 100 200" }, null);
    const served = await order(t3.qrToken, seat.token);
    await serve(served.id);
    const coming = await order(t3.qrToken, seat.token);
    const s = (await open(t3.id))!;
    await seatCustomer({ locationId: "loc_in_5", name: "Other", phone: "0719 000 000" }, waiter);
    await expect(moveSession(s.id, "loc_in_5", {}, waiter)).rejects.toThrow(/has a customer/);
    await expect(moveSession(s.id, "loc_main", {}, waiter)).rejects.toThrow(/one of the tables/);
    await expect(moveSession(s.id, "loc_in_4", {}, await chefActor())).rejects.toThrow(/waiters, reception and managers/);
    expect(await moveSession(s.id, "loc_in_4", { reason: "Wanted to sit inside" }, waiter)).toEqual({ from: "Table 3 — Outside", to: "Table 4 — Inside" });
    expect(await open(t3.id)).toBeNull();
    expect((await open("loc_in_4"))?.id).toBe(s.id);
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: served.id } })).toMatchObject({ locationId: t3.id, tableLabel: "Table 3 — Outside" });
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: coming.id } })).toMatchObject({ locationId: "loc_in_4", tableLabel: "Table 4 — Inside" });
    expect(await db.tableMove.findMany({ where: { sessionId: s.id } })).toMatchObject([{ fromLocationId: t3.id, toLocationId: "loc_in_4", reason: "Wanted to sit inside" }]);
    // Their phone still orders — to their new table; the table's bill has everything.
    const after = await order(t3.qrToken, seat.token);
    expect(after).toMatchObject({ sessionId: s.id, locationId: "loc_in_4" });
    expect((await guestTableState(t3.id, seat.token))).toMatchObject({ state: "mine", movedTo: "Table 4 — Inside" });
    expect((await orderBill(served.id, "table"))!.orders.map((o) => o.id)).toEqual([served.id, coming.id, after.id]);
    const floor = await tableFloor({ today: today() });
    expect(floor.find((p) => p.id === t3.id)!.session).toBeNull();
    expect(floor.find((p) => p.id === "loc_in_4")!.session).toMatchObject({ id: s.id, money: { orders: 3 } });
    expect((await sessionById(s.id))!.timeline.find((x) => x.kind === "MOVED")?.text).toBe("Moved from Table 3 — Outside to Table 4 — Inside — Wanted to sit inside");
  });

  it("closing by hand: never while money is due or a dish is still coming", async () => {
    const waiter = await waiterActor();
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_6", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 2 }] }, waiter, new Date(), { customerPhone: "0718 000 111" });
    await expect(closeSession(o.sessionId!, {}, waiter)).rejects.toThrow(/still to pay/);
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, await counterActor());
    // Paid early, still eating: the table stays theirs until staff clear it.
    expect((await open("loc_in_6"))?.status).toBe("ACTIVE");
    await expect(closeSession(o.sessionId!, {}, waiter)).rejects.toThrow(/not marked served/);
    await serve(o.id);
    await closeSession(o.sessionId!, {}, waiter);
    expect(await db.diningSession.findUniqueOrThrow({ where: { id: o.sessionId! } })).toMatchObject({ status: "CLOSED", openAtId: null });
  });
});

describe("table reservations", () => {
  it("book, clash, edit, confirm, move (kept), then seat — the table shows Reserved, never occupied, until they come", async () => {
    const waiter = await waiterActor();
    const at = new Date(Date.now() + 26 * 3600_000); // tomorrow
    const { date, time } = clock(at);
    const r = await createTableReservation({ locationId: "loc_out_3", name: "Sarah Michael", phone: "0755 300 400", date, time, guestCount: 4, notes: "Birthday" }, waiter);
    expect(r).toMatchObject({ status: "BOOKED", guestCount: 4, locationId: "loc_out_3" });
    expect(r.reference).toMatch(/^TR-\d{4}-0001$/);
    await expect(createTableReservation({ locationId: "loc_out_3", name: "Paul", phone: "0755 000 111", date, time, guestCount: 2 }, waiter)).rejects.toThrow(/already reserved/);
    await expect(createTableReservation({ locationId: "loc_out_3", name: "Paul", phone: "0755 000 111", date: addDays(today(), -2), time: "20:00", guestCount: 2 }, waiter)).rejects.toThrow(/passed/);
    await expect(createTableReservation({ locationId: "loc_out_3", name: "Chef", phone: "0755 000 112", date, time, guestCount: 2 }, await chefActor())).rejects.toThrow(/waiters, reception and managers/);
    await updateTableReservation(r.id, { name: "Sarah Michael", phone: "0755 300 400", date, time, guestCount: 5, notes: "Birthday — cake" }, waiter);
    await setTableReservationStatus(r.id, "CONFIRMED", {}, waiter);
    expect(await moveTableReservation(r.id, "loc_out_5", { reason: "Bigger table" }, waiter)).toEqual({ from: "Table 3 — Outside", to: "Table 5 — Outside" });
    const row = (await listTableReservations({ from: date, to: date }))[0];
    expect(row).toMatchObject({ status: "CONFIRMED", guests: 5, table: { name: "Table 5 — Outside" }, moves: [{ from: "Table 3 — Outside", to: "Table 5 — Outside", reason: "Bigger table" }] });
    for (const q of ["sarah", "0755300400", r.reference]) expect((await listTableReservations({ from: date, to: date, q })).map((x) => x.id)).toEqual([r.id]);
    await expect(setTableReservationStatus(r.id, "NO_SHOW", {}, waiter)).rejects.toThrow(/not their time/);
    await expect(setTableReservationStatus(r.id, "CANCELLED", {}, waiter)).rejects.toThrow(/why/);

    // Half an hour before: the table is held — a walk-in is not seated there without saying so.
    const soon = new Date(r.reservedFor.getTime() - 30 * 60_000);
    await expect(seatCustomer({ locationId: "loc_out_5", name: "Walk In", phone: "0700 111 222" }, waiter, soon)).rejects.toThrow(/reserved for Sarah Michael/);
    const floor = await tableFloor({ today: today(), now: soon });
    expect(floor.find((p) => p.id === "loc_out_5")).toMatchObject({ session: null, next: { name: "Sarah Michael", guests: 5, holding: true } });
    // A stranger scanning the table is sent to a waiter; Sarah scanning it is seated from her reservation.
    const t5 = await spot("loc_out_5");
    expect((await seatAtTable(t5.qrToken, { name: "Stranger", phone: "0700 999 888" }, null, soon)).state).toBe("reserved");
    const sarah = await seatAtTable(t5.qrToken, { name: "", phone: "0755 300 400" }, null, soon);
    expect(sarah.state).toBe("seated");
    const s = (await open(t5.id))!;
    expect(s).toMatchObject({ source: "RESERVATION", tableReservationId: r.id, guestCount: 5 });
    expect((await db.tableReservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("SEATED");
  });

  it("staff seat a reservation (also at another table), cancel one with a reason, and mark a no-show after its time", async () => {
    const waiter = await waiterActor();
    const at = new Date(Date.now() + 50 * 3600_000);
    const { date, time } = clock(at);
    const a = await createTableReservation({ locationId: "loc_in_1", name: "Ali", phone: "0766 000 001", date, time, guestCount: 2 }, waiter);
    const b = await createTableReservation({ locationId: "loc_in_2", name: "Bea", phone: "0766 000 002", date, time, guestCount: 2 }, await receptionistActor());
    const c = await createTableReservation({ locationId: "loc_in_3", name: "Cid", phone: "0766 000 003", date, time, guestCount: 2 }, waiter);
    const s = await seatReservation(a.id, { locationId: "loc_in_6" }, waiter);
    expect(s).toMatchObject({ locationId: "loc_in_6", source: "RESERVATION", tableReservationId: a.id });
    expect(await db.tableMove.count({ where: { tableReservationId: a.id } })).toBe(1);
    await expect(seatReservation(a.id, {}, waiter)).rejects.toThrow(/already seated/);
    await setTableReservationStatus(b.id, "CANCELLED", { reason: "Called to cancel" }, waiter);
    expect(await db.tableReservation.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "CANCELLED", cancelReason: "Called to cancel" });
    await setTableReservationStatus(c.id, "NO_SHOW", {}, waiter, new Date(at.getTime() + 45 * 60_000));
    expect((await db.tableReservation.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("NO_SHOW");
    await expect(seatReservation(c.id, {}, waiter)).rejects.toThrow(/cancelled or marked no-show/);
    expect((await listTableReservations({ from: date, to: date, status: "open" })).map((x) => x.id)).toEqual([]);
  });
});

describe("a party on several tables", () => {
  it("one booking on three tables: every table held; edit, move one, then seat them all at once — each table its own bill; cancelling is for the whole party", async () => {
    const waiter = await waiterActor();
    const at = new Date(Date.now() + 30 * 3600_000);
    const { date, time } = clock(at);
    const r = await createTableReservation({ locationId: "loc_in_2", locationIds: ["loc_in_2", "loc_in_3", "loc_in_4"], name: "Big Family", phone: "0788 123 123", date, time, guestCount: 12 }, waiter);
    expect(r.tables).toBe(3);
    const rows = await db.tableReservation.findMany({ where: { partyId: { not: null } }, orderBy: { reference: "asc" } });
    expect(rows.map((x) => x.locationId)).toEqual(["loc_in_2", "loc_in_3", "loc_in_4"]);
    expect(new Set(rows.map((x) => x.partyId)).size).toBe(1);
    // Every table is held: another booking at that time on any of them is refused.
    await expect(createTableReservation({ locationId: "loc_in_3", name: "Other", phone: "0788 000 111", date, time, guestCount: 2 }, waiter)).rejects.toThrow(/already reserved/);
    // Editing one edits the party; one table can move on its own.
    await updateTableReservation(rows[1].id, { name: "Big Family", phone: "0788 123 123", date, time, guestCount: 14 }, waiter);
    expect((await db.tableReservation.findMany({ where: { partyId: rows[0].partyId } })).map((x) => x.guestCount)).toEqual([14, 14, 14]);
    await moveTableReservation(rows[2].id, "loc_in_5", {}, waiter);
    // They came: all three tables seated at once, the people shared out.
    await seatReservation(rows[0].id, {}, waiter);
    const sessions = await db.diningSession.findMany({ where: { tableReservationId: { in: rows.map((x) => x.id) } }, orderBy: { locationId: "asc" } });
    expect(sessions.map((x) => x.locationId)).toEqual(["loc_in_2", "loc_in_3", "loc_in_5"]);
    expect(sessions.map((x) => x.guestCount)).toEqual([5, 5, 5]);
    expect((await db.tableReservation.findMany({ where: { partyId: rows[0].partyId } })).every((x) => x.status === "SEATED")).toBe(true);

    // Another party, cancelled in one go.
    const p2 = await createTableReservation({ locationId: "loc_out_1", locationIds: ["loc_out_1", "loc_out_2"], name: "Team", phone: "0788 555 555", date, time, guestCount: 8 }, waiter);
    await setTableReservationStatus(p2.id, "CANCELLED", { reason: "Changed plans" }, waiter);
    expect((await db.tableReservation.findMany({ where: { partyId: p2.partyId } })).map((x) => x.status)).toEqual(["CANCELLED", "CANCELLED"]);
  });
});

describe("history and audit", () => {
  it("every session keeps its timeline; the audit log has the starts, moves and closes", async () => {
    const waiter = await waiterActor();
    const s = await seatCustomer({ locationId: "loc_in_2", name: "Hawa", phone: "0720 000 001", guestCount: 2 }, waiter);
    await moveSession(s.id, "loc_in_3", {}, waiter);
    await closeSession(s.id, { note: "Left without ordering" }, await managerActor());
    const view = (await sessionById(s.id))!;
    expect(view.timeline.map((x) => x.kind)).toEqual(["STARTED", "MOVED", "CANCELLED"]);
    expect(view).toMatchObject({ status: "CANCELLED", closeNote: "Left without ordering", table: "Table 3 — Inside" });
    const actions = (await db.auditLog.findMany({ where: { entityId: s.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["dining_session.started", "dining_session.moved", "dining_session.cancelled"]);
  });
});
