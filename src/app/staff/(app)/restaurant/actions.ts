"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { db } from "@/server/db";
import { parseInput } from "@/server/validation";
import {
  cancelRestaurantOrder, changeOrderBilling, chargeOrderToRoom, createRestaurantOrder, declineRestaurantOrder, setOrderCustomerPhone, moveMenuCategory, payOrdersTogether, payRoomOrderNow, recordOrderPayment, addOrderItems, confirmOrderPayment, reverseOrderPayment, logBillPrinted, saveMenuCategory, saveMenuItem, saveOrderSounds, setMenuItemAvailable,
  setOrderItemPrepared, setOrderStatus, removeOrderItem, moveOrdersToTable, markPaymentNotReceived, stayCustomer,
} from "@/server/services/restaurant";
import { notifyOrderCustomer } from "@/server/services/online-orders";
import { regenerateLocationQr, setLocationQrActive } from "@/server/services/restaurant-locations";
import { regenerateRoomQr, setRoomQrActive } from "@/server/services/room-qr";
import { orderEventFor } from "@/lib/order-messages";
import { normalizePhone } from "@/server/services/guests";
import { validPhone } from "@/lib/guest-messages";
import { actingWaiter, WaiterPin } from "@/server/waiter-pin";
import { isRestaurantDevice } from "@/lib/permissions";
import { deskOnlyHotelOrders, isDeskUser as isDesk } from "@/server/desk";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions };
}
function refresh() {
  revalidatePath("/staff/restaurant", "layout");
  revalidatePath("/staff/payments");
  revalidatePath("/staff/finance", "layout");
  revalidatePath("/menu");
}

const OrderSchema = z.object({
  type: z.enum(["DINE_IN", "TAKEAWAY", "PICKUP", "ROOM_SERVICE"]),
  items: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).min(1, "Add at least one item.").max(60),
  reservationId: z.string().nullable().optional(),
  tableLabel: z.string().trim().max(40).nullable().optional(),
  locationId: z.string().max(40).nullable().optional(),
  customerName: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  settlement: z.enum(["PAY_NOW", "ROOM", "UNPAID"]),
  /** Why it goes on another guest's room (reception). */
  reason: z.string().trim().max(200).nullable().optional(),
  accountId: z.string().nullable().optional(),
  reference: z.string().trim().max(80).nullable().optional(),
  /** Outside customer's phone (takeaway / pickup by phone): saved on the customer and used for updates. */
  customerPhone: z.string().trim().max(30).nullable().optional().refine((v) => !v || validPhone(v), "Enter a phone number like 0712 345 678."),
  /** On the shared restaurant screen: the waiter making the order (it is theirs, and so is any money taken now). */
  pin: WaiterPin.nullable().optional(),
  /** The customer picked in the search (that person, even if someone else shares the number). */
  customerId: z.string().max(40).nullable().optional(),
  /** Room service for the staying guest picked from the list: the order is that guest's. */
  forStay: z.boolean().optional(),
});

