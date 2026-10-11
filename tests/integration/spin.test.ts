import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, checkOut, createReservation } from "@/server/services/reservations";
import { sendGifts, spinBoard, spinOnce, spinQrCodes, spinView } from "@/server/services/spin";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { managerActor, resetBusinessData, roomType } from "../support/helpers";

const TZ = "Africa/Dar_es_Salaam";
const WATER = "mi_sides_drinks_mineral_water"; // 1,500
const CHAPATI = "mi_breakfast_chapati_eggs"; // 4,000
const OMELETTE = "mi_breakfast_omelette_toast"; // 6,000
const WINGS = "mi_starters_soups_bbq_or_spicy_chicken_wings"; // 7,000
const FRIES = "mi_main_courses_french_fries"; // 8,000
const PILAU = "mi_main_courses_chicken_pilau_beef_pilau"; // 10,000
const SPIN_DEFAULTS = { spinEnabled: false, spinsPerStay: 5, spinBudgetStandard: 10000, spinBudgetPremium: 15000, spinMaxItemPrice: 10000, spinGiftChance: 45, spinFreeSpinChance: 10, spinAllowRoom: true, spinAllowRestaurant: true, spinStartsOn: null, spinEndsOn: null };

let n = 0;
const key = () => `${(++n).toString(16).padStart(8, "0")}${"b".repeat(24)}`;
const today = () => businessDateOf(new Date());

/** The chances of every spin from now on: a gift, the bonus spin — the rest is "try again". */
const odds = (gift: number, freeSpin: number) => db.hotelSettings.updateMany({ data: { spinGiftChance: gift, spinFreeSpinChance: freeSpin } });
/** Only these menu items are gifts. */
async function gifts(...ids: string[]) {
  await db.spinPrize.deleteMany();
  await db.spinPrize.createMany({ data: ids.map((menuItemId) => ({ menuItemId, enabled: true })) });
}

/** A guest checked in to a room of this type, and that room's Spin QR. */
async function inHouse(typeCode = "DOUBLE_DELUXE", index = 0, name = "John Smith", phone = "0715 000 444") {
  const type = await roomType(typeCode);
  const room = [...type.rooms].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))[index];
  const t = today();
  await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
  const mgr = await managerActor();
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: name, phone, email: `${name.split(" ")[0].toLowerCase()}@example.com` }, stay: { kind: "overnight", arrivalDate: addDays(t, -1), departureDate: addDays(t, 1) },
    rooms: [{ roomTypeId: type.id, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
  }, mgr, zonedInstant(addDays(t, -1), 12 * 60, TZ));
  await checkIn(r.id, mgr, null, zonedInstant(addDays(t, -1), 15 * 60, TZ));
  await spinQrCodes();
  const qr = await db.spinQrCode.findUniqueOrThrow({ where: { roomId: room.id } });
  return { reservationId: r.id, roomId: room.id, roomNumber: room.number, token: qr.token };
}
const session = (roomId: string) => db.spinSession.findFirstOrThrow({ where: { roomId }, orderBy: { createdAt: "desc" }, include: { results: { orderBy: { spinNumber: "asc" } } } });
const giftOrders = () => db.restaurantOrder.findMany({ where: { isGift: true }, include: { items: true } });
/** Nothing of a gift is ever money: no charge on the room, no income, no payment. */
async function expectNoMoney(orderId: string) {
  expect(await db.reservationCharge.count({ where: { restaurantOrderId: orderId } })).toBe(0);
  expect(await db.revenueTransaction.count({ where: { restaurantOrderId: orderId } })).toBe(0);
  expect(await db.restaurantOrderPayment.count({ where: { orderId } })).toBe(0);
}

beforeEach(async () => {
  await resetBusinessData();
  await db.spinPrize.deleteMany();
  await db.menuItem.updateMany({ where: { id: { in: [WATER, CHAPATI, OMELETTE, WINGS, FRIES, PILAU] } }, data: { isAvailable: true, isActive: true } });
  // Only the items a test names are gifts.
  await db.hotelSettings.updateMany({ data: { ...SPIN_DEFAULTS, spinEnabled: true, spinMaxItemPrice: 0 } });
});
afterAll(async () => {
  await db.spinPrize.deleteMany();
  await db.hotelSettings.updateMany({ data: SPIN_DEFAULTS });
});

