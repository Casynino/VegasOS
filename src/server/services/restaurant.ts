import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import type { MenuItemType, OrderPaymentStatus, RestaurantOrderStatus, RestaurantOrderType, RevenueKind } from "@/generated/prisma/enums";
import { audit } from "../audit";
import { AppError } from "../errors";
import { getSettings, getSettingsTx, stayConfig } from "../settings";
import { businessDateOf, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { lineDescription } from "@/lib/charge-types";
import { deliveryPlace } from "@/lib/delivery-place";
import { resolveAccountTx } from "./payment-accounts";
import { assertGroupBillOpen, recalculateReservation } from "./reservation-financials";
import { mediaUrl, uploadMedia } from "./media";
import { activeStaysFor, normalizePhone, pickedCustomerTx, resolveGuest } from "./guests";
import type { Actor } from "./reservations";
import { consumeRecipesTx } from "./inventory";
import { refreshSessionTx, sessionEventTx, sessionForTableOrderTx, sessionOrderedTx } from "./dining-core";
import { assignmentRowTx, setOrderWaiterTx, setRoomWaiterTx, setTableWaiterTx } from "./assignments";
import { ensureWaiterShiftTx } from "./waiter-shift-core";
import { isRestaurantDevice, worksWaiterShift } from "@/lib/permissions";

/**
 * Restaurant & bar — menu, orders and how their money is counted.
 *
 * Prices always come from the menu in the database at the moment of ordering and
 * are copied onto the order: a later price change never alters an old order.
 *  - Pay now      → sales (restaurant / bar / room-service fee) into the chosen account.
 *  - Charge to room → room-bill items on the guest's stay; checkout collects them.
 * Nothing is deleted: a cancelled order keeps its lines, and its sales / bill
 * items are voided with the reason.
 */

type Tx = Prisma.TransactionClient;

/**
 * One flow for every order — room service, table, takeaway, food or drinks: the cook (Mpishi)
 * accepts, prepares and marks it ready; a waiter takes it out and marks it delivered; it
 * completes by itself once it is delivered and settled (paid, or on the guest's room bill).
 */
export const ORDER_STEPS: RestaurantOrderStatus[] = ["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED"];
export const ORDER_FLOW: Record<RestaurantOrderType, RestaurantOrderStatus[]> = { DINE_IN: ORDER_STEPS, TAKEAWAY: ORDER_STEPS, PICKUP: ORDER_STEPS, ROOM_SERVICE: ORDER_STEPS };
/** The button that moves an order on, by the step it goes to. */
export const NEXT_STEP_LABEL: Record<string, string> = {
  ACCEPTED: "Accept", PREPARING: "Accept", READY: "Ready", OUT_FOR_DELIVERY: "Serve", DELIVERED: "Served",
};
/** The next step someone presses for an order (completing is automatic). */
export function nextOrderStep(o: { type: RestaurantOrderType; status: RestaurantOrderStatus }) {
  const raw = ORDER_STEPS[ORDER_STEPS.indexOf(o.status) + 1] ?? null;
  // Accepting starts the preparing (no separate "start" step).
  const next = raw === "ACCEPTED" ? "PREPARING" : raw;
  return next === "COMPLETED" || !ORDER_STEPS.includes(o.status) ? null : next;
}
export const STATUS_LABEL: Record<RestaurantOrderStatus, string> = {
  PENDING: "New", ACCEPTED: "Accepted", PREPARING: "Preparing", READY: "Ready to serve", OUT_FOR_DELIVERY: "Serving",
  DELIVERED: "Served", COMPLETED: "Completed", CANCELLED: "Cancelled", COLLECTED: "Collected",
};
export const TYPE_LABEL: Record<RestaurantOrderType, string> = { DINE_IN: "Dine in", TAKEAWAY: "Takeaway", PICKUP: "Pickup", ROOM_SERVICE: "Room service" };

// ───────────────────────── Menu ─────────────────────────

/** The menu for taking orders (active categories and items; unavailable items are flagged). */
export async function orderingMenu() {
  const cats = await db.menuCategory.findMany({
    where: { isActive: true }, orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, price: true, type: true, isAvailable: true, description: true, image: { select: { id: true, url: true, isActive: true } } },
      },
    },
  });
  return cats.filter((c) => c.items.length).map((c) => ({
    id: c.id, name: c.name, type: c.type,
    items: c.items.map(({ image, ...i }) => ({ ...i, image: image?.isActive ? mediaUrl(image) : null })),
  }));
}
export type OrderingMenu = Awaited<ReturnType<typeof orderingMenu>>;

/**
 * The menu for adding to a guest's bill (room page, stay, checkout): every item
 * with its photo and price, the most-ordered items of the last 60 days first,
 * and the room-service delivery fee.
 */
export async function billMenu() {
  const since = new Date(Date.now() - 60 * 86_400_000);
  const [categories, top, settings] = await Promise.all([
    orderingMenu(),
    db.restaurantOrderItem.groupBy({
      by: ["menuItemId"], where: { menuItemId: { not: null }, order: { createdAt: { gte: since }, status: { not: "CANCELLED" } } },
      _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 16,
    }),
    getSettings(),
  ]);
  return { categories, popular: top.map((t) => t.menuItemId).filter((id): id is string => !!id), fee: settings.roomServiceFee };
}
export type BillMenu = Awaited<ReturnType<typeof billMenu>>;

/** The public menu (website): active categories and items with their photo. */
export async function publicMenu() {
  return db.menuCategory.findMany({
    where: { isActive: true, items: { some: { isActive: true } } }, orderBy: { sortOrder: "asc" },
    include: { items: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { image: { select: { id: true, url: true, altText: true, isActive: true } } } } },
  });
}

export interface MenuItemInput {
  id?: string | null; categoryId: string; name: string; description?: string | null; price: number;
  subcategory?: string | null; isAvailable: boolean; isActive: boolean; isFeatured?: boolean; image?: File | null;
}

/** Add or edit a menu item (admin / manager). A price change is logged with the old and new price. */
export async function saveMenuItem(input: MenuItemInput, actor: Actor & { userId: string }) {
  if (!actor.permissions?.has("restaurant.menu")) throw new AppError("Only a manager or admin can change the menu.", "FORBIDDEN");
  const name = input.name.trim();
  if (name.length < 2) throw new AppError("Give the item a name.", "VALIDATION", { name: "Required" });
  if (!Number.isInteger(input.price) || input.price <= 0) throw new AppError("Enter the price in whole shillings.", "VALIDATION", { price: "Invalid" });
  const category = await db.menuCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) throw new AppError("Choose a category.", "VALIDATION", { categoryId: "Required" });
  const image = input.image && input.image.size > 0
    ? await uploadMedia({ file: input.image, title: name, category: category.revenueKind === "BAR" ? "BAR" : "RESTAURANT", altText: name }, actor)
    : null;
  const data = {
    categoryId: category.id, name, description: input.description?.trim() || null, price: input.price, type: category.type,
    subcategory: input.subcategory?.trim() || null, isAvailable: input.isAvailable, isActive: input.isActive, isFeatured: !!input.isFeatured,
    ...(image ? { imageId: image.id } : {}), updatedById: actor.userId,
  };
  return db.$transaction(async (tx) => {
    if (input.id) {
      const before = await tx.menuItem.findUnique({ where: { id: input.id } });
      if (!before) throw new AppError("Menu item not found.", "NOT_FOUND");
      const item = await tx.menuItem.update({ where: { id: before.id }, data });
      await audit(tx, actor, {
        action: before.price !== item.price ? "menu.price_changed" : "menu.item_updated", entityType: "MenuItem", entityId: item.id,
        before: { name: before.name, price: before.price, available: before.isAvailable, active: before.isActive, category: before.categoryId },
        after: { name: item.name, price: item.price, available: item.isAvailable, active: item.isActive, category: item.categoryId },
      });
      return item;
    }
    const last = await tx.menuItem.aggregate({ where: { categoryId: category.id }, _max: { sortOrder: true } });
    const item = await tx.menuItem.create({ data: { ...data, sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: actor.userId } });
    await audit(tx, actor, { action: "menu.item_created", entityType: "MenuItem", entityId: item.id, after: { name: item.name, price: item.price, category: category.name } });
    return item;
  });
}

/** Quick switch from the order screen or menu list: sold out today / back on. */
export async function setMenuItemAvailable(id: string, isAvailable: boolean, actor: Actor) {
  // The kitchen can mark a dish sold out (or back); prices and dishes stay with managers.
  if (!actor.permissions?.has("restaurant.menu") && !actor.permissions?.has("kitchen.orders")) throw new AppError("You cannot change the menu.", "FORBIDDEN");
  await db.$transaction(async (tx) => {
    const item = await tx.menuItem.update({ where: { id }, data: { isAvailable } });
    await audit(tx, actor, { action: "menu.availability_changed", entityType: "MenuItem", entityId: id, after: { name: item.name, available: isAvailable } });
  });
}

