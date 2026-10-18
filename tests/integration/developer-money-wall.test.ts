import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), after: () => undefined }));

import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { actsAsDeveloper } from "@/server/developer-wall";
import { checkIn, createReservation, extendStayFree, markNoShow } from "@/server/services/reservations";
import { recordReservationPayment } from "@/server/services/payments";
import { createRestaurantOrder, discountOrders, chargeOrderToRoom } from "@/server/services/restaurant";
import { chargeSessionToRoom, seatCustomer } from "@/server/services/dining-sessions";
import { createTransportRequest } from "@/server/services/transport";
import { authorizeQuote, cancelOrder, issueOrder, paySupplier, recordDelivery, recordInvoice, saveQuote, verifyInvoice } from "@/server/services/procurement";
import { approvePurchase, reviewStockRequest, savePurchase } from "@/server/services/stock-requests";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import {
  billDiscountAction, freeLateCheckoutAction, freeNightsAction, leaveOwingAction, logComplaintAction, roomDiscountAction, stayBillDiscountAction, withdrawLeaveOwingAction,
} from "@/app/staff/(app)/manager-actions";
import {
  cancelAction, changeBillingAction, changeDiscountAction, createReservationAction, extendStayAction, lateCheckoutAction, noShowAction, reassignRoomAction, releaseNoShowAction, settleCheckOutAction,
} from "@/app/staff/(app)/reservations/actions";
import {
  addOrderItemsAction, cancelOrderAction, changeOrderBillingAction, chargeOrderToRoomAction, createOrderAction, declineOrderAction, removeOrderItemAction, saveMenuItemAction,
} from "@/app/staff/(app)/restaurant/actions";
import { chargeSessionToRoomAction } from "@/app/staff/(app)/restaurant/tables/actions";
import { adjustTripPriceAction, saveTransportServiceAction } from "@/app/staff/(app)/transport/actions";
import { saveCorporateAction } from "@/app/staff/(app)/corporate/actions";
import {
  saveDiscountRulesAction, savePriceRuleAction, savePromotionAction, saveRoomDiscountLimitAction, setPriceRuleActiveAction, setPromotionActiveAction, updateRoomPriceAction,
} from "@/app/staff/(app)/settings/pricing/actions";
import { managerActor, resetBusinessData, roomType, waiterActor } from "../support/helpers";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * THE MONEY WALL (owner, 2026-10-14). The Developer account looks at everything and runs the system, but it never DECIDES about money:
 * no discount, no free nights, no leaving owing, no billing a room, no price, no limit, no approval of spending. For every decision
 * the Developer is refused on the server — whatever rights it holds — and nothing is written but one "developer.denied" entry
 * under its own identity. The Boss, the MD and the managers keep doing exactly what they did.
 *
 * Each gate is proven twice where it can be reached twice: through the exported server action (a real session cookie of a real
 * Developer user) and through the service (a Developer actor that is even given the right on purpose, to prove the service says no itself).
 */

const TZ = "Africa/Dar_es_Salaam";
const BEER = "mi_beers_heineken";
const PHONE = "0712 345 678";

let dev: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let mgr: MadeUser;
let accountant: MadeUser;

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Wall" });
  boss = await makeUser("OWNER", { fullName: "Boss Wall" });
  md = await makeUser("ADMIN", { fullName: "MD Wall" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Wall" });
  accountant = await makeUser("ACCOUNTANT", { fullName: "Accountant Wall" });
});
afterAll(async () => {
  await removeMadeUsers();
});
beforeEach(async () => {
  await resetBusinessData();
  await db.$executeRawUnsafe(`TRUNCATE "transport_trips" CASCADE`);
  browser.reset();
});

// ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

/** Sign in as this person (a real session cookie in the fake browser). */
async function as(u: MadeUser) {
  browser.reset();
  await db.session.deleteMany({ where: { userId: u.id } });
  await makeSession(u.id, { createdMinAgo: 1, seenMinAgo: 0 });
}

/** The acting person as a service sees them: their id, their name and the rights of their role in the database right now. */
async function actorOf(u: MadeUser, extraRights: string[] = []) {
  const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, role: row.role.name, permissions: new Set([...row.role.permissions.map((p) => p.permission.code), ...extraRights]) as ReadonlySet<string> };
}

