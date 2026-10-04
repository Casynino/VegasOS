import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { seatCustomer } from "@/server/services/dining-sessions";
import { assignOrder, assignTableWaiter, createRestaurantOrder, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { closeWaiterShiftAsManager, endWaiterShift, startWaiterShift, takeChargeOfOrder, transferAllResponsibilities, transferOrder, transferTable, waiterResponsibilities } from "@/server/services/waiter-work";
import { waiterOnCounter } from "@/server/services/waiter-on-counter";
import { startShift } from "@/server/services/shifts";
import type { Actor } from "@/server/services/reservations";
import { chefActor, managerActor, receptionistActor, resetBusinessData, waiterActor } from "../support/helpers";

/** One restaurant, many waiters: every open order has one waiter; work changes hands only on purpose; a shift closes only when nothing is left. */
const BEER = "mi_beers_heineken";
const PHONE = "0712 404 505";
const PASSWORD = "Waiter12345";
let second: Actor, screen: Actor;

async function staffWithRole(email: string, name: string, roleCode: string): Promise<Actor> {
  const role = await db.role.findUniqueOrThrow({ where: { code: roleCode }, include: { permissions: { include: { permission: true } } } });
  const u = await db.user.upsert({
    where: { email }, update: { isActive: true },
    create: { email, fullName: name, roleId: role.id, passwordHash: await hashPassword(PASSWORD), mustChangePassword: false },
  });
  return { userId: u.id, label: u.fullName, role: role.name, permissions: new Set(role.permissions.map((p) => p.permission.code)) };
}

beforeAll(async () => {
  second = await staffWithRole("waiter2@vegas.test", "Second Waiter (test)", "RESTAURANT");
  screen = await staffWithRole("screen@vegas.test", "Restaurant screen (test)", "RESTAURANT_SCREEN");
});
beforeEach(async () => {
  await resetBusinessData();
  await db.restaurantLocation.updateMany({ data: { waiterId: null, isActive: true, blockedAs: null } });
  await db.room.updateMany({ data: { serviceWaiterId: null } });
});
afterAll(async () => {
  await resetBusinessData();
});

const order = (actor: Actor, locationId = "loc_in_2") =>
  createRestaurantOrder({ type: "DINE_IN", locationId, settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, actor, new Date(), { customerPhone: PHONE });

async function readyUp(id: string) {
  const chef = await chefActor();
  await setOrderStatus(id, "ACCEPTED", chef);
  for (const i of await db.restaurantOrderItem.findMany({ where: { orderId: id } })) await setOrderItemPrepared(id, i.id, true, chef);
  await setOrderStatus(id, "READY", chef);
}

describe("every order has one waiter", () => {
  it("a waiter's own order is theirs (their shift starts); the kitchen's steps never change who serves", async () => {
    const waiter = await waiterActor();
    const o = await createRestaurantOrder({ type: "TAKEAWAY", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, waiter, new Date(), { customerPhone: PHONE });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.userId);
    expect(await db.waiterAssignment.findFirst({ where: { orderId: o.id } })).toMatchObject({ kind: "TAKEN", via: "SELF", toUserId: waiter.userId });
    expect(await db.actualShift.findFirst({ where: { userId: waiter.userId!, endedAt: null } })).toMatchObject({ department: "RESTAURANT" });
    await readyUp(o.id);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.userId);
    expect(await db.waiterAssignment.count({ where: { orderId: o.id } })).toBe(1);
  });

  it("reception's order has no waiter until one takes charge; two can never both take it", async () => {
    const o = await order(await receptionistActor(), "loc_in_3");
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBeNull();
    const waiter = await waiterActor();
    await takeChargeOfOrder(o.id, waiter);
    await expect(takeChargeOfOrder(o.id, second)).rejects.toThrow(/is serving order .* — ask them/);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.userId);
  });

  it("taking out a ready order nobody has makes it yours; the restaurant screen must take charge with a PIN first", async () => {
    const o = await order(await receptionistActor(), "loc_in_4");
    await readyUp(o.id);
    await expect(setOrderStatus(o.id, "OUT_FOR_DELIVERY", screen)).rejects.toThrow(/pick the waiter who serves it/);
    await setOrderStatus(o.id, "OUT_FOR_DELIVERY", second);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(second.userId);
  });

  it("a waiter pressing Accept on an order nobody has makes it theirs; the Mpishi's Accept never does", async () => {
    const a = await order(await receptionistActor(), "loc_out_4");
    await setOrderStatus(a.id, "ACCEPTED", await chefActor());
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: a.id } })).assignedToId).toBeNull();
    const b = await order(await receptionistActor(), "loc_out_5");
    await setOrderStatus(b.id, "ACCEPTED", second);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: b.id } })).assignedToId).toBe(second.userId);
    expect(await db.waiterAssignment.findFirst({ where: { orderId: b.id } })).toMatchObject({ kind: "TAKEN", via: "SELF", toUserId: second.userId });
  });

  it("a waiter seating a customer serves that table: its orders go to them", async () => {
    const waiter = await waiterActor();
    const s = await seatCustomer({ locationId: "loc_in_6", name: "Seated Guest", phone: PHONE, guestCount: 2 }, waiter);
    expect((await db.diningSession.findUniqueOrThrow({ where: { id: s.id } })).waiterId).toBe(waiter.userId);
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_6", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, await receptionistActor(), new Date(), { sessionId: s.id, customerPhone: PHONE });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.userId);
  });
});

