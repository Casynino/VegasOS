import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { RestaurantOrderStatus } from "@/generated/prisma/enums";
import { audit } from "../audit";
import { AppError } from "../errors";
import { lockLocationTx, OPEN_SESSION, sessionEventTx } from "./dining-core";
import type { Actor } from "./reservations";

/**
 * WHO SERVES — the one write path for an order's responsible waiter (RestaurantOrder.assignedToId):
 * routed to its table's or room's waiter, taken in charge by a waiter (their own phone, or their
 * PIN on the restaurant screen), transferred with the reason, or handed by a manager. Every change
 * is also written to the order's assignment history (WaiterAssignment — never overwritten), its
 * timeline and the audit. The kitchen never goes through here: preparing an order never changes
 * who serves it.
 */

type Tx = Prisma.TransactionClient;
export type AssignKind = "ROUTED" | "TAKEN" | "TRANSFER" | "MANAGER" | "RELEASED";
export type AssignVia = "SELF" | "PIN" | "MANAGER" | "TABLE" | "ROOM" | "SHIFT_CLOSE";
export type AssignActor = Actor & { deviceUserId?: string | null };

const DONE: RestaurantOrderStatus[] = ["COMPLETED", "COLLECTED", "CANCELLED"];

/** A manager taking work from one waiter (to another, or to nobody) says why. */
function managerNeedsReason(meta: { kind: AssignKind; reason?: string | null }, from: string | null, to: string | null, what: string) {
  if (meta.kind === "MANAGER" && from && from !== to && (meta.reason?.trim().length ?? 0) < 3) {
    throw new AppError(`Say why ${what} moves from its waiter.`, "VALIDATION", { reason: "Required" });
  }
}
const who = (a: AssignActor) => ({ byId: a.userId ?? null, byLabel: a.label ?? null, byRole: a.role ?? null });
const first = (n: string | null | undefined) => n?.replace(/\s*\(.*\)/, "") ?? null;
export const shortOrder = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;

/** A history row (order, table or room): from → to, how, by whom, why. */
export async function assignmentRowTx(tx: Tx, row: {
  scope: "ORDER" | "TABLE" | "ROOM"; orderId?: string | null; locationId?: string | null; roomNumber?: string | null;
  kind: AssignKind; via: AssignVia; fromUserId?: string | null; toUserId?: string | null; reason?: string | null; batchId?: string | null;
}, actor: AssignActor, at: Date) {
  await tx.waiterAssignment.create({
    data: {
      scope: row.scope, orderId: row.orderId ?? null, locationId: row.locationId ?? null, roomNumber: row.roomNumber ?? null,
      kind: row.kind, via: row.via, fromUserId: row.fromUserId ?? null, toUserId: row.toUserId ?? null, reason: row.reason?.trim() || null,
      ...who(actor), deviceUserId: actor.deviceUserId ?? null, batchId: row.batchId ?? null, at,
    },
  });
}

/**
 * Set (or clear) an order's responsible waiter — locked, so two people can never both take it.
 * `expectFrom` (when given) must still be the current waiter: taking an order someone else already
 * has, or transferring one that just moved, is refused.
 */