/** Take an order. Only item ids and quantities come from the screen — prices and totals are worked out on the server. */
export async function createOrderAction(input: z.input<typeof OrderSchema>): Promise<ActionResult<{ id: string; number: string; total: number }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "kitchen.orders");
    const { customerPhone, pin, customerId, forStay: pickedStay, ...d } = parseInput(OrderSchema, input);
    // Reception sells only to hotel guests (owner, 2026-10-04): every order it makes is for a guest staying here —
    // anyone else orders at the restaurant. Room service is for a staying guest too, and whoever takes orders (waiters,
    // the Counter) picks them from the list the way reception does: the order is that guest's (see stayCustomer).
    const desk = isDesk(user);
    const forStay = desk || (pickedStay === true && d.type === "ROOM_SERVICE");
    let stayGuest: string | null = null, stayPhone = customerPhone;
    if (forStay) {
      ({ guestId: stayGuest, phone: stayPhone } = await stayCustomer(d.reservationId, customerId, customerPhone, desk
        ? "Reception orders are for guests staying in the hotel — pick their room. Anyone else orders at the restaurant."
        : "Room service is for a guest staying in the hotel — pick their room."));
      d.customerName = null;
    }
    // Every order has the customer's phone (for updates): typed in, or the staying guest's.
    if (!normalizePhone(customerPhone)) {
      const guestPhone = d.reservationId ? (await db.reservation.findUnique({ where: { id: d.reservationId }, select: { guest: { select: { phone: true } } } }))?.guest.phone : null;
      if (!guestPhone) throw new AppError("Add the customer's phone number — every order needs one.", "VALIDATION", { customerPhone: "Required" });
    }
    // Who took it: reception, a waiter, or other staff (a manager, the Mpishi).
    const source = user.permissions.has("dashboard.front_desk") && !user.permissions.has("dashboard.manager") ? "RECEPTION"
      : user.permissions.has("restaurant.serve") && !user.permissions.has("dashboard.manager") ? "WAITER_MANUAL" : "STAFF_MANUAL";
    // On the shared Restaurant Counter every new order is a waiter's: their ID says who. Paid now, the payment
    // is the Counter's (the official one) — the waiter who made the order brought the money.
    const by = await actingWaiter(user, pin, "making an order");
    const counter = isRestaurantDevice(user.permissions);
    const payBy = counter && d.settlement === "PAY_NOW" ? await actor(user) : undefined;
    const o = await createRestaurantOrder(d, by, new Date(), { source, customerPhone: normalizePhone(stayPhone), pickedGuestId: forStay ? stayGuest : customerId ?? null,
      // A waiter's room service: the number typed reaches the order (updates), never the staying guest's record.
      phoneOnOrderOnly: forStay && !user.permissions.has("reservations.view"), payBy, handedOverById: payBy ? by.userId : null });
    if (o.customerPhone) after(() => notifyOrderCustomer(o.id, "RECEIVED"));
    refresh();
    revalidatePath("/staff/reservations", "layout");
    return { id: o.id, number: o.number, total: o.total };
  }, "Order sent to the kitchen.");
}

const StepSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"]),
  /** Paid as it is served — recorded by the one recording payments (the Restaurant Counter). */
  pay: z.object({ accountId: z.string().min(1, "Choose where the money was received."), reference: z.string().trim().max(80).optional(), handedOverById: z.string().max(40).nullable().optional() }).optional(),
  /** On the shared Restaurant Counter: the waiter serving an order nobody had (their ID). */
  pin: WaiterPin.nullable().optional(),
});

/** Move an order on: the cook accepts / prepares / marks it ready; a waiter takes it and marks it delivered. */
export async function setOrderStatusAction(input: z.input<typeof StepSchema>): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.serve", "kitchen.orders", "bar.orders");
    const d = parseInput(StepSchema, input);
    // With an ID (the shared Counter): the waiter does the step — an order nobody had becomes theirs. The money,
    // if any, is the Counter's (whoever is signed in records payments), never the waiter's.
    const by = d.pin ? await actingWaiter(user, d.pin, "serving an order") : await actor(user);
    const { before, after: moved } = await setOrderStatus(d.id, d.status, by, new Date(), { pay: d.pay, payBy: d.pay ? await actor(user) : undefined });
    // One update per real step (preparing, ready, delivered / collected) — not for every click.
    const event = orderEventFor(moved.status, moved.type, !!moved.deliveryAddress);
    if (event && event !== orderEventFor(before.status, before.type, !!before.deliveryAddress)) after(() => notifyOrderCustomer(d.id, event));
    refresh();
    revalidatePath("/order", "layout");
    if (moved.settlement === "ROOM" || moved.reservationId) revalidatePath("/staff/reservations", "layout");
    return { status: moved.status };
  });
}

/** The cook ticks a line of an order done (the order can only be marked ready once every line is). */
export async function setItemPreparedAction(input: { orderId: string; itemId: string; prepared: boolean }): Promise<ActionResult<{ left: number }>> {
  return runAction(async () => {
    const user = await authorize("kitchen.orders", "bar.orders");
    const res = await setOrderItemPrepared(input.orderId, input.itemId, !!input.prepared, await actor(user));
    refresh();
    return res;
  });
}

const SoundSchema = z.object({
  orderSoundsEnabled: z.boolean(),
  orderSoundVolume: z.number().int().min(0).max(100),
  newOrderSound: z.enum(["bell", "chime", "alarm", "marimba"]),
  readyOrderSound: z.enum(["bell", "chime", "alarm", "marimba"]),
  orderPaymentConfirm: z.boolean(),
});

