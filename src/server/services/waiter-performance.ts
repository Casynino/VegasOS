import "server-only";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import type { RestaurantOrderStatus } from "@/generated/prisma/enums";
import { businessDayConfig, getSettings } from "../settings";
import { businessRangeBounds, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { deliveryPlace } from "@/lib/delivery-place";
import { waitersToAssign } from "./restaurant";
import { msg } from "@/i18n/msg";
import { spotName } from "@/components/restaurant/shell";
import { getT } from "@/i18n/server";

/**
 * WAITER PERFORMANCE — what each waiter served over a period, for managers, the MD and the owner.
 * Facts only, never a score, a grade or a "best waiter": the orders each one was responsible for
 * (RestaurantOrder.assignedToId — the one waiter serving the order, after any transfer), what they
 * were worth, the tables and rooms behind them, the customers, how long the served orders took,
 * how they were settled, the hand-overs, and the time on shift. Plus the other way round: every
 * table and room, and who served it. Orders count by their hotel day (businessDate); hand-overs
 * and shifts by the period's time window (hotel days, 04:00 → 04:00 by default).
 */

const SERVED: RestaurantOrderStatus[] = ["DELIVERED", "COMPLETED", "COLLECTED"];
const isServed = (s: RestaurantOrderStatus) => SERVED.includes(s);

const ORDER_SELECT = {
  id: true, number: true, type: true, status: true, settlement: true, paymentStatus: true, total: true, paidAmount: true,
  foodSubtotal: true, drinksSubtotal: true, tableLabel: true, roomNumber: true, deliveryAddress: true,
  customerName: true, customerPhone: true, guestId: true, sessionId: true, assignedToId: true,
  businessDate: true, createdAt: true, readyAt: true, deliveredAt: true, completedAt: true, cancelledAt: true,
  location: { select: { id: true, name: true, kind: true, sortOrder: true } },
} satisfies Prisma.RestaurantOrderSelect;
type PeriodOrder = Prisma.RestaurantOrderGetPayload<{ select: typeof ORDER_SELECT }>;

async function window(from: BusinessDate, to: BusinessDate) {
  return businessRangeBounds(from, to, businessDayConfig(await getSettings()));
}
const inPeriod = (from: BusinessDate, to: BusinessDate) => ({ businessDate: { gte: toDbDate(from), lte: toDbDate(to) } });
const clean = (n: string | null | undefined) => n?.replace(/\s*\(.*\)/, "").trim() ?? "";
const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// ───────────────────────── Places ─────────────────────────

/** Where an order was served, the way the floor knows it. */
export type PlaceKind = "TABLE" | "ROOM" | "COUNTER" | "OTHER";
const KIND_ORDER: PlaceKind[] = ["TABLE", "ROOM", "COUNTER", "OTHER"];

/** One place per order (a room-service order for "305, 306" is one place: "Room 305, 306"). Labels are English values (keys, matching); screens show them with t(). */
function placeOf(o: PeriodOrder): { key: string; label: string; kind: PlaceKind; sort: number } {
  if (o.type === "ROOM_SERVICE") return { key: `room:${o.roomNumber ?? ""}`, label: deliveryPlace(o), kind: "ROOM", sort: 0 };
  if (o.location) return { key: `loc:${o.location.id}`, label: o.location.name, kind: o.location.kind === "TABLE" ? "TABLE" : "COUNTER", sort: o.location.sortOrder };
  if (o.type === "DINE_IN" && o.tableLabel) return { key: `label:${deliveryPlace(o).trim().toLowerCase()}`, label: deliveryPlace(o), kind: /^counter/i.test(o.tableLabel) ? "COUNTER" : "TABLE", sort: 0 };
  if (o.type === "TAKEAWAY") return { key: "takeout", label: msg("Take out"), kind: "OTHER", sort: 0 };
  if (o.type === "PICKUP") return { key: "pickup", label: msg("Pickup"), kind: "OTHER", sort: 0 };
  return { key: "restaurant", label: msg("Restaurant"), kind: "OTHER", sort: 0 };
}
/** The rooms of a room-service order, one by one ("305, 306" → 305 and 306). */
const roomsOf = (o: PeriodOrder) => (o.type === "ROOM_SERVICE" ? (o.roomNumber ?? "").split(",").map((x) => x.trim()).filter(Boolean) : []);
/** The tables of an order: a table QR, or (older orders) the table it was written down for. */
const tableOf = (o: PeriodOrder) => {
  const p = placeOf(o);
  return o.type === "DINE_IN" && p.kind === "TABLE" ? p.label : null;
};
/** The same customer once: by their saved record, else their phone, else their time at the table. */
const customerKey = (o: PeriodOrder) => (o.guestId ? `g:${o.guestId}` : o.customerPhone ? `p:${o.customerPhone.replace(/\D/g, "")}` : o.sessionId ? `s:${o.sessionId}` : `o:${o.id}`);

// ───────────────────────── Facts ─────────────────────────

export type MoneyCount = { count: number; value: number };
/** How a served order stands for money — the order's own payment state, never guessed. */
export type PayState = "PAID" | "TO_CONFIRM" | "ROOM" | "PART" | "UNPAID" | "REFUNDED";
export function payState(o: { settlement: string; paymentStatus: string; total: number; paidAmount: number }): PayState {
  if (o.settlement === "ROOM") return "ROOM";
  if (o.paymentStatus === "PAID") return "PAID";
  if (o.paymentStatus === "PENDING_CONFIRMATION") return "TO_CONFIRM";
  if (o.paymentStatus === "REFUNDED") return "REFUNDED";
  if (o.paymentStatus === "PARTIALLY_PAID" || (o.paidAmount > 0 && o.paidAmount < o.total)) return "PART";
  return "UNPAID";
}

function facts(orders: PeriodOrder[]) {
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const served = live.filter((o) => isServed(o.status));
  const settle = { paid: { count: 0, value: 0 }, toConfirm: { count: 0, value: 0 }, onRoom: { count: 0, value: 0 }, unpaid: { count: 0, value: 0 } };
  for (const o of served) {
    const s = payState(o);
    const bucket = s === "PAID" ? settle.paid : s === "TO_CONFIRM" ? settle.toConfirm : s === "ROOM" ? settle.onRoom : settle.unpaid;
    bucket.count++;
    // Still unpaid: what is still due on it (a part-paid order's paid part is in its payments).
    bucket.value += bucket === settle.unpaid ? Math.max(0, o.total - o.paidAmount) : o.total;
  }
  const readyServed = served.filter((o) => o.readyAt && o.deliveredAt && o.deliveredAt >= o.readyAt).map((o) => minutes(o.readyAt!, o.deliveredAt!));
  const orderServed = served.filter((o) => o.deliveredAt && o.deliveredAt >= o.createdAt).map((o) => minutes(o.createdAt, o.deliveredAt!));
  return {
    /** Every order they were responsible for (not cancelled). */
    orders: live.length,
    served: served.length,
    /** Still on their way (new → serving), not cancelled. */
    going: live.length - served.length,
    cancelled: orders.length - live.length,
    /** The value of the orders they served. */
    servedValue: served.reduce((t, o) => t + o.total, 0),
    food: served.reduce((t, o) => t + o.foodSubtotal, 0),
    drinks: served.reduce((t, o) => t + o.drinksSubtotal, 0),
    tables: [...new Set(live.map(tableOf).filter((x): x is string => !!x))].sort(byLabel),
    rooms: [...new Set(live.flatMap(roomsOf))].sort(byLabel),
    customers: new Set(live.map(customerKey)).size,
    /** Average minutes from "ready" in the kitchen to served at the customer — and from the order to served. */
    readyToServed: avg(readyServed), readyTimed: readyServed.length,
    orderToServed: avg(orderServed), orderTimed: orderServed.length,
    settle,
  };
}
export type WaiterFacts = ReturnType<typeof facts>;

type Transfer = { scope: string; fromUserId: string | null; toUserId: string | null };
function handOvers(rows: Transfer[], id: string) {
  const orders = rows.filter((r) => r.scope === "ORDER"), places = rows.filter((r) => r.scope !== "ORDER");
  return {
    ordersIn: orders.filter((r) => r.toUserId === id).length, ordersOut: orders.filter((r) => r.fromUserId === id).length,
    placesIn: places.filter((r) => r.toUserId === id).length, placesOut: places.filter((r) => r.fromUserId === id).length,
  };
}

/** Minutes on a restaurant shift inside the window (a shift still open counts up to now). */
function shiftMinutes(shifts: { startedAt: Date; endedAt: Date | null }[], start: Date, end: Date, now: Date) {
  const stop = end < now ? end : now;
  return Math.round(shifts.reduce((t, s) => {
    const a = s.startedAt > start ? s.startedAt : start;
    const b = s.endedAt && s.endedAt < stop ? s.endedAt : stop;
    return t + Math.max(0, minutes(a, b));
  }, 0));
}

async function people(ids: string[]) {
  if (!ids.length) return [];
  const us = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, role: { select: { name: true } } } });
  return us.map((u) => ({ id: u.id, name: u.fullName, role: u.role.name }));
}