describe("who may spin", () => {
  it("nobody checked in: the card shows nothing and gives nothing", async () => {
    await gifts(WATER);
    await odds(100, 0);
    await spinQrCodes();
    const free = (await roomType("DOUBLE_DELUXE")).rooms[0];
    const qr = await db.spinQrCode.findUniqueOrThrow({ where: { roomId: free.id } });
    expect(await spinView(qr.token)).toEqual({ open: false });
    await expect(spinOnce(qr.token, key())).rejects.toThrow(/checked in/);
    await expect(sendGifts(qr.token, "ROOM", [])).rejects.toThrow(/checked in/);
    expect(await db.spinSession.count()).toBe(0);
    expect(await db.spinResult.count()).toBe(0);
    expect((await giftOrders()).length).toBe(0);
  });

  it("after check-out the card gives nothing more, and the next guest starts fresh", async () => {
    await gifts(WATER, CHAPATI);
    await odds(100, 0);
    const a = await inHouse();
    expect((await spinOnce(a.token, key())).kind).toBe("GIFT");
    await checkOut(a.reservationId, await managerActor(), { earlyReason: "Change of plans", allowBalance: true, overrideReason: "Test" });
    expect(await spinView(a.token)).toEqual({ open: false });
    await expect(spinOnce(a.token, key())).rejects.toThrow(/checked in/);
    await expect(sendGifts(a.token, "ROOM", [])).rejects.toThrow(/checked in/);
    expect((await giftOrders()).length).toBe(0);

    const b = await inHouse("DOUBLE_DELUXE", 0, "Mary Walker", "0754 111 222");
    expect(b.token).toBe(a.token);
    const view = await spinView(b.token);
    expect(view).toMatchObject({ open: true, spinsUsed: 0, prizesWon: 0, valueUsed: 0, spinsLeft: 5, bonus: "NONE", over: null });
    if (view.open) expect(view.gifts).toEqual([]);
  });

  it("switched off: nothing new can be spun", async () => {
    await gifts(WATER);
    await odds(100, 0);
    const a = await inHouse();
    await db.hotelSettings.updateMany({ data: { spinEnabled: false } });
    expect(await spinView(a.token)).toEqual({ open: false });
    await expect(spinOnce(a.token, key())).rejects.toThrow(/not running/);
    expect(await db.spinResult.count()).toBe(0);
  });
});

