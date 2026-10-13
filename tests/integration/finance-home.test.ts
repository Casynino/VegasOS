import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation, cancelReservation } from "@/server/services/reservations";
import { bookingActivity, financeNeeds, restaurantDiscounts, supplierSnapshot } from "@/server/services/finance-home";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { eat, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

/** Finance's Home: what needs Finance (by right), the suppliers' side and how the bookings behave. */
beforeEach(resetBusinessData);

const perms = (code: keyof typeof DEFAULT_ROLES) => new Set<string>(DEFAULT_ROLES[code].permissions);
// 06:00 in the hotel — before the daily report is due, so "the report was not made" is not part of these scenarios.
const EARLY = new Date("2026-10-16T03:00:00Z");
const TODAY = "2026-10-16";

describe("what needs Finance", () => {
  it("a quiet hotel has nothing waiting", async () => {
    expect(await financeNeeds(TODAY, perms("FINANCE"), EARLY)).toEqual([]);
  });

  it("a supplier invoice past its due date and a disputed one are listed — only for those who may act on them", async () => {
    const supplier = await db.supplier.create({ data: { name: "Mwenge Furniture (home test)" } });
    const user = await db.user.findFirstOrThrow({ where: { isActive: true } });
    const request = await db.stockRequest.create({ data: { number: "SR-2026-9990", department: "RECEPTION", status: "ORDERED", requestedById: user.id, orderNumber: "PO-2026-9990" } });
    const invoice = (number: string, status: string, amount: number, paid: number, dueOn: string) => db.supplierInvoice.create({
      data: { requestId: request.id, number, supplierId: supplier.id, amount, paidAmount: paid, status, invoiceDate: new Date("2026-10-01T00:00:00Z"), dueOn: new Date(`${dueOn}T00:00:00Z`), recordedById: user.id },
    });
    await invoice("INV-LATE", "VERIFIED", 400_000, 100_000, "2026-10-10");   // 300,000 still owed, 6 days late
    await invoice("INV-NOW", "RECEIVED", 50_000, 0, "2026-10-30");           // not late
    await invoice("INV-DISPUTE", "DISPUTED", 80_000, 0, "2026-10-29");       // disputed, not late
    await invoice("INV-PAID", "PAID", 70_000, 70_000, "2026-10-01");         // paid: never listed

    const snapshot = await supplierSnapshot(TODAY);
    expect(snapshot.overdue).toEqual({ count: 1, amount: 300_000 });
    expect(snapshot.disputed).toBe(1);
    expect(snapshot.owed).toEqual({ count: 3, amount: 300_000 + 50_000 + 80_000 });
    expect(snapshot.top[0]).toEqual({ name: "Mwenge Furniture (home test)", amount: 430_000 });

    const finance = await financeNeeds(TODAY, perms("FINANCE"), EARLY);
    expect(finance.map((n) => n.kind)).toEqual(["supplierOverdue", "supplierDisputed", "verify", "pay"]);
    expect(finance.find((n) => n.kind === "supplierOverdue")).toMatchObject({ tone: "rose", count: 1, amount: 300_000, href: "/staff/procurement?tab=invoices" });
    expect(finance.find((n) => n.kind === "pay")).toMatchObject({ count: 1, amount: 300_000 });
    expect(finance.find((n) => n.kind === "verify")).toMatchObject({ count: 1, amount: 50_000 });
    // the most urgent first: money at risk, then decisions
    expect(finance.map((n) => n.tone)).toEqual(["rose", "rose", "amber", "amber"]);
    // the Accountant and reception cannot pay, so nothing about paying is shown to them
    expect(await financeNeeds(TODAY, perms("ACCOUNTANT"), EARLY)).toEqual([]);
    expect(await financeNeeds(TODAY, perms("RECEPTIONIST"), EARLY)).toEqual([]);
  });

  it("a cash count with a difference is Finance's — and only for those who may see accounts", async () => {
    const user = await db.user.findFirstOrThrow({ where: { isActive: true } });
    const cash = await db.moneyAccount.findFirstOrThrow({ where: { kind: "CASH", isActive: true } });
    await db.cashCount.create({ data: { accountId: cash.id, countedById: user.id, businessDate: new Date(`${TODAY}T00:00:00Z`), expected: 100_000, counted: 90_000, difference: -10_000, status: "OPEN" } });
    const finance = await financeNeeds(TODAY, perms("FINANCE"), EARLY);
    expect(finance.map((n) => n.kind)).toContain("cashCount");
    expect(finance.find((n) => n.kind === "cashCount")?.href).toBe("/staff/finance/accounts");
    // reception and the Accountant hold no right to the accounts: the card is not made for them
    expect(await financeNeeds(TODAY, perms("RECEPTIONIST"), EARLY)).toEqual([]);
    expect(await financeNeeds(TODAY, perms("ACCOUNTANT"), EARLY)).toEqual([]);
  });
});

describe("bookings", () => {
  it("counts the bookings made each day and by channel, with what became of them", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const desk = await receptionistActor();
    const book = (sourceCode: string, room: string, from: string, to: string, name: string, at: string) => createReservation({
      sourceCode, guest: { fullName: name }, stay: { kind: "overnight", arrivalDate: from, departureDate: to },
      rooms: [{ roomTypeId: dd.id, roomId: dd.rooms.find((x) => x.number === room)!.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, desk, eat(at));
    await book("PHONE", "204", "2026-10-20", "2026-10-22", "Guest One", "2026-10-14T10:00:00");
    await book("PHONE", "205", "2026-10-21", "2026-10-23", "Guest Two", "2026-10-14T11:00:00");
    const three = await book("WALK_IN", "206", "2026-10-22", "2026-10-24", "Guest Three", "2026-10-15T09:00:00");
    await cancelReservation(three.id, await managerActor(), "Plans changed");

    const a = await bookingActivity({ from: "2026-10-13", to: "2026-10-16" });
    expect(a.made).toBe(3);
    expect(a.series.map((d) => [d.date, d.value])).toEqual([["2026-10-13", 0], ["2026-10-14", 2], ["2026-10-15", 1], ["2026-10-16", 0]]);
    const phone = a.sources.find((s) => s.name === "Phone")!;
    expect(phone).toMatchObject({ made: 2, cancelled: 0, noShow: 0, arrived: 0, waiting: 2 });
    const walkIn = a.sources.find((s) => s.name === "Walk-in")!;
    expect(walkIn).toMatchObject({ made: 1, cancelled: 1, waiting: 0 });
    expect(a.cancelled).toBe(1);
    expect(a.sources[0].name).toBe("Phone"); // the busiest channel first
    // a range with no bookings is all zeros, not an error
    expect((await bookingActivity({ from: "2026-11-01", to: "2026-11-03" })).made).toBe(0);
  });

  it("restaurant discounts: only discounted orders of the period, cancelled ones left out, counted once", async () => {
    expect(await restaurantDiscounts({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ count: 0, amount: 0 });
    const order = (number: string, status: "COMPLETED" | "CANCELLED", discountAmount: number, businessDate: string) => db.restaurantOrder.create({
      data: { number, type: "DINE_IN", status, settlement: "PAY_NOW", foodSubtotal: 20_000, drinksSubtotal: 0, total: 20_000 - discountAmount, discountAmount, businessDate: new Date(`${businessDate}T00:00:00Z`) },
    });
    await order("ORD-2026-900001", "COMPLETED", 2_000, "2026-10-10");
    await order("ORD-2026-900002", "COMPLETED", 3_000, "2026-10-12");
    await order("ORD-2026-900003", "CANCELLED", 9_000, "2026-10-12");   // cancelled: never counted
    await order("ORD-2026-900004", "COMPLETED", 0, "2026-10-12");       // no discount
    await order("ORD-2026-900005", "COMPLETED", 7_000, "2026-11-02");   // another period
    expect(await restaurantDiscounts({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ count: 2, amount: 5_000 });
    expect(await restaurantDiscounts({ from: "2026-10-12", to: "2026-10-12" })).toEqual({ count: 1, amount: 3_000 });
  });
});