export async function saveMenuCategory(input: { id?: string | null; name: string; type: MenuItemType; revenueKind: RevenueKind; description?: string | null; isActive: boolean }, actor: Actor) {
  if (!actor.permissions?.has("restaurant.menu")) throw new AppError("Only a manager or admin can change the menu.", "FORBIDDEN");
  const name = input.name.trim();
  if (name.length < 2) throw new AppError("Give the category a name.", "VALIDATION", { name: "Required" });
  if (input.revenueKind !== "RESTAURANT" && input.revenueKind !== "BAR") throw new AppError("Choose restaurant or bar income.");
  const slug = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const data = { name, type: input.type, revenueKind: input.revenueKind, description: input.description?.trim() || null, isActive: input.isActive };
  return db.$transaction(async (tx) => {
    if (input.id) {
      const c = await tx.menuCategory.update({ where: { id: input.id }, data });
      await audit(tx, actor, { action: "menu.category_updated", entityType: "MenuCategory", entityId: c.id, after: data });
      return c;
    }
    const clash = await tx.menuCategory.findUnique({ where: { slug } });
    if (clash) throw new AppError(`There is already a category called ${clash.name}.`, "VALIDATION", { name: "Duplicate" });
    const last = await tx.menuCategory.aggregate({ _max: { sortOrder: true } });
    const c = await tx.menuCategory.create({ data: { ...data, slug, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
    await audit(tx, actor, { action: "menu.category_created", entityType: "MenuCategory", entityId: c.id, after: data });
    return c;
  });
}

/** Move a category up or down in the menu order. */
export async function moveMenuCategory(id: string, dir: -1 | 1, actor: Actor) {
  if (!actor.permissions?.has("restaurant.menu")) throw new AppError("Only a manager or admin can change the menu.", "FORBIDDEN");
  const all = await db.menuCategory.findMany({ orderBy: { sortOrder: "asc" } });
  const i = all.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  await db.$transaction([
    db.menuCategory.update({ where: { id: all[i].id }, data: { sortOrder: all[j].sortOrder } }),
    db.menuCategory.update({ where: { id: all[j].id }, data: { sortOrder: all[i].sortOrder } }),
  ]);
}

// ───────────────────────── Orders ─────────────────────────

export type OrderSettlement = "PAY_NOW" | "ROOM" | "UNPAID";
export interface OrderInput {
  type: RestaurantOrderType;
  items: { menuItemId: string; quantity: number }[];
  /** A guest staying in the hotel (needed for room service and for charging to the room). */
  reservationId?: string | null;
  tableLabel?: string | null;
  /** A table / the counter / the main restaurant (its name becomes the order's place). */
  locationId?: string | null;
  customerName?: string | null;
  notes?: string | null;
  /** Take out: where to deliver it (street, house or building, landmark). */
  deliveryAddress?: string | null;
  /** Pay now (into an account), charge to the guest's room, or pay later (at the counter / on delivery). */
  settlement: OrderSettlement;
  /** Why it goes on another guest's room (reception / managers — e.g. the guest there pays for their friend). */
  reason?: string | null;
  accountId?: string | null;
  reference?: string | null;
}

/** Who placed the order and for whom — the same engine for the menu QR, the website, the guest link and staff. */
/**
 * How a restaurant payment is recorded: into which account, the reference — and, at the Restaurant
 * Counter, which waiter physically brought the money (never the official collector).
 */
export type PayInput = {
  accountId?: string | null; reference?: string | null; handedOverById?: string | null;
  /** Recorded automatically through a payment method's own account (nTZS mobile-money prompts) — never from a staff screen. */
  methodId?: string | null;
};

export interface OrderContext {
  /** Placed by the customer themselves (no staff member): never "pay now"; room charges only for a verified stay. */
  byCustomer?: boolean;
  /** ROOM_QR | PUBLIC_QR | WEBSITE | GUEST_LINK | RECEPTION | RESTAURANT | BAR */
  source?: string;
  guestId?: string | null;
  /** Staff picked this customer in the search (not just typed a number): the order is theirs. */
  pickedGuestId?: string | null;
  /** The number given is kept on the order only — never saved onto the picked guest (a waiter's room service: only
   *  reception, who checks stays, gives a staying guest a phone; it would open their room to that number). */
  phoneOnOrderOnly?: boolean;
  customerPhone?: string | null;
  customerEmail?: string | null;
  /** Sent once per submit by the customer's screen: a repeated tap returns the same order. */
  clientKey?: string | null;
  /** The one room of the stay it goes to (a room QR scanned on a stay with several rooms) — must be one of the stay's checked-in rooms. */
  servedRoom?: string | null;
  /** Take out paid first by the customer: their payment screenshot, the account and code — for staff to check. */
  paidFirst?: { paymentProofFileId: string; customerPaidToId: string; customerPayRef: string | null; customerPaidAt: Date; expectedTotal?: number | null } | null;
  /** From a table's QR: the customer's session at the table (checked by the caller) — the order is part of it. */
  sessionId?: string | null;
  /** The customer chose "Pay online" (nTZS): the order waits for that payment before the kitchen starts it. */
  payOnline?: boolean;
  /** Paid now, recorded by someone else than the one making the order (the Restaurant Counter, for a waiter's order). */
  payBy?: Actor;
  /** Paid now at the Counter: the waiter who brought the money. */
  handedOverById?: string | null;
}

export const ORDER_SOURCE: Record<string, string> = {
  ROOM_QR: "Room QR", TABLE_QR: "Table QR", COUNTER_QR: "Counter QR", RESTAURANT_QR: "Restaurant QR",
  WAITER_MANUAL: "Waiter", STAFF_MANUAL: "Staff", RECEPTION: "Reception",
  PUBLIC_QR: "Public menu QR", WEBSITE: "Website menu", GUEST_LINK: "Guest's stay link", GUEST: "Guest's stay link",
  RESTAURANT: "Waiter", BAR: "Bar", STAFF: "Staff",
};
/** The source of an order from a restaurant place's QR. */
export const LOCATION_SOURCE: Record<string, string> = { TABLE: "TABLE_QR", COUNTER: "COUNTER_QR", MAIN: "RESTAURANT_QR" };
/** Finished orders. A delivered pay-later order is still open — it waits for its payment. */
export const CLOSED_STATUSES: RestaurantOrderStatus[] = ["COMPLETED", "COLLECTED", "CANCELLED"];
/** The cook's (Mpishi's) steps. */
export const KITCHEN_STEPS: RestaurantOrderStatus[] = ["ACCEPTED", "PREPARING", "READY"];
/** The waiter's steps: take the ready order out, mark it delivered (never reception). */
export const WAITER_STEPS: RestaurantOrderStatus[] = ["OUT_FOR_DELIVERY", "DELIVERED"];

/**
 * Who prepares an order: the Mpishi and the waiters (`kitchen.orders`) prepare anything — food,
 * drinks or both, one order; someone with only `bar.orders` prepares drinks-only orders.
 * Reception never prepares.
 */
function assertCanPrepare(actor: Actor, items: { type: MenuItemType }[]) {
  if (actor.permissions?.has("kitchen.orders")) return;
  const drinksOnly = items.length > 0 && items.every((i) => i.type === "DRINK");
  if (drinksOnly && actor.permissions?.has("bar.orders")) return;
  throw new AppError(drinksOnly ? "Only the Mpishi or a waiter prepares orders." : "Orders with food are prepared by the Mpishi or a waiter.", "FORBIDDEN");
}
/**
 * Paid online first (the customer sent proof) and nothing recorded from it yet — the order waits for the
 * check. Normally never: the online payment is recorded automatically as the order comes in (only when no
 * Restaurant Counter account exists yet does it wait). `paidOnlineBefore`: an online payment was ever
 * recorded on it (even if later reversed) — then the proof is dealt with.
 */
export const awaitsOnlinePayment = (o: { paymentProofFileId: string | null; settlement: string; paidAmount: number; paymentStatus: string; status: string }, paidOnlineBefore = false) =>
  !!o.paymentProofFileId && !paidOnlineBefore && o.status !== "CANCELLED" && o.settlement !== "ROOM" && (o.paidAmount === 0 || o.paymentStatus === "PENDING_CONFIRMATION");

/** The orders among these still waiting for their online payment check (see awaitsOnlinePayment). */
export async function awaitingOnlineTx(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  const orders = await tx.restaurantOrder.findMany({
    where: { id: { in: ids }, paymentProofFileId: { not: null } },
    select: { id: true, number: true, paymentProofFileId: true, settlement: true, paidAmount: true, paymentStatus: true, status: true, payments: { where: { online: true }, select: { id: true }, take: 1 } },
  });
  return orders.filter((o) => awaitsOnlinePayment(o, o.payments.length > 0));
}
const canPrepareAny = (actor: Actor) => !!(actor.permissions?.has("kitchen.orders") || actor.permissions?.has("bar.orders"));

/** Who did it, for the order's history (name and role as they were at the time). */
const by = (actor: Actor) => ({ byId: actor.userId ?? null, byLabel: actor.label ?? null, byRole: actor.role ?? null });

/** The orders among these with a mobile-money payment (nTZS) waiting on the customer's phone right now. */
export async function payingByPhoneTx(tx: Tx, ids: string[], now = new Date()) {
  if (!ids.length) return new Set<string>();
  const live = await tx.mobilePayment.findMany({
    where: { purpose: "RESTAURANT", status: "PENDING", completedAt: null, orderIds: { hasSome: ids }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { orderIds: true },
  });
  return new Set(live.flatMap((m) => m.orderIds).filter((id) => ids.includes(id)));
}
const PAYING_BY_PHONE = "The customer is paying this order by phone right now — wait a moment for the payment to finish.";

/**
 * Where an order stands with "Pay online" (nTZS): PAYING — a payment is on its way from the customer's phone now;
 * NOT_PAID — take out ordered with Pay online and not paid (take out never starts unpaid). The kitchen does not
 * accept either. A dine-in or room-service order whose online payment did not go through goes ahead, paid later.
 */
export type OnlinePayState = "PAYING" | "NOT_PAID";
type OnlineOrder = { id: string; type: string; status: string; settlement: string; paymentStatus: string; payOnlineAt: Date | null };
export async function onlinePayStatesTx(tx: Tx, orders: OnlineOrder[], now = new Date()) {
  const states = new Map<string, OnlinePayState>();
  const open = orders.filter((o) => o.payOnlineAt && o.status !== "CANCELLED" && o.settlement !== "ROOM" && o.paymentStatus !== "PAID");
  const paying = await payingByPhoneTx(tx, open.map((o) => o.id), now);
  for (const o of open) {
    if (paying.has(o.id)) states.set(o.id, "PAYING");
    else if (o.status === "PENDING" && (o.type === "TAKEAWAY" || o.type === "PICKUP")) states.set(o.id, "NOT_PAID");
  }
  return states;
}
export const onlinePayStates = (orders: OnlineOrder[], now = new Date()) => onlinePayStatesTx(db as unknown as Tx, orders, now);

export { deliveryPlace };

async function nextOrderNumber(tx: Tx, year: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('restaurant_order_number'))::text`;
  const last = await tx.restaurantOrder.findFirst({ where: { number: { startsWith: `ORD-${year}-` } }, orderBy: { number: "desc" }, select: { number: true } });
  return `ORD-${year}-${String(last ? Number(last.number.slice(-6)) + 1 : 1).padStart(6, "0")}`;
}

type Line = { menuItemId: string | null; name: string; quantity: number; lineTotal: number; revenueKind: RevenueKind };

/** The order's money by income line: restaurant, bar, room-service fee. */
function moneyParts(lines: Line[], serviceFee: number) {
  const parts: { kind: RevenueKind; amount: number; label: string }[] = [];
  for (const k of ["RESTAURANT", "BAR"] as const) {
    const of = lines.filter((l) => l.revenueKind === k);
    const amount = of.reduce((s, l) => s + l.lineTotal, 0);
    if (amount) parts.push({ kind: k, amount, label: of.map((l) => lineDescription(l.name, l.quantity)).join(", ") });
  }
  if (serviceFee) parts.push({ kind: "ROOM_SERVICE", amount: serviceFee, label: "Room service fee" });
  return parts;
}

/** Paid: one sale per income line (restaurant / bar / room-service fee) into the account. */
async function postOrderSalesTx(tx: Tx, order: { id: string; number: string }, lines: Line[], serviceFee: number,
  paid: { method: { id: string }; account: { id: string } }, reference: string | null, actor: Actor, now: Date, businessDate: BusinessDate, orderPaymentId: string) {
  const parts = moneyParts(lines, serviceFee);
  const cats = await tx.revenueCategory.findMany({ where: { code: { in: parts.map((p) => p.kind) } } });
  for (const p of parts) {
    const cat = cats.find((c) => c.code === p.kind);
    if (!cat) throw new AppError(`The ${p.kind.toLowerCase()} income category is missing.`);
    await tx.revenueTransaction.create({
      data: {
        categoryId: cat.id, kind: p.kind, amount: p.amount, paymentMethodId: paid.method.id, accountId: paid.account.id,
        description: `${order.number} · ${p.label}`.slice(0, 200), notes: reference ? `Ref ${reference}` : null,
        occurredAt: now, businessDate: toDbDate(businessDate), recordedById: actor.userId!, restaurantOrderId: order.id, orderPaymentId,
      },
    });
  }
}

/** Charged to the room: each line on the guest's bill (restaurant / bar / fee kept apart); checkout collects it. */
async function postOrderToRoomTx(tx: Tx, order: { id: string; number: string; type?: string; tableLabel?: string | null }, lines: Line[], serviceFee: number, reservationId: string, actor: Actor, businessDate: BusinessDate) {
  // Only on a stay that is checked in right now — never a checked-out (settled) or future booking.
  const [stay] = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS "status" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
  if (stay?.status !== "CHECKED_IN") throw new AppError("That guest is not staying in the hotel now — nothing more can go on their room bill.", "VALIDATION");
  await assertGroupBillOpen(tx, reservationId, actor);
  // Where it was eaten, on every line: "2 × Chips · Outside 3 · ORD-…" (room service says so).
  const place = order.type === "ROOM_SERVICE" ? "Room service" : order.tableLabel || null;
  for (const l of lines) {
    await tx.reservationCharge.create({
      data: {
        reservationId, description: [lineDescription(l.name, l.quantity), place, order.number].filter(Boolean).join(" · "), amount: l.lineTotal,
        kind: l.revenueKind, category: l.revenueKind === "BAR" ? "BAR" : "RESTAURANT", businessDate: toDbDate(businessDate),
        createdById: actor.userId ?? null, restaurantOrderId: order.id, menuItemId: l.menuItemId,
      },
    });
  }
  if (serviceFee) {
    await tx.reservationCharge.create({
      data: {
        reservationId, description: `Room service fee · ${order.number}`, amount: serviceFee, kind: "ROOM_SERVICE",
        category: "ROOM_SERVICE_FEE", businessDate: toDbDate(businessDate), createdById: actor.userId ?? null, restaurantOrderId: order.id,
      },
    });
  }
  await recalculateReservation(tx, reservationId);
}

/** Reception, managers and the MD check who is staying (see every staying room); waiters cannot. */
export const canVerifyRoom = (actor: Actor) => !!actor.permissions?.has("reservations.view");
/** Only a manager, the MD or the owner moves a bill onto ANOTHER guest's room (with the reason) — never a waiter or reception. */
export const canBillAnotherRoom = (actor: Actor) => ["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => !!actor.permissions?.has(p as never));

/**
 * An order FOR a staying guest picked from the list — reception's orders, and room service by anyone who takes orders
 * (owner, 2026-10-04: "the restaurant serves the hotel too"; waiters pick the staying guest the way reception does). The
 * customer is that guest — or someone on their booking when they were picked — never another person. A phone typed
 * here must not be someone else's; reception's fills in a guest who has none on file, a waiter's stays on the order only
 * (see OrderContext.phoneOnOrderOnly).
 */
export async function stayCustomer(reservationId: string | null | undefined, customerId: string | null | undefined, customerPhone: string | null | undefined, notStaying: string) {
  const stay = reservationId ? await db.reservation.findUnique({ where: { id: reservationId }, select: { status: true, guestId: true, guest: { select: { phone: true } }, guests: { select: { guestId: true } } } }) : null;
  if (stay?.status !== "CHECKED_IN") throw new AppError(notStaying, "VALIDATION", { reservationId: "Required" });
  const members = [stay.guestId, ...stay.guests.map((g) => g.guestId)];
  const guestId = customerId && members.includes(customerId) ? customerId : stay.guestId;
  const phone = stay.guest.phone ? null : customerPhone ?? null;
  const typed = normalizePhone(phone);
  if (typed) {
    const owner = await db.guest.findFirst({ where: { deletedAt: null, OR: [{ phone: typed }, { altPhone: typed }], id: { notIn: members } }, select: { fullName: true } });
    if (owner) throw new AppError(`That number belongs to another customer (${owner.fullName}) — enter the staying guest's own phone.`, "VALIDATION", { customerPhone: "Someone else's" });
  }
  return { guestId, phone };
}

/** An order's customers: the one it is for, and everyone at its table. */
async function orderCustomerIdsTx(tx: Tx, o: { guestId: string | null; sessionId: string | null }) {
  const ids = [o.guestId];
  if (o.sessionId) {
    const s = await tx.diningSession.findUnique({ where: { id: o.sessionId }, select: { guestId: true, members: { select: { guestId: true } } } });
    if (s) ids.push(s.guestId, ...s.members.map((m) => m.guestId));
  }
  return ids.filter((x): x is string => !!x);
}

/**
 * No active checked-in room = a normal restaurant customer (owner, 2026-10-04). A bill (or room service) goes only on
 * the customer's OWN checked-in stay — theirs or that of someone at their table — never an arbitrary room. Waiters and
 * reception are held to it; only a manager, the MD or the owner may move a bill to another guest's room, saying why
 * (e.g. the guest in 305 pays for their friend). Returns whether the room is the customer's own.
 */
async function assertRoomForCustomerTx(tx: Tx, reservationId: string, customerIds: string[], actor: Actor, opts: { reason?: string | null; reasonRequired: boolean }) {
  if (customerIds.length && (await activeStaysFor(tx, customerIds)).some((s) => s.id === reservationId)) return true;
  if (!canBillAnotherRoom(actor)) {
    throw new AppError(customerIds.length
      ? "That room is not this customer's — food goes only on the room of the guest staying in it (or someone at their table). They pay at the restaurant."
      : "Enter the customer's phone number first — then their room shows.", "FORBIDDEN");
  }
  if (opts.reasonRequired && (opts.reason?.trim().length ?? 0) < 3) {
    throw new AppError("That room is not this customer's — say why it goes on that room (e.g. the guest there pays for them).", "VALIDATION", { reason: "Required" });
  }
  return false;
}

/**
 * Take an order. Everything money-related is worked out here from the database —
 * never from the screen: item prices, subtotals, the room-service fee and the total.
 */
export async function createRestaurantOrder(input: OrderInput, actor: Actor, now = new Date(), ctx: OrderContext = {}) {
  return db.$transaction((tx) => createRestaurantOrderTx(tx, input, actor, now, ctx));
}

/**
 * The one order engine (menu QR, website, the guest's stay link, reception, restaurant, bar),
 * inside an open transaction (e.g. a walk-in booked, checked in and fed in one go).
 */
export async function createRestaurantOrderTx(tx: Tx, input: OrderInput, actor: Actor, now = new Date(), ctx: OrderContext = {}) {
  if (ctx.byCustomer) {
    if (input.settlement === "PAY_NOW") throw new AppError("Online orders are paid at the counter, on delivery or charged to the room.", "VALIDATION");
    if (input.settlement === "ROOM" && !input.reservationId) throw new AppError("Room charges need a confirmed stay.", "VALIDATION");
  } else if (!actor.userId || !(actor.permissions?.has("restaurant.orders") || actor.permissions?.has("kitchen.orders"))) throw new AppError("You cannot place restaurant orders.", "FORBIDDEN");
  const wanted = input.items.filter((i) => i.quantity > 0);
  if (!wanted.length) throw new AppError("Add at least one item.", "VALIDATION", { items: "Empty" });
  if (wanted.some((i) => !Number.isInteger(i.quantity) || i.quantity > 99)) throw new AppError("Quantities must be whole numbers up to 99.", "VALIDATION", { items: "Quantity" });
  // Room service and room bills only for a guest staying now — never a room number on its own.
  const needsStay = input.settlement === "ROOM" || input.type === "ROOM_SERVICE";
  if (needsStay && !input.reservationId) throw new AppError(input.type === "ROOM_SERVICE" ? "Choose the guest's room for room service." : "Choose the guest whose room is charged.", "VALIDATION", { reservationId: "Required" });
  // Paid now: the official payment is recorded by whoever records restaurant payments (the Restaurant Counter) — never a waiter.
  if (input.settlement === "PAY_NOW" && !(ctx.payBy ?? actor).permissions?.has("revenue.record")) throw new AppError("Payments are recorded at the Restaurant Counter — choose pay later or the room bill.", "FORBIDDEN");

  const settings = await getSettingsTx(tx);
  const businessDate = businessDateOf(now, stayConfig(settings));
  const lines = await priceLinesTx(tx, wanted);

  // A table, the counter or the main restaurant: the order is for that place (its name is kept on the order).
  const location = input.locationId ? await tx.restaurantLocation.findUnique({ where: { id: input.locationId } }) : null;
  if (input.locationId && (!location || !location.isActive)) throw new AppError("That table is not in use — choose another.", "VALIDATION", { locationId: "Inactive" });

  // The guest: must be staying in the hotel right now to charge the room or get room service.
  let reservation: { id: string; reference: string; guestId: string; guestName: string; guestPhone: string | null; roomNumber: string | null } | null = null;
  if (input.reservationId) {
    const r = await tx.reservation.findUnique({
      where: { id: input.reservationId },
      include: { guest: { select: { fullName: true, phone: true } }, rooms: { where: { status: "CHECKED_IN" }, include: { room: { select: { number: true } } } } },
    });
    if (!r) throw new AppError("Guest not found.", "NOT_FOUND");
    // An order linked to a stay is a hotel order: only while the guest is checked in (not a past, future or checked-out stay).
    if (r.status !== "CHECKED_IN") throw new AppError(`${r.guest.fullName} is not checked in — hotel orders (room service, room bills) are only for guests staying now.`, "VALIDATION", { reservationId: "Not in house" });
    const rooms = r.rooms.map((x) => x.room.number);
    if (ctx.servedRoom && !rooms.includes(ctx.servedRoom)) throw new AppError(`Room ${ctx.servedRoom} is not part of this stay any more — please call reception.`, "VALIDATION");
    reservation = { id: r.id, reference: r.reference, guestId: r.guestId, guestName: r.guest.fullName, guestPhone: r.guest.phone, roomNumber: ctx.servedRoom ?? (rooms.join(", ") || null) };
  }

  // Every customer is known by phone: a walk-in is saved (or found) by it. At a table the
  // customer is the person eating (their number) — the stay is only where the bill goes; a
  // staying guest without a phone on file gets the one given now (unless it is someone else's).
  const givenPhone = normalizePhone(ctx.customerPhone);
  // A customer staff picked in the search is that person (their blank phone gets this one).
  let customerGuestId = (!ctx.byCustomer && ctx.pickedGuestId ? await pickedCustomerTx(tx, ctx.pickedGuestId, ctx.phoneOnOrderOnly ? null : givenPhone) : null) ?? ctx.guestId ?? null;
  if (!ctx.byCustomer && givenPhone && !customerGuestId) {
    const known = await tx.guest.findFirst({ where: { deletedAt: null, OR: [{ phone: givenPhone }, { altPhone: givenPhone }] }, orderBy: { updatedAt: "desc" }, select: { id: true } });
    if (known) customerGuestId = known.id;
    // Reception (who checks the stay) may give a staying guest with no phone on file the number given now; a waiter's
    // unknown number is a new customer — it never becomes a staying guest's (that would open their room to anyone).
    else if (reservation && !reservation.guestPhone && canVerifyRoom(actor) && !canBillAnotherRoom(actor)) {
      await tx.guest.update({ where: { id: reservation.guestId }, data: { phone: givenPhone } });
      customerGuestId = reservation.guestId;
    } else customerGuestId = await resolveGuest(tx, { fullName: input.customerName?.trim() || "Restaurant customer", phone: givenPhone });
  }
  // Who the customer is BEFORE falling back to the stay's guest — for a waiter the room check never counts that
  // fallback; reception (who picks the staying guest) naming nobody else orders for that guest.
  const identified = givenPhone || ctx.pickedGuestId || ctx.guestId ? customerGuestId : canVerifyRoom(actor) ? reservation?.guestId ?? null : null;
  customerGuestId ??= reservation?.guestId ?? null;

  // Room service or a room bill: only the customer's own room (or the room of someone at their table) — the room is
  // where it goes and who pays; see assertRoomForCustomerTx. The server checks it, whatever the screen sent.
  let roomIsTheirs = true;
  if (!ctx.byCustomer && reservation && (input.settlement === "ROOM" || input.type === "ROOM_SERVICE")) {
    if (!actor.permissions?.has("restaurant.orders")) throw new AppError("Only waiters and reception put orders on a room.", "FORBIDDEN");
    // Who is eating: the customer named (by id, phone or pick) and everyone at the table.
    // (The table's people count only when the order joins that table — a dine-in order there.)
    const atTable = ctx.sessionId ?? (location?.kind === "TABLE" && input.type === "DINE_IN" ? (await tx.diningSession.findUnique({ where: { openAtId: location.id }, select: { id: true } }))?.id ?? null : null);
    const people = [ctx.guestId, identified, ...(atTable ? await orderCustomerIdsTx(tx, { guestId: null, sessionId: atTable }) : [])].filter((x): x is string => !!x);
    roomIsTheirs = await assertRoomForCustomerTx(tx, reservation.id, people, actor, { reason: input.reason, reasonRequired: true });
  }

  // At a table: the order is part of the customer's session there — a staff order at a free table starts one.
  const sessionId = ctx.sessionId
    ?? (location?.kind === "TABLE" && input.type === "DINE_IN" && !ctx.byCustomer && customerGuestId ? await sessionForTableOrderTx(tx, location.id, customerGuestId, actor, now) : null);

  // A waiter a manager put in charge of the table — or of the room's room service — gets its new orders.
  const roomNo = input.type === "ROOM_SERVICE" ? (reservation?.roomNumber ?? "").split(",")[0].trim() : "";
  const tableWaiter = sessionId ? (await tx.diningSession.findUnique({ where: { id: sessionId }, select: { waiterId: true } }))?.waiterId ?? null
    : roomNo ? (await tx.room.findUnique({ where: { number: roomNo }, select: { serviceWaiterId: true } }))?.serviceWaiterId ?? null : null;
  // Nobody routes it: a waiter ringing it up on their own phone serves it (never the shared screen, never a manager).
  const byWaiter = !ctx.byCustomer && !!actor.userId && !!actor.permissions && worksWaiterShift(actor.permissions);
  const waiterId = tableWaiter ?? (byWaiter ? actor.userId! : null);
  const selfServe = byWaiter && waiterId === actor.userId;
  const foodSubtotal = lines.filter((l) => l.type === "FOOD").reduce((s, l) => s + l.lineTotal, 0);
  const drinksSubtotal = lines.filter((l) => l.type === "DRINK").reduce((s, l) => s + l.lineTotal, 0);
  const serviceFee = input.type === "ROOM_SERVICE" ? settings.roomServiceFee : 0;
  const total = foodSubtotal + drinksSubtotal + serviceFee;
  const payNow = input.settlement === "PAY_NOW";
  const source = ctx.source ?? (ctx.byCustomer ? "WEBSITE" : "STAFF_MANUAL");
  const who = actor.label ?? (ctx.byCustomer ? "Customer" : null);

  const order = await tx.restaurantOrder.create({
    data: {
      number: await nextOrderNumber(tx, businessDate.slice(0, 4)), type: input.type, settlement: payNow ? "UNPAID" : input.settlement,
      reservationId: reservation?.id ?? null, roomNumber: reservation?.roomNumber ?? null,
      customerName: input.customerName?.trim() || reservation?.guestName || null, notes: input.notes?.trim() || null,
      deliveryAddress: input.type === "TAKEAWAY" ? input.deliveryAddress?.trim().slice(0, 200) || null : null,
      ...(ctx.byCustomer && ctx.paidFirst ? {
        paymentProofFileId: ctx.paidFirst.paymentProofFileId, customerPaidToId: ctx.paidFirst.customerPaidToId, customerPayRef: ctx.paidFirst.customerPayRef, customerPaidAt: ctx.paidFirst.customerPaidAt,
      } : {}),
      ...(ctx.byCustomer && ctx.payOnline && input.settlement === "UNPAID" ? { payOnlineAt: now } : {}),
      tableLabel: location && location.kind !== "MAIN" ? location.name : input.tableLabel?.trim() || null, locationId: location?.id ?? null, sessionId, assignedToId: waiterId,
      guestId: customerGuestId, customerPhone: givenPhone ?? ctx.customerPhone ?? reservation?.guestPhone ?? null, customerEmail: ctx.customerEmail ?? null,
      foodSubtotal, drinksSubtotal, serviceFee, total,
      businessDate: toDbDate(businessDate), createdById: ctx.byCustomer ? null : actor.userId!, source,
      trackToken: randomBytes(12).toString("base64url"), clientKey: ctx.clientKey ?? null, createdAt: now, statusChangedAt: now,
      items: { create: lines.map((l) => ({ ...l, round: 1, addedAt: now, addedById: ctx.byCustomer ? null : actor.userId ?? null })) },
      events: { create: { to: "PENDING", byId: ctx.byCustomer ? null : actor.userId ?? null, byLabel: who, byRole: ctx.byCustomer ? "Customer" : actor.role ?? null, at: now, note: ORDER_SOURCE[source] ?? source } },
    },
  });

  if (waiterId) {
    await assignmentRowTx(tx, {
      scope: "ORDER", orderId: order.id, locationId: order.locationId, roomNumber: order.roomNumber, toUserId: waiterId,
      kind: selfServe ? "TAKEN" : "ROUTED", via: selfServe ? (viaPin(actor) ? "PIN" : "SELF") : sessionId ? "TABLE" : "ROOM",
    }, actor, now);
    if (selfServe) await ensureWaiterShiftTx(tx, waiterId, actor, now, `order ${order.number}`);
  }
  if (input.settlement === "ROOM") await postOrderToRoomTx(tx, order, lines, serviceFee, reservation!.id, actor, businessDate);
  // UNPAID: nothing is counted until the payment is recorded (or it is charged to a room).
  if (sessionId) await sessionOrderedTx(tx, sessionId, ctx.byCustomer ? { userId: null, label: who ?? "Customer" } : actor, now);

  await audit(tx, actor, {
    action: "restaurant_order.created", entityType: "RestaurantOrder", entityId: order.id,
    after: {
      number: order.number, type: order.type, settlement: order.settlement, total, serviceFee, room: order.roomNumber, source, byCustomer: !!ctx.byCustomer, role: ctx.byCustomer ? "Customer" : actor.role ?? null,
      ...(order.payOnlineAt ? { payOnline: true } : {}),
      ...(input.settlement === "ROOM" ? { billing: `Room ${order.roomNumber ?? ""}`.trim(), businessDate } : {}),
      customer: order.customerName, phone: order.customerPhone, reservation: reservation?.reference ?? null, place: order.tableLabel, location: location?.id ?? null, session: sessionId,
      ...(!roomIsTheirs ? { roomOfAnotherGuest: true, reason: input.reason?.trim() || null } : {}),
      items: lines.map((l) => `${l.quantity} × ${l.name} @ ${l.unitPrice}`),
    },
  });
  // Paid online first (LIPA, with the customer's proof): recorded at once, confirmed automatically, as the Restaurant
  // Counter's payment — nobody has to press Confirm. "Payment not received" undoes it if the money never arrives.
  // (No Counter account set up yet: it waits for the check, as before.)
  if (ctx.byCustomer && ctx.paidFirst) {
    // The customer paid what they were shown: a price that changed while they paid is flagged on the order for the check.
    const shown = ctx.paidFirst.expectedTotal;
    if (shown != null && shown !== order.total) {
      await tx.restaurantOrderEvent.create({ data: { orderId: order.id, from: "PENDING", to: "PENDING", byId: null, byLabel: who, byRole: "Customer", at: now, note: `The customer was shown TZS ${shown.toLocaleString("en-US")} and paid for that; the order comes to TZS ${order.total.toLocaleString("en-US")} — check the account` } });
    }
    const counter = await onlineCollectorTx(tx);
    if (counter) return payOrderTx(tx, order.id, { accountId: ctx.paidFirst.customerPaidToId, reference: ctx.paidFirst.customerPayRef }, counter, now, { online: true, noCollector: !counter.counter });
  }
  // Paid as it is ordered: the payment is recorded like any other (sales into the account, who took it).
  if (payNow) return payOrderTx(tx, order.id, { accountId: input.accountId ?? "", reference: input.reference, handedOverById: ctx.handedOverById ?? null }, ctx.payBy ?? actor, now);
  return order;
}

/** Order lines priced from the menu now (never from the screen); unavailable or removed items are refused. */
async function priceLinesTx(tx: Tx, wanted: { menuItemId: string; quantity: number }[]) {
  const items = wanted.filter((w) => w.quantity > 0);
  if (!items.length) throw new AppError("Add at least one item.", "VALIDATION", { items: "Empty" });
  if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity > 99)) throw new AppError("Quantities must be whole numbers up to 99.", "VALIDATION", { items: "Quantity" });
  const menu = await tx.menuItem.findMany({ where: { id: { in: items.map((w) => w.menuItemId) } }, include: { category: true } });
  return items.map((w) => {
    const m = menu.find((x) => x.id === w.menuItemId);
    if (!m || !m.isActive || !m.category.isActive) throw new AppError("An item on this order is no longer on the menu. Remove it and try again.", "VALIDATION", { items: "Inactive" });
    if (!m.isAvailable) throw new AppError(`${m.name} is not available right now.`, "VALIDATION", { items: "Unavailable" });
    return { menuItemId: m.id, name: m.name, unitPrice: m.price, quantity: w.quantity, lineTotal: m.price * w.quantity, type: m.type, revenueKind: m.category.revenueKind };
  });
}