describe("the shared Restaurant Counter — a waiter picked from the list", () => {
  it("only an active waiter ON SHIFT can be picked — never the Counter itself, a manager, the Mpishi, someone gone or off shift", async () => {
    const waiter = await waiterActor();
    const counter = { id: screen.userId!, label: "Restaurant Counter" };
    await expect(waiterOnCounter(waiter.userId!, counter)).rejects.toThrow(/not on shift/);
    await startWaiterShift(waiter);
    const as = await waiterOnCounter(waiter.userId!, counter);
    expect(as).toMatchObject({ userId: waiter.userId, deviceUserId: screen.userId });
    expect(as.label).toContain("on Restaurant Counter");
    for (const someone of [screen.userId!, (await managerActor()).userId!, (await chefActor()).userId!, "no-such-user"]) {
      await expect(waiterOnCounter(someone, counter)).rejects.toThrow(/Choose one of the waiters/);
    }
  });

  it("serving an order picked for a waiter on the Counter is recorded as the waiter's, with the Counter noted", async () => {
    const waiter = await waiterActor();
    const o = await order(await receptionistActor(), "loc_out_2");
    await startWaiterShift(waiter);
    const as = await waiterOnCounter(waiter.userId!, { id: screen.userId!, label: "Restaurant Counter" });
    await takeChargeOfOrder(o.id, as);
    expect(await db.waiterAssignment.findFirst({ where: { orderId: o.id } })).toMatchObject({ kind: "TAKEN", via: "PIN", toUserId: waiter.userId, byId: waiter.userId, deviceUserId: screen.userId });
  });
});

describe("working on the main restaurant screen", () => {
  it("an order made or a customer seated there for a waiter picked from the list is that waiter's", async () => {
    const waiter = await waiterActor();
    await startWaiterShift(waiter);
    const as = await waiterOnCounter(waiter.userId!, { id: screen.userId!, label: "Main Restaurant" });
    const o = await createRestaurantOrder({ type: "TAKEAWAY", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, as, new Date(), { customerPhone: PHONE });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.userId);
    expect(await db.waiterAssignment.findFirst({ where: { orderId: o.id } })).toMatchObject({ kind: "TAKEN", via: "PIN", deviceUserId: screen.userId });
    const s = await seatCustomer({ locationId: "loc_out_3", name: "Screen Guest", phone: PHONE, guestCount: 2 }, as);
    expect((await db.diningSession.findUniqueOrThrow({ where: { id: s.id } })).waiterId).toBe(waiter.userId);
    expect(await db.waiterAssignment.findFirst({ where: { scope: "TABLE", locationId: "loc_out_3" } })).toMatchObject({ kind: "TAKEN", via: "PIN", deviceUserId: screen.userId });
  });

  it("the screen itself, without a PIN, is nobody's waiter", async () => {
    const o = await createRestaurantOrder({ type: "TAKEAWAY", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, screen, new Date(), { customerPhone: PHONE });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBeNull();
    await expect(takeChargeOfOrder(o.id, screen)).rejects.toThrow(/Only a waiter/);
  });
});

describe("transfers", () => {
  it("only the waiter who has an order (or a manager) transfers it, to a colleague on shift, with the reason — history kept", async () => {
    const waiter = await waiterActor();
    const o = await order(waiter, "loc_in_2");
    await expect(transferOrder(o.id, second.userId!, "Break", second)).rejects.toThrow(/Only the waiter serving this order/);
    await expect(transferOrder(o.id, second.userId!, "", waiter)).rejects.toThrow(/Say why/);
    await expect(transferOrder(o.id, second.userId!, "Going on break", waiter)).rejects.toThrow(/not on shift/);
    await startWaiterShift(second);
    await transferOrder(o.id, second.userId!, "Going on break", waiter);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(second.userId);
    const rows = await db.waiterAssignment.findMany({ where: { orderId: o.id }, orderBy: { at: "asc" } });
    expect(rows.map((r) => r.kind)).toEqual(["TAKEN", "TRANSFER"]);
    expect(rows[1]).toMatchObject({ fromUserId: waiter.userId, toUserId: second.userId, reason: "Going on break" });
    await assignOrder(o.id, waiter.userId!, await managerActor(), new Date(), "Back from break");
    expect(await db.waiterAssignment.count({ where: { orderId: o.id } })).toBe(3);
  });

  it("a table goes with its customer and their orders; an order handed to someone else stays with them", async () => {
    const waiter = await waiterActor();
    const s = await seatCustomer({ locationId: "loc_in_1", name: "Table Seven", phone: PHONE, guestCount: 2 }, waiter);
    const a = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_1", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, waiter, new Date(), { sessionId: s.id, customerPhone: PHONE });
    const b = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_1", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 2 }] }, waiter, new Date(), { sessionId: s.id, customerPhone: PHONE });
    const third = await staffWithRole("waiter3@vegas.test", "Third Waiter (test)", "RESTAURANT");
    await assignOrder(b.id, third.userId!, await managerActor(), new Date(), "Drinks run");
    await startWaiterShift(second);
    const r = await transferTable("loc_in_1", second.userId!, "Changing section", waiter);
    expect(r.orders).toBe(1);
    expect((await db.diningSession.findUniqueOrThrow({ where: { id: s.id } })).waiterId).toBe(second.userId);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: a.id } })).assignedToId).toBe(second.userId);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: b.id } })).assignedToId).toBe(third.userId);
    expect(await db.waiterAssignment.count({ where: { scope: "TABLE", locationId: "loc_in_1", kind: "TRANSFER" } })).toBe(1);
  });
});

