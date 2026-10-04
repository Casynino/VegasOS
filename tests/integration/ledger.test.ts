import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { recordExpense, reinstateExpense, repostCorrectedExpense, voidExpense } from "@/server/services/expenses";
import { accountBalances, getLedger, postMovement, recordCashCount, reverseMovement, reviewCashCount, type Actor as FinanceActor } from "@/server/services/finance";
import { eat, managerActor as mgrActor, receptionistActor as recActor, resetBusinessData, roomType } from "../support/helpers";

// Signed-in staff always have a user id.
const managerActor = async () => (await mgrActor()) as FinanceActor;
const receptionistActor = async () => (await recActor()) as FinanceActor;

beforeEach(resetBusinessData);
const NOW = eat("2026-10-05T10:00:00");
const WIDE = { from: "2026-01-01", to: "2027-12-31" };
const method = (code: string) => db.paymentMethod.findUniqueOrThrow({ where: { code }, include: { account: true } });
const balanceOf = async (code: string) => (await accountBalances()).find((a) => a.code === code)!.balance;

describe("general ledger & money accounts", () => {
  it("a stay is income once (night by night); payments are money in, never income again", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const r = await createReservation(
      { sourceCode: "PHONE", guest: { fullName: "Ledger Guest" }, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-12" }, rooms: [{ roomTypeId: dd.id, adults: 1, children: 0, discountPerNight: 0 }] },
      await receptionistActor(), NOW,
    );
    expect((await getLedger(WIDE)).totals.income).toBe(0); // booked, not yet earned
    await checkIn(r.id, await receptionistActor(), null, eat("2026-10-10T15:00:00"));
    const cash = await method("CASH");
    const bank = await method("BANK");
    await recordReservationPayment({ reservationId: r.id, amount: 100_000, methodId: cash.id }, await receptionistActor());
    await recordReservationPayment({ reservationId: r.id, amount: 60_000, methodId: bank.id }, await receptionistActor());

    const { rows, totals } = await getLedger(WIDE);
    expect(rows.filter((x) => x.source === "ROOM")).toHaveLength(2); // two nights, two hotel days
    expect(totals.income).toBe(160_000); // not 320,000
    expect(totals.moneyIn).toBe(160_000);
    expect(await balanceOf("CASH_DRAWER")).toBe(100_000);
    expect(await balanceOf("BANK")).toBe(60_000);
  });

  it("expenses leave their account; transfers move money without being income; reversals stop counting", async () => {
    const cash = await method("CASH");
    const cat = await db.expenseCategory.findFirstOrThrow();
    await recordExpense({ categoryId: cat.id, amount: 30_000, description: "Cleaning items", paymentMethodId: cash.id }, await receptionistActor());
    const mgr = await managerActor();
    const cashAcct = cash.account!;
    const bankAcct = await db.moneyAccount.findUniqueOrThrow({ where: { code: "BANK" } });
    await postMovement({ kind: "OWNER_CONTRIBUTION", amount: 500_000, accountId: cashAcct.id, description: "Float from the owner" }, mgr);
    const t = await postMovement({ kind: "TRANSFER", amount: 200_000, accountId: cashAcct.id, toAccountId: bankAcct.id, description: "Banked cash" }, mgr);
    expect(await balanceOf("CASH_DRAWER")).toBe(500_000 - 30_000 - 200_000);
    expect(await balanceOf("BANK")).toBe(200_000);
    const { totals } = await getLedger(WIDE);
    expect(totals.income).toBe(0);
    expect(totals.expense).toBe(30_000);

    await reverseMovement(t.id, "Wrong amount", mgr);
    expect(await balanceOf("BANK")).toBe(0);
    const again = await getLedger(WIDE);
    expect(again.rows.find((x) => x.reference === t.number)?.status).toBe("REVERSED"); // still visible
    await expect(postMovement({ kind: "OTHER_INCOME", amount: 1_000, accountId: cashAcct.id, description: "x" }, await receptionistActor())).rejects.toThrow(/Only Admin/);
  });

  it("a cash count shows the difference and Admin can correct the books", async () => {
    const mgr = await managerActor();
    const cashAcct = (await method("CASH")).account!;
    await postMovement({ kind: "OWNER_CONTRIBUTION", amount: 100_000, accountId: cashAcct.id, description: "Float" }, mgr);
    await expect(recordCashCount({ accountId: cashAcct.id, counted: 95_000 }, await receptionistActor())).rejects.toThrow(/short by TZS 5,000/);
    const c = await recordCashCount({ accountId: cashAcct.id, counted: 95_000, note: "Change given without receipt" }, await receptionistActor());
    expect(c.difference).toBe(-5_000);
    expect(c.status).toBe("OPEN");
    await reviewCashCount(c.id, { postCorrection: true }, mgr);
    expect(await balanceOf("CASH_DRAWER")).toBe(95_000);
  });

  it("correcting a paid expense cancels the old line and posts a new numbered one; cancelled lines can be reinstated", async () => {
    const cash = await method("CASH");
    const cat = await db.expenseCategory.findFirstOrThrow();
    const mgr = await managerActor();
    const e = await recordExpense({ categoryId: cat.id, amount: 30_000, description: "Gas refill", paymentMethodId: cash.id }, await receptionistActor());
    expect(e.number).toMatch(/^EXP-\d{4}-\d{6}$/);

    const fixed = await repostCorrectedExpense(e.id, { categoryId: cat.id, amount: 25_000, description: "Gas refill", paymentMethodId: cash.id }, "Amount typed wrong", mgr);
    expect(fixed.correctsId).toBe(e.id);
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("VOIDED");
    expect((await getLedger(WIDE)).totals.expense).toBe(25_000);
    expect(await balanceOf("CASH_DRAWER")).toBe(-25_000);

    // The old line cannot come back while its correction stands.
    await expect(reinstateExpense(e.id, mgr)).rejects.toThrow(/corrected by/);
    await voidExpense(fixed.id, "Wrong after all", mgr);
    await reinstateExpense(e.id, mgr);
    expect((await getLedger(WIDE)).totals.expense).toBe(30_000);
  });
});
