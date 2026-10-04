import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import {
  addOrderItems, cancelRestaurantOrder, chargeOrderToRoom, createRestaurantOrder, moveOrdersToTable, orderBill, recordOrderPayment, removeOrderItem, reverseOrderPayment,
  setOrderItemPrepared, setOrderStatus,
} from "@/server/services/restaurant";
import {
  addItemsByTrackToken, identifyAtLocation, placeLocationOrder, regenerateLocationQr, restaurantLocations, scanLocationQr, setLocationQrActive,
} from "@/server/services/restaurant-locations";
import { identifyCustomer, placeOnlineOrder, storePaymentProof } from "@/server/services/online-orders";
import { moveSession, seatAtTable } from "@/server/services/dining-sessions";
import { deliveryPlace } from "@/lib/delivery-place";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { chefActor, counterActor, managerActor, receptionistActor, resetBusinessData, roomType, waiterActor, withoutConfirming } from "../support/helpers";

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: { in: [BIRYANI, SAFARI, HEINEKEN] } }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { publicOrderingEnabled: true, orderPaymentConfirm: true } });
  await db.restaurantLocation.updateMany({ data: { qrActive: true, isActive: true } });
});

afterAll(async () => { await db.hotelSettings.updateMany({ data: { orderPaymentConfirm: true } }); });

const TZ = "Africa/Dar_es_Salaam";
const BIRYANI = "mi_main_courses_chicken_biryani";
const SAFARI = "mi_beers_safari";
const HEINEKEN = "mi_beers_heineken";
const today = () => businessDateOf(new Date());
let n = 0;
const key = () => `${(++n).toString(16).padStart(8, "0")}${"b".repeat(24)}`;
/** Take out is paid first: a screenshot and the mobile-money account. */
async function paidFirst() {
  const { id } = await storePaymentProof(new File([new Uint8Array([137, 80, 78, 71])], "pay.png", { type: "image/png" }));
  const acct = await db.moneyAccount.findFirstOrThrow({ where: { kind: "MOBILE_MONEY", accountNumber: { not: null }, isActive: true } });
  return { proofId: id, accountId: acct.id, reference: "SGH4K2L9PQ" };
}
const spot = (id: string) => db.restaurantLocation.findUniqueOrThrow({ where: { id } });
/** At a table the customer says who they are first (their table is theirs until they pay): their seat. */
async function seatAt(token: string, name: string, phone: string) {
  const r = await seatAtTable(token, { name, phone }, null);
  expect(["seated", "welcome_back"]).toContain(r.state);
  return r.token!;
}
const price = async (id: string) => (await db.menuItem.findUniqueOrThrow({ where: { id } })).price;

async function serve(orderId: string) {
  const [chef, waiter] = [await chefActor(), await waiterActor()];
  await setOrderStatus(orderId, "PREPARING", chef);
  for (const i of await db.restaurantOrderItem.findMany({ where: { orderId, preparedAt: null } })) await setOrderItemPrepared(orderId, i.id, true, chef);
  await setOrderStatus(orderId, "READY", chef);
  await setOrderStatus(orderId, "OUT_FOR_DELIVERY", waiter);
  await setOrderStatus(orderId, "DELIVERED", waiter);
}

async function inHouse() {
  const dd = await roomType("DOUBLE_DELUXE");
  const t = today();
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: "Grace Room", phone: "0716 222 333" }, stay: { kind: "overnight", arrivalDate: addDays(t, -1), departureDate: addDays(t, 1) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await managerActor(), zonedInstant(addDays(t, -1), 12 * 60, TZ));
  await checkIn(r.id, await managerActor(), null, zonedInstant(addDays(t, -1), 15 * 60, TZ));
  return db.reservation.findUniqueOrThrow({ where: { id: r.id } });
}