/** Everything that holds money or what is owed, as one comparable text: if a refused call changed anything, it differs. */
async function money() {
  const [reservations, rooms, nights, charges, payments, revenue, orders, orderPayments, items, trips, services, companies, rules, roomTypes, promotions, priceRules, menu] = await Promise.all([
    db.reservation.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, billTo: true, corporateCustomerId: true, grossAmount: true, discountAmount: true, chargesAmount: true, netAmount: true, paidAmount: true, balanceAmount: true, companyBilledAmount: true, leaveOwingAt: true, leaveOwingUpTo: true, cancelledAt: true, noShowAt: true } }),
    db.reservationRoom.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, roomId: true, ratePerNight: true, discountPerNight: true, discountAmount: true, netAmount: true, departureDate: true, endAt: true, lateCheckoutUntil: true, releasedAt: true } }),
    db.roomNight.aggregate({ _count: true, _sum: { netAmount: true, billDiscount: true } }),
    db.reservationCharge.findMany({ orderBy: { id: "asc" }, select: { id: true, amount: true, isVoided: true, category: true } }),
    db.payment.aggregate({ _count: true, _sum: { amount: true } }),
    db.revenueTransaction.aggregate({ _count: true, _sum: { amount: true } }),
    db.restaurantOrder.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, total: true, discountAmount: true, paidAmount: true, settlement: true, reservationId: true } }),
    db.restaurantOrderPayment.count(),
    db.restaurantOrderItem.aggregate({ _count: true, _sum: { lineTotal: true, quantity: true } }),
    db.transportTrip.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, charge: true, standardPrice: true } }),
    db.transportService.findMany({ orderBy: { id: "asc" }, select: { id: true, price: true, isActive: true, name: true } }),
    db.corporateCustomer.findMany({ orderBy: { id: "asc" }, select: { id: true, creditLimit: true, paymentTermDays: true, status: true, companyName: true } }),
    db.hotelSettings.findUniqueOrThrow({ where: { id: 1 }, select: { manualDiscountMax: true, receptionCanDiscount: true, managerCanDiscount: true } }),
    db.roomType.findMany({ orderBy: { id: "asc" }, select: { id: true, baseRate: true, manualDiscountMax: true } }),
    db.promotion.count(),
    db.priceRule.count(),
    db.menuItem.findMany({ orderBy: { id: "asc" }, select: { id: true, price: true, name: true } }),
  ]);
  return JSON.stringify({ reservations, rooms, nights, charges, payments, revenue, orders, orderPayments, items, trips, services, companies, rules, roomTypes, promotions, priceRules, menu });
}
const deniedBy = (u: MadeUser) => db.auditLog.count({ where: { userId: u.id, action: "developer.denied" } });
const auditCount = (action: string) => db.auditLog.count({ where: { action } });

type Res = { ok: boolean; code?: string; error?: string };

/** The Developer's attempt: refused (FORBIDDEN), nothing written, and exactly one "developer.denied" entry under its own identity. */
async function developerRefused(label: string, run: () => Promise<Res>) {
  await as(dev);
  const [before, denied] = [await money(), await deniedBy(dev)];
  const res = await run();
  expect(res.ok, `${label}: should be refused (${res.error ?? "it worked"})`).toBe(false);
  expect(res.code, label).toBe("FORBIDDEN");
  expect(await money(), `${label}: nothing may change`).toBe(before);
  expect(await deniedBy(dev), `${label}: one refusal entry`).toBe(denied + 1);
  const row = await db.auditLog.findFirstOrThrow({ where: { userId: dev.id, action: "developer.denied" }, orderBy: { createdAt: "desc" } });
  expect(row, label).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: dev.fullName });
  expect(row.after, label).toMatchObject({ kind: "action" });
}
/** Someone allowed to decide: it works, and the refusal log did not grow. */
async function decided(label: string, who: MadeUser, run: () => Promise<Res>) {
  await as(who);
  const denied = await db.auditLog.count({ where: { action: "developer.denied" } });
  const res = await run();
  expect(res.ok, `${label} (${who.role}): ${res.error ?? ""}`).toBe(true);
  expect(await db.auditLog.count({ where: { action: "developer.denied" } }), label).toBe(denied);
}
const refusedAsDeveloper = async (run: () => Promise<unknown>) => {
  const e = await thrownBy(run);
  expect(e, "an error was expected").toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe("FORBIDDEN");
  return e as AppError;
};

// ───────────────────────────────────────────── fixtures ─────────────────────────────────────────────
const today = () => businessDateOf(new Date());
const at = (days: number, hour: number) => zonedInstant(addDays(today(), days), hour * 60, TZ);

/** A guest staying now (arrived yesterday, leaves in 2 days), checked in, nothing paid. */
async function inHouse(opts: { type?: string; roomIndex?: number; name?: string; phone?: string; from?: number; to?: number } = {}) {
  const t = await roomType(opts.type ?? "DOUBLE_DELUXE");
  const room = t.rooms[opts.roomIndex ?? 0];
  const mgrActor = await managerActor();
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: opts.name ?? "John Smith", phone: opts.phone ?? PHONE },
    stay: { kind: "overnight", arrivalDate: addDays(today(), opts.from ?? -1), departureDate: addDays(today(), opts.to ?? 2) },
    rooms: [{ roomTypeId: t.id, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
  }, mgrActor, at(opts.from ?? -1, 12));
  await checkIn(r.id, mgrActor, null, at(opts.from ?? -1, 15));
  const full = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: true } });
  return { id: full.id, roomId: full.rooms[0].id, room, guestId: full.guestId };
}

/** An unpaid dine-in order of someone eating at the restaurant (the phone ties it to the stay when it is the guest's). */
async function unpaidOrder(phone = PHONE, qty = 3) {
  return createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_3", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: qty }] }, await waiterActor(), new Date(), { customerPhone: phone });
}

// ───────────────────────────────────────────── 0. who is a Developer ─────────────────────────────────────────────
describe("the wall knows the Developer from the rights of its role", () => {
  it("the Developer's rights name it; no other role holds the Developer-only right", async () => {
    expect(actsAsDeveloper(await actorOf(dev))).toBe(true);
    for (const u of [boss, md, mgr, accountant]) expect(actsAsDeveloper(await actorOf(u)), u.role).toBe(false);
    expect(actsAsDeveloper({ permissions: new Set() })).toBe(false);
    expect(actsAsDeveloper(null)).toBe(false);
    expect(actsAsDeveloper({})).toBe(false);
  });
});

