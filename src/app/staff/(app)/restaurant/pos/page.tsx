import type { Metadata } from "next";
import { can, requirePagePermission } from "@/server/auth";
import { businessToday, getSettings } from "@/server/settings";
import { siteOrigin } from "@/server/site-origin";
import { accountOptions } from "@/server/services/payment-accounts";
import { CLOSED_STATUSES, deliveryPlace, inHouseGuests, onlinePayStates, orderingMenu, ordersBoard } from "@/server/services/restaurant";
import { orderLocations } from "@/server/services/restaurant-locations";
import { openTableSessions } from "@/server/services/dining-sessions";
import { LiveRefresh } from "@/components/live-refresh";
import { onlyHotelOrders, orderStays, portalAccess, toPortalOrders } from "../portal/data";
import { PosScreen, type Addable, type OpenBill, type PosGuest } from "./pos-screen";

export const metadata: Metadata = { title: "New order" };
export const dynamic = "force-dynamic";

/**
 * TAKE AN ORDER — the till: the open orders on a line at the top (tap one to act on it —
 * the Mpishi accepts and prepares, reception / waiters deliver, take payments and update
 * the customer, managers can do everything), the menu with photos, and the new ticket.
 */
export default async function PosPage({ searchParams }: PageProps<"/staff/restaurant/pos">) {
  const user = await requirePagePermission("restaurant.orders", "kitchen.orders");
  const today = await businessToday();
  const { perms, role, seesMoney } = portalAccess(user);
  const sp = await searchParams;
  const addId = sp.add;
  // Room bills and room service are for those who take orders (waiters, reception) — never the Mpishi alone.
  const roomBills = can(user, "restaurant.orders");
  // Those who check stays (reception, managers) pick any staying room for any order. Everyone who takes orders — waiters
  // and the Counter too — sees who is staying for ROOM SERVICE (owner, 2026-10-04: "the restaurant serves the hotel too");
  // a waiter's dine-in room bill still goes only on the customer's own room (their phone or their table).
  const verify = can(user, "reservations.view");
  const [board, menu, inHouse, accounts, settings, origin, locations] = await Promise.all([ordersBoard(today), orderingMenu(), roomBills ? inHouseGuests() : Promise.resolve([]), accountOptions("payments"), getSettings(), siteOrigin(), orderLocations()]);
  // Reception sells only to hotel guests and follows only the hotel's orders (anyone else orders at the restaurant).
  const orders = role === "desk" ? await onlyHotelOrders(board) : board;
  // Only the room, the name and the booking reach the screen — never the guest's phone or balance.
  const guests: PosGuest[] = inHouse.map((g) => ({ id: g.id, reference: g.reference, name: g.name, rooms: g.rooms, hasPhone: !!g.phone }));
  // Orders the customer can still add to (not while it is on its way): picked from a table / room, or opened with ?add=.
  const addable: Addable[] = perms.serve ? orders.filter((o) => ["PENDING", "ACCEPTED", "PREPARING", "DELIVERED"].includes(o.status)).map((o) => ({
    id: o.id, number: o.number, place: deliveryPlace(o), locationId: o.locationId, reservationId: o.reservationId,
    customer: o.customerName ?? o.reservation?.guest.fullName ?? null, total: seesMoney ? o.total : null, status: o.status,
    items: o.items.reduce((t, i) => t + i.quantity, 0),
  })) : [];
  const open = orders.filter((o) => !CLOSED_STATUSES.includes(o.status));
  const line = toPortalOrders(open, { seesMoney, waiter: perms.waiter, settings, origin, stays: seesMoney ? await orderStays(open) : undefined, online: await onlinePayStates(open) });

  // Open bills: a table still eating / not paid today, or a staying guest's restaurant orders — new orders add to them.
  const bills = new Map<string, OpenBill>();
  for (const o of orders) {
    if (o.status === "CANCELLED") continue;
    const table = o.type === "DINE_IN" && o.tableLabel?.trim() && o.businessDate.toISOString().slice(0, 10) === today && ((o.settlement !== "ROOM" && o.paidAmount < o.total) || !CLOSED_STATUSES.includes(o.status));
    const key = table ? `table:${o.tableLabel!.trim().toLowerCase()}` : o.reservationId ? `room:${o.reservationId}` : null;
    if (!key) continue;
    const b = bills.get(key) ?? {
      key, kind: table ? "table" : "room", label: table ? deliveryPlace(o) : `Room ${o.roomNumber ?? ""}`, table: table ? o.tableLabel!.trim() : null,
      reservationId: table ? null : o.reservationId, who: o.customerName ?? o.reservation?.guest.fullName ?? null, phone: null, orders: 0, total: seesMoney ? 0 : null, due: seesMoney ? 0 : null, orderId: o.id, stays: [],
    } satisfies OpenBill;
    b.orders += 1;
    // The table's customer: a new order at the same table is theirs unless staff say otherwise (a room's bill keeps its guest's phone to itself).
    // The room guest's phone only when they are the order's own customer (never another guest's number).
    if (table) b.phone ??= o.customerPhone ?? (o.reservation && o.guestId === o.reservation.guestId ? o.reservation.guest.phone : null);
    b.who ??= o.customerName ?? o.reservation?.guest.fullName ?? null;
    if (b.total != null) b.total += o.total;
    if (b.due != null && o.settlement !== "ROOM") b.due += Math.max(0, o.total - o.paidAmount);
    bills.set(key, b);
  }
  // A table's customer (their session) — even before their first order: the new order is theirs,
  // and their room (or the room of someone at their table) is the one a waiter may bill.
  for (const t of await openTableSessions()) {
    if (role === "desk" && !t.stays.length) continue; // reception: only tables where a hotel guest sits
    const key = `table:${t.table.toLowerCase()}`;
    bills.set(key, {
      key, kind: "table", label: t.table, table: t.table, reservationId: null, who: t.name, phone: t.phone, orders: t.orders,
      total: seesMoney ? t.total : null, due: seesMoney ? t.due : null, orderId: t.orderId ?? "",
      stays: roomBills ? t.stays.map((x) => ({ id: x.id, rooms: x.rooms, guestName: x.guestName, foodPayer: x.foodPayer })) : [],
    });
  }

  return (
    <div className="w-full">
      <LiveRefresh every={10} active />
      <PosScreen menu={menu} guests={guests} accounts={accounts} fee={settings.roomServiceFee} canPay={can(user, "revenue.record")} roomBills={roomBills} verify={verify} line={line} bills={[...bills.values()]} perms={perms} role={role}
        locations={locations} addable={addable} startAdd={typeof addId === "string" && addable.some((a) => a.id === addId) ? addId : null}
        startTable={typeof sp.table === "string" && locations.some((l) => l.id === sp.table) ? sp.table : null} waiter={user.fullName.replace(/\s*\(.*\)/, "").split(" ")[0]} meId={user.id} />
    </div>
  );
}
