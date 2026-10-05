import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, checkOut, createReservation } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { cancelRestaurantOrder, chargeOrderToRoom, confirmOrderPayment, createRestaurantOrder, declineRestaurantOrder, ordersBoard, restaurantOrderHistory, recordOrderPayment, restaurantPulse, saveOrderSounds, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { orderByTrackToken, placeOnlineOrder, storePaymentProof } from "@/server/services/online-orders";
import { placeRoomQrOrder, regenerateRoomQr, roomForQr, roomQrCodes, scanRoomQr, setRoomQrActive } from "@/server/services/room-qr";
import { stayView } from "@/server/services/guest-comms";
import { maskEmail, maskPhone } from "@/lib/guest-messages";
import { orderEventFor, orderMessageText } from "@/lib/order-messages";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { chefActor, counterActor, eat, managerActor, receptionistActor, resetBusinessData, roomType, waiterActor, withoutConfirming } from "../support/helpers";

/** Take out is paid first: a screenshot and the mobile-money account. */
async function paidFirst() {
  const { id } = await storePaymentProof(new File([new Uint8Array([137, 80, 78, 71])], "pay.png", { type: "image/png" }));
  const acct = await db.moneyAccount.findFirstOrThrow({ where: { kind: "MOBILE_MONEY", accountNumber: { not: null }, isActive: true } });
  return { proofId: id, accountId: acct.id, reference: "SGH4K2L9PQ" };
}

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: { in: [BIRYANI, SAFARI] } }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { publicOrderingEnabled: true, orderPaymentConfirm: true } });
});

const TZ = "Africa/Dar_es_Salaam";
const BIRYANI = "mi_main_courses_chicken_biryani";
const SAFARI = "mi_beers_safari";
const today = () => businessDateOf(new Date());
let n = 0;
const key = () => `${(++n).toString(16).padStart(8, "0")}${"a".repeat(24)}`;

/** A guest checked in to the first Double Deluxe room (or the given room), and that room's QR. */
async function inHouse(phone = "0715 000 444", name = "John Smith", roomId?: string) {
  const dd = await roomType("DOUBLE_DELUXE");
  const t = today();
  const target = roomId ?? dd.rooms[0].id;
  await db.room.update({ where: { id: target }, data: { status: "READY" } });
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: name, phone, email: `${name.split(" ")[0].toLowerCase()}@example.com` }, stay: { kind: "overnight", arrivalDate: addDays(t, -1), departureDate: addDays(t, 1) },
    rooms: [{ roomTypeId: dd.id, roomId: target, adults: 1, children: 0, discountPerNight: 0 }],
  }, await managerActor(), zonedInstant(addDays(t, -1), 12 * 60, TZ));
  await checkIn(r.id, await managerActor(), null, zonedInstant(addDays(t, -1), 15 * 60, TZ));
  await roomQrCodes();
  const qr = await db.roomQrCode.findUniqueOrThrow({ where: { roomId: target } });
  return { r: await db.reservation.findUniqueOrThrow({ where: { id: r.id } }), roomId: target, qr: qr.token };
}
const prices = async () => {
  const [b, s] = await Promise.all([db.menuItem.findUniqueOrThrow({ where: { id: BIRYANI } }), db.menuItem.findUniqueOrThrow({ where: { id: SAFARI } })]);
  return { biryani: b.price, safari: s.price };
};

