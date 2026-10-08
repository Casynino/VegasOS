import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { msg, msgf } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import { englishT, type T } from "@/i18n/translate";
import { getSettingsTx, stayConfig } from "../settings";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import { worksWaiterShift } from "@/lib/permissions";
import { OPEN_SESSION } from "./dining-core";
import { awaitsOnlinePayment, CLOSED_STATUSES, waitersToAssign } from "./restaurant";
import { setOrderWaiterTx, setRoomWaiterTx, setTableWaiterTx, shortOrder, type AssignActor, type AssignVia } from "./assignments";
import { ensureWaiterShiftTx, lockWaiterTx, openWaiterShiftTx } from "./waiter-shift-core";

/**
 * ONE RESTAURANT, MANY WAITERS — what each waiter is responsible for, and how it changes hands.
 *
 * Every open order has one waiter (RestaurantOrder.assignedToId). A waiter takes charge of an order
 * or a table — on their own phone, or with their PIN on the shared restaurant screen — hands work to
 * a colleague on shift (always with the reason), and closes their shift only when nothing is left
 * with them. A manager hands, moves and closes anything. Every change lands in the assignment
 * history (waiter_assignments), the order's / table's timeline and the audit; the kitchen never
 * changes who serves.
 */

type Tx = Prisma.TransactionClient;
export type WorkActor = AssignActor & { permissions?: ReadonlySet<string> };