export async function setOrderWaiterTx(tx: Tx, orderId: string, toUserId: string | null, actor: AssignActor, now: Date, meta: {
  kind: AssignKind; via: AssignVia; reason?: string | null; expectFrom?: string | null; batchId?: string | null;
}) {
  await tx.$queryRaw`SELECT "id" FROM "restaurant_orders" WHERE "id" = ${orderId} FOR UPDATE`;
  const o = await tx.restaurantOrder.findUnique({ where: { id: orderId }, include: { assignedTo: { select: { fullName: true } } } });
  if (!o) throw new AppError("Order not found.", "NOT_FOUND");
  if (DONE.includes(o.status)) throw new AppError(`Order ${shortOrder(o.number)} is already finished.`);
  const from = o.assignedToId ?? null;
  if (meta.expectFrom !== undefined && from !== meta.expectFrom) {
    throw new AppError(from ? `${first(o.assignedTo?.fullName)} is serving order ${shortOrder(o.number)} — ask them (or a manager) to transfer it.` : `Order ${shortOrder(o.number)} has no waiter yet.`, "CONFLICT");
  }
  if (from === toUserId) return { changed: false, number: o.number, from, to: toUserId };
  managerNeedsReason(meta, from, toUserId, `order ${shortOrder(o.number)}`);
  const to = toUserId ? await tx.user.findUnique({ where: { id: toUserId }, select: { fullName: true } }) : null;
  if (toUserId && !to) throw new AppError("That waiter was not found.", "NOT_FOUND");
  await tx.restaurantOrder.update({ where: { id: o.id }, data: { assignedToId: toUserId, updatedAt: now } });
  const why = meta.reason?.trim() || null;
  const note = meta.kind === "TAKEN" ? `${first(to?.fullName)} is serving it${meta.via === "PIN" ? " (ID on the restaurant screen)" : ""}`
    : meta.kind === "TRANSFER" ? `Transferred ${first(o.assignedTo?.fullName) ?? "—"} → ${first(to?.fullName)}${why ? ` — ${why}` : ""}`
    : meta.kind === "RELEASED" ? `${first(o.assignedTo?.fullName)} is no longer serving${why ? ` — ${why}` : ""}`
    : meta.kind === "ROUTED" ? `Goes to ${first(to?.fullName)} (${meta.via === "ROOM" ? "the room's waiter" : "the table's waiter"})`
    : to ? `The manager gave it to ${first(to.fullName)}${why ? ` — ${why}` : ""}` : `${first(o.assignedTo?.fullName) ?? "The waiter"} is no longer serving (manager)${why ? ` — ${why}` : ""}`;
  await tx.restaurantOrderEvent.create({ data: { orderId: o.id, from: o.status, to: o.status, ...who(actor), note, at: now } });
  await assignmentRowTx(tx, { scope: "ORDER", orderId: o.id, locationId: o.locationId, roomNumber: o.roomNumber, kind: meta.kind, via: meta.via, fromUserId: from, toUserId, reason: why, batchId: meta.batchId }, actor, now);
  await audit(tx, actor, {
    action: "restaurant_order.assigned", entityType: "RestaurantOrder", entityId: o.id,
    before: { waiter: o.assignedTo?.fullName ?? null, waiterId: from },
    after: { waiter: to?.fullName ?? null, waiterId: toUserId, kind: meta.kind, via: meta.via, reason: why, ...(actor.deviceUserId ? { device: actor.deviceUserId } : {}) },
  });
  return { changed: true, number: o.number, from, to: toUserId };
}

type Meta = { kind: AssignKind; via: AssignVia; reason?: string | null; batchId?: string | null };
const nameOf = async (tx: Tx, id: string | null) => (id ? (await tx.user.findUnique({ where: { id }, select: { fullName: true } }))?.fullName ?? null : null);

/**
 * A table goes to a waiter: the customer sitting there now (their session), their open orders that
 * were the old waiter's (or nobody's) — orders handed on to a third waiter stay with them — and,
 * when `standing` (a manager's choice, or the table was the old waiter's), the table itself for the
 * next customers. `expectFrom`: the one giving it must still have it. `fromUserId`: move only what
 * that waiter has here (a table that is theirs while someone else serves the customer sitting there).
 */
export async function setTableWaiterTx(tx: Tx, locationId: string, toUserId: string | null, actor: AssignActor, now: Date, meta: Meta & { expectFrom?: string | null; standing?: boolean; fromUserId?: string | null }) {
  await lockLocationTx(tx, locationId);
  const l = await tx.restaurantLocation.findUnique({ where: { id: locationId }, include: { openSession: { select: { id: true, waiterId: true, status: true } } } });
  if (!l || l.kind !== "TABLE") throw new AppError("Table not found.", "NOT_FOUND");
  const open = l.openSession && OPEN_SESSION.includes(l.openSession.status) ? l.openSession : null;
  const from = meta.fromUserId !== undefined ? meta.fromUserId : open ? open.waiterId : l.waiterId;
  if (meta.expectFrom !== undefined && from !== meta.expectFrom) {
    throw new AppError(from ? `${first(await nameOf(tx, from))} is serving ${l.name} — ask them (or a manager) to transfer it.` : `${l.name} has no waiter yet.`, "CONFLICT");
  }
  if (toUserId && !(await nameOf(tx, toUserId))) throw new AppError("That waiter was not found.", "NOT_FOUND");
  managerNeedsReason(meta, from, toUserId, l.name);
  const session = open && open.waiterId === from ? open : null;
  const standing = meta.standing ?? (!!from && l.waiterId === from);
  const nobodys = !!session || standing;
  const orders = await tx.restaurantOrder.findMany({
    where: {
      status: { notIn: DONE }, OR: [...(session ? [{ sessionId: session.id }] : []), { locationId: l.id, sessionId: null, type: "DINE_IN" as const }],
      AND: [{ OR: [{ assignedToId: from }, ...(nobodys ? [{ assignedToId: null }] : [])] }],
    },
    select: { id: true, assignedToId: true }, orderBy: { id: "asc" },
  });
  let moved = 0;
  for (const o of orders) if ((await setOrderWaiterTx(tx, o.id, toUserId, actor, now, { ...meta, expectFrom: o.assignedToId ?? null })).changed) moved++;
  const fromName = await nameOf(tx, from), toName = await nameOf(tx, toUserId);
  const why = meta.reason?.trim() || null;
  if (session && session.waiterId !== toUserId) {
    await tx.diningSession.update({ where: { id: session.id }, data: { waiterId: toUserId, updatedAt: now } });
    const note = meta.kind === "TAKEN" ? `${first(toName)} is serving the table${meta.via === "PIN" ? " (ID on the restaurant screen)" : ""}`
      : meta.kind === "TRANSFER" ? `Table transferred ${first(fromName) ?? "—"} → ${first(toName)}${why ? ` — ${why}` : ""}`
      : meta.kind === "RELEASED" ? `${first(fromName)} is no longer serving the table${why ? ` — ${why}` : ""}`
      : toName ? `The manager gave the table to ${first(toName)}${why ? ` — ${why}` : ""}` : `${first(fromName) ?? "The waiter"} is no longer serving the table (manager)${why ? ` — ${why}` : ""}`;
    await sessionEventTx(tx, session.id, "NOTE", note, actor, now);
  }
  if (standing && l.waiterId !== toUserId) await tx.restaurantLocation.update({ where: { id: l.id }, data: { waiterId: toUserId } });
  if (from === toUserId && !moved && !(standing && l.waiterId !== toUserId)) return { table: l.name, from, to: toUserId, toName, orders: 0, changed: false };
  await assignmentRowTx(tx, { scope: "TABLE", locationId: l.id, kind: meta.kind, via: meta.via, fromUserId: from, toUserId, reason: why, batchId: meta.batchId }, actor, now);
  await audit(tx, actor, {
    action: "restaurant_table.waiter", entityType: "RestaurantLocation", entityId: l.id,
    before: { table: l.name, waiter: fromName, waiterId: from, standing: l.waiterId },
    after: { table: l.name, waiter: toName, waiterId: toUserId, kind: meta.kind, via: meta.via, reason: why, ordersNow: moved, standing: standing ? toUserId : l.waiterId, ...(actor.deviceUserId ? { device: actor.deviceUserId } : {}) },
  });
  return { table: l.name, from, to: toUserId, toName, orders: moved, changed: true };
}