/** An order's lines as stored (prices as ordered), for posting its money later. */
async function storedLines(tx: Tx, orderId: string): Promise<Line[]> {
  const items = await tx.restaurantOrderItem.findMany({ where: { orderId }, orderBy: { id: "asc" } });
  return items.map((i) => ({ menuItemId: i.menuItemId, name: i.name, quantity: i.quantity, lineTotal: i.lineTotal, revenueKind: i.revenueKind }));
}

/**
 * Delivered and settled → completed: on the room bill, or paid in full (a payment still
 * waiting for reception's confirmation counts — it was collected). A delivered order with
 * money still due waits for its payment.
 */
async function completeIfSettledTx(tx: Tx, o: { id: string; status: RestaurantOrderStatus; settlement: string; total: number; paidAmount: number }, actor: Actor, now: Date) {
  if (o.status !== "DELIVERED") return false;
  if (o.settlement !== "ROOM" && o.paidAmount < o.total) return false;
  await tx.restaurantOrder.update({ where: { id: o.id }, data: { status: "COMPLETED", completedAt: now, statusChangedAt: now } });
  await consumeRecipesTx(tx, o.id, actor, now);
  await tx.restaurantOrderEvent.create({ data: { orderId: o.id, from: "DELIVERED", to: "COMPLETED", ...by(actor), note: o.settlement === "ROOM" ? "On the room bill" : "Paid", at: now } });
  return true;
}

/** What a direct (not room-bill) order still owes: the lines no payment settled yet, plus the room-service fee if none covered it. */
async function outstandingTx(tx: Tx, orderId: string) {
  const o = await tx.restaurantOrder.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { id: "asc" } }, payments: { where: { status: "POSTED" }, select: { fee: true } } },
  });
  if (!o) throw new AppError("Order not found.", "NOT_FOUND");
  const unpaid = o.items.filter((i) => !i.paymentId);
  const fee = Math.max(0, o.serviceFee - o.payments.reduce((t, p) => t + p.fee, 0));
  return { o, unpaid, fee, amount: unpaid.reduce((t, i) => t + i.lineTotal, 0) + fee };
}

/** Work out the order's payment status from its payments (never typed in): unpaid, part-paid, waiting for confirmation, paid, refunded. */
async function refreshPaymentTx(tx: Tx, orderId: string) {
  const o = await tx.restaurantOrder.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { select: { amount: true, status: true, confirmedAt: true, notReceived: true } } } });
  const posted = o.payments.filter((p) => p.status === "POSTED");
  const paid = posted.reduce((t, p) => t + p.amount, 0);
  // Cancelled after money was taken: refunded — but an online payment that never arrived was never money.
  const status: OrderPaymentStatus = paid === 0
    ? (o.status === "CANCELLED" && o.payments.some((p) => !p.notReceived) ? "REFUNDED" : "UNPAID")
    : paid < o.total ? "PARTIALLY_PAID"
    : posted.some((p) => !p.confirmedAt) ? "PENDING_CONFIRMATION" : "PAID";
  const settlement = o.settlement === "ROOM" ? "ROOM" : paid > 0 ? "PAY_NOW" : "UNPAID";
  if (o.paidAmount === paid && o.paymentStatus === status && o.settlement === settlement) return o;
  return tx.restaurantOrder.update({ where: { id: orderId }, data: { paidAmount: paid, paymentStatus: status, settlement } });
}

/**
 * A payment for an order: it always settles everything still due (the first payment, or the
 * items added after it). Recorded into the chosen hotel account as sales by income line, with
 * who collected it. When the hotel asks for it, a waiter's payment waits for reception to
 * confirm it (reception's and managers' own payments are confirmed at once).
 */