describe("outside customers (website menu)", () => {
  it("takeaway: one order to reception + kitchen, paid online (recorded at once), no room, the customer saved by phone", async () => {
    const p = await prices();
    const o = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 2 }, { menuItemId: SAFARI, quantity: 1 }], name: "Mary Walker", phone: "0754 111 222", kind: "TAKEAWAY", deliveryAddress: "Mikocheni B, Plot 45, near the pharmacy", paidFirst: await paidFirst() });
    expect(o).toMatchObject({ type: "TAKEAWAY", settlement: "PAY_NOW", paymentStatus: "PAID", status: "PENDING", source: "WEBSITE", reservationId: null, roomNumber: null, createdById: null, total: 2 * p.biryani + p.safari });
    expect(o.trackToken).toBeTruthy();
    const guest = await db.guest.findUniqueOrThrow({ where: { id: o.guestId! } });
    expect(guest).toMatchObject({ fullName: "Mary Walker", phone: "+255754111222" });
    expect(await db.reservationCharge.count({ where: { restaurantOrderId: o.id } })).toBe(0);
    // The customer's online payment is counted once, into the account they paid.
    const sales = await db.revenueTransaction.findMany({ where: { restaurantOrderId: o.id, isVoided: false } });
    expect(sales.reduce((t, x) => t + x.amount, 0)).toBe(o.total);
    expect((await ordersBoard(today())).map((k) => k.number)).toContain(o.number);
  });

  it("an existing customer is recognised by their phone; the same tap twice makes one order", async () => {
    const saved = await db.guest.create({ data: { fullName: "Peter Mushi", phone: "+255765000111" } });
    const k = key();
    const input = { clientKey: k, items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Peter", phone: "0765 000 111", kind: "PICKUP" as const };
    const a = await placeOnlineOrder(input);
    const b = await placeOnlineOrder(input);
    expect(b.id).toBe(a.id);
    expect(a.guestId).toBe(saved.id);
    expect(await db.restaurantOrder.count({ where: { clientKey: k } })).toBe(1);
  });

  it("pay later: delivered first, then paid — the payment completes it, as restaurant and bar income", async () => {
    const p = await prices();
    const [chef, waiter, counter] = [await chefActor(), await waiterActor(), await counterActor()];
    const o = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 1 }, { menuItemId: SAFARI, quantity: 2 }], name: "Ali", phone: "0713 222 333", kind: "PICKUP" });
    await cookUntilReady(o.id, chef);
    await setOrderStatus(o.id, "OUT_FOR_DELIVERY", waiter);
    await expect(setOrderStatus(o.id, "COMPLETED", waiter)).rejects.toThrow(/completes by itself/);
    await setOrderStatus(o.id, "DELIVERED", waiter);
    // Delivered but not paid: still open, waiting for its money.
    expect(await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ status: "DELIVERED", settlement: "UNPAID", deliveredTo: "Counter" });
    // The waiter serves; the money is recorded at the Restaurant Counter.
    await expect(recordOrderPayment(o.id, { accountId: "acct_cash", reference: "counter" }, waiter)).rejects.toThrow(/cannot record payments/);
    await recordOrderPayment(o.id, { accountId: "acct_cash", reference: "counter" }, counter);
    const sales = await db.revenueTransaction.findMany({ where: { restaurantOrderId: o.id } });
    expect(sales.map((s) => [s.kind, s.amount]).sort()).toEqual([["BAR", 2 * p.safari], ["RESTAURANT", p.biryani]]);
    const done = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { events: { orderBy: { at: "asc" } } } });
    expect(done).toMatchObject({ settlement: "PAY_NOW", status: "COMPLETED" });
    expect(done.paidAt).not.toBeNull();
    // (Serving it also made the waiter its waiter — a note on the timeline, not a step.)
    expect(done.events.filter((e) => !/is serving/.test(e.note ?? "")).map((e) => e.to)).toEqual(["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERED", "COMPLETED"]);
  });

  it("the waiter marks it delivered while the Counter records the payment — one step, completed and paid at once", async () => {
    const [chef, waiter, counter] = [await chefActor(), await waiterActor(), await counterActor()];
    const o = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Neema", phone: "0713 999 000", kind: "DINE_IN", tableLabel: "7" });
    // One restaurant: the Mpishi prepares drinks too, and so can a waiter — reception never.
    await expect(setOrderStatus(o.id, "ACCEPTED", await receptionistActor())).rejects.toThrow(/Only the Mpishi or a waiter/);
    await cookUntilReady(o.id, chef);
    await expect(setOrderStatus(o.id, "OUT_FOR_DELIVERY", await receptionistActor())).rejects.toThrow(/for waiters/);
    await setOrderStatus(o.id, "OUT_FOR_DELIVERY", waiter);
    // The waiter alone never records the money.
    await expect(setOrderStatus(o.id, "DELIVERED", waiter, new Date(), { pay: { accountId: "acct_cash" } })).rejects.toThrow(/Restaurant Counter/);
    await setOrderStatus(o.id, "DELIVERED", waiter, new Date(), { pay: { accountId: "acct_cash", handedOverById: waiter.userId }, payBy: counter });
    // Served by the waiter, paid at the Counter: done, and the Counter's payment is final at once.
    const done = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { payments: true } });
    expect(done).toMatchObject({ status: "COMPLETED", settlement: "PAY_NOW", paymentStatus: "PAID", paidAmount: done.total, deliveredTo: "Table 7", deliveredById: waiter.userId, takenById: waiter.userId, assignedToId: waiter.userId });
    expect(done.payments[0]).toMatchObject({ amount: done.total, collectedById: counter.userId, atCounter: true, handedOverById: waiter.userId, confirmedById: counter.userId });
    expect(done.payments[0].confirmedAt).not.toBeNull();
  });

  it("a payment is final as it is recorded — even by an account that may not confirm; nobody confirms by hand", async () => {
    const [chef, waiter] = [await chefActor(), await waiterActor()];
    const recorder = withoutConfirming(await counterActor());
    const o = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Neema", phone: "0713 999 001", kind: "PICKUP" });
    await cookUntilReady(o.id, chef);
    await setOrderStatus(o.id, "DELIVERED", waiter, new Date(), { pay: { accountId: "acct_cash" }, payBy: recorder });
    const done = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { payments: true } });
    expect(done).toMatchObject({ status: "COMPLETED", paymentStatus: "PAID", paidAmount: done.total });
    expect(done.payments[0]).toMatchObject({ amount: done.total, collectedById: recorder.userId });
    expect(done.payments[0].confirmedAt).not.toBeNull();
    await expect(confirmOrderPayment(done.payments[0].id, await receptionistActor())).rejects.toThrow(/already confirmed/);
  });

  it("a staying guest who ordered at the restaurant: reception can put the unpaid order on their room bill", async () => {
    const { r } = await inHouse();
    const o = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 2 }], name: "John Smith", phone: "0715 000 444", kind: "DINE_IN", tableLabel: "Bar" });
    expect(o).toMatchObject({ settlement: "UNPAID", reservationId: null });
    await chargeOrderToRoom(o.id, r.id, await receptionistActor());
    const moved = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(moved).toMatchObject({ settlement: "ROOM", reservationId: r.id });
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount).toBe(moved.total);
    await expect(chargeOrderToRoom(o.id, r.id, await receptionistActor())).rejects.toThrow(/already on a room bill/);
  });

  it("menu prices are copied onto the order: a later price change leaves it as ordered", async () => {
    const p = await prices();
    const o = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 1 }], name: "Ali", phone: "0713 222 444", kind: "DINE_IN", tableLabel: "Table 4" });
    await db.menuItem.update({ where: { id: BIRYANI }, data: { price: p.biryani + 3000 } });
    const item = await db.restaurantOrderItem.findFirstOrThrow({ where: { orderId: o.id } });
    expect(item).toMatchObject({ unitPrice: p.biryani, lineTotal: p.biryani });
    expect(o.tableLabel).toBe("Table 4");
    await db.menuItem.update({ where: { id: BIRYANI }, data: { price: p.biryani } });
  });

  it("items marked unavailable cannot be ordered", async () => {
    await db.menuItem.update({ where: { id: SAFARI }, data: { isAvailable: false } });
    await expect(placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Ali", phone: "0713 222 555", kind: "TAKEAWAY", deliveryAddress: "Mikocheni B, Plot 45, near the pharmacy", paidFirst: await paidFirst() })).rejects.toThrow(/not available/);
  });
});