/** Manager / admin: the portal's sounds for everyone (new order for the cook, ready order for waiters). */
export async function saveOrderSoundsAction(input: z.input<typeof SoundSchema>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.menu", "settings.manage");
    await saveOrderSounds(parseInput(SoundSchema, input), await actor(user));
    refresh();
    return null;
  }, "Sound settings saved for every restaurant screen.");
}

const PaySchema = z.object({
  id: z.string().min(1), accountId: z.string().min(1, "Choose where the money was received."), reference: z.string().trim().max(80).optional(),
  /** On a room bill, but the guest pays now instead. */
  fromRoom: z.boolean().optional(),
  /** At the Restaurant Counter: the waiter who brought the money (optional — never the collector). */
  handedOverById: z.string().max(40).nullable().optional(),
});

/** A pay-later order is paid at the counter / on delivery — or a room-bill order is paid now instead. */
export async function recordOrderPaymentAction(input: z.input<typeof PaySchema>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("revenue.record");
    const d = parseInput(PaySchema, input);
    await deskOnlyHotelOrders(user, [d.id]);
    // The official payment: recorded by whoever is signed in (the Restaurant Counter, reception) — never under a waiter.
    const pay = { accountId: d.accountId, reference: d.reference, handedOverById: d.handedOverById ?? null };
    const by = await actor(user);
    if (d.fromRoom) await payRoomOrderNow(d.id, pay, by);
    else await recordOrderPayment(d.id, pay, by);
    refresh();
    return null;
  }, "Payment recorded.");
}

const BillPaySchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(60), accountId: z.string().min(1, "Choose where the money was received."), reference: z.string().trim().max(80).optional(), handedOverById: z.string().max(40).nullable().optional() });

/** The whole bill (a table's orders, say) paid at once. */
export async function payBillAction(input: z.input<typeof BillPaySchema>): Promise<ActionResult<{ count: number; total: number }>> {
  return runAction(async () => {
    const user = await authorize("revenue.record");
    const d = parseInput(BillPaySchema, input);
    await deskOnlyHotelOrders(user, d.ids);
    const res = await payOrdersTogether(d.ids, { accountId: d.accountId, reference: d.reference, handedOverById: d.handedOverById ?? null }, await actor(user));
    refresh();
    revalidatePath("/staff/restaurant-bill");
    return res;
  }, "Payment recorded — the bill is paid.");
}

const AddSchema = z.object({
  id: z.string().min(1),
  items: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).min(1, "Add at least one item.").max(60),
  /** On the shared restaurant screen: the waiter adding them. */
  pin: WaiterPin.nullable().optional(),
});

/** The customer wants more: the new items join the same order (prices from the menu; the kitchen gets the new round). */
export async function addOrderItemsAction(input: z.input<typeof AddSchema>): Promise<ActionResult<{ number: string; total: number; status: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.serve", "kitchen.orders");
    const d = parseInput(AddSchema, input);
    const o = await addOrderItems(d.id, d.items, await actingWaiter(user, d.pin, "adding to an order"));
    refresh();
    revalidatePath("/order", "layout");
    if (o.settlement === "ROOM") revalidatePath("/staff/reservations", "layout");
    return { number: o.number, total: o.total, status: o.status };
  }, "Added to the order — the kitchen has the new items.");
}

/** Reception (or a manager) confirms a payment a waiter collected. */
export async function confirmOrderPaymentAction(input: { paymentId: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.payments.confirm");
    const paymentId = z.string().min(1).parse(input.paymentId);
    const pay = await db.restaurantOrderPayment.findUnique({ where: { id: paymentId }, select: { orderId: true } });
    if (pay) await deskOnlyHotelOrders(user, [pay.orderId]);
    await confirmOrderPayment(paymentId, await actor(user));
    refresh();
    return null;
  }, "Payment confirmed.");
}

/** A manager reverses a payment recorded by mistake (kept on record, with the reason). */
export async function reverseOrderPaymentAction(input: { paymentId: string; reason: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("revenue.void");
    await reverseOrderPayment(z.string().min(1).parse(input.paymentId), input.reason ?? "", await actor(user));
    refresh();
    revalidatePath("/staff/restaurant-bill");
    return null;
  }, "Payment reversed — the amount is due again.");
}