async function payOrderTx(tx: Tx, id: string, input: PayInput, actor: Actor, now: Date, opts: { online?: boolean; noCollector?: boolean; viaNtzs?: boolean } = {}) {
  const { o, unpaid, fee, amount } = await outstandingTx(tx, id);
  if (o.status === "CANCELLED") throw new AppError("This order was cancelled.");
  if (o.settlement === "ROOM") throw new AppError("This order is on the guest's room bill — it is paid at check-out.");
  if (amount <= 0) throw new AppError("This order is already paid.");
  // Paid online (the customer sent their payment): a waiter never collects it again — reception checks the account and records it.
  if (o.paymentProofFileId && actor.permissions && worksWaiterShift(actor.permissions)) throw new AppError("The customer already paid online — the Restaurant Counter confirms it from the customer's proof. Do not collect it again.", "FORBIDDEN");
  if (await tx.reservationCharge.count({ where: { restaurantOrderId: id, isVoided: false } })) throw new AppError("This order is still on a room bill — remove it from the room bill first.", "CONFLICT");
  const settings = await getSettingsTx(tx);
  const businessDate = businessDateOf(now, stayConfig(settings));
  // A staff screen names the account; the automatic nTZS recording names its payment method (the nTZS account is never
  // offered to staff, so it can only be reached this way).
  const paid = await resolveAccountTx(tx, opts.viaNtzs && input.methodId ? { methodId: input.methodId } : { accountId: input.accountId }, "payments", { internal: !!opts.viaNtzs });
  const reference = input.reference?.trim() || null;
  // Every restaurant payment counts as confirmed as it is recorded — nobody confirms payments by hand (owner, 2026-10-04).
  // Paid online by the customer: recorded automatically — "Payment not received" undoes it if the money never arrives.
  // Recorded from the customer's proof by hand (no Counter account yet): it is the online payment all the same
  // (marked online), but recorded by whoever confirmed it.
  const auto = !!opts.online;
  const online = auto || (await awaitingOnlineTx(tx, [id])).length > 0;
  const confirmed = true;
  // The shared Restaurant Counter is the restaurant's official payment station: the payment is the Counter's.
  const atCounter = auto || (!!actor.permissions && isRestaurantDevice(actor.permissions));
  // The waiter who brought the money to the Counter (optional): a record of the handover, never the collector.
  const broughtBy = input.handedOverById
    ? await tx.user.findFirst({
      where: {
        id: input.handedOverById, isActive: true,
        role: { AND: [
          { permissions: { some: { permission: { code: "restaurant.serve" } } } },
          { permissions: { none: { permission: { code: { in: ["restaurant.device", "dashboard.manager", "dashboard.owner", "dashboard.admin"] } } } } },
        ] },
      },
      select: { id: true, fullName: true },
    })
    : null;
  // (nTZS confirms long after the prompt: a waiter no longer valid is simply not noted — the money is still recorded.)
  if (input.handedOverById && !broughtBy && !opts.viaNtzs) throw new AppError("Choose the waiter who brought the money.", "VALIDATION", { handedOverById: "Invalid" });
  const payment = await tx.restaurantOrderPayment.create({
    data: {
      orderId: id, amount, fee, accountId: paid.account.id, paymentMethodId: paid.method.id, reference,
      collectedById: opts.noCollector ? null : actor.userId ?? null, collectedByRole: actor.role ?? null, collectedAt: now, atCounter, online, handedOverById: broughtBy?.id ?? null,
      ...(confirmed && (opts.viaNtzs
        ? { confirmedById: null, confirmedByRole: "Automatic — nTZS mobile money", confirmedAt: now }
        : auto
        ? { confirmedById: null, confirmedByRole: "Automatic — paid online", confirmedAt: now }
        : { confirmedById: actor.userId ?? null, confirmedByRole: actor.role ?? null, confirmedAt: now })),
    },
  });
  await postOrderSalesTx(tx, o, unpaid, fee, paid, reference, actor, now, businessDate, payment.id);
  await tx.restaurantOrderItem.updateMany({ where: { id: { in: unpaid.map((i) => i.id) } }, data: { paymentId: payment.id } });
  await tx.restaurantOrder.update({ where: { id }, data: { accountId: paid.account.id, paymentReference: reference, paidAt: now } });
  const updated = await refreshPaymentTx(tx, id);
  await tx.restaurantOrderEvent.create({
    data: { orderId: id, from: o.status, to: o.status, ...by(actor), at: now, note: opts.viaNtzs
      ? `Paid by mobile money (nTZS) · TZS ${amount.toLocaleString("en-US")}${reference ? ` · Ref ${reference}` : ""} · confirmed by nTZS`
      : auto
      ? `Paid online by the customer · TZS ${amount.toLocaleString("en-US")} · ${paid.account.name}${reference ? ` · Ref ${reference}` : ""} · recorded automatically`
      : `Payment received${atCounter ? " at the Restaurant Counter" : ""} · TZS ${amount.toLocaleString("en-US")} · ${paid.account.name}${reference ? ` · Ref ${reference}` : ""}${broughtBy ? ` · brought by ${broughtBy.fullName.replace(/\s*\(.*\)/, "")}` : ""}${confirmed ? "" : " · waiting to be confirmed"}` },
  });
  await audit(tx, actor, {
    action: "restaurant_order.paid", entityType: "RestaurantOrder", entityId: id,
    before: { paymentStatus: o.paymentStatus, paidAmount: o.paidAmount },
    after: { paymentStatus: updated.paymentStatus, paidAmount: updated.paidAmount, amount, account: paid.account.name, reference, payment: payment.id, confirmed, ...(atCounter && { recordedThrough: "Restaurant Counter" }), ...(online && { paidOnline: true, automatic: auto }), ...(opts.viaNtzs && { nTZS: true }), ...(broughtBy && { broughtBy: broughtBy.fullName }) },
  });
  await completeIfSettledTx(tx, updated, actor, now);
  if (o.sessionId) await refreshSessionTx(tx, o.sessionId, actor, now);
  return updated;
}

/**
 * What is due on these orders for a mobile-money prompt (nTZS): refused when one is cancelled, on a room bill (paid at
 * check-out), or waiting for the check of the customer's own online payment — never asked twice.
 */
export async function ordersDueForPrompt(orderIds: string[]) {
  const ids = [...new Set(orderIds)];
  if (!ids.length) throw new AppError("Choose the order to be paid.", "VALIDATION");
  let total = 0;
  const due: { id: string; number: string; amount: number; customerPhone: string | null; customerName: string | null }[] = [];
  for (const id of ids) {
    const { o, amount } = await outstandingTx(db as unknown as Tx, id);
    if (o.status === "CANCELLED") throw new AppError(`Order ${o.number} was cancelled.`, "CONFLICT");
    if (o.settlement === "ROOM") throw new AppError(`Order ${o.number} is on the guest's room bill — it is paid at check-out.`, "CONFLICT");
    if ((await awaitingOnlineTx(db as unknown as Tx, [id])).length) throw new AppError(`The customer already paid order ${o.number} online — check their payment instead.`, "CONFLICT");
    if (await db.reservationCharge.count({ where: { restaurantOrderId: id, isVoided: false } })) throw new AppError(`Order ${o.number} is still on a room bill.`, "CONFLICT");
    if (amount <= 0) continue;
    total += amount;
    due.push({ id, number: o.number, amount, customerPhone: o.customerPhone, customerName: o.customerName });
  }
  if (!total) throw new AppError(ids.length > 1 ? "This bill is already paid." : "This order is already paid.", "CONFLICT");
  return { total, orders: due };
}

/**
 * nTZS confirmed a mobile-money payment for these orders: each order still due is paid in full, as long as the money
 * received covers it — never more than came in (an order with items added since the prompt waits for the rest).
 * Returns the payments made and what is left over.
 */
export async function payOrdersFromMobileTx(tx: Tx, orderIds: string[], received: number, input: PayInput, actor: Actor, now: Date) {
  let left = received;
  const paid: { orderId: string; paymentId: string; amount: number }[] = [];
  for (const id of [...new Set(orderIds)].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    const { o, amount } = await outstandingTx(tx, id);
    if (o.status === "CANCELLED" || o.settlement === "ROOM" || amount <= 0 || amount > left) continue;
    if ((await awaitingOnlineTx(tx, [id])).length) continue;
    if (await tx.reservationCharge.count({ where: { restaurantOrderId: id, isVoided: false } })) continue;
    await payOrderTx(tx, id, input, actor, now, { viaNtzs: true });
    const p = await tx.restaurantOrderPayment.findFirstOrThrow({ where: { orderId: id, status: "POSTED" }, orderBy: { createdAt: "desc" }, select: { id: true, amount: true } });
    paid.push({ orderId: id, paymentId: p.id, amount: p.amount });
    left -= p.amount;
  }
  return { paid, left };
}

/** A pay-later order is paid (at the table / counter / on delivery / by phone): the sales are recorded now, by income line. */
export async function recordOrderPayment(id: string, input: PayInput, actor: Actor, now = new Date()) {
  if (!actor.userId || !actor.permissions?.has("revenue.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    return payOrderTx(tx, id, input, actor, now);
  });
}

/** Reception (or a manager) confirms a payment a waiter collected — the collector stays on record. */
export async function confirmOrderPayment(paymentId: string, actor: Actor, now = new Date()) {
  if (!actor.userId || !actor.permissions?.has("restaurant.payments.confirm")) throw new AppError("Only reception or a manager confirms payments.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const p = await tx.restaurantOrderPayment.findUnique({ where: { id: paymentId }, include: { account: { select: { name: true } } } });
    if (!p) throw new AppError("Payment not found.", "NOT_FOUND");
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${p.orderId} FOR UPDATE`;
    if (p.status !== "POSTED") throw new AppError("This payment was reversed.");
    if (p.confirmedAt) throw new AppError("This payment is already confirmed.");
    await tx.restaurantOrderPayment.update({ where: { id: paymentId }, data: { confirmedById: actor.userId, confirmedByRole: actor.role ?? null, confirmedAt: now } });
    const o = await refreshPaymentTx(tx, p.orderId);
    await tx.restaurantOrderEvent.create({ data: { orderId: p.orderId, from: o.status, to: o.status, ...by(actor), at: now, note: `Payment confirmed · TZS ${p.amount.toLocaleString("en-US")} · ${p.account.name}` } });
    await audit(tx, actor, { action: "restaurant_order.payment_confirmed", entityType: "RestaurantOrder", entityId: p.orderId, before: { payment: p.id, confirmed: false }, after: { payment: p.id, confirmed: true, amount: p.amount } });
    return o;
  });
}

/**
 * A payment recorded by mistake (wrong order, wrong amount, given back): reversed with the
 * reason — its sales are voided, never deleted — and what it paid is due again.
 */
export async function reverseOrderPayment(paymentId: string, reason: string, actor: Actor, now = new Date()) {
  if (!actor.userId || !actor.permissions?.has("revenue.void")) throw new AppError("Only a manager can reverse a payment.", "FORBIDDEN");
  const why = reason.trim();
  if (!why) throw new AppError("Say why the payment is reversed.", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    const p = await tx.restaurantOrderPayment.findUnique({ where: { id: paymentId }, include: { account: { select: { name: true } } } });
    if (!p) throw new AppError("Payment not found.", "NOT_FOUND");
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${p.orderId} FOR UPDATE`;
    if (p.status !== "POSTED") throw new AppError("This payment is already reversed.");
    await reversePaymentTx(tx, p.id, `Payment reversed: ${why}`, actor, now);
    let o = await refreshPaymentTx(tx, p.orderId);
    if (o.status === "COMPLETED" && o.settlement !== "ROOM" && o.paidAmount < o.total) {
      o = await tx.restaurantOrder.update({ where: { id: o.id }, data: { status: "DELIVERED", completedAt: null, statusChangedAt: now } });
      await tx.restaurantOrderEvent.create({ data: { orderId: o.id, from: "COMPLETED", to: "DELIVERED", ...by(actor), at: now, note: "Open again — waiting for payment" } });
    }
    await tx.restaurantOrderEvent.create({ data: { orderId: p.orderId, from: o.status, to: o.status, ...by(actor), at: now, note: `Payment reversed · TZS ${p.amount.toLocaleString("en-US")} · ${p.account.name} · ${why}` } });
    await audit(tx, actor, { action: "restaurant_order.payment_reversed", entityType: "RestaurantOrder", entityId: p.orderId, before: { payment: p.id, amount: p.amount, account: p.account.name }, after: { reversed: true, reason: why } });
    if (o.sessionId) await refreshSessionTx(tx, o.sessionId, actor, now);
    return o;
  });
}

/** Reverse one payment inside a transaction: its sales voided (kept), its lines due again. */
async function reversePaymentTx(tx: Tx, paymentId: string, reason: string, actor: Actor, now: Date) {
  await tx.revenueTransaction.updateMany({ where: { orderPaymentId: paymentId, isVoided: false }, data: { isVoided: true, voidReason: reason, voidedAt: now } });
  await tx.restaurantOrderItem.updateMany({ where: { paymentId }, data: { paymentId: null } });
  await tx.restaurantOrderPayment.update({ where: { id: paymentId }, data: { status: "REVERSED", reversedById: actor.userId ?? null, reversedAt: now, reverseReason: reason } });
}

/**
 * Take an order off the room bill (inside a transaction, the order row locked): its room-bill
 * lines are voided (kept on record, with why), the stay recalculated, and the order is to pay
 * at the restaurant again. Only while the guest is still staying, the lines are not on a
 * company / group invoice already, and the room's bill has not already been paid with it.
 */
async function takeOrderOffRoomTx(tx: Tx, o: { id: string; number: string; status: RestaurantOrderStatus; settlement: string; reservationId: string | null; roomNumber: string | null }, why: string, actor: Actor) {
  if (o.status === "CANCELLED") throw new AppError("This order was cancelled.");
  if (o.settlement !== "ROOM" || !o.reservationId) throw new AppError("This order is not on a room bill.");
  await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${o.reservationId} FOR UPDATE`;
  const r = await tx.reservation.findUniqueOrThrow({ where: { id: o.reservationId }, select: { id: true, status: true, reference: true } });
  if (r.status !== "CHECKED_IN") throw new AppError("The guest has checked out — this order was settled with the room bill.");
  await assertGroupBillOpen(tx, r.id, actor);
  const lines = await tx.reservationCharge.findMany({ where: { restaurantOrderId: o.id, isVoided: false }, select: { id: true } });
  const invoiced = await tx.invoiceItem.findFirst({ where: { sourceId: { in: lines.map((l) => l.id) }, invoice: { status: { notIn: ["CANCELLED", "VOID"] }, OR: [{ reservationId: null }, { reservationId: { not: r.id } }] } }, select: { invoice: { select: { number: true } } } });
  if (invoiced) throw new AppError(`This order is already on invoice ${invoiced.invoice.number} — a manager credits it there.`, "CONFLICT");
  const room = o.roomNumber ? `room ${o.roomNumber}` : "the room";
  await tx.reservationCharge.updateMany({ where: { restaurantOrderId: o.id, isVoided: false }, data: { isVoided: true, voidReason: `${why} · ${o.number}`.slice(0, 300) } });
  await recalculateReservation(tx, r.id);
  const stay = await tx.reservation.findUniqueOrThrow({ where: { id: r.id }, select: { balanceAmount: true } });
  if (stay.balanceAmount < 0) throw new AppError(`The guest already paid ${room}'s bill including this order — nothing more to collect.`);
  await tx.restaurantOrder.update({ where: { id: o.id }, data: { settlement: "UNPAID" } });
  return { room, reservation: r.reference };
}

/**
 * On the room bill, but the guest pays now instead (cash / M-Pesa at the door): its room-bill
 * lines are voided (kept on record), the stay's bill recalculated, and the sales recorded.
 * Only while the guest is still staying and the room bill has not already covered it.
 */
export async function payRoomOrderNow(id: string, input: PayInput, actor: Actor, now = new Date()) {
  if (!actor.userId || !actor.permissions?.has("revenue.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    const o = await tx.restaurantOrder.findUnique({ where: { id } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    if (o.status === "CANCELLED") throw new AppError("This order was cancelled.");
    if (o.settlement !== "ROOM") throw new AppError(o.paidAmount >= o.total ? "This order is already paid." : "This order is not on a room bill.");
    const off = await takeOrderOffRoomTx(tx, o, "Paid at the restaurant instead", actor);
    await tx.restaurantOrderEvent.create({ data: { orderId: id, from: o.status, to: o.status, ...by(actor), note: `Removed from ${off.room}'s bill — paid now`, at: now } });
    if (o.sessionId) await sessionEventTx(tx, o.sessionId, "OFF_ROOM", `Order ${shortNo(o.number)} · TZS ${o.total.toLocaleString("en-US")} removed from ${off.room}'s bill — paid now`, actor, now);
    await audit(tx, actor, {
      action: "restaurant_order.room_paid_now", entityType: "RestaurantOrder", entityId: id,
      before: { settlement: "ROOM", billing: `Room ${o.roomNumber ?? ""}`.trim(), reservation: off.reservation },
      after: { settlement: "PAY_NOW", billing: "Restaurant", total: o.total, customer: o.guestId, table: o.tableLabel, session: o.sessionId, source: o.source, role: actor.role ?? null },
    });
    return payOrderTx(tx, id, input, actor, now);
  });
}

const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;

/**
 * Put an unpaid order on a staying guest's room bill (inside a transaction): the order keeps its
 * table, session and customer — the room is only where the bill goes, so its money is counted
 * once, as restaurant / bar income. Only the customer's own room for a waiter
 * (assertRoomForCustomerTx); reception and managers say why when it is another guest's room.
 */
