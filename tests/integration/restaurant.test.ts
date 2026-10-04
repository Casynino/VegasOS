import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation, previewCheckOut } from "@/server/services/reservations";
import { readFileSync } from "node:fs";
import { billMenu, cancelRestaurantOrder, createRestaurantOrder, diningMoney, orderBill, orderBillByTrackToken, payOrdersTogether, payRoomOrderNow, setOrderCustomerPhone, publicMenu, recordOrderPayment, saveMenuItem, setOrderStatus } from "@/server/services/restaurant";
import { addReservationCharge, recentChargeItems } from "@/server/services/payments";
import { profitLoss } from "@/server/services/reporting";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { chefActor, managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";

beforeEach(async () => {
  await resetBusinessData();
  await db.$executeRawUnsafe(`TRUNCATE "restaurant_orders" CASCADE`);
  await db.menuItem.updateMany({ where: { id: "mi_beers_heineken" }, data: { price: 5000, isAvailable: true } });
});

const TZ = "Africa/Dar_es_Salaam";
const today = () => businessDateOf(new Date());

/** A guest checked in yesterday and staying two nights. */
async function inHouse() {
  const dd = await roomType("DOUBLE_DELUXE");
  const t = today();
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: "John Smith" }, stay: { kind: "overnight", arrivalDate: addDays(t, -1), departureDate: addDays(t, 1) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await managerActor(), zonedInstant(addDays(t, -1), 12 * 60, TZ));
  await checkIn(r.id, await managerActor(), null, zonedInstant(addDays(t, -1), 15 * 60, TZ));
  return db.reservation.findUniqueOrThrow({ where: { id: r.id } });
}

const BIRYANI = "mi_main_courses_chicken_biryani";
const SAFARI = "mi_beers_safari";
const HEINEKEN = "mi_beers_heineken";

