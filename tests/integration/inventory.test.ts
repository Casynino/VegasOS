import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  countStock, decideWaste, inventoryAlerts, moveAsset, receiveStock, reportWaste, saveAsset, saveInventoryItem, saveRecipe, setAssetState, takeStock, transferStock,
} from "@/server/services/inventory";
import { createRestaurantOrder, discountOrders, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { businessDateOf } from "@/lib/time/business-date";
import { chefActor, managerActor, receptionistActor, resetBusinessData } from "../support/helpers";

const BURGER = "mi_main_courses_beef_burger";
const BIRYANI = "mi_main_courses_chicken_biryani";
const HEINEKEN = "mi_beers_heineken";

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: { in: [BURGER, BIRYANI, HEINEKEN] } }, data: { isAvailable: true, isActive: true } });
});

async function item(name: string, dept = "invdep_kitchen", unit = "KG", qty = 0, extra: Partial<{ minStock: number; maxStock: number; reorderLevel: number; costPerUnit: number; tracksExpiry: boolean }> = {}) {
  const it = await saveInventoryItem({ name, categoryId: "invcat_food", departmentId: dept, unit, openingQuantity: qty, costPerUnit: 1000, ...extra }, await managerActor());
  return it.id;
}
const qty = async (id: string) => (await db.inventoryItem.findUniqueOrThrow({ where: { id } })).quantity;