describe("restaurant places & their QR codes", () => {
  it("six tables inside, six outside (same numbers, different places), the outside counter and the main restaurant — each with its own QR", async () => {
    const all = await restaurantLocations();
    const tables = all.filter((l) => l.kind === "TABLE");
    expect(tables.filter((l) => l.area === "INSIDE").map((l) => l.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tables.filter((l) => l.area === "OUTSIDE").map((l) => l.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(all.find((l) => l.kind === "COUNTER")).toMatchObject({ name: "Counter — Outside", area: "OUTSIDE", number: null });
    expect(all.find((l) => l.kind === "MAIN")).toMatchObject({ name: "Restaurant" });
    expect(new Set(all.map((l) => l.qrToken)).size).toBe(all.length);
    const [in3, out3] = [await spot("loc_in_3"), await spot("loc_out_3")];
    expect(in3.name).toBe("Table 3 — Inside");
    expect(out3.name).toBe("Table 3 — Outside");
    expect(in3.qrToken).not.toBe(out3.qrToken);
    expect(await scanLocationQr(out3.qrToken)).toMatchObject({ id: "loc_out_3", kind: "TABLE" });
    expect(await scanLocationQr("1234")).toBeNull();
  });

  it("a new QR: the old card stops working at once, orders already placed keep their table; a switched-off QR refuses orders", async () => {
    const out3 = await spot("loc_out_3");
    const seatToken = await seatAt(out3.qrToken, "Nino", "0712 000 111");
    const o = await placeLocationOrder(out3.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], seatToken });
    await expect(regenerateLocationQr(out3.id, await waiterActor())).rejects.toThrow(/Only a manager/);
    const fresh = await regenerateLocationQr(out3.id, await managerActor());
    expect(fresh).not.toBe(out3.qrToken);
    expect(await scanLocationQr(out3.qrToken)).toBeNull();
    await expect(placeLocationOrder(out3.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], seatToken })).rejects.toThrow(/not active/);
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ locationId: out3.id, tableLabel: "Table 3 — Outside" });
    await setLocationQrActive(out3.id, false, await managerActor());
    await expect(placeLocationOrder(fresh, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], seatToken })).rejects.toThrow(/not active/);
  });
});