describe("room QR — belongs to the room, opens whoever is checked in now", () => {
  it("every room (and the meeting room) has its own permanent QR; a new QR retires the old; it can be switched off", async () => {
    const rooms = await roomQrCodes();
    expect(rooms.every((r) => r.qrCode?.token)).toBe(true);
    expect(new Set(rooms.map((r) => r.qrCode!.token)).size).toBe(rooms.length);
    expect(rooms.some((r) => r.roomType.category === "MEETING_ROOM")).toBe(true);
    const room = rooms[0];
    const old = room.qrCode!.token;
    expect((await roomForQr(old))?.number).toBe(room.number);
    const fresh = await regenerateRoomQr(room.id, await managerActor());
    expect(await roomForQr(old)).toBeNull();
    expect((await roomForQr(fresh))?.number).toBe(room.number);
    await expect(regenerateRoomQr(room.id, await receptionistActor())).rejects.toThrow(/manager/);
    await setRoomQrActive(room.id, false, await managerActor());
    expect(await scanRoomQr(fresh)).toMatchObject({ room: { active: false }, stay: null });
    await setRoomQrActive(room.id, true, await managerActor());
    expect((await scanRoomQr(fresh))?.room.active).toBe(true);
  });

  it("guest A, then guest B in the same room: the same card opens only the guest staying now — and orders go to their bill", async () => {
    const p = await prices();
    const mgr = await managerActor();
    const fee = (await db.hotelSettings.findFirstOrThrow()).roomServiceFee;
    const a = await inHouse("0715 000 444", "Nino Mushi");
    const scanA = await scanRoomQr(a.qr);
    expect(scanA?.stay).toMatchObject({ reference: a.r.reference, guestName: "Nino M.", phone: maskPhone("+255715000444"), email: maskEmail("nino@example.com") });
    expect(JSON.stringify(scanA?.stay)).not.toContain("715000444");
    const orderA = await placeRoomQrOrder(a.qr, { items: [{ menuItemId: BIRYANI, quantity: 1 }], clientKey: key() });
    expect(orderA).toMatchObject({ type: "ROOM_SERVICE", settlement: "ROOM", source: "ROOM_QR", reservationId: a.r.id, total: p.biryani + fee });
    // "Pay now" instead of the room bill: the guest's screenshot — paid online (recorded at once), not on the room bill.
    const proof = await paidFirst();
    const paidNow = await placeRoomQrOrder(a.qr, { items: [{ menuItemId: SAFARI, quantity: 1 }], clientKey: key(), paidFirst: proof });
    expect(paidNow).toMatchObject({ type: "ROOM_SERVICE", settlement: "PAY_NOW", reservationId: a.r.id, paymentProofFileId: proof.proofId, paymentStatus: "PAID" });

    // A pays and checks out; B checks in to the same room.
    const due = (await db.reservation.findUniqueOrThrow({ where: { id: a.r.id } })).balanceAmount;
    await recordReservationPayment({ reservationId: a.r.id, amount: due, accountId: "acct_cash" }, mgr);
    await checkOut(a.r.id, mgr, { earlyReason: "Change of plans", allowBalance: true, overrideReason: "Test" });
    expect((await scanRoomQr(a.qr))?.stay).toBeNull(); // free room: the room, not A
    const b = await inHouse("0766 222 333", "Jove Kimaro", a.roomId);
    expect(b.qr).toBe(a.qr); // the same physical card
    const scanB = await scanRoomQr(b.qr);
    expect(scanB?.stay?.guestName).toBe("Jove K.");
    expect(scanB?.stay?.orders).toHaveLength(0); // never A's orders
    expect(JSON.stringify(scanB)).not.toContain("Nino");
    const orderB = await placeRoomQrOrder(b.qr, { items: [{ menuItemId: SAFARI, quantity: 2 }], clientKey: key() });
    expect(orderB.reservationId).toBe(b.r.id);
    expect((await stayView({ id: b.r.id }))!.orders.map((o) => o.number)).toEqual([orderB.number]);
    expect((await stayView({ id: a.r.id }))!.orders.map((o) => o.number)).toEqual([paidNow.number, orderA.number]);
  });

  it("a free room shows the room and the menu — nobody can order to it", async () => {
    const rooms = await roomQrCodes();
    const free = rooms.find((r) => r.roomType.category === "GUEST_ROOM" && r.reservationRooms.length === 0)!;
    const scan = await scanRoomQr(free.qrCode!.token);
    expect(scan).toMatchObject({ stay: null, room: { number: free.number } });
    expect(scan?.info?.price).toBeGreaterThan(0);
    await expect(placeRoomQrOrder(free.qrCode!.token, { items: [{ menuItemId: SAFARI, quantity: 1 }] })).rejects.toThrow(/No one is checked in/);
  });

  it("the meeting room's QR: during a meeting, orders are served to the meeting room on the meeting bill (no room-service fee)", async () => {
    const mgr = await managerActor();
    const t = await roomType("MEETING_ROOM");
    const DAY = "2026-12-10", at = (hm: string) => eat(`${DAY}T${hm}:00`);
    const m = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "John Contact", phone: "0712000102" }, companyName: "ABC Company",
      stay: { kind: "meeting", startAt: at("09:00"), endAt: at("13:00") }, rooms: [{ roomTypeId: t.id, adults: 8, children: 0 }],
    }, mgr, eat("2026-12-01T10:00:00"));
    await roomQrCodes();
    const code = await db.roomQrCode.findUniqueOrThrow({ where: { roomId: t.rooms[0].id } });
    expect((await scanRoomQr(code.token))?.stay).toBeNull(); // not started yet
    await checkIn(m.id, mgr, null, at("08:50"));
    const scan = await scanRoomQr(code.token);
    expect(scan?.stay).toMatchObject({ kind: "MEETING", company: "ABC Company" });
    const o = await placeRoomQrOrder(code.token, { items: [{ menuItemId: SAFARI, quantity: 8 }] }, at("10:00"));
    expect(o).toMatchObject({ type: "DINE_IN", tableLabel: `Meeting room ${t.rooms[0].number}`, settlement: "ROOM", reservationId: m.id, serviceFee: 0 });
  });

  it("the public menu never charges a room", async () => {
    await expect(placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Visitor", phone: "0700 111 000", kind: "ROOM_SERVICE" as never })).rejects.toThrow(/eat here or take out/);
  });
});

