import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { recordExpense, voidExpense } from "@/server/services/expenses";
import { correctSaleAccount, recordSale } from "@/server/services/outlets";
import { incomeRows, payingParties } from "@/server/services/income";
import { checkIn } from "@/server/services/reservations";
import { accountActivity, accountOptions, accountSummaries, savePaymentAccount, sumIn, sumOut } from "@/server/services/payment-accounts";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);
afterEach(async () => {
  await db.moneyAccount.deleteMany({ where: { code: { startsWith: "TEST_" } } });
  await db.moneyAccount.updateMany({ where: { code: { in: ["NMB_BANK", "PETTY_CASH"] } }, data: { isActive: true } });
});

/** Expense services take the staff member's role too (for the approval rules). */
async function staff(email: string) {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) as ReadonlySet<string>, roleCode: u.role.code };
}
const account = (code: string) => db.moneyAccount.findUniqueOrThrow({ where: { code } });

async function booking() {
  const dd = await roomType("DOUBLE_DELUXE");
  return createReservation({
    sourceCode: "PHONE", guest: { fullName: "John" }, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-12" },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await receptionistActor(), new Date("2026-10-05T07:00:00Z"));
}

describe("payment accounts", () => {
  it("the official accounts are configured with their details (not hard-coded in forms)", async () => {
    const opts = await accountOptions("payments");
    const by = Object.fromEntries(opts.map((o) => [o.name, o]));
    expect(by["Cash"]).toMatchObject({ kind: "CASH", number: null });
    expect(by["LIPA Mix by Yas"]).toMatchObject({ kind: "MOBILE_MONEY", number: "17860396", holder: "Vegas Luxury Hotel" });
    expect(by["Lipa M-Pesa"]).toMatchObject({ kind: "MOBILE_MONEY", number: "51112197", holder: "BMAX LOUNGE" });
    expect(by["CRDB Bank"]).toMatchObject({ kind: "BANK", number: "015C799490700", holder: "VEGAS LUXURY HOTEL" });
    expect(by["NMB Bank"]).toMatchObject({ kind: "BANK", number: "20710035155", holder: "Mohamed Nassor Mbarack" });
    expect(opts.map((o) => o.name)).not.toContain("Petty cash"); // pays expenses only
    expect((await accountOptions("expenses")).map((o) => o.name)).toContain("Petty cash");
  });

  it("reception only picks the account: the payment links to it and the method follows", async () => {
    const r = await booking();
    const crdb = await account("BANK");
    await recordReservationPayment({ reservationId: r.id, amount: 100_000, accountId: crdb.id }, await receptionistActor());
    const p = await db.payment.findFirstOrThrow({ where: { reservationId: r.id }, include: { method: true, account: true } });
    expect(p).toMatchObject({ amount: 100_000, accountId: crdb.id });
    expect(p.method.code).toBe("BANK");
    expect(p.account.accountNumber).toBe("015C799490700");
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: p.id, action: "payment.created" } });
    expect(JSON.stringify(log.after)).toContain("CRDB Bank");
  });

  it("inactive or wrong-purpose accounts are refused by the server", async () => {
    const r = await booking();
    const nmb = await account("NMB_BANK");
    await db.moneyAccount.update({ where: { id: nmb.id }, data: { isActive: false } });
    await expect(recordReservationPayment({ reservationId: r.id, amount: 50_000, accountId: nmb.id }, await receptionistActor())).rejects.toThrow(/not active/);
    await expect(recordReservationPayment({ reservationId: r.id, amount: 50_000 }, await receptionistActor())).rejects.toThrow(/Choose where/);
    const petty = await account("PETTY_CASH");
    await expect(recordReservationPayment({ reservationId: r.id, amount: 50_000, accountId: petty.id }, await receptionistActor())).rejects.toThrow(/does not receive payments/);
    const card = await account("CARD");
    const cat = await db.expenseCategory.findUniqueOrThrow({ where: { code: "FOOD" } });
    await expect(recordExpense({ categoryId: cat.id, amount: 10_000, description: "Tomatoes", accountId: card.id }, await staff("asha@vegas.test"))).rejects.toThrow(/not used to pay expenses/);
    await expect(recordExpense({ categoryId: cat.id, amount: 10_000, description: "Tomatoes" }, await staff("asha@vegas.test"))).rejects.toThrow(/paid from/);
  });

  it("each account shows money in and money out with who recorded it; totals come from transactions", async () => {
    const r = await booking();
    const crdb = await account("BANK");
    const mpesa = await account("LIPA_MPESA");
    const asha = await receptionistActor();
    await recordReservationPayment({ reservationId: r.id, amount: 100_000, accountId: crdb.id }, asha);
    const bar = await db.revenueCategory.findUniqueOrThrow({ where: { code: "BAR" } });
    await recordSale({ categoryId: bar.id, amount: 80_000, accountId: mpesa.id }, asha);
    const cat = await db.expenseCategory.findUniqueOrThrow({ where: { code: "UTILITIES" } });
    await recordExpense({ categoryId: cat.id, amount: 150_000, description: "Electricity", accountId: crdb.id }, await staff("manager@vegas.test"));

    const today = businessDateOf(new Date());
    const rows = await accountActivity(crdb.id, "2026-01-01", "2027-12-31");
    expect(rows.map((x) => [x.type, x.amount])).toEqual(expect.arrayContaining([["ROOM", 100_000], ["EXPENSE", -150_000]]));
    const room = rows.find((x) => x.type === "ROOM")!;
    expect(room.party).toBe("John");
    expect(room.byId).toBe(asha.userId);
    expect(room.reference).toContain(r.reference);
    expect(sumIn(rows)).toBe(100_000);
    expect(sumOut(rows)).toBe(150_000);

    const sums = await accountSummaries(today, today);
    const s = Object.fromEntries(sums.map((a) => [a.code, a]));
    expect(s.BANK).toMatchObject({ moneyIn: 100_000, moneyOut: 150_000, count: 2, received: 100_000 });
    expect(s.LIPA_MPESA).toMatchObject({ moneyIn: 80_000, received: 80_000, count: 1 });
    expect(s.CASH_DRAWER.moneyIn).toBe(0);
  });

  it("admin adds / edits / deactivates accounts — never deletes; history stays linked", async () => {
    const admin = { userId: (await db.user.findUniqueOrThrow({ where: { email: "admin@vegas.test" } })).id, label: "Admin" };
    await expect(savePaymentAccount({ name: "crdb bank", kind: "BANK", acceptsPayments: true, acceptsExpenses: true, isActive: true }, admin)).rejects.toThrow(/already an account/);
    const acc = await savePaymentAccount({ name: "Test Exim", kind: "BANK", accountNumber: "0200", holderName: "VEGAS", acceptsPayments: true, acceptsExpenses: false, isActive: true }, admin);
    await db.moneyAccount.update({ where: { id: acc.id }, data: { code: "TEST_EXIM" } });
    expect((await accountOptions("payments")).map((a) => a.name)).toContain("Test Exim");
    expect((await accountOptions("expenses")).map((a) => a.name)).not.toContain("Test Exim");

    const r = await booking();
    await recordReservationPayment({ reservationId: r.id, amount: 20_000, accountId: acc.id }, await receptionistActor());
    await savePaymentAccount({ id: acc.id, name: "Test Exim", kind: "BANK", accountNumber: "0200", acceptsPayments: true, acceptsExpenses: false, isActive: false }, admin);
    expect((await accountOptions("payments")).map((a) => a.name)).not.toContain("Test Exim");
    expect(await db.payment.count({ where: { accountId: acc.id } })).toBe(1); // history kept
    expect(await db.auditLog.count({ where: { entityId: acc.id, action: { startsWith: "payment_account." } } })).toBe(2);
    await db.payment.deleteMany({ where: { accountId: acc.id } });
  });

  it("staff may cancel their own expense on the same day; it stays, struck through", async () => {
    const cat = await db.expenseCategory.findUniqueOrThrow({ where: { code: "FOOD" } });
    // Someone who records expenses but cannot void them (reception no longer records expenses — a clerk role).
    const asha = await staff("asha@vegas.test");
    const clerk = { ...asha, permissions: new Set([...asha.permissions, "expenses.record"]) as ReadonlySet<string> };
    const e = await recordExpense({ categoryId: cat.id, amount: 12_000, description: "Onions", accountId: "acct_cash" }, clerk);
    await voidExpense(e.id, "Recorded twice", clerk);
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("VOIDED");
  });

  it("income lists every source; a sale's account can be corrected (amount locked, audited)", async () => {
    const r = await booking();
    const asha = await receptionistActor();
    await recordReservationPayment({ reservationId: r.id, amount: 50_000, accountId: (await account("BANK")).id }, asha);
    const bar = await db.revenueCategory.findUniqueOrThrow({ where: { code: "BAR" } });
    const sale = await recordSale({ categoryId: bar.id, amount: 30_000, accountId: "acct_cash" }, asha);
    const today = businessDateOf(new Date());
    const rows = await incomeRows(today, today);
    expect(rows.map((x) => [x.source, x.amount, x.account.name])).toEqual(expect.arrayContaining([["ROOM", 50_000, "CRDB Bank"], ["BAR", 30_000, "Cash"]]));

    const mpesa = await account("LIPA_MPESA");
    await correctSaleAccount({ id: sale.id, accountId: mpesa.id }, asha);
    const after = await db.revenueTransaction.findUniqueOrThrow({ where: { id: sale.id } });
    expect(after).toMatchObject({ accountId: mpesa.id, amount: 30_000 });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: sale.id, action: "revenue.account_corrected" } });
    expect(JSON.stringify(log.before)).toContain("Cash");
    expect(JSON.stringify(log.after)).toContain("Lipa M-Pesa");
    await expect(correctSaleAccount({ id: sale.id, accountId: mpesa.id }, asha)).rejects.toThrow(/Nothing changed/);
  });

  it("who can pay: guests in the hotel (even paid up, to add to their bill) and who owes, urgent first", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const today = businessDateOf(new Date());
    const asha = await receptionistActor();
    const stay = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Leaving Today" }, stay: { kind: "overnight", arrivalDate: addDays(today, -1), departureDate: today },
      rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[1].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, await managerActor(), zonedInstant(addDays(today, -1), 12 * 60, "Africa/Dar_es_Salaam"));
    await checkIn(stay.id, await managerActor(), null, zonedInstant(addDays(today, -1), 15 * 60, "Africa/Dar_es_Salaam"));
    const parties = await payingParties(today);
    const p = parties.find((x) => x.id === stay.id)!;
    expect(p).toMatchObject({ kind: "STAY", tag: "Leaving today", urgent: true });
    expect(p.owes).toBeGreaterThan(0);
    expect(parties[0].urgent).toBe(true);
    await recordReservationPayment({ reservationId: stay.id, amount: p.owes, accountId: "acct_cash" }, asha);
    const again = (await payingParties(today)).find((x) => x.id === stay.id)!;
    expect(again).toMatchObject({ owes: 0, kind: "STAY" }); // still listed: things can be added to the bill
  });
});