describe("ordering from a table, the counter and the main restaurant", () => {
  it("table QR: the customer is saved once by phone, the order is for that table (Table QR) and shows it is in use", async () => {
    const out3 = await spot("loc_out_3");
    expect(await identifyAtLocation(out3.qrToken, { phone: "0712 000 111" })).toEqual({ returning: false, name: null, active: null });
    // Not seated: no order at a table.
    await expect(placeLocationOrder(out3.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Nino", phone: "0712 000 111" })).rejects.toThrow(/who you are/);
    const seatToken = await seatAt(out3.qrToken, "Nino", "0712 000 111");
    const o = await placeLocationOrder(out3.qrToken, { clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 1 }, { menuItemId: SAFARI, quantity: 2 }], seatToken, notes: "No onions" });
    expect(o).toMatchObject({ type: "DINE_IN", source: "TABLE_QR", tableLabel: "Table 3 — Outside", settlement: "UNPAID", paymentStatus: "UNPAID", status: "PENDING", customerName: "Nino", serviceFee: 0 });
    const again = await identifyAtLocation(out3.qrToken, { phone: "+255 712 000 111" });
    expect(again).toMatchObject({ returning: true, name: "Nino", active: { number: o.number, total: o.total, track: o.trackToken } });
    // Same phone on another phone (typed again): welcome back — still one customer, one table.
    const again2 = await seatAtTable(out3.qrToken, { name: "Nino M", phone: "0712000111" }, null);
    expect(again2.state).toBe("welcome_back");
    await placeLocationOrder(out3.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], seatToken: again2.token });
    expect(await db.guest.count({ where: { phone: o.customerPhone! } })).toBe(1);
    const row = (await restaurantLocations()).find((l) => l.id === out3.id)!;
    expect(row.open.map((x) => x.number)).toContain(o.number);
    // A different customer at the same table is never attached to Nino's order — nor takes over his table.
    expect((await identifyAtLocation(out3.qrToken, { phone: "0788 111 222" })).active).toBeNull();
    expect((await seatAtTable(out3.qrToken, { name: "Juma", phone: "0788 111 222" }, null)).state).toBe("in_use");
  });

  it("who is ordering: a returning customer is greeted by first name and initials and need not type their name again", async () => {
    const in2 = await spot("loc_in_2");
    await placeLocationOrder(in2.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], seatToken: await seatAt(in2.qrToken, "Asha Mwamba Juma", "0713 222 333") });
    expect(await identifyCustomer("+255713222333")).toEqual({ name: "Asha M. J." });
    expect(await identifyCustomer("0799 000 999")).toEqual({ name: null });
    await expect(identifyCustomer("12")).rejects.toThrow(/phone number/);
    expect((await identifyAtLocation(in2.qrToken, { phone: "0713222333" })).name).toBe("Asha M. J.");
    // No name typed: the order carries the name we have for that phone (full, for the staff).
    const main = await spot("loc_main");
    const o = await placeLocationOrder(main.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "", phone: "0713 222 333" });
    expect(o.customerName).toBe("Asha Mwamba Juma");
    const seatedAgain = await seatAtTable(in2.qrToken, { name: "", phone: "0713 222 333" }, null);
    expect(seatedAgain).toMatchObject({ state: "welcome_back", name: "Asha M. J." });
    const web = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], phone: "0713222333", kind: "TAKEAWAY", deliveryAddress: "Mikocheni B, Plot 45, near the pharmacy", paidFirst: await paidFirst() });
    expect(web.customerName).toBe("Asha Mwamba Juma");
    // Someone new must say their name.
    await expect(placeLocationOrder(main.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], phone: "0799 000 999" })).rejects.toThrow(/enter your name/);
    await expect(seatAtTable((await spot("loc_in_5")).qrToken, { phone: "0799 000 999" }, null)).rejects.toThrow(/enter your name/);
    await expect(placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: " ", phone: "0799 000 999", kind: "PICKUP" })).rejects.toThrow(/enter your name/);
  });

  it("counter QR and main restaurant QR: their own sources — the counter is not a table, the main QR has no table", async () => {
    const [counter, main] = [await spot("loc_counter_out"), await spot("loc_main")];
    const c = await placeLocationOrder(counter.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Juma", phone: "0713 111 222" });
    expect(c).toMatchObject({ source: "COUNTER_QR", tableLabel: "Counter — Outside", locationId: counter.id, type: "DINE_IN" });
    const m = await placeLocationOrder(main.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Asha", phone: "0714 111 222" });
    expect(m).toMatchObject({ source: "RESTAURANT_QR", tableLabel: null, locationId: main.id, type: "DINE_IN" });
  });

  it("take out only from the restaurant's own QR (and online): the address is required, it is paid first, it takes no table", async () => {
    const [out2, main] = [await spot("loc_out_2"), await spot("loc_main")];
    const base = { items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Neema", phone: "0715 333 444", kind: "TAKEAWAY" as const };
    const address = "  Mbezi Beach, House 12, opposite the school  ";
    // A table (or the counter) never offers take out.
    await expect(placeLocationOrder(out2.qrToken, { ...base, clientKey: key(), deliveryAddress: address, paidFirst: await paidFirst() })).rejects.toThrow(/restaurant's own QR/);
    await expect(placeLocationOrder(main.qrToken, { ...base, clientKey: key() })).rejects.toThrow(/delivery address/);
    await expect(placeLocationOrder(main.qrToken, { ...base, clientKey: key(), deliveryAddress: " ab " })).rejects.toThrow(/delivery address/);
    // Paid first: no screenshot, a cash "account", or a screenshot already used — refused.
    await expect(placeLocationOrder(main.qrToken, { ...base, clientKey: key(), deliveryAddress: address })).rejects.toThrow(/paid first/);
    const cash = await db.moneyAccount.findFirstOrThrow({ where: { kind: "CASH" } });
    await expect(placeLocationOrder(main.qrToken, { ...base, clientKey: key(), deliveryAddress: address, paidFirst: { ...(await paidFirst()), accountId: cash.id } })).rejects.toThrow(/account you paid/);
    const paid = await paidFirst();
    const o = await placeLocationOrder(main.qrToken, { ...base, clientKey: key(), deliveryAddress: address, paidFirst: paid });
    expect(o).toMatchObject({
      type: "TAKEAWAY", source: "RESTAURANT_QR", locationId: null, tableLabel: null, deliveryAddress: "Mbezi Beach, House 12, opposite the school",
      paymentProofFileId: paid.proofId, customerPaidToId: paid.accountId, customerPayRef: "SGH4K2L9PQ", paymentStatus: "PAID", paidAmount: o.total,
    });
    expect(o.customerPaidAt).not.toBeNull();
    await expect(placeLocationOrder(main.qrToken, { ...base, clientKey: key(), deliveryAddress: address, paidFirst: paid })).rejects.toThrow(/screenshot of your payment again/);
    expect(deliveryPlace(o)).toBe("Take out — Mbezi Beach, House 12, opposite the school");
    // The website and the public menu too.
    await expect(placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Neema", phone: "0715 333 444", kind: "TAKEAWAY" })).rejects.toThrow(/delivery address/);
    await expect(placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Neema", phone: "0715 333 444", kind: "TAKEAWAY", deliveryAddress: "Mbezi Beach, House 12" })).rejects.toThrow(/paid first/);
  });

  it("at a table: on the bill, or paid now with the screenshot — the order stays at the table", async () => {
    const out2 = await spot("loc_out_2");
    const seatToken = await seatAt(out2.qrToken, "Neema", "0715 333 444");
    const onBill = await placeLocationOrder(out2.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], seatToken });
    expect(onBill).toMatchObject({ type: "DINE_IN", locationId: out2.id, paymentProofFileId: null });
    const paid = await paidFirst();
    const now = await placeLocationOrder(out2.qrToken, { clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], seatToken, paidFirst: paid });
    expect(now).toMatchObject({ type: "DINE_IN", locationId: out2.id, tableLabel: "Table 2 — Outside", paymentProofFileId: paid.proofId, customerPaidToId: paid.accountId, paymentStatus: "PAID" });
    expect(now.sessionId).toBe(onBill.sessionId); // one table, one bill
  });

  it("staff pick a table: the order carries the table's name and place", async () => {
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_2", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, await waiterActor(), new Date(), { source: "WAITER_MANUAL", customerPhone: "0712 555 666" });
    expect(o).toMatchObject({ tableLabel: "Table 2 — Inside", locationId: "loc_in_2", source: "WAITER_MANUAL" });
  });
});

describe("ordering more on the same order", () => {
  it("after it was served: the new items join the same order, it goes back to the kitchen for round 2, the bill has everything", async () => {
    const out3 = await spot("loc_out_3");
    const o = await placeLocationOrder(out3.qrToken, { clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 1 }], seatToken: await seatAt(out3.qrToken, "Nino", "0712 000 111") });
    await serve(o.id);
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("DELIVERED"); // still open: not paid
    const added = await addItemsByTrackToken(o.trackToken!, [{ menuItemId: HEINEKEN, quantity: 2 }]);
    expect(added).toMatchObject({ status: "PENDING", round: 2, total: o.total + 2 * (await price(HEINEKEN)) });
    const items = await db.restaurantOrderItem.findMany({ where: { orderId: o.id }, orderBy: { round: "asc" } });
    expect(items.map((i) => [i.round, i.name, !!i.preparedAt])).toEqual([[1, expect.any(String), true], [2, expect.any(String), false]]);
    // The kitchen prepares only the new round; the waiter serves it again.
    await serve(o.id);
    const bill = await orderBill(o.id, "order");
    expect(bill!.totals).toMatchObject({ total: added.total, paid: 0, due: added.total });
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, await receptionistActor());
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "COMPLETED", paymentStatus: "PAID", paidAmount: added.total });
    await expect(addItemsByTrackToken(o.trackToken!, [{ menuItemId: SAFARI, quantity: 1 }])).rejects.toThrow(/closed/);
  });

  it("paid before it was prepared, then more items: part-paid with the rest due; the second payment settles only the new items", async () => {
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_1", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 2 }] }, await receptionistActor(), new Date(), { customerPhone: "0712 999 000" });
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, await receptionistActor());
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ paymentStatus: "PAID", status: "PENDING" }); // paid and still on the board
    await expect(addOrderItems(o.id, [{ menuItemId: HEINEKEN, quantity: 1 }], await receptionistActor())).rejects.toThrow(/cannot add items/);
    await addOrderItems(o.id, [{ menuItemId: HEINEKEN, quantity: 1 }], await waiterActor());
    const part = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(part).toMatchObject({ paymentStatus: "PARTIALLY_PAID", paidAmount: o.total, total: o.total + (await price(HEINEKEN)) });
    // The rest is paid at the Restaurant Counter (a waiter never records it).
    await expect(recordOrderPayment(o.id, { accountId: "acct_cash" }, await waiterActor())).rejects.toThrow(/cannot record payments/);
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, await counterActor());
    const pays = await db.restaurantOrderPayment.findMany({ where: { orderId: o.id }, orderBy: { collectedAt: "asc" } });
    expect(pays.map((p) => p.amount)).toEqual([o.total, await price(HEINEKEN)]);
    expect(pays.map((p) => p.atCounter)).toEqual([false, true]);
    const sales = await db.revenueTransaction.findMany({ where: { restaurantOrderId: o.id, isVoided: false } });
    expect(sales.reduce((t, s) => t + s.amount, 0)).toBe(part.total); // every shilling counted once
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe("PAID"); // the Counter's part is final at once
    await expect(recordOrderPayment(o.id, { accountId: "acct_cash" }, await receptionistActor())).rejects.toThrow(/already paid/);
  });

  it("a room order: added items go on the room bill too; nothing is added once it is on its way", async () => {
    const r = await inHouse();
    // The waiter knows the customer (the staying guest) — room service only for the customer's own room.
    const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 1 }] }, await waiterActor(), new Date(), { guestId: r.guestId });
    const before = (await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount;
    await addOrderItems(o.id, [{ menuItemId: HEINEKEN, quantity: 1 }], await waiterActor());
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount).toBe(before + (await price(HEINEKEN)));
    const chef = await chefActor();
    await setOrderStatus(o.id, "PREPARING", chef);
    for (const i of await db.restaurantOrderItem.findMany({ where: { orderId: o.id } })) await setOrderItemPrepared(o.id, i.id, true, chef);
    await setOrderStatus(o.id, "READY", chef);
    await expect(addOrderItems(o.id, [{ menuItemId: SAFARI, quantity: 1 }], await waiterActor())).rejects.toThrow(/on its way/);
  });
});