export async function chargeOrderToRoomTx(tx: Tx, id: string, reservationId: string, actor: Actor, now: Date, opts: { reason?: string | null } = {}) {
  if (!actor.userId || !actor.permissions?.has("restaurant.orders")) throw new AppError("You cannot charge orders to rooms.", "FORBIDDEN");
  await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
  const o = await tx.restaurantOrder.findUnique({ where: { id } });
  if (!o) throw new AppError("Order not found.", "NOT_FOUND");
  if (o.status === "CANCELLED") throw new AppError("This order was cancelled.");
  if (o.settlement === "ROOM") throw new AppError("This order is already on a room bill.");
  if (o.paidAmount > 0) throw new AppError("Part of this order is already paid — receive the rest as a payment.");
  if ((await awaitingOnlineTx(tx, [id])).length) throw new AppError("The customer paid this order online — it cannot go on a room. Confirm their payment, or decline the order.", "CONFLICT");
  if ((await payingByPhoneTx(tx, [id], now)).size) throw new AppError(PAYING_BY_PHONE, "CONFLICT");
  if (await tx.revenueTransaction.count({ where: { restaurantOrderId: id, isVoided: false } })) throw new AppError("Money for this order is already recorded at the restaurant — it cannot also go on a room.", "CONFLICT");
  await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
  const r = await tx.reservation.findUnique({ where: { id: reservationId }, include: { guest: { select: { fullName: true } }, rooms: { where: { status: "CHECKED_IN" }, include: { room: { select: { number: true } } } } } });
  if (!r || r.status !== "CHECKED_IN") throw new AppError("Only a guest staying now can have it on their room bill.");
  const theirs = await assertRoomForCustomerTx(tx, r.id, await orderCustomerIdsTx(tx, o), actor, { reason: opts.reason, reasonRequired: true });
  const reason = opts.reason?.trim() || null;
  const settings = await getSettingsTx(tx);
  await postOrderToRoomTx(tx, o, await storedLines(tx, id), o.serviceFee, r.id, actor, businessDateOf(now, stayConfig(settings)));
  const room = r.rooms.map((x) => x.room.number).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", ") || o.roomNumber;
  const updated = await tx.restaurantOrder.update({ where: { id }, data: { settlement: "ROOM", reservationId: r.id, roomNumber: room, guestId: o.guestId ?? r.guestId } });
  const note = `Charged to room ${room} · ${r.guest.fullName}${reason ? ` — ${reason}` : ""}`;
  await tx.restaurantOrderEvent.create({ data: { orderId: id, from: o.status, to: o.status, ...by(actor), note: `${note} · ${r.reference}`, at: now } });
  if (o.sessionId) await sessionEventTx(tx, o.sessionId, "CHARGED_TO_ROOM", `Order ${shortNo(o.number)} · TZS ${o.total.toLocaleString("en-US")} → ${note}`, actor, now);
  await audit(tx, actor, {
    action: "restaurant_order.charged_to_room", entityType: "RestaurantOrder", entityId: id,
    before: { settlement: o.settlement, billing: "Restaurant" },
    after: {
      settlement: "ROOM", billing: `Room ${room}`, reservation: r.reference, room, total: o.total, customer: o.guestId, customerName: o.customerName,
      table: o.tableLabel, session: o.sessionId, source: o.source, role: actor.role ?? null, businessDate: businessDateOf(now, stayConfig(settings)),
      ...(theirs ? {} : { roomOfAnotherGuest: r.guest.fullName }), ...(reason ? { reason } : {}),
    },
  });
  await completeIfSettledTx(tx, updated, actor, now);
  return { number: o.number, total: o.total, room, sessionId: o.sessionId };
}

export async function chargeOrderToRoom(id: string, reservationId: string, actor: Actor, now = new Date(), opts: { reason?: string | null } = {}) {
  return db.$transaction(async (tx) => {
    const done = await chargeOrderToRoomTx(tx, id, reservationId, actor, now, opts);
    if (done.sessionId) await refreshSessionTx(tx, done.sessionId, actor, now);
    return done;
  });
}

/**
 * Change who pays an order (reception, managers, the MD — always with the reason): from the
 * restaurant bill to a room, from one room to another, or off the room back to the restaurant
 * bill (to pay there) — without taking money now. One step, nothing charged twice: the room
 * lines are voided (kept) before new ones are posted, and the history says from where to where.
 */
export async function changeOrderBilling(id: string, to: string | null, reason: string, actor: Actor, now = new Date()) {
  if (!canVerifyRoom(actor) || !actor.permissions?.has("restaurant.orders")) throw new AppError("Changing who pays an order is for reception and managers.", "FORBIDDEN");
  const why = reason.trim();
  if (why.length < 3) throw new AppError("Say why the bill changes.", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    const o = await tx.restaurantOrder.findUnique({ where: { id } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    if (o.status === "CANCELLED") throw new AppError("This order was cancelled.");
    const from = o.settlement === "ROOM" ? `Room ${o.roomNumber ?? ""}`.trim() : "Restaurant";
    if (o.settlement === "ROOM") {
      if (to && to === o.reservationId) throw new AppError("It is already on that room's bill.");
      const off = await takeOrderOffRoomTx(tx, o, `Bill moved — ${why}`, actor);
      await tx.restaurantOrderEvent.create({ data: { orderId: id, from: o.status, to: o.status, ...by(actor), note: `Removed from ${off.room}'s bill — ${why}`, at: now } });
      if (o.sessionId && !to) await sessionEventTx(tx, o.sessionId, "OFF_ROOM", `Order ${shortNo(o.number)} · TZS ${o.total.toLocaleString("en-US")} removed from ${off.room}'s bill — to pay here · ${why}`, actor, now);
      // Settled on the room it was done; now it waits for its payment again.
      if (!to && o.status === "COMPLETED") {
        await tx.restaurantOrder.update({ where: { id }, data: { status: "DELIVERED", completedAt: null, statusChangedAt: now } });
        await tx.restaurantOrderEvent.create({ data: { orderId: id, from: "COMPLETED", to: "DELIVERED", ...by(actor), at: now, note: "Open again — waiting for payment" } });
      }
    } else if (!to) throw new AppError("It is already on the restaurant bill.");
    const done = to ? await chargeOrderToRoomTx(tx, id, to, actor, now, { reason: why }) : null;
    await audit(tx, actor, {
      action: "restaurant_order.billing_changed", entityType: "RestaurantOrder", entityId: id,
      before: { billing: from, reservation: o.reservationId && o.settlement === "ROOM" ? o.reservationId : null },
      after: { billing: done ? `Room ${done.room}` : "Restaurant", reservation: to, amount: o.total, customer: o.guestId, customerName: o.customerName, table: o.tableLabel, session: o.sessionId, reason: why, source: o.source, role: actor.role ?? null },
    });
    if (o.sessionId) await refreshSessionTx(tx, o.sessionId, actor, now);
    return { number: o.number, from, to: done ? `Room ${done.room}` : "Restaurant" };
  });
}

/**
 * The customer wants more (another beer, a coffee): the new items join the same order — its
 * first items and their history stay as they were. Prices come from the menu now. A room-bill
 * order puts the new items on the room bill; a paid order has the new amount to pay. The
 * kitchen prepares the new round: an order already served goes back to New for them.
 */
export async function addOrderItemsTx(tx: Tx, id: string, items: { menuItemId: string; quantity: number }[], actor: Actor, now: Date, opts: { byCustomer?: boolean } = {}) {
  if (!opts.byCustomer && !(actor.permissions?.has("restaurant.serve") || actor.permissions?.has("kitchen.orders"))) throw new AppError("You cannot add items to orders.", "FORBIDDEN");
  await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
  const o = await tx.restaurantOrder.findUnique({ where: { id } });
  if (!o) throw new AppError("Order not found.", "NOT_FOUND");
  if (CLOSED_STATUSES.includes(o.status)) throw new AppError(o.status === "CANCELLED" ? "This order was cancelled." : "This order is closed — start a new order.");
  if (o.status === "READY" || o.status === "OUT_FOR_DELIVERY") throw new AppError("This order is already on its way — add the new items once it is served.");
  if ((await awaitingOnlineTx(tx, [id])).length) throw new AppError("This order was paid online and its payment is not checked yet — confirm it first, or start a new order for the extra items.", "CONFLICT");
  if ((await payingByPhoneTx(tx, [id], now)).size) throw new AppError(opts.byCustomer ? "Your payment for this order is still on its way — add more once it is done." : PAYING_BY_PHONE, "CONFLICT");
  // A hotel order (room service, or on a room bill) grows only while the guest is staying — and, on a room bill,
  // only for the room's own guest (or someone at their table), unless a manager moved it there.
  if (o.reservationId && (o.type === "ROOM_SERVICE" || o.settlement === "ROOM")) {
    const stay = await tx.reservation.findUnique({ where: { id: o.reservationId }, select: { status: true } });
    if (stay?.status !== "CHECKED_IN") throw new AppError("The guest has checked out — start a new order (paid at the restaurant).", "VALIDATION");
    if (o.settlement === "ROOM" && !canBillAnotherRoom(actor) && !(await activeStaysFor(tx, await orderCustomerIdsTx(tx, o))).some((x) => x.id === o.reservationId)) {
      throw new AppError("This order is on another guest's room — ask a manager to add to it, or start a new order paid at the restaurant.", "FORBIDDEN");
    }
  }
  const lines = await priceLinesTx(tx, items);
  const reopen = o.status === "DELIVERED";
  const round = reopen ? o.round + 1 : o.round;
  const food = lines.filter((l) => l.type === "FOOD").reduce((s, l) => s + l.lineTotal, 0);
  const drinks = lines.filter((l) => l.type === "DRINK").reduce((s, l) => s + l.lineTotal, 0);
  await tx.restaurantOrderItem.createMany({ data: lines.map((l) => ({ ...l, orderId: id, round, addedAt: now, addedById: opts.byCustomer ? null : actor.userId ?? null })) });
  await tx.restaurantOrder.update({
    where: { id },
    data: {
      foodSubtotal: { increment: food }, drinksSubtotal: { increment: drinks }, total: { increment: food + drinks }, round,
      ...(reopen && { status: "PENDING", statusChangedAt: now, deliveredAt: null, readyAt: null, takenAt: null }),
    },
  });
  if (o.settlement === "ROOM" && o.reservationId) {
    const stay = await tx.reservation.findUnique({ where: { id: o.reservationId }, select: { status: true } });
    if (stay?.status !== "CHECKED_IN") throw new AppError("This order was on a room bill and the guest has checked out — start a new order and receive the payment.");
    const settings = await getSettingsTx(tx);
    await postOrderToRoomTx(tx, o, lines, 0, o.reservationId, actor, businessDateOf(now, stayConfig(settings)));
  }
  const updated = await refreshPaymentTx(tx, id);
  if (o.sessionId) await sessionOrderedTx(tx, o.sessionId, opts.byCustomer ? { userId: null, label: actor.label ?? "Customer" } : actor, now);
  const what = lines.map((l) => `${l.quantity} × ${l.name}`).join(", ");
  await tx.restaurantOrderEvent.create({
    data: { orderId: id, from: o.status, to: reopen ? "PENDING" : o.status, ...by(actor), ...(opts.byCustomer && { byRole: "Customer" }), at: now, note: `Added: ${what} (+TZS ${(food + drinks).toLocaleString("en-US")})${reopen ? " — back to the kitchen" : ""}` },
  });
  await audit(tx, actor, { action: "restaurant_order.items_added", entityType: "RestaurantOrder", entityId: id, before: { total: o.total, status: o.status }, after: {
    total: updated.total, status: reopen ? "PENDING" : o.status, round, items: lines.map((l) => `${l.quantity} × ${l.name} @ ${l.unitPrice}`), byCustomer: !!opts.byCustomer,
    role: opts.byCustomer ? "Customer" : actor.role ?? null, source: o.source,
    ...(o.settlement === "ROOM" && o.reservationId ? { billing: `Room ${o.roomNumber ?? ""}`.trim(), reservation: o.reservationId } : {}),
  } });
  return { ...updated, status: reopen ? ("PENDING" as RestaurantOrderStatus) : o.status, added: lines.length };
}
export async function addOrderItems(id: string, items: { menuItemId: string; quantity: number }[], actor: Actor, now = new Date()) {
  return db.$transaction((tx) => addOrderItemsTx(tx, id, items, actor, now));
}

/**
 * A paid table is cleared, but its last orders were never marked served (the customer got them
 * and left before anyone updated the screen): they are marked served now — said so in their
 * history and the audit — and complete, being paid.
 */
export async function markServedOnClearTx(tx: Tx, id: string, actor: Actor, now: Date) {
  await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
  const o = await tx.restaurantOrder.findUnique({ where: { id } });
  if (!o || CLOSED_STATUSES.includes(o.status) || o.status === "DELIVERED") return;
  await tx.restaurantOrderItem.updateMany({ where: { orderId: id, preparedAt: null }, data: { preparedAt: now } });
  const who = actor.userId ? { connect: { id: actor.userId } } : undefined;
  const updated = await tx.restaurantOrder.update({
    where: { id },
    data: {
      status: "DELIVERED", statusChangedAt: now, acceptedAt: o.acceptedAt ?? now, preparingAt: o.preparingAt ?? now, readyAt: o.readyAt ?? now,
      takenAt: o.takenAt ?? now, deliveredAt: now, deliveredTo: deliveryPlace(o), ...(who && { deliveredBy: who, ...(o.takenById ? {} : { takenBy: who }) }),
    },
  });
  await tx.restaurantOrderEvent.create({ data: { orderId: id, from: o.status, to: "DELIVERED", ...by(actor), at: now, note: `Marked served when the table was cleared — was ${o.status === "OUT_FOR_DELIVERY" ? "being served" : STATUS_LABEL[o.status].toLowerCase()}` } });
  await audit(tx, actor, { action: "restaurant_order.served_on_clear", entityType: "RestaurantOrder", entityId: id, before: { status: o.status }, after: { status: "DELIVERED" } });
  await consumeRecipesTx(tx, id, actor, now);
  await completeIfSettledTx(tx, updated, actor, now);
}

/**
 * Take items off an open order (the customer changed their mind, ordered by mistake…), with a
 * reason — kept in the order's history. Before the kitchen has made it, whoever takes orders
 * may; once it is made (or the order is on its way), only a manager. A paid item is never
 * removed here. A room-bill order's lines on the guest's bill are redone to match.
 */
export async function removeOrderItem(orderId: string, itemId: string, quantity: number, reason: string, actor: Actor, now = new Date()) {
  if (!actor.userId || !actor.permissions?.has("restaurant.orders")) throw new AppError("You cannot change orders.", "FORBIDDEN");
  const why = reason.trim();
  if (!why) throw new AppError("Say why it is removed.", "VALIDATION", { reason: "Required" });
  if (!Number.isInteger(quantity) || quantity < 1) throw new AppError("Choose how many to remove.", "VALIDATION", { quantity: "Invalid" });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${orderId} FOR UPDATE`;
    const o = await tx.restaurantOrder.findUnique({ where: { id: orderId }, include: { items: { orderBy: { id: "asc" } } } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    if (CLOSED_STATUSES.includes(o.status)) throw new AppError(o.status === "CANCELLED" ? "This order was cancelled." : "This order is closed.");
    // Paid online and not checked yet: the customer paid for every line — nothing comes off before the check.
    if ((await awaitingOnlineTx(tx, [orderId])).length) throw new AppError("The customer paid this order online — confirm or decline their payment first.", "CONFLICT");
    if ((await payingByPhoneTx(tx, [orderId], now)).size) throw new AppError(PAYING_BY_PHONE, "CONFLICT");
    const item = o.items.find((i) => i.id === itemId);
    if (!item) throw new AppError("That item is no longer on this order.", "NOT_FOUND");
    if (item.paymentId) throw new AppError(`${item.name} is already paid — it cannot be removed here.`);
    const n = Math.min(quantity, item.quantity);
    if (n === item.quantity && o.items.length === 1) throw new AppError("That is the only item — cancel the order instead.");
    const made = !!item.preparedAt || ["READY", "OUT_FOR_DELIVERY", "DELIVERED"].includes(o.status);
    if (made && !actor.permissions?.has("revenue.void")) throw new AppError(`The kitchen has already made ${item.name} — ask a manager to remove it.`, "FORBIDDEN");

    // What these come to on the bill (a discounted line gives back its share, not the full price).
    const amount = n === item.quantity ? item.lineTotal : Math.round((item.lineTotal * n) / item.quantity);
    const lessDiscount = n === item.quantity ? item.discountAmount : Math.round((item.discountAmount * n) / item.quantity);
    if (n === item.quantity) await tx.restaurantOrderItem.delete({ where: { id: item.id } });
    else await tx.restaurantOrderItem.update({ where: { id: item.id }, data: { quantity: item.quantity - n, lineTotal: item.lineTotal - amount, discountAmount: item.discountAmount - lessDiscount } });
    await tx.restaurantOrder.update({
      where: { id: orderId },
      data: { [item.type === "DRINK" ? "drinksSubtotal" : "foodSubtotal"]: { decrement: amount }, total: { decrement: amount }, ...(lessDiscount ? { discountAmount: { decrement: lessDiscount } } : {}) },
    });
    // On a room bill: the order's lines on the guest's bill are voided and posted again as they are now.
    if (o.settlement === "ROOM" && o.reservationId) {
      await tx.reservationCharge.updateMany({ where: { restaurantOrderId: orderId, isVoided: false, kind: { not: "ROOM_SERVICE" } }, data: { isVoided: true, voidReason: `Changed: ${n} × ${item.name} removed — ${why}` } });
      const settings = await getSettingsTx(tx);
      await postOrderToRoomTx(tx, o, await storedLines(tx, orderId), 0, o.reservationId, actor, businessDateOf(now, stayConfig(settings)));
    }
    const updated = await refreshPaymentTx(tx, orderId);
    await tx.restaurantOrderEvent.create({ data: { orderId, from: o.status, to: o.status, ...by(actor), at: now, note: `Removed: ${n} × ${item.name} (−TZS ${amount.toLocaleString("en-US")}) — ${why}` } });
    await audit(tx, actor, {
      action: "restaurant_order.item_removed", entityType: "RestaurantOrder", entityId: orderId,
      before: { total: o.total, item: `${item.quantity} × ${item.name} @ ${item.unitPrice}` }, after: { total: updated.total, removed: n, amount, reason: why, made },
    });
    await completeIfSettledTx(tx, updated, actor, now);
    if (o.sessionId) await refreshSessionTx(tx, o.sessionId, actor, now);
    return { total: updated.total, removed: n, name: item.name };
  });
}

/** A waiter acting with their PIN on the shared restaurant screen. */
const viaPin = (a: Actor) => !!(a as { deviceUserId?: string | null }).deviceUserId;

/** Managers, the MD and the owner decide discounts (reception and waiters do not). */
const decides = (a: Actor) => ["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => a.permissions?.has(p as never));

/** The waiters (never the shared restaurant screen, never management) — for handing work to someone. */
export async function waitersToAssign() {
  const users = await db.user.findMany({
    where: { isActive: true, role: { permissions: { some: { permission: { code: "restaurant.serve" } } } } },
    orderBy: { fullName: "asc" }, select: { id: true, fullName: true, staffCode: true, role: { select: { code: true, name: true, permissions: { where: { permission: { code: "restaurant.device" } }, select: { permissionId: true } } } } },
  });
  // `number`: the waiter's number (WTR-001…) shown beside their name.
  return users.filter((u) => !["MANAGER", "ADMIN", "OWNER"].includes(u.role.code) && !u.role.permissions.length).map((u) => ({ id: u.id, name: u.fullName, role: u.role.name, number: u.staffCode }));
}

async function chosenWaiter(toUserId: string | null) {
  if (!toUserId) return null;
  const w = (await waitersToAssign()).find((x) => x.id === toUserId);
  if (!w) throw new AppError("Choose one of the waiters.", "VALIDATION", { waiter: "Invalid" });
  return w.name;
}

/**
 * A manager puts a waiter in charge of a table: every customer seated there — the one there now and
 * the next ones — and their orders go to that waiter, until the manager changes it. Orders handed on
 * to a third waiter stay with them. Kept in the assignment history.
 */
export async function assignTableWaiter(locationId: string, toUserId: string | null, actor: Actor, now = new Date(), reason?: string | null) {
  if (!actor.userId || !decides(actor)) throw new AppError("Only a manager, the MD or the owner chooses the waiter for a table.", "FORBIDDEN");
  const name = await chosenWaiter(toUserId);
  return db.$transaction(async (tx) => {
    const r = await setTableWaiterTx(tx, locationId, toUserId, actor, now, { kind: "MANAGER", via: "MANAGER", reason, standing: true });
    return { table: r.table, to: name, orders: r.orders };
  });
}

/** The same, from the customer's session at the table. */
export async function assignSessionWaiter(sessionId: string, toUserId: string | null, actor: Actor, now = new Date(), reason?: string | null) {
  const s = await db.diningSession.findUnique({ where: { id: sessionId }, select: { locationId: true, status: true } });
  if (!s) throw new AppError("That table's session was not found.", "NOT_FOUND");
  if (s.status === "CLOSED" || s.status === "CANCELLED") throw new AppError("This table is already cleared.");
  return assignTableWaiter(s.locationId, toUserId, actor, now, reason);
}

/** A manager puts a waiter in charge of a room's room service: that room's open and next food & drink orders go to them. */
export async function assignRoomServiceWaiter(roomId: string, toUserId: string | null, actor: Actor, now = new Date(), reason?: string | null) {
  if (!actor.userId || !decides(actor)) throw new AppError("Only a manager, the MD or the owner chooses a room's waiter.", "FORBIDDEN");
  const name = await chosenWaiter(toUserId);
  return db.$transaction(async (tx) => {
    const r = await tx.room.findUnique({ where: { id: roomId }, select: { number: true, serviceWaiterId: true } });
    if (!r) throw new AppError("Room not found.", "NOT_FOUND");
    const res = await setRoomWaiterTx(tx, r.number, r.serviceWaiterId, toUserId, actor, now, { kind: "MANAGER", via: "MANAGER", reason, standing: true });
    return { room: r.number, to: name, orders: res.orders };
  });
}

/**
 * A manager hands an order to a particular waiter (it is running late, the waiter on that area
 * is busy…) — or frees it again. Shown on the order to everyone; kept in its assignment history.
 */
export async function assignOrder(orderId: string, toUserId: string | null, actor: Actor, now = new Date(), reason?: string | null) {
  if (!actor.userId || !decides(actor)) throw new AppError("Only a manager, the MD or the owner hands orders to a waiter.", "FORBIDDEN");
  const name = await chosenWaiter(toUserId);
  return db.$transaction(async (tx) => {
    const r = await setOrderWaiterTx(tx, orderId, toUserId, actor, now, { kind: "MANAGER", via: "MANAGER", reason });
    return { number: r.number, to: name };
  });
}

/**
 * A manager / the MD / the owner takes money off a bill — a table's orders or one order. The amount
 * comes off the lines still to pay, in proportion, so the payment, the sales by income line (food,
 * drinks) and every report follow on their own. Paid lines never change; an order on a room bill is
 * posted to the room again as it is now. Recorded with who, how much and why.
 */
export async function discountOrders(orderIds: string[], input: { amount?: number | null; percent?: number | null; reason: string }, actor: Actor, now = new Date()) {
  if (!actor.userId || !decides(actor)) throw new AppError("Only a manager, the MD or the owner gives discounts.", "FORBIDDEN");
  const why = input.reason.trim();
  if (why.length < 3) throw new AppError("Say why the discount is given.", "VALIDATION", { reason: "Required" });
  const ids = [...new Set(orderIds)];
  if (!ids.length) throw new AppError("There is no bill to discount.");
  return db.$transaction(async (tx) => {
    for (const id of ids) await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    if ((await awaitingOnlineTx(tx, ids)).length) throw new AppError("An order on this bill was paid online and its payment is not checked yet — confirm or decline it first.", "CONFLICT");
    if ((await payingByPhoneTx(tx, ids, now)).size) throw new AppError(PAYING_BY_PHONE, "CONFLICT");
    const orders = (await tx.restaurantOrder.findMany({ where: { id: { in: ids } }, include: { items: { orderBy: { id: "asc" } } } }))
      .filter((o) => !CLOSED_STATUSES.includes(o.status) || o.paidAmount < o.total);
    // Room orders of a guest who has checked out were settled at check-out — the discount leaves them as they are.
    const gone = new Set((await tx.reservation.findMany({ where: { id: { in: orders.filter((o) => o.settlement === "ROOM" && o.reservationId).map((o) => o.reservationId!) }, status: { not: "CHECKED_IN" } }, select: { id: true } })).map((r) => r.id));
    orders.splice(0, orders.length, ...orders.filter((o) => !(o.settlement === "ROOM" && o.reservationId && gone.has(o.reservationId))));
    const open = orders.filter((o) => o.status !== "CANCELLED");
    const lines = open.flatMap((o) => o.items.filter((i) => !i.paymentId && i.lineTotal > 0).map((i) => ({ o, i })));
    const base = lines.reduce((t, x) => t + x.i.lineTotal, 0);
    if (base <= 0) throw new AppError("Everything on this bill is already paid — nothing left to discount.");
    const wanted = input.percent != null ? Math.round((base * input.percent) / 100) : Math.round(input.amount ?? 0);
    if (!Number.isFinite(wanted) || wanted <= 0) throw new AppError("Enter the discount (an amount or a %).", "VALIDATION", { amount: "Invalid" });
    if (wanted > base) throw new AppError(`The discount can be at most TZS ${base.toLocaleString("en-US")} (what is still to pay).`, "VALIDATION", { amount: "Too big" });
    // In proportion to each line, whole shillings, the rounding left over to the biggest lines.
    const shares = lines.map((x) => Math.floor((wanted * x.i.lineTotal) / base));
    let left = wanted - shares.reduce((a, b) => a + b, 0);
    for (const k of lines.map((x, k) => k).sort((a, b) => lines[b].i.lineTotal - lines[a].i.lineTotal)) { if (left <= 0) break; if (shares[k] < lines[k].i.lineTotal) { shares[k] += 1; left -= 1; } }
    const settings = await getSettingsTx(tx);
    const who = actor.label ?? "Manager";
    for (const o of open) {
      const mine = lines.map((x, k) => ({ ...x, share: shares[k] })).filter((x) => x.o.id === o.id && x.share > 0);
      if (!mine.length) continue;
      for (const x of mine) await tx.restaurantOrderItem.update({ where: { id: x.i.id }, data: { lineTotal: x.i.lineTotal - x.share, discountAmount: x.i.discountAmount + x.share } });
      const food = mine.filter((x) => x.i.type !== "DRINK").reduce((t, x) => t + x.share, 0), drinks = mine.filter((x) => x.i.type === "DRINK").reduce((t, x) => t + x.share, 0);
      await tx.restaurantOrder.update({
        where: { id: o.id },
        data: { foodSubtotal: { decrement: food }, drinksSubtotal: { decrement: drinks }, total: { decrement: food + drinks }, discountAmount: { increment: food + drinks }, discountReason: why, discountById: actor.userId },
      });
      if (o.settlement === "ROOM" && o.reservationId) {
        await tx.reservationCharge.updateMany({ where: { restaurantOrderId: o.id, isVoided: false, kind: { not: "ROOM_SERVICE" } }, data: { isVoided: true, voidReason: `Discount TZS ${(food + drinks).toLocaleString("en-US")} — ${why}` } });
        await postOrderToRoomTx(tx, o, await storedLines(tx, o.id), 0, o.reservationId, actor, businessDateOf(now, stayConfig(settings)));
      }
      const updated = await refreshPaymentTx(tx, o.id);
      await tx.restaurantOrderEvent.create({ data: { orderId: o.id, from: o.status, to: o.status, ...by(actor), at: now, note: `Discount −TZS ${(food + drinks).toLocaleString("en-US")} by ${who} — ${why}` } });
      await audit(tx, actor, {
        action: "restaurant_order.discounted", entityType: "RestaurantOrder", entityId: o.id,
        before: { total: o.total, discount: o.discountAmount },
        after: { total: updated.total, discount: o.discountAmount + food + drinks, amount: food + drinks, reason: why, role: actor.role ?? null, customer: o.customerName ?? null, session: o.sessionId ?? null, table: o.tableLabel ?? null },
      });
      await completeIfSettledTx(tx, updated, actor, now);
    }
    for (const sid of new Set(open.map((o) => o.sessionId).filter((x): x is string => !!x))) await refreshSessionTx(tx, sid, actor, now);
    return { amount: wanted, orders: open.length };
  });
}

/**
 * The customer changed table: their orders move to the new table with everything (items,
 * payments, history). Only open table orders move.
 */
export async function moveOrdersToTable(orderIds: string[], locationId: string, actor: Actor, now = new Date()) {
  if (!actor.userId || !(actor.permissions?.has("restaurant.orders") || actor.permissions?.has("restaurant.serve"))) throw new AppError("You cannot move orders.", "FORBIDDEN");
  const ids = [...new Set(orderIds)];
  if (!ids.length) throw new AppError("Choose the orders to move.", "VALIDATION", { orderIds: "Empty" });
  return db.$transaction(async (tx) => {
    const to = await tx.restaurantLocation.findUnique({ where: { id: locationId } });
    if (!to || !to.isActive || to.kind === "MAIN") throw new AppError("Choose a table or the counter.", "VALIDATION", { locationId: "Invalid" });
    const orders = await tx.restaurantOrder.findMany({ where: { id: { in: ids } }, include: { location: { select: { name: true } } } });
    if (orders.length !== ids.length) throw new AppError("An order was not found — refresh and try again.", "NOT_FOUND");
    for (const o of orders) {
      if (CLOSED_STATUSES.includes(o.status)) throw new AppError(`${o.number} is closed — it cannot move.`);
      if (o.type === "ROOM_SERVICE" || o.type === "TAKEAWAY") throw new AppError(`${o.number} is not a table order.`);
      if (o.locationId === to.id) throw new AppError(`${o.number} is already at ${to.name}.`);
      if (o.sessionId) throw new AppError(`${o.number} is part of a customer's table — move the table (the whole session) instead.`);
    }
    for (const o of orders) {
      const from = o.location?.name ?? o.tableLabel ?? "no table";
      await tx.restaurantOrder.update({ where: { id: o.id }, data: { locationId: to.id, tableLabel: to.name } });
      await tx.restaurantOrderEvent.create({ data: { orderId: o.id, from: o.status, to: o.status, ...by(actor), at: now, note: `Moved from ${from} to ${to.name}` } });
      await audit(tx, actor, { action: "restaurant_order.moved", entityType: "RestaurantOrder", entityId: o.id, before: { location: o.locationId, place: from }, after: { location: to.id, place: to.name } });
    }
    return { moved: orders.length, to: to.name };
  });
}

