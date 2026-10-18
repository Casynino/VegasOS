import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock, notFound: () => { throw new Error("not found"); }, useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), after: () => undefined }));

import { db, rawDb } from "@/server/db";
import { cancelRestaurantOrder, createRestaurantOrder, ordersBoard, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { seatCustomer, sessionById, tableFloor, withoutMoney, addSessionMember } from "@/server/services/dining-sessions";
import { developerMarks } from "@/server/services/developer-marks";
import { eventDoneBy, ORDER_MARK_ACTIONS, orderMarks, stepDoneBy } from "@/server/services/order-done-by";
import { messageDoneBy } from "@/server/services/guest-message-marks";
import { portalDoneBy, toPortalOrders } from "@/app/staff/(app)/restaurant/portal/data";
import { ActivityFeed, type FeedEvent } from "@/app/staff/(app)/restaurant/portal/activity-feed";
import { OrderCard } from "@/app/staff/(app)/restaurant/portal/order-card";
import { Timeline } from "@/app/staff/(app)/restaurant/tables/tables-board";
import { GuestMessenger } from "@/components/staff/reception/guest-messenger";
import OrderHistoryPage from "@/app/staff/(app)/restaurant/orders/[id]/page";
import OrderHistoryListPage from "@/app/staff/(app)/restaurant/history/page";
import RestaurantPortalPage from "@/app/staff/(app)/restaurant/page";
import SettingsPage from "@/app/staff/(app)/settings/page";
import { GuestProfile } from "@/app/staff/(app)/guests/[id]/guest-profile";
import { getCurrentUser } from "@/server/auth";
import { auditWho, plainWho } from "@/lib/audit-who";
import { doneByText } from "@/lib/done-by-text";
import { getSettings, businessToday } from "@/server/settings";
import { makeT } from "@/i18n/translate";
import zhFixes from "@/i18n/catalog/zh-CN/staff/developer-fixes";
import { chefActor, managerActor, resetBusinessData, waiterActor } from "../support/helpers";
import { browser, makeSession, makeUser, removeMadeUsers, sha256, type MadeUser } from "../support/developer";

/**
 * "Done by Developer" on the restaurant's lines (owner, 2026-10-18): the order's history, the manager's live feed, the portal cards, the order
 * list, a table's timeline and a guest message's "sent by". The AUDIT ROW is the mark; the stored people (accepted by, served by, "by" in the
 * history, the message's sender) never change, and the tag is a separate element next to the name.
 */
const SAFARI = "mi_beers_safari";
const PHONE = "+255 712 555 010";
const t = makeT("en", null);
const zh = makeT("zh-CN", zhFixes);
const DAY = new Date("2041-05-05T00:00:00Z");
const NINO = "Nino (Developer)";

/** A Developer's audit row, written as asWhoReallyActed writes it: the DEVELOPER's label "Nino (Developer) as Neema (Role)" and after.actingAs. */
const devRow = (entityType: string, entityId: string, action: string, at: Date, as: { name: string; role: string }, over: Record<string, unknown> = {}) => db.auditLog.create({
  data: {
    entityType, entityId, action, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: `${NINO} as ${as.name} (${as.role})`,
    after: { actingAs: { id: `u-${as.name}`, name: as.name, role: as.role } }, businessDate: DAY, createdAt: at, ...over,
  } as never,
});
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const count = (html: string, text: string) => html.split(text).length - 1;
/** The first React element in a tree (found without drawing it) whose props satisfy the test. */
function findElement(node: unknown, test: (props: Record<string, unknown>) => boolean): { props: { children?: never } } | null {
  if (Array.isArray(node)) { for (const n of node) { const f = findElement(n, test); if (f) return f; } return null; }
  if (!node || typeof node !== "object" || !("props" in node)) return null;
  const props = (node as { props: Record<string, unknown> }).props;
  return test(props) ? (node as never) : findElement(props.children, test);
}
const noBadWords = (html: string) => { expect(html).not.toContain("undefined"); expect(html).not.toContain("NaN"); };

let owner: MadeUser;
beforeAll(async () => { owner = await makeUser("OWNER", { fullName: "Boss Owner" }); });
afterAll(async () => { browser.reset(); await removeMadeUsers(); });

/** One order lived through: made by the waiter, accepted and made ready by the cook, taken out and served by the waiter. */
async function lifeOfAnOrder(start = new Date()) {
  const [chef, waiter] = [await chefActor(), await waiterActor()];
  const at = (m: number) => plus(start, m * 60_000);
  const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_3", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, at(0), { customerPhone: PHONE });
  await setOrderStatus(o.id, "PREPARING", chef, at(1));
  for (const i of await db.restaurantOrderItem.findMany({ where: { orderId: o.id, preparedAt: null } })) await setOrderItemPrepared(o.id, i.id, true, chef, at(1));
  await setOrderStatus(o.id, "READY", chef, at(2));
  await setOrderStatus(o.id, "OUT_FOR_DELIVERY", waiter, at(3));
  await setOrderStatus(o.id, "DELIVERED", waiter, at(4));
  const order = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id }, include: { events: { orderBy: { at: "asc" } } } });
  return { order, chef, waiter, at };
}
const eventTo = <E extends { to: string }>(order: { events: E[] }, to: string): E => order.events.find((e) => e.to === to)!;