// ───────────────────────── Every waiter ─────────────────────────

/**
 * Every waiter over a period (the waiters today, plus anyone else who served orders in it): their
 * facts, whether they are on shift now, their hand-overs and their hours on shift — and the orders
 * nobody was responsible for. Facts only: no ranking.
 */
export async function waiterPerformance(from: BusinessDate, to: BusinessDate, now = new Date()) {
  const { start, end } = await window(from, to);
  const [team, orders, transfers, shifts, open] = await Promise.all([
    waitersToAssign(),
    db.restaurantOrder.findMany({ where: inPeriod(from, to), select: ORDER_SELECT }),
    db.waiterAssignment.findMany({ where: { kind: "TRANSFER", at: { gte: start, lt: end } }, select: { scope: true, fromUserId: true, toUserId: true } }),
    db.actualShift.findMany({
      where: { department: "RESTAURANT", startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
      select: { userId: true, startedAt: true, endedAt: true },
    }),
    db.actualShift.findMany({ where: { department: "RESTAURANT", endedAt: null }, orderBy: { startedAt: "asc" }, select: { userId: true, startedAt: true } }),
  ]);
  const known = new Set(team.map((w) => w.id));
  const extra = await people([...new Set(orders.map((o) => o.assignedToId).filter((id): id is string => !!id && !known.has(id)))]);
  const onShift = new Map(open.map((s) => [s.userId, s.startedAt]));

  const waiters = [...team, ...extra].map((w) => {
    const mine = orders.filter((o) => o.assignedToId === w.id);
    return {
      id: w.id, name: clean(w.name), role: w.role,
      /** Not one of the waiters today (a former waiter, or someone else who served). */
      outsideTeam: !known.has(w.id),
      onShiftSince: onShift.get(w.id) ?? null,
      ...facts(mine),
      transfers: handOvers(transfers, w.id),
      shiftMinutes: shiftMinutes(shifts.filter((s) => s.userId === w.id), start, end, now),
    };
  });
  const nobody = facts(orders.filter((o) => !o.assignedToId));
  const all = facts(orders);
  return {
    waiters,
    /** Orders nobody was responsible for (no waiter on them) — shown so nothing is missed. */
    noWaiter: { orders: nobody.orders, going: nobody.going, value: nobody.servedValue },
    totals: { orders: all.orders, served: all.served, going: all.going, cancelled: all.cancelled, servedValue: all.servedValue, onShift: waiters.filter((w) => w.onShiftSince).length },
  };
}
export type WaiterPerformance = Awaited<ReturnType<typeof waiterPerformance>>;
export type WaiterRow = WaiterPerformance["waiters"][number];

// ───────────────────────── By place ─────────────────────────

/**
 * Every table, room and counter with orders in the period — and who served it: each waiter with
 * their orders and value there (and the orders that had no waiter). Cancelled orders are counted
 * apart and never in the value.
 */
export async function placesServed(from: BusinessDate, to: BusinessDate) {
  const orders = await db.restaurantOrder.findMany({ where: inPeriod(from, to), select: { ...ORDER_SELECT, assignedTo: { select: { id: true, fullName: true } } } });
  type By = { id: string | null; name: string; orders: number; served: number; value: number };
  const places = new Map<string, { key: string; label: string; kind: PlaceKind; sort: number; orders: number; served: number; going: number; cancelled: number; value: number; customers: Set<string>; by: Map<string, By>; last: Date }>();
  // An older order written down only as "Table 5" (or "5") counts with the table of that name (when one table has it).
  const named = new Map<string, ReturnType<typeof placeOf> | null>();
  for (const o of orders) if (o.location) {
    const n = o.location.name.trim().toLowerCase(), p = placeOf(o);
    named.set(n, named.has(n) && named.get(n)?.key !== p.key ? null : p);
  }
  for (const o of orders) {
    const own = placeOf(o);
    const p = !o.location && own.key.startsWith("label:") ? named.get(own.label.trim().toLowerCase()) ?? own : own;
    const row = places.get(p.key) ?? { ...p, orders: 0, served: 0, going: 0, cancelled: 0, value: 0, customers: new Set<string>(), by: new Map<string, By>(), last: o.createdAt };
    places.set(p.key, row);
    if (o.createdAt > row.last) row.last = o.createdAt;
    if (o.status === "CANCELLED") { row.cancelled++; continue; }
    const k = o.assignedToId ?? "—";
    const who = row.by.get(k) ?? { id: o.assignedToId, name: o.assignedTo ? clean(o.assignedTo.fullName) : msg("No waiter"), orders: 0, served: 0, value: 0 };
    row.by.set(k, who);
    row.orders++; who.orders++;
    row.customers.add(customerKey(o));
    if (isServed(o.status)) { row.served++; who.served++; row.value += o.total; who.value += o.total; } else row.going++;
  }
  return [...places.values()]
    .map(({ customers, by, ...p }) => ({ ...p, customers: customers.size, by: [...by.values()].sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name)) }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.kind === "TABLE" || a.kind === "COUNTER" ? a.sort - b.sort : 0) || byLabel(a.label, b.label));
}
export type PlaceServed = Awaited<ReturnType<typeof placesServed>>[number];

