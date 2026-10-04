import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { audit } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { getSettings } from "../settings";
import { prettyPhone, shortName, validPhone } from "@/lib/guest-messages";
import { normalizePhone, resolveGuest } from "./guests";
import { orderCustomerName, paidFirstTx, type PaidFirst } from "./online-orders";
import { addOrderItemsTx, CLOSED_STATUSES, createRestaurantOrderTx, LOCATION_SOURCE } from "./restaurant";
import { HOLD_AFTER_MIN, lockSessionTx, OPEN_SESSION, seatOf } from "./dining-core";
import type { Actor } from "./reservations";

/**
 * The restaurant's places, each with its own QR code: Table 1–6 inside, Table 1–6 outside,
 * the outside counter (its own place, not "Table 7") and the main restaurant QR (no table).
 * The place's id is its identity; the QR token is random and can be regenerated — the old
 * code stops working at once, past orders keep their place. Orders from any of them go into
 * the one restaurant order engine, like room QR and staff orders.
 */

export const newLocationToken = () => randomBytes(12).toString("hex");
const TOKEN = /^[a-f0-9]{24}$/;
const canManage = (a: Actor) => !!(a.permissions?.has("restaurant.menu") || a.permissions?.has("settings.manage"));
/** Managers, the MD and the owner run the floor: add tables, take them out of use, block them for now. */
const runsFloor = (a: Actor) => canManage(a) || ["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => a.permissions?.has(p as never));
const OPEN = { notIn: CLOSED_STATUSES };

/** Every place with its QR and who is there now (open orders: customer, number, total still due). */
export async function restaurantLocations(opts: { today?: string } = {}) {
  const rows = await db.restaurantLocation.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      qrBy: { select: { fullName: true } },
      orders: {
        // Open orders — and, for the table's window, what it had earlier today.
        where: opts.today ? { OR: [{ status: OPEN }, { businessDate: new Date(`${opts.today}T00:00:00Z`) }] } : { status: OPEN },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, number: true, status: true, customerName: true, total: true, paidAmount: true, settlement: true, roomNumber: true, createdAt: true, trackToken: true,
          items: { select: { id: true, name: true, quantity: true, unitPrice: true, lineTotal: true, preparedAt: true, paymentId: true, round: true }, orderBy: { id: "asc" } },
        },
      },
    },
  });
  return rows.map(({ orders, ...l }) => {
    const withDue = orders.map((o) => ({ ...o, due: o.settlement === "ROOM" ? 0 : Math.max(0, o.total - o.paidAmount) }));
    const open = withDue.filter((o) => !CLOSED_STATUSES.includes(o.status));
    return { ...l, open, earlier: withDue.filter((o) => CLOSED_STATUSES.includes(o.status)).reverse(), since: open[0]?.createdAt ?? null };
  });
}
export type RestaurantLocationRow = Awaited<ReturnType<typeof restaurantLocations>>[number];

/** The restaurant's own QR (for the entrance, the bar, reception) — shown on the Restaurant page to everyone. */
export async function mainRestaurantQr() {
  return db.restaurantLocation.findFirst({ where: { kind: "MAIN", isActive: true }, select: { id: true, qrToken: true, qrActive: true } });
}

/** Active places for staff to pick when taking an order (tables inside / outside, the counter). */
export async function orderLocations() {
  return db.restaurantLocation.findMany({
    where: { isActive: true, kind: { not: "MAIN" } }, orderBy: { sortOrder: "asc" },
    select: { id: true, kind: true, area: true, number: true, name: true, orders: { where: { status: OPEN }, select: { id: true } }, openSession: { select: { id: true } } },
  }).then((xs) => xs.map(({ orders, openSession, ...l }) => ({ ...l, busy: orders.length > 0 || !!openSession })));
}

