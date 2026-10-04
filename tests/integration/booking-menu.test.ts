import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createReservation } from "@/server/services/reservations";
import { convertRequest, submitMeetingRequest } from "@/server/services/booking-requests";
import { managerActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(resetBusinessData);

async function twoItems() {
  const [food, drink] = await Promise.all([
    db.menuItem.findFirstOrThrow({ where: { isActive: true, isAvailable: true, type: "FOOD", category: { isActive: true } }, orderBy: { price: "desc" } }),
    db.menuItem.findFirstOrThrow({ where: { isActive: true, isAvailable: true, type: "DRINK", category: { isActive: true } }, orderBy: { price: "asc" } }),
  ]);
  return { food, drink };
}

describe("food & drinks picked from the menu while booking", () => {
  it("walk-in: one kitchen order charged to the room, paid with the booking, lines keep their menu item", async () => {
    const mgr = await managerActor();
    const { food, drink } = await twoItems();
    const st = await roomType("STANDARD");
    const total = st.baseRate + food.price * 2 + drink.price;
    const r = await createReservation({
      sourceCode: "WALK_IN", guest: { fullName: "Menu Walk-in" }, stay: { kind: "walkIn", nights: 1 },
      rooms: [{ roomTypeId: st.id, adults: 1, children: 0 }],
      menuItems: [{ menuItemId: food.id, quantity: 2 }, { menuItemId: drink.id, quantity: 1 }],
      payment: { amount: total, accountId: "acct_cash" },
    }, mgr);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { charges: true, restaurantOrders: { include: { items: true } } } });
    expect(after.restaurantOrders).toHaveLength(1);
    expect(after.restaurantOrders[0]).toMatchObject({ type: "DINE_IN", settlement: "ROOM", total: food.price * 2 + drink.price });
    expect(after.charges.map((c) => c.menuItemId).sort()).toEqual([food.id, drink.id].sort());
    expect(after).toMatchObject({ netAmount: total, paidAmount: total, balanceAmount: 0 });
  });

  it("booking for later: a pre-order on the bill at menu prices (not sent to the kitchen)", async () => {
    const mgr = await managerActor();
    const { food } = await twoItems();
    const dd = await roomType("DOUBLE_DELUXE");
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Menu Later" }, stay: { kind: "overnight", arrivalDate: "2026-12-20", departureDate: "2026-12-21" },
      rooms: [{ roomTypeId: dd.id, adults: 1, children: 0 }], menuItems: [{ menuItemId: food.id, quantity: 3 }],
    }, mgr, new Date("2026-12-01T09:00:00Z"));
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { charges: true, restaurantOrders: true } });
    expect(after.restaurantOrders).toHaveLength(0);
    expect(after.charges).toHaveLength(1);
    expect(after.charges[0]).toMatchObject({ menuItemId: food.id, amount: food.price * 3, category: "RESTAURANT" });
    expect(after.charges[0].description).toBe(`3 × ${food.name} (pre-order)`);
  });

  it("confirming an online booking can add food & drinks: on the new booking's bill, priced from the menu", async () => {
    const mgr = await managerActor();
    const { food, drink } = await twoItems();
    const req = await submitMeetingRequest({ date: "2026-12-15", start: "09:00", end: "12:00", attendees: 6, fullName: "Online Menu", phone: "0755000321" }, null);
    const type = await roomType("MEETING_ROOM");
    const r = await convertRequest(req.id, {
      checkIn: "2026-12-15", checkOut: "2026-12-15", roomTypeId: type.id, roomCount: 1, adults: 6, children: 0,
      menuItems: [{ menuItemId: food.id, quantity: 6 }, { menuItemId: drink.id, quantity: 6 }],
    }, { ...mgr, userId: mgr.userId! } as never);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { charges: true } });
    expect(after.charges).toHaveLength(2);
    expect(after.chargesAmount).toBe(6 * (food.price + drink.price));
    expect(after.netAmount).toBe(type.baseRate + 6 * (food.price + drink.price));
  });
});