describe("a table's order: taking items off, moving the customer", () => {
  it("take off: a waiter before the kitchen makes it, only a manager after; always with a reason; never a paid item or the last one", async () => {
    const waiter = await waiterActor();
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_4", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 3 }, { menuItemId: BIRYANI, quantity: 1 }] }, waiter, new Date(), { customerPhone: "0712 444 555" });
    const line = async (id: string) => db.restaurantOrderItem.findFirstOrThrow({ where: { orderId: o.id, menuItemId: id } });
    const safari = await line(SAFARI);
    await expect(removeOrderItem(o.id, safari.id, 1, " ", waiter)).rejects.toThrow(/why/);
    await expect(removeOrderItem(o.id, safari.id, 1, "Changed their mind", await chefActor())).rejects.toThrow(/cannot change/);
    const res = await removeOrderItem(o.id, safari.id, 1, "Changed their mind", waiter);
    expect(res.total).toBe(o.total - (await price(SAFARI)));
    expect(await line(SAFARI)).toMatchObject({ quantity: 2, lineTotal: 2 * (await price(SAFARI)) });
    const note = await db.restaurantOrderEvent.findFirst({ where: { orderId: o.id, note: { startsWith: "Removed:" } } });
    expect(note?.note).toMatch(/1 × .* — Changed their mind/);

    // Made by the kitchen: only a manager takes it off.
    const chef = await chefActor();
    await setOrderStatus(o.id, "PREPARING", chef);
    await setOrderItemPrepared(o.id, (await line(BIRYANI)).id, true, chef);
    await expect(removeOrderItem(o.id, (await line(BIRYANI)).id, 1, "Took too long", waiter)).rejects.toThrow(/manager/);
    await removeOrderItem(o.id, (await line(BIRYANI)).id, 1, "Took too long", await managerActor());
    const after = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(after).toMatchObject({ total: 2 * (await price(SAFARI)), foodSubtotal: 0, drinksSubtotal: 2 * (await price(SAFARI)) });
    await expect(removeOrderItem(o.id, (await line(SAFARI)).id, 2, "Ordered by mistake", waiter)).rejects.toThrow(/cancel the order/);

    // Paid: it stays.
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, await receptionistActor());
    await expect(removeOrderItem(o.id, (await line(SAFARI)).id, 1, "Ordered by mistake", await managerActor())).rejects.toThrow(/already paid/);
  });

  it("on a room bill: taking an item off redoes the guest's bill", async () => {
    const r = await inHouse();
    const waiter = await waiterActor();
    const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 2 }, { menuItemId: HEINEKEN, quantity: 1 }] }, waiter, new Date(), { guestId: r.guestId });
    const before = (await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount;
    const safari = await db.restaurantOrderItem.findFirstOrThrow({ where: { orderId: o.id, menuItemId: SAFARI } });
    await removeOrderItem(o.id, safari.id, 1, "Ordered by mistake", waiter);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount).toBe(before - (await price(SAFARI)));
    const charges = await db.reservationCharge.findMany({ where: { restaurantOrderId: o.id, isVoided: false } });
    const updated = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(charges.reduce((t, c) => t + c.amount, 0)).toBe(updated.total); // lines + the room-service fee, once each
  });

  it("orders without a customer's table (from before sessions) still move one by one; a session's orders move with their table", async () => {
    const waiter = await waiterActor();
    // No phone: no customer, so no session — an old-style order at the table.
    const make = () => createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_2", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date());
    const [a, b] = [await make(), await make()];
    expect(a.sessionId).toBeNull();
    await recordOrderPayment(a.id, { accountId: "acct_cash" }, await receptionistActor());
    await expect(moveOrdersToTable([a.id], "loc_out_5", await chefActor())).rejects.toThrow(/cannot move/);
    await expect(moveOrdersToTable([a.id], "loc_main", waiter)).rejects.toThrow(/table or the counter/);
    await expect(moveOrdersToTable([a.id], "loc_in_2", waiter)).rejects.toThrow(/already at/);
    expect(await moveOrdersToTable([a.id, b.id], "loc_out_5", waiter)).toEqual({ moved: 2, to: "Table 5 — Outside" });
    for (const id of [a.id, b.id]) expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id } })).toMatchObject({ locationId: "loc_out_5", tableLabel: "Table 5 — Outside" });
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: a.id }, include: { payments: true } })).payments).toHaveLength(1); // the payment went too
    expect(await db.restaurantOrderEvent.count({ where: { orderId: b.id, note: "Moved from Table 2 — Inside to Table 5 — Outside" } })).toBe(1);
    await cancelRestaurantOrder(b.id, "Left", waiter);
    await expect(moveOrdersToTable([b.id], "loc_in_1", waiter)).rejects.toThrow(/closed/);
    // A customer's order (their session) is moved with the whole table instead.
    const c = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_3", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { customerPhone: "0712 777 888" });
    await expect(moveOrdersToTable([c.id], "loc_out_6", waiter)).rejects.toThrow(/move the table/);
    expect(await moveSession(c.sessionId!, "loc_out_6", {}, waiter)).toEqual({ from: "Table 3 — Inside", to: "Table 6 — Outside" });
  });
});

