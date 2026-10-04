import type { Metadata } from "next";
import QRCode from "qrcode";
import { requirePagePermission } from "@/server/auth";
import { businessToday, getSettings } from "@/server/settings";
import { siteOrigin } from "@/server/site-origin";
import { accountOptions } from "@/server/services/payment-accounts";
import { awaitsOnlinePayment, diningMoney, inHouseGuests, ordersBoard, ORDER_SOURCE } from "@/server/services/restaurant";
import { mainRestaurantQr } from "@/server/services/restaurant-locations";
import { RestaurantPortal } from "./portal/portal";
import type { Shortcut } from "./portal/types";
import { onlyHotelOrders, orderStays, portalAccess, sentUpdates, toPortalOrders } from "./portal/data";
import { ActivityFeed, type FeedEvent } from "./portal/activity-feed";
import { TodayNumbers, type TodayNumbersData } from "./portal/today-numbers";
import { WaitersToday } from "./portal/waiter-day";
import { waiterDay, type WaiterDay } from "@/server/services/waiter-day";
import { mainScreenData } from "./portal/main-screen-data";
import { db } from "@/server/db";
import { toDbDate } from "@/lib/time/business-date";
import { worksWaiterShift } from "@/lib/permissions";
import { formatTime } from "@/lib/format";
import { deliveryPlace } from "@/server/services/restaurant";
import { waiterResponsibilities } from "@/server/services/waiter-work";

export const metadata: Metadata = { title: "Restaurant & Bar" };
export const dynamic = "force-dynamic";

const minutes = (ms: number[]) => (ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length / 60000) : null);

/**
 * THE RESTAURANT PORTAL — one place for every food and drink order (room QR, website, the
 * guest's link, reception, waiters, the Mpishi). It knows who is signed in: the Mpishi sees
 * new orders first, waiters see ready orders first, managers see everything plus the money.
 */