// ───────────────────────────────────────────── 1. the manager's decisions (manager-actions.ts) ─────────────────────────────────────────────
describe("manager decisions: a Developer is refused every one, the Boss / MD / manager still decide", () => {
  it("free nights, free late checkout, room discount, whole-bill discount, leave owing (+ withdraw), table discount: refused, nothing written", async () => {
    const s = await inHouse();
    const o = await unpaidOrder();
    // Leave-owing needs an approval to withdraw: made by the Boss first, so the Developer's try to withdraw has something to withdraw.
    await decided("approve leave owing", boss, () => leaveOwingAction({ reservationId: s.id, reason: "Company pays Friday" }));
    expect(await auditCount("reservation.leave_owing_approved")).toBe(1);

    await developerRefused("free nights", () => freeNightsAction({ reservationRoomId: s.roomId, nights: 1, reason: "VIP guest" }));
    await developerRefused("free late checkout", () => freeLateCheckoutAction({ reservationRoomId: s.roomId, until: "20:00", reason: "Waiting for a flight" }));
    await developerRefused("room discount", () => roomDiscountAction({ reservationRoomId: s.roomId, perNight: 5_000, reason: "Loyal guest" }));
    await developerRefused("whole-bill discount (100%)", () => stayBillDiscountAction({ reservationId: s.id, percent: 100, reason: "Friend of the owner" }));
    await developerRefused("whole-bill discount (amount)", () => stayBillDiscountAction({ reservationId: s.id, amount: 5_000, reason: "Friend of the owner" }));
    await developerRefused("leave owing", () => leaveOwingAction({ reservationId: s.id, reason: "Company pays Friday" }));
    await developerRefused("withdraw leave owing", () => withdrawLeaveOwingAction({ reservationId: s.id }));
    await developerRefused("table / order discount", () => billDiscountAction({ orderIds: [o.id], percent: 100, reason: "On the house" }));
    expect(await auditCount("reservation.extended_free")).toBe(0);
    expect(await auditCount("reservation.discount_changed")).toBe(0);
    expect(await auditCount("reservation.bill_discounted")).toBe(0);
    expect(await auditCount("reservation.leave_owing_withdrawn")).toBe(0);
    expect(await auditCount("restaurant_order.discounted")).toBe(0);
    expect(await deniedBy(dev)).toBe(8);
  });

  it("the Boss does all of them; the MD and a manager pass the same gates", async () => {
    const s = await inHouse();
    const o = await unpaidOrder();
    await decided("free nights", boss, () => freeNightsAction({ reservationRoomId: s.roomId, nights: 1, reason: "VIP guest" }));
    await decided("free late checkout", boss, () => freeLateCheckoutAction({ reservationRoomId: s.roomId, until: "20:00", reason: "Waiting for a flight" }));
    await decided("room discount", boss, () => roomDiscountAction({ reservationRoomId: s.roomId, perNight: 5_000, reason: "Loyal guest" }));
    await decided("whole-bill discount", md, () => stayBillDiscountAction({ reservationId: s.id, amount: 5_000, reason: "Friend of the owner" }));
    await decided("leave owing", boss, () => leaveOwingAction({ reservationId: s.id, reason: "Company pays Friday" }));
    await decided("withdraw leave owing", mgr, () => withdrawLeaveOwingAction({ reservationId: s.id }));
    await decided("table / order discount", mgr, () => billDiscountAction({ orderIds: [o.id], amount: 1_000, reason: "Waited long" }));
    expect(await auditCount("reservation.extended_free")).toBe(1);
    expect(await auditCount("reservation.discount_changed")).toBe(1);
    expect(await auditCount("reservation.bill_discounted")).toBe(1);
    expect(await auditCount("reservation.leave_owing_approved")).toBe(1);
    expect(await auditCount("reservation.leave_owing_withdrawn")).toBe(1);
    expect(await auditCount("restaurant_order.discounted")).toBe(1);
  });

  it("the services say no on their own, even to a Developer given the Boss's rights on purpose; the Boss's actor still passes", async () => {
    const s = await inHouse();
    const o = await unpaidOrder();
    const bossRights = ["dashboard.owner", "dashboard.admin", "dashboard.manager", "reservations.checkout_override", "reservations.discount_override", "pricing.manage", "reservations.edit"];
    const devActor = await actorOf(dev, bossRights);
    const before = await money();
    await refusedAsDeveloper(() => extendStayFree(s.roomId, addDays(today(), 3), "VIP", devActor));
    await refusedAsDeveloper(() => discountOrders([o.id], { percent: 100, reason: "On the house" }, devActor));
    const { discountStayBill, approveLeaveOwing, withdrawLeaveOwing, changeDiscount, approveLateCheckout, assertRoomDiscount, assertManualDiscount } = await import("@/server/services/reservations");
    await refusedAsDeveloper(() => discountStayBill(s.id, { percent: 100, reason: "Friend" }, devActor));
    await refusedAsDeveloper(() => approveLeaveOwing(s.id, "Company pays", devActor));
    await refusedAsDeveloper(() => withdrawLeaveOwing(s.id, devActor));
    await refusedAsDeveloper(() => changeDiscount(s.roomId, 5_000, "Loyal", devActor));
    await refusedAsDeveloper(() => changeDiscount(s.roomId, 0, "Take it away", devActor));
    await refusedAsDeveloper(() => approveLateCheckout(s.roomId, { until: "20:00", fee: 0 }, devActor));
    await refusedAsDeveloper(() => assertRoomDiscount(s.roomId, 1_000, devActor));
    const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(() => assertManualDiscount(1_000, devActor, settings)).toThrow(/Developer account cannot make this decision/);
    expect(await money()).toBe(before);
    expect(await deniedBy(dev)).toBe(9); // the sync check (assertManualDiscount) refuses without an entry; each of the 9 async gates writes one

    const bossActor = await actorOf(boss);
    await extendStayFree(s.roomId, addDays(today(), 3), "VIP", bossActor);
    await changeDiscount(s.roomId, 5_000, "Loyal", bossActor);
    expect(() => assertManualDiscount(1_000, bossActor, settings)).not.toThrow();
  });
});

