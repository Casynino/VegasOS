import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { ordersBoard } from "@/server/services/restaurant";
import { orderByTrackToken, placeOnlineOrder } from "@/server/services/online-orders";
import { addItemsByTrackToken } from "@/server/services/restaurant-locations";
import { toPortalOrders } from "@/app/staff/(app)/restaurant/portal/data";
import { orderItemName } from "@/i18n/content";
import { englishT, makeT } from "@/i18n/translate";
import { businessDateOf } from "@/lib/time/business-date";
import { resetBusinessData } from "../support/helpers";

/**
 * One order, a language per person (owner, 2026-10-06): a Chinese customer orders in Chinese; the kitchen reads the
 * very same order in English; the customer keeps seeing it in Chinese — and an old order never changes when the menu
 * or its translation changes later.
 */

const BIRYANI = "mi_main_courses_chicken_biryani";
const ZH = "鸡肉印度香饭";
const NOTE = "不要太辣，谢谢！ Please hurry";
const zhT = makeT("zh-CN", {});
const today = () => businessDateOf(new Date());
let n = 0;
const key = () => `${(++n).toString(16).padStart(8, "0")}${"c".repeat(24)}`;
let original: { name: string; isAvailable: boolean; isActive: boolean } | null = null;
let savedZh: { name: string | null; description: string | null } | null = null;

beforeEach(async () => {
  await resetBusinessData();
  const item = await db.menuItem.findUniqueOrThrow({ where: { id: BIRYANI } });
  original = { name: item.name, isAvailable: item.isAvailable, isActive: item.isActive };
  const before = await db.menuItemTranslation.findUnique({ where: { parentId_locale: { parentId: BIRYANI, locale: "zh-CN" } } });
  savedZh = before ? { name: before.name, description: before.description } : null;
  await db.menuItem.update({ where: { id: BIRYANI }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { publicOrderingEnabled: true } });
  await db.menuItemTranslation.upsert({
    where: { parentId_locale: { parentId: BIRYANI, locale: "zh-CN" } },
    create: { parentId: BIRYANI, locale: "zh-CN", name: ZH }, update: { name: ZH },
  });
});

afterEach(async () => {
  // The menu is shared seed data: put it back as it was.
  if (original) await db.menuItem.update({ where: { id: BIRYANI }, data: original });
  if (savedZh) await db.menuItemTranslation.update({ where: { parentId_locale: { parentId: BIRYANI, locale: "zh-CN" } }, data: savedZh });
  else await db.menuItemTranslation.deleteMany({ where: { parentId: BIRYANI, locale: "zh-CN" } });
});

/** A Chinese customer (their language saved on their record) orders from the menu: eat here, pay after. */
async function chineseOrder(noteCodes: string[] = []) {
  await db.guest.create({ data: { fullName: "Li Wei", phone: "+255766123456", preferredLanguage: "zh-CN" } });
  return placeOnlineOrder({
    clientKey: key(), items: [{ menuItemId: BIRYANI, quantity: 2 }], name: "Li Wei", phone: "0766 123 456", kind: "DINE_IN",
    notes: NOTE, noteCodes,
  });
}

describe("restaurant orders across languages", () => {
  it("the line keeps the dish's Chinese name when ordered; the kitchen reads English, the customer Chinese", async () => {
    const o = await chineseOrder();
    const [line] = await db.restaurantOrderItem.findMany({ where: { orderId: o.id } });
    expect(line.name).toBe(original!.name); // the English stays the record's own name
    expect(line.nameI18n).toMatchObject({ "zh-CN": ZH });

    // The kitchen / board for an English-speaking staff member: the English name.
    const board = (await ordersBoard(today())).find((x) => x.id === o.id)!;
    expect(orderItemName(board.items[0], englishT)).toBe(original!.name);
    const [card] = toPortalOrders([board], { seesMoney: false, waiter: false, settings: await getSettings(), origin: "https://example.test" });
    expect(card.items[0]).toMatchObject({ name: original!.name, nameI18n: { "zh-CN": ZH } });
    expect(orderItemName(card.items[0], englishT)).toBe(original!.name);
    // …and the same line for the Chinese customer: their language.
    expect(orderItemName(card.items[0], zhT)).toBe(ZH);
    const tracked = await orderByTrackToken(o.trackToken!);
    expect(orderItemName(tracked!.items[0], zhT)).toBe(ZH);
  });

  it("renaming the dish or changing its translation later never changes an old order", async () => {
    const o = await chineseOrder();
    await db.menuItem.update({ where: { id: BIRYANI }, data: { name: "Chicken Biryani Royale" } });
    await db.menuItemTranslation.update({ where: { parentId_locale: { parentId: BIRYANI, locale: "zh-CN" } }, data: { name: "皇家鸡肉饭" } });
    const [line] = await db.restaurantOrderItem.findMany({ where: { orderId: o.id } });
    expect(line.name).toBe(original!.name);
    expect(line.nameI18n).toMatchObject({ "zh-CN": ZH });
    expect(orderItemName(line, zhT)).toBe(ZH);
    expect(orderItemName(line, englishT)).toBe(original!.name);

    // More from the customer's own link: the new line is named as the menu is NOW; the first line is untouched.
    await addItemsByTrackToken(o.trackToken!, [{ menuItemId: BIRYANI, quantity: 1 }]);
    const lines = await db.restaurantOrderItem.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } });
    expect(lines).toHaveLength(2);
    const added = lines.find((l) => l.round === 2 || l.id !== line.id)!;
    expect(added.name).toBe("Chicken Biryani Royale");
    expect(added.nameI18n).toMatchObject({ "zh-CN": "皇家鸡肉饭" });
    expect(lines.find((l) => l.id === line.id)).toMatchObject({ name: original!.name, nameI18n: { "zh-CN": ZH } });
  });

  it("ticked requests are stored as known codes only; the customer's own words exactly as typed", async () => {
    const o = await chineseOrder(["NOT_SPICY", "NOT_A_REAL_CODE", "NO_ONION", "NO_ONION", "<script>"]);
    const saved = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(saved.noteCodes).toEqual(["NO_ONION", "NOT_SPICY"]); // unknown dropped, once each, in the list's order
    expect(saved.notes).toBe(NOTE);
    expect((await orderByTrackToken(o.trackToken!))!.noteCodes).toEqual(["NO_ONION", "NOT_SPICY"]);
  });

  it("one order, no money moved: no extra orders, payments or sales", async () => {
    const o = await chineseOrder(["NO_ICE"]);
    expect(await db.restaurantOrder.count()).toBe(1);
    expect(o).toMatchObject({ settlement: "UNPAID", paymentStatus: "UNPAID", paidAmount: 0 });
    expect(await db.restaurantOrderPayment.count({ where: { orderId: o.id } })).toBe(0);
    expect(await db.revenueTransaction.count({ where: { restaurantOrderId: o.id } })).toBe(0);
    expect(await db.reservationCharge.count({ where: { restaurantOrderId: o.id } })).toBe(0);
    // The customer's language is left as they chose it.
    expect((await db.guest.findUniqueOrThrow({ where: { id: o.guestId! } })).preferredLanguage).toBe("zh-CN");
  });
});
