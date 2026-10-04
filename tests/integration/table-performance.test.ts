import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { placeLocationOrder } from "@/server/services/restaurant-locations";
import { customerRequestBill, seatAtTable } from "@/server/services/dining-sessions";
import { tablesOnHome } from "@/server/services/table-performance";
import { businessDateOf } from "@/lib/time/business-date";
import { resetBusinessData } from "../support/helpers";

const SAFARI = "mi_beers_safari";
let n = 0;
const key = () => `${(++n).toString(16).padStart(8, "0")}${"d".repeat(24)}`;

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: SAFARI }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { publicOrderingEnabled: true, orderPaymentConfirm: false } });
  await db.restaurantLocation.updateMany({ data: { qrActive: true, isActive: true } });
});

describe("tables on the manager's home", () => {
  it("each table now (who, bill) and in the period (sales, customers); free tables, QR off and the counter show too", async () => {
    const t3 = await db.restaurantLocation.findUniqueOrThrow({ where: { id: "loc_out_3" } });
    const john = await seatAtTable(t3.qrToken, { name: "John Michael", phone: "0712 100 200" }, null);
    const o1 = await placeLocationOrder(t3.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 2 }], seatToken: john.token });
    const o2 = await placeLocationOrder(t3.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], seatToken: john.token });
    await customerRequestBill(john.token);
    await db.restaurantLocation.update({ where: { id: "loc_in_2" }, data: { qrActive: false } });

    const today = businessDateOf(new Date());
    const { places, summary, watch } = await tablesOnHome(today, { from: today, to: today });
    expect(places.some((p) => p.kind === "MAIN")).toBe(false);
    expect(places.some((p) => p.kind === "COUNTER")).toBe(true);

    const table = places.find((p) => p.id === "loc_out_3")!;
    const bill = o1.total + o2.total;
    expect(table).toMatchObject({ state: "BILL", period: { sales: bill, orders: 2, customers: 1, guests: 1 } });
    expect(table.now).toMatchObject({ customer: "John Michael", total: bill, due: bill, guests: 1 });
    expect(table.now?.orders).toHaveLength(2);
    expect(table.week.at(-1)).toEqual({ d: today, sales: bill });
    expect(table.recent[0]).toMatchObject({ customer: "John Michael", total: bill, open: true });

    expect(places.find((p) => p.id === "loc_out_4")).toMatchObject({ state: "FREE", now: null, period: { sales: 0, customers: 0 } });
    expect(summary).toMatchObject({ tables: 12, bill: 1, busy: 1, sales: bill, customers: 1, due: bill, avgBill: bill, best: { name: "Table 3 — Outside", sales: bill } });
    // Only just asked for the bill: not a worry yet — but a QR switched off is.
    expect(watch.map((w) => w.id)).toEqual(["loc_in_2"]);
  });
});
