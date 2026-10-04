import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import type { Actor } from "@/server/services/reservations";
import { createRestaurantOrder, logBillPrinted, recordOrderPayment, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { endWaiterShift, startWaiterShift, takeChargeOfOrder, transferOrder } from "@/server/services/waiter-work";
import { waiterActivity } from "@/server/services/waiter-activity";
import { numberWaitersTx } from "@/server/services/waiter-number";
import { chefActor, counterActor, receptionistActor, resetBusinessData, waiterActor } from "../support/helpers";

/**
 * A waiter's own record is written by what they do — never typed in: the orders connected to them (created,
 * given to them, claimed, handed over, served), how each is paid (as the Counter recorded it — information
 * only), and one history in time order. Waiters never record payments.
 */
const BEER = "mi_beers_heineken";
const PHONE = "0712 404 505";
let second: Actor;

beforeAll(async () => {
  const role = await db.role.findUniqueOrThrow({ where: { code: "RESTAURANT" }, include: { permissions: { include: { permission: true } } } });
  const u = await db.user.upsert({
    where: { email: "waiter3@vegas.test" }, update: { isActive: true, roleId: role.id },
    create: { email: "waiter3@vegas.test", fullName: "Third Waiter (test)", roleId: role.id, passwordHash: await hashPassword("Waiter12345"), mustChangePassword: false },
  });
  second = { userId: u.id, label: u.fullName, role: role.name, permissions: new Set(role.permissions.map((p) => p.permission.code)) };
});
beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: BEER }, data: { isAvailable: true, isActive: true } });
  await db.restaurantLocation.updateMany({ data: { waiterId: null, isActive: true, blockedAs: null } });
});
afterAll(async () => {
  await resetBusinessData();
});

async function readyUp(id: string) {
  const chef = await chefActor();
  await setOrderStatus(id, "ACCEPTED", chef);
  for (const i of await db.restaurantOrderItem.findMany({ where: { orderId: id } })) await setOrderItemPrepared(id, i.id, true, chef);
  await setOrderStatus(id, "READY", chef);
}
const window = () => ({ from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 60_000) });