/** Printing / downloading a bill is noted on the order (which amount was printed, by whom). */
export async function logBillPrintedAction(input: { orderId: string; how: "print" | "pdf" | "image" | "share"; total: number; scope: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "kitchen.orders");
    await logBillPrinted(z.string().min(1).parse(input.orderId), { how: z.enum(["print", "pdf", "image", "share"]).parse(input.how), total: Math.max(0, Math.round(Number(input.total) || 0)), scope: String(input.scope).slice(0, 10) }, await actor(user));
    return null;
  });
}

/** A new QR for a table / the counter / the main restaurant (the old printed card stops working). */
export async function regenerateLocationQrAction(input: { id: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.menu", "settings.manage");
    await regenerateLocationQr(input.id, await actor(user));
    revalidatePath("/staff/restaurant/tables");
    return null;
  }, "New QR made — print the new card.");
}

/** Switch a table's QR off or back on. */
export async function setLocationQrActiveAction(input: { id: string; active: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.menu", "settings.manage");
    await setLocationQrActive(input.id, !!input.active, await actor(user));
    revalidatePath("/staff/restaurant/tables");
    return null;
  }, input.active ? "QR switched on." : "QR switched off — scanning it now asks the customer to call a waiter.");
}

const ToRoom = z.object({ id: z.string().min(1).max(40), reservationId: z.string().min(1).max(40), reason: z.string().trim().max(200).optional() });
/** A pay-later order goes on a staying guest's room bill (the customer's own room — or, for reception, another guest's with the reason). */
export async function chargeOrderToRoomAction(input: z.input<typeof ToRoom>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders");
    const d = parseInput(ToRoom, input);
    await deskOnlyHotelOrders(user, [d.id]);
    await chargeOrderToRoom(d.id, d.reservationId, await actor(user), new Date(), { reason: d.reason || null });
    refresh();
    revalidatePath("/staff/reservations", "layout");
    revalidatePath("/staff/rooms", "layout");
    revalidatePath("/staff/check-out");
    return null;
  }, "Added to the guest's room bill.");
}

const Billing = z.object({ id: z.string().min(1).max(40), to: z.string().min(1).max(40).nullable(), reason: z.string().trim().min(3, "Say why the bill changes.").max(200) });
/** Change who pays an order (reception, managers, the MD): restaurant ↔ room, or another room — with the reason, nothing charged twice. */
export async function changeOrderBillingAction(input: z.input<typeof Billing>): Promise<ActionResult<{ from: string; to: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders");
    const d = parseInput(Billing, input);
    await deskOnlyHotelOrders(user, [d.id]);
    const r = await changeOrderBilling(d.id, d.to, d.reason, await actor(user));
    refresh();
    revalidatePath("/staff/reservations", "layout");
    revalidatePath("/staff/rooms", "layout");
    revalidatePath("/staff/check-out");
    return { from: r.from, to: r.to };
  });
}

/** A new QR for a room (the old printed card stops working). */
export async function regenerateRoomQrAction(input: { roomId: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("rooms.manage", "restaurant.menu");
    await regenerateRoomQr(input.roomId, await actor(user));
    revalidatePath("/staff/rooms/qr");
    return null;
  }, "New QR made — print the new card for the room.");
}

/** Switch a room's QR off or back on. */
export async function setRoomQrActiveAction(input: { roomId: string; active: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("rooms.manage", "restaurant.menu");
    await setRoomQrActive(input.roomId, !!input.active, await actor(user));
    revalidatePath("/staff/rooms/qr");
    return null;
  }, input.active ? "QR switched on." : "QR switched off — scanning it now shows a message to contact reception.");
}

/** The Mpishi declines an order (out of stock…) — the dishes that ran out can be marked sold out too. */
export async function declineOrderAction(input: { id: string; reason: string; soldOut?: string[] }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("kitchen.orders", "bar.orders");
    const soldOut = z.array(z.string().min(1)).max(40).parse(input.soldOut ?? []);
    await declineRestaurantOrder(input.id, input.reason ?? "", soldOut, await actor(user));
    after(() => notifyOrderCustomer(input.id, "CANCELLED"));
    refresh();
    revalidatePath("/order", "layout");
    revalidatePath("/staff/reservations", "layout");
    return null;
  }, "Order declined — reception can see it and tell the customer.");
}

/**
 * "Payment not received": the customer's online (LIPA) payment never reached the account — it is taken off
 * (not counted, no refund) and the order is declined; the customer is told. The Counter and reception.
 */