/** A new QR for a place (a card went missing): the old code stops working now; past orders are untouched. */
export async function regenerateLocationQr(id: string, actor: Actor, now = new Date()) {
  if (!canManage(actor)) throw new AppError("Only a manager can change restaurant QR codes.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const l = await tx.restaurantLocation.findUnique({ where: { id } });
    if (!l) throw new AppError("Table not found.", "NOT_FOUND");
    const token = newLocationToken();
    await tx.restaurantLocation.update({ where: { id }, data: { qrToken: token, regeneratedAt: now, qrById: actor.userId ?? null, qrActive: true } });
    await audit(tx, actor, { action: "restaurant_qr.regenerated", entityType: "RestaurantLocation", entityId: id, before: { place: l.name }, after: { place: l.name } });
    return token;
  });
}

/** Switch a place's QR off (e.g. the table is out for the evening) or back on. */
export async function setLocationQrActive(id: string, active: boolean, actor: Actor) {
  if (!canManage(actor)) throw new AppError("Only a manager can change restaurant QR codes.", "FORBIDDEN");
  await db.$transaction(async (tx) => {
    const l = await tx.restaurantLocation.findUnique({ where: { id } });
    if (!l) throw new AppError("Table not found.", "NOT_FOUND");
    await tx.restaurantLocation.update({ where: { id }, data: { qrActive: active } });
    await audit(tx, actor, { action: active ? "restaurant_qr.enabled" : "restaurant_qr.disabled", entityType: "RestaurantLocation", entityId: id, before: { place: l.name, active: l.qrActive }, after: { place: l.name, active } });
  });
}

/**
 * A new table (inside or outside), numbered after the last one there — with its own QR card.
 * Managers and the MD set the floor up; the waiters work it.
 */