const inRoom = (roomNumber: string | null, number: string) => (roomNumber ?? "").split(",").map((x) => x.trim()).includes(number);

/**
 * A room's room service goes to a waiter: `from`'s open orders for that room (and, when the room's
 * standing waiter changes, the ones nobody has yet), and — when `standing` or the room was `from`'s —
 * the room itself, so its next orders go to them.
 */
export async function setRoomWaiterTx(tx: Tx, roomNumber: string, from: string | null, toUserId: string | null, actor: AssignActor, now: Date, meta: Meta & { standing?: boolean }) {
  const [r] = await tx.$queryRaw<{ id: string; serviceWaiterId: string | null }[]>`SELECT "id", "serviceWaiterId" FROM "rooms" WHERE "number" = ${roomNumber} FOR UPDATE`;
  if (!r) throw new AppError(`Room ${roomNumber} not found.`, "NOT_FOUND");
  if (toUserId && !(await nameOf(tx, toUserId))) throw new AppError("That waiter was not found.", "NOT_FOUND");
  managerNeedsReason(meta, from, toUserId, `room ${roomNumber}'s room service`);
  const standing = meta.standing ?? (!!from && r.serviceWaiterId === from);
  const orders = (await tx.restaurantOrder.findMany({
    where: { type: "ROOM_SERVICE", status: { notIn: DONE }, roomNumber: { contains: roomNumber }, OR: [{ assignedToId: from }, ...(standing ? [{ assignedToId: null }] : [])] },
    select: { id: true, roomNumber: true, assignedToId: true }, orderBy: { id: "asc" },
  })).filter((o) => inRoom(o.roomNumber, roomNumber));
  let moved = 0;
  for (const o of orders) if ((await setOrderWaiterTx(tx, o.id, toUserId, actor, now, { ...meta, expectFrom: o.assignedToId ?? null })).changed) moved++;
  const standingFrom = r.serviceWaiterId;
  if (standing && standingFrom !== toUserId) await tx.room.update({ where: { id: r.id }, data: { serviceWaiterId: toUserId } });
  const changedStanding = standing && standingFrom !== toUserId;
  if (!moved && !changedStanding) return { room: roomNumber, orders: 0, changed: false };
  const why = meta.reason?.trim() || null;
  await assignmentRowTx(tx, { scope: "ROOM", roomNumber, kind: meta.kind, via: meta.via, fromUserId: from, toUserId, reason: why, batchId: meta.batchId }, actor, now);
  await audit(tx, actor, {
    action: "room.service_waiter", entityType: "Room", entityId: r.id,
    before: { room: roomNumber, waiter: await nameOf(tx, from), waiterId: from, standing: standingFrom },
    after: { room: roomNumber, waiter: await nameOf(tx, toUserId), waiterId: toUserId, kind: meta.kind, via: meta.via, reason: why, ordersNow: moved, standing: changedStanding ? toUserId : standingFrom },
  });
  return { room: roomNumber, orders: moved, changed: true };
}