describe("restaurant & bar", () => {
  it("room service charged to the room: prices from the menu, TZS 2,000 fee, on the guest's bill, no payment", async () => {
    const r = await inHouse();
    const before = r.balanceAmount;
    const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: BIRYANI, quantity: 1 }, { menuItemId: SAFARI, quantity: 2 }] }, await receptionistActor());
    expect(o).toMatchObject({ foodSubtotal: 12_000, drinksSubtotal: 8_000, serviceFee: 2_000, total: 22_000, settlement: "ROOM", status: "PENDING" });
    expect(o.number).toMatch(/^ORD-\d{4}-\d{6}$/);
    const charges = await db.reservationCharge.findMany({ where: { restaurantOrderId: o.id } });
    expect(charges.map((c) => [c.kind, c.amount]).sort()).toEqual([["BAR", 8_000], ["RESTAURANT", 12_000], ["ROOM_SERVICE", 2_000]]);
    expect(await db.payment.count({ where: { reservationId: r.id, kind: "PAYMENT" } })).toBe(0);
    const after = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.balanceAmount - before).toBe(22_000);
    const bill = await previewCheckOut(r.id, {});
    expect(bill.balance).toBeGreaterThanOrEqual(22_000); // checkout collects it

    const pl = await profitLoss({ from: today(), to: today() });
    expect(pl.revenue).toMatchObject({ restaurant: 12_000, bar: 8_000, roomService: 2_000 });
  });

  it("paid now into Lipa M-Pesa: sales by income line with the account; the guest's bill is untouched", async () => {
    const mpesa = await db.moneyAccount.findUniqueOrThrow({ where: { code: "LIPA_MPESA" } });
    const o = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "Table 4", settlement: "PAY_NOW", accountId: mpesa.id, reference: "QK7X", items: [{ menuItemId: HEINEKEN, quantity: 2 }] }, await receptionistActor());
    const sales = await db.revenueTransaction.findMany({ where: { restaurantOrderId: o.id } });
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ kind: "BAR", amount: 10_000, accountId: mpesa.id });
    expect(o).toMatchObject({ total: 10_000, serviceFee: 0, accountId: mpesa.id });
  });

  it("on the room bill, but the guest pays now instead: it comes off the stay's bill and the sales are recorded", async () => {
    const r = await inHouse();
    const before = r.balanceAmount;
    const cash = await db.moneyAccount.findUniqueOrThrow({ where: { code: "LIPA_MPESA" } });
    const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: BIRYANI, quantity: 1 }, { menuItemId: SAFARI, quantity: 2 }] }, await receptionistActor());
    await payRoomOrderNow(o.id, { accountId: cash.id, reference: "QX12" }, await receptionistActor());
    const paid = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(paid).toMatchObject({ settlement: "PAY_NOW", accountId: cash.id, paymentReference: "QX12" });
    expect(await db.reservationCharge.count({ where: { restaurantOrderId: o.id, isVoided: false } })).toBe(0);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).balanceAmount).toBe(before);
    const sales = await db.revenueTransaction.findMany({ where: { restaurantOrderId: o.id, isVoided: false } });
    expect(sales.map((x) => [x.kind, x.amount]).sort()).toEqual([["BAR", 8_000], ["RESTAURANT", 12_000], ["ROOM_SERVICE", 2_000]]);
    await expect(payRoomOrderNow(o.id, { accountId: cash.id }, await receptionistActor())).rejects.toThrow(/already paid/);
  });

  it("old orders keep their price when the menu changes; unavailable items and non-guests are refused", async () => {
    const r = await inHouse();
    const first = await createRestaurantOrder({ type: "DINE_IN", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: HEINEKEN, quantity: 2 }] }, await receptionistActor());
    const mgr = await managerActor();
    const item = await db.menuItem.findUniqueOrThrow({ where: { id: HEINEKEN } });
    await saveMenuItem({ id: HEINEKEN, categoryId: item.categoryId, name: item.name, price: 6000, isAvailable: true, isActive: true }, { ...mgr, userId: mgr.userId! });
    const second = await createRestaurantOrder({ type: "DINE_IN", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: HEINEKEN, quantity: 2 }] }, await receptionistActor());
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: first.id } })).total).toBe(10_000);
    expect(second.total).toBe(12_000);
    expect(await db.auditLog.count({ where: { entityId: HEINEKEN, action: "menu.price_changed" } })).toBe(1);

    await db.menuItem.update({ where: { id: HEINEKEN }, data: { isAvailable: false } });
    await expect(createRestaurantOrder({ type: "DINE_IN", settlement: "PAY_NOW", accountId: "acct_cash", items: [{ menuItemId: HEINEKEN, quantity: 1 }] }, await receptionistActor())).rejects.toThrow(/not available/);

    const future = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Not Here Yet" }, stay: { kind: "overnight", arrivalDate: addDays(today(), 20), departureDate: addDays(today(), 21) },
      rooms: [{ roomTypeId: (await roomType("TWIN")).id, adults: 1, children: 0, discountPerNight: 0 }],
    }, await receptionistActor());
    await expect(createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: future.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 1 }] }, await receptionistActor())).rejects.toThrow(/not checked in/);
  });

  it("kitchen flow and cancelling: early cancel by the desk; once cooking, only a manager — the bill items are voided", async () => {
    const r = await inHouse();
    const before = r.balanceAmount;
    const a = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: BIRYANI, quantity: 1 }] }, await receptionistActor());
    await cancelRestaurantOrder(a.id, "Guest changed mind", await receptionistActor());
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).balanceAmount).toBe(before);
    expect(await db.reservationCharge.count({ where: { restaurantOrderId: a.id, isVoided: true } })).toBe(2);

    const b = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: BIRYANI, quantity: 1 }] }, await receptionistActor());
    await setOrderStatus(b.id, "PREPARING", await chefActor());
    await expect(setOrderStatus(b.id, "ACCEPTED", await chefActor())).rejects.toThrow(/does not come next/);
    await expect(cancelRestaurantOrder(b.id, "Too late", await receptionistActor())).rejects.toThrow(/manager/);
    await cancelRestaurantOrder(b.id, "Wrong room", await managerActor());
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELLED");
  });

  it("the bill menu: every item with its price, the most-ordered first, the delivery fee; order lines stay out of 'recently used'", async () => {
    const r = await inHouse();
    await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 5 }, { menuItemId: BIRYANI, quantity: 1 }] }, await receptionistActor());
    await createRestaurantOrder({ type: "DINE_IN", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: BIRYANI, quantity: 2 }] }, await receptionistActor());
    await addReservationCharge({ reservationId: r.id, description: "Shirts washed", amount: 6_000, category: "LAUNDRY" }, await receptionistActor());

    const m = await billMenu();
    expect(m.fee).toBe(2_000);
    expect(m.popular.slice(0, 2)).toEqual([SAFARI, BIRYANI]); // 5 Safari, then 3 biryani
    const biryani = m.categories.flatMap((c) => c.items).find((i) => i.id === BIRYANI)!;
    expect(biryani).toMatchObject({ price: 12_000, isAvailable: true, type: "FOOD" });

    const recent = await recentChargeItems();
    expect(recent.map((x) => x.item)).toEqual(["Shirts washed"]); // not "Chicken Biryani · ORD-…", not the delivery fee
  });

  it("a menu photo is stored in the media library and shown on the public menu", async () => {
    const mgr = await managerActor();
    const item = await db.menuItem.findUniqueOrThrow({ where: { id: BIRYANI } });
    const file = new File([readFileSync("public/images/illustrative/restaurant-warm.webp")], "biryani.webp", { type: "image/webp" });
    const saved = await saveMenuItem({ id: BIRYANI, categoryId: item.categoryId, name: item.name, price: item.price, isAvailable: true, isActive: true, image: file }, { ...mgr, userId: mgr.userId! });
    expect(saved.imageId).toBeTruthy();
    const shown = (await publicMenu()).flatMap((c) => c.items).find((i) => i.id === BIRYANI)!;
    expect(shown.image?.id).toBe(saved.imageId);
    expect(shown.image?.url).toBeNull(); // uploaded: served from /media/<id>
    const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: saved.imageId! } });
    expect(asset).toMatchObject({ category: "RESTAURANT", isActive: true });
    // Tidy up so other tests see the menu as seeded.
    await db.menuItem.update({ where: { id: BIRYANI }, data: { imageId: null } });
    await db.mediaAsset.delete({ where: { id: asset.id } });
    if (asset.fileId) await db.storedFile.delete({ where: { id: asset.fileId } });
  });
  it("money: received today by account, pay-later still to collect, food on the bills of guests staying", async () => {
    const r = await inHouse();
    const desk = await receptionistActor();
    const mpesa = await db.moneyAccount.findUniqueOrThrow({ where: { code: "LIPA_MPESA" } });
    await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: BIRYANI, quantity: 1 }] }, desk);
    await createRestaurantOrder({ type: "DINE_IN", tableLabel: "Table 2", settlement: "PAY_NOW", accountId: mpesa.id, items: [{ menuItemId: HEINEKEN, quantity: 2 }] }, desk);
    const later = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "Table 7", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, desk);

    let m = await diningMoney(today());
    expect(m.received).toMatchObject([{ id: mpesa.id, amount: 10_000, orders: 1 }]);
    expect(m.unpaid.map((o) => [o.number, o.total])).toEqual([[later.number, later.total]]);
    expect(m.onRooms).toHaveLength(1);
    expect(m.onRooms[0]).toMatchObject({ id: r.id, orders: 1 });
    expect(m.onRoomsTotal).toBeGreaterThan(0);

    // Collecting the pay-later order allocates it to an account: it leaves "to collect".
    await recordOrderPayment(later.id, { accountId: mpesa.id }, await managerActor());
    m = await diningMoney(today());
    expect(m.unpaid).toHaveLength(0);
    expect(m.received).toMatchObject([{ id: mpesa.id, amount: 10_000 + later.total, orders: 2 }]);
  });
  it("bills: a table's orders together (this sitting), a room's whole stay, and the whole table paid at once", async () => {
    const r = await inHouse();
    const desk = await receptionistActor();
    const a = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "Table 9", settlement: "UNPAID", items: [{ menuItemId: HEINEKEN, quantity: 2 }] }, desk);
    const b = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "table 9", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, desk);
    await createRestaurantOrder({ type: "DINE_IN", tableLabel: "Table 3", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, desk);

    const table = (await orderBill(a.id, "table"))!;
    expect(table.scope).toBe("table");
    expect(table.orders.map((o) => o.number)).toEqual([a.number, b.number]);
    expect(table.totals).toMatchObject({ total: a.total + b.total, due: a.total + b.total, paid: 0 });
    expect((await orderBill(a.id, "room"))!.scope).toBe("order"); // not a room order → just the order

    const res = await payOrdersTogether(table.orders.map((o) => o.id), { accountId: "acct_cash", reference: "table 9" }, desk);
    expect(res).toEqual({ count: 2, total: a.total + b.total });
    expect((await orderBill(a.id, "table"))!.totals).toMatchObject({ due: 0, paid: a.total + b.total });
    await expect(payOrdersTogether([a.id], { accountId: "acct_cash" }, desk)).rejects.toThrow(/already paid/);

    const x = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: BIRYANI, quantity: 1 }] }, desk);
    const y = await createRestaurantOrder({ type: "DINE_IN", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 2 }] }, desk);
    const stay = (await orderBill(x.id, "room"))!;
    expect(stay.orders.map((o) => o.id)).toEqual([x.id, y.id]);
    expect(stay.totals).toMatchObject({ onRoom: x.total + y.total, due: 0 });
  });
  it("every order carries its receipt: the customer opens it from their own link (not once cancelled)", async () => {
    const desk = await receptionistActor();
    const o = await createRestaurantOrder({ type: "TAKEAWAY", customerName: "Juma", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 2 }] }, desk);
    const got = (await orderBillByTrackToken(o.trackToken!))!;
    expect(got.id).toBe(o.id);
    expect(got.bill).toMatchObject({ scope: "order", totals: { total: o.total, due: o.total } });
    expect(await orderBillByTrackToken("not-a-real-token-123")).toBeNull();
    await cancelRestaurantOrder(o.id, "Customer left", desk);
    expect(await orderBillByTrackToken(o.trackToken!)).toBeNull();
  });
  it("every customer is known by phone: a walk-in is saved by it, a guest without a phone gets it, reception can add one later", async () => {
    const desk = await receptionistActor();
    const a = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "5", customerName: "Neema Joseph", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, desk, new Date(), { customerPhone: "+255713444555" });
    const g = await db.guest.findUniqueOrThrow({ where: { id: a.guestId! } });
    expect(g).toMatchObject({ fullName: "Neema Joseph", phone: "+255713444555" });
    // The same phone again → the same customer.
    const b = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "5", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, desk, new Date(), { customerPhone: "0713 444 555" });
    expect(b.guestId).toBe(a.guestId);

    const r = await inHouse();
    await db.guest.update({ where: { id: r.guestId }, data: { phone: null } });
    await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 1 }] }, desk, new Date(), { customerPhone: "0754 999 888" });
    expect((await db.guest.findUniqueOrThrow({ where: { id: r.guestId } })).phone).toBe("+255754999888");

    const c = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "8", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, desk);
    expect(c.customerPhone).toBeNull();
    await expect(setOrderCustomerPhone(c.id, "12", desk)).rejects.toThrow(/phone number/);
    await setOrderCustomerPhone(c.id, "0765 111 222", desk);
    const fixed = await db.restaurantOrder.findUniqueOrThrow({ where: { id: c.id } });
    expect(fixed.customerPhone).toBe("+255765111222");
    expect(fixed.guestId).not.toBeNull();
  });
});

