import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation, checkIn } from "@/server/services/reservations";
import { recordSale } from "@/server/services/outlets";
import { receiveHandover, submitHandover, type HandoverActor } from "@/server/services/cash-handover";
import { accountantOverview } from "@/server/services/accountant";
import { correctionsHistory, discountHistory, reconciliationByStaff } from "@/server/services/accountant-reports";
import { businessToday } from "@/server/settings";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

async function person(email: string, extra: string[] = []): Promise<HandoverActor> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, permissions: new Set([...u.role.permissions.map((p) => p.permission.code), ...extra]) };
}

describe("discounts given", () => {
  it("shows the original price, what was taken off and the final price of a room that was really stayed in", async () => {
    const mgr = await managerActor();
    const ex = await roomType("EXECUTIVE");
    const b = await createReservation({ sourceCode: "PHONE", guest: { fullName: "Discount Guest" }, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-11" },
      rooms: [{ roomTypeId: ex.id, adults: 1, children: 0, discountPerNight: 20_000 }] }, mgr, eat("2026-10-05T10:00:00"));
    // A booked night is only a price: it is not counted until the guest has checked in.
    expect((await discountHistory("2026-10-10", "2026-10-10")).roomRows).toHaveLength(0);
    await checkIn(b.id, mgr, null, eat("2026-10-10T15:00:00"));
    const d = await discountHistory("2026-10-10", "2026-10-10");
    expect(d.roomRows).toHaveLength(1);
    expect(d.roomRows[0]).toMatchObject({ guest: "Discount Guest", gross: 100_000, net: 80_000, nights: 1 });
    expect(d.roomRows[0].promo + d.roomRows[0].manual).toBe(20_000);
    expect(d.totals.all).toBe(20_000);
    // another day has none
    expect((await discountHistory("2026-10-11", "2026-10-11")).totals.all).toBe(0);
  });
});

describe("staff cash reconciliation and the Accountant's overview", () => {
  it("adds up what each person recorded, handed over and was received — and keeps cash taken, received and handed over apart", async () => {
    const asha = await person("asha@vegas.test", ["cash.handover.submit"]);
    const boss = await person("manager@vegas.test", ["cash.handover.review", "cash.handover.discrepancy"]);
    const bar = await db.revenueCategory.findUniqueOrThrow({ where: { code: "BAR" } });
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    await recordSale({ categoryId: bar.id, amount: 90_000, paymentMethodId: cash.id }, asha);
    const h = await submitHandover({ declared: 90_000 }, asha);
    await receiveHandover(h.id, { received: 85_000, note: "5,000 short — counted twice" }, boss);

    const rows = await reconciliationByStaff("2000-01-01", "2999-12-31");
    const mine = rows.find((r) => r.userId === asha.userId)!;
    expect(mine).toMatchObject({ recorded: 90_000, declared: 90_000, received: 85_000, difference: -5_000, handovers: 1, waiting: 0 });

    const today = await businessToday(); // the hotel day (04:00 → 04:00), not the calendar date
    const o = await accountantOverview({ from: today, to: today }, today);
    // Cash taken is recorded money; the handover changed neither it nor what was earned or received.
    expect(o.cash.total).toBe(90_000);
    expect(o.received.total).toBe(90_000);
    expect(o.handovers).toMatchObject({ received: 85_000, short: 5_000, over: 0 });
    expect(o.holders.find((p) => p.userId === asha.userId)).toBeUndefined(); // nothing left in their hands
  });

  it("reads refunds, reversals and corrections without inventing any", async () => {
    const c = await correctionsHistory("2000-01-01", "2999-12-31");
    expect(c).toMatchObject({ refunds: [], methodFixes: [], ledger: [] });
  });
});