describe("two gifts at most", () => {
  it("two gifts on the first two spins end the game — and both go to the restaurant as ONE free order", async () => {
    await gifts(CHAPATI, OMELETTE);
    await odds(100, 0);
    const a = await inHouse();
    const one = await spinOnce(a.token, key());
    expect(one).toMatchObject({ kind: "GIFT", spinNumber: 1, prizesWon: 1, over: null, spinsLeft: 4 });
    // Nothing goes to the restaurant while the guest is still playing.
    expect((await giftOrders()).length).toBe(0);
    const two = await spinOnce(a.token, key());
    // The second gift is the other one, and together they are the whole budget: 4,000 + 6,000.
    expect(two).toMatchObject({ kind: "GIFT", spinNumber: 2, prizesWon: 2, valueUsed: 10000, budget: 10000, over: "PRIZES", spinsLeft: 0 });
    expect(new Set([one.gift!.name, two.gift!.name]).size).toBe(2);
    await expect(spinOnce(a.token, key())).rejects.toThrow(/complete/);
    const s = await session(a.roomId);
    expect(s).toMatchObject({ spinsUsed: 2, prizesWon: 2, valueUsed: 10000, endedWhy: "PRIZES" });
    expect(s.results.map((r) => r.prizeNumber)).toEqual([1, 2]);

    const sent = await sendGifts(a.token, "ROOM", []);
    expect(sent).toMatchObject({ sent: 2, skipped: 0 });
    const orders = await giftOrders();
    expect(orders.length).toBe(1);
    expect(orders[0]).toMatchObject({ number: sent.orderNumber, type: "ROOM_SERVICE", roomNumber: a.roomNumber, reservationId: a.reservationId, total: 0, paidAmount: 0, giftValue: 10000, status: "PENDING" });
    expect(orders[0].items.map((i) => [i.quantity, i.unitPrice, i.lineTotal])).toEqual([[1, 0, 0], [1, 0, 0]]);
    await expectNoMoney(orders[0].id);
    // Asked again (a second tap, a second phone): the same order.
    expect(await sendGifts(a.token, "RESTAURANT", [])).toMatchObject({ sent: 2, orderNumber: sent.orderNumber });
    expect((await giftOrders()).length).toBe(1);
    expect((await session(a.roomId)).results.every((r) => r.orderId === orders[0].id && r.fulfilment === "ROOM")).toBe(true);
  });

  it("a gift worth the whole budget ends the game: there is no second gift", async () => {
    await gifts(PILAU);
    await odds(100, 0);
    const a = await inHouse();
    expect(await spinOnce(a.token, key())).toMatchObject({ kind: "GIFT", prizesWon: 1, valueUsed: 10000, over: "BUDGET", spinsLeft: 0 });
    await expect(spinOnce(a.token, key())).rejects.toThrow(/complete/);
    expect(await session(a.roomId)).toMatchObject({ spinsUsed: 1, prizesWon: 1, endedWhy: "BUDGET" });
    expect(await spinView(a.token)).toMatchObject({ open: true, over: "BUDGET", spinsLeft: 0, wheel: [] });
  });

  it("a second gift is only ever one that fits what is left of the budget", async () => {
    await gifts(WATER, WINGS, FRIES);
    await odds(100, 0);
    for (let i = 0; i < 4; i++) {
      const a = await inHouse("DOUBLE_DELUXE", i, `Guest ${"ABCD"[i]}`, `0715 000 50${i}`);
      const one = await spinOnce(a.token, key());
      const two = await spinOnce(a.token, key());
      // 7,000 + 8,000 is over the 10,000 of a standard room: one of the two is always the water.
      expect(one.gift!.value + two.gift!.value).toBeLessThanOrEqual(10000);
      expect([one.gift!.value, two.gift!.value]).toContain(1500);
      expect(two).toMatchObject({ prizesWon: 2, over: "PRIZES" });
      expect((await session(a.roomId)).valueUsed).toBe(one.gift!.value + two.gift!.value);
    }
  });

  it("a premium room has the bigger budget: 7,000 + 8,000 fit", async () => {
    await gifts(WINGS, FRIES);
    await odds(100, 0);
    const a = await inHouse("EXECUTIVE");
    await spinOnce(a.token, key());
    expect(await spinOnce(a.token, key())).toMatchObject({ prizesWon: 2, budget: 15000, valueUsed: 15000, over: "PRIZES" });
    expect(await session(a.roomId)).toMatchObject({ tier: "PREMIUM", budget: 15000, valueUsed: 15000, endedWhy: "PRIZES" });
  });

  it("no thank you: a gift the guest does not want is left out of the order", async () => {
    await gifts(CHAPATI, OMELETTE);
    await odds(100, 0);
    const a = await inHouse();
    const one = await spinOnce(a.token, key());
    const two = await spinOnce(a.token, key());
    expect(await sendGifts(a.token, "RESTAURANT", [one.gift!.id])).toMatchObject({ sent: 1, skipped: 1 });
    const orders = await giftOrders();
    expect(orders.length).toBe(1);
    expect(orders[0]).toMatchObject({ type: "DINE_IN", total: 0, giftValue: two.gift!.value });
    expect(orders[0].items.map((i) => i.name)).toEqual([two.gift!.name]);
    const rows = (await session(a.roomId)).results;
    expect(rows.map((r) => r.fulfilment)).toEqual(["DECLINED", "RESTAURANT"]);
    expect(rows[0].orderId).toBeNull();
  });

  it("finish early: sending the first gift ends the game, the other spins are not used", async () => {
    await gifts(WATER, CHAPATI);
    await odds(100, 0);
    const a = await inHouse();
    await spinOnce(a.token, key());
    expect(await sendGifts(a.token, "ROOM", [])).toMatchObject({ sent: 1, skipped: 0 });
    expect(await session(a.roomId)).toMatchObject({ spinsUsed: 1, prizesWon: 1, endedWhy: "GUEST" });
    await expect(spinOnce(a.token, key())).rejects.toThrow(/complete/);
    expect(await spinView(a.token)).toMatchObject({ open: true, over: "GUEST", spinsLeft: 0 });
    expect((await giftOrders()).length).toBe(1);
  });

  it("a gift the phone has not shown yet is never sent unseen: the guest looks again", async () => {
    await gifts(CHAPATI, OMELETTE);
    await odds(100, 0);
    const a = await inHouse();
    const one = await spinOnce(a.token, key());
    await spinOnce(a.token, key()); // won on a second phone — this phone still shows the first gift only
    await expect(sendGifts(a.token, "RESTAURANT", [one.gift!.id], new Date(), null, [one.gift!.id])).rejects.toThrow(/another gift/);
    expect((await giftOrders()).length).toBe(0);
    expect((await session(a.roomId)).results.map((r) => r.fulfilment)).toEqual([null, null]);
    // With both in front of them, the guest's answer stands.
    const both = (await session(a.roomId)).results.map((r) => r.id);
    expect(await sendGifts(a.token, "RESTAURANT", both, new Date(), null, both)).toMatchObject({ sent: 0, skipped: 2, orderNumber: null });
    expect((await giftOrders()).length).toBe(0);
  });
});