export async function addTable(input: { area: "INSIDE" | "OUTSIDE" }, actor: Actor) {
  if (!runsFloor(actor)) throw new AppError("Only a manager or the MD adds tables.", "FORBIDDEN");
  const areaName = input.area === "INSIDE" ? "Inside" : "Outside";
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('restaurant_tables'))::text`;
    const last = await tx.restaurantLocation.findFirst({ where: { kind: "TABLE", area: input.area }, orderBy: { number: "desc" } });
    const number = (last?.number ?? 0) + 1;
    // Right after the area's last table on the floor.
    const after = last?.sortOrder ?? (await tx.restaurantLocation.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    await tx.restaurantLocation.updateMany({ where: { sortOrder: { gt: after } }, data: { sortOrder: { increment: 1 } } });
    const t = await tx.restaurantLocation.create({
      data: { kind: "TABLE", area: input.area, number, name: `Table ${number} — ${areaName}`, qrToken: newLocationToken(), sortOrder: after + 1, qrById: actor.userId ?? null },
    });
    await audit(tx, actor, { action: "restaurant_table.added", entityType: "RestaurantLocation", entityId: t.id, after: { place: t.name } });
    return { id: t.id, name: t.name };
  });
}

/**
 * Switch a table off (broken, moved out for an event) or back on. Off: nobody can be seated or
 * order from its QR; its history stays. Only an empty table with no reservations coming can go off.
 */
export async function setTableInUse(id: string, active: boolean, reason: string | null, actor: Actor, now = new Date()) {
  if (!runsFloor(actor)) throw new AppError("Only a manager or the MD switches tables off.", "FORBIDDEN");
  const why = reason?.trim() ?? "";
  if (!active && why.length < 3) throw new AppError("Say why the table is switched off (e.g. broken leg, used for an event).", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    const l = await tx.restaurantLocation.findUnique({ where: { id }, include: { openSession: { select: { id: true } } } });
    if (!l) throw new AppError("Table not found.", "NOT_FOUND");
    if (l.kind !== "TABLE") throw new AppError("Only tables can be switched off.");
    if (l.isActive === active) return { name: l.name };
    if (!active) {
      if (l.openSession) throw new AppError(`Someone is at ${l.name} — clear the table first.`, "CONFLICT");
      const open = await tx.restaurantOrder.count({ where: { locationId: id, status: OPEN } });
      if (open) throw new AppError(`${l.name} has ${open} open order${open === 1 ? "" : "s"} — finish or move them first.`, "CONFLICT");
      const booked = await tx.tableReservation.count({ where: { locationId: id, status: { in: ["BOOKED", "CONFIRMED"] }, reservedFor: { gte: new Date(now.getTime() - HOLD_AFTER_MIN * 60_000) } } });
      if (booked) throw new AppError(`${l.name} has ${booked} reservation${booked === 1 ? "" : "s"} coming — move ${booked === 1 ? "it" : "them"} to another table first.`, "CONFLICT");
    }
    await tx.restaurantLocation.update({ where: { id }, data: { isActive: active, qrActive: active } });
    await audit(tx, actor, {
      action: active ? "restaurant_table.enabled" : "restaurant_table.disabled", entityType: "RestaurantLocation", entityId: id,
      before: { place: l.name, inUse: l.isActive }, after: { place: l.name, inUse: active, ...(why && { reason: why }) },
    });
    return { name: l.name };
  });
}

/**
 * Block a table for now — UNAVAILABLE (kept for an event, wobbly…) or MAINTENANCE (being fixed) — or
 * reopen it. It stays on the floor, marked, but nobody can be seated or order from its QR until it
 * is reopened. Only an empty table can be blocked; reservations coming are reported back.
 */
export async function setTableBlocked(id: string, as: "UNAVAILABLE" | "MAINTENANCE" | null, reason: string | null, actor: Actor, now = new Date()) {
  if (!runsFloor(actor)) throw new AppError("Only a manager or the MD blocks or reopens tables.", "FORBIDDEN");
  const why = reason?.trim() ?? "";
  if (as && why.length < 3) throw new AppError("Say why (e.g. broken chair, kept for a group at 8).", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "restaurant_locations" WHERE "id" = ${id} FOR UPDATE`;
    const l = await tx.restaurantLocation.findUnique({ where: { id }, include: { openSession: { select: { id: true, guest: { select: { fullName: true } } } } } });
    if (!l || !l.isActive) throw new AppError("Table not found.", "NOT_FOUND");
    if (l.kind !== "TABLE") throw new AppError("Only tables can be blocked.");
    if (as && l.openSession) throw new AppError(`${l.openSession.guest.fullName} is at ${l.name} — move them or clear the table first.`, "CONFLICT");
    const booked = as ? await tx.tableReservation.count({ where: { locationId: id, status: { in: ["BOOKED", "CONFIRMED"] }, reservedFor: { gte: new Date(now.getTime() - HOLD_AFTER_MIN * 60_000) } } }) : 0;
    await tx.restaurantLocation.update({ where: { id }, data: as ? { blockedAs: as, blockedReason: why, blockedAt: now, blockedById: actor.userId ?? null } : { blockedAs: null, blockedReason: null, blockedAt: null, blockedById: null } });
    await audit(tx, actor, {
      action: as ? "restaurant_table.blocked" : "restaurant_table.reopened", entityType: "RestaurantLocation", entityId: id,
      before: { place: l.name, blocked: l.blockedAs, reason: l.blockedReason }, after: { place: l.name, blocked: as, reason: as ? why : null },
    });
    return { name: l.name, reservationsComing: booked };
  });
}

/** Tables switched off (to switch back on). */
export async function tablesSwitchedOff() {
  return db.restaurantLocation.findMany({ where: { kind: "TABLE", isActive: false }, orderBy: [{ area: "asc" }, { number: "asc" }], select: { id: true, name: true } });
}

// ───────────────────────── Scanning & ordering (public) ─────────────────────────

/** The place behind a scanned QR (null: unknown / regenerated / removed). Counts the scan. */
export async function scanLocationQr(token: string, now = new Date()) {
  if (!TOKEN.test(token)) return null;
  const l = await db.restaurantLocation.findUnique({ where: { qrToken: token }, select: { id: true, kind: true, area: true, number: true, name: true, qrActive: true, isActive: true } });
  if (!l || !l.isActive) return null;
  if (l.qrActive) await db.restaurantLocation.update({ where: { id: l.id }, data: { scanCount: { increment: 1 }, lastScannedAt: now } });
  return l;
}

export async function activeLocation(token: string) {
  if (!TOKEN.test(token)) throw new AppError("This QR code is not valid — please ask a waiter.", "VALIDATION");
  const l = await db.restaurantLocation.findUnique({ where: { qrToken: token } });
  if (!l || !l.isActive || !l.qrActive) throw new AppError("This QR code is not active — please ask a waiter.", "VALIDATION");
  if (l.blockedAs) throw new AppError("This table is not available right now — please ask a waiter for another table.", "VALIDATION");
  return l;
}