describe("a restaurant order's lines (the audit row of each step is the mark)", () => {
  beforeEach(async () => { await resetBusinessData(); });

  it("a step the Developer made as the cook says so; the steps staff made themselves do not; money is never marked", async () => {
    const { order, chef, waiter } = await lifeOfAnOrder();
    const ready = eventTo(order, "READY"), served = eventTo(order, "DELIVERED");
    await devRow("RestaurantOrder", order.id, "restaurant_order.status", plus(ready.at, 40), { name: chef.label!, role: "Mpishi" });
    await devRow("RestaurantOrder", order.id, "restaurant_order.status", plus(served.at, 25), { name: waiter.label!, role: "Waiter" });
    // A payment the Developer cannot make but whose row would be here: never selected, so never a mark.
    await devRow("RestaurantOrder", order.id, "restaurant_order.paid", plus(served.at, 30), { name: waiter.label!, role: "Waiter" });
    await devRow("RestaurantOrder", order.id, "restaurant_order.payment_confirmed", plus(served.at, 30), { name: waiter.label!, role: "Waiter" });

    const marks = await orderMarks([order.id]);
    expect(marks.get(order.id)!.map((m) => m.action).sort()).toEqual(["restaurant_order.status", "restaurant_order.status"]);
    expect(ORDER_MARK_ACTIONS.some((a) => /paid|payment|discount|charged|billing/.test(a))).toBe(false);

    const tagOf = (to: string) => eventDoneBy(marks, t, order.id, eventTo(order, to));
    expect(tagOf("READY")).toBe(`Done by Developer · as ${chef.label}`);
    expect(tagOf("DELIVERED")).toBe(`Done by Developer · as ${waiter.label}`);
    for (const to of ["PREPARING", "OUT_FOR_DELIVERY"]) expect(tagOf(to), to).toBeNull();
    // the order's own creation line (made by the waiter, a plain staff row) is not marked either
    expect(eventDoneBy(marks, t, order.id, order.events.find((e) => e.from == null)!)).toBeNull();
    // the stored people are the staff members' own, untouched by the mark
    const stored = await db.restaurantOrder.findUniqueOrThrow({ where: { id: order.id }, include: { readyBy: { select: { fullName: true } }, deliveredBy: { select: { fullName: true } } } });
    expect(stored.readyBy!.fullName).toBe(chef.label);
    expect(stored.deliveredBy!.fullName).toBe(waiter.label);
    expect(order.events.find((e) => e.to === "READY")!.byLabel).toBe(chef.label);
  });

  it("only the right kind of row at the right time by the right person marks a line", async () => {
    const { order, chef } = await lifeOfAnOrder();
    const ready = eventTo(order, "READY");
    // a minute away: not this step
    await devRow("RestaurantOrder", order.id, "restaurant_order.status", plus(ready.at, 60_000), { name: chef.label!, role: "Mpishi" });
    // right moment but another person's: not this line
    await devRow("RestaurantOrder", order.id, "restaurant_order.status", plus(ready.at, 20), { name: "Somebody Else", role: "Waiter" });
    // right moment, right person, but another KIND of step: a cancel is not "ready"
    await devRow("RestaurantOrder", order.id, "restaurant_order.cancelled", plus(ready.at, 20), { name: chef.label!, role: "Mpishi" });
    const marks = await orderMarks([order.id]);
    expect(eventDoneBy(marks, t, order.id, ready)).toBeNull();
    expect(stepDoneBy(marks, t, order.id, ready.at, { actions: ["restaurant_order.status"], by: chef.label })).toBeNull();
    expect(stepDoneBy(marks, t, order.id, null, {})).toBeNull();
    // the same row seen by a line with no name argument is a match (an unknown name does not argue)
    expect(stepDoneBy(marks, t, order.id, plus(ready.at, 60_000), { actions: ["restaurant_order.status"] })).toBe(`Done by Developer · as ${chef.label}`);
  });

  it("a lookup that fails shows no tag and no error", async () => {
    // A NUL byte in an id is refused by the database itself: the plain lookup throws, the screens' lookups swallow it.
    await expect(developerMarks("RestaurantOrder", ["bad\u0000id"])).rejects.toThrow();
    expect((await orderMarks(["bad\u0000id"])).size).toBe(0);
    expect(await messageDoneBy(t, [{ id: "m", guestId: "bad\u0000id", reservationId: null, type: "CUSTOM", createdAt: new Date(), sentBy: { fullName: "Neema" } }])).toEqual(new Map());
  });

  it("the first tick of the cook is audited as the step 'started preparing' — once per order — and a Developer working as the cook is marked", async () => {
    const [chef, waiter] = [await chefActor(), await waiterActor()];
    const make = async () => {
      const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_3", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 2 }, { menuItemId: "mi_main_courses_chicken_biryani", quantity: 1 }] }, waiter, new Date(), { customerPhone: PHONE });
      await setOrderStatus(o.id, "ACCEPTED", chef);
      return { o, items: await db.restaurantOrderItem.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } }) };
    };
    const rowsOf = (orderId: string) => db.auditLog.findMany({ where: { entityType: "RestaurantOrder", entityId: orderId, action: "restaurant_order.item_prepared" } });

    browser.reset();
    const own = await make();
    const dev1 = await make();
    // The cook on their own account: one audit row for the first tick, none for the next ones.
    await setOrderItemPrepared(own.o.id, own.items[0].id, true, chef);
    await setOrderItemPrepared(own.o.id, own.items[1].id, true, chef);
    const ownRows = await rowsOf(own.o.id);
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0]).toMatchObject({ actorType: "STAFF", userId: chef.userId, after: { status: "PREPARING", item: own.items[0].id } });
    expect((await orderMarks([own.o.id])).size).toBe(0);

    // The Developer working as the cook: the same call, written as what really happened.
    const dev = await makeUser("DEVELOPER", { fullName: "Nino Dev" });
    const token = await makeSession(dev.id, { createdMinAgo: 1, seenMinAgo: 0 });
    await rawDb.session.update({ where: { tokenHash: sha256(token) }, data: { workAsUserId: chef.userId!, workAsStartedAt: new Date(Date.now() - 60_000) } });
    await setOrderItemPrepared(dev1.o.id, dev1.items[0].id, true, chef);
    browser.reset();
    const devRows = await rowsOf(dev1.o.id);
    expect(devRows).toHaveLength(1);
    expect(devRows[0]).toMatchObject({ actorType: "DEVELOPER", userId: dev.id, after: { status: "PREPARING", actingAs: { id: chef.userId, name: chef.label } } });
    expect(devRows[0].actorLabel).toMatch(/^Nino Dev \(Developer\) as /);

    const stored = await db.restaurantOrder.findUniqueOrThrow({ where: { id: dev1.o.id }, include: { events: { orderBy: { at: "asc" } } } });
    const started = stored.events.find((e) => e.to === "PREPARING")!;
    expect(started.byId).toBe(chef.userId); // the hotel's own record stays the cook's
    const marks = await orderMarks([dev1.o.id, own.o.id]);
    expect(eventDoneBy(marks, t, dev1.o.id, started)).toBe(`Done by Developer · as ${chef.label}`);
    const ownStarted = (await db.restaurantOrderEvent.findMany({ where: { orderId: own.o.id, to: "PREPARING" } }))[0];
    expect(eventDoneBy(marks, t, own.o.id, ownStarted)).toBeNull();
  });
});