describe("what staff see", () => {
  const card = async (roomId: string) => (await spinQrCodes()).find((r) => r.id === roomId)!.session;

  it("the room card counts the bonus spin as a spin, and only the gifts the guest took", async () => {
    await gifts(CHAPATI, OMELETTE);
    await odds(0, 100);
    const a = await inHouse();
    await spinOnce(a.token, key());
    expect(await card(a.roomId)).toMatchObject({ spinsUsed: 1, spinsAllowed: 6, gifts: 0 });
    await odds(100, 0);
    const one = await spinOnce(a.token, key());
    await spinOnce(a.token, key());
    expect(await card(a.roomId)).toMatchObject({ spinsUsed: 3, spinsAllowed: 6, gifts: 2 });
    await sendGifts(a.token, "ROOM", [one.gift!.id]);
    expect(await card(a.roomId)).toMatchObject({ gifts: 1 });
    expect((await card(a.roomId))!.endedAt).not.toBeNull();
  });

  it("a gift left behind at check-out was never given: it is not in the totals", async () => {
    await gifts(FRIES);
    await odds(100, 0);
    const a = await inHouse();
    await spinOnce(a.token, key());
    // Still in the hotel: the gift is waiting, and counted.
    expect((await spinBoard()).given.today).toEqual({ count: 1, value: 8000 });
    await checkOut(a.reservationId, await managerActor(), { earlyReason: "Change of plans", allowBalance: true, overrideReason: "Test" });
    const board = await spinBoard();
    expect(board.given.today).toEqual({ count: 0, value: 0 });
    expect(board.given.month).toEqual({ count: 0, value: 0 });
    expect(board.unclaimed).toEqual([]);
    expect(board.recent[0].session.reservationRoom.status).toBe("CHECKED_OUT");
  });

  it("gifts sent to the restaurant stay in the totals after the guest has left; refused ones never count", async () => {
    await gifts(CHAPATI, OMELETTE);
    await odds(100, 0);
    const a = await inHouse();
    const one = await spinOnce(a.token, key());
    const two = await spinOnce(a.token, key());
    await sendGifts(a.token, "ROOM", [one.gift!.id]);
    await checkOut(a.reservationId, await managerActor(), { earlyReason: "Change of plans", allowBalance: true, overrideReason: "Test" });
    expect((await spinBoard()).given.today).toEqual({ count: 1, value: two.gift!.value });
  });
});

