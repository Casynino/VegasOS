import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation } from "@/server/services/reservations";
import { owedToHotel, dailyMoney } from "@/server/services/reporting";
import { closedDays, monthlyTrend, receivablesAging, recentSpend } from "@/server/services/finance-outlook";
import { supplierSnapshot } from "@/server/services/finance-home";
import { eat, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/** What Finance reads to look ahead: how late the debts are, how fast money goes, the last six months, when suppliers fall due. */
beforeEach(resetBusinessData);

const TODAY = "2026-10-16";
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function stay(index: number, status: "CHECKED_IN" | "CHECKED_OUT", departure: string, balance: number) {
  const dd = await roomType("DOUBLE_DELUXE");
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: `Owing guest ${index}` }, stay: { kind: "overnight", arrivalDate: "2026-10-20", departureDate: "2026-10-22" },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[index].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await receptionistActor(), eat("2026-10-14T10:00:00"));
  await db.reservation.update({ where: { id: r.id }, data: { status, balanceAmount: balance, departureDate: day(departure) } });
}

describe("who owes the hotel, and how late", () => {
  it("each bill falls into its row by how late it is, and the rows add up to the figure of 'still owed'", async () => {
    const user = await db.user.findFirstOrThrow({ where: { isActive: true } });
    await stay(0, "CHECKED_IN", "2026-10-18", 100_000);   // still staying: not late
    await stay(1, "CHECKED_OUT", "2026-10-16", 15_000);   // left today: not late yet
    await stay(2, "CHECKED_OUT", "2026-10-14", 50_000);   // 2 days late
    await stay(3, "CHECKED_OUT", "2026-10-01", 30_000);   // 15 days late
    await stay(4, "CHECKED_OUT", "2026-08-01", 20_000);   // 76 days late
    const invoice = (number: string, due: string | null, balance: number, status: "ISSUED" | "PAID" = "ISSUED") => db.invoice.create({
      data: { number, status, createdById: user.id, netAmount: balance, balanceAmount: status === "PAID" ? 0 : balance, dueDate: due ? day(due) : null },
    });
    await invoice("INV-LATE", "2026-10-10", 40_000);    // 6 days late
    await invoice("INV-SOON", "2026-10-20", 10_000);    // not due
    await invoice("INV-NODATE", null, 5_000);           // no date: not late
    await invoice("INV-PAID", "2026-09-01", 99_000, "PAID"); // paid: never counted
    const order = (number: string, settlement: "PAY_NOW" | "ROOM" | "UNPAID", status: "COMPLETED" | "CANCELLED", total: number, paid: number, on: string) => db.restaurantOrder.create({
      data: { number, type: "DINE_IN", status, settlement, foodSubtotal: total, drinksSubtotal: 0, total, paidAmount: paid, businessDate: day(on) },
    });
    await order("ORD-2026-910001", "UNPAID", "COMPLETED", 25_000, 5_000, "2026-10-16");   // 20,000 today: not late
    await order("ORD-2026-910002", "UNPAID", "COMPLETED", 12_000, 0, "2026-10-01");       // 12,000, 15 days
    await order("ORD-2026-910003", "ROOM", "COMPLETED", 80_000, 0, "2026-10-10");         // on a room bill: counted with the stay, not here
    await order("ORD-2026-910004", "PAY_NOW", "COMPLETED", 30_000, 30_000, "2026-10-10"); // paid
    await order("ORD-2026-910005", "UNPAID", "CANCELLED", 50_000, 0, "2026-10-10");       // cancelled

    const aging = await receivablesAging(TODAY);
    const by = Object.fromEntries(aging.rows.map((r) => [r.bucket, r]));
    expect(by.current).toEqual({ bucket: "current", count: 5, amount: 100_000 + 15_000 + 10_000 + 5_000 + 20_000 });
    expect(by.week).toEqual({ bucket: "week", count: 2, amount: 50_000 + 40_000 });
    expect(by.month).toEqual({ bucket: "month", count: 2, amount: 30_000 + 12_000 });
    expect(by.older).toEqual({ bucket: "older", count: 1, amount: 20_000 });
    expect(aging.lateOverWeek).toEqual({ count: 3, amount: 30_000 + 12_000 + 20_000 });
    // the same bills as "Still owed": one figure, never two
    expect(aging.total).toBe(await owedToHotel());
    expect(aging.rows.map((r) => r.bucket)).toEqual(["current", "week", "month", "older"]);
  });

  it("a hotel owed nothing has four empty rows and a zero total", async () => {
    const aging = await receivablesAging(TODAY);
    expect(aging.total).toBe(0);
    expect(aging.rows.every((r) => r.amount === 0 && r.count === 0)).toBe(true);
  });
});

