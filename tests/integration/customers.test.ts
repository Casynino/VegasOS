import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { customerByPhone, findCustomers, removeCustomer } from "@/server/services/guests";
import { placeOnlineOrder } from "@/server/services/online-orders";
import { createRestaurantOrder } from "@/server/services/restaurant";
import { seatCustomer } from "@/server/services/dining-sessions";
import { chefActor, managerActor, receptionistActor, resetBusinessData, waiterActor } from "../support/helpers";

const BIRYANI = "mi_main_courses_chicken_biryani";
let n = 0;
const key = () => `${(++n).toString(16).padStart(8, "0")}${"c".repeat(24)}`;

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: BIRYANI }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { publicOrderingEnabled: true } });
});

describe("customers — the phone number is the key", () => {
  it("staff type a number and the system knows the customer: name, orders — any way it is written", async () => {
    await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 1 }], name: "Neema Joseph", phone: "0754 333 444", kind: "PICKUP" });
    await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 2 }], name: "", phone: "+255 754 333 444", kind: "PICKUP" });

    const k = await customerByPhone("0754333444");
    expect(k).toMatchObject({ name: "Neema Joseph", orders: 2, stays: 0, room: null });
    expect(k?.lastVisit).toBeTruthy();
    // One number, one customer — the second order found her, without her name typed again.
    expect(await db.guest.count({ where: { phone: "+255754333444" } })).toBe(1);
    expect(await customerByPhone("0754 999 000")).toBeNull();
    expect(await customerByPhone("12")).toBeNull();
  });

  it("reception, waiters and managers remove customers (not the Mpishi): nothing on record → deleted; with orders → details wiped, the books kept", async () => {
    const [manager, reception, waiter, chef] = [await managerActor(), await receptionistActor(), await waiterActor(), await chefActor()];
    const empty = await db.guest.create({ data: { fullName: "Typo Person", phone: "+255700111222" } });
    await expect(removeCustomer(empty.id, chef)).rejects.toThrow(/cannot remove/);
    expect(await removeCustomer(empty.id, reception)).toEqual({ deleted: true });
    const twice = await db.guest.create({ data: { fullName: "Double Entry", phone: "+255700111333" } });
    expect(await removeCustomer(twice.id, waiter)).toEqual({ deleted: true });
    expect(await db.guest.findUnique({ where: { id: empty.id } })).toBeNull();

    const o = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 1 }], name: "Baraka Ally", phone: "0765 222 111", kind: "PICKUP" });
    expect(await removeCustomer(o.guestId!, manager)).toEqual({ deleted: false });
    const g = await db.guest.findUniqueOrThrow({ where: { id: o.guestId! } });
    expect(g).toMatchObject({ fullName: "Removed customer", phone: null, email: null });
    expect(g.deletedAt).toBeTruthy();
    // The order (and its money) stays in the books, still linked.
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ guestId: o.guestId, total: o.total });
    // The number is free again: the lookup no longer finds them, a new order makes a new customer.
    expect(await customerByPhone("0765 222 111")).toBeNull();
    const again = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 1 }], name: "Baraka Ally", phone: "0765 222 111", kind: "PICKUP" });
    expect(again.guestId).not.toBe(o.guestId);
    await expect(removeCustomer(o.guestId!, manager)).rejects.toThrow(/not found/);
    expect(await db.auditLog.count({ where: { action: { in: ["guest.deleted", "guest.removed"] } } })).toBe(3);
  });
});

describe("finding a customer — by part of the name or the number", () => {
  it("any part of the name or any way the number is written finds them; closest names first; removed customers never", async () => {
    const neema = await db.guest.create({ data: { fullName: "Neema Joseph", phone: "+255754333444" } });
    const joseph = await db.guest.create({ data: { fullName: "Joseph Mrema", phone: "+255765111222", altPhone: "+255713999888", vip: true } });
    await db.guest.create({ data: { fullName: "Joseph Gone", phone: "+255754333999", deletedAt: new Date() } });

    // The name that starts with it comes first; the removed customer never shows.
    expect((await findCustomers("jos")).map((c) => c.name)).toEqual(["Joseph Mrema", "Neema Joseph"]);
    expect(await findCustomers("NEEMA")).toMatchObject([{ id: neema.id, phone: "+255754333444", vip: false, room: null, table: null }]);
    for (const q of ["0754 333", "+255 754 333", "754333", "255754333"]) expect((await findCustomers(q)).map((c) => c.id)).toEqual([neema.id]);
    // Found by a second number: that number is the one shown (it is the one they gave).
    expect(await findCustomers("0713 999")).toMatchObject([{ id: joseph.id, phone: "+255713999888", vip: true }]);
    // Too little to search: one letter, or "07".
    expect(await findCustomers("j")).toEqual([]);
    expect(await findCustomers("07")).toEqual([]);
    expect(await findCustomers("   ")).toEqual([]);
  });

  it("their reference finds them first — its digits are not searched as a phone number", async () => {
    const g = await db.guest.create({ data: { fullName: "Referenced Person", phone: "+255700000001" } });
    await db.guest.updateMany({ where: { id: g.id }, data: { reference: "G-A1B2C3" } });
    // Someone whose number holds the reference's digits must not push them out.
    await db.guest.create({ data: { fullName: "Digits Match", phone: "+255712312399" } });
    expect((await findCustomers("G-A1B2C3")).map((c) => c.id)).toEqual([g.id]);
    expect((await findCustomers("a1b2c3")).map((c) => c.id)).toEqual([g.id]);
  });

  it("a customer picked in the search is that very person — even when someone else shares the number; a blank phone is filled", async () => {
    const waiter = await waiterActor();
    const baraka = await db.guest.create({ data: { fullName: "Baraka Joseph", phone: "+255711222333" } });
    await db.guest.create({ data: { fullName: "Neema Joseph", phone: "+255711222333" } }); // newer, the same number
    const o = await createRestaurantOrder({ type: "TAKEAWAY", settlement: "UNPAID", customerName: "Baraka Joseph", items: [{ menuItemId: BIRYANI, quantity: 1 }] }, waiter, new Date(), { customerPhone: "+255711222333", pickedGuestId: baraka.id });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).guestId).toBe(baraka.id);

    const asha = await db.guest.create({ data: { fullName: "Asha No Phone" } });
    const o2 = await createRestaurantOrder({ type: "TAKEAWAY", settlement: "UNPAID", customerName: "Asha No Phone", items: [{ menuItemId: BIRYANI, quantity: 1 }] }, waiter, new Date(), { customerPhone: "+255744555666", pickedGuestId: asha.id });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o2.id } })).guestId).toBe(asha.id);
    expect((await db.guest.findUniqueOrThrow({ where: { id: asha.id } })).phone).toBe("+255744555666");
    expect(await db.guest.count({ where: { fullName: "Asha No Phone" } })).toBe(1); // no twin

    // Seating works the same way; a removed customer is never used (the phone decides).
    const table = await db.restaurantLocation.findFirstOrThrow({ where: { kind: "TABLE", isActive: true } });
    await db.restaurantLocation.updateMany({ where: { id: table.id }, data: { waiterId: null, blockedAs: null } });
    const s = await seatCustomer({ locationId: table.id, name: "Baraka Joseph", phone: "0711 222 333", guestId: baraka.id }, waiter);
    expect((await db.diningSession.findUniqueOrThrow({ where: { id: s.id } })).guestId).toBe(baraka.id);
  });
});
