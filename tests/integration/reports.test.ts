import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { buildReport } from "@/server/services/reports";
import { profitLoss } from "@/server/services/reporting";
import { placeLocationOrder } from "@/server/services/restaurant-locations";
import { seatAtTable } from "@/server/services/dining-sessions";
import { businessDateOf } from "@/lib/time/business-date";
import { REPORTS } from "@/lib/report-types";
import { resetBusinessData } from "../support/helpers";

const SAFARI = "mi_beers_safari";
let n = 0;
const key = () => `${(++n).toString(16).padStart(8, "0")}${"e".repeat(24)}`;

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: SAFARI }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { publicOrderingEnabled: true, orderPaymentConfirm: false } });
  await db.restaurantLocation.updateMany({ data: { qrActive: true, isActive: true } });
});

describe("reports", () => {
  it("every report builds for a day and a month, with figures, parts and a summary to share", async () => {
    const today = businessDateOf(new Date());
    for (const r of REPORTS) {
      for (const range of [{ from: today, to: today }, { from: `${today.slice(0, 8)}01`, to: today }]) {
        const rep = await buildReport(r.key, range, today);
        expect(rep).toMatchObject({ key: r.key, title: r.title, from: range.from, to: range.to });
        expect(rep.figures.length).toBeGreaterThanOrEqual(4);
        expect(rep.blocks.length).toBeGreaterThan(0);
        expect(rep.share).toContain(r.title);
      }
    }
  });

  it("the whole-business report agrees with Finance; orders show in restaurant, best sellers and tables", async () => {
    const today = businessDateOf(new Date());
    const t = await db.restaurantLocation.findUniqueOrThrow({ where: { id: "loc_out_2" } });
    const seat = await seatAtTable(t.qrToken, { name: "Report Tester", phone: "0712 555 666" }, null);
    const o = await placeLocationOrder(t.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 3 }], seatToken: seat.token });
    const range = { from: today, to: today };

    const summary = await buildReport("summary", range, today);
    expect(summary.figures[0].raw).toBe((await profitLoss(range)).netRevenue);

    const food = await buildReport("restaurant", range, today);
    expect(food.figures.find((f) => f.label === "Drink sales")?.raw).toBe(o.total);
    expect(food.figures.find((f) => f.label === "Orders")?.raw).toBe(1);

    const items = await buildReport("items", range, today);
    const table = items.blocks.find((b) => b.kind === "table" && b.title === "Every item sold");
    expect(table && table.kind === "table" && table.rows[0][3]).toBe(3);

    const tables = await buildReport("tables", range, today);
    expect(tables.figures[0].raw).toBe(o.total);
    expect(tables.figures[1].raw).toBe(1);
  });
});