describe("the portal cards, the order's page, the list and the manager's feed", () => {
  beforeEach(async () => { await resetBusinessData(); browser.reset(); });

  it("the card's data carries the tags next to the stored people, which stay plain names", async () => {
    const { order, chef, waiter } = await lifeOfAnOrder();
    await devRow("RestaurantOrder", order.id, "restaurant_order.status", plus(eventTo(order, "READY").at, 30), { name: chef.label!, role: "Mpishi" });
    await devRow("RestaurantOrder", order.id, "restaurant_order.created", plus(order.createdAt, 30), { name: waiter.label!, role: "Waiter" });
    const board = (await ordersBoard(await businessToday())).find((x) => x.id === order.id)!;
    const marks = await orderMarks([order.id]);

    expect(portalDoneBy(marks, t, board)).toEqual({ created: `Done by Developer · as ${waiter.label}`, accepted: null, ready: `Done by Developer · as ${chef.label}`, taken: null, delivered: null });
    const settings = await getSettings();
    const [card] = toPortalOrders([board], { seesMoney: true, waiter: true, settings, origin: "https://x.test", doneBy: { t, marks } });
    expect(card.readyBy).toBe(chef.label);        // the stored name, no bracket, no tag inside it
    expect(card.createdBy).toBe(waiter.label);
    expect(card.doneBy?.ready).toBe(`Done by Developer · as ${chef.label}`);
    // without the marks (or with none) there is simply no tag
    expect(toPortalOrders([board], { seesMoney: true, waiter: true, settings, origin: "https://x.test" })[0].doneBy).toBeNull();
    expect(portalDoneBy(new Map(), t, board)).toBeNull();
    // in 中文 the same tag, in Chinese
    expect(portalDoneBy(marks, zh, board)!.ready).toBe(`由开发者操作 · 以 ${chef.label} 的身份`);
  });

  it("the card under the order: the tag of the last person sits beside the name, in English and 中文, and nothing without a mark", async () => {
    const { order, waiter } = await lifeOfAnOrder();
    await devRow("RestaurantOrder", order.id, "restaurant_order.status", plus(eventTo(order, "DELIVERED").at, 25), { name: waiter.label!, role: "Waiter" });
    const board = (await ordersBoard(await businessToday())).find((x) => x.id === order.id)!;
    const marks = await orderMarks([order.id]);
    const settings = await getSettings();
    const build = (tt: typeof t) => toPortalOrders([board], { seesMoney: true, waiter: false, settings, origin: "https://x.test", doneBy: { t: tt, marks } })[0];
    const perms = { cook: false, bar: false, waiter: false, serve: false, pay: false, confirm: false, cancelLate: false, manage: false, watch: true };
    const draw = (o: ReturnType<typeof build>) => renderToStaticMarkup(createElement(OrderCard, { o, perms, now: Date.now(), fresh: false, accounts: [], rooms: [] }));
    const html = draw(build(t));
    expect(count(html, `Done by Developer · as ${waiter.label}`)).toBe(1);
    noBadWords(html);
    expect(count(draw(build(zh)), `由开发者操作 · 以 ${waiter.label} 的身份`)).toBe(1);
    const bare = draw({ ...build(t), doneBy: null });
    expect(bare).not.toContain("Done by Developer");
    noBadWords(bare);
  });

  it("the restaurant page hands the feed and the cards their tags (a manager's view), and the same page without a mark hands none", async () => {
    const { order, chef } = await lifeOfAnOrder();
    await devRow("RestaurantOrder", order.id, "restaurant_order.status", plus(eventTo(order, "READY").at, 30), { name: chef.label!, role: "Mpishi" });
    await makeSession(owner.id);
    const props = async () => {
      const root = (await RestaurantPortalPage()) as { props: { children: { props: { activity: { props: { events: FeedEvent[] } }; orders: { id: string; readyBy: string | null; doneBy: { ready: string | null } | null }[] } } } };
      const portal = root.props.children.props;
      return { feed: portal.activity.props.events, card: portal.orders.find((o) => o.id === order.id)! };
    };
    const { feed, card } = await props();
    const ready = feed.find((e) => e.orderId === order.id && e.to === "READY")!;
    expect(ready.doneBy).toBe(`Done by Developer · as ${chef.label}`);
    expect(ready.who).toBe(chef.label);
    expect(feed.filter((e) => e.doneBy)).toHaveLength(1);
    expect(card.doneBy?.ready).toBe(`Done by Developer · as ${chef.label}`);
    expect(card.readyBy).toBe(chef.label);
    await db.$executeRawUnsafe(`TRUNCATE "audit_logs" CASCADE`);
    const bare = await props();
    expect(bare.feed.some((e) => e.doneBy)).toBe(false);
    expect(bare.card.doneBy).toBeNull();
  });

  it("the manager's live feed: the tag sits next to the name, in English and in 中文; the name is untouched", async () => {
    const ev = (over: Partial<FeedEvent> = {}): FeedEvent => ({ id: "e1", at: new Date().toISOString(), time: "10:05", who: "Neema", role: "Waiter", from: "READY", to: "OUT_FOR_DELIVERY", note: null, orderId: "o1", number: "ORD-2041-0007", place: "Table 3", items: 2, drinksOnly: false, ...over });
    const draw = async (events: FeedEvent[]) => renderToStaticMarkup(await ActivityFeed({ events }));
    const html = await draw([
      ev({ doneBy: "Done by Developer · as Neema" }),
      ev({ id: "e2", from: "DELIVERED", to: "DELIVERED", note: "Neema is serving it", doneBy: "Done by Developer · as Neema" }),
      ev({ id: "e3", who: "Asha", from: "PENDING", to: "ACCEPTED" }),
    ]);
    expect(count(html, "Done by Developer · as Neema")).toBe(2);
    expect(html).toContain("<strong class=\"font-semibold\">Neema</strong>");
    expect(html).toContain("Asha");
    noBadWords(html);
    const plain = await draw([ev()]);
    expect(plain).not.toContain("Done by Developer");
    noBadWords(plain);
    const cn = await draw([ev({ doneBy: doneByText(zh, { as: { id: null, name: "Neema", role: null } }) })]);
    expect(cn).toContain("由开发者操作 · 以 Neema 的身份");
    noBadWords(cn);
  });

  it("the order's own page: the history, the waiter line and 'cancelled by' carry the tag next to the name; staff-made lines do not; a Developer label is never cut at the bracket", async () => {
    const { order, chef, waiter } = await lifeOfAnOrder();
    await devRow("RestaurantOrder", order.id, "restaurant_order.status", plus(eventTo(order, "READY").at, 30), { name: chef.label!, role: "Mpishi" });
    const assigned = await db.waiterAssignment.findFirstOrThrow({ where: { orderId: order.id } });
    await devRow("RestaurantOrder", order.id, "restaurant_order.assigned", plus(assigned.at, 20), { name: waiter.label!, role: "Waiter" });
    await makeSession(owner.id);
    const html = renderToStaticMarkup((await OrderHistoryPage({ params: Promise.resolve({ id: order.id }) } as never)) as never);
    // the cook's READY step carries the tag; the cook's earlier PREPARING step does not
    expect(count(html, `Done by Developer · as ${chef.label}`)).toBe(1);
    // the taken-in-charge line of the waiter carries the tag too
    expect(count(html, `Done by Developer · as ${waiter.label}`)).toBe(1); // the waiter list's 'is serving it' line
    expect(html).toContain(chef.label!);
    expect(html).not.toContain(`${NINO} as`);   // the names stay the stored ones: the tag is its own element
    noBadWords(html);

  });

  it("a cancelled order says who cancelled it, with the tag next to the name", async () => {
    const [waiter, manager] = [await waiterActor(), await managerActor()];
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_3", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { customerPhone: PHONE });
    await cancelRestaurantOrder(o.id, "The customer left", manager);
    const cancelled = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });
    await makeSession(owner.id);
    const draw = async () => renderToStaticMarkup((await OrderHistoryPage({ params: Promise.resolve({ id: o.id }) } as never)) as never);
    expect(await draw()).not.toContain("Done by Developer");
    await devRow("RestaurantOrder", o.id, "restaurant_order.cancelled", plus(cancelled.cancelledAt!, 30), { name: manager.label!, role: "Manager" });
    const html = await draw();
    expect(html).toContain(`Cancelled by ${manager.label}: The customer left`);
    // once in the red box, once in the history line of the step
    expect(count(html, `Done by Developer · as ${manager.label}`)).toBe(2);
    noBadWords(html);
  });

  it("the order list (history): the person shown carries the tag, once, at every width", async () => {
    const { order, waiter } = await lifeOfAnOrder();
    await devRow("RestaurantOrder", order.id, "restaurant_order.status", plus(eventTo(order, "DELIVERED").at, 25), { name: waiter.label!, role: "Waiter" });
    await makeSession(owner.id);
    const draw = async () => renderToStaticMarkup((await OrderHistoryListPage({ searchParams: Promise.resolve({ range: "today", status: "all" }) } as never)) as never);
    const html = await draw();
    expect(count(html, `Done by Developer · as ${waiter.label}`)).toBe(1);
    noBadWords(html);
    await db.$executeRawUnsafe(`TRUNCATE "audit_logs" CASCADE`);
    expect(await draw()).not.toContain("Done by Developer");
  });
});

