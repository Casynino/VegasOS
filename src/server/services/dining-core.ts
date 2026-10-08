import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import type { DiningSessionStatus, RestaurantOrderStatus } from "@/generated/prisma/enums";
import { audit } from "../audit";
import { AppError } from "../errors";
import { msgf } from "@/i18n/msg";
import { getSettingsTx, stayConfig } from "../settings";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import type { Actor } from "./reservations";
import { worksWaiterShift } from "@/lib/permissions";
import { ensureWaiterShiftTx } from "./waiter-shift-core";

/**
 * TABLE DINING SESSIONS — the heart of it, shared with the order engine.
 *
 * The table and its QR are permanent; a customer's time at the table is a session: it starts
 * when they sit (they scanned the QR and said who they are, or a waiter seated them), every
 * order they place there belongs to it, and it ends only when staff clear the table after the
 * customer has left — and only once the whole bill is paid. Never by itself: not when food is
 * served, the menu is closed, nobody touches the phone — not even when the bill is paid. Then
 * the table is free and the next customer gets a new session; the old one stays in history.
 *
 * One open session per table: every start / move locks the table's row first, and the database
 * refuses a second one anyway (`openAtId` is unique and only set while the session is open).
 */

type Tx = Prisma.TransactionClient;

export const OPEN_SESSION: DiningSessionStatus[] = ["ACTIVE", "AWAITING_PAYMENT", "PAID"];
/** Orders still with the kitchen or the waiter — not yet at the table. */
export const IN_SERVICE: RestaurantOrderStatus[] = ["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
/** A reservation holds its table from an hour before its time until half an hour after (then: late — no-show?). */
export const HOLD_BEFORE_MIN = 60;
export const HOLD_AFTER_MIN = 30;

export type SessionSource = "QR" | "STAFF" | "RESERVATION" | "ORDER";
const SOURCE_NOTE: Record<SessionSource, string> = {
  QR: "Scanned the QR and started at", STAFF: "Seated by staff at", RESERVATION: "Reservation seated at", ORDER: "First order placed at",
};

/** Who did it, for the session's timeline: a staff member, or the customer. */
export const sessionBy = (actor: Actor | null) =>
  actor?.userId ? { byId: actor.userId, byLabel: actor.label ?? null } : { byId: null, byLabel: actor?.label ?? "Customer" };
const auditActor = (actor: Actor | null) => actor ?? { userId: null, label: "Customer" };

export async function lockLocationTx(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "restaurant_locations" WHERE "id" = ${id} FOR UPDATE`;
}
export async function lockSessionTx(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "dining_sessions" WHERE "id" = ${id} FOR UPDATE`;
}

export async function sessionEventTx(tx: Tx, sessionId: string, kind: string, note: string | null, actor: Actor | null, at: Date) {
  await tx.diningSessionEvent.create({ data: { sessionId, kind, note, ...sessionBy(actor), at } });
}

async function nextSessionNumber(tx: Tx, year: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('dining_session_number'))::text`;
  const last = await tx.diningSession.findFirst({ where: { number: { startsWith: `TS-${year}-` } }, orderBy: { number: "desc" }, select: { number: true } });
  return `TS-${year}-${String(last ? Number(last.number.slice(8)) + 1 : 1).padStart(4, "0")}`;
}

/** "TS-2026-0012" → "#12" */
export const sessionNo = (number: string) => `#${number.replace(/^TS-\d{4}-0*/, "")}`;

/** The reservation holding a table at a moment (due within the hour, or up to half an hour late), if any. */
export async function holdingReservationTx(tx: Tx, locationId: string, now: Date, exceptId?: string | null) {
  return tx.tableReservation.findFirst({
    where: {
      locationId, status: { in: ["BOOKED", "CONFIRMED"] }, ...(exceptId ? { id: { not: exceptId } } : {}),
      reservedFor: { gte: new Date(now.getTime() - HOLD_AFTER_MIN * 60_000), lte: new Date(now.getTime() + HOLD_BEFORE_MIN * 60_000) },
    },
    orderBy: { reservedFor: "asc" },
    select: { id: true, reference: true, reservedFor: true, guestCount: true, guestId: true, guest: { select: { fullName: true, phone: true } } },
  });
}

export const reservedMessage = (name: string, place: string, at: Date, tz: string) =>
  `${place} is reserved for ${name} at ${reservedTime(at, tz)}.`;
/** A reservation's time of day in hotel time ("19:30" — the same in every language). */
export const reservedTime = (at: Date, tz: string) => at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });

