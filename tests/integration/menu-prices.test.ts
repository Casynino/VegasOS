import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setMenuItemPrice, type PriceActor } from "@/server/services/menu-prices";
import { financeHistory } from "@/server/services/finance-history";
import { businessToday } from "@/server/settings";
import { resetBusinessData } from "../support/helpers";

beforeEach(resetBusinessData);

async function person(email: string, codes: string[]): Promise<PriceActor> {
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  return { userId: u.id, label: u.fullName, permissions: new Set(codes) };
}

describe("menu price change (the Accountant's narrow right)", () => {
  it("changes only the price, keeps the old order lines at their price and writes who, old and new to the history", async () => {
    const accountant = await person("manager@vegas.test", ["restaurant.prices"]);
    const item = await db.menuItem.findFirstOrThrow({ where: { isActive: true }, orderBy: { name: "asc" } });
    const before = { name: item.name, description: item.description, isAvailable: item.isAvailable, categoryId: item.categoryId };
    const newPrice = item.price + 1_000;

    const done = await setMenuItemPrice(item.id, newPrice, accountant);
    expect(done).toMatchObject({ from: item.price, to: newPrice });
    const after = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.price).toBe(newPrice);
    expect({ name: after.name, description: after.description, isAvailable: after.isAvailable, categoryId: after.categoryId }).toEqual(before);

    const today = await businessToday();
    const history = await financeHistory({ from: today, to: today, group: "prices" });
    const line = history.find((h) => h.action === "menu.price_changed" && h.record === item.name);
    expect(line?.who).toBeTruthy();
    expect(line?.changes.map((c) => `${c.field}:${c.from}>${c.to}`)).toContain(`Price:${item.price.toLocaleString("en-US")}>${newPrice.toLocaleString("en-US")}`);
    // put it back — the test database is shared
    await setMenuItemPrice(item.id, item.price, accountant);
  });

  it("refuses a person without the right, a bad price, the same price and a missing item", async () => {
    const waiter = await person("waiter@vegas.test", ["restaurant.orders"]);
    const accountant = await person("manager@vegas.test", ["restaurant.prices"]);
    const item = await db.menuItem.findFirstOrThrow({ where: { isActive: true } });
    await expect(setMenuItemPrice(item.id, item.price + 500, waiter)).rejects.toThrow(/permission/);
    await expect(setMenuItemPrice(item.id, 0, accountant)).rejects.toThrow(/whole shillings/);
    await expect(setMenuItemPrice(item.id, 10.5, accountant)).rejects.toThrow(/whole shillings/);
    await expect(setMenuItemPrice(item.id, item.price, accountant)).rejects.toThrow(/already the price/);
    await expect(setMenuItemPrice("does-not-exist-123", 1_000, accountant)).rejects.toThrow(/not found/);
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: item.id } })).price).toBe(item.price);
  });
});