describe("restaurant portal: Mpishi and waiter", () => {
  it("the Mpishi accepts, ticks every item and marks ready; the waiter takes it and delivers — room bill orders complete by themselves", async () => {
    const [chef, waiter, mgr] = [await chefActor(), await waiterActor(), await managerActor()];
    const { r } = await inHouse();
    const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: BIRYANI, quantity: 1 }, { menuItemId: SAFARI, quantity: 2 }] }, await receptionistActor(), new Date(), { source: "RECEPTION" });
    expect(o.source).toBe("RECEPTION");
    // Each does their own part.
    await expect(setOrderStatus(o.id, "ACCEPTED", await receptionistActor())).rejects.toThrow(/Only the Mpishi or a waiter/);
    await setOrderStatus(o.id, "ACCEPTED", chef);
    await setOrderStatus(o.id, "PREPARING", chef);
    await expect(setOrderStatus(o.id, "OUT_FOR_DELIVERY", waiter)).rejects.toThrow(/not marked this order ready/);
    // Not ready while an item is unfinished.
    const items = await db.restaurantOrderItem.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } });
    await expect(setOrderStatus(o.id, "READY", chef)).rejects.toThrow(/Tick every item first — still not ready: 1 × .*, 2 × /);
    expect(await setOrderItemPrepared(o.id, items[0].id, true, chef)).toEqual({ left: 1 });
    await expect(setOrderStatus(o.id, "READY", chef)).rejects.toThrow(/still not ready: 2 × /);
    await expect(setOrderItemPrepared(o.id, items[1].id, true, await receptionistActor())).rejects.toThrow(/Only the Mpishi or a waiter/);
    expect(await setOrderItemPrepared(o.id, items[1].id, true, chef)).toEqual({ left: 0 });
    await setOrderStatus(o.id, "READY", chef);
    await expect(setOrderItemPrepared(o.id, items[1].id, false, chef)).rejects.toThrow(/already marked ready/);
    // The kitchen does not hand over, cancel or take money.
    await expect(setOrderStatus(o.id, "OUT_FOR_DELIVERY", chef)).rejects.toThrow(/for waiters/);
    await expect(cancelRestaurantOrder(o.id, "x", chef)).rejects.toThrow(/cannot cancel/);
    await expect(recordOrderPayment(o.id, { accountId: "acct_cash" }, chef)).rejects.toThrow(/cannot record payments/);
    await setOrderStatus(o.id, "OUT_FOR_DELIVERY", waiter);
    await setOrderStatus(o.id, "DELIVERED", waiter);
    const done = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { events: { orderBy: { at: "asc" } } } });
    expect(done).toMatchObject({ status: "COMPLETED", acceptedById: chef.userId, readyById: chef.userId, takenById: waiter.userId, deliveredById: waiter.userId, deliveredTo: `Room ${done.roomNumber}` });
    expect(done.completedAt).not.toBeNull();
    expect(done.events.filter((e) => !/is serving/.test(e.note ?? "")).map((e) => [e.to, e.byRole])).toEqual([
      ["PENDING", "Receptionist"], ["ACCEPTED", "Mpishi (cook)"], ["PREPARING", "Mpishi (cook)"], ["READY", "Mpishi (cook)"],
      ["OUT_FOR_DELIVERY", "Waiter"], ["DELIVERED", "Waiter"], ["COMPLETED", "Waiter"],
    ]);
    await expect(setOrderStatus(o.id, "DELIVERED", mgr)).rejects.toThrow(/already closed/);
  });

  it("every screen notices a change within seconds (pulse), and only a manager sets the sounds", async () => {
    const [chef, bar] = [await chefActor(), await waiterActor()];
    const p0 = await restaurantPulse();
    const o = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: SAFARI, quantity: 1 }], name: "Juma", phone: "0713 555 111", kind: "TAKEAWAY", deliveryAddress: "Mikocheni B, Plot 45, near the pharmacy", paidFirst: await paidFirst() });
    const p1 = await restaurantPulse();
    expect(p1).not.toBe(p0);
    await setOrderStatus(o.id, "ACCEPTED", bar);
    const item = await db.restaurantOrderItem.findFirstOrThrow({ where: { orderId: o.id } });
    const p2 = await restaurantPulse();
    await new Promise((r) => setTimeout(r, 5));
    await setOrderItemPrepared(o.id, item.id, true, chef);
    expect(await restaurantPulse()).not.toBe(p2);

    const sounds = { orderSoundsEnabled: true, orderSoundVolume: 60, newOrderSound: "alarm", readyOrderSound: "bell", orderPaymentConfirm: true };
    await expect(saveOrderSounds(sounds, chef)).rejects.toThrow(/Only a manager/);
    await saveOrderSounds(sounds, await managerActor());
    expect(await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ newOrderSound: "alarm", orderSoundVolume: 60 });
    await saveOrderSounds({ ...sounds, newOrderSound: "bell", orderSoundVolume: 80, readyOrderSound: "chime" }, await managerActor());
  });

  it("the Mpishi declines an order (out of stock): off the room bill, dish sold out, reason kept — and it shows in the history", async () => {
    const [chef, waiter] = [await chefActor(), await waiterActor()];
    const { r } = await inHouse();
    const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: BIRYANI, quantity: 1 }] }, await receptionistActor());
    const billed = (await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount;
    expect(billed).toBeGreaterThan(0);
    await expect(declineRestaurantOrder(o.id, "Out of stock", [], await receptionistActor())).rejects.toThrow(/Only the Mpishi or a waiter/);
    await expect(declineRestaurantOrder(o.id, "  ", [], chef)).rejects.toThrow(/why/);
    await declineRestaurantOrder(o.id, "Out of stock", [BIRYANI], chef);
    const done = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { events: { orderBy: { at: "asc" } } } });
    expect(done).toMatchObject({ status: "CANCELLED", cancelReason: "Declined by the kitchen — Out of stock", cancelledById: chef.userId });
    expect(done.events.at(-1)).toMatchObject({ to: "CANCELLED", byRole: "Mpishi (cook)" });
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount).toBe(billed - o.total);
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: BIRYANI } })).isAvailable).toBe(false);

    const day = today();
    expect((await restaurantOrderHistory({ from: day, to: day, status: "cancelled" })).map((x) => x.id)).toContain(o.id);
    expect((await restaurantOrderHistory({ from: day, to: day, status: "done" })).map((x) => x.id)).not.toContain(o.id);

    // Once ready it can no longer be declined.
    await db.menuItem.update({ where: { id: BIRYANI }, data: { isAvailable: true } });
    const p = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "2", settlement: "UNPAID", items: [{ menuItemId: BIRYANI, quantity: 1 }] }, await receptionistActor());
    await cookUntilReady(p.id, waiter);
    await expect(declineRestaurantOrder(p.id, "Out of stock", [], chef)).rejects.toThrow(/already ready/);
  });

  it("the Mpishi can take an order too (never 'pay now', never to a room — that is the waiters' and reception's)", async () => {
    const chef = await chefActor();
    const { r } = await inHouse();
    await expect(createRestaurantOrder({ type: "DINE_IN", tableLabel: "4", settlement: "PAY_NOW", accountId: "acct_cash", items: [{ menuItemId: SAFARI, quantity: 1 }] }, chef)).rejects.toThrow(/Restaurant Counter/);
    await expect(createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 1 }] }, chef)).rejects.toThrow(/Only waiters and reception/);
    const o = await createRestaurantOrder({ type: "DINE_IN", tableLabel: "4", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, chef);
    expect(o).toMatchObject({ status: "PENDING", source: "STAFF_MANUAL", createdById: chef.userId });
  });

  it("cancelling keeps who, when and why — and takes it off the room bill", async () => {
    const { r } = await inHouse();
    const recep = await receptionistActor();
    const o = await createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: r.id, settlement: "ROOM", items: [{ menuItemId: SAFARI, quantity: 2 }] }, recep);
    await cancelRestaurantOrder(o.id, "Guest changed their mind", recep);
    const c = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { events: true } });
    expect(c).toMatchObject({ status: "CANCELLED", cancelReason: "Guest changed their mind", cancelledById: recep.userId });
    expect(c.events.find((e) => e.to === "CANCELLED")).toMatchObject({ from: "PENDING", note: "Guest changed their mind" });
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.id } })).chargesAmount).toBe(0);
  });
});

