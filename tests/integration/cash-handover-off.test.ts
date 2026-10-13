import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { recordSale } from "@/server/services/outlets";
import { endShift, startShift } from "@/server/services/shifts";
import { receiveHandover, rejectHandover, resubmitHandover, returnHandover, submitHandover, type HandoverActor } from "@/server/services/cash-handover";
import { accountantOverview } from "@/server/services/accountant";
import { financeNeeds } from "@/server/services/finance-home";
import { CASH_HANDOVER_ON } from "@/lib/cash-handover";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { visibleNav } from "@/components/staff/nav-config";
import { businessToday } from "@/server/settings";
import { receptionistActor, resetBusinessData } from "../support/helpers";

/** The digital cash handover is switched OFF (owner, 2026-10-13): nothing waits for it, nothing is lost, and the rest works as before. */
beforeEach(resetBusinessData);

const staff = async (): Promise<HandoverActor> => {
  const u = await db.user.findUniqueOrThrow({ where: { email: "asha@vegas.test" }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, permissions: new Set([...u.role.permissions.map((p) => p.permission.code), "cash.handover.submit", "cash.handover.review", "cash.handover.discrepancy"]) };
};

describe("cash handover is off", () => {
  it("the switch is off, and the server refuses every handover action — even for someone who holds the rights", async () => {
    expect(CASH_HANDOVER_ON).toBe(false);
    const who = await staff();
    await expect(submitHandover({ declared: 1000 }, who)).rejects.toThrow(/switched off/);
    await expect(resubmitHandover("x", { declared: 1000 }, who)).rejects.toThrow(/switched off/);
    await expect(receiveHandover("x", { received: 1000 }, who)).rejects.toThrow(/switched off/);
    await expect(returnHandover("x", "because", who)).rejects.toThrow(/switched off/);
    await expect(rejectHandover("x", "because", who)).rejects.toThrow(/switched off/);
    expect(await db.cashHandover.count()).toBe(0);
  });

  it("a shift ends with cash collected and no handover: nothing blocks it, and the payment records are untouched", async () => {
    const rec = await receptionistActor();
    const desk = { ...rec, userId: rec.userId!, permissions: rec.permissions! };
    await startShift(desk, {});
    const bar = await db.revenueCategory.findUniqueOrThrow({ where: { code: "BAR" } });
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    await recordSale({ categoryId: bar.id, amount: 40_000, paymentMethodId: cash.id }, desk);
    const done = await endShift(desk, "All quiet");
    expect(done.shiftId).toBeTruthy();
    expect((await db.revenueTransaction.aggregate({ _sum: { amount: true } }))._sum.amount).toBe(40_000);
    expect(await db.cashHandover.count()).toBe(0);
  }, 30_000); // a shift takes locks: give it room when the whole suite runs at once

  it("Finance's numbers do not depend on it: cash taken is shown, nothing waits, nothing is 'still with staff'", async () => {
    const who = await staff();
    const bar = await db.revenueCategory.findUniqueOrThrow({ where: { code: "BAR" } });
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    await recordSale({ categoryId: bar.id, amount: 25_000, paymentMethodId: cash.id }, who);
    const today = await businessToday();
    const ov = await accountantOverview({ from: today, to: today }, today);
    expect(ov.cash.total).toBe(25_000);
    expect(ov.handovers).toMatchObject({ waitingCount: 0, returned: 0, receivedCount: 0, heldNow: 0, awaiting: 0 });
    expect(ov.holders).toEqual([]);
    expect((await financeNeeds(today, new Set<string>(DEFAULT_ROLES.FINANCE.permissions))).map((n) => n.kind)).not.toEqual(expect.arrayContaining(["handoverWaiting"]));
  });

  it("the menu has no Cash handovers item for anyone", () => {
    for (const role of ["FINANCE", "MANAGER", "OWNER", "ADMIN", "RECEPTIONIST", "RESTAURANT_SCREEN"] as const) {
      const labels = visibleNav(new Set<string>(DEFAULT_ROLES[role].permissions)).flatMap((s) => s.items.map((i) => i.label));
      expect(labels, role).not.toContain("Cash handovers");
    }
  });
});