describe("a table's timeline", () => {
  beforeEach(async () => { await resetBusinessData(); browser.reset(); });

  it("the seating, the added person and the order each carry the tag only when the Developer did it; money lines never", async () => {
    const waiter = await waiterActor();
    const start = new Date();
    const s = await seatCustomer({ locationId: "loc_out_3", name: "John Michael", phone: "0712 100 200", guestCount: 2 }, waiter, start);
    const session = await db.diningSession.findFirstOrThrow({ where: { id: s.id }, include: { events: true } });
    const started = session.events.find((e) => e.kind === "STARTED")!;
    await addSessionMember(s.id, { name: "Jane", phone: "0712 300 400" }, waiter, plus(start, 60_000));
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_3", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, plus(start, 120_000), { customerPhone: "0712 100 200" });
    const made = await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } });

    await devRow("DiningSession", s.id, "dining_session.started", plus(started.at, 30), { name: waiter.label!, role: "Waiter" });
    await devRow("RestaurantOrder", o.id, "restaurant_order.created", plus(made.createdAt, 30), { name: waiter.label!, role: "Waiter" });
    await devRow("RestaurantOrder", o.id, "restaurant_order.paid", plus(made.createdAt, 30), { name: waiter.label!, role: "Waiter" });

    const view = (await sessionById(s.id))!;
    const line = (kind: string) => view.timeline.filter((x) => x.kind === kind);
    expect(line("STARTED")).toHaveLength(1);
    expect(line("STARTED")[0].doneBy).toBe(`Done by Developer · as ${waiter.label}`);
    expect(line("STARTED")[0].by).toBe(waiter.label);          // the stored name, untouched
    expect(line("MEMBER_ADDED").every((x) => !x.doneBy)).toBe(true); // Jane was added by a plain staff row
    expect(line("ORDER")[0].doneBy).toBe(`Done by Developer · as ${waiter.label}`);
    expect(view.timeline.filter((x) => x.kind.startsWith("PAYMENT")).every((x) => !x.doneBy)).toBe(true);
    expect(view.timeline.filter((x) => x.doneBy)).toHaveLength(2);
    // the cook's view (no money) keeps the tags
    expect(withoutMoney(view).timeline.filter((x) => x.doneBy)).toHaveLength(2);

    // the floor (every table at once) says the same
    const place = (await tableFloor({ today: await businessToday() })).find((p) => p.id === "loc_out_3")!;
    expect(place.session!.timeline.filter((x) => x.doneBy)).toHaveLength(2);

    // drawn: the tag is its own element next to the name, English and 中文; no tag without a mark
    const html = renderToStaticMarkup(createElement(Timeline, { items: view.timeline }));
    expect(count(html, "Done by Developer · as ")).toBe(2);
    expect(html).toContain(waiter.label!);
    noBadWords(html);
    const cn = renderToStaticMarkup(createElement(Timeline, { items: [{ at: started.at.toISOString(), kind: "STARTED", text: "Seated", by: "Neema", doneBy: doneByText(zh, { as: { id: null, name: "Neema", role: null } }) }] }));
    expect(cn).toContain("由开发者操作 · 以 Neema 的身份");
    noBadWords(cn);
    await db.$executeRawUnsafe(`TRUNCATE "audit_logs" CASCADE`);
    const bare = (await sessionById(s.id))!;
    expect(bare.timeline.some((x) => x.doneBy)).toBe(false);
    expect(renderToStaticMarkup(createElement(Timeline, { items: bare.timeline }))).not.toContain("Done by Developer");
  });
});

