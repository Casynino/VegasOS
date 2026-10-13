import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { accountBalances } from "@/server/services/finance";
import { setOpeningBalance } from "@/server/services/payment-accounts";
import { managerActor, resetBusinessData } from "../support/helpers";

/** An account's opening balance: where its books begin — not income, not a payment, always with a reason and an audit line. */
beforeEach(resetBusinessData);
afterEach(async () => { await db.moneyAccount.update({ where: { code: "NTZS" }, data: { openingBalance: 0 } }); });

const counts = async () => ({
  payments: await db.payment.count(), sales: await db.revenueTransaction.count(), ledger: await db.ledgerEntry.count(), expenses: await db.expense.count(),
});

describe("opening balance", () => {
  it("sets where the nTZS account's books begin — the balance follows, and no payment, sale, expense or ledger line is made", async () => {
    const nt = await db.moneyAccount.findUniqueOrThrow({ where: { code: "NTZS" } });
    const who = await managerActor();
    const before = await counts();
    const saved = await setOpeningBalance({ accountId: nt.id, amount: 6_500, reason: "Real money in the nTZS wallet from before the clean start" }, { userId: who.userId!, label: who.label });
    expect(saved.openingBalance).toBe(6_500);
    expect((await accountBalances()).find((b) => b.code === "NTZS")).toMatchObject({ openingBalance: 6_500, moneyIn: 0, moneyOut: 0, balance: 6_500 });
    expect(await counts()).toEqual(before);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "payment_account.opening_balance_set", entityId: nt.id } });
    expect(log.before).toMatchObject({ openingBalance: 0 });
    expect(log.after).toMatchObject({ openingBalance: 6_500, reason: "Real money in the nTZS wallet from before the clean start" });
    expect(log.userId).toBe(who.userId);
  });

  it("needs a reason and a whole amount of 0 or more, and says so when nothing changes", async () => {
    const nt = await db.moneyAccount.findUniqueOrThrow({ where: { code: "NTZS" } });
    const who = { userId: (await managerActor()).userId!, label: "Test" };
    await expect(setOpeningBalance({ accountId: nt.id, amount: 6_500, reason: "no" }, who)).rejects.toThrow(/at least 5 letters/);
    await expect(setOpeningBalance({ accountId: nt.id, amount: -1, reason: "Opening money" }, who)).rejects.toThrow(/whole shillings/);
    await expect(setOpeningBalance({ accountId: nt.id, amount: 10.5, reason: "Opening money" }, who)).rejects.toThrow(/whole shillings/);
    await expect(setOpeningBalance({ accountId: nt.id, amount: 0, reason: "Opening money" }, who)).rejects.toThrow(/already the opening balance/);
    await expect(setOpeningBalance({ accountId: "missing", amount: 5, reason: "Opening money" }, who)).rejects.toThrow(/not found/);
    expect(await db.auditLog.count({ where: { action: "payment_account.opening_balance_set" } })).toBe(0);
  });
});