describe("a waiter's shift", () => {
  it("waiters work shifts side by side, reception stays one desk, and nobody holds two open shifts", async () => {
    const waiter = await waiterActor();
    await startWaiterShift(waiter);
    await startWaiterShift(second);
    await expect(startWaiterShift(waiter)).rejects.toThrow(/already running/);
    const asha = await receptionistActor();
    await startShift({ userId: asha.userId!, label: asha.label }, {});
    await expect(db.actualShift.create({ data: { department: "RESTAURANT", businessDate: new Date("2026-10-11"), userId: asha.userId! } })).rejects.toThrow();
    expect(await db.actualShift.count({ where: { endedAt: null } })).toBe(3);
  });

  it("cannot close with work left — transfer it all, then close; standing tables are freed", async () => {
    const waiter = await waiterActor();
    const o = await order(waiter, "loc_in_2");
    await assignTableWaiter("loc_out_1", waiter.userId!, await managerActor());
    await expect(endWaiterShift(waiter)).rejects.toThrow(/You still have 1 order/);
    await startWaiterShift(second);
    const r = await transferAllResponsibilities(waiter.userId!, second.userId!, "End of my shift", waiter);
    expect(r.orders).toBe(1);
    expect((await waiterResponsibilities(waiter.userId!)).blocking).toBe(false);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(second.userId);
    await endWaiterShift(waiter, "All handed to Second");
    expect(await db.actualShift.findFirst({ where: { userId: waiter.userId!, endedAt: null } })).toBeNull();
    expect((await db.restaurantLocation.findUniqueOrThrow({ where: { id: "loc_out_1" } })).waiterId).toBe(second.userId);
  });

  it("closing frees the waiter's standing table; a manager closes a shift with work left only by handing it to someone", async () => {
    const waiter = await waiterActor();
    await assignTableWaiter("loc_out_4", waiter.userId!, await managerActor());
    await startWaiterShift(waiter);
    await endWaiterShift(waiter);
    expect((await db.restaurantLocation.findUniqueOrThrow({ where: { id: "loc_out_4" } })).waiterId).toBeNull();
    expect(await db.waiterAssignment.findFirst({ where: { scope: "TABLE", locationId: "loc_out_4", kind: "RELEASED" } })).toMatchObject({ via: "SHIFT_CLOSE", fromUserId: waiter.userId });

    const o = await order(second, "loc_out_5");
    const shift = await db.actualShift.findFirstOrThrow({ where: { userId: second.userId!, endedAt: null } });
    const mgr = { ...(await managerActor()), userId: (await managerActor()).userId!, permissions: (await managerActor()).permissions! };
    await expect(closeWaiterShiftAsManager(mgr, shift.id, "Left early")).rejects.toThrow(/choose the waiter/);
    await startWaiterShift(waiter);
    const r = await closeWaiterShiftAsManager(mgr, shift.id, "Left early", waiter.userId);
    expect(r.handed).toMatchObject({ orders: 1 });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.userId);
    expect(await db.actualShift.findUniqueOrThrow({ where: { id: shift.id } })).toMatchObject({ closedById: mgr.userId, closeReason: "Left early" });
  });
});