// ───────────────────────── One waiter ─────────────────────────

/**
 * One waiter over a period: their facts, every order they were responsible for (time, number,
 * place, customer, items, value, step, payment state, ready → served), the hand-overs to and from
 * them, and their restaurant shifts. Null when the person does not exist.
 */
export async function waiterOrders(waiterId: string, from: BusinessDate, to: BusinessDate, now = new Date()) {
  const { start, end } = await window(from, to);
  const [user, orders, transfers, shifts, open] = await Promise.all([
    db.user.findUnique({ where: { id: waiterId }, select: { id: true, fullName: true, isActive: true, role: { select: { name: true } } } }),
    db.restaurantOrder.findMany({
      where: { ...inPeriod(from, to), assignedToId: waiterId }, orderBy: { createdAt: "desc" },
      select: {
        ...ORDER_SELECT,
        reservation: { select: { reference: true, guest: { select: { fullName: true } } } },
        guest: { select: { fullName: true } },
        items: { select: { quantity: true } },
        payments: {
          orderBy: { collectedAt: "asc" },
          select: { amount: true, status: true, atCounter: true, confirmedAt: true, collectedAt: true, account: { select: { name: true } }, collectedBy: { select: { fullName: true } }, handedOverBy: { select: { fullName: true } } },
        },
      },
    }),
    db.waiterAssignment.findMany({
      where: { kind: "TRANSFER", at: { gte: start, lt: end }, OR: [{ fromUserId: waiterId }, { toUserId: waiterId }] }, orderBy: { at: "desc" },
      select: {
        id: true, scope: true, roomNumber: true, locationId: true, reason: true, at: true, fromUserId: true, toUserId: true,
        order: { select: { id: true, number: true } }, fromUser: { select: { fullName: true } }, toUser: { select: { fullName: true } },
      },
    }),
    db.actualShift.findMany({
      where: { userId: waiterId, department: "RESTAURANT", startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
      orderBy: { startedAt: "desc" }, select: { id: true, startedAt: true, endedAt: true },
    }),
    db.actualShift.findFirst({ where: { userId: waiterId, department: "RESTAURANT", endedAt: null }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
  ]);
  if (!user) return null;
  // What a hand-over was about, written for the person looking.
  const t = await getT();
  // The tables behind the hand-overs (a table hand-over names its table).
  const locIds = [...new Set(transfers.map((h) => (h.scope === "TABLE" ? h.locationId : null)).filter((x): x is string => !!x))];
  const locations = locIds.length ? await db.restaurantLocation.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true } }) : [];
  const tableName = new Map(locations.map((l) => [l.id, l.name]));

  return {
    waiter: { id: user.id, name: clean(user.fullName), role: user.role.name, isActive: user.isActive, onShiftSince: open?.startedAt ?? null },
    facts: facts(orders),
    transfers: handOvers(transfers, waiterId),
    shiftMinutes: shiftMinutes(shifts, start, end, now),
    shifts: shifts.map((s) => ({ id: s.id, startedAt: s.startedAt, endedAt: s.endedAt })),
    orders: orders.map((o) => {
      const posted = o.payments.filter((p) => p.status === "POSTED");
      return {
        id: o.id, number: o.number, day: fromDbDate(o.businessDate), createdAt: o.createdAt,
        place: placeOf(o).label, placeKind: placeOf(o).kind,
        customer: o.customerName ?? o.guest?.fullName ?? o.reservation?.guest.fullName ?? null,
        phone: o.customerPhone,
        items: o.items.reduce((t, i) => t + i.quantity, 0),
        total: o.total, paidAmount: o.paidAmount, due: Math.max(0, o.total - o.paidAmount),
        status: o.status, served: isServed(o.status), cancelled: o.status === "CANCELLED",
        pay: o.status === "CANCELLED" ? null : payState(o),
        /** How the money came in: the account, where it was recorded, and the waiter who brought it (when noted). */
        payments: posted.map((p) => ({
          amount: p.amount, account: p.account.name, at: p.collectedAt, confirmed: !!p.confirmedAt,
          // An English value (the screen shows it with t(); a name stays as it is).
          by: p.atCounter ? msg("Restaurant Counter") : clean(p.collectedBy?.fullName) || null,
          broughtBy: clean(p.handedOverBy?.fullName) || null,
        })),
        reservation: o.settlement === "ROOM" ? o.reservation?.reference ?? null : null,
        readyToServed: o.readyAt && o.deliveredAt && o.deliveredAt >= o.readyAt ? minutes(o.readyAt, o.deliveredAt) : null,
        orderToServed: o.deliveredAt && o.deliveredAt >= o.createdAt ? minutes(o.createdAt, o.deliveredAt) : null,
        deliveredAt: o.deliveredAt,
      };
    }),
    handOvers: transfers.map((h) => ({
      id: h.id, at: h.at, scope: h.scope as "ORDER" | "TABLE" | "ROOM", reason: h.reason,
      direction: h.toUserId === waiterId ? ("IN" as const) : ("OUT" as const),
      from: clean(h.fromUser?.fullName) || "—", to: clean(h.toUser?.fullName) || "—",
      what: h.scope === "ORDER" ? `#${(h.order?.number ?? "").replace(/^ORD-\d{4}-0*/, "")}` : h.scope === "ROOM" ? (h.roomNumber ? t("Room {room}", { room: h.roomNumber }) : t("Room")) : (h.locationId && tableName.get(h.locationId) ? spotName(tableName.get(h.locationId)!, t) : t("A table")),
      orderId: h.order?.id ?? null,
    })),
  };
}
export type WaiterDetail = NonNullable<Awaited<ReturnType<typeof waiterOrders>>>;
export type WaiterOrder = WaiterDetail["orders"][number];
