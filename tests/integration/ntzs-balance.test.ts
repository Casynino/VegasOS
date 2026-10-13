import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkNtzsBalance, ntzsCheckNeedsPhone, type WithdrawalActor } from "@/server/services/withdrawals";
import { ntzsReported } from "@/server/services/finance-home";
import { resetBusinessData } from "../support/helpers";

/** What nTZS holds is only known from what nTZS itself said (a price or "Check balance") — never guessed, and a number given to ask with is never a place to pay to. */
beforeEach(resetBusinessData);

async function someone() {
  const u = await db.user.findFirstOrThrow({ where: { isActive: true } });
  return u;
}
const row = async (data: { status: string; availableTzs?: number | null; failureCode?: string | null; submittedAt?: Date | null; createdAt?: Date }) => {
  const u = await someone();
  return db.withdrawal.create({
    data: {
      status: data.status as never, amount: 5_000, destinationKind: "PHONE", phone: "255712345678", requestedById: u.id, livemode: true,
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
});
