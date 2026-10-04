import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation, checkIn } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { recordExpense } from "@/server/services/expenses";
import { recordSale } from "@/server/services/outlets";
import { createInvoiceForReservation, issueInvoice } from "@/server/services/invoices";
import { occupancy, profitLoss, revenue } from "@/server/services/reporting";
import { buildDailyReport, renderReportText } from "@/server/services/daily-report";
import { eat, managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);
const NOW = eat("2026-10-05T10:00:00");

async function staff(email: string) {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) as ReadonlySet<string>, roleCode: u.role.code };
}

describe("financial source of truth", () => {
  it("revenue, discounts, occupancy, expenses and profit agree", async () => {
    const mgr = await managerActor();
    const dd = await roomType("DOUBLE_DELUXE");
    const ex = await roomType("EXECUTIVE");
    // Two rooms on 10 Oct: DD 80k−20k, EX 100k−20k → gross 180k, discount 40k, net 140k
    const booked = await createReservation({ sourceCode: "WEBSITE", guest: { fullName: "A" }, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-11" },
      rooms: [{ roomTypeId: dd.id, adults: 1, children: 0 }, { roomTypeId: ex.id, adults: 1, children: 0 }] }, mgr, NOW);
    const day = { from: "2026-10-10", to: "2026-10-10" };
    // A booked night is only a price: no income until the guest checks in.
    expect((await revenue(day)).rooms.net).toBe(0);
    await checkIn(booked.id, mgr, null, eat("2026-10-10T15:00:00"));
    const rev = await revenue(day);
    expect(rev.rooms).toMatchObject({ gross: 180_000, discount: 40_000, net: 140_000, roomsSold: 2 });
    expect(rev.bySource[0]).toMatchObject({ name: "Website", net: 140_000 });
    const occ = await occupancy(day);
    expect(occ.roomNights).toBe(2);
    expect(occ.occupancy).toBeCloseTo((2 / 31) * 100, 5);

    // Maintenance block reduces sellable inventory for occupancy.
    const twin = await roomType("TWIN");
    await db.roomBlock.create({ data: { roomId: twin.rooms[0].id, type: "MAINTENANCE", startDate: new Date("2026-10-10T00:00:00Z"), endDate: new Date("2026-10-11T00:00:00Z") } });
    expect((await occupancy(day)).sellableNights).toBe(30);
  });

  it("profit = net revenue − counted expenses, including restaurant & bar, today", async () => {
    const asha = await staff("asha@vegas.test");
    const mgr = await staff("manager@vegas.test");
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    const bar = await db.revenueCategory.findUniqueOrThrow({ where: { code: "BAR" } });
    const rest = await db.revenueCategory.findUniqueOrThrow({ where: { code: "RESTAURANT" } });
    await recordSale({ categoryId: bar.id, amount: 45_000, paymentMethodId: cash.id }, asha);
    await recordSale({ categoryId: rest.id, amount: 120_000, paymentMethodId: cash.id }, asha);
    const cat = await db.expenseCategory.findUniqueOrThrow({ where: { code: "FOOD" } });
    await recordExpense({ categoryId: cat.id, amount: 30_000, description: "Vegetables", accountId: "acct_cash" }, asha);
    const pending = await recordExpense({ categoryId: cat.id, amount: 900_000, description: "Big order", accountId: "acct_cash" }, asha); // needs approval → not counted
    expect(pending.status).toBe("PENDING_APPROVAL");
    const today = (await import("@/lib/time/business-date")).businessDateOf(new Date());
    const pl = await profitLoss({ from: today, to: today });
    expect(pl.revenue.bar).toBe(45_000);
    expect(pl.revenue.restaurant).toBe(120_000);
    expect(pl.netRevenue).toBe(165_000);
    expect(pl.expenses).toBe(30_000);
    expect(pl.estimatedProfit).toBe(135_000);
    void mgr;
  });

  it("reservation invoice mirrors the folio and payments", async () => {
    const mgr = await managerActor();
    const st = await roomType("STANDARD");
    // A guest-paid stay: the invoice mirrors the folio (company stays are billed on company invoices — see corporate.test.ts).
    const r = await createReservation({ sourceCode: "PHONE", guest: { fullName: "Staffer" },
      stay: { kind: "overnight", arrivalDate: "2026-10-05", departureDate: "2026-10-07" }, rooms: [{ roomTypeId: st.id, adults: 1, children: 0, discountPerNight: 20_000 }] }, mgr, NOW);
    const inv = await createInvoiceForReservation(r.id, mgr);
    await issueInvoice(inv.id, mgr);
    let i = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { items: true } });
    expect(i.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(i.netAmount).toBe(80_000);
    expect(i.items).toHaveLength(1);
    expect(i.status).toBe("ISSUED");
    await checkIn(r.id, mgr, null, eat("2026-10-05T15:00:00"));
    const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
    await recordReservationPayment({ reservationId: r.id, amount: 30_000, methodId: cash.id }, mgr);
    i = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { items: true } });
    expect(i.paidAmount).toBe(30_000);
    expect(i.status).toBe("PARTIALLY_PAID");
  });

  it("daily report uses the same numbers and renders a WhatsApp message", async () => {
    const mgr = await managerActor();
    const ex = await roomType("EXECUTIVE");
    const b = await createReservation({ sourceCode: "PHONE", guest: { fullName: "B" }, stay: { kind: "overnight", arrivalDate: "2026-10-10", departureDate: "2026-10-11" },
      rooms: [{ roomTypeId: ex.id, adults: 1, children: 0, discountPerNight: 20_000 }] }, mgr, NOW);
    await checkIn(b.id, mgr, null, eat("2026-10-10T15:00:00"));
    const report = await buildDailyReport("2026-10-10");
    expect(report.revenue).toMatchObject({ roomGross: 100_000, roomDiscounts: 20_000, roomNet: 80_000, total: 80_000 });
    expect(report.hotel.roomsSold).toBe(1);
    const text = renderReportText(report, "Vegas Luxury Hotel", "https://example.test/staff/reports/daily/r1");
    expect(text).toContain("*Revenue TZS 80,000*");
    expect(text).toContain("  Rooms: 80,000");
    expect(text).toContain("(room discounts given: 20,000)");
    expect(text).toContain("*Net operating result:* TZS 80,000");
    expect(text).toContain("*Full report:* https://example.test/staff/reports/daily/r1");
    // Only departments that earned something are listed.
    expect(text).not.toContain("Transport:");
    expect(report.rooms).toMatchObject({ adr: 80_000, income: 80_000 });
    expect(text.length).toBeLessThan(3500);
  });
});