// ───────────────────────────────────────────── 2. reservation actions ─────────────────────────────────────────────
describe("reservation decisions: discounts, late-checkout fee, who pays, free overstay, credit override, typed charges", () => {
  it("discount, late-checkout fee and who-pays: refused for the Developer, done by the Boss", async () => {
    const s = await inHouse();
    const company = await db.corporateCustomer.create({ data: { companyName: "ABC Company Ltd", paymentTermDays: 30 } });
    const bill = { reservationId: s.id, corporateCustomerId: company.id, billTo: "COMPANY" as const, covers: [], paymentTermDays: null };
    await developerRefused("change discount", () => changeDiscountAction({ reservationId: s.id, reservationRoomId: s.roomId, discountPerNight: 5_000, reason: "Loyal" }));
    await developerRefused("remove a discount", () => changeDiscountAction({ reservationId: s.id, reservationRoomId: s.roomId, discountPerNight: 0, reason: "No more" }));
    await developerRefused("late checkout fee", () => lateCheckoutAction({ reservationId: s.id, reservationRoomId: s.roomId, until: "20:00", fee: 0 }));
    await developerRefused("who pays the stay", () => changeBillingAction(bill));
    await developerRefused("extend the stay with a discount", () => extendStayAction({ reservationId: s.id, reservationRoomId: s.roomId, newDeparture: addDays(today(), 3), discountPerNight: 5_000, discountReason: "Loyal" }));

    await decided("change discount", boss, () => changeDiscountAction({ reservationId: s.id, reservationRoomId: s.roomId, discountPerNight: 5_000, reason: "Loyal" }));
    await decided("late checkout fee", md, () => lateCheckoutAction({ reservationId: s.id, reservationRoomId: s.roomId, until: "20:00", fee: 0 }));
    await decided("who pays the stay", boss, () => changeBillingAction(bill));
    await decided("extend the stay with a discount", mgr, () => extendStayAction({ reservationId: s.id, reservationRoomId: s.roomId, newDeparture: addDays(today(), 3), discountPerNight: 6_000, discountReason: "Loyal" }));
  });

  it("a booking: a Developer cannot give a discount, type in a charge or override a company's credit limit — and no booking is made", async () => {
    const t = await roomType("DOUBLE_DELUXE");
    const company = await db.corporateCustomer.create({ data: { companyName: "Small Credit Ltd", paymentTermDays: 30, creditLimit: 1_000 } });
    const base = {
      sourceCode: "PHONE", status: "RESERVED" as const, checkInNow: false, guest: { fullName: "Grace Mushi", phone: PHONE },
      stay: { kind: "overnight" as const, arrivalDate: addDays(today(), 5), departureDate: addDays(today(), 7) },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms[1].id, adults: 1, children: 0 }],
    };
    const made = () => db.reservation.count();
    const none = await made();
    await developerRefused("a discount on a booking", () => createReservationAction({ ...base, rooms: [{ ...base.rooms[0], discountPerNight: 5_000, discountReason: "Friend" }] }));
    await developerRefused("a typed-in charge on a booking", () => createReservationAction({ ...base, charges: [{ type: "OTHER", item: "Special fee", qty: 1, unitPrice: 50_000 }] } as never));
    await developerRefused("a credit-limit override", () => createReservationAction({ ...base, corporateCustomerId: company.id, billing: { billTo: "COMPANY", covers: [] }, creditOverride: { reason: "Good customer" } }));
    expect(await made()).toBe(none);

    // The Boss: the discount and the credit override work.
    await decided("a discount on a booking", boss, () => createReservationAction({ ...base, rooms: [{ ...base.rooms[0], discountPerNight: 5_000, discountReason: "Friend" }] }));
    await decided("a credit-limit override", boss, () => createReservationAction({ ...base, guest: { fullName: "Second Guest", phone: "0713 222 333" }, rooms: [{ ...base.rooms[0], roomId: t.rooms[2].id }], corporateCustomerId: company.id, billing: { billTo: "COMPANY", covers: [] }, creditOverride: { reason: "Good customer" } }));
  });

  it("not charging a guest who stayed past the departure: refused for the Developer; the Boss decides", async () => {
    const s = await inHouse({ from: -4, to: -1 });
    await developerRefused("waive the overstay", () => settleCheckOutAction({ reservationId: s.id, chargeOverstay: false, allowBalance: true, overrideReason: "Waived", earlyReason: "x" }));
    await decided("waive the overstay", boss, () => settleCheckOutAction({ reservationId: s.id, chargeOverstay: false, allowBalance: true, overrideReason: "Regular guest, waived" }));
    expect((await db.reservation.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CHECKED_OUT");
  });

  it("a paid booking cancelled or released as a no-show (payment kept or refund due), and a dearer room without the difference: refused for a Developer given those rights", async () => {
    // The Developer does not hold reservations.cancel today; the service must refuse even if it were ever given it.
    const cancelRights = ["reservations.cancel", "reservations.edit"];
    const devActor = await actorOf(dev, cancelRights);
    const t = await roomType("DOUBLE_DELUXE");
    const mgrActor = await managerActor();
    const paid = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Paid Guest", phone: PHONE }, stay: { kind: "overnight", arrivalDate: addDays(today(), 5), departureDate: addDays(today(), 6) },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms[3].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgrActor);
    // An account that takes payments: "any active one" could be the nTZS account (it never takes a hand-recorded payment), depending on row order.
    const account = await db.moneyAccount.findFirstOrThrow({ where: { isActive: true, acceptsPayments: true }, orderBy: { code: "asc" } });
    await recordReservationPayment({ reservationId: paid.id, amount: 50_000, accountId: account.id }, mgrActor);
    const { cancelReservation, releaseNoShow, reassignRoom } = await import("@/server/services/reservations");
    const before = await money();
    await refusedAsDeveloper(() => cancelReservation(paid.id, devActor, "Guest called", { keepPayment: false }));
    expect(await money()).toBe(before);

    // A no-show that was paid: the room is held; releasing it settles the money.
    const arriving = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "No Show", phone: "0713 000 111" }, stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 1) },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms[4].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgrActor, at(-1, 10));
    await recordReservationPayment({ reservationId: arriving.id, amount: 50_000, accountId: account.id }, mgrActor);
    await markNoShow(arriving.id, mgrActor);
    const held = await money();
    await refusedAsDeveloper(() => releaseNoShow(arriving.id, devActor, "Never came"));
    expect(await money()).toBe(held);

    // A dearer room: the difference is charged or given — a decision.
    const cheap = (await db.roomType.findMany({ where: { category: "GUEST_ROOM" }, orderBy: { baseRate: "asc" }, include: { rooms: true } })).find((x) => x.rooms.length > 1)!;
    const dear = (await db.roomType.findMany({ where: { category: "GUEST_ROOM", baseRate: { gt: cheap.baseRate } }, orderBy: { baseRate: "desc" }, include: { rooms: true } }))[0];
    const stay = await inHouse({ type: cheap.code, roomIndex: 0, name: "Upgrade Guest" });
    const upgradeBefore = await money();
    await refusedAsDeveloper(() => reassignRoom(stay.roomId, dear.rooms[0].id, devActor, "Better view", { chargeDifference: false }));
    expect(await money()).toBe(upgradeBefore);
    // The Boss moves the same guest.
    await reassignRoom(stay.roomId, dear.rooms[0].id, await actorOf(boss), "Better view", { chargeDifference: true });
    expect((await db.reservationRoom.findUniqueOrThrow({ where: { id: stay.roomId } })).roomId).toBe(dear.rooms[0].id);
    // The Boss cancels the paid booking and releases the no-show.
    await cancelReservation(paid.id, await actorOf(boss), "Guest called", { keepPayment: true });
    await releaseNoShow(arriving.id, await actorOf(boss), "Never came");
    expect(await deniedBy(dev)).toBe(3);
  });

  it("through the screen: a paid booking cancelled / released / an upgrade — refused for the Developer's session, nothing written", async () => {
    const t = await roomType("DOUBLE_DELUXE");
    const mgrActor = await managerActor();
    const paid = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Paid Guest", phone: PHONE }, stay: { kind: "overnight", arrivalDate: addDays(today(), 5), departureDate: addDays(today(), 6) },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms[3].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgrActor);
    // An account that takes payments: "any active one" could be the nTZS account (it never takes a hand-recorded payment), depending on row order.
    const account = await db.moneyAccount.findFirstOrThrow({ where: { isActive: true, acceptsPayments: true }, orderBy: { code: "asc" } });
    await recordReservationPayment({ reservationId: paid.id, amount: 50_000, accountId: account.id }, mgrActor);
    const arriving = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "No Show", phone: "0713 000 111" }, stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 1) },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms[4].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, mgrActor, at(-1, 10));
    await recordReservationPayment({ reservationId: arriving.id, amount: 50_000, accountId: account.id }, mgrActor);
    await markNoShow(arriving.id, mgrActor);
    const stay = await inHouse({ name: "Upgrade Guest", roomIndex: 5 });
    const dear = (await db.roomType.findMany({ where: { category: "GUEST_ROOM" }, orderBy: { baseRate: "desc" }, include: { rooms: true } }))[0];
    await developerRefused("cancel a paid booking", () => cancelAction({ reservationId: paid.id, reason: "Guest called", keepPayment: false }));
    await developerRefused("release a paid no-show", () => releaseNoShowAction({ reservationId: arriving.id, reason: "Never came" }));
    await developerRefused("mark a paid no-show and release", () => noShowAction({ reservationId: arriving.id, release: true }));
    if (dear.baseRate > (await db.roomType.findUniqueOrThrow({ where: { id: t.id } })).baseRate) {
      await developerRefused("a dearer room", () => reassignRoomAction({ reservationId: stay.id, reservationRoomId: stay.roomId, roomId: dear.rooms[0].id, reason: "Better view" }));
    }
    await decided("cancel a paid booking", boss, () => cancelAction({ reservationId: paid.id, reason: "Guest called", keepPayment: true }));
    await decided("release a paid no-show", mgr, () => releaseNoShowAction({ reservationId: arriving.id, reason: "Never came" }));
  });
});