describe("try again and the bonus spin", () => {
  it("try again every time: five spins, then the game is over — nothing is ordered", async () => {
    await gifts(WATER);
    await odds(0, 0);
    const a = await inHouse();
    const outs = [];
    for (let i = 0; i < 5; i++) outs.push(await spinOnce(a.token, key()));
    expect(outs.map((o) => o.kind)).toEqual(Array(5).fill("TRY_AGAIN"));
    expect(outs.map((o) => o.spinsLeft)).toEqual([4, 3, 2, 1, 0]);
    expect(outs.map((o) => o.over)).toEqual([null, null, null, null, "SPINS"]);
    expect(outs.every((o) => o.gift === null)).toBe(true);
    await expect(spinOnce(a.token, key())).rejects.toThrow(/complete/);
    await expect(sendGifts(a.token, "ROOM", [])).rejects.toThrow(/no gift/);
    expect((await giftOrders()).length).toBe(0);
    expect(await session(a.roomId)).toMatchObject({ spinsUsed: 5, prizesWon: 0, valueUsed: 0, endedWhy: "SPINS" });
  });

  it("the bonus spin comes once, is one extra spin, and never comes a second time", async () => {
    await gifts(WATER);
    await odds(0, 100);
    const a = await inHouse();
    const first = await spinOnce(a.token, key());
    // Not a gift, not an order: one more spin, on top of the four that are left.
    expect(first).toMatchObject({ kind: "FREE_SPIN", gift: null, bonus: "AVAILABLE", spinsUsed: 1, spinsLeft: 5, prizesWon: 0, valueUsed: 0, over: null });
    const rest = [];
    for (let i = 0; i < 5; i++) rest.push(await spinOnce(a.token, key()));
    // Every later spin says try again — the bonus spin is not on the wheel any more.
    expect(rest.map((o) => o.kind)).toEqual(Array(5).fill("TRY_AGAIN"));
    expect(rest.every((o) => o.wheel.every((seg) => seg.kind !== "FREE_SPIN"))).toBe(true);
    expect(rest.map((o) => o.bonusSpin)).toEqual([false, false, false, false, true]);
    expect(rest[3]).toMatchObject({ spinsUsed: 5, spinsLeft: 1, bonus: "AVAILABLE", over: null });
    expect(rest[4]).toMatchObject({ spinNumber: 6, spinsUsed: 5, spinsLeft: 0, bonus: "USED", over: "SPINS" });
    await expect(spinOnce(a.token, key())).rejects.toThrow(/complete/);
    const s = await session(a.roomId);
    expect(s).toMatchObject({ spinsUsed: 5, bonusAwarded: true, bonusUsed: true, endedWhy: "SPINS" });
    expect(s.results.filter((r) => r.kind === "FREE_SPIN").length).toBe(1);
    expect(s.results.length).toBe(6);
    expect((await giftOrders()).length).toBe(0);
  });

  it("a bonus spin won on the fifth spin can still be played, and its gift counts", async () => {
    await gifts(WATER);
    await odds(0, 0);
    const a = await inHouse();
    for (let i = 0; i < 4; i++) await spinOnce(a.token, key());
    await odds(0, 100);
    expect(await spinOnce(a.token, key())).toMatchObject({ kind: "FREE_SPIN", spinNumber: 5, spinsUsed: 5, spinsLeft: 1, bonus: "AVAILABLE", over: null });
    await odds(100, 0);
    const last = await spinOnce(a.token, key());
    expect(last).toMatchObject({ kind: "GIFT", spinNumber: 6, bonusSpin: true, prizesWon: 1, valueUsed: 1500, bonus: "USED", spinsLeft: 0, over: "SPINS" });
    expect(await sendGifts(a.token, "ROOM", [])).toMatchObject({ sent: 1 });
    const orders = await giftOrders();
    expect(orders.length).toBe(1);
    expect(orders[0]).toMatchObject({ giftValue: 1500, total: 0 });
  });

  it("two gifts before the bonus spin is played: the game is over, the bonus spin is gone", async () => {
    await gifts(WATER, CHAPATI);
    await odds(0, 100);
    const a = await inHouse();
    expect((await spinOnce(a.token, key())).kind).toBe("FREE_SPIN");
    await odds(100, 0);
    await spinOnce(a.token, key());
    expect(await spinOnce(a.token, key())).toMatchObject({ kind: "GIFT", prizesWon: 2, over: "PRIZES", spinsLeft: 0, bonus: "AVAILABLE" });
    await expect(spinOnce(a.token, key())).rejects.toThrow(/complete/);
    expect(await session(a.roomId)).toMatchObject({ spinsUsed: 3, bonusAwarded: true, bonusUsed: false, prizesWon: 2, endedWhy: "PRIZES" });
    expect(await spinView(a.token)).toMatchObject({ open: true, over: "PRIZES", spinsLeft: 0, wheel: [] });
  });
});