/** "Table 4 is under maintenance (broken leg) — …": why a blocked table cannot be used, in the reader's language. */
function blockedTableMessage(l: { name: string; blockedAs: string | null; blockedReason: string | null }) {
  const vars = { table: l.name, reason: l.blockedReason };
  if (l.blockedAs === "MAINTENANCE") {
    return l.blockedReason
      ? msgf("{table} is under maintenance ({reason}) — choose another table, or a manager reopens it.", vars)
      : msgf("{table} is under maintenance — choose another table, or a manager reopens it.", vars);
  }
  return l.blockedReason
    ? msgf("{table} is not available ({reason}) — choose another table, or a manager reopens it.", vars)
    : msgf("{table} is not available — choose another table, or a manager reopens it.", vars);
}

export type StartSession = {
  locationId: string; guestId: string; guestCount?: number | null; source: SessionSource;
  reservationId?: string | null; notes?: string | null;
  /** Staff chose to seat someone at a table that is reserved soon. */
  override?: boolean;
};

/**
 * A customer sits down: their session starts at a free table. The table is locked first, so two
 * people can never put two customers at the same table at the same moment; a table reserved
 * within the hour is refused unless staff say otherwise (or it is that reservation).
 */
export async function startSessionTx(tx: Tx, input: StartSession, actor: Actor | null, now: Date) {
  await lockLocationTx(tx, input.locationId);
  const l = await tx.restaurantLocation.findUnique({ where: { id: input.locationId }, include: { openSession: { select: { id: true, guest: { select: { fullName: true } } } } } });
  if (!l || !l.isActive) throw new AppError("That table is not in use — choose another.", "VALIDATION", { locationId: "Inactive" });
  if (l.kind !== "TABLE") throw new AppError("Only tables have a customer's session — the counter and the restaurant QR order as before.", "VALIDATION", { locationId: "Not a table" });
  if (l.blockedAs) throw new AppError(blockedTableMessage(l), "CONFLICT", { locationId: "Blocked" });
  if (l.openSession) throw new AppError(msgf("{table} already has a customer ({name}) — choose another table, or add them to that table.", { table: l.name, name: l.openSession.guest.fullName }), "CONFLICT", { locationId: "Occupied" });
  const count = input.guestCount ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 60) throw new AppError("How many people? 1 to 60.", "VALIDATION", { guestCount: "Invalid" });
  const settings = await getSettingsTx(tx);
  if (input.source !== "RESERVATION" && !input.override) {
    const held = await holdingReservationTx(tx, l.id, now);
    if (held) throw new AppError(msgf("{table} is reserved for {name} at {time}. Seat them there, choose another table — or seat anyway.", { table: l.name, name: held.guest.fullName, time: reservedTime(held.reservedFor, settings.timezone) }), "CONFLICT", { locationId: "Reserved" });
  }
  const bd = businessDateOf(now, stayConfig(settings));
  // The table's waiter serves them — or, at a table nobody has, the waiter seating them.
  const seatedByWaiter = !l.waiterId && !!actor?.userId && !!actor.permissions && worksWaiterShift(actor.permissions);
  const waiterId = l.waiterId ?? (seatedByWaiter ? actor!.userId! : null);
  const s = await tx.diningSession.create({
    data: {
      number: await nextSessionNumber(tx, bd.slice(0, 4)), locationId: l.id, openAtId: l.id, guestId: input.guestId, guestCount: count, waiterId,
      source: input.source, tableReservationId: input.reservationId ?? null, notes: input.notes?.trim().slice(0, 300) || null,
      businessDate: toDbDate(bd), startedAt: now, startedById: actor?.userId ?? null,
      members: { create: { guestId: input.guestId, primary: true, addedById: actor?.userId ?? null, addedAt: now } },
      events: { create: { kind: "STARTED", note: `${SOURCE_NOTE[input.source]} ${l.name}${count > 1 ? ` · ${count} people` : ""}`, ...sessionBy(actor), at: now } },
    },
  });
  if (seatedByWaiter) {
    const deviceUserId = (actor as { deviceUserId?: string | null }).deviceUserId ?? null;
    await tx.waiterAssignment.create({ data: { scope: "TABLE", locationId: l.id, kind: "TAKEN", via: deviceUserId ? "PIN" : "SELF", toUserId: waiterId, byId: actor!.userId!, byLabel: actor!.label ?? null, byRole: actor!.role ?? null, deviceUserId, at: now } });
    await ensureWaiterShiftTx(tx, waiterId!, actor!, now, `seated a customer at ${l.name}`);
  }
  await audit(tx, auditActor(actor), {
    action: "dining_session.started", entityType: "DiningSession", entityId: s.id,
    after: { number: s.number, table: l.name, guest: input.guestId, guests: count, source: input.source, reservation: input.reservationId ?? null, override: !!input.override },
  });
  return s;
}