export default async function RestaurantPortalPage() {
  // restaurant.serve: a waiter role without order-taking still has its Home (and shift switch) here.
  const user = await requirePagePermission("restaurant.orders", "restaurant.menu", "kitchen.orders", "restaurant.serve");
  const { perms, role, seesMoney } = portalAccess(user);
  const device = !!perms.device;
  // A waiter on their own phone sees their orders' prices, never the restaurant's money (received,
  // to collect): waiters serve — the Restaurant Counter records the payments.
  const ownPhone = role === "waiter" && !device;
  const today = await businessToday();
  const [board, guests, accounts, settings, origin, restaurantMoney, mainQr] = await Promise.all([
    // Every staying room only for those who check stays (reception, managers) — a waiter gets the customer's own rooms on each order.
    ordersBoard(today), seesMoney && perms.verify ? inHouseGuests() : Promise.resolve([]), perms.pay ? accountOptions("payments") : Promise.resolve([]),
    getSettings(), siteOrigin(), seesMoney && !ownPhone ? diningMoney(today) : Promise.resolve(null), mainRestaurantQr(),
  ]);
  // Reception follows the HOTEL's orders only (owner, 2026-10-04) — orders from the rooms (room service, room QR,
  // the guest's stay link), what reception made, what goes on a room bill, and guests staying here eating at a
  // table. The rest of the restaurant is the waiters' and the Counter's. (What reception sells still goes to the
  // restaurant and waits for a waiter.)
  const desk = role === "desk";
  const orders = desk ? await onlyHotelOrders(board) : board;
  // The money band: the restaurant's — or, for reception, its hotel orders' (paid today, still to pay) and the room bills.
  const money = restaurantMoney && (desk ? (() => {
    const live = orders.filter((o) => o.status !== "CANCELLED");
    const paidToday = live.filter((o) => o.businessDate.toISOString().slice(0, 10) === today && o.paidAmount > 0);
    const unpaid = live.filter((o) => o.settlement !== "ROOM" && o.total - o.paidAmount > 0);
    return {
      received: paidToday.reduce((t, o) => t + o.paidAmount, 0), receivedOrders: paidToday.length,
      toCollect: unpaid.reduce((t, o) => t + o.total - o.paidAmount, 0), toCollectOrders: unpaid.length,
      onRooms: restaurantMoney.onRoomsTotal, rooms: restaurantMoney.onRooms.length, toConfirm: 0, toConfirmAmount: 0,
    };
  })() : {
    received: restaurantMoney.receivedTotal, receivedOrders: restaurantMoney.received.reduce((t, a) => t + a.orders, 0), toCollect: restaurantMoney.unpaidTotal, toCollectOrders: restaurantMoney.unpaid.length,
    onRooms: restaurantMoney.onRoomsTotal, rooms: restaurantMoney.onRooms.length, toConfirm: restaurantMoney.toConfirm.count, toConfirmAmount: restaurantMoney.toConfirm.amount,
  });
  // The restaurant's own QR — everyone here (reception too) can show, download or print it.
  const qrUrl = mainQr ? `${origin}/t/${mainQr.qrToken}` : null;
  const restaurantQr = mainQr && qrUrl ? {
    id: mainQr.id, url: qrUrl, active: mainQr.qrActive, hotel: settings.hotelName, phone: settings.phone,
    qr: await QRCode.toString(qrUrl, { type: "svg", margin: 0, errorCorrectionLevel: "H", color: { dark: "#0b1026", light: "#00000000" } }),
  } : null;
  // Only the room and the name reach the screen — never the guest's phone or balance.
  const rooms = guests.map((g) => ({ id: g.id, label: `Room ${g.rooms} — ${g.name}` }));
  const [sent, stays] = await Promise.all([perms.waiter ? sentUpdates(orders.map((o) => o.id)) : Promise.resolve(undefined), seesMoney ? orderStays(orders) : Promise.resolve(undefined)]);
  const portal = toPortalOrders(orders, { seesMoney, waiter: perms.waiter, settings, origin, sent, stays });

  // Today, for the manager: sales, times and who handled what.
  const todays = orders.filter((o) => o.businessDate.toISOString().slice(0, 10) === today && o.status !== "CANCELLED");
  const avgPrep = minutes(todays.filter((o) => o.acceptedAt && o.readyAt).map((o) => o.readyAt!.getTime() - o.acceptedAt!.getTime()));
  const avgDelivery = minutes(todays.filter((o) => o.readyAt && o.deliveredAt).map((o) => o.deliveredAt!.getTime() - o.readyAt!.getTime()));
  const sum = (xs: typeof todays, f: (o: (typeof todays)[number]) => number) => xs.reduce((t, o) => t + f(o), 0);
  const staff = new Map<string, { accepted: number; ready: number; taken: number; delivered: number }>();
  const tally = (who: { fullName: string } | null, k: "accepted" | "ready" | "taken" | "delivered") => {
    if (!who) return;
    const row = staff.get(who.fullName) ?? { accepted: 0, ready: 0, taken: 0, delivered: 0 };
    row[k] += 1; staff.set(who.fullName, row);
  };
  for (const o of todays) { tally(o.acceptedBy, "accepted"); tally(o.readyBy, "ready"); tally(o.takenBy, "taken"); tally(o.deliveredBy, "delivered"); }
  const bySource = Object.entries(todays.reduce<Record<string, number>>((m, o) => ({ ...m, [o.source]: (m[o.source] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);

  // Shortcuts for this person (drawn by the portal, like the reception home's quick actions).
  // Orders, Take an order, Menu and Stock requests are the tabs above; managers also get these.
  const shortcuts: Shortcut[] = role === "manager" ? [
    { href: "/staff/rooms/qr", label: "Room QR codes", icon: "qr", tone: "violet" },
    { href: "/order", label: "Online menu", icon: "web", tone: "emerald" },
    ...(perms.pay ? [{ href: "/staff/sales", label: "Quick sale", icon: "sale", tone: "rose" } as const] : []),
  ] : [];
  // Managers and the MD: every step the kitchen, bar and waiters took today, newest first.
  const feed: FeedEvent[] = perms.watch ? (await db.restaurantOrderEvent.findMany({
    where: { order: { businessDate: toDbDate(today) } }, orderBy: { at: "desc" }, take: 60,
    select: {
      id: true, from: true, to: true, note: true, at: true, byLabel: true, byRole: true, by: { select: { fullName: true } },
      order: { select: { id: true, number: true, tableLabel: true, roomNumber: true, type: true, location: { select: { name: true } }, items: { select: { type: true, quantity: true } } } },
    },
  })).map((e) => ({
    id: e.id, at: e.at.toISOString(), time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(e.at),
    who: e.by?.fullName ?? e.byLabel ?? "Customer", role: e.byRole, from: e.from, to: e.to, note: e.note,
    orderId: e.order.id, number: e.order.number,
    place: e.order.location?.name ?? e.order.tableLabel ?? (e.order.roomNumber ? `Room ${e.order.roomNumber}` : e.order.type === "TAKEAWAY" ? "Delivery" : "Counter"),
    items: e.order.items.reduce((t, i) => t + i.quantity, 0), drinksOnly: e.order.items.length > 0 && e.order.items.every((i) => i.type === "DRINK"),
  })) : [];
  // The manager's day, up top beside the live feed (how it's paid is already in the money band).
  const numbers: TodayNumbersData = {
    food: sum(todays, (o) => o.foodSubtotal), foodOrders: todays.filter((o) => o.foodSubtotal > 0).length,
    drinks: sum(todays, (o) => o.drinksSubtotal), drinkOrders: todays.filter((o) => o.drinksSubtotal > 0).length,
    roomService: sum(todays.filter((o) => o.type === "ROOM_SERVICE"), (o) => o.total), roomServiceOrders: todays.filter((o) => o.type === "ROOM_SERVICE").length,
    fees: sum(todays, (o) => o.serviceFee), avgPrep, avgDelivery,
    sources: bySource.map(([src, n]) => ({ label: ORDER_SOURCE[src] ?? src, count: n })),
    team: [...staff.entries()].map(([name, r]) => ({ name, ...r })),
  };
  // The waiters' day (service facts — orders handled and served, tables, customers; no money: waiters
  // serve, the Restaurant Counter records the payments). The manager sees every waiter's; a waiter on
  // their own phone has their own History and Collections pages.
  const teamP: Promise<WaiterDay[]> = role === "manager" ? waiterDay(today) : Promise.resolve([]);
  // The Restaurant Counter (the shared account): the restaurant's money today — what it recorded,
  // what is still to confirm — the tables, who is on shift and the day so far, beside the live counts.
  // (No per-waiter money for it: waiters are not collectors.) Orders the customer already paid online
  // are the Counter's to confirm from the proof — never "to collect" again.
  const online = orders.filter((o) => o.paymentStatus === "UNPAID" && awaitsOnlinePayment(o, o.payments.some((p) => p.online)));
  const [team, counter] = await Promise.all([teamP, device ? mainScreenData(today, { orders, avgPrep, team: teamP }) : Promise.resolve(null)]);
  const mainScreen = counter && { ...counter, online: { count: online.length, amount: online.reduce((t, o) => t + Math.max(0, o.total - o.paidAmount), 0) } };
  const dayCard = role === "manager"
    ? <div className="flex flex-col gap-4"><TodayNumbers d={numbers} /><WaitersToday rows={team} /></div>
    : undefined;
  // Taking charge of an order is a waiter's (on the shared screen, with their PIN) — managers hand orders from the card.
  const takesCharge = !perms.watch && perms.serve && (device || worksWaiterShift(user.permissions));
  // A waiter's Home is this board (the same as the Counter's, from their side): their shift is a switch by the QR.
  const shiftBar = ownPhone && worksWaiterShift(user.permissions) ? await (async () => {
    const [work, shift] = await Promise.all([
      waiterResponsibilities(user.id),
      db.actualShift.findFirst({ where: { userId: user.id, endedAt: null, department: "RESTAURANT" }, select: { id: true, startedAt: true } }),
    ]);
    const byId = new Map(orders.map((o) => [o.id, o]));
    return {
      shift: shift ? { id: shift.id, since: formatTime(shift.startedAt) } : null,
      left: {
        // A room-bill order has nothing to pay at the table.
        orders: work.orders.map((o) => {
          const b = byId.get(o.id);
          return { id: o.id, number: o.number, status: o.status, due: b?.settlement === "ROOM" ? 0 : o.due,
            place: b ? deliveryPlace(b) : o.type === "ROOM_SERVICE" ? `Room ${o.roomNumber ?? ""}`.trim() : o.tableLabel ?? "Counter" };
        }),
        tables: work.sessions.map((s) => ({ locationId: s.locationId, table: s.table, customer: s.customer })),
      },
    };
  })() : null;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="w-full space-y-6">
      <RestaurantPortal role={role} perms={perms} meId={user.id} takesCharge={takesCharge} activity={perms.watch ? <ActivityFeed events={feed} /> : undefined} numbers={dayCard} name={user.fullName.replace(/\s*\(.*\)/, "").split(" ")[0]} greeting={greeting} orders={portal} accounts={accounts} rooms={rooms} avgPrep={avgPrep} shortcuts={shortcuts} restaurantQr={restaurantQr}
        money={money}
        sound={{ enabled: settings.orderSoundsEnabled, volume: settings.orderSoundVolume, newSound: settings.newOrderSound, readySound: settings.readyOrderSound, confirmPayments: settings.orderPaymentConfirm }}
        mainScreen={mainScreen} waiterShift={shiftBar} />
    </div>
  );
}
