import "server-only";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import type { DiningSessionStatus } from "@/generated/prisma/enums";
import { audit } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { getSettings } from "../settings";
import { shortName, validPhone } from "@/lib/guest-messages";
import { activeStaysFor, normalizePhone, pickedCustomerTx, resolveGuest, type ActiveStay } from "./guests";
import { orderCustomerName } from "./online-orders";
import { activeLocation } from "./restaurant-locations";
import { awaitingOnlineTx, chargeOrderToRoomTx, CLOSED_STATUSES, markServedOnClearTx, payOrdersTx, type PayInput } from "./restaurant";
import {
  endSessionTx, holdingReservationTx, HOLD_AFTER_MIN, HOLD_BEFORE_MIN, IN_SERVICE, issueSeatTx, lockLocationTx, lockSessionTx, OPEN_SESSION, refreshSessionTx,
  reservedMessage, seatOf, sessionEventTx, sessionMoney, sessionNo, startSessionTx,
} from "./dining-core";
import type { Actor } from "./reservations";

/**
 * TABLES — who is at each table and their whole time there (see dining-core.ts for the rules).
 * Customers: scan the table's QR, say who they are once, order as often as they like, "I'm done".
 * Staff: seat a customer (or a reservation), add people to the table, move them to another
 * table, take the whole bill's payment, close the table. Everything is kept: the orders and
 * payments, every move and the session's timeline.
 */

export { SEAT_COOKIE, SEAT_HOURS, sessionNo } from "./dining-core";

const shortOrder = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const canRunTables = (a: Actor) => !!(a.userId && (a.permissions?.has("restaurant.orders") || a.permissions?.has("restaurant.serve")));
function assertTables(a: Actor) {
  if (!canRunTables(a)) throw new AppError("Seating, moving and closing tables is for waiters, reception and managers.", "FORBIDDEN");
}
const samePhone = (a: string | null | undefined, b: string) => !!a && normalizePhone(a) === b;

// ───────────────────────── What staff see ─────────────────────────

const SESSION_INCLUDE = {
  location: { select: { name: true } },
  waiter: { select: { id: true, fullName: true } },
  guest: { select: { id: true, fullName: true, phone: true } },
  closedBy: { select: { fullName: true } },
  tableReservation: { select: { reference: true } },
  members: { orderBy: { addedAt: "asc" }, include: { guest: { select: { id: true, fullName: true, phone: true } } } },
  events: { orderBy: { at: "asc" } },
  orders: {
    orderBy: { createdAt: "asc" },
    include: {
      items: { orderBy: { id: "asc" } },
      createdBy: { select: { fullName: true } },
      payments: { orderBy: { collectedAt: "asc" }, select: { id: true, amount: true, status: true, collectedAt: true, reversedAt: true, account: { select: { name: true } }, collectedBy: { select: { fullName: true } } } },
    },
  },
} satisfies Prisma.DiningSessionInclude;
type SessionRow = Prisma.DiningSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

export type SessionLine = { id: string; name: string; qty: number; price: number; total: number; made: boolean; paid: boolean; round: number };
export type SessionOrder = {
  id: string; number: string; status: string; customer: string | null; total: number; paid: number; due: number;
  /** The customer's phone, and who they are (one person's orders together — e.g. at the counter). */
  phone: string | null; customerKey: string;
  /** On a guest's room bill (the room). */
  onRoom: string | null; at: string; items: SessionLine[];
};
export type SessionView = {
  id: string; number: string; status: DiningSessionStatus; source: string; table: string; locationId: string;
  startedAt: string; billRequestedAt: string | null; paidAt: string | null; closedAt: string | null; closedBy: string | null; closeNote: string | null;
  guestCount: number; notes: string | null; reservation: string | null;
  /** The waiter a manager put in charge of the table. */
  waiter: { id: string; name: string } | null;
  customer: { id: string; name: string; phone: string | null };
  members: { id: string; name: string; phone: string | null; primary: boolean }[];
  /**
   * The hotel rooms of the people at this table right now (worked out from the customer —
   * never stored): "Nino — Room 305". The only rooms a waiter can put this table's bill on.
   */
  stays: TableStay[];
  orders: SessionOrder[];
  money: { orders: number; items: number; total: number; paid: number; onRoom: number; due: number; serving: number };
  timeline: { at: string; kind: string; text: string; by: string | null }[];
};

export type TableStay = { id: string; reference: string; rooms: string; guestName: string; foodPayer: string | null };
const tableStay = (x: ActiveStay): TableStay => ({ id: x.id, reference: x.reference, rooms: x.rooms, guestName: x.guestName, foodPayer: x.foodPayer });
/** Everyone at a session: its customer and the people added to the table. */
const sessionPeople = (s: { guestId: string; members: { guestId: string }[] }) => [s.guestId, ...s.members.map((m) => m.guestId)];
/** The stays of a session's people, from one batch of stays. */
const staysOf = (s: { guestId: string; members: { guestId: string }[] }, all: ActiveStay[]) => {
  const people = new Set(sessionPeople(s));
  return all.filter((x) => x.guestIds.some((g) => people.has(g))).map(tableStay);
};