/**
 * A staff order at a table: it joins the customer's session there — or, at a free table, starts
 * one for the order's customer. The person ordering joins the table if they are not on it yet.
 */
export async function sessionForTableOrderTx(tx: Tx, locationId: string, guestId: string, actor: Actor, now: Date) {
  await lockLocationTx(tx, locationId);
  const open = await tx.diningSession.findUnique({ where: { openAtId: locationId }, select: { id: true } });
  if (!open) return (await startSessionTx(tx, { locationId, guestId, source: "ORDER" }, actor, now)).id;
  const member = await tx.diningSessionMember.findUnique({ where: { sessionId_guestId: { sessionId: open.id, guestId } } });
  if (!member) {
    const g = await tx.guest.findUnique({ where: { id: guestId }, select: { fullName: true } });
    await tx.diningSessionMember.create({ data: { sessionId: open.id, guestId, addedById: actor.userId ?? null, addedAt: now } });
    await sessionEventTx(tx, open.id, "MEMBER_ADDED", `${g?.fullName ?? "A customer"} joined the table (ordered)`, actor, now);
  }
  return open.id;
}

/** They ordered more after asking for the bill (or after paying): the session is open for ordering again. */
export async function sessionOrderedTx(tx: Tx, sessionId: string, actor: Actor | null, now: Date) {
  const s = await tx.diningSession.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!s || s.status === "ACTIVE" || !OPEN_SESSION.includes(s.status)) return;
  await tx.diningSession.update({ where: { id: sessionId }, data: { status: "ACTIVE", billRequestedAt: null } });
  await sessionEventTx(tx, sessionId, "REOPENED", "Ordered more — the bill is open again", actor, now);
}

/** A session's money from its orders (never stored twice): total, paid, on a room bill, still to pay. */
export function sessionMoney(orders: { status: string; settlement: string; total: number; paidAmount: number }[]) {
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const sum = (f: (o: (typeof live)[number]) => number) => live.reduce((t, o) => t + f(o), 0);
  return {
    orders: live.length,
    total: sum((o) => o.total),
    paid: sum((o) => (o.settlement === "ROOM" ? 0 : Math.min(o.paidAmount, o.total))),
    onRoom: sum((o) => (o.settlement === "ROOM" ? o.total : 0)),
    due: sum((o) => (o.settlement === "ROOM" ? 0 : Math.max(0, o.total - o.paidAmount))),
    serving: live.filter((o) => IN_SERVICE.includes(o.status as RestaurantOrderStatus)).length,
  };
}