async function moveOrderTx(tx: Tx, id: string, status: RestaurantOrderStatus, actor: Actor, now: Date) {
  const o = await tx.restaurantOrder.findUnique({ where: { id }, include: { items: { select: { name: true, quantity: true, preparedAt: true, type: true }, orderBy: { id: "asc" } } } });
  if (!o) throw new AppError("Order not found.", "NOT_FOUND");
  if (CLOSED_STATUSES.includes(o.status)) throw new AppError("This order is already closed.");
  if (KITCHEN_STEPS.includes(status)) assertCanPrepare(actor, o.items);
  // Paid online first: nobody accepts it until the money is seen in the account and confirmed (the Counter or reception) —
  // or it is declined. Money paid at the Counter needs no check.
  if (o.status === "PENDING" && (await awaitingOnlineTx(tx, [id])).length) throw new AppError("Check the customer's online payment first — confirm it once the money is in the account, or decline the order.", "CONFLICT");
  // Pay online (nTZS): the kitchen starts once nTZS confirms the payment — never on a payment still on its way.
  if (o.status === "PENDING" && o.payOnlineAt) {
    const state = (await onlinePayStatesTx(tx, [o], now)).get(id);
    if (state === "PAYING") throw new AppError("The customer is paying this order online right now — it can be accepted as soon as the payment is confirmed.", "CONFLICT");
    if (state === "NOT_PAID") throw new AppError("This take-out order was to be paid online and is not paid yet — take the payment, or decline the order.", "CONFLICT");
  }
  if (o.status === "DELIVERED") throw new AppError("This order is already served — record its payment to complete it.");
  const to = ORDER_STEPS.indexOf(status), from = ORDER_STEPS.indexOf(o.status);
  if (to <= from) throw new AppError("That step does not come next for this order.");
  // Drinks only (no kitchen): once accepted, the waiter brings them and marks them served/serving straight
  // away — the drinks count as made then. Anything with food waits for the Mpishi's "Ready".
  const drinksOnly = o.items.length > 0 && o.items.every((i) => i.type === "DRINK");
  const drinksStraight = WAITER_STEPS.includes(status) && from < ORDER_STEPS.indexOf("READY") && from >= ORDER_STEPS.indexOf("ACCEPTED") && drinksOnly && canPrepareAny(actor);
  if (WAITER_STEPS.includes(status) && from < ORDER_STEPS.indexOf("READY") && !drinksStraight) {
    throw new AppError(drinksOnly && from < ORDER_STEPS.indexOf("ACCEPTED") ? "Accept the order first." : "The kitchen has not marked this order ready yet.");
  }
  // Every order has one waiter: a waiter moving on an order nobody has (accepting it, taking it out…) makes it theirs —
  // on the shared screen with their ID. The Mpishi's steps never change who serves.
  if (!o.assignedToId) {
    if (actor.userId && actor.permissions && worksWaiterShift(actor.permissions)) {
      await setOrderWaiterTx(tx, id, actor.userId, actor, now, { kind: "TAKEN", via: viaPin(actor) ? "PIN" : "SELF", expectFrom: null });
      await ensureWaiterShiftTx(tx, actor.userId, actor, now, `order ${o.number}`);
    }
    else if (actor.permissions && isRestaurantDevice(actor.permissions)) throw new AppError("No waiter has this order yet — pick the waiter who serves it.", "VALIDATION", { pin: "Required" });
  }
  if (status === "READY") {
    const left = o.items.filter((i) => !i.preparedAt);
    if (left.length) throw new AppError(`Tick every item first — still not ready: ${left.map((i) => `${i.quantity} × ${i.name}`).join(", ")}.`, "VALIDATION");
  }
  const who = actor.userId ? { connect: { id: actor.userId } } : undefined;
  const stamp: Prisma.RestaurantOrderUpdateInput = { status, statusChangedAt: now };
  if (!o.acceptedAt) { stamp.acceptedAt = now; stamp.acceptedBy = who; }
  if (to >= ORDER_STEPS.indexOf("PREPARING") && !o.preparingAt) stamp.preparingAt = now;
  if (status === "READY" || (drinksStraight && !o.readyAt)) { stamp.readyAt = now; stamp.readyBy = who; }
  if (drinksStraight) await tx.restaurantOrderItem.updateMany({ where: { orderId: id, preparedAt: null }, data: { preparedAt: now } });
  if (status === "OUT_FOR_DELIVERY" || (status === "DELIVERED" && !o.takenAt)) { stamp.takenAt = now; stamp.takenBy = who; }
  if (status === "DELIVERED") { stamp.deliveredAt = now; stamp.deliveredBy = who; stamp.deliveredTo = deliveryPlace(o); }
  const updated = await tx.restaurantOrder.update({ where: { id }, data: stamp });
  // Ready (or further): the dishes are made — their recipes come off the stores.
  if (to >= ORDER_STEPS.indexOf("READY")) await consumeRecipesTx(tx, id, actor, now);
  await tx.restaurantOrderEvent.create({ data: { orderId: id, from: o.status, to: status, ...by(actor), note: status === "DELIVERED" ? `${o.type === "ROOM_SERVICE" || (o.type === "TAKEAWAY" && o.deliveryAddress) ? "Delivered to" : "Served at"} ${deliveryPlace(o)}` : null, at: now } });
  await audit(tx, actor, { action: "restaurant_order.status", entityType: "RestaurantOrder", entityId: id, before: { status: o.status }, after: { status, ...(status === "DELIVERED" && { deliveredTo: deliveryPlace(o) }) } });
  const completed = await completeIfSettledTx(tx, updated, actor, now);
  if (o.sessionId) await refreshSessionTx(tx, o.sessionId, actor, now);
  return { before: o, after: completed ? { ...updated, status: "COMPLETED" as RestaurantOrderStatus } : updated };
}