describe("how fast the money goes", () => {
  async function spend(amount: number, on: string, status: "RECORDED" | "PENDING_APPROVAL" | "VOIDED" = "RECORDED") {
    const user = await db.user.findFirstOrThrow({ where: { isActive: true } });
    const category = await db.expenseCategory.findFirstOrThrow();
    await db.expense.create({ data: { categoryId: category.id, amount, businessDate: day(on), description: "test spend", status, createdById: user.id } });
  }

  it("is the recorded spending of the closed days — today, voided and waiting expenses left out", async () => {
    await spend(300_000, "2026-10-01");
    await spend(100_000, "2026-10-15");
    await spend(500_000, "2026-10-16");                       // today: not over, not counted
    await spend(900_000, "2026-10-10", "PENDING_APPROVAL");   // not approved: not counted
    await spend(800_000, "2026-10-10", "VOIDED");             // voided: never counted
    await spend(700_000, "2026-08-01");                       // before the window
    const pace = (await recentSpend(TODAY, null))!;
    expect(pace).toMatchObject({ from: "2026-09-16", to: "2026-10-15", days: 30, total: 400_000 });
    expect(pace.perDay).toBeCloseTo(400_000 / 30);
  });

  it("never reaches back before the records began, and says nothing before a day has closed", async () => {
    await spend(300_000, "2026-10-01");
    await spend(100_000, "2026-10-15");
    expect(await recentSpend(TODAY, "2026-10-12")).toMatchObject({ from: "2026-10-12", days: 4, total: 100_000 });
    expect(await recentSpend(TODAY, TODAY)).toBeNull();
  });
});