// ───────────────────────────────────────────── 3. the restaurant: bills on rooms, voiding, adding to a room bill, prices ─────────────────────────────────────────────
describe("the restaurant: a Developer never puts a bill on a room, changes who pays, voids or adds to a room bill", () => {
  it("charge an order to a room, change who pays: refused for the Developer, done by the MD / the Boss", async () => {
    const s = await inHouse();
    const o = await unpaidOrder();
    await developerRefused("charge an order to a room", () => chargeOrderToRoomAction({ id: o.id, reservationId: s.id }));
    await decided("charge an order to a room", md, () => chargeOrderToRoomAction({ id: o.id, reservationId: s.id }));
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).settlement).toBe("ROOM");
    await developerRefused("take an order off a room", () => changeOrderBillingAction({ id: o.id, to: null, reason: "Guest pays at the restaurant" }));
    await decided("take an order off a room", boss, () => changeOrderBillingAction({ id: o.id, to: null, reason: "Guest pays at the restaurant" }));
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).settlement).toBe("UNPAID");
    await developerRefused("put an order on a room", () => changeOrderBillingAction({ id: o.id, to: s.id, reason: "Guest pays on the room" }));
  });

  it("a new order on a room (or room service), cancelling / declining / removing / adding on a room-bill order: refused for the Developer", async () => {
    const s = await inHouse();
    const order = { type: "DINE_IN" as const, items: [{ menuItemId: BEER, quantity: 1 }], settlement: "ROOM" as const, reservationId: s.id, customerPhone: PHONE };
    await developerRefused("a new order on a room", () => createOrderAction(order));
    await developerRefused("room service", () => createOrderAction({ ...order, type: "ROOM_SERVICE" }));
    expect(await db.restaurantOrder.count()).toBe(0);
    await decided("a new order on a room", boss, () => createOrderAction(order));
    const o = await db.restaurantOrder.findFirstOrThrow({ where: { reservationId: s.id } });
    expect(o.settlement).toBe("ROOM");
    await decided("more on a room-bill order", boss, () => addOrderItemsAction({ id: o.id, items: [{ menuItemId: BEER, quantity: 2 }] }));
    const item = await db.restaurantOrderItem.findFirstOrThrow({ where: { orderId: o.id } });

    await developerRefused("add to a room-bill order", () => addOrderItemsAction({ id: o.id, items: [{ menuItemId: BEER, quantity: 1 }] }));
    await developerRefused("take an item off a room-bill order", () => removeOrderItemAction({ orderId: o.id, itemId: item.id, quantity: 1, reason: "Guest changed their mind" }));
    await developerRefused("decline a room-bill order", () => declineOrderAction({ id: o.id, reason: "Out of stock" }));
    await developerRefused("cancel a room-bill order", () => cancelOrderAction({ id: o.id, reason: "Guest left" }));

    await decided("take an item off a room-bill order", mgr, () => removeOrderItemAction({ orderId: o.id, itemId: item.id, quantity: 1, reason: "Guest changed their mind" }));
    await decided("cancel a room-bill order", boss, () => cancelOrderAction({ id: o.id, reason: "Guest left" }));
    expect((await db.restaurantOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CANCELLED");
  });

  it("a table's bill on a room: refused for the Developer, done by the MD", async () => {
    const s = await inHouse({ name: "Table Guest" });
    const waiter = await waiterActor();
    const seated = await seatCustomer({ locationId: "loc_out_4", name: "Table Guest", phone: PHONE, guestCount: 1 }, waiter);
    await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_out_4", settlement: "UNPAID", items: [{ menuItemId: BEER, quantity: 2 }] }, waiter, new Date(), { customerPhone: PHONE });
    await developerRefused("a table's bill on a room", () => chargeSessionToRoomAction({ sessionId: seated.id, reservationId: s.id }));
    // The service itself (it lives in dining-sessions.ts) refuses too, through the order engine it calls — even for a Developer given the right.
    const before = await money();
    await refusedAsDeveloper(async () => chargeSessionToRoom(seated.id, s.id, {}, await actorOf(dev, ["restaurant.orders"])));
    expect(await money()).toBe(before);
    await decided("a table's bill on a room", md, () => chargeSessionToRoomAction({ sessionId: seated.id, reservationId: s.id }));
    expect(await db.reservationCharge.count({ where: { reservationId: s.id, isVoided: false } })).toBeGreaterThan(0);
  });

  it("the services refuse a Developer given the right on purpose: room charge, billing, voiding money, a dish's price", async () => {
    const s = await inHouse();
    const o = await unpaidOrder();
    const devActor = await actorOf(dev, ["restaurant.orders", "restaurant.serve", "restaurant.menu", "kitchen.orders", "revenue.void", "dashboard.owner"]);
    const { changeOrderBilling, removeOrderItem, cancelRestaurantOrder, saveMenuItem, addOrderItems } = await import("@/server/services/restaurant");
    const before = await money();
    await refusedAsDeveloper(() => chargeOrderToRoom(o.id, s.id, devActor));
    await refusedAsDeveloper(() => changeOrderBilling(o.id, s.id, "Guest pays on the room", devActor));
    await refusedAsDeveloper(() => createRestaurantOrder({ type: "DINE_IN", settlement: "ROOM", reservationId: s.id, items: [{ menuItemId: BEER, quantity: 1 }] }, devActor, new Date(), { customerPhone: PHONE }));
    expect(await money()).toBe(before);

    // A dish: its name may change, never its price (and no new priced dish).
    const dish = await db.menuItem.findUniqueOrThrow({ where: { id: BEER } });
    const same = { id: dish.id, categoryId: dish.categoryId, name: dish.name, price: dish.price, isAvailable: dish.isAvailable, isActive: dish.isActive };
    await refusedAsDeveloper(() => saveMenuItem({ ...same, price: dish.price + 500 }, devActor));
    await refusedAsDeveloper(() => saveMenuItem({ ...same, id: null, name: "Wall test dish", price: 1_000 }, devActor));
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: BEER } })).price).toBe(dish.price);
    await saveMenuItem({ ...same }, devActor);

    // The same actor as the Boss: a room order can be changed, a dish priced.
    const bossActor = await actorOf(boss);
    await chargeOrderToRoom(o.id, s.id, bossActor);
    await refusedAsDeveloper(() => addOrderItems(o.id, [{ menuItemId: BEER, quantity: 1 }], devActor));
    const item = await db.restaurantOrderItem.findFirstOrThrow({ where: { orderId: o.id } });
    await refusedAsDeveloper(() => removeOrderItem(o.id, item.id, 1, "Changed mind", devActor));
    await refusedAsDeveloper(() => cancelRestaurantOrder(o.id, "Guest left", devActor));
    await saveMenuItem({ ...same, price: dish.price + 500 }, bossActor);
    await db.menuItem.update({ where: { id: BEER }, data: { price: dish.price } });
    expect(await deniedBy(dev)).toBe(8);
  });

  it("a dish's price through the menu screen: refused for the Developer, kept as it is for the Boss's save", async () => {
    const dish = await db.menuItem.findUniqueOrThrow({ where: { id: BEER } });
    const form = (price: number) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ id: dish.id, categoryId: dish.categoryId, name: dish.name, price: String(price), isAvailable: "on", isActive: "on" })) f.set(k, v);
      return f;
    };
    await developerRefused("a dish's new price", () => saveMenuItemAction(null, form(dish.price + 500)));
    await decided("the menu saved as it is", boss, () => saveMenuItemAction(null, form(dish.price)));
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: BEER } })).price).toBe(dish.price);
  });

  it("what a Developer may still do is not fenced: log a complaint, take an unpaid order, hand it to a waiter", async () => {
    await inHouse();
    await as(dev);
    const complaint = await logComplaintAction({ description: "The soup was cold", priority: "NORMAL" });
    expect(complaint.ok, complaint.ok ? "" : complaint.error).toBe(true);
    const placed = await createOrderAction({ type: "DINE_IN", items: [{ menuItemId: BEER, quantity: 1 }], settlement: "UNPAID", locationId: "loc_out_5", customerPhone: "0712 999 888", customerName: "Walk In" });
    expect(placed.ok, placed.ok ? "" : placed.error).toBe(true);
    expect(await deniedBy(dev)).toBe(0);
  });
});