/**
 * After a payment, a delivery, a cancellation or a change on one of its orders: once the bill is
 * asked for, a session with nothing left to pay is PAID (money due again → back to waiting for
 * the payment). It NEVER ends by itself — not even when paid: a waiter or reception clears the
 * table once they have seen the customer leave (`closeSession`), and only when nothing is due.
 */
export async function refreshSessionTx(tx: Tx, sessionId: string, actor: Actor | null, now: Date) {
  await lockSessionTx(tx, sessionId);
  const s = await tx.diningSession.findUnique({
    where: { id: sessionId },
    include: { orders: { select: { status: true, settlement: true, total: true, paidAmount: true } }, location: { select: { name: true } } },
  });
  if (!s || !OPEN_SESSION.includes(s.status) || s.status === "ACTIVE") return s;
  const m = sessionMoney(s.orders);
  if (m.due > 0) {
    if (s.status === "PAID") {
      await tx.diningSession.update({ where: { id: s.id }, data: { status: "AWAITING_PAYMENT" } });
      await sessionEventTx(tx, s.id, "BILL_REQUESTED", `TZS ${m.due.toLocaleString("en-US")} to pay again`, actor, now);
    }
    return s;
  }
  if (m.orders > 0 && s.status !== "PAID") {
    await tx.diningSession.update({ where: { id: s.id }, data: { status: "PAID", paidAt: s.paidAt ?? now } });
    await sessionEventTx(tx, s.id, "PAID", `${m.onRoom ? (m.paid ? "Paid, the rest on the room bill" : "All on the room bill") : "Paid in full"} — clear the table when they leave`, actor, now);
  }
  return s;
}

/** The session ends: the table is released, history kept (orders, payments, moves, timeline). */
export async function endSessionTx(tx: Tx, s: { id: string; number: string; status: DiningSessionStatus; paidAt: Date | null }, to: "CLOSED" | "CANCELLED", note: string, actor: Actor | null, now: Date) {
  const done = await tx.diningSession.update({
    where: { id: s.id },
    data: { status: to, openAtId: null, closedAt: now, closedById: actor?.userId ?? null, closeNote: note.slice(0, 300), ...(to === "CLOSED" ? { paidAt: s.paidAt ?? now } : {}) },
  });
  await sessionEventTx(tx, s.id, to, note, actor, now);
  await audit(tx, auditActor(actor), { action: to === "CLOSED" ? "dining_session.closed" : "dining_session.cancelled", entityType: "DiningSession", entityId: s.id, before: { status: s.status }, after: { status: to, note } });
  return done;
}

// ───────────────────────── The customer's seat (their phone, remembered) ─────────────────────────

/** A private, httpOnly cookie: this phone said who it is at a table — not asked again while the session lasts. */
export const SEAT_COOKIE = "vegas_seat";
export const SEAT_HOURS = 16;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const SEAT = /^[A-Za-z0-9_-]{32,64}$/;

export async function issueSeatTx(tx: Tx, memberId: string) {
  const token = randomBytes(24).toString("base64url");
  await tx.diningSeat.create({ data: { memberId, tokenHash: sha(token) } });
  return token;
}

/** The person (and their session) behind a seat cookie — null when unknown. */
export async function seatOf(token: string | null | undefined) {
  if (!token || !SEAT.test(token)) return null;
  return db.diningSeat.findUnique({
    where: { tokenHash: sha(token) },
    include: {
      member: {
        include: {
          guest: { select: { id: true, fullName: true, phone: true, email: true } },
          session: { select: { id: true, number: true, status: true, locationId: true, location: { select: { name: true } } } },
        },
      },
    },
  });
}