/**
 * Move an order on. The cook (kitchen.orders) accepts, prepares and marks ready — only once
 * every item is ticked done; a waiter (restaurant.orders) takes it out and marks it delivered.
 * Delivered + settled completes the order; a waiter may take the payment in the same step.
 */
export async function setOrderStatus(id: string, status: RestaurantOrderStatus, actor: Actor, now = new Date(), opts: { pay?: PayInput; payBy?: Actor } = {}) {
  if (status === "CANCELLED") throw new AppError("Use cancel, with a reason.");
  if (status === "COMPLETED" || status === "COLLECTED") throw new AppError("An order completes by itself once it is served and paid (or on a room bill).");
  if (KITCHEN_STEPS.includes(status) && !canPrepareAny(actor)) throw new AppError("Only the Mpishi or a waiter accepts, prepares and marks orders ready.", "FORBIDDEN");
  if (WAITER_STEPS.includes(status) && !actor.permissions?.has("restaurant.serve")) throw new AppError("Serving orders is for waiters.", "FORBIDDEN");
  if (opts.pay && status !== "DELIVERED") throw new AppError("A payment is received once the order is served.");
  // The payment is recorded by the one recording payments (the Restaurant Counter) — the step by the waiter serving.
  const payer = opts.payBy ?? actor;
  if (opts.pay && !payer.permissions?.has("revenue.record")) throw new AppError("Payments are recorded at the Restaurant Counter.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    if (opts.pay) await payOrderTx(tx, id, opts.pay, payer, now);
    return moveOrderTx(tx, id, status, actor, now);
  });
}

/** The cook ticks one line done (or not). The first tick on an accepted order starts "preparing". */
export async function setOrderItemPrepared(orderId: string, itemId: string, prepared: boolean, actor: Actor, now = new Date()) {
  if (!canPrepareAny(actor)) throw new AppError("Only the Mpishi or a waiter ticks items done.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${orderId} FOR UPDATE`;
    const o = await tx.restaurantOrder.findUnique({ where: { id: orderId }, include: { items: { select: { id: true, preparedAt: true, type: true } } } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    assertCanPrepare(actor, o.items);
    if (o.status === "PENDING") throw new AppError("Accept the order first.");
    if (o.status !== "ACCEPTED" && o.status !== "PREPARING") throw new AppError("This order is already marked ready.");
    if (!o.items.some((i) => i.id === itemId)) throw new AppError("Item not found.", "NOT_FOUND");
    await tx.restaurantOrderItem.update({ where: { id: itemId }, data: { preparedAt: prepared ? now : null } });
    if (o.status === "ACCEPTED") {
      await tx.restaurantOrder.update({ where: { id: orderId }, data: { status: "PREPARING", preparingAt: o.preparingAt ?? now, statusChangedAt: now } });
      await tx.restaurantOrderEvent.create({ data: { orderId, from: "ACCEPTED", to: "PREPARING", ...by(actor), at: now } });
    } else {
      // Touch the order so every open screen picks up the tick.
      await tx.restaurantOrder.update({ where: { id: orderId }, data: { updatedAt: now } });
    }
    return { left: o.items.filter((i) => (i.id === itemId ? !prepared : !i.preparedAt)).length };
  });
}

/**
 * Cancel an order: its sales / room-bill items are voided (never deleted) and the guest's
 * bill recalculated. Before the kitchen starts, whoever takes orders may cancel; once it is
 * being prepared (or paid and served), only a manager may.
 */
export async function cancelRestaurantOrder(id: string, reason: string, actor: Actor, now = new Date()) {
  if (!actor.permissions?.has("restaurant.orders")) throw new AppError("You cannot cancel orders.", "FORBIDDEN");
  if (!reason.trim()) throw new AppError("Say why the order is cancelled.", "VALIDATION", { reason: "Required" });
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    const o = await tx.restaurantOrder.findUnique({ where: { id } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    if (o.status === "CANCELLED") throw new AppError("This order is already cancelled.");
    const early = o.status === "PENDING" || o.status === "ACCEPTED";
    if (!early && !actor.permissions?.has("revenue.void")) throw new AppError("The kitchen has started this order — ask a manager to cancel it.", "FORBIDDEN");
    await voidOrderMoneyTx(tx, o, `Order cancelled: ${reason.trim()}`, actor, now);
    await tx.restaurantOrder.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason.trim(), statusChangedAt: now, cancelledAt: now, cancelledById: actor.userId ?? null } });
    await refreshPaymentTx(tx, id);
    await tx.restaurantOrderEvent.create({ data: { orderId: id, from: o.status, to: "CANCELLED", ...by(actor), note: reason.trim(), at: now } });
    if (o.sessionId) await refreshSessionTx(tx, o.sessionId, actor, now);
    await audit(tx, actor, { action: "restaurant_order.cancelled", entityType: "RestaurantOrder", entityId: id, before: { status: o.status, total: o.total, settlement: o.settlement }, after: { status: "CANCELLED", reason: reason.trim() } });
  });
}

/** A cancelled / declined order's money: its payments reversed (sales voided, kept), its room-bill items voided and the stay recalculated. */
async function voidOrderMoneyTx(tx: Tx, o: { id: string; reservationId: string | null; settlement: string }, reason: string, actor: Actor, now: Date) {
  const payments = await tx.restaurantOrderPayment.findMany({ where: { orderId: o.id, status: "POSTED" }, select: { id: true } });
  for (const p of payments) await reversePaymentTx(tx, p.id, reason, actor, now);
  // Older sales without a payment record.
  await tx.revenueTransaction.updateMany({ where: { restaurantOrderId: o.id, isVoided: false }, data: { isVoided: true, voidReason: reason, voidedAt: now } });
  await tx.reservationCharge.updateMany({ where: { restaurantOrderId: o.id, isVoided: false }, data: { isVoided: true, voidReason: reason } });
  if (o.reservationId && o.settlement === "ROOM") await recalculateReservation(tx, o.reservationId);
}

/**
 * Who an online payment is recorded under: the restaurant's shared Counter account (the official payment
 * station) — the first one set up, if several. With no Counter account yet, the first other account that
 * records payments (reception, then management) — so an online payment is never left for someone to type in.
 */
async function onlineCollectorTx(tx: Tx): Promise<(Actor & { counter: boolean }) | null> {
  const records = { permissions: { some: { permission: { code: "revenue.record" } } } };
  const management = { permissions: { some: { permission: { code: { in: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] } } } } };
  const pick = (role: Prisma.RoleWhereInput) => tx.user.findFirst({ where: { isActive: true, role }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const counter = await pick({ AND: [records, { permissions: { some: { permission: { code: "restaurant.device" } } } }, { NOT: management }] });
  const u = counter ?? await pick({ AND: [records, { NOT: management }] }) ?? await pick(records);
  // `counter: false` — recorded under someone only because the books need a name: never credited to them as collected.
  return u ? { userId: u.id, label: "Paid online", role: "Restaurant Counter", permissions: new Set(["revenue.record", "restaurant.payments.confirm"]), counter: !!counter } : null;
}

/** Why an order was declined because its online payment never arrived (every screen shows it). */
export const NOT_RECEIVED = "Payment not received";

/**
 * "Payment not received": the customer said they paid online (LIPA) but the money is not in the account.
 * The automatic online payment is reversed — kept on record, not counted, never a refund — and the order is
 * declined (the customer is told). Only while it can still be declined (not ready yet); later, a manager
 * reverses the payment. The Restaurant Counter and reception do it.
 */
export async function markPaymentNotReceived(id: string, actor: Actor, now = new Date()) {
  if (!actor.userId || !actor.permissions?.has("restaurant.payments.confirm") || !actor.permissions.has("revenue.record")) throw new AppError("The Restaurant Counter or reception checks online payments.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    const o = await tx.restaurantOrder.findUnique({ where: { id }, include: { payments: { where: { online: true, status: "POSTED" }, include: { account: { select: { name: true } } } } } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    if (o.status === "CANCELLED") throw new AppError("This order is already cancelled.");
    if (!o.payments.length) throw new AppError("No online payment is recorded on this order.");
    if (!["PENDING", "ACCEPTED", "PREPARING"].includes(o.status)) throw new AppError("This order is already ready — a manager reverses the payment if the money never arrived.");
    const amount = o.payments.reduce((t, p) => t + p.amount, 0);
    const accounts = [...new Set(o.payments.map((p) => p.account.name))].join(", ");
    const why = `${NOT_RECEIVED} — not in ${accounts}`;
    for (const p of o.payments) {
      await reversePaymentTx(tx, p.id, why, actor, now);
      await tx.restaurantOrderPayment.update({ where: { id: p.id }, data: { notReceived: true } });
    }
    // Anything else on it (money taken at the Counter for items added later) is undone as for any declined order.
    await voidOrderMoneyTx(tx, o, `Order declined: ${why}`, actor, now);
    await tx.restaurantOrder.update({ where: { id }, data: { status: "CANCELLED", cancelReason: why, statusChangedAt: now, cancelledAt: now, cancelledById: actor.userId } });
    await refreshPaymentTx(tx, id);
    await tx.restaurantOrderEvent.create({ data: { orderId: id, from: o.status, to: "CANCELLED", ...by(actor), at: now, note: `${why} · TZS ${amount.toLocaleString("en-US")} not counted — order declined` } });
    if (o.sessionId) await refreshSessionTx(tx, o.sessionId, actor, now);
    await audit(tx, actor, {
      action: "restaurant_order.payment_not_received", entityType: "RestaurantOrder", entityId: id,
      before: { status: o.status, paidAmount: o.paidAmount, payments: o.payments.map((p) => p.id) }, after: { status: "CANCELLED", reason: why, amount },
    });
    return { amount, accounts };
  });
}

/** Declined by the kitchen: the reason every screen shows ("Declined by the kitchen — Out of stock"). */
export const DECLINED = "Declined by the kitchen";

/**
 * The Mpishi declines an order (out of stock, kitchen closing…): it is cancelled with the
 * reason — its sales / room-bill items voided, kept on record — and the dishes that ran
 * out can be marked sold out in the same step so nobody orders them again.
 */
export async function declineRestaurantOrder(id: string, reason: string, soldOut: string[], actor: Actor, now = new Date()) {
  if (!canPrepareAny(actor)) throw new AppError("Only the Mpishi or a waiter declines orders.", "FORBIDDEN");
  const why = reason.trim();
  if (!why) throw new AppError("Say why the order is declined.", "VALIDATION", { reason: "Required" });
  const note = `${DECLINED} — ${why}`;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    const o = await tx.restaurantOrder.findUnique({ where: { id }, include: { items: { select: { menuItemId: true, name: true, type: true } } } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    assertCanPrepare(actor, o.items);
    if (!["PENDING", "ACCEPTED", "PREPARING"].includes(o.status)) throw new AppError(o.status === "CANCELLED" ? "This order is already cancelled." : "This order is already ready — it can no longer be declined.");
    // Declined because the online payment never arrived: that payment was never money — not a refund. Only those who
    // check the accounts (the Counter, reception) can say so; anyone else declining it owes the customer a refund.
    const checksMoney = !!actor.permissions?.has("restaurant.payments.confirm") && !!actor.permissions?.has("revenue.record");
    const notReceived = checksMoney && why.toLowerCase().startsWith(NOT_RECEIVED.toLowerCase())
      ? (await tx.restaurantOrderPayment.findMany({ where: { orderId: id, online: true, status: "POSTED" }, select: { id: true } })).map((p) => p.id) : [];
    await voidOrderMoneyTx(tx, o, `Order declined: ${why}`, actor, now);
    if (notReceived.length) await tx.restaurantOrderPayment.updateMany({ where: { id: { in: notReceived } }, data: { notReceived: true } });
    await tx.restaurantOrder.update({ where: { id }, data: { status: "CANCELLED", cancelReason: note, statusChangedAt: now, cancelledAt: now, cancelledById: actor.userId ?? null } });
    await refreshPaymentTx(tx, id);
    await tx.restaurantOrderEvent.create({ data: { orderId: id, from: o.status, to: "CANCELLED", ...by(actor), note, at: now } });
    if (o.sessionId) await refreshSessionTx(tx, o.sessionId, actor, now);
    const out = o.items.filter((i) => i.menuItemId && soldOut.includes(i.menuItemId));
    if (out.length) await tx.menuItem.updateMany({ where: { id: { in: out.map((i) => i.menuItemId!) } }, data: { isAvailable: false } });
    await audit(tx, actor, {
      action: "restaurant_order.declined", entityType: "RestaurantOrder", entityId: id,
      before: { status: o.status, total: o.total, settlement: o.settlement }, after: { status: "CANCELLED", reason: why, soldOut: out.map((i) => i.name) },
    });
  });
}

/**
 * Order history for the record (every department): finished and cancelled / declined
 * orders over some hotel days, newest first, optionally searched (number, customer, table, room).
 */
export async function restaurantOrderHistory(opts: { from: BusinessDate; to: BusinessDate; status: "all" | "done" | "cancelled"; q?: string | null }) {
  const q = opts.q?.trim();
  const status: RestaurantOrderStatus[] = opts.status === "done" ? ["DELIVERED", "COMPLETED", "COLLECTED"] : opts.status === "cancelled" ? ["CANCELLED"] : ["DELIVERED", "COMPLETED", "COLLECTED", "CANCELLED"];
  return db.restaurantOrder.findMany({
    where: {
      businessDate: { gte: toDbDate(opts.from), lte: toDbDate(opts.to) }, status: { in: status },
      ...(q && { OR: [
        { number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } },
        { tableLabel: { contains: q, mode: "insensitive" } }, { roomNumber: { contains: q, mode: "insensitive" } }, { customerPhone: { contains: q.replace(/\s/g, "") } },
      ] }),
    },
    include: {
      items: { orderBy: { id: "asc" }, select: { id: true, name: true, quantity: true, type: true } },
      account: { select: { name: true } }, acceptedBy: person, readyBy: person, deliveredBy: person, cancelledBy: person, createdBy: person,
      reservation: { select: { reference: true, guest: { select: { fullName: true } } } },
    },
    orderBy: { statusChangedAt: "desc" }, take: 300,
  });
}
export type HistoryOrder = Awaited<ReturnType<typeof restaurantOrderHistory>>[number];