describe("tracking & updates", () => {
  it("the tracking link shows the order and its steps — no internal ids", async () => {
    const o = await placeOnlineOrder({ clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 1 }], name: "Mary Walker", phone: "0754 333 222", kind: "TAKEAWAY", deliveryAddress: "Mikocheni B, Plot 45, near the pharmacy", paidFirst: await paidFirst() });
    await setOrderStatus(o.id, "PREPARING", await managerActor());
    const t = await orderByTrackToken(o.trackToken!);
    expect(t).toMatchObject({ number: o.number, status: "PREPARING", firstName: "Mary" });
    expect(t!.acceptedAt).not.toBeNull();
    expect(JSON.stringify(t)).not.toContain(o.id);
    expect(await orderByTrackToken("nope-not-a-real-token")).toBeNull();
  });

  it("updates are short and say where the order is", () => {
    const v = { name: "John Smith", hotel: "Vegas Luxury Hotel", number: "ORD-2026-000012", room: "301", track: "https://h/order/x", menu: "https://h/order", prepMinutes: 20, phone: "+255 710 223 344" };
    const preparing = orderMessageText("PREPARING", { ...v, type: "ROOM_SERVICE" });
    expect(preparing).toContain("Hello John");
    expect(preparing).toContain("Your order #12 is now being prepared. It should be ready in about 20 minutes.");
    expect(preparing).toContain("https://h/order/x");
    expect(orderMessageText("READY", { ...v, type: "ROOM_SERVICE" })).toContain("Your order #12 is ready and on its way to Room 301.");
    expect(orderMessageText("READY", { ...v, type: "TAKEAWAY" })).toContain("Your order #12 is ready for collection at Vegas Luxury Hotel.");
    expect(orderMessageText("READY", { ...v, type: "TAKEAWAY", delivery: true })).toContain("Your order #12 is ready and will be on its way to you shortly.");
    // A cancelled order has no tracking link, but says how to reach the hotel.
    const cancelled = orderMessageText("CANCELLED", { ...v, type: "DINE_IN" });
    expect(cancelled).not.toContain("https://h/order/x");
    expect(cancelled).toContain("+255 710 223 344");
    expect(orderEventFor("DELIVERED", "TAKEAWAY", true)).toBe("DELIVERED");
    expect(orderEventFor("DELIVERED", "TAKEAWAY")).toBe("COLLECTED");
    expect(orderMessageText("PREPARING", { ...v, type: "DINE_IN", prepMinutes: null })).not.toContain("minutes");
  });
});

/** The Mpishi's part: accept, tick every item, mark ready. */
async function cookUntilReady(orderId: string, chef: Awaited<ReturnType<typeof chefActor>>) { // the Mpishi (food) or a waiter (drinks only)
  await setOrderStatus(orderId, "ACCEPTED", chef);
  for (const i of await db.restaurantOrderItem.findMany({ where: { orderId } })) await setOrderItemPrepared(orderId, i.id, true, chef);
  await setOrderStatus(orderId, "READY", chef);
}