// ───────────────────────────────────────────── 4. transport, corporate, prices ─────────────────────────────────────────────
describe("transport prices, a company's credit, room prices and discount limits: the Developer never sets them", () => {
  it("a trip's special price and the transport price list", async () => {
    const pickup = await db.transportService.findUniqueOrThrow({ where: { code: "AIRPORT_PICKUP" }, include: { options: true } });
    const trip = await createTransportRequest({
      serviceId: pickup.id, passengerName: "John Smith", passengerPhone: "+255 700 000 001", date: addDays(today(), 3), time: "18:30",
      airport: "Julius Nyerere International Airport (DAR)", flightNumber: "TK603", passengers: 2, bags: 4,
    }, { source: "STAFF", actor: await actorOf(boss) });
    const list = { id: pickup.id, name: pickup.name, price: 1, isActive: true, isPublic: true };
    await developerRefused("a trip's special price", () => adjustTripPriceAction({ tripId: trip.id, price: 1_000, reason: "Friend" }));
    await developerRefused("the transport price list", () => saveTransportServiceAction(list));
    expect((await db.transportService.findUniqueOrThrow({ where: { id: pickup.id } })).price).toBe(pickup.price);
    await decided("a trip's special price", boss, () => adjustTripPriceAction({ tripId: trip.id, price: 35_000, reason: "Regular customer" }));
    expect((await db.transportTrip.findUniqueOrThrow({ where: { id: trip.id } })).charge).toBe(35_000);
    // The same price list saved by a manager (the same numbers: nothing of the hotel's changes).
    await decided("the transport price list", mgr, () => saveTransportServiceAction({ ...list, price: pickup.price, options: pickup.options.map((o) => ({ id: o.id, name: o.name, description: o.description ?? undefined, price: o.price, isActive: o.isActive })) }));
    expect((await db.transportService.findUniqueOrThrow({ where: { id: pickup.id } })).price).toBe(pickup.price);
  });

  it("a company's credit limit and terms", async () => {
    const company = await db.corporateCustomer.create({ data: { companyName: "ABC Company Ltd", paymentTermDays: 30, creditLimit: 500_000 } });
    const form = (limit: string, terms = "30") => {
      const f = new FormData();
      const fields: Record<string, string> = {
        id: company.id, companyName: "ABC Company Ltd", contactPerson: "", phone: "", email: "", address: "", taxId: "", vrn: "", registrationNo: "",
        creditLimit: limit, paymentTermDays: terms, billingNotes: "", billingAddress: "", status: "ACTIVE",
      };
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };
    await developerRefused("a company's credit limit", () => saveCorporateAction(null, form("90000000", "180")));
    expect((await db.corporateCustomer.findUniqueOrThrow({ where: { id: company.id } })).creditLimit).toBe(500_000);
    await decided("a company's credit limit", boss, () => saveCorporateAction(null, form("900000")));
    expect((await db.corporateCustomer.findUniqueOrThrow({ where: { id: company.id } })).creditLimit).toBe(900_000);
  });

  it("room prices, promotions, date prices and the discount rules", async () => {
    const t = await roomType("DOUBLE_DELUXE");
    const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
    const price = (rate: number) => { const f = new FormData(); f.set("roomTypeId", t.id); f.set("baseRate", String(rate)); return f; };
    const rules = (max: number) => { const f = new FormData(); f.set("manualDiscountMax", String(max)); f.set("receptionCanDiscount", "on"); f.set("managerCanDiscount", "on"); return f; };
    const limit = (max: string) => { const f = new FormData(); f.set("roomTypeId", t.id); f.set("manualDiscountMax", max); return f; };
    const from = addDays(today(), 400), to = addDays(today(), 405);
    const promo = { name: "Wall test promotion", type: "PERCENT" as const, value: 10, scope: "ALL" as const, roomTypeIds: [], roomIds: [], channel: "ALL" as const, startDate: from, endDate: to, daysOfWeek: [], isActive: true };
    const rule = { name: "Wall test date price", scope: "ALL" as const, roomTypeIds: [], roomIds: [], price: 50_000, startDate: from, endDate: to, daysOfWeek: [], isActive: true };
    try {
      // The Boss makes one of each, so there is something for the Developer to switch.
      await decided("a promotion", boss, () => savePromotionAction(promo));
      await decided("a date price", boss, () => savePriceRuleAction(rule));
      const [p, r] = [await db.promotion.findFirstOrThrow({ where: { name: promo.name } }), await db.priceRule.findFirstOrThrow({ where: { name: rule.name } })];

      await developerRefused("a room price", () => updateRoomPriceAction(null, price(t.baseRate + 10_000)));
      await developerRefused("a promotion", () => savePromotionAction({ ...promo, name: "Wall test promotion 2", value: 90 }));
      await developerRefused("switching a promotion", () => setPromotionActiveAction({ id: p.id, isActive: false }));
      await developerRefused("a date price", () => savePriceRuleAction({ ...rule, name: "Wall test date price 2", price: 1_000 }));
      await developerRefused("switching a date price", () => setPriceRuleActiveAction({ id: r.id, isActive: false }));
      await developerRefused("the discount rules", () => saveDiscountRulesAction(null, rules(5_000_000)));
      await developerRefused("a room type's discount limit", () => saveRoomDiscountLimitAction(null, limit("500000")));

      // The Boss: the same screens, unchanged numbers (nothing of the hotel's changes).
      await decided("a room price (unchanged)", boss, () => updateRoomPriceAction(null, price(t.baseRate)));
      await decided("the discount rules (unchanged)", md, () => saveDiscountRulesAction(null, rules(settings.manualDiscountMax)));
      await decided("switching a promotion", boss, () => setPromotionActiveAction({ id: p.id, isActive: false }));
    } finally {
      await db.promotion.deleteMany({ where: { name: { startsWith: "Wall test" } } });
      await db.priceRule.deleteMany({ where: { name: { startsWith: "Wall test" } } });
    }
  });
});