export async function markPaymentNotReceivedAction(input: { id: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.payments.confirm");
    const id = String(input.id ?? "");
    await deskOnlyHotelOrders(user, [id]);
    await markPaymentNotReceived(id, await actor(user));
    after(() => notifyOrderCustomer(id, "CANCELLED"));
    refresh();
    revalidatePath("/staff/collections");
    revalidatePath("/order", "layout");
    return null;
  }, "Payment not received — the order is declined and nothing is counted.");
}

/** Add the customer's phone to an order that has none. */
export async function setOrderPhoneAction(input: { id: string; phone: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders");
    await deskOnlyHotelOrders(user, [String(input.id ?? "")]);
    await setOrderCustomerPhone(input.id, input.phone ?? "", await actor(user));
    refresh();
    return null;
  }, "Phone added — you can text the customer now.");
}

export async function cancelOrderAction(input: { id: string; reason: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders");
    await deskOnlyHotelOrders(user, [String(input.id ?? "")]);
    await cancelRestaurantOrder(input.id, input.reason ?? "", await actor(user));
    after(() => notifyOrderCustomer(input.id, "CANCELLED"));
    refresh();
    revalidatePath("/staff/reservations", "layout");
    return null;
  }, "Order cancelled — its charges were voided.");
}

/** Take items off an open order, with a reason (kept in its history). */
export async function removeOrderItemAction(input: { orderId: string; itemId: string; quantity: number; reason: string }): Promise<ActionResult<{ total: number }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders");
    await deskOnlyHotelOrders(user, [String(input.orderId ?? "")]);
    const res = await removeOrderItem(String(input.orderId ?? ""), String(input.itemId ?? ""), Number(input.quantity), String(input.reason ?? "").slice(0, 200), await actor(user));
    refresh();
    revalidatePath("/staff/reservations", "layout");
    return { total: res.total };
  }, "Removed from the order.");
}

/** The customer changed table: their orders move there with everything. */
export async function moveOrdersToTableAction(input: { orderIds: string[]; locationId: string }): Promise<ActionResult<{ to: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    const ids = Array.isArray(input.orderIds) ? input.orderIds.map(String).slice(0, 20) : [];
    await deskOnlyHotelOrders(user, ids);
    const res = await moveOrdersToTable(ids, String(input.locationId ?? ""), await actor(user));
    refresh();
    return { to: res.to };
  }, "Moved.");
}

export async function setAvailableAction(input: { id: string; isAvailable: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.menu");
    await setMenuItemAvailable(input.id, input.isAvailable, await actor(user));
    refresh();
    return null;
  }, input.isAvailable ? "Back on the menu." : "Marked as not available.");
}

const ItemSchema = z.object({
  id: z.string().optional().transform((v) => v || null),
  categoryId: z.string().min(1, "Choose a category."),
  name: z.string().trim().min(2, "Give the item a name.").max(80),
  description: z.string().trim().max(300).optional(),
  price: z.coerce.number().int("Whole shillings only.").positive("Enter the price."),
  subcategory: z.string().trim().max(40).optional(),
  isAvailable: z.string().optional().transform((v) => v === "on"),
  isActive: z.string().optional().transform((v) => v === "on"),
  isFeatured: z.string().optional().transform((v) => v === "on"),
});

export async function saveMenuItemAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.menu");
    const data = parseInput(ItemSchema, Object.fromEntries([...formData.entries()].filter(([k]) => k !== "image")));
    const image = formData.get("image");
    await saveMenuItem({ ...data, image: image instanceof File && image.size > 0 ? image : null }, await actor(user));
    refresh();
    return null;
  }, "Menu saved.");
}

const CategorySchema = z.object({
  id: z.string().optional().transform((v) => v || null),
  name: z.string().trim().min(2, "Give the category a name.").max(60),
  type: z.enum(["FOOD", "DRINK"]),
  revenueKind: z.enum(["RESTAURANT", "BAR"]),
  description: z.string().trim().max(200).optional(),
  isActive: z.string().optional().transform((v) => v === "on"),
});

export async function saveMenuCategoryAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.menu");
    await saveMenuCategory(parseInput(CategorySchema, Object.fromEntries(formData)), await actor(user));
    refresh();
    return null;
  }, "Category saved.");
}

export async function moveMenuCategoryAction(input: { id: string; dir: -1 | 1 }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.menu");
    await moveMenuCategory(input.id, input.dir === -1 ? -1 : 1, await actor(user));
    refresh();
    return null;
  });
}