describe("one spin is one spin", () => {
  it("opening the page again changes nothing; the same tap asked twice is the same spin", async () => {
    await gifts(WATER, CHAPATI);
    await odds(100, 0);
    const a = await inHouse();
    const k = key();
    const one = await spinOnce(a.token, k);
    const again = await spinOnce(a.token, k);
    expect(again).toMatchObject({ kind: one.kind, spinNumber: 1, index: one.index, prizesWon: 1, valueUsed: one.valueUsed });
    expect(again.gift).toMatchObject({ id: one.gift!.id, name: one.gift!.name, value: one.gift!.value });
    expect(again.wheel).toEqual(one.wheel);
    const v1 = await spinView(a.token);
    const v2 = await spinView(a.token);
    expect(v2).toEqual(v1);
    expect(v1).toMatchObject({ open: true, spinsUsed: 1, prizesWon: 1, spinsLeft: 4, over: null });
    expect(await db.spinResult.count()).toBe(1);
  });

  it("the same tap sent twice at once is one spin", async () => {
    await gifts(WATER, CHAPATI);
    await odds(100, 0);
    const a = await inHouse();
    const k = key();
    const [x, y] = await Promise.all([spinOnce(a.token, k), spinOnce(a.token, k)]);
    expect(y).toMatchObject({ spinNumber: x.spinNumber, kind: x.kind, index: x.index });
    expect(y.gift!.id).toBe(x.gift!.id);
    expect(await db.spinResult.count()).toBe(1);
    expect(await session(a.roomId)).toMatchObject({ spinsUsed: 1, prizesWon: 1 });
  });

  it("two phones on the last spin: one of them spins, the other is told the game is complete", async () => {
    await gifts(WATER);
    await odds(0, 0);
    const a = await inHouse();
    for (let i = 0; i < 4; i++) await spinOnce(a.token, key());
    const both = await Promise.allSettled([spinOnce(a.token, key()), spinOnce(a.token, key())]);
    expect(both.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(both.filter((r) => r.status === "rejected").length).toBe(1);
    const s = await session(a.roomId);
    expect(s).toMatchObject({ spinsUsed: 5, endedWhy: "SPINS" });
    expect(s.results.length).toBe(5);
  });

  it("two phones on the second gift: two gifts, never three", async () => {
    await gifts(WATER, CHAPATI, OMELETTE);
    await odds(100, 0);
    const a = await inHouse();
    await spinOnce(a.token, key());
    const both = await Promise.allSettled([spinOnce(a.token, key()), spinOnce(a.token, key())]);
    expect(both.filter((r) => r.status === "fulfilled").length).toBe(1);
    const s = await session(a.roomId);
    expect(s).toMatchObject({ spinsUsed: 2, prizesWon: 2, endedWhy: "PRIZES" });
    expect(s.valueUsed).toBeLessThanOrEqual(s.budget);
    // Both phones sending at once: still one order.
    await Promise.allSettled([sendGifts(a.token, "ROOM", []), sendGifts(a.token, "ROOM", [])]);
    expect((await giftOrders()).length).toBe(1);
  });

  it("nothing to give right now: the spin is not used", async () => {
    await gifts(WATER);
    await odds(100, 0);
    await db.menuItem.update({ where: { id: WATER }, data: { isAvailable: false } });
    const a = await inHouse();
    await expect(spinOnce(a.token, key())).rejects.toThrow(/has not been used/);
    expect(await db.spinResult.count()).toBe(0);
    expect(await spinView(a.token)).toMatchObject({ open: true, noGift: true, spinsUsed: 0, spinsLeft: 5, over: null });
    await db.menuItem.update({ where: { id: WATER }, data: { isAvailable: true } });
    expect((await spinOnce(a.token, key())).kind).toBe("GIFT");
  });
});