describe("payments: collected, confirmed, reversed — never deleted", () => {
  it("a manager reverses a mistaken payment: sales voided (kept), the amount is due again and the order opens again", async () => {
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_4", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, await receptionistActor(), new Date(), { customerPhone: "0712 444 555" });
    await serve(o.id);
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, await receptionistActor());
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("COMPLETED");
    const pay = await db.restaurantOrderPayment.findFirstOrThrow({ where: { orderId: o.id } });
    await expect(reverseOrderPayment(pay.id, "Wrong table", await receptionistActor())).rejects.toThrow(/Only a manager/);
    await expect(reverseOrderPayment(pay.id, " ", await managerActor())).rejects.toThrow(/why/);
    await reverseOrderPayment(pay.id, "Wrong table", await managerActor());
    const after = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { payments: true, sales: true } });
    expect(after).toMatchObject({ status: "DELIVERED", paymentStatus: "UNPAID", paidAmount: 0 });
    expect(after.payments[0]).toMatchObject({ status: "REVERSED", reverseReason: "Payment reversed: Wrong table" });
    expect(after.sales.every((s) => s.isVoided)).toBe(true);
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, await receptionistActor());
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("COMPLETED");
  });

  it("with confirmation switched off, every recorded payment is final at once; a part-paid order cannot go on a room bill", async () => {
    await db.hotelSettings.updateMany({ data: { orderPaymentConfirm: false } });
    const r = await inHouse();
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_1", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, await waiterActor(), new Date(), { customerPhone: "0712 777 888" });
    // Recorded by an account that may not confirm: with confirmation off it does not wait for reception.
    await recordOrderPayment(o.id, { accountId: "acct_cash" }, withoutConfirming(await counterActor()));
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).paymentStatus).toBe("PAID");
    await addOrderItems(o.id, [{ menuItemId: HEINEKEN, quantity: 1 }], await waiterActor());
    await expect(chargeOrderToRoom(o.id, r.id, await receptionistActor())).rejects.toThrow(/already paid/);
  });
});