const decides = (a: WorkActor) => ["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => a.permissions?.has(p));
const isWaiter = (a: WorkActor) => !!a.userId && !!a.permissions && worksWaiterShift(a.permissions);
const how = (a: WorkActor): AssignVia => (a.deviceUserId ? "PIN" : decides(a) ? "MANAGER" : "SELF");
const first = (n: string | null | undefined) => n?.replace(/\s*\(.*\)/, "") ?? "";
/** The translator for whoever is acting (English outside a request — jobs, tests). */
const actorT = () => getT().catch(() => englishT);

function needReason(reason: string | null | undefined) {
  const why = reason?.trim() ?? "";
  if (why.length < 3) throw new AppError("Say why you transfer it (e.g. going on break, end of shift, other section).", "VALIDATION", { reason: "Required" });
  return why;
}

/** The one receiving work: a waiter (not the screen, not management) — and, unless a manager hands it, on shift. */
async function receiverTx(tx: Tx, toUserId: string, actor: WorkActor, fromUserId?: string | null) {
  const w = (await waitersToAssign()).find((x) => x.id === toUserId);
  if (!w) throw new AppError("Choose one of the waiters.", "VALIDATION", { waiter: "Invalid" });
  if (fromUserId && fromUserId === toUserId) throw new AppError(msgf("It is already {name}'s.", { name: first(w.name) }), "VALIDATION", { waiter: "Same" });
  await lockWaiterTx(tx, toUserId, fromUserId);
  if (!decides(actor) && !(await openWaiterShiftTx(tx, toUserId))) {
    throw new AppError(msgf("{name} is not on shift — they start their shift first (or a manager hands it to them).", { name: first(w.name) }), "CONFLICT", { waiter: "Off shift" });
  }
  return w;
}

// ─── Take charge ────────────────────────────────────────────────────────────

/**
 * "This one is mine": a waiter takes charge of an order nobody has — on their phone, or with their
 * PIN on the restaurant screen. A table's first order brings the table (its customer and their other
 * orders nobody has) with it. Starts the waiter's shift if it is not running yet.
 */
export async function takeChargeOfOrder(orderId: string, actor: WorkActor, now = new Date()) {
  if (!isWaiter(actor)) throw new AppError("Only a waiter can serve an order.", "FORBIDDEN");
  const me = actor.userId!;
  const via = actor.deviceUserId ? "PIN" : "SELF";
  return db.$transaction(async (tx) => {
    await lockWaiterTx(tx, me);
    const o = await tx.restaurantOrder.findUnique({ where: { id: orderId }, select: { id: true, number: true, assignedToId: true, sessionId: true, locationId: true, status: true } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    if (o.assignedToId === me) return { number: o.number, table: null as string | null, already: true };
    await setOrderWaiterTx(tx, o.id, me, actor, now, { kind: "TAKEN", via, expectFrom: null });
    let table: string | null = null;
    if (o.sessionId && o.locationId) {
      const s = await tx.diningSession.findUnique({ where: { id: o.sessionId }, select: { waiterId: true, status: true } });
      if (s && !s.waiterId && OPEN_SESSION.includes(s.status)) table = (await setTableWaiterTx(tx, o.locationId, me, actor, now, { kind: "TAKEN", via, expectFrom: null, standing: false })).table;
    }
    await ensureWaiterShiftTx(tx, me, actor, now, `serving ${shortOrder(o.number)}`);
    return { number: o.number, table, already: false };
  });
}

/** A waiter takes charge of a table nobody has: its customer now and their orders nobody has. */
export async function takeChargeOfTable(locationId: string, actor: WorkActor, now = new Date()) {
  if (!isWaiter(actor)) throw new AppError("Only a waiter can serve a table.", "FORBIDDEN");
  const me = actor.userId!;
  return db.$transaction(async (tx) => {
    await lockWaiterTx(tx, me);
    const r = await setTableWaiterTx(tx, locationId, me, actor, now, { kind: "TAKEN", via: actor.deviceUserId ? "PIN" : "SELF", expectFrom: null, standing: false });
    await ensureWaiterShiftTx(tx, me, actor, now, `serving ${r.table}`);
    return { table: r.table, orders: r.orders };
  });
}

// ─── Transfers ──────────────────────────────────────────────────────────────

/** Hand one order to a colleague — by the waiter who has it, or a manager. Always with the reason. */
export async function transferOrder(orderId: string, toUserId: string, reason: string, actor: WorkActor, now = new Date()) {
  const why = needReason(reason);
  return db.$transaction(async (tx) => {
    const o = await tx.restaurantOrder.findUnique({ where: { id: orderId }, select: { number: true, assignedToId: true } });
    if (!o) throw new AppError("Order not found.", "NOT_FOUND");
    if (!decides(actor) && o.assignedToId !== actor.userId) throw new AppError(o.assignedToId ? msg("Only the waiter serving this order (or a manager) can transfer it.") : msg("Nobody is serving this order yet — serve it yourself instead."), "FORBIDDEN");
    const w = await receiverTx(tx, toUserId, actor, o.assignedToId);
    await setOrderWaiterTx(tx, orderId, toUserId, actor, now, { kind: "TRANSFER", via: how(actor), reason: why, expectFrom: o.assignedToId });
    return { number: o.number, to: w.name };
  });
}

/** Hand a table to a colleague: its customer, their open orders (and the table itself, if it was yours). */
export async function transferTable(locationId: string, toUserId: string, reason: string, actor: WorkActor, now = new Date()) {
  const why = needReason(reason);
  return db.$transaction(async (tx) => {
    const l = await tx.restaurantLocation.findUnique({ where: { id: locationId }, select: { name: true, waiterId: true, openSession: { select: { waiterId: true, status: true } } } });
    if (!l) throw new AppError("Table not found.", "NOT_FOUND");
    const from = l.openSession && OPEN_SESSION.includes(l.openSession.status) ? l.openSession.waiterId : l.waiterId;
    if (!decides(actor) && from !== actor.userId) throw new AppError(from ? msgf("Only the waiter serving {table} (or a manager) can transfer it.", { table: l.name }) : msgf("Nobody is serving {table} yet — serve it yourself instead.", { table: l.name }), "FORBIDDEN");
    const w = await receiverTx(tx, toUserId, actor, from);
    const r = await setTableWaiterTx(tx, locationId, toUserId, actor, now, { kind: "TRANSFER", via: how(actor), reason: why, expectFrom: from });
    return { table: r.table, to: w.name, orders: r.orders };
  });
}

/** Hand a room's room service to a colleague: your open orders for that room (and the room, if it was yours). */
export async function transferRoomService(roomNumber: string, toUserId: string, reason: string, actor: WorkActor, now = new Date(), fromUserId?: string | null) {
  const why = needReason(reason);
  const from = decides(actor) ? (fromUserId ?? (await db.room.findUnique({ where: { number: roomNumber }, select: { serviceWaiterId: true } }))?.serviceWaiterId ?? null) : actor.userId;
  if (!from) throw new AppError(msgf("No waiter has room {room}'s room service — hand it to someone instead.", { room: roomNumber }));
  return db.$transaction(async (tx) => {
    const w = await receiverTx(tx, toUserId, actor, from);
    const r = await setRoomWaiterTx(tx, roomNumber, from, toUserId, actor, now, { kind: "TRANSFER", via: how(actor), reason: why });
    if (!r.changed) throw new AppError(from === actor.userId ? msgf("Nothing of room {room} is yours to transfer.", { room: roomNumber }) : msgf("Nothing of room {room} is theirs to transfer.", { room: roomNumber }));
    return { room: roomNumber, to: w.name, orders: r.orders };
  });
}

/**
 * Everything one waiter has goes to another, in one step that cannot stop half way: their tables
 * (customers and standing), rooms, and every other open order. One batch in the history.
 */
async function transferAllTx(tx: Tx, fromUserId: string, toUserId: string, actor: WorkActor, now: Date, meta: { via: AssignVia; reason: string; batchId: string }) {
  const m = { kind: "TRANSFER" as const, via: meta.via, reason: meta.reason, batchId: meta.batchId };
  let tables = 0, rooms = 0, orders = 0;
  const sessionTables = await tx.diningSession.findMany({ where: { waiterId: fromUserId, status: { in: OPEN_SESSION } }, select: { locationId: true } });
  const standing = await tx.restaurantLocation.findMany({ where: { waiterId: fromUserId }, select: { id: true } });
  for (const id of [...new Set([...sessionTables.map((s) => s.locationId), ...standing.map((l) => l.id)])].sort()) {
    const r = await setTableWaiterTx(tx, id, toUserId, actor, now, { ...m, fromUserId });
    if (r.changed) { tables++; orders += r.orders; }
  }
  const roomOrders = await tx.restaurantOrder.findMany({ where: { assignedToId: fromUserId, type: "ROOM_SERVICE", status: { notIn: CLOSED_STATUSES } }, select: { roomNumber: true } });
  const standingRooms = await tx.room.findMany({ where: { serviceWaiterId: fromUserId }, select: { number: true } });
  const numbers = new Set([...standingRooms.map((r) => r.number), ...roomOrders.flatMap((o) => (o.roomNumber ?? "").split(",").map((x) => x.trim()).filter(Boolean))]);
  for (const n of [...numbers].sort()) {
    const r = await setRoomWaiterTx(tx, n, fromUserId, toUserId, actor, now, m);
    if (r.changed) { rooms++; orders += r.orders; }
  }
  const rest = await tx.restaurantOrder.findMany({ where: { assignedToId: fromUserId, status: { notIn: CLOSED_STATUSES } }, select: { id: true }, orderBy: { id: "asc" } });
  for (const o of rest) if ((await setOrderWaiterTx(tx, o.id, toUserId, actor, now, { ...m, expectFrom: fromUserId })).changed) orders++;
  const left = await responsibilitiesTx(tx, fromUserId);
  if (left.blocking) throw new AppError("Some work could not be handed over — refresh and try again.", "CONFLICT");
  return { tables, rooms, orders };
}

/** A waiter hands everything they have to a colleague (e.g. to close their shift) — or a manager does it for them. */
export async function transferAllResponsibilities(fromUserId: string, toUserId: string, reason: string, actor: WorkActor, now = new Date()) {
  const why = needReason(reason);
  if (!decides(actor) && fromUserId !== actor.userId) throw new AppError("You can hand over only your own work.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const w = await receiverTx(tx, toUserId, actor, fromUserId);
    const r = await transferAllTx(tx, fromUserId, toUserId, actor, now, { via: how(actor), reason: why, batchId: randomUUID() });
    return { ...r, to: w.name };
  }, { timeout: 30_000 });
}

// ─── What a waiter has ──────────────────────────────────────────────────────

/**
 * Served, and paid online with nothing left to collect from the customer (or still waiting for the Counter's check of
 * the proof): done for the waiter. Money still due on it (items added later, a reversed payment) stays theirs.
 */
export const servedAndPaidOnline = (o: { status: string; paymentProofFileId: string | null; paidAmount: number; total: number; settlement: string; paymentStatus: string; payments: { id: string }[] }) =>
  o.status === "DELIVERED" && !!o.paymentProofFileId && (o.paidAmount >= o.total || awaitsOnlinePayment(o, o.payments.length > 0));

async function responsibilitiesTx(tx: Tx | typeof db, userId: string) {
  const [orders, sessions, tables, rooms] = await Promise.all([
    tx.restaurantOrder.findMany({
      where: { assignedToId: userId, status: { notIn: CLOSED_STATUSES } }, orderBy: { createdAt: "asc" },
      select: {
        id: true, number: true, status: true, type: true, tableLabel: true, roomNumber: true, customerName: true, total: true, paidAmount: true, sessionId: true, locationId: true, createdAt: true,
        paymentProofFileId: true, paymentStatus: true, settlement: true, payments: { where: { online: true }, select: { id: true }, take: 1 },
      },
    }).then((xs) => xs.filter((o) => !servedAndPaidOnline(o))),
    tx.diningSession.findMany({
      where: { waiterId: userId, status: { in: OPEN_SESSION } }, orderBy: { startedAt: "asc" },
      select: { id: true, number: true, status: true, locationId: true, location: { select: { name: true } }, guest: { select: { fullName: true } } },
    }),
    tx.restaurantLocation.findMany({ where: { waiterId: userId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    tx.room.findMany({ where: { serviceWaiterId: userId }, orderBy: { number: "asc" }, select: { id: true, number: true } }),
  ]);
  return { orders, sessions, tables, rooms, blocking: orders.length + sessions.length > 0 };
}

/** What a waiter is responsible for right now: open orders (delivered but unpaid too), customers at tables, standing tables and rooms. */
export async function waiterResponsibilities(userId: string) {
  const r = await responsibilitiesTx(db, userId);
  return {
    ...r,
    orders: r.orders.map((o) => ({ ...o, createdAt: o.createdAt.toISOString(), due: Math.max(0, o.total - o.paidAmount) })),
    sessions: r.sessions.map((s) => ({ id: s.id, number: s.number, status: s.status, locationId: s.locationId, table: s.location.name, customer: s.guest.fullName })),
  };
}
export type WaiterResponsibilities = Awaited<ReturnType<typeof waiterResponsibilities>>;

/** "Transfer or finish first: 2 orders (#12 · Table 4, #15 · Room 204), 1 table (Table 4)" — in the reader's language. */
function blockersText(r: Awaited<ReturnType<typeof responsibilitiesTx>>, t: T = englishT) {
  const where = (o: (typeof r.orders)[number]) => (o.type === "ROOM_SERVICE" ? t("Room {room}", { room: o.roomNumber ?? "?" }) : o.tableLabel != null ? t(o.tableLabel) : t("no table"));
  const orders = r.orders.length
    ? t.plural(r.orders.length, "{n} order ({list})", "{n} orders ({list})", { list: `${r.orders.slice(0, 4).map((o) => `${shortOrder(o.number)} · ${where(o)}`).join(", ")}${r.orders.length > 4 ? ", …" : ""}` })
    : "";
  const tables = r.sessions.length
    ? t.plural(r.sessions.length, "{n} table with customers ({list})", "{n} tables with customers ({list})", { list: r.sessions.map((s) => t(s.location.name)).join(", ") })
    : "";
  return orders && tables ? t("{orders} and {tables}", { orders, tables }) : orders || tables;
}

// ─── The waiter's shift ─────────────────────────────────────────────────────

/** The waiter starts their shift (it also starts by itself when they first take work). */
export async function startWaiterShift(actor: WorkActor, now = new Date()) {
  if (!isWaiter(actor)) throw new AppError("Restaurant shifts are for waiters.", "FORBIDDEN");
  const me = actor.userId!;
  try {
    return await db.$transaction(async (tx) => {
      await lockWaiterTx(tx, me);
      if (await tx.actualShift.findFirst({ where: { userId: me, endedAt: null } })) throw new AppError("Your shift is already running.");
      const settings = await getSettingsTx(tx);
      const shift = await tx.actualShift.create({ data: { department: "RESTAURANT", businessDate: toDbDate(businessDateOf(now, stayConfig(settings))), userId: me, startedAt: now } });
      await audit(tx, actor, { action: "shift.started", entityType: "ActualShift", entityId: shift.id, after: { department: "RESTAURANT", waiterId: me } });
      return shift;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("Your shift is already running.", "CONFLICT");
    throw e;
  }
}

/**
 * Close a waiter's shift (inside the transaction, nothing left with them): their standing tables and rooms
 * are freed. Returns what they served in it — service, not money (the Restaurant Counter records payments).
 */
async function closeWaiterShiftTx(tx: Tx, shift: { id: string; userId: string; businessDate: Date; startedAt: Date }, actor: WorkActor, now: Date, note: string | null, reason: string | null, batchId: string, t: T = englishT) {
  const release = { kind: "RELEASED" as const, via: "SHIFT_CLOSE" as const, reason: reason ?? "Shift closed", batchId };
  for (const l of await tx.restaurantLocation.findMany({ where: { waiterId: shift.userId }, select: { id: true }, orderBy: { id: "asc" } })) {
    await setTableWaiterTx(tx, l.id, null, actor, now, { ...release, standing: true, fromUserId: shift.userId });
  }
  for (const r of await tx.room.findMany({ where: { serviceWaiterId: shift.userId }, select: { number: true }, orderBy: { number: "asc" } })) {
    await setRoomWaiterTx(tx, r.number, shift.userId, null, actor, now, { ...release, standing: true });
  }
  await tx.actualShift.update({ where: { id: shift.id }, data: { endedAt: now, closingNote: note, closedById: actor.userId ?? null, closeReason: reason } });
  const served = await tx.restaurantOrder.count({ where: { deliveredById: shift.userId, deliveredAt: { gte: shift.startedAt, lte: now } } });
  return { served, text: served ? t.plural(served, "You served {n} order this shift.", "You served {n} orders this shift.") : t("No order served this shift.") };
}

/** The waiter closes their own shift — refused while any order or table is still theirs (transfer or finish it first). */
export async function endWaiterShift(actor: WorkActor, note?: string | null, now = new Date()) {
  if (!actor.userId) throw new AppError("Sign in first.", "FORBIDDEN");
  const me = actor.userId;
  const t = await actorT();
  return db.$transaction(async (tx) => {
    await lockWaiterTx(tx, me);
    const shift = await openWaiterShiftTx(tx, me);
    if (!shift) throw new AppError("Your shift is not running.");
    const left = await responsibilitiesTx(tx, me);
    if (left.blocking) throw new AppError(msgf("You still have {work}. Transfer them to a colleague on shift, or finish them, then close your shift.", { work: blockersText(left, t) }), "CONFLICT", { shift: "Work left" });
    const work = await closeWaiterShiftTx(tx, shift, actor, now, note?.trim().slice(0, 1000) || null, null, randomUUID(), t);
    await audit(tx, actor, { action: "shift.ended", entityType: "ActualShift", entityId: shift.id, after: { department: "RESTAURANT", served: work.served, note: note?.trim() || null } });
    // `collected` stays only for endWaiterShiftAction's declared type — waiters no longer record payments (always 0).
    return { served: work.served, text: work.text, collected: 0, shiftId: shift.id };
  }, { timeout: 30_000 });
}

/**
 * A manager closes a waiter's shift (they left, forgot…) — always saying why. If work is still with
 * them, the manager names the waiter on shift who takes all of it over, in the same step.
 */
export async function closeWaiterShiftAsManager(actor: WorkActor & { userId: string; permissions: ReadonlySet<string> }, shiftId: string, reason: string, toUserId?: string | null, now = new Date()) {
  if (!actor.permissions.has("shifts.manage")) throw new AppError("Only a manager can close someone's shift.", "FORBIDDEN");
  const why = reason.trim();
  if (why.length < 5) throw new AppError("Say why you close this shift (e.g. the waiter left without closing).", "VALIDATION", { reason: "Required" });
  const t = await actorT();
  return db.$transaction(async (tx) => {
    const shift = await tx.actualShift.findUnique({ where: { id: shiftId }, include: { user: { select: { fullName: true } } } });
    if (!shift || shift.department !== "RESTAURANT") throw new AppError("Waiter shift not found.", "NOT_FOUND");
    if (shift.endedAt) throw new AppError("This shift is already closed.");
    await lockWaiterTx(tx, shift.userId, toUserId);
    const batchId = randomUUID();
    let handed: { tables: number; rooms: number; orders: number; to: string } | null = null;
    const left = await responsibilitiesTx(tx, shift.userId);
    if (left.blocking) {
      if (!toUserId) throw new AppError(msgf("{name} still has {work} — choose the waiter who carries on with them.", { name: first(shift.user.fullName), work: blockersText(left, t) }), "VALIDATION", { waiter: "Required" });
      const w = (await waitersToAssign()).find((x) => x.id === toUserId);
      if (!w || w.id === shift.userId) throw new AppError("Choose another waiter to carry on with the work.", "VALIDATION", { waiter: "Invalid" });
      handed = { ...(await transferAllTx(tx, shift.userId, toUserId, actor, now, { via: "SHIFT_CLOSE", reason: why, batchId })), to: w.name };
    }
    const work = await closeWaiterShiftTx(tx, shift, actor, now, null, why, batchId);
    await audit(tx, actor, {
      action: "shift.closed_by_manager", entityType: "ActualShift", entityId: shift.id,
      after: { department: "RESTAURANT", waiter: shift.user.fullName, reason: why, handedTo: handed?.to ?? null, handed, served: work.served },
    });
    return { name: shift.user.fullName, handed, shiftId: shift.id };
  }, { timeout: 30_000 });
}

/** Colleagues a waiter can hand work to — on shift first (a manager can hand to anyone). */
export async function colleagues(exceptUserId?: string | null) {
  const [team, open] = await Promise.all([
    waitersToAssign(),
    db.actualShift.findMany({ where: { endedAt: null, department: "RESTAURANT" }, select: { userId: true, startedAt: true } }),
  ]);
  const on = new Map(open.map((s) => [s.userId, s.startedAt.toISOString()]));
  return team.filter((w) => w.id !== exceptUserId).map((w) => ({ ...w, onShiftSince: on.get(w.id) ?? null }))
    .sort((a, b) => Number(!!b.onShiftSince) - Number(!!a.onShiftSince) || a.name.localeCompare(b.name));
}
export type Colleague = Awaited<ReturnType<typeof colleagues>>[number];