describe("a guest message's 'sent by'", () => {
  beforeEach(async () => { await resetBusinessData(); });
  const at = new Date("2041-05-05T09:00:00Z");
  const msgOf = (over: Record<string, unknown> = {}) => ({ id: "m1", guestId: "g1", reservationId: "r1", type: "WELCOME", createdAt: at, sentBy: { fullName: "Neema" }, ...over });

  it("a message the Developer sent as Neema is tagged; automatic ones, other senders and plain staff rows are not", async () => {
    await devRow("Guest", "g1", "guest.message_sent", plus(at, 30), { name: "Neema", role: "Receptionist" });
    await devRow("Guest", "g2", "guest.message_sent", plus(at, 30), { name: "Neema", role: "Receptionist" });
    await devRow("Guest", "g3", "guest.message_sent", plus(at, 30), { name: "Neema", role: "Receptionist" }, { actorType: "STAFF", actorRole: "RECEPTIONIST", actorLabel: "Neema (Receptionist)", after: { message: "m5" } });
    const out = await messageDoneBy(t, [
      msgOf(),
      msgOf({ id: "m2", guestId: "g2", sentBy: null }),                          // automatic: no sender
      msgOf({ id: "m3", guestId: "g2", sentBy: { fullName: "Asha" } }),          // another person's message
      msgOf({ id: "m4", guestId: "g3" }),                                        // a plain staff row
      msgOf({ id: "m6", guestId: "g1", createdAt: plus(at, 3_600_000) }),        // an hour later: not the same send
    ]);
    expect([...out.entries()]).toEqual([["m1", "Done by Developer · as Neema"]]);
    expect((await messageDoneBy(zh, [msgOf()])).get("m1")).toBe("由开发者操作 · 以 Neema 的身份");
  });

  it("the thank-you note sent from the invoices is marked through its reservation", async () => {
    await devRow("Reservation", "r9", "thank_you.sent", plus(at, 50), { name: "Neema", role: "Receptionist" });
    const out = await messageDoneBy(t, [msgOf({ id: "ty", guestId: "g9", reservationId: "r9", type: "THANK_YOU" }), msgOf({ id: "w", guestId: "g9", reservationId: "r9", type: "WELCOME" })]);
    expect([...out.keys()]).toEqual(["ty"]);
    expect(await messageDoneBy(t, [])).toEqual(new Map());
  });

  it("the Settings page and the guest's page show the tag beside the sender of a message the Developer sent", async () => {
    const waiter = await waiterActor();
    const g = await db.guest.create({ data: { fullName: "John Michael", phone: "+255712100200" } });
    const m = await db.guestMessage.create({ data: { guestId: g.id, type: "CUSTOM", channel: "WHATSAPP", to: "+255712100200", body: "Karibu", sentById: waiter.userId! } });
    await db.guestMessage.create({ data: { guestId: g.id, type: "CUSTOM", channel: "SMS", to: "+255712100200", body: "Asante", sentById: (await managerActor()).userId! } });
    await devRow("Guest", g.id, "guest.message_sent", plus(m.createdAt, 30), { name: waiter.label!, role: "Waiter" }, { after: { message: m.id, actingAs: { id: waiter.userId, name: waiter.label, role: "Waiter" } } });
    await makeSession(owner.id);
    // The Messages tab is a closed panel in the page's markup: draw that panel itself.
    const panel = async () => renderToStaticMarkup(findElement(await SettingsPage(), (p) => p.value === "messages" && typeof p.children === "object" && !Array.isArray(p.children))!.props.children);
    const settings = await panel();
    expect(count(settings, `Done by Developer · as ${waiter.label}`)).toBe(1);
    expect(settings).toContain(waiter.label!);
    noBadWords(settings);
    // The profile has async parts: draw its "Messages sent" card itself.
    const card = async () => renderToStaticMarkup(findElement(await GuestProfile({ id: g.id, user: (await getCurrentUser())! }), (p) => p.title === "Messages sent")!.props.children);
    const profile = await card();
    expect(count(profile, `Done by Developer · as ${waiter.label}`)).toBe(1);
    noBadWords(profile);
    await db.$executeRawUnsafe(`TRUNCATE "audit_logs" CASCADE`);
    expect(await panel()).not.toContain("Done by Developer");
    expect(await card()).not.toContain("Done by Developer");
  });

  it("the messenger shows the tag next to the sender, in English and 中文, and none without a mark", () => {
    const sent = (extra: Record<string, unknown>) => [{ type: "BOOKING_CREATED", channel: "WHATSAPP", at: at.toISOString(), by: "Neema", ...extra }];
    const draw = (s: unknown[]) => renderToStaticMarkup(createElement(GuestMessenger, {
      reservationId: "r1", guest: { name: "John", phone: "0712100200", email: null }, link: "https://x.test/stay/abc",
      options: [{ type: "BOOKING_CREATED", label: "Booking details", text: "Hello", subject: "Booking" }], sent: s as never,
    }));
    const en = draw(sent({ doneBy: "Done by Developer · as Neema" }));
    expect(en).toContain("Done by Developer · as Neema");
    expect(en).toContain("· Neema");
    noBadWords(en);
    const cn = draw(sent({ doneBy: doneByText(zh, { as: { id: null, name: "Neema", role: null } }) }));
    expect(cn).toContain("由开发者操作 · 以 Neema 的身份");
    noBadWords(cn);
    const bare = draw(sent({}));
    expect(bare).toContain("· Neema");
    expect(bare).not.toContain("Done by Developer");
    noBadWords(bare);
  });
});

describe("the whole label is kept for a Developer's own line", () => {
  it("the audit label is never cut at the bracket (the lines that read the audit row itself)", () => {
    const label = `${NINO} as Neema (Receptionist)`;
    expect(plainWho(auditWho({ actorType: "DEVELOPER", actorLabel: label, userName: "Nino" }))).toBe(label);
    expect(plainWho(auditWho({ actorType: "STAFF", actorLabel: "Neema (Receptionist)", userName: null }))).toBe("Neema");
  });
});
