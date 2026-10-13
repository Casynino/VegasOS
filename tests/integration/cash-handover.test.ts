import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { recordSale } from "@/server/services/outlets";
import {
  handoverDetail, handoverTotals, previewHandover, receiveHandover, rejectHandover, resubmitHandover, returnHandover, submitHandover, whoHoldsCash, type HandoverActor,
} from "@/server/services/cash-handover";
import { resetBusinessData } from "../support/helpers";

beforeEach(resetBusinessData);

async function person(email: string, extra: string[] = [], without: string[] = []): Promise<HandoverActor> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  const codes = new Set([...u.role.permissions.map((p) => p.permission.code), ...extra]);
  for (const w of without) codes.delete(w);
  return { userId: u.id, label: u.fullName, permissions: codes };
}
/** Reception, with the right to hand cash over (the same set the Receptionist role carries). */
const asha = () => person("asha@vegas.test", ["cash.handover.submit"]);
/** The Accountant: receives and may accept a difference — never records a sale. */
const accountant = (extra: string[] = []) => person("manager@vegas.test", ["cash.handover.review", "cash.handover.discrepancy", ...extra]);

async function cashSale(actor: HandoverActor, amount: number, accountCode?: string) {
  const bar = await db.revenueCategory.findUniqueOrThrow({ where: { code: "BAR" } });
  const account = accountCode ? await db.moneyAccount.findUniqueOrThrow({ where: { code: accountCode } }) : null;
  const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
  return recordSale({ categoryId: bar.id, amount, ...(account ? { accountId: account.id } : { paymentMethodId: cash.id }) }, actor);
}
const rowCounts = async () => ({
  sales: await db.revenueTransaction.count(), payments: await db.payment.count(), ledger: await db.ledgerEntry.count(),
  salesTotal: (await db.revenueTransaction.aggregate({ _sum: { amount: true } }))._sum.amount ?? 0,
});

describe("cash handover — custody, not revenue", () => {
  it("hands over exactly the cash the person recorded, adds no revenue and cannot be sent twice", async () => {
    const reception = await asha();
    await cashSale(reception, 45_000);
    await cashSale(reception, 120_000);
    const mpesa = await db.moneyAccount.findFirst({ where: { kind: "MOBILE_MONEY", acceptsPayments: true, code: { not: "NTZS" } } });
    if (mpesa) await cashSale(reception, 80_000, mpesa.code); // mobile money is already in its own account: never part of the cash handover
    const before = await rowCounts();

    const preview = await previewHandover(reception.userId);
    expect(preview).toMatchObject({ collected: 165_000, refunds: 0, expected: 165_000, count: 2 });

    const h = await submitHandover({ declared: 165_000 }, reception);
    expect(h).toMatchObject({ status: "SUBMITTED", expected: 165_000, declared: 165_000, collected: 165_000, collectedCount: 2, department: "RECEPTION" });
    expect(h.number).toMatch(/^CH-\d{6}$/);
    // Custody only: no new sale, payment or ledger line, and the revenue is unchanged.
    expect(await rowCounts()).toEqual(before);
    expect((await db.cashHandoverEvent.findMany({ where: { handoverId: h.id } })).map((e) => e.kind)).toEqual(["SUBMITTED"]);
    expect(await db.auditLog.count({ where: { action: "cash_handover.submitted", entityId: h.id } })).toBe(1);

    // The same cash cannot be handed over again.
    await expect(submitHandover({ declared: 165_000 }, reception)).rejects.toThrow(/no cash to hand over/);
  });

  it("each handover starts where the last one ended", async () => {
    const reception = await asha();
    const boss = await accountant();
    await cashSale(reception, 50_000);
    const first = await submitHandover({ declared: 50_000 }, reception);
    await receiveHandover(first.id, { received: 50_000 }, boss);
    await cashSale(reception, 30_000);
    const preview = await previewHandover(reception.userId);
    expect(preview.expected).toBe(30_000);
    expect(preview.start.getTime()).toBe(first.periodEnd.getTime());
    const second = await submitHandover({ declared: 30_000 }, reception);
    expect(second.periodStart.getTime()).toBe(first.periodEnd.getTime());
  });

  it("a difference when handing over needs the person's explanation", async () => {
    const reception = await asha();
    await cashSale(reception, 100_000);
    await expect(submitHandover({ declared: 90_000 }, reception)).rejects.toThrow(/less than the cash recorded/);
    await expect(submitHandover({ declared: 90_000, note: "ok" }, reception)).rejects.toThrow(/less than the cash recorded/);
    const h = await submitHandover({ declared: 90_000, note: "10,000 given to the driver for fuel" }, reception);
    expect(h.declaredNote).toBe("10,000 given to the driver for fuel");
    expect(h.declared - h.expected).toBe(-10_000);
  });
});