describe("a waiter's own record", () => {
  it("everything they did shows by itself: shift, order created, claimed, served, bill printed — and how each is paid", async () => {
    const waiter = await waiterActor();
    await startWaiterShift(waiter);
    // Their own order at a table, served and paid in cash at the Counter.
    const mine = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_2", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 2 }] }, waiter, new Date(), { customerPhone: PHONE });
    await readyUp(mine.id);
    await setOrderStatus(mine.id, "OUT_FOR_DELIVERY", waiter);
    await setOrderStatus(mine.id, "DELIVERED", waiter);
    await logBillPrinted(mine.id, { how: "print", total: mine.total, scope: "order" }, waiter);
    await recordOrderPayment(mine.id, { accountId: "acct_cash", handedOverById: waiter.userId }, await counterActor());
    // A reception order nobody had: they claim it (Serve) once it is ready.
    const other = await createRestaurantOrder({ type: "TAKEAWAY", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, await receptionistActor(), new Date(), { customerPhone: PHONE });
    await readyUp(other.id);
    await takeChargeOfOrder(other.id, waiter);

    const a = await waiterActivity(waiter.userId!, window());
    expect(a.orders.map((o) => o.id).sort()).toEqual([mine.id, other.id].sort());
    const m = a.orders.find((o) => o.id === mine.id)!;
    expect(m).toMatchObject({ kind: "TABLE", money: "PAID", status: "COMPLETED", cashPaid: mine.total });
    expect(m.how).toEqual(expect.arrayContaining(["Created", "Served"]));
    expect(a.orders.find((o) => o.id === other.id)).toMatchObject({ kind: "RESTAURANT", money: "UNPAID", mine: true, how: ["Claimed"] });
    expect(a.summary).toMatchObject({ orders: 2, tables: 1, created: 1, claimed: 1, served: 1, completed: 1, pending: 1, cashPaid: mine.total, unpaid: other.total });
    const text = a.history.map((h) => h.text).join("\n");
    for (const line of [/Started the shift/, /Created #\d+ · Table 2 — Inside/, /Served #\d+/, /Bill printed · #\d+/, /Claimed #\d+/]) expect(text).toMatch(line);
    // Nothing about money they never recorded: the Counter's payment is not in their history.
    expect(text).not.toMatch(/Payment received/);
  });

  it("a hand-over shows on both sides; the shift end shows too", async () => {
    const waiter = await waiterActor();
    await startWaiterShift(waiter);
    await startWaiterShift(second);
    const o = await createRestaurantOrder({ type: "TAKEAWAY", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 1 }] }, waiter, new Date(), { customerPhone: PHONE });
    await transferOrder(o.id, second.userId!, "Going on break", waiter);
    const mine = await waiterActivity(waiter.userId!, window());
    const theirs = await waiterActivity(second.userId!, window());
    expect(mine.history.map((h) => h.text).join("\n")).toMatch(/Handed #\d+ · Take away|Handed #\d+ · \S+ to Third — Going on break/);
    expect(theirs.history.map((h) => h.text).join("\n")).toMatch(/#\d+ · .+ handed to you by Waiter — Going on break/);
    expect(mine.orders[0]).toMatchObject({ mine: false, how: expect.arrayContaining(["Created", "Handed over"]) });
    expect(theirs.orders[0]).toMatchObject({ mine: true, how: ["Handed to you"] });
    await endWaiterShift(waiter); // nothing left with them: the order is the colleague's now
    expect((await waiterActivity(waiter.userId!, window())).history[0].text).toBe("Ended the shift");
  });
});

describe("waiter numbers", () => {
  it("every waiter gets the next WTR number once — never the Counter or management", async () => {
    await db.user.updateMany({ where: { email: { in: ["waiter3@vegas.test"] } }, data: { staffCode: null } });
    await numberWaitersTx(db);
    const u = await db.user.findUniqueOrThrow({ where: { email: "waiter3@vegas.test" } });
    expect(u.staffCode).toMatch(/^WTR-\d{3}$/);
    const before = u.staffCode;
    await numberWaitersTx(db);
    expect((await db.user.findUniqueOrThrow({ where: { email: "waiter3@vegas.test" } })).staffCode).toBe(before); // never changes
    const others = await db.user.findMany({ where: { role: { code: { in: ["RESTAURANT_SCREEN", "MANAGER", "OWNER", "ADMIN", "KITCHEN", "RECEPTIONIST"] } } }, select: { staffCode: true } });
    expect(others.every((x) => !x.staffCode?.startsWith("WTR-"))).toBe(true);
  });
});

describe("the waiter's flow", () => {
  const SAFARI = "mi_beers_safari";
  const FOOD = async () => (await db.menuItem.findFirstOrThrow({ where: { type: "FOOD", isActive: true, isAvailable: true } })).id;

  it("drinks only: the waiter accepts (it is theirs) and serves them straight — no kitchen, no ticking", async () => {
    const waiter = await waiterActor();
    await startWaiterShift(waiter);
    await db.menuItem.updateMany({ where: { id: SAFARI }, data: { isAvailable: true, isActive: true } });
    const o = await createRestaurantOrder({ type: "TAKEAWAY", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 2 }] }, await receptionistActor(), new Date(), { customerPhone: PHONE });
    await expect(setOrderStatus(o.id, "DELIVERED", waiter)).rejects.toThrow(/Accept the order first/);
    await setOrderStatus(o.id, "PREPARING", waiter); // Accept
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.userId);
    await setOrderStatus(o.id, "DELIVERED", waiter); // Served
    const done = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(done).toMatchObject({ status: "DELIVERED", assignedToId: waiter.userId, deliveredById: waiter.userId });
    expect(done.readyAt).not.toBeNull();
    expect(done.items.every((i) => i.preparedAt)).toBe(true);
  });

  it("food: the waiter accepts it (theirs), the Mpishi makes it and marks it ready — it is still theirs to serve", async () => {
    const waiter = await waiterActor();
    await startWaiterShift(waiter);
    const food = await FOOD();
    await db.menuItem.updateMany({ where: { id: food }, data: { isAvailable: true, isActive: true } });
    const o = await createRestaurantOrder({ type: "TAKEAWAY", settlement: "UNPAID", items: [{ menuItemId: food, quantity: 1 }] }, await receptionistActor(), new Date(), { customerPhone: PHONE });
    await setOrderStatus(o.id, "PREPARING", waiter); // Accept
    await expect(setOrderStatus(o.id, "DELIVERED", waiter)).rejects.toThrow(/kitchen has not marked this order ready/);
    const chef = await chefActor();
    for (const i of await db.restaurantOrderItem.findMany({ where: { orderId: o.id } })) await setOrderItemPrepared(o.id, i.id, true, chef);
    await setOrderStatus(o.id, "READY", chef);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).assignedToId).toBe(waiter.userId); // the Mpishi never changes who serves
    await setOrderStatus(o.id, "OUT_FOR_DELIVERY", waiter);
    await setOrderStatus(o.id, "DELIVERED", waiter);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).deliveredById).toBe(waiter.userId);
  });
});
