import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { expenseTypes, monthlyBills, recordExpense, spendByType } from "@/server/services/expenses";
import { receptionistActor, resetBusinessData } from "../support/helpers";

/** Expense types: pick from the hotel's list, or add a new one that is saved for next time. */
beforeEach(async () => {
  await resetBusinessData();
  await db.expenseItem.deleteMany({ where: { id: { not: { startsWith: "exi_" } } } });
  await db.expenseItem.updateMany({ data: { useCount: 0, lastUsedAt: null } });
});
const rec = async () => (await receptionistActor()) as never;
const cash = () => db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });

describe("expense types", () => {
  it("the hotel's list is there, grouped, with the monthly bills marked", async () => {
    const t = await expenseTypes();
    const names = t.groups.flatMap((g) => g.items.map((i) => i.name));
    expect(names).toEqual(expect.arrayContaining(["Water bill — DAWASA", "NSSF / SDL / PAYE", "Selcom fee", "Netflix", "Staff food"]));
    expect(t.groups.find((g) => g.name === "Utilities")?.items.find((i) => i.name.startsWith("Electricity"))?.frequency).toBe("MONTHLY");
    expect(t.groups.some((g) => g.name === "Cleaning")).toBe(false); // old categories are folded in
  });

  it("picking a type fills the group and default payee, counts as most used, and ticks the monthly bill", async () => {
    await recordExpense({ categoryId: "", itemId: "exi_dawasa", amount: 85_000, description: "", paymentMethodId: (await cash()).id }, await rec());
    const e = await db.expense.findFirstOrThrow({ include: { category: true } });
    expect(e).toMatchObject({ itemId: "exi_dawasa", description: "Water bill — DAWASA", payee: "DAWASA" });
    expect(e.category.code).toBe("UTILITIES");
    expect((await expenseTypes()).mostUsed[0]).toBe("exi_dawasa");
    const today = e.businessDate.toISOString().slice(0, 10);
    const bills = await monthlyBills(today.slice(0, 8) + "01", today);
    expect(bills.find((b) => b.id === "exi_dawasa")).toMatchObject({ paid: 85_000, times: 1 });
    expect(bills.find((b) => b.id === "exi_netflix")?.paid).toBe(0);
    const sum = await spendByType(today, today);
    expect(sum.groups[0]).toMatchObject({ name: "Utilities", total: 85_000, lines: [{ name: "Water bill — DAWASA", amount: 85_000, count: 1 }] });
  });

  it("a new type typed by staff is saved for next time (and reused, not duplicated)", async () => {
    const group = await db.expenseCategory.findUniqueOrThrow({ where: { code: "HOUSEKEEPING" } });
    await recordExpense({ categoryId: "", newItem: { name: "Swimming pool chemicals", categoryId: group.id, frequency: "MONTHLY" }, amount: 40_000, description: "", paymentMethodId: (await cash()).id }, await rec());
    await recordExpense({ categoryId: "", newItem: { name: "swimming pool  chemicals", categoryId: group.id }, amount: 30_000, description: "", paymentMethodId: (await cash()).id }, await rec());
    const items = await db.expenseItem.findMany({ where: { name: { contains: "pool", mode: "insensitive" } } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ frequency: "MONTHLY", useCount: 2 });
    expect((await expenseTypes()).groups.find((g) => g.id === group.id)?.items.some((i) => i.name === "Swimming pool chemicals")).toBe(true);
  });
});
