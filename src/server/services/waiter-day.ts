import "server-only";
import { db } from "../db";
import { toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { CLOSED_STATUSES, waitersToAssign } from "./restaurant";
import { collectionTotals } from "./collections";

/**
 * What each waiter handled on a hotel day — facts only, never a score or a ranking: the orders
 * they took, were given, carried or served; the customers behind them; the tables they are in
 * charge of now and their orders still going. Waiters serve; the Restaurant Counter records the
 * money — so the service facts are what the manager's "Waiters today" shows.
 *
 * The payment figures below (received, to confirm, reversed, room bills) are kept only for older
 * records and other internal uses — a waiter is never shown as a collector.
 */
export async function waiterDay(day: BusinessDate, opts: { userId?: string | null } = {}) {
  const team = opts.userId ? null : await waitersToAssign();
  const ids = opts.userId ? [opts.userId] : team!.map((w) => w.id);
  if (!ids.length) return [];
  const mine = (field: "createdById" | "takenById" | "deliveredById" | "assignedToId") => ({ [field]: { in: ids } });
  const [orders, money, tables, people] = await Promise.all([
    db.restaurantOrder.findMany({
      where: { businessDate: toDbDate(day), status: { not: "CANCELLED" }, OR: [mine("createdById"), mine("takenById"), mine("deliveredById"), mine("assignedToId")] },
      select: { id: true, status: true, total: true, settlement: true, guestId: true, sessionId: true, createdById: true, takenById: true, deliveredById: true, assignedToId: true },
    }),
    // The money: from the payments each one collected (and their lines put on room bills) — never from order totals.
    collectionTotals(day, day, { collectorIds: ids }),
    db.restaurantLocation.findMany({ where: { isActive: true, waiterId: { in: ids } }, orderBy: { sortOrder: "asc" }, select: { name: true, waiterId: true } }),
    opts.userId ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, role: { select: { name: true } } } }) : null,
  ]);
  const who = team ?? people!.map((u) => ({ id: u.id, name: u.fullName, role: u.role.name }));

  return who.map((w) => {
    const handled = orders.filter((o) => [o.createdById, o.takenById, o.deliveredById, o.assignedToId].includes(w.id));
    const m = money.of(w.id);
    return {
      id: w.id, name: w.name, role: w.role,
      orders: handled.length,
      /** Orders they served today (brought to the customer). */
      served: handled.filter((o) => o.deliveredById === w.id).length,
      /** Different customers behind those orders (a table's session counts once). */
      customers: new Set(handled.map((o) => o.guestId ?? o.sessionId ?? o.id)).size,
      /** Older records only: payments recorded under their own name (waiters no longer record payments). */
      received: m.collected, payments: m.payments, waitingConfirmation: m.toConfirm, reversed: m.reversed,
      /** Cash · Mobile money · Bank · Card. */
      byKind: m.byKind,
      /** What they put on guests' room bills (collected at check-out, not by them). */
      onRooms: m.roomCharges, roomOrders: m.roomOrders,
      /** The value of every order they handled today. */
      value: handled.reduce((t, o) => t + o.total, 0),
      tables: tables.filter((t) => t.waiterId === w.id).map((t) => t.name),
      /** The orders still going that are theirs now (the one responsible waiter). */
      active: handled.filter((o) => o.assignedToId === w.id && !CLOSED_STATUSES.includes(o.status)).length,
    };
  });
}
export type WaiterDay = Awaited<ReturnType<typeof waiterDay>>[number];