// ───────────────────────────────────────────── 5. suppliers and stock: quotations, orders, deliveries, invoices, purchases ─────────────────────────────────────────────
describe("purchases and suppliers: a Developer — even given every purchasing right — writes no supplier document and approves no spending", () => {
  const MORE = ["procurement.manage", "purchases.authorize", "purchases.pay", "inventory.receive", "expenses.approve", "dashboard.owner", "dashboard.admin"];

  it("quotations, orders, deliveries, invoices, payments, purchases, approvals: refused, one entry each, nothing written", async () => {
    const devActor = await actorOf(dev, MORE);
    const count = async () => [await db.stockRequest.count(), await db.stockQuote.count(), await db.stockDelivery.count(), await db.supplierInvoice.count(), await db.supplierPayment.count(), await db.expense.count(), await db.inventoryMovement.count()];
    const before = await count();
    const calls: [string, () => Promise<unknown>][] = [
      ["quotation", () => saveQuote("none", { lines: [{ itemId: "x", quantity: 1, unitPrice: 1 }] }, null, devActor)],
      ["authorize a price", () => authorizeQuote("none", "AUTHORIZE", null, devActor)],
      ["purchase order", () => issueOrder("none", { expectedDeliveryOn: "2030-01-01" }, devActor)],
      ["delivery", () => recordDelivery("none", { lines: [] } as never, null, devActor)],
      ["supplier invoice", () => recordInvoice("none", { number: "INV-1", amount: 1, invoiceDate: "2030-01-01" }, null, devActor)],
      ["verify an invoice", () => verifyInvoice("none", "VERIFY", null, devActor)],
      ["pay a supplier", () => paySupplier("none", { amount: 1, accountId: "x", paidOn: "2030-01-01", clientKey: "k" } as never, devActor)],
      ["cancel an order", () => cancelOrder("none", "Changed", devActor)],
      ["record a purchase", () => savePurchase("none", { lines: [], purchasedOn: "2030-01-01", submit: false }, null, devActor)],
      ["review a request", () => reviewStockRequest("none", "APPROVE", null, devActor)],
      ["final approval", () => approvePurchase("none", {}, devActor)],
    ];
    for (const [what, run] of calls) await refusedAsDeveloper(run).catch((e) => { throw new Error(`${what}: ${e.message}`); });
    expect(await deniedBy(dev)).toBe(calls.length);
    expect(await count()).toEqual(before);
  });

  it("the Accountant passes the same gate (it reaches the request, which does not exist) and nobody's refusal is logged as a Developer's", async () => {
    const acc = await actorOf(accountant);
    const e = await thrownBy(() => saveQuote("none", { lines: [{ itemId: "x", quantity: 1, unitPrice: 1 }] }, null, acc));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).message).not.toMatch(/Developer account/);
    expect(await db.auditLog.count({ where: { action: "developer.denied" } })).toBe(0);
  });
});
