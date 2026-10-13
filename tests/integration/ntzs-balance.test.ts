import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkNtzsBalance, ntzsAvailable, ntzsCheckNeedsPhone, type WithdrawalActor } from "@/server/services/withdrawals";
import { ntzsReported } from "@/server/services/finance-home";
import { resetBusinessData } from "../support/helpers";

/** What nTZS holds is only known from what nTZS itself said (a price or "Check balance") — never guessed, and a number given to ask with is never a place to pay to. */
beforeEach(resetBusinessData);
afterEach(async () => { await db.moneyAccount.update({ where: { code: "NTZS" }, data: { openingBalance: 0 } }); });

async function someone() {
  const u = await db.user.findFirstOrThrow({ where: { isActive: true } });
  return u;
}
const row = async (data: { status: string; amount?: number; feeTzs?: number | null; availableTzs?: number | null; failureCode?: string | null; submittedAt?: Date | null; createdAt?: Date }) => {
  const u = await someone();
  return db.withdrawal.create({
    data: {
      status: data.status as never, amount: data.amount ?? 5_000, feeTzs: data.feeTzs ?? null, destinationKind: "PHONE", phone: "255712345678", requestedById: u.id, livemode: true,
      businessDate: new Date("2026-10-13T00:00:00Z"), availableTzs: data.availableTzs ?? null, failureCode: data.failureCode ?? null,
      submittedAt: data.submittedAt ?? null, ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  });
};

describe("the nTZS balance", () => {
  it("nothing reported yet: no figure is shown (never a guess)", async () => {
    expect(await ntzsReported()).toBeNull();
  });

  it("shows what nTZS last said, when, and how many withdrawals were sent after it", async () => {
    await row({ status: "CANCELLED", failureCode: "balance_check", availableTzs: 6_500, createdAt: new Date("2026-10-13T08:00:00Z") });
    await row({ status: "COMPLETED", availableTzs: null, submittedAt: new Date("2026-10-13T09:00:00Z"), createdAt: new Date("2026-10-13T09:00:00Z") });
    const r = await ntzsReported();
    expect(r).toMatchObject({ available: 6_500, live: true, sentSince: 1 });
    expect(r?.at.toISOString()).toBe("2026-10-13T08:00:00.000Z");
  });

  it("'Check balance' asks for a phone number only while no withdrawal was ever priced — and a balance check's number never becomes the place to ask with or to pay to", async () => {
    expect(await ntzsCheckNeedsPhone()).toBe(true);
    await row({ status: "CANCELLED", failureCode: "balance_check", availableTzs: 6_500 });
    expect(await ntzsCheckNeedsPhone()).toBe(true);
    await row({ status: "COMPLETED" });
    expect(await ntzsCheckNeedsPhone()).toBe(false);
  });

  it("without a number to ask with, and with nTZS not connected, nothing is asked of nTZS", async () => {
    const u = await someone();
    const actor: WithdrawalActor = { userId: u.id, label: u.fullName, ipAddress: null, permissions: new Set(["withdrawals.manage"]) };
    await expect(checkNtzsBalance(actor)).rejects.toThrow();
    expect(await db.withdrawal.count()).toBe(0);
  });

  it("what can be withdrawn is what the books hold for nTZS, less what is already on its way out (a finished withdrawal is already out of the books)", async () => {
    await db.moneyAccount.update({ where: { code: "NTZS" }, data: { openingBalance: 7_500 } });
    expect(await ntzsAvailable()).toEqual({ books: 7_500, onItsWay: 0, available: 7_500 });
    await row({ status: "PROCESSING", amount: 5_000, feeTzs: 200 });
    expect(await ntzsAvailable()).toEqual({ books: 7_500, onItsWay: 5_200, available: 2_300 });
    await row({ status: "COMPLETED", amount: 1_000 });
    await row({ status: "FAILED", amount: 9_000 });
    expect(await ntzsAvailable()).toEqual({ books: 7_500, onItsWay: 5_200, available: 2_300 });
  });
});