describe("hotel inventory", () => {
  it("receives stock: 59 kg + 50 kg = 109 kg, at the new price, with who and before → after", async () => {
    const beef = await item("Beef", "invdep_kitchen", "KG", 59);
    const mgr = await managerActor();
    const r = await receiveStock({ itemId: beef, quantity: 50, unitCost: 15_000, reference: "DN-44" }, mgr);
    expect(r).toMatchObject({ before: 59, after: 109, total: 750_000 });
    expect(await db.inventoryItem.findUniqueOrThrow({ where: { id: beef } })).toMatchObject({ quantity: 109, costPerUnit: 15_000 });
    const m = await db.inventoryMovement.findFirstOrThrow({ where: { itemId: beef, kind: "RECEIVE" } });
    expect(m).toMatchObject({ change: 50, before: 59, after: 109, totalCost: 750_000, recordedById: mgr.userId, reference: "DN-44", status: "POSTED" });
    expect(await db.auditLog.count({ where: { action: "inventory.received", entityId: beef } })).toBe(1);
  });

  it("a delivery of an item that tracks expiry needs its date; expiring deliveries show as alerts", async () => {
    const milk = await item("Milk", "invdep_kitchen", "L", 0, { tracksExpiry: true });
    const mgr = await managerActor();
    await expect(receiveStock({ itemId: milk, quantity: 10 }, mgr)).rejects.toThrow(/expiry date/);
    const today = businessDateOf(new Date());
    await receiveStock({ itemId: milk, quantity: 10, expiresOn: today }, mgr);
    const a = await inventoryAlerts(today);
    expect(a.expiring.map((e) => e.item.name)).toEqual(["Milk"]);
  });

  it("uses stock with a reason, never more than is on the books", async () => {
    const beef = await item("Beef", "invdep_kitchen", "KG", 100);
    const chef = await chefActor();
    const r = await takeStock({ itemId: beef, quantity: 5, reason: "KITCHEN_USAGE" }, chef);
    expect(r).toMatchObject({ before: 100, after: 95 });
    await expect(takeStock({ itemId: beef, quantity: 500, reason: "KITCHEN_USAGE" }, chef)).rejects.toThrow(/Only 95 kg/);
    await expect(takeStock({ itemId: beef, quantity: 1, reason: "NOPE" }, chef)).rejects.toThrow(/why/);
    // Reception has no stock rights.
    await expect(takeStock({ itemId: beef, quantity: 1, reason: "KITCHEN_USAGE" }, await receptionistActor())).rejects.toThrow(/cannot take stock/);
  });

  it("waste reported by the Mpishi waits for the manager; the stock only drops when approved", async () => {
    const chicken = await item("Chicken", "invdep_kitchen", "KG", 100);
    const chef = await chefActor(), mgr = await managerActor();
    const w = await reportWaste({ itemId: chicken, quantity: 2, reason: "SPOILED", note: "fridge off" }, chef);
    expect(w.pending).toBe(true);
    expect(await qty(chicken)).toBe(100);
    const m = await db.inventoryMovement.findFirstOrThrow({ where: { itemId: chicken, kind: "WASTE" } });
    expect(m.status).toBe("PENDING");
    await expect(decideWaste(m.id, true, null, chef)).rejects.toThrow(/Only a manager/);
    await expect(decideWaste(m.id, false, "", mgr)).rejects.toThrow(/why/);
    const d = await decideWaste(m.id, true, null, mgr);
    expect(d).toMatchObject({ approved: true, before: 100, after: 98 });
    expect(await db.inventoryMovement.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "POSTED", before: 100, after: 98, recordedById: chef.userId, approvedById: mgr.userId });
    await expect(decideWaste(m.id, true, null, mgr)).rejects.toThrow(/already decided/);
    // A rejected report changes nothing.
    await reportWaste({ itemId: chicken, quantity: 1, reason: "DAMAGED" }, chef);
    const m2 = await db.inventoryMovement.findFirstOrThrow({ where: { itemId: chicken, status: "PENDING" } });
    await decideWaste(m2.id, false, "It was used, not wasted", mgr);
    expect(await qty(chicken)).toBe(98);
  });

  it("transfers 10 kg of Beef from the Kitchen to the Restaurant (made there with the same unit)", async () => {
    const beef = await item("Beef", "invdep_kitchen", "KG", 40);
    const r = await transferStock({ itemId: beef, toDepartmentId: "invdep_restaurant", quantity: 10 }, await managerActor());
    expect(r).toMatchObject({ from: "Kitchen", to: "Restaurant", qty: 10 });
    expect(await qty(beef)).toBe(30);
    const there = await db.inventoryItem.findUniqueOrThrow({ where: { departmentId_name: { departmentId: "invdep_restaurant", name: "Beef" } } });
    expect(there).toMatchObject({ quantity: 10, unit: "KG" });
    await expect(transferStock({ itemId: beef, toDepartmentId: "invdep_bar", quantity: 1 }, await chefActor())).rejects.toThrow(/Only a manager/);
  });

  it("a physical count needs a reason for each difference and is audited; matches are left alone", async () => {
    const beef = await item("Beef", "invdep_kitchen", "KG", 59);
    const rice = await item("Rice", "invdep_kitchen", "KG", 100);
    const mgr = await managerActor();
    await expect(countStock({ lines: [{ itemId: beef, counted: 57.5 }] }, mgr)).rejects.toThrow(/short by 1.5 kg/);
    const r = await countStock({ lines: [{ itemId: beef, counted: 57.5, reason: "MEASUREMENT" }, { itemId: rice, counted: 100 }] }, mgr);
    expect(r.corrected).toEqual([{ name: "Beef", before: 59, after: 57.5, unit: "KG" }]);
    expect(await qty(beef)).toBe(57.5);
    expect(await db.inventoryMovement.count({ where: { itemId: rice, kind: "COUNT" } })).toBe(0);
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "inventory.counted", entityId: beef } })).toMatchObject({ before: { quantity: 59 }, after: { quantity: 57.5, reason: "MEASUREMENT" } });
  });

  it("changing an item's minimum is audited old → new; the unit is locked once stock moved", async () => {
    const beef = await item("Beef", "invdep_kitchen", "KG", 10, { minStock: 15 });
    const mgr = await managerActor();
    await saveInventoryItem({ id: beef, name: "Beef", categoryId: "invcat_food", departmentId: "invdep_kitchen", unit: "KG", minStock: 20, costPerUnit: 1000 }, mgr);
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "inventory.item_updated", entityId: beef } })).toMatchObject({ before: { minStock: 15 }, after: { minStock: 20 } });
    await expect(saveInventoryItem({ id: beef, name: "Beef", categoryId: "invcat_food", departmentId: "invdep_kitchen", unit: "PIECE" }, mgr)).rejects.toThrow(/unit cannot change/);
  });

  it("finds low, out-of-stock and overstock items", async () => {
    await item("Chicken", "invdep_kitchen", "KG", 8, { minStock: 15 });
    await item("Sugar", "invdep_kitchen", "KG", 0, { minStock: 5 });
    await item("Water", "invdep_bar", "BOTTLE", 300, { minStock: 50, maxStock: 200 });
    const a = await inventoryAlerts(businessDateOf(new Date()));
    expect(a.low.map((i) => i.name)).toEqual(["Chicken"]);
    expect(a.out.map((i) => i.name)).toEqual(["Sugar"]);
    expect(a.over.map((i) => i.name)).toEqual(["Water"]);
  });

  it("recipes: 10 Beef Burgers ready → 1.5 kg of beef, 10 buns off stock — once", async () => {
    const beef = await item("Beef", "invdep_kitchen", "KG", 20);
    const buns = await item("Burger buns", "invdep_kitchen", "PIECE", 30);
    const mgr = await managerActor(), chef = await chefActor();
    await expect(saveRecipe(BURGER, [{ itemId: beef, quantity: 1, unit: "BOTTLE" }], mgr)).rejects.toThrow(/kept in kg/);
    await saveRecipe(BURGER, [{ itemId: beef, quantity: 150, unit: "G" }, { itemId: buns, quantity: 1, unit: "PIECE" }], mgr);
    const o = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "Table 4", settlement: "UNPAID", items: [{ menuItemId: BURGER, quantity: 10 }] }, await receptionistActor());
    await setOrderStatus(o.id, "ACCEPTED", chef);
    const lines = await db.restaurantOrderItem.findMany({ where: { orderId: o.id } });
    for (const l of lines) await setOrderItemPrepared(o.id, l.id, true, chef);
    expect(await qty(beef)).toBe(20); // not yet — only when it is ready
    await setOrderStatus(o.id, "READY", chef);
    expect(await qty(beef)).toBe(18.5);
    expect(await qty(buns)).toBe(20);
    const sale = await db.inventoryMovement.findFirstOrThrow({ where: { itemId: beef, kind: "SALE" } });
    expect(sale).toMatchObject({ change: -1.5, before: 20, after: 18.5, reference: o.number, orderId: o.id });
    // Taking it out again does not take the stock twice.
    await setOrderStatus(o.id, "OUT_FOR_DELIVERY", await (await import("../support/helpers")).waiterActor());
    expect(await qty(beef)).toBe(18.5);
  });
});