const person = { select: { fullName: true } } as const;
const ORDER_INCLUDE = {
  items: { orderBy: { id: "asc" }, include: { menuItem: { select: { image: { select: { id: true, url: true, isActive: true } } } }, addedBy: person } },
  account: { select: { name: true, accountNumber: true } }, createdBy: person,
  customerPaidTo: { select: { name: true, accountNumber: true } },
  reservation: { select: { id: true, reference: true, status: true, guestId: true, guest: { select: { fullName: true, phone: true } } } },
  cancelledBy: person, acceptedBy: person, readyBy: person, takenBy: person, deliveredBy: person,
  assignedTo: { select: { id: true, fullName: true } },
  complaints: { where: { type: "COMPLAINT" }, select: { id: true, status: true } },
  location: { select: { id: true, kind: true, area: true, number: true, name: true } },
  payments: {
    orderBy: { collectedAt: "asc" },
    select: {
      id: true, amount: true, reference: true, status: true, collectedAt: true, collectedByRole: true, confirmedAt: true, confirmedByRole: true, reverseReason: true, reversedAt: true,
      atCounter: true, online: true, notReceived: true, account: { select: { name: true } }, collectedBy: person, confirmedBy: person, handedOverBy: person,
    },
  },
} satisfies Prisma.RestaurantOrderInclude;

/** The restaurant portal: everything still open (any day) plus what finished or was cancelled on this hotel day. */
export async function ordersBoard(day: BusinessDate, opts: { assignedToId?: string } = {}) {
  return db.restaurantOrder.findMany({
    // Open orders and today's — or, for a waiter's own screen, only theirs.
    where: { AND: [{ OR: [{ status: { notIn: CLOSED_STATUSES } }, { businessDate: toDbDate(day) }] }, opts.assignedToId ? { assignedToId: opts.assignedToId } : {}] },
    include: ORDER_INCLUDE, orderBy: { createdAt: "desc" },
  });
}
export type BoardOrder = Awaited<ReturnType<typeof ordersBoard>>[number];

export async function reservationOrders(reservationId: string) {
  return db.restaurantOrder.findMany({ where: { reservationId }, include: ORDER_INCLUDE, orderBy: { createdAt: "desc" } });
}

/** Guests staying now, for room service / charge to room. */
export async function inHouseGuests() {
  const rs = await db.reservation.findMany({
    where: { status: "CHECKED_IN" },
    include: { guest: { select: { fullName: true, phone: true } }, rooms: { where: { status: "CHECKED_IN" }, include: { room: { select: { number: true } } } } },
    orderBy: { arrivalDate: "desc" },
  });
  return rs.map((r) => ({ id: r.id, reference: r.reference, name: r.guest.fullName, phone: r.guest.phone, rooms: r.rooms.map((x) => x.room.number).join(", "), balance: Math.max(0, r.balanceAmount) }))
    .sort((a, b) => a.rooms.localeCompare(b.rooms, undefined, { numeric: true }));
}
export type InHouseGuest = Awaited<ReturnType<typeof inHouseGuests>>[number];


/**
 * Restaurant & bar money, the way the owner follows it:
 * - received: orders paid on this hotel day, by the account the money went into (allocated);
 * - to collect: pay-later orders not paid yet — in no account until the payment is recorded;
 * - on room bills: orders put on the bill of guests still staying — earned, and collected
 *   with the room at check-out (a payment at the desk allocates it to an account).
 */
export async function diningMoney(day: BusinessDate) {
  const [sales, unpaid, charges] = await Promise.all([
    db.revenueTransaction.findMany({ where: { restaurantOrderId: { not: null }, isVoided: false, businessDate: toDbDate(day) }, select: { amount: true, restaurantOrderId: true, account: { select: { id: true, name: true } } } }),
    db.restaurantOrder.findMany({
      where: { settlement: { not: "ROOM" }, paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] }, status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" },
      select: { id: true, number: true, type: true, status: true, customerName: true, customerPhone: true, tableLabel: true, roomNumber: true, total: true, paidAmount: true, createdAt: true },
    }),
    db.reservationCharge.findMany({
      where: { restaurantOrderId: { not: null }, isVoided: false, reservation: { status: "CHECKED_IN" } },
      select: { amount: true, restaurantOrderId: true, reservation: { select: { id: true, reference: true, guest: { select: { fullName: true } }, rooms: { where: { status: "CHECKED_IN" }, select: { room: { select: { number: true } } } } } } },
    }),
  ]);
  const byAccount = new Map<string, { id: string; name: string; amount: number; orders: Set<string> }>();
  for (const s of sales) {
    const a = byAccount.get(s.account.id) ?? { id: s.account.id, name: s.account.name, amount: 0, orders: new Set<string>() };
    a.amount += s.amount; a.orders.add(s.restaurantOrderId!);
    byAccount.set(a.id, a);
  }
  const byStay = new Map<string, { id: string; reference: string; guest: string; rooms: string; amount: number; orders: Set<string> }>();
  for (const c of charges) {
    const r = c.reservation;
    const s = byStay.get(r.id) ?? { id: r.id, reference: r.reference, guest: r.guest.fullName, rooms: r.rooms.map((x) => x.room.number).join(", "), amount: 0, orders: new Set<string>() };
    s.amount += c.amount; s.orders.add(c.restaurantOrderId!);
    byStay.set(r.id, s);
  }
  const received = [...byAccount.values()].map(({ orders, ...a }) => ({ ...a, orders: orders.size })).sort((a, b) => b.amount - a.amount);
  const onRooms = [...byStay.values()].map(({ orders, ...s }) => ({ ...s, orders: orders.size })).sort((a, b) => a.rooms.localeCompare(b.rooms, undefined, { numeric: true }));
  return {
    received, receivedTotal: received.reduce((t, a) => t + a.amount, 0),
    unpaid, unpaidTotal: unpaid.reduce((t, o) => t + o.total - o.paidAmount, 0),
    toConfirm: await db.restaurantOrderPayment.aggregate({ where: { status: "POSTED", confirmedAt: null }, _sum: { amount: true }, _count: true }).then((a) => ({ count: a._count, amount: a._sum.amount ?? 0 })),
    onRooms, onRoomsTotal: onRooms.reduce((t, s) => t + s.amount, 0),
  };
}
export type DiningMoney = Awaited<ReturnType<typeof diningMoney>>;

export interface OrderSoundSettings {
  orderSoundsEnabled: boolean; orderSoundVolume: number; newOrderSound: string; readyOrderSound: string;
  orderPaymentConfirm: boolean;
}

/** The restaurant portal's sounds, set by a manager / admin for every screen. */
export async function saveOrderSounds(input: OrderSoundSettings, actor: Actor) {
  if (!actor.permissions?.has("restaurant.menu") && !actor.permissions?.has("settings.manage")) throw new AppError("Only a manager can change the restaurant sounds.", "FORBIDDEN");
  await db.$transaction(async (tx) => {
    const before = await tx.hotelSettings.findUniqueOrThrow({ where: { id: 1 }, select: { orderSoundsEnabled: true, orderSoundVolume: true, newOrderSound: true, readyOrderSound: true, orderPaymentConfirm: true } });
    await tx.hotelSettings.update({ where: { id: 1 }, data: { ...input, updatedById: actor.userId ?? null } });
    await audit(tx, actor, { action: "settings.order_sounds", entityType: "HotelSettings", entityId: "1", before, after: { ...input } });
  });
}

/**
 * A fingerprint of the restaurant's orders, polled by every portal screen every few seconds:
 * when it changes (new order, a step, a tick, a payment), the screen reloads its orders.
 */
export async function restaurantPulse() {
  const since = new Date(Date.now() - 3 * 86_400_000);
  const [agg, open, tables, bookings] = await Promise.all([
    db.restaurantOrder.aggregate({ where: { updatedAt: { gte: since } }, _max: { updatedAt: true }, _count: true }),
    db.restaurantOrder.count({ where: { status: { notIn: CLOSED_STATUSES } } }),
    db.diningSession.aggregate({ where: { updatedAt: { gte: since } }, _max: { updatedAt: true }, _count: true }),
    db.tableReservation.aggregate({ where: { updatedAt: { gte: since } }, _max: { updatedAt: true }, _count: true }),
  ]);
  return `${agg._count}.${open}.${agg._max.updatedAt?.getTime() ?? 0}.${tables._count}.${tables._max.updatedAt?.getTime() ?? 0}.${bookings._count}.${bookings._max.updatedAt?.getTime() ?? 0}`;
}

/** One order with its full history — every step, who did it (and their role) and when. */
export async function orderHistory(id: string) {
  return db.restaurantOrder.findUnique({
    where: { id },
    include: {
      ...ORDER_INCLUDE,
      events: { orderBy: { at: "asc" } },
      sales: { select: { id: true, amount: true, kind: true, isVoided: true, occurredAt: true, account: { select: { name: true } }, recordedBy: { select: { fullName: true } } } },
      payments: {
        orderBy: { collectedAt: "asc" },
        select: {
          id: true, amount: true, reference: true, status: true, collectedAt: true, collectedByRole: true, confirmedAt: true, confirmedByRole: true, reverseReason: true,
          atCounter: true, online: true, notReceived: true, account: { select: { name: true } }, collectedBy: person, confirmedBy: person, reversedBy: person, handedOverBy: person,
        },
      },
      charges: { select: { id: true, amount: true, description: true, isVoided: true } },
    },
  });
}

export type BillScope = "order" | "table" | "room";

/**
 * A customer's bill to print or download: one order, everything at a table this sitting
 * (orders at the same table today still open or not paid), or everything on a room stay.
 * Prices are the ones on the orders (as ordered) — never today's menu.
 */
export async function orderBill(orderId: string, scope: BillScope) {
  const o = await db.restaurantOrder.findUnique({ where: { id: orderId }, select: { id: true, type: true, tableLabel: true, locationId: true, reservationId: true, businessDate: true, sessionId: true } });
  if (!o) return null;
  const can = { table: o.type === "DINE_IN" && (!!o.locationId || !!o.tableLabel?.trim()), room: !!o.reservationId };
  const use: BillScope = scope === "table" && can.table ? "table" : scope === "room" && can.room ? "room" : "order";
  const where: Prisma.RestaurantOrderWhereInput =
    // A customer's table: every order of their session — never the previous or next customer's.
    use === "table" && o.sessionId ? { sessionId: o.sessionId, status: { not: "CANCELLED" } }
    : use === "table" ? {
      type: "DINE_IN", ...(o.locationId ? { locationId: o.locationId } : { tableLabel: { equals: o.tableLabel!.trim(), mode: "insensitive" as const } }),
      businessDate: o.businessDate, status: { not: "CANCELLED" },
      OR: [{ id: o.id }, { paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] }, settlement: { not: "ROOM" } }, { status: { notIn: CLOSED_STATUSES } }],
    }
    : use === "room" ? { reservationId: o.reservationId!, status: { not: "CANCELLED" } }
    : { id: o.id };
  const orders = await db.restaurantOrder.findMany({
    where, orderBy: { createdAt: "asc" },
    include: {
      items: { orderBy: { id: "asc" } }, account: { select: { name: true } }, createdBy: person, deliveredBy: person,
      payments: { where: { status: "POSTED" }, orderBy: { collectedAt: "asc" }, select: { amount: true, reference: true, collectedAt: true, atCounter: true, account: { select: { name: true } }, collectedBy: person, confirmedAt: true } },
      reservation: { select: { reference: true, guest: { select: { fullName: true } }, rooms: { select: { room: { select: { number: true } } } } } },
    },
  });
  const sum = (f: (x: (typeof orders)[number]) => number) => orders.reduce((t, x) => t + f(x), 0);
  return {
    scope: use, can, orders,
    totals: {
      food: sum((x) => x.foodSubtotal), drinks: sum((x) => x.drinksSubtotal), fee: sum((x) => x.serviceFee), total: sum((x) => x.total),
      paid: sum((x) => (x.settlement === "ROOM" ? 0 : x.paidAmount)), onRoom: sum((x) => (x.settlement === "ROOM" ? x.total : 0)), due: sum((x) => (x.settlement === "ROOM" ? 0 : Math.max(0, x.total - x.paidAmount))),
    },
  };
}
export type OrderBill = NonNullable<Awaited<ReturnType<typeof orderBill>>>;

/** The whole bill paid at once (a table's orders, say): each unpaid order's sales recorded into the account. */
export async function payOrdersTogether(orderIds: string[], input: PayInput, actor: Actor, now = new Date()) {
  if (!actor.userId || !actor.permissions?.has("revenue.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
  if (!orderIds.length) throw new AppError("Nothing to pay.", "VALIDATION");
  return db.$transaction((tx) => payOrdersTx(tx, orderIds, input, actor, now));
}
/** Pay several orders at once, inside a transaction (a table's whole bill): everything still due on each. */
export async function payOrdersTx(tx: Tx, orderIds: string[], input: PayInput, actor: Actor, now: Date) {
  if (!actor.userId || !actor.permissions?.has("revenue.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
  let total = 0, count = 0;
  for (const id of [...new Set(orderIds)].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${id} FOR UPDATE`;
    const o = await tx.restaurantOrder.findUnique({ where: { id }, select: { settlement: true, status: true, total: true, paidAmount: true } });
    if (!o || o.status === "CANCELLED" || o.settlement === "ROOM" || o.paidAmount >= o.total) continue;
    // Paid online and not checked yet: never paid again here — it is confirmed (or declined) on its own.
    if ((await awaitingOnlineTx(tx, [id])).length) throw new AppError("An order on this bill was paid online — confirm or decline its payment first, then take the rest.", "CONFLICT");
    await payOrderTx(tx, id, input, actor, now);
    total += o.total - o.paidAmount; count += 1;
  }
  if (!count) throw new AppError("This bill is already paid.");
  return { count, total };
}

/** A bill was printed or downloaded — noted on the order with the amount, so every version handed over is on record. */
export async function logBillPrinted(orderId: string, what: { how: "print" | "pdf" | "image" | "share"; total: number; scope: string }, actor: Actor, now = new Date()) {
  const o = await db.restaurantOrder.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!o) throw new AppError("Order not found.", "NOT_FOUND");
  const how = what.how === "print" ? "printed" : what.how === "pdf" ? "downloaded (PDF)" : what.how === "share" ? "shared" : "downloaded (image)";
  const scope = what.scope === "table" ? "table bill" : what.scope === "room" ? "room bill" : "bill";
  await db.restaurantOrderEvent.create({ data: { orderId, from: o.status, to: o.status, ...by(actor), at: now, note: `${scope[0].toUpperCase()}${scope.slice(1)} ${how} · TZS ${what.total.toLocaleString("en-US")}` } });
}

/** The customer's own receipt, from their private tracking link (/order/<token>). */
export async function orderBillByTrackToken(token: string) {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(token)) return null;
  const o = await db.restaurantOrder.findUnique({ where: { trackToken: token }, select: { id: true, status: true } });
  if (!o || o.status === "CANCELLED") return null;
  const bill = await orderBill(o.id, "order");
  return bill ? { id: o.id, bill } : null;
}

/** Reception adds a customer's phone to an order that has none (so the customer can get updates). */
export async function setOrderCustomerPhone(id: string, rawPhone: string, actor: Actor) {
  if (!actor.permissions?.has("restaurant.orders")) throw new AppError("You cannot change orders.", "FORBIDDEN");
  const phone = normalizePhone(rawPhone);
  if (!phone || phone.replace(/\D/g, "").length < 9) throw new AppError("Enter a phone number like 0712 345 678.", "VALIDATION", { phone: "Invalid" });
  await db.$transaction(async (tx) => {
    const o = await tx.restaurantOrder.findUnique({ where: { id }, select: { guestId: true, customerName: true, customerPhone: true, reservation: { select: { guestId: true } } } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    let guestId = o.guestId ?? o.reservation?.guestId ?? null;
    if (guestId) {
      const g = await tx.guest.findUnique({ where: { id: guestId }, select: { phone: true } });
      // A staying guest gets a phone on file only from reception (who checks stays) — from anyone else the number stays
      // on this order (it would open their room to that number).
      const fill = g && !g.phone && (canVerifyRoom(actor) || !(await activeStaysFor(tx, [guestId])).length);
      if (fill) await tx.guest.update({ where: { id: guestId }, data: { phone } });
    } else guestId = await resolveGuest(tx, { fullName: o.customerName?.trim() || "Restaurant customer", phone });
    await tx.restaurantOrder.update({ where: { id }, data: { customerPhone: phone, guestId } });
    await audit(tx, actor, { action: "restaurant_order.phone", entityType: "RestaurantOrder", entityId: id, before: { phone: o.customerPhone }, after: { phone } });
  });
}