describe("the last six months", () => {
  it("groups the day-by-day money by month; a month equals the sum of its days", async () => {
    const trend = await monthlyTrend(TODAY, null, 6);
    expect(trend.months.map((m) => m.key)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    const days = await dailyMoney({ from: "2026-05-01", to: TODAY });
    expect(trend.daily).toHaveLength(days.length);
    for (const m of trend.months) {
      const mine = days.filter((d) => d.date.startsWith(m.key));
      expect(m.income).toBe(mine.reduce((s, d) => s + d.income, 0));
      expect(m.expenses).toBe(mine.reduce((s, d) => s + d.expenses, 0));
    }
  });

  it("a month's earned is net of refunds, as the Earned tile is — money given back is not earned", async () => {
    const user = await db.user.findFirstOrThrow({ where: { isActive: true } });
    const method = await db.paymentMethod.findFirstOrThrow();
    const account = await db.moneyAccount.findFirstOrThrow({ where: { isActive: true } });
    await db.payment.create({ data: { kind: "REFUND", status: "POSTED", amount: 30_000, methodId: method.id, accountId: account.id, businessDate: day("2026-10-10"), recordedById: user.id } });
    await db.payment.create({ data: { kind: "REFUND", status: "POSTED", amount: 5_000, methodId: method.id, accountId: account.id, businessDate: day("2026-09-30"), recordedById: user.id } });
    const days = await dailyMoney({ from: "2026-05-01", to: TODAY });
    const sum = (key: string) => days.filter((d) => d.date.startsWith(key)).reduce((s, d) => s + d.income, 0);
    const trend = await monthlyTrend(TODAY, null, 6);
    expect(trend.months.find((m) => m.key === "2026-10")!.income).toBe(sum("2026-10") - 30_000);
    expect(trend.months.find((m) => m.key === "2026-09")!.income).toBe(sum("2026-09") - 5_000);
    expect(trend.months.find((m) => m.key === "2026-08")!.income).toBe(sum("2026-08"));
  });

  it("starts at the day the records began, and is empty before it", async () => {
    expect((await monthlyTrend(TODAY, "2026-10-12", 6)).months.map((m) => m.key)).toEqual(["2026-10"]);
    expect((await monthlyTrend("2026-10-01", "2026-10-12", 6)).months).toEqual([]);
  });

  it("the pattern of the week reads only closed days of the last weeks", () => {
    const rows = [{ date: "2026-08-01" }, { date: "2026-09-01" }, { date: "2026-10-15" }, { date: "2026-10-16" }, { date: "2026-10-17" }];
    expect(closedDays(rows, TODAY, 8).map((r) => r.date)).toEqual(["2026-09-01", "2026-10-15"]);
  });
});

describe("when suppliers fall due", () => {
  it("each open invoice is in one row by its due date, the rows add up to what is owed, and the next ones come soonest first", async () => {
    const supplier = await db.supplier.create({ data: { name: "Due Test Supplies" } });
    const user = await db.user.findFirstOrThrow({ where: { isActive: true } });
    const request = await db.stockRequest.create({ data: { number: "SR-2026-9991", department: "RECEPTION", status: "ORDERED", requestedById: user.id, orderNumber: "PO-2026-9991" } });
    const invoice = (number: string, status: string, amount: number, paid: number, due: string | null) => db.supplierInvoice.create({
      data: { requestId: request.id, number, supplierId: supplier.id, amount, paidAmount: paid, status, invoiceDate: day("2026-10-01"), dueOn: due ? day(due) : null, recordedById: user.id },
    });
    await invoice("D-LATE", "VERIFIED", 400_000, 100_000, "2026-10-10");   // 300,000 owed, 6 days late
    await invoice("D-WEEK", "RECEIVED", 50_000, 0, "2026-10-20");          // within a week
    await invoice("D-MONTH", "RECEIVED", 60_000, 0, "2026-11-05");         // 20 days
    await invoice("D-LATER", "RECEIVED", 70_000, 0, "2026-12-30");         // later
    await invoice("D-NODATE", "DISPUTED", 80_000, 0, null);                // no date
    await invoice("D-PAID", "PAID", 90_000, 90_000, "2026-10-01");         // paid: never listed

    const s = await supplierSnapshot(TODAY);
    const due = Object.fromEntries(s.due.map((r) => [r.bucket, r]));
    expect(due.overdue).toEqual({ bucket: "overdue", count: 1, amount: 300_000 });
    expect(due.week).toEqual({ bucket: "week", count: 1, amount: 50_000 });
    expect(due.month).toEqual({ bucket: "month", count: 1, amount: 60_000 });
    expect(due.later).toEqual({ bucket: "later", count: 1, amount: 70_000 });
    expect(due.none).toEqual({ bucket: "none", count: 1, amount: 80_000 });
    expect(s.due.reduce((a, r) => a + r.amount, 0)).toBe(s.owed.amount);
    // overdue figure is unchanged by the new rows
    expect(s.overdue).toEqual({ count: 1, amount: 300_000 });
    expect(s.next.map((n) => n.number)).toEqual(["D-LATE", "D-WEEK", "D-MONTH", "D-LATER"]);   // no date: not in the list of dates
    expect(s.next[0]).toMatchObject({ supplier: "Due Test Supplies", owed: 300_000, late: true, disputed: false });
    expect(s.next[1].late).toBe(false);
  });
});