type OrderRowLike = {
  id: string; number: string; status: string; customerName: string | null; total: number; paidAmount: number; settlement: string; roomNumber: string | null; createdAt: Date;
  customerPhone: string | null; guestId: string | null;
  items: { id: string; name: string; quantity: number; unitPrice: number; lineTotal: number; preparedAt: Date | null; paymentId: string | null; round: number }[];
};
const orderView = (o: OrderRowLike): SessionOrder => ({
  id: o.id, number: o.number, status: o.status, customer: o.customerName, total: o.total,
  phone: o.customerPhone, customerKey: o.guestId ?? o.customerPhone ?? o.customerName?.trim().toLowerCase() ?? o.id,
  paid: o.settlement === "ROOM" ? 0 : Math.min(o.paidAmount, o.total), due: o.settlement === "ROOM" || o.status === "CANCELLED" ? 0 : Math.max(0, o.total - o.paidAmount),
  onRoom: o.settlement === "ROOM" ? o.roomNumber ?? "a room" : null, at: o.createdAt.toISOString(),
  items: o.items.map((i) => ({ id: i.id, name: i.name, qty: i.quantity, price: i.unitPrice, total: i.lineTotal, made: !!i.preparedAt, paid: !!i.paymentId, round: i.round })),
});

function sessionView(s: SessionRow, stays: TableStay[] = []): SessionView {
  const orders = s.orders.map(orderView);
  const live = s.orders.filter((o) => o.status !== "CANCELLED");
  const m = sessionMoney(s.orders);
  const timeline: SessionView["timeline"] = [
    ...s.events.map((e) => ({ at: e.at.toISOString(), kind: e.kind, text: e.note ?? e.kind, by: e.byLabel })),
    ...s.orders.map((o) => ({
      at: o.createdAt.toISOString(), kind: o.status === "CANCELLED" ? "ORDER_CANCELLED" : "ORDER",
      text: `Order ${shortOrder(o.number)} · ${o.items.reduce((t, i) => t + i.quantity, 0)} item(s) · TZS ${o.total.toLocaleString("en-US")}${o.status === "CANCELLED" ? " — cancelled" : ""}`,
      by: o.createdBy?.fullName ?? o.customerName ?? "Customer",
    })),
    ...s.orders.flatMap((o) => o.payments.map((p) => ({
      at: p.collectedAt.toISOString(), kind: p.status === "POSTED" ? "PAYMENT" : "PAYMENT_REVERSED",
      text: `${p.status === "POSTED" ? "Payment" : "Payment (reversed)"} · TZS ${p.amount.toLocaleString("en-US")} · ${p.account.name} · ${shortOrder(o.number)}`,
      by: p.collectedBy?.fullName ?? null,
    }))),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return {
    id: s.id, number: s.number, status: s.status, source: s.source, table: s.location.name, locationId: s.locationId,
    startedAt: s.startedAt.toISOString(), billRequestedAt: s.billRequestedAt?.toISOString() ?? null, paidAt: s.paidAt?.toISOString() ?? null,
    closedAt: s.closedAt?.toISOString() ?? null, closedBy: s.closedBy?.fullName ?? null, closeNote: s.closeNote,
    guestCount: s.guestCount, notes: s.notes, reservation: s.tableReservation?.reference ?? null,
    waiter: s.waiter ? { id: s.waiter.id, name: s.waiter.fullName } : null,
    customer: { id: s.guest.id, name: s.guest.fullName, phone: s.guest.phone },
    members: s.members.map((x) => ({ id: x.id, name: x.guest.fullName, phone: x.guest.phone, primary: x.primary })),
    stays, orders, money: { ...m, items: live.reduce((t, o) => t + o.items.reduce((u, i) => u + i.quantity, 0), 0) }, timeline,
  };
}

/** For the Mpishi: who ordered what — never the money or phone numbers. */
export function withoutMoney(s: SessionView): SessionView {
  return {
    ...s,
    orders: s.orders.map((o) => ({ ...o, total: 0, paid: 0, due: 0, phone: null, onRoom: null, items: o.items.map((i) => ({ ...i, price: 0, total: 0 })) })),
    money: { ...s.money, total: 0, paid: 0, onRoom: 0, due: 0 },
    timeline: s.timeline.filter((t) => !["PAYMENT", "PAYMENT_REVERSED", "CHARGED_TO_ROOM", "OFF_ROOM"].includes(t.kind)).map((t) => ({ ...t, text: t.text.replace(/ · TZS [\d,]+/g, "") })),
    customer: { ...s.customer, phone: null }, members: s.members.map((m) => ({ ...m, phone: null })), stays: [],
  };
}

export type FloorReservation = { id: string; reference: string; name: string; phone: string | null; at: string; guests: number; status: string; holding: boolean };
export type FloorPlace = {
  id: string; kind: string; area: string | null; number: number | null; name: string; qrToken: string; qrActive: boolean; scans: number; lastScan: string | null;
  session: SessionView | null;
  /** Open orders here that are not part of a session (the counter, the main restaurant QR, orders from before sessions). */
  loose: SessionOrder[];
  /** The table's next reservation (within the next day), and whether it holds the table now. */
  next: FloorReservation | null;
  /** Customers who finished at this table today. */
  doneToday: number;
  /** Blocked for now by a manager: UNAVAILABLE | MAINTENANCE, why, since when. */
  blocked: { as: string; reason: string | null; at: string | null } | null;
  /** The waiter a manager put in charge of this table. */
  waiter: { id: string; name: string } | null;
};

/** The restaurant floor for staff: every place, who is at each table now, and its next reservation. */
export async function tableFloor(opts: { today: string; now?: Date }): Promise<FloorPlace[]> {
  const now = opts.now ?? new Date();
  const [places, bookings] = await Promise.all([
    db.restaurantLocation.findMany({
      where: { isActive: true }, orderBy: { sortOrder: "asc" },
      include: {
        openSession: { include: SESSION_INCLUDE },
        waiter: { select: { id: true, fullName: true } },
        orders: { where: { sessionId: null, status: { notIn: CLOSED_STATUSES }, type: { not: "TAKEAWAY" } }, orderBy: { createdAt: "asc" }, include: { items: { orderBy: { id: "asc" } } } },
        _count: { select: { sessions: { where: { businessDate: new Date(`${opts.today}T00:00:00Z`), status: { in: ["CLOSED", "CANCELLED"] } } } } },
      },
    }),
    db.tableReservation.findMany({
      where: { status: { in: ["BOOKED", "CONFIRMED"] }, reservedFor: { gte: new Date(now.getTime() - HOLD_AFTER_MIN * 60_000), lte: new Date(now.getTime() + 24 * 3600_000) } },
      orderBy: { reservedFor: "asc" }, include: { guest: { select: { fullName: true, phone: true } } },
    }),
  ]);
  const stays = await activeStaysFor(db, places.flatMap((l) => (l.openSession ? sessionPeople(l.openSession) : [])));
  return places.map((l) => {
    const r = bookings.find((b) => b.locationId === l.id);
    return {
      id: l.id, kind: l.kind, area: l.area, number: l.number, name: l.name, qrToken: l.qrToken, qrActive: l.qrActive, scans: l.scanCount, lastScan: l.lastScannedAt?.toISOString() ?? null,
      session: l.openSession ? sessionView(l.openSession, staysOf(l.openSession, stays)) : null,
      loose: l.orders.map(orderView),
      next: r ? {
        id: r.id, reference: r.reference, name: r.guest.fullName, phone: r.guest.phone, at: r.reservedFor.toISOString(), guests: r.guestCount, status: r.status,
        holding: r.reservedFor.getTime() - now.getTime() <= HOLD_BEFORE_MIN * 60_000 && now.getTime() - r.reservedFor.getTime() <= HOLD_AFTER_MIN * 60_000,
      } : null,
      doneToday: l._count.sessions,
      blocked: l.blockedAs ? { as: l.blockedAs, reason: l.blockedReason, at: l.blockedAt?.toISOString() ?? null } : null,
      waiter: l.waiter ? { id: l.waiter.id, name: l.waiter.fullName } : null,
    };
  });
}

/** Who is seated at which table now (for taking an order there without asking again). */
export async function openTableSessions() {
  const rows = await db.diningSession.findMany({
    where: { openAtId: { not: null } },
    include: {
      location: { select: { name: true } }, guest: { select: { fullName: true, phone: true } }, members: { select: { guestId: true } },
      orders: { select: { id: true, status: true, settlement: true, total: true, paidAmount: true }, orderBy: { createdAt: "asc" } },
    },
  });
  const stays = await activeStaysFor(db, rows.flatMap(sessionPeople));
  return rows.map((s) => {
    const m = sessionMoney(s.orders);
    return {
      locationId: s.locationId, table: s.location.name, name: s.guest.fullName, phone: s.guest.phone, orders: m.orders, total: m.total, due: m.due,
      orderId: s.orders.find((o) => o.status !== "CANCELLED")?.id ?? null, stays: staysOf(s, stays),
    };
  });
}

/** One session — open or finished — with its orders, money and timeline. */
export async function sessionById(id: string) {
  const s = await db.diningSession.findUnique({ where: { id }, include: SESSION_INCLUDE });
  if (!s) return null;
  const open = OPEN_SESSION.includes(s.status);
  return sessionView(s, open ? (await activeStaysFor(db, sessionPeople(s))).map(tableStay) : []);
}

/** A table's past customers, newest first. */
export async function tableHistory(locationId: string, take = 25) {
  const rows = await db.diningSession.findMany({
    where: { OR: [{ locationId }, { moves: { some: { fromLocationId: locationId } } }], status: { in: ["CLOSED", "CANCELLED"] } },
    orderBy: { startedAt: "desc" }, take: Math.min(Math.max(take, 1), 100),
    include: { guest: { select: { fullName: true } }, location: { select: { name: true } }, orders: { select: { status: true, settlement: true, total: true, paidAmount: true } } },
  });
  return rows.map((s) => ({
    id: s.id, number: s.number, status: s.status, customer: s.guest.fullName, table: s.location.name, guests: s.guestCount,
    startedAt: s.startedAt.toISOString(), closedAt: s.closedAt?.toISOString() ?? null, total: sessionMoney(s.orders).total,
  }));
}

// ───────────────────────── Staff: seat, add people, move, pay, close ─────────────────────────

/** A waiter seats a customer who did not scan (a walk-in): the table is theirs until the bill is paid. */
export async function seatCustomer(input: { locationId: string; name: string; phone: string; guestCount?: number; notes?: string | null; override?: boolean; /** Picked in the search: that very customer. */ guestId?: string | null }, actor: Actor, now = new Date()) {
  assertTables(actor);
  if (!validPhone(input.phone)) throw new AppError("Enter the customer's phone number (e.g. 0712 345 678).", "VALIDATION", { phone: "Invalid" });
  if (input.name.trim().length < 2) throw new AppError("Enter the customer's name.", "VALIDATION", { name: "Required" });
  const phone = normalizePhone(input.phone)!;
  try {
    return await db.$transaction(async (tx) => {
      const guestId = (await pickedCustomerTx(tx, input.guestId, phone)) ?? await resolveGuest(tx, { fullName: input.name.trim().slice(0, 80), phone });
      return startSessionTx(tx, { locationId: input.locationId, guestId, guestCount: input.guestCount ?? 1, source: "STAFF", notes: input.notes, override: input.override }, actor, now);
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("Someone else just seated a customer at this table — refresh and choose another.", "CONFLICT");
    throw e;
  }
}

async function openSessionTx(tx: Prisma.TransactionClient, id: string) {
  await lockSessionTx(tx, id);
  const s = await tx.diningSession.findUnique({ where: { id }, include: { location: { select: { id: true, name: true } } } });
  if (!s) throw new AppError("That table's session was not found.", "NOT_FOUND");
  if (!OPEN_SESSION.includes(s.status)) throw new AppError("This customer's session has already ended.", "CONFLICT");
  return s;
}

/** Someone else at the table (a friend who wants to order from the QR too): the waiter adds them. */
export async function addSessionMember(sessionId: string, input: { name: string; phone: string; /** Picked in the search: that very customer. */ guestId?: string | null }, actor: Actor, now = new Date()) {
  assertTables(actor);
  if (!validPhone(input.phone)) throw new AppError("Enter their phone number (e.g. 0712 345 678).", "VALIDATION", { phone: "Invalid" });
  const phone = normalizePhone(input.phone)!;
  return db.$transaction(async (tx) => {
    const s = await openSessionTx(tx, sessionId);
    const guestId = (await pickedCustomerTx(tx, input.guestId, phone)) ?? await resolveGuest(tx, { fullName: input.name.trim().slice(0, 80) || "Table guest", phone });
    const already = await tx.diningSessionMember.findUnique({ where: { sessionId_guestId: { sessionId, guestId } } });
    if (already) throw new AppError("They are already on this table.", "CONFLICT");
    const other = await tx.diningSessionMember.findFirst({ where: { guestId, session: { openAtId: { not: null }, id: { not: sessionId } } }, include: { session: { include: { location: { select: { name: true } } } } } });
    if (other) throw new AppError(`That number is on ${other.session.location.name} right now.`, "CONFLICT");
    const m = await tx.diningSessionMember.create({ data: { sessionId, guestId, addedById: actor.userId ?? null, addedAt: now }, include: { guest: { select: { fullName: true } } } });
    await sessionEventTx(tx, sessionId, "MEMBER_ADDED", `${m.guest.fullName} added to ${s.location.name} — they can order from the QR too`, actor, now);
    await audit(tx, actor, { action: "dining_session.member_added", entityType: "DiningSession", entityId: sessionId, after: { guest: guestId, name: m.guest.fullName } });
    return m;
  });
}

/** How many people are at the table. */
export async function setSessionGuests(sessionId: string, count: number, actor: Actor, now = new Date()) {
  assertTables(actor);
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new AppError("How many people? 1 to 60.", "VALIDATION", { guestCount: "Invalid" });
  return db.$transaction(async (tx) => {
    const s = await openSessionTx(tx, sessionId);
    if (s.guestCount === count) return s;
    await tx.diningSession.update({ where: { id: sessionId }, data: { guestCount: count } });
    await sessionEventTx(tx, sessionId, "GUESTS", `${s.guestCount} → ${count} people`, actor, now);
    return s;
  });
}

/** The customer is done (or the waiter says so): waiting for the payment. The table stays theirs until staff clear it. */
async function requestBillTx(tx: Prisma.TransactionClient, sessionId: string, who: string, actor: Actor | null, now: Date) {
  const s = await openSessionTx(tx, sessionId);
  if (s.status === "ACTIVE") {
    await tx.diningSession.update({ where: { id: sessionId }, data: { status: "AWAITING_PAYMENT", billRequestedAt: now } });
    await sessionEventTx(tx, sessionId, "BILL_REQUESTED", who, actor, now);
  }
  return refreshSessionTx(tx, sessionId, actor, now);
}
export async function requestSessionBill(sessionId: string, actor: Actor, now = new Date()) {
  assertTables(actor);
  return db.$transaction((tx) => requestBillTx(tx, sessionId, "Bill asked for by staff", actor, now));
}

/**
 * The customer moves to another table: the same session (the same orders, bill and history)
 * goes with them. Orders still coming go to the new table; what was already served keeps its
 * table. The old table is free at once. Every move is kept (from, to, who, why, when).
 */
export async function moveSession(sessionId: string, toLocationId: string, opts: { reason?: string | null; override?: boolean }, actor: Actor, now = new Date()) {
  assertTables(actor);
  try {
    return await db.$transaction(async (tx) => {
      const s0 = await tx.diningSession.findUnique({ where: { id: sessionId }, select: { locationId: true } });
      if (!s0) throw new AppError("That table's session was not found.", "NOT_FOUND");
      // Lock both tables, always in the same order (never two moves waiting on each other).
      for (const id of [s0.locationId, toLocationId].sort()) await lockLocationTx(tx, id);
      const s = await openSessionTx(tx, sessionId);
      const to = await tx.restaurantLocation.findUnique({ where: { id: toLocationId }, include: { openSession: { select: { id: true, guest: { select: { fullName: true } } } } } });
      if (!to || !to.isActive || to.kind !== "TABLE") throw new AppError("Choose one of the tables.", "VALIDATION", { locationId: "Invalid" });
      if (to.id === s.locationId) throw new AppError(`They are already at ${to.name}.`, "VALIDATION");
      if (to.blockedAs) throw new AppError(`${to.name} is ${to.blockedAs === "MAINTENANCE" ? "under maintenance" : "not available"} — choose another table.`, "CONFLICT", { locationId: "Blocked" });
      if (to.openSession) throw new AppError(`${to.name} has a customer (${to.openSession.guest.fullName}) — choose a free table.`, "CONFLICT", { locationId: "Occupied" });
      if (!opts.override) {
        const held = await holdingReservationTx(tx, to.id, now);
        if (held) {
          const settings = await getSettings();
          throw new AppError(`${reservedMessage(held.guest.fullName, to.name, held.reservedFor, settings.timezone)} Choose another table — or move anyway.`, "CONFLICT", { locationId: "Reserved" });
        }
      }
      const reason = opts.reason?.trim().slice(0, 200) || null;
      await tx.diningSession.update({ where: { id: sessionId }, data: { locationId: to.id, openAtId: to.id } });
      // Orders still coming follow the customer; served ones keep the table they were served at.
      const coming = await tx.restaurantOrder.findMany({ where: { sessionId, status: { in: IN_SERVICE } }, select: { id: true, status: true } });
      for (const o of coming) {
        await tx.restaurantOrder.update({ where: { id: o.id }, data: { locationId: to.id, tableLabel: to.name } });
        await tx.restaurantOrderEvent.create({ data: { orderId: o.id, from: o.status, to: o.status, byId: actor.userId ?? null, byLabel: actor.label ?? null, byRole: actor.role ?? null, at: now, note: `The customer moved from ${s.location.name} to ${to.name} — bring it there` } });
      }
      await tx.tableMove.create({ data: { sessionId, fromLocationId: s.locationId, toLocationId: to.id, reason, byId: actor.userId ?? null, byLabel: actor.label ?? null, at: now } });
      await sessionEventTx(tx, sessionId, "MOVED", `Moved from ${s.location.name} to ${to.name}${reason ? ` — ${reason}` : ""}`, actor, now);
      await audit(tx, actor, { action: "dining_session.moved", entityType: "DiningSession", entityId: sessionId, before: { table: s.location.name }, after: { table: to.name, reason, ordersFollowing: coming.length, override: !!opts.override } });
      return { from: s.location.name, to: to.name };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("Someone just seated a customer at that table — choose another.", "CONFLICT");
    throw e;
  }
}

/**
 * The whole bill is paid (into one of the hotel's accounts, with the reference): every order's
 * remaining amount, as normal payments. The session is then PAID — staff clear the table when they leave.
 */
export async function takeSessionPayment(sessionId: string, input: PayInput, actor: Actor, now = new Date()) {
  if (!actor.userId || !actor.permissions?.has("revenue.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const s = await openSessionTx(tx, sessionId);
    const orders = await tx.restaurantOrder.findMany({ where: { sessionId }, select: { id: true, status: true, settlement: true, total: true, paidAmount: true } });
    const due = sessionMoney(orders).due;
    if (due <= 0) throw new AppError("Nothing is left to pay on this table.", "VALIDATION");
    // An order the customer paid online is never paid again here (its payment is checked on its own).
    const online = await awaitingOnlineTx(tx, orders.filter((o) => o.status !== "CANCELLED" && o.settlement !== "ROOM").map((o) => o.id));
    if (online.length) throw new AppError(`Order ${shortOrder(online[0].number)} was paid online — confirm or decline its payment first, then take the rest of the bill.`, "CONFLICT");
    if (s.status === "ACTIVE") {
      await tx.diningSession.update({ where: { id: sessionId }, data: { status: "AWAITING_PAYMENT", billRequestedAt: s.billRequestedAt ?? now } });
      await sessionEventTx(tx, sessionId, "BILL_REQUESTED", "Bill paid at the table", actor, now);
    }
    const paid = await payOrdersTx(tx, orders.filter((o) => o.status !== "CANCELLED" && o.settlement !== "ROOM" && o.paidAmount < o.total).map((o) => o.id), input, actor, now);
    const after = await tx.diningSession.findUniqueOrThrow({ where: { id: sessionId }, select: { status: true } });
    return { amount: paid.total, orders: paid.count, status: after.status };
  });
}

/**
 * The whole table bill on a room (the customer is staying with us): every unpaid order here goes
 * on that room's bill in one step — each keeps its table, session and customer, and its money is
 * counted once, as restaurant / bar income. A waiter may use only the room of someone at this
 * table; reception and managers say why when it is another guest's room. An order already part
 * paid is refused (its rest is taken as a payment first) — nothing is ever charged twice.
 */
export async function chargeSessionToRoom(sessionId: string, reservationId: string, opts: { reason?: string | null }, actor: Actor, now = new Date()) {
  if (!actor.userId || !actor.permissions?.has("restaurant.orders")) throw new AppError("You cannot put bills on rooms.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const s = await openSessionTx(tx, sessionId);
    const orders = await tx.restaurantOrder.findMany({ where: { sessionId }, orderBy: { id: "asc" }, select: { id: true, number: true, status: true, settlement: true, total: true, paidAmount: true } });
    const part = orders.find((o) => o.status !== "CANCELLED" && o.settlement !== "ROOM" && o.paidAmount > 0 && o.paidAmount < o.total);
    if (part) throw new AppError(`Order ${shortOrder(part.number)} is already part paid — receive the rest of it as a payment, then put the other orders on the room.`, "VALIDATION");
    const todo = orders.filter((o) => o.status !== "CANCELLED" && o.settlement !== "ROOM" && o.paidAmount === 0);
    if (!todo.length) throw new AppError("Nothing on this table is left to put on a room.", "VALIDATION");
    const online = await awaitingOnlineTx(tx, todo.map((o) => o.id));
    if (online.length) throw new AppError(`Order ${shortOrder(online[0].number)} was paid online — it cannot go on a room. Confirm or decline its payment first.`, "CONFLICT");
    let total = 0, room = "";
    for (const o of todo) {
      const done = await chargeOrderToRoomTx(tx, o.id, reservationId, actor, now, opts);
      total += done.total; room = done.room ?? room;
    }
    // The bill is settled on the room: like a payment, the table is then ready to be cleared.
    if (s.status === "ACTIVE") {
      await tx.diningSession.update({ where: { id: sessionId }, data: { status: "AWAITING_PAYMENT", billRequestedAt: s.billRequestedAt ?? now } });
      await sessionEventTx(tx, sessionId, "BILL_REQUESTED", `Bill put on Room ${room}`, actor, now);
    }
    await audit(tx, actor, {
      action: "dining_session.charged_to_room", entityType: "DiningSession", entityId: sessionId,
      after: { table: s.location.name, orders: todo.map((o) => o.number), amount: total, room, reservation: reservationId, customer: s.guestId, role: actor.role ?? null, source: "TABLE", ...(opts.reason?.trim() ? { reason: opts.reason.trim() } : {}) },
    });
    await refreshSessionTx(tx, sessionId, actor, now);
    return { orders: todo.length, total, room, table: s.location.name };
  });
}

/**
 * Clear the table — always by hand, once staff have seen the customer leave: only when nothing
 * is left to pay. Orders never marked served are refused — unless staff say the customer got
 * everything (`serveRemaining`): those are marked served, kept in their history. A customer who
 * ordered nothing can be removed any time (the session is cancelled) so someone else can sit.
 */
export async function closeSession(sessionId: string, opts: { note?: string | null; serveRemaining?: boolean }, actor: Actor, now = new Date()) {
  assertTables(actor);
  return db.$transaction(async (tx) => {
    const s = await openSessionTx(tx, sessionId);
    const orders = await tx.restaurantOrder.findMany({ where: { sessionId }, select: { id: true, number: true, status: true, settlement: true, total: true, paidAmount: true } });
    const m = sessionMoney(orders);
    if (m.due > 0) throw new AppError(`TZS ${m.due.toLocaleString("en-US")} is still to pay — the table can be cleared only when the bill is fully paid.`, "VALIDATION");
    const coming = orders.filter((o) => IN_SERVICE.includes(o.status));
    if (coming.length && !opts.serveRemaining) {
      throw new AppError(`Order ${shortOrder(coming[0].number)} is not marked served yet — serve it, or clear the table saying they got everything.`, "VALIDATION", { serving: String(coming.length) });
    }
    // "They got everything" is a waiter's word — reception never marks food served (the restaurant's steps stay the restaurant's).
    if (coming.length && !actor.permissions?.has("restaurant.serve")) throw new AppError("A waiter confirms that orders were served — ask the table's waiter to clear it.", "FORBIDDEN");
    for (const o of coming) await markServedOnClearTx(tx, o.id, actor, now);
    const note = opts.note?.trim().slice(0, 200);
    return m.orders > 0
      ? endSessionTx(tx, s, "CLOSED", note || `Table cleared — they left, everything ${m.onRoom ? (m.paid ? "paid or on the room bill" : "on the room bill") : "paid"}. ${s.location.name} is free`, actor, now)
      : endSessionTx(tx, s, "CANCELLED", note || `Removed — nothing ordered. ${s.location.name} is free`, actor, now);
  });
}

// ───────────────────────── The customer at the table ─────────────────────────

export type GuestTable = {
  /** free: nobody here · mine: this phone's table · in_use: someone else's · reserved: held for a reservation */
  state: "free" | "mine" | "in_use" | "reserved";
  mine: null | {
    number: string; name: string; table: string; status: DiningSessionStatus; startedAt: string; billRequested: boolean;
    orders: { number: string; status: string; total: number; track: string | null; items: { name: string; qty: number; price: number }[] }[];
    total: number; paid: number; due: number; serving: number;
    /** Put on their hotel room's bill (paid when they check out), and which room. */
    onRoom: number; room: string | null;
  };
  /** They were moved: the table they are at now (when it is not the one scanned). */
  movedTo: string | null;
};

/** What a table's page shows this phone: its own session (by its private seat cookie), someone else's table, a reservation — or free. */
export async function guestTableState(locationId: string, seatToken: string | null, now = new Date()): Promise<GuestTable> {
  const seat = await seatOf(seatToken);
  const own = seat && OPEN_SESSION.includes(seat.member.session.status) ? seat.member.session : null;
  if (own) {
    const s = await db.diningSession.findUniqueOrThrow({
      where: { id: own.id },
      include: { location: { select: { name: true } }, orders: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, include: { items: { orderBy: { id: "asc" } } } } },
    });
    const m = sessionMoney(s.orders);
    return {
      state: "mine", movedTo: s.locationId !== locationId ? s.location.name : null,
      mine: {
        number: sessionNo(s.number), name: seat!.member.guest.fullName.split(/\s+/)[0], table: s.location.name, status: s.status, startedAt: s.startedAt.toISOString(),
        billRequested: s.status !== "ACTIVE",
        orders: s.orders.map((o) => ({ number: shortOrder(o.number), status: o.status, total: o.total, track: o.trackToken, items: o.items.map((i) => ({ name: i.name, qty: i.quantity, price: i.unitPrice })) })),
        total: m.total, paid: m.paid, due: m.due, serving: m.serving,
        onRoom: m.onRoom, room: s.orders.find((o) => o.settlement === "ROOM")?.roomNumber ?? null,
      },
    };
  }
  const [open, held] = await Promise.all([
    db.diningSession.findUnique({ where: { openAtId: locationId }, select: { id: true } }),
    db.$transaction((tx) => holdingReservationTx(tx, locationId, now)),
  ]);
  return { state: open ? "in_use" : held ? "reserved" : "free", mine: null, movedTo: null };
}

/**
 * The customer at the table says who they are. A free table → their session starts (the table is
 * theirs until the bill is paid). Already on this table (they, or a waiter added them) → welcome
 * back. Someone else's table → "please ask your waiter to add you" — never taking it over. A table
 * held for a reservation → only that reservation's phone is seated.
 */
export async function seatAtTable(token: string, input: { name?: string | null; phone: string }, seatToken: string | null, now = new Date()) {
  const l = await activeLocation(token);
  if (l.kind !== "TABLE") throw new AppError("This QR is not a table's — order as usual.", "VALIDATION");
  if (!validPhone(input.phone)) throw new AppError("Please enter a phone number we can reach you on (e.g. 0712 345 678).", "VALIDATION", { phone: "Invalid" });
  const phone = normalizePhone(input.phone)!;
  const seat = await seatOf(seatToken);
  if (seat && OPEN_SESSION.includes(seat.member.session.status) && samePhone(seat.member.guest.phone, phone)) {
    return { state: "welcome_back" as const, name: shortName(seat.member.guest.fullName), token: null, table: seat.member.session.location.name };
  }
  try {
    return await db.$transaction(async (tx) => {
      await lockLocationTx(tx, l.id);
      const open = await tx.diningSession.findUnique({ where: { openAtId: l.id }, include: { members: { include: { guest: { select: { fullName: true, phone: true } } } } } });
      if (open) {
        const m = open.members.find((x) => samePhone(x.guest.phone, phone));
        if (!m) return { state: "in_use" as const, name: null, token: null, table: l.name };
        return { state: "welcome_back" as const, name: shortName(m.guest.fullName), token: await issueSeatTx(tx, m.id), table: l.name };
      }
      const held = await holdingReservationTx(tx, l.id, now);
      if (held && !samePhone(held.guest.phone, phone)) return { state: "reserved" as const, name: null, token: null, table: l.name };
      const s = held
        // The customer who booked this table: their reservation is seated.
        ? await seatPartyTx(tx, held.id, null, now)
        : await startSessionTx(tx, { locationId: l.id, guestId: await resolveGuest(tx, { fullName: await orderCustomerName(input.name, phone), phone }), source: "QR" }, null, now);
      const member = await tx.diningSessionMember.findFirstOrThrow({ where: { sessionId: s.id, primary: true }, include: { guest: { select: { fullName: true } } } });
      return { state: "seated" as const, name: shortName(member.guest.fullName), token: await issueSeatTx(tx, member.id), table: l.name };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { state: "in_use" as const, name: null, token: null, table: l.name };
    throw e;
  }
}

/** "I'm done" from the customer's phone: the waiter brings the bill (staff clear the table when they leave). */
export async function customerRequestBill(seatToken: string | null, now = new Date()) {
  const seat = await seatOf(seatToken);
  if (!seat || !OPEN_SESSION.includes(seat.member.session.status)) throw new AppError("Your table's order has ended — scan the QR to start again.", "CONFLICT");
  const who = seat.member.guest.fullName;
  await db.$transaction((tx) => requestBillTx(tx, seat.member.session.id, `${who.split(/\s+/)[0]} said “I'm done” — bring the bill`, { userId: null, label: who }, now));
  const after = await db.diningSession.findUniqueOrThrow({ where: { id: seat.member.session.id }, select: { status: true } });
  return { status: after.status };
}

// ───────────────────────── Reservations → sessions ─────────────────────────

/**
 * The reserved customer has come: their reservation becomes their session at its table (or the
 * table staff choose). Used by staff ("Seat customer") and when the customer scans and gives the
 * reservation's phone.
 */
export async function seatReservationTx(tx: Prisma.TransactionClient, reservationId: string, opts: { locationId?: string | null; guestCount?: number | null; override?: boolean }, actor: Actor | null, now: Date) {
  const first = await tx.tableReservation.findUnique({ where: { id: reservationId }, select: { locationId: true } });
  if (!first) throw new AppError("Reservation not found.", "NOT_FOUND");
  // Always the table first, then the reservation (the same order everywhere).
  await lockLocationTx(tx, opts.locationId ?? first.locationId);
  await tx.$queryRaw`SELECT "id" FROM "table_reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
  const r = await tx.tableReservation.findUnique({ where: { id: reservationId }, include: { location: { select: { name: true } } } });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  if (r.status !== "BOOKED" && r.status !== "CONFIRMED") throw new AppError(r.status === "SEATED" ? "They are already seated." : "This reservation was cancelled or marked no-show.", "CONFLICT");
  const at = opts.locationId ?? r.locationId;
  if (at !== r.locationId) {
    // Seated at another table than booked: another reservation holding that table must be respected.
    if (!opts.override) {
      const held = await holdingReservationTx(tx, at, now, r.id);
      if (held) throw new AppError(`That table is reserved for ${held.guest.fullName} — choose another, or seat anyway.`, "CONFLICT", { locationId: "Reserved" });
    }
    await tx.tableMove.create({ data: { tableReservationId: r.id, fromLocationId: r.locationId, toLocationId: at, reason: "Seated at another table", byId: actor?.userId ?? null, byLabel: actor?.label ?? "Customer", at: now } });
  }
  const s = await startSessionTx(tx, { locationId: at, guestId: r.guestId, guestCount: opts.guestCount ?? r.guestCount, source: "RESERVATION", reservationId: r.id, notes: r.notes, override: true }, actor, now);
  await tx.tableReservation.update({ where: { id: r.id }, data: { status: "SEATED", seatedAt: now, locationId: at, updatedById: actor?.userId ?? null } });
  await audit(tx, actor ?? { userId: null, label: "Customer" }, { action: "table_reservation.seated", entityType: "TableReservation", entityId: r.id, before: { status: r.status, table: r.location.name }, after: { status: "SEATED", session: s.number } });
  return s;
}
/**
 * A party booked on several tables came: every table of it still booked is seated at once — each
 * table its own session (its own orders and bill), the people shared out. Returns the session
 * at the reservation's own table.
 */
export async function seatPartyTx(tx: Prisma.TransactionClient, reservationId: string, actor: Actor | null, now: Date) {
  const r = await tx.tableReservation.findUnique({ where: { id: reservationId }, select: { partyId: true, guestCount: true } });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  const others = r.partyId
    ? await tx.tableReservation.findMany({ where: { partyId: r.partyId, id: { not: reservationId }, status: { in: ["BOOKED", "CONFIRMED"] } }, orderBy: { reference: "asc" }, select: { id: true } })
    : [];
  const each = Math.max(1, Math.ceil(r.guestCount / (others.length + 1)));
  const first = await seatReservationTx(tx, reservationId, { guestCount: others.length ? each : null }, actor, now);
  for (const o of others) await seatReservationTx(tx, o.id, { guestCount: each }, actor, now);
  return first;
}

export async function seatReservation(reservationId: string, opts: { locationId?: string | null; guestCount?: number | null; override?: boolean }, actor: Actor, now = new Date()) {
  assertTables(actor);
  try {
    // At its own table(s): the whole party is seated; at another table staff chose: just this one.
    return await db.$transaction((tx) => (opts.locationId ? seatReservationTx(tx, reservationId, opts, actor, now) : seatPartyTx(tx, reservationId, actor, now)));
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("Someone just seated a customer at that table — choose another.", "CONFLICT");
    throw e;
  }
}