describe("assets", () => {
  it("numbers new assets, moves part of a line (with a record at the new place), and keeps condition history", async () => {
    const mgr = await managerActor();
    const chairs = await saveAsset({ name: "Restaurant chairs", category: "Furniture", location: "Restaurant", quantity: 20, purchaseCost: 2_000_000, condition: "GOOD", status: "IN_USE" }, mgr);
    expect(chairs.code).toBe("AST-0001");
    const r = await moveAsset({ assetId: chairs.id, to: "Meeting room", quantity: 4, note: "Conference" }, mgr);
    expect(r).toMatchObject({ qty: 4, from: "Restaurant", to: "Meeting room" });
    const all = await db.asset.findMany({ orderBy: { code: "asc" } });
    expect(all.map((a) => [a.code, a.location, a.quantity, a.purchaseCost])).toEqual([["AST-0001", "Restaurant", 16, 1_600_000], ["AST-0001-1", "Meeting room", 4, 400_000]]);
    const tv = await saveAsset({ code: "TV-012", name: "TV", category: "TVs & electronics", location: "Room 305", condition: "GOOD", status: "IN_USE" }, mgr);
    await setAssetState({ assetId: tv.id, condition: "DAMAGED", status: "UNDER_REPAIR", note: "Screen cracked" }, mgr);
    const h = await db.assetMovement.findMany({ where: { assetId: tv.id }, orderBy: { kind: "asc" } });
    expect(h.map((x) => [x.kind, x.fromValue, x.toValue])).toEqual([["CONDITION", "GOOD", "DAMAGED"], ["STATUS", "IN_USE", "UNDER_REPAIR"]]);
    await expect(saveAsset({ name: "X", category: "Other", condition: "GOOD", status: "IN_USE" }, await chefActor())).rejects.toThrow(/Only the MD/);
  });
});

describe("manager decisions on the restaurant bill", () => {
  it("a discount comes off the unpaid lines in proportion, with the reason, and is audited", async () => {
    const o = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "Table 4", settlement: "UNPAID", items: [{ menuItemId: BIRYANI, quantity: 1 }, { menuItemId: HEINEKEN, quantity: 2 }] }, await receptionistActor());
    const before = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });
    const mgr = await managerActor();
    await expect(discountOrders([o.id], { amount: 3000, reason: "x" }, mgr)).rejects.toThrow(/why/);
    await expect(discountOrders([o.id], { amount: 3000, reason: "Late food" }, await chefActor())).rejects.toThrow(/Only a manager/);
    const r = await discountOrders([o.id], { amount: 3000, reason: "Late food" }, mgr);
    expect(r.amount).toBe(3000);
    const after = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(after.total).toBe(before.total - 3000);
    expect(after.items.reduce((t, i) => t + i.discountAmount, 0)).toBe(3000);
    expect(after.items.reduce((t, i) => t + i.lineTotal, 0)).toBe(after.foodSubtotal + after.drinksSubtotal);
    expect(await db.auditLog.count({ where: { action: "restaurant_order.discounted" } })).toBe(1);
  });
});
