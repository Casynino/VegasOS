import "server-only";
import { ONLINE_RECORDER_ID } from "@/server/services/online-recorder";
import { can, type CurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import type { getSettings } from "@/server/settings";
import { mediaUrl } from "@/server/services/media";
import { activeStaysFor } from "@/server/services/guests";
import { awaitsOnlinePayment, deliveryPlace, ORDER_SOURCE, type BoardOrder, type OnlinePayState } from "@/server/services/restaurant";
import { prettyPhone } from "@/lib/guest-messages";
import { inHouseGuestIds, isHotelOrder } from "@/server/desk";
import { isRestaurantDevice } from "@/lib/permissions";
import { ORDER_EVENT_TYPE, orderEventFor, orderMessageText, orderFacts } from "@/lib/order-messages";
import type { PortalOrder, PortalPerms, PortalRole, PortalStay } from "./types";

/**
 * Reception works for the HOTEL (owner, 2026-10-04): it follows only the hotel's orders — from the rooms (room
 * service, room QR, the guest's stay link), what reception made, what goes on a room bill, and guests staying here
 * eating at a table. The rest of the restaurant is the waiters' and the Counter's.
 */
export async function onlyHotelOrders(orders: BoardOrder[]) {
  const inHouse = await inHouseGuestIds();
  return orders.filter((o) => isHotelOrder(o, inHouse));
}
export { isHotelOrder, inHouseGuestIds };

/**
 * Who is looking and what they may do — the same everywhere an order is shown (the portal,
 * Take an order): the Mpishi prepares, waiters / reception hand over and take payments,
 * managers and admins can do everything. The server checks every step again.
 */
export function portalAccess(user: CurrentUser): { perms: PortalPerms; role: PortalRole; seesMoney: boolean } {
  // Managers, the owner and the MD watch the restaurant in real time — no Accept, Ready, Take order, payment or cancel buttons.
  if (can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin")) {
    return {
      // They step in: cancel an order with a reason (even after the kitchen started), reverse a payment,
      // switch menu items on and off — the kitchen, bar and waiters do the orders and the money.
      // They also correct who pays an order (with the reason), so they check stays like reception.
      perms: { cook: false, bar: false, waiter: false, serve: false, pay: false, confirm: false, cancelLate: can(user, "revenue.void"), manage: can(user, "restaurant.menu") || can(user, "settings.manage"), watch: true, verify: can(user, "reservations.view") },
      role: "manager", seesMoney: true,
    };
  }
  const perms: PortalPerms = {
    cook: can(user, "kitchen.orders"), bar: can(user, "bar.orders"), waiter: can(user, "restaurant.orders"), serve: can(user, "restaurant.serve"),
    pay: can(user, "revenue.record"), confirm: can(user, "restaurant.payments.confirm"),
    cancelLate: can(user, "revenue.void"), manage: can(user, "restaurant.menu") || can(user, "settings.manage"),
    // Reception checks who is staying (any room, another guest's with a reason); a waiter only sees the customer's own room.
    verify: can(user, "reservations.view"),
    device: isRestaurantDevice(user.permissions),
  };
  const role: PortalRole = perms.manage || can(user, "dashboard.manager") || can(user, "dashboard.owner") ? "manager"
    : can(user, "dashboard.front_desk") ? "desk" : perms.cook && !perms.waiter ? "cook" : "waiter";
  // The cook sees no money: no totals, payments or accounts.
  return { perms, role, seesMoney: perms.waiter || perms.manage };
}

/** Orders as the portal cards show them (money left out for the cook; the customer's update text for waiters). */
export function toPortalOrders(orders: BoardOrder[], ctx: { seesMoney: boolean; waiter: boolean; settings: Awaited<ReturnType<typeof getSettings>>; origin: string; sent?: Set<string>; stays?: Map<string, PortalStay[]>; online?: Map<string, OnlinePayState> }): PortalOrder[] {
  const { seesMoney, settings, origin } = ctx;
  const hotelPhone = prettyPhone(settings.whatsapp || settings.phone);
  return orders.map((o) => {
    // The room guest's phone only when they are the order's own customer (never another guest's number).
    const phone = o.customerPhone ?? (o.reservation && o.guestId === o.reservation.guestId ? o.reservation.guest.phone : null);
    const event = orderEventFor(o.status, o.type, !!o.deliveryAddress);
    return {
      id: o.id, number: o.number, type: o.type, status: o.status, settlement: o.settlement, source: o.source,
      customer: o.customerName ?? o.reservation?.guest.fullName ?? null, phone: seesMoney ? phone : null, room: o.roomNumber, table: o.tableLabel, place: deliveryPlace(o), address: o.deliveryAddress,
      proof: seesMoney && o.paymentProofFileId ? {
        url: `/api/files/${o.paymentProofFileId}`, accountId: o.customerPaidToId, account: o.customerPaidTo?.name ?? null,
        reference: o.customerPayRef, at: (o.customerPaidAt ?? o.createdAt).toISOString(),
      } : null,
      awaitsPayment: awaitsOnlinePayment(o, o.payments.some((p) => p.online)),
      online: ctx.online?.get(o.id) ?? null,
      notes: o.notes, cancelReason: o.cancelReason,
      createdAt: o.createdAt.toISOString(), acceptedAt: o.acceptedAt?.toISOString() ?? null, readyAt: o.readyAt?.toISOString() ?? null,
      takenAt: o.takenAt?.toISOString() ?? null, deliveredAt: o.deliveredAt?.toISOString() ?? null, doneAt: (o.completedAt ?? o.cancelledAt ?? o.deliveredAt)?.toISOString() ?? null,
      acceptedBy: o.acceptedBy?.fullName ?? null, readyBy: o.readyBy?.fullName ?? null, takenBy: o.takenBy?.fullName ?? null, deliveredBy: o.deliveredBy?.fullName ?? null,
      items: o.items.map((i) => ({ id: i.id, menuItemId: i.menuItemId, name: i.name, quantity: i.quantity, type: i.type, image: i.menuItem?.image?.isActive ? mediaUrl(i.menuItem.image) : null, prepared: !!i.preparedAt,
        unitPrice: seesMoney ? i.unitPrice : null, lineTotal: seesMoney ? i.lineTotal : null,
        round: i.round, addedAt: i.addedAt.toISOString(), addedBy: i.addedBy?.fullName ?? null, paid: !!i.paymentId })),
      total: seesMoney ? o.total : null, serviceFee: seesMoney ? o.serviceFee : null, paidTo: seesMoney ? o.account?.name ?? null : null,
      paid: seesMoney ? o.paidAmount : null, due: seesMoney ? (o.settlement === "ROOM" || o.status === "CANCELLED" ? 0 : Math.max(0, o.total - o.paidAmount)) : null,
      payment: seesMoney ? o.paymentStatus : null,
      payments: seesMoney ? o.payments.map((p) => ({
        id: p.id, amount: p.amount, account: p.account.name, reference: p.reference, status: p.status,
        collectedBy: p.collectedBy?.fullName ?? null, collectedRole: p.collectedByRole, collectedAt: p.collectedAt.toISOString(),
        atCounter: p.atCounter, online: p.online, byPhone: p.account.code === "NTZS",
        phoneSentBy: p.account.code === "NTZS" && p.collectedById !== ONLINE_RECORDER_ID ? p.collectedBy?.fullName ?? null : null,
        notReceived: p.notReceived, handedOverBy: p.handedOverBy?.fullName ?? null,
        confirmedBy: p.confirmedBy?.fullName ?? null, confirmedAt: p.confirmedAt?.toISOString() ?? null, reverseReason: p.reverseReason,
      })) : [],
      round: o.round,
      location: o.location ? { kind: o.location.kind, area: o.location.area, number: o.location.number } : null,
      // Where it came from — and the hotel room it belongs to, so the restaurant always sees it ("Reception · Room 402").
      sourceLabel: `${ORDER_SOURCE[o.source] ?? o.source}${o.roomNumber && o.type !== "ROOM_SERVICE" ? ` · Room ${o.roomNumber}` : ""}`,
      reservation: seesMoney && o.reservation ? { id: o.reservation.id, reference: o.reservation.reference, staying: o.reservation.status === "CHECKED_IN" } : null,
      createdBy: o.createdBy?.fullName ?? null, paidAt: seesMoney ? o.paidAt?.toISOString() ?? null : null, paymentRef: seesMoney ? o.paymentReference : null,
      assignedTo: o.assignedTo ? { id: o.assignedTo.id, name: o.assignedTo.fullName } : null,
      complaints: { total: o.complaints.length, open: o.complaints.filter((c) => c.status !== "COMPLETED" && c.status !== "CANCELLED").length },
      update: ctx.waiter && phone && event ? {
        to: phone, type: ORDER_EVENT_TYPE[event],
        text: orderMessageText(event, {
          name: o.customerName, hotel: settings.hotelName, number: o.number, type: o.type, room: o.roomNumber, delivery: !!o.deliveryAddress,
          track: o.trackToken ? `${origin}/order/${o.trackToken}` : null, menu: `${origin}/order`, prepMinutes: settings.orderPrepMinutes, phone: hotelPhone,
          place: deliveryPlace(o), details: event === "RECEIVED" ? orderFacts(o, deliveryPlace(o), settings.timezone) : null,
        }),
      } : null,
      told: !!event && !!ctx.sent?.has(`${o.id}:${ORDER_EVENT_TYPE[event]}`),
      stays: seesMoney ? ctx.stays?.get(o.id) ?? [] : [],
    };
  });
}

/** Which customer updates were already sent ("orderId:ORDER_READY"…), so the desk sees who still needs telling. */
export async function sentUpdates(orderIds: string[]) {
  if (!orderIds.length) return new Set<string>();
  const rows = await db.guestMessage.findMany({ where: { restaurantOrderId: { in: orderIds }, status: "SENT" }, select: { restaurantOrderId: true, type: true } });
  return new Set(rows.map((r) => `${r.restaurantOrderId}:${r.type}`));
}

/**
 * For each order still going, the hotel rooms of its customer and of everyone at its table —
 * worked out now in one batch (never stored), so a room booked after the meal shows too. These
 * are the only rooms a waiter may put the order on; reception and managers see them first.
 */
export async function orderStays(orders: BoardOrder[]): Promise<Map<string, PortalStay[]>> {
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const sessionIds = [...new Set(live.map((o) => o.sessionId).filter((x): x is string => !!x))];
  const sessions = sessionIds.length
    ? await db.diningSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, guestId: true, members: { select: { guestId: true } } } })
    : [];
  const atTable = new Map(sessions.map((s) => [s.id, [s.guestId, ...s.members.map((m) => m.guestId)]]));
  const people = (o: BoardOrder) => [o.guestId, ...(o.sessionId ? atTable.get(o.sessionId) ?? [] : [])].filter((x): x is string => !!x);
  const stays = await activeStaysFor(db, live.flatMap(people));
  return new Map(live.map((o) => {
    const ids = new Set(people(o));
    return [o.id, stays.filter((s) => s.guestIds.some((g) => ids.has(g))).map((s) => ({ id: s.id, rooms: s.rooms, guestName: s.guestName, foodPayer: s.foodPayer }))];
  }));
}