/**
 * The customer says who they are (name + phone): a returning customer is found by phone —
 * never saved twice — and, if they already have an open order at this place, they can add
 * to it instead of starting another.
 */
export async function identifyAtLocation(token: string, input: { phone: string }) {
  const l = await activeLocation(token);
  if (!validPhone(input.phone)) throw new AppError("Please enter a phone number we can reach you on (e.g. 0712 345 678).", "VALIDATION", { phone: "Invalid" });
  const phone = normalizePhone(input.phone)!;
  const [known, open] = await Promise.all([
    db.guest.findFirst({ where: { phone }, orderBy: { updatedAt: "desc" }, select: { fullName: true } }),
    l.kind === "MAIN" ? null : db.restaurantOrder.findFirst({
      where: { locationId: l.id, customerPhone: phone, status: { notIn: [...CLOSED_STATUSES, "READY", "OUT_FOR_DELIVERY"] } },
      orderBy: { createdAt: "desc" },
      select: { number: true, total: true, trackToken: true, items: { select: { quantity: true } } },
    }),
  ]);
  return {
    returning: !!known,
    /** A returning customer, greeted by name — first name and initials only. */
    name: known?.fullName.trim() ? shortName(known.fullName) : null,
    active: open?.trackToken ? { number: open.number, total: open.total, track: open.trackToken, items: open.items.reduce((t, i) => t + i.quantity, 0) } : null,
  };
}

const ORDER_LIMIT = 5; // orders per phone per 30 minutes from the restaurant QRs

export interface LocationOrderInput {
  clientKey: string;
  items: { menuItemId: string; quantity: number }[];
  notes?: string | null;
  /** Blank for a returning customer: the name we have for their phone is used. */
  name?: string | null;
  /** Not needed at a table: the seated customer's own details are used. */
  phone?: string | null;
  /** At a table: the phone's private seat (it said who it is when the customer sat down). */
  seatToken?: string | null;
  email?: string | null;
  /** Eat here, or take out (delivered to `deliveryAddress`); pickup only from the main restaurant QR. */
  kind?: "DINE_IN" | "TAKEAWAY" | "PICKUP";
  /** Take out: where to deliver it. */
  deliveryAddress?: string | null;
  /** Take out is paid first: the customer's payment screenshot and the account they paid. */
  paidFirst?: PaidFirst | null;
  /** Main restaurant QR only: where they are sitting, if they want to say. */
  where?: string | null;
}

/**
 * An order from a table / counter / main restaurant QR — into the one order engine, for that place.
 * At a table it is part of the seated customer's session (their table, their bill) — only a phone
 * that said who it is at this table can order there.
 */