describe("the Accountant receives it", () => {
  it("confirms the exact amount once; a second press is refused; guest payments and revenue stay as they are", async () => {
    const reception = await asha();
    const boss = await accountant();
    await cashSale(reception, 100_000);
    const h = await submitHandover({ declared: 100_000 }, reception);
    const before = await rowCounts();

    const done = await receiveHandover(h.id, { received: 100_000, note: "Counted with Asha" }, boss);
    expect(done).toMatchObject({ status: "ACCEPTED", received: 100_000, difference: 0, reviewedById: boss.userId, toAccountId: h.accountId, ledgerEntryId: null });
    expect(await rowCounts()).toEqual(before); // the same cash account: nothing is posted, nothing is added to revenue
    await expect(receiveHandover(h.id, { received: 100_000 }, boss)).rejects.toThrow(/not waiting to be received/);
    expect(await db.auditLog.count({ where: { action: "cash_handover.received", entityId: h.id } })).toBe(1);
  });

  it("two people pressing at once: only one wins", async () => {
    const reception = await asha();
    const boss = await accountant();
    const other = await person("owner@test.local", ["cash.handover.review", "cash.handover.discrepancy"]).catch(() => null);
    await cashSale(reception, 70_000);
    const h = await submitHandover({ declared: 70_000 }, reception);
    const second = other ?? (await person("admin@vegas.test", ["cash.handover.review", "cash.handover.discrepancy"]));
    const results = await Promise.allSettled([receiveHandover(h.id, { received: 70_000 }, boss), receiveHandover(h.id, { received: 70_000 }, second)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.cashHandover.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("ACCEPTED");
  });

  it("a short handover is recorded as it is — with the reason, the permission and an audit line — and nothing else changes", async () => {
    const reception = await asha();
    await cashSale(reception, 100_000);
    const h = await submitHandover({ declared: 100_000 }, reception);
    const before = await rowCounts();

    await expect(receiveHandover(h.id, { received: 92_000 }, await accountant())).rejects.toThrow(/short by TZS 8,000/);
    const clerk = await person("manager@vegas.test", ["cash.handover.review"]); // may receive, may not accept a difference
    await expect(receiveHandover(h.id, { received: 92_000, note: "Counted twice, 8,000 missing" }, clerk)).rejects.toThrow(/permission/);

    const done = await receiveHandover(h.id, { received: 92_000, note: "Counted twice, 8,000 missing" }, await accountant());
    expect(done).toMatchObject({ status: "ACCEPTED", expected: 100_000, declared: 100_000, received: 92_000, difference: -8_000 });
    expect(await rowCounts()).toEqual(before); // the books are corrected only by the existing flows, never automatically
    expect(await db.auditLog.count({ where: { action: "cash_handover.discrepancy", entityId: h.id } })).toBe(1);
    const totals = await handoverTotals("2000-01-01", "2999-12-31");
    expect(totals).toMatchObject({ receivedCount: 1, received: 92_000, short: 8_000, over: 0, withDifference: 1 });
  });

  it("cash received into another cash account posts a transfer — never revenue", async () => {
    const reception = await asha();
    const boss = await accountant();
    // Accounts are set-up data, not truncated between tests: reuse the one an earlier run made.
    const safe = await db.moneyAccount.upsert({
      where: { code: "TEST_SAFE" }, update: { isActive: true },
      create: { code: "TEST_SAFE", name: "Accountant safe", kind: "PETTY_CASH", acceptsPayments: false, acceptsExpenses: false },
    });
    await cashSale(reception, 60_000);
    const h = await submitHandover({ declared: 60_000 }, reception);
    const before = await rowCounts();
    const done = await receiveHandover(h.id, { received: 60_000, toAccountId: safe.id }, boss);
    const entry = await db.ledgerEntry.findUniqueOrThrow({ where: { id: done.ledgerEntryId! } });
    expect(entry).toMatchObject({ kind: "TRANSFER", amount: 60_000, accountId: h.accountId, toAccountId: safe.id });
    expect(await db.ledgerEntry.count()).toBe(before.ledger + 1);
    expect(await db.revenueTransaction.aggregate({ _sum: { amount: true } })).toMatchObject({ _sum: { amount: before.salesTotal } });
    // only a cash account can take the cash
    const bank = await db.moneyAccount.findFirstOrThrow({ where: { kind: "BANK", isActive: true } });
    await cashSale(reception, 10_000);
    const next = await submitHandover({ declared: 10_000 }, reception);
    await expect(receiveHandover(next.id, { received: 10_000, toAccountId: bank.id }, boss)).rejects.toThrow(/cash account/);
  });

  it("send back, correct, send again — and refuse only the latest one", async () => {
    const reception = await asha();
    const boss = await accountant();
    await cashSale(reception, 80_000);
    const h = await submitHandover({ declared: 80_000 }, reception);
    await expect(returnHandover(h.id, "no", boss)).rejects.toThrow(/at least 5 letters/);
    const back = await returnHandover(h.id, "Count again — a note is missing", boss);
    expect(back.status).toBe("RETURNED");
    await expect(receiveHandover(h.id, { received: 80_000 }, boss)).rejects.toThrow(/not waiting/);
    await expect(resubmitHandover(h.id, { declared: 80_000 }, await accountant())).rejects.toThrow(/permission/); // only the person's own, and only with the right to hand over

    const again = await resubmitHandover(h.id, { declared: 80_000 }, reception);
    expect(again).toMatchObject({ status: "SUBMITTED", reviewNote: null });
    expect((await db.cashHandoverEvent.findMany({ where: { handoverId: h.id }, orderBy: { createdAt: "asc" } })).map((e) => e.kind)).toEqual(["SUBMITTED", "RETURNED", "RESUBMITTED"]);

    await cashSale(reception, 20_000);
    const later = await submitHandover({ declared: 20_000 }, reception);
    await expect(rejectHandover(h.id, "Made by mistake", boss)).rejects.toThrow(/later handover/);
    const refused = await rejectHandover(later.id, "Made by mistake", boss);
    expect(refused.status).toBe("REJECTED");
    // its cash is "not handed over yet" again
    expect((await previewHandover(reception.userId)).expected).toBe(20_000);
    const detail = await handoverDetail(h.id);
    expect(detail?.events.map((e) => e.kind)).toEqual(["SUBMITTED", "RETURNED", "RESUBMITTED"]);
  });

  it("shows who still holds cash, and what waits to be received", async () => {
    const reception = await asha();
    await cashSale(reception, 40_000);
    let holders = await whoHoldsCash();
    expect(holders.find((p) => p.userId === reception.userId)).toMatchObject({ expected: 40_000, waitingCount: 0 });
    await submitHandover({ declared: 40_000 }, reception);
    holders = await whoHoldsCash();
    expect(holders.find((p) => p.userId === reception.userId)).toMatchObject({ expected: 0, waitingCount: 1, waitingAmount: 40_000 });
    expect(await handoverTotals("2000-01-01", "2999-12-31")).toMatchObject({ waitingCount: 1, waitingExpected: 40_000 });
  });
});

describe("who holds cash", () => {
  it("does not list the Accountant (or the Boss) as staff holding cash — they are the ones who receive it", async () => {
    // A real Accountant account (role ACCOUNTANT) — the Accountant may record a sale too.
    const role = await db.role.findUniqueOrThrow({ where: { code: "ACCOUNTANT" }, include: { permissions: { include: { permission: true } } } });
    const user = await db.user.upsert({
      where: { email: "accountant@test.local" }, update: { roleId: role.id, isActive: true },
      create: { email: "accountant@test.local", fullName: "Test Accountant", roleId: role.id, passwordHash: "x", mustChangePassword: false },
    });
    const accountantWhoRecords: HandoverActor = { userId: user.id, label: user.fullName, permissions: new Set(role.permissions.map((p) => p.permission.code)) };
    await cashSale(accountantWhoRecords, 33_000);
    expect(await db.revenueTransaction.count({ where: { recordedById: user.id } })).toBe(1);
    expect((await whoHoldsCash()).find((p) => p.userId === user.id)).toBeUndefined();
    const reception = await asha();
    await cashSale(reception, 12_000);
    expect((await whoHoldsCash()).find((p) => p.userId === reception.userId)).toMatchObject({ expected: 12_000 });
  });
});

describe("who may do what — checked on the server", () => {
  it("a waiter cannot hand cash over, and nobody receives their own handover", async () => {
    const reception = await asha();
    await cashSale(reception, 25_000);
    const waiter = await person("waiter@vegas.test");
    await expect(submitHandover({ declared: 0 }, waiter)).rejects.toThrow(/permission/);
    const h = await submitHandover({ declared: 25_000 }, reception);
    // reception cannot receive; an Accountant who is also the submitter cannot receive their own
    await expect(receiveHandover(h.id, { received: 25_000 }, reception)).rejects.toThrow(/permission/);
    const selfReviewer = { ...reception, permissions: new Set([...reception.permissions, "cash.handover.review"]) };
    await expect(receiveHandover(h.id, { received: 25_000 }, selfReviewer)).rejects.toThrow(/own handover/);
    await expect(returnHandover(h.id, "Not mine to judge", selfReviewer)).rejects.toThrow(/own handover/);
  });

  it("an amount must be a whole, non-negative number", async () => {
    const reception = await asha();
    await cashSale(reception, 10_000);
    await expect(submitHandover({ declared: -1 }, reception)).rejects.toThrow(/whole number/);
    await expect(submitHandover({ declared: 10.5 }, reception)).rejects.toThrow(/whole number/);
  });
});