export async function placeLocationOrder(token: string, input: LocationOrderInput, now = new Date()) {
  const l = await activeLocation(token);
  const settings = await getSettings();
  if (!settings.publicOrderingEnabled) throw new AppError(`Ordering from the QR is closed right now — please ask a waiter${settings.phone ? ` or call ${prettyPhone(settings.phone)}` : ""}.`);
  // At a table or the counter: eat here (on the bill, or paid now). Take out only from the restaurant's own QR (and the website).
  if (input.kind === "TAKEAWAY" && l.kind !== "MAIN") throw new AppError("Take out is ordered from the restaurant's own QR code or our website — here you can add it to your bill or pay now.", "VALIDATION", { kind: "Not here" });
  const seated = l.kind === "TABLE" ? await seatOf(input.seatToken) : null;
  if (l.kind === "TABLE" && (!seated || !OPEN_SESSION.includes(seated.member.session.status))) {
    throw new AppError("Please tell us who you are first — then order as often as you like.", "CONFLICT", { seat: "Required" });
  }
  const typedPhone = seated?.member.guest.phone ?? input.phone ?? "";
  if (!seated && !input.name?.trim() && !validPhone(typedPhone)) throw new AppError("Please enter your name.", "VALIDATION", { name: "Required" });
  if (!validPhone(typedPhone)) throw new AppError("Please enter a phone number we can reach you on (e.g. 0712 345 678).", "VALIDATION", { phone: "Invalid" });
  const name = seated ? seated.member.guest.fullName : await orderCustomerName(input.name, typedPhone);
  if (!input.items.length || input.items.length > 30) throw new AppError("Add something from the menu.", "VALIDATION");
  const same = await db.restaurantOrder.findUnique({ where: { clientKey: input.clientKey } });
  if (same) return same;
  const phone = normalizePhone(typedPhone)!;
  const kind = input.kind === "TAKEAWAY" ? "TAKEAWAY" : input.kind === "PICKUP" && l.kind === "MAIN" ? "PICKUP" : "DINE_IN";
  const address = kind === "TAKEAWAY" ? input.deliveryAddress?.trim().slice(0, 200) ?? "" : "";
  if (kind === "TAKEAWAY" && address.length < 5) throw new AppError("Please add the delivery address — street, house or building, and a landmark.", "VALIDATION", { deliveryAddress: "Required" });
  const where = l.kind === "MAIN" && kind === "DINE_IN" ? input.where?.trim().slice(0, 40) || null : null;

  try {
    return await db.$transaction(async (tx) => {
      const recent = await tx.restaurantOrder.count({ where: { customerPhone: phone, source: { in: Object.values(LOCATION_SOURCE) }, createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } } });
      if (recent >= ORDER_LIMIT) throw new AppError("You have sent several orders just now — please ask a waiter for more.", "VALIDATION");
      // Take out is always paid first; eating here may be paid now too.
      const paidFirst = kind === "TAKEAWAY" || input.paidFirst ? await paidFirstTx(tx, input.paidFirst, now) : null;
      // At a table: the session must still be open (it could have been paid and closed a moment ago).
      const session = seated ? seated.member.session : null;
      if (session) {
        await lockSessionTx(tx, session.id);
        const live = await tx.diningSession.findUnique({ where: { id: session.id }, select: { status: true, locationId: true } });
        if (!live || !OPEN_SESSION.includes(live.status)) throw new AppError("Your table's order has ended — please tell us who you are to start again.", "CONFLICT", { seat: "Required" });
        session.locationId = live.locationId;
      }
      const guestId = seated ? seated.member.guest.id : await resolveGuest(tx, { fullName: name, phone, email: input.email?.trim() || null });
      return createRestaurantOrderTx(tx, {
        type: kind, settlement: "UNPAID", items: input.items, notes: input.notes?.trim().slice(0, 300) || null, customerName: name,
        // Take out is not at the table: it does not keep the table busy or join its bill. A moved customer's order goes to their table now.
        locationId: kind === "TAKEAWAY" ? null : session?.locationId ?? l.id, tableLabel: where, deliveryAddress: address || null,
      }, { userId: null, label: `${name} (${l.name})` }, now, {
        byCustomer: true, source: LOCATION_SOURCE[l.kind], guestId, customerPhone: phone, customerEmail: (seated?.member.guest.email ?? input.email)?.trim() || null, clientKey: input.clientKey, paidFirst,
        sessionId: session?.id ?? null,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await db.restaurantOrder.findUnique({ where: { clientKey: input.clientKey } });
      if (again) return again;
    }
    throw e;
  }
}

/**
 * The customer adds more to their own open order from their private order link (/order/<token>):
 * any order — room, table, counter, website. The same order, its history kept; the kitchen
 * gets the new round.
 */
export async function addItemsByTrackToken(token: string, items: { menuItemId: string; quantity: number }[], now = new Date()) {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(token)) throw new AppError("Order not found.", "NOT_FOUND");
  if (!items.length || items.length > 30) throw new AppError("Add something from the menu.", "VALIDATION");
  const settings = await getSettings();
  if (!settings.publicOrderingEnabled) throw new AppError("Ordering is closed right now — please ask a waiter.");
  const o = await db.restaurantOrder.findUnique({ where: { trackToken: token }, select: { id: true, customerName: true } });
  if (!o) throw new AppError("Order not found.", "NOT_FOUND");
  return db.$transaction((tx) => addOrderItemsTx(tx, o.id, items, { userId: null, label: `${o.customerName ?? "Customer"} (online)` }, now, { byCustomer: true }));
}
