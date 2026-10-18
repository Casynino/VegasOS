import "server-only";
import type { T } from "@/i18n/translate";
import { doneByText } from "@/lib/done-by-text";
import { developerMarks, markFor, sameWho, type DeveloperMark } from "./developer-marks";

/**
 * "DONE BY DEVELOPER" on a restaurant order's lines (owner, 2026-10-18). The order keeps its stored people (accepted by, ready by, served by,
 * the history's "by" snapshots): they are the staff member's, and shifts, "my orders" and the counts by person depend on them. The audit row
 * of the step is the mark: when the Developer, working as Neema, accepted / served / cancelled the order, a small tag says so NEXT TO Neema's
 * name. The order's steps share one key (RestaurantOrder + its id), so a step is matched by its kind AND its time (the audit row is written a
 * moment after the step) and, when both say who, by the name. No mark = no evidence, never "a staff member did it".
 *
 * Money is never marked: payments, discounts, room bills and refunds are not in the actions asked for.
 */
export type OrderMarks = Map<string, DeveloperMark[]>;

/** The order was made / its steps moved on / it was cancelled or declined — the audit actions of each kind of line. */
export const ORDER_CREATED = ["restaurant_order.created"] as const;
export const ORDER_MOVED = ["restaurant_order.status", "restaurant_order.served_on_clear"] as const;
export const ORDER_CANCELLED = ["restaurant_order.cancelled", "restaurant_order.declined"] as const;
export const ORDER_ASSIGNED = ["restaurant_order.assigned"] as const;
/** Every non-money action that can write a line of an order's history (the one query asks for these and nothing else). */
export const ORDER_MARK_ACTIONS = [
  ...ORDER_CREATED, ...ORDER_MOVED, ...ORDER_CANCELLED, ...ORDER_ASSIGNED,
  "restaurant_order.item_prepared", "restaurant_order.items_added", "restaurant_order.item_removed", "restaurant_order.moved", "restaurant_order.phone",
] as const;

/** The Developer's marks on these orders: ONE query per 500 orders. A failing lookup shows no tag, never an error. */
export async function orderMarks(ids: readonly (string | null | undefined)[]): Promise<OrderMarks> {
  return developerMarks("RestaurantOrder", ids, { actions: ORDER_MARK_ACTIONS }).catch(() => new Map<string, DeveloperMark[]>());
}

export { sameWho };

/** The tag words ("Done by Developer · as Neema") for the step of an order that happened at `at`, or null. */
export function stepDoneBy(marks: OrderMarks, t: T, orderId: string, at: Date | null | undefined, opts: { actions?: readonly string[]; by?: string | null } = {}): string | null {
  if (!at) return null;
  const mark = markFor(marks, orderId, { actions: opts.actions, near: at });
  return mark && sameWho(mark, opts.by) ? doneByText(t, mark) : null;
}

/** A line of the history that is money (a payment, a room bill, a discount, a printed bill): never marked. */
const MONEY_NOTE = /^(Pa(id|yment)|Charged|Removed from|Taken off|Discount|Open again)|printed|downloaded/;

/**
 * The tag for one event of an order's history (its steps, who serves it, items added…). The event says what happened (made, moved on, cancelled,
 * or a note on the order) so only the audit actions of that kind can mark it.
 */
export function eventDoneBy(marks: OrderMarks, t: T, orderId: string, e: { from: string | null; to: string; note: string | null; at: Date; byLabel: string | null }): string | null {
  const note = e.from === e.to;
  if (note && e.note && MONEY_NOTE.test(e.note)) return null;
  // Completed / handed over comes from the payment that settled the order: money, not the Developer's step.
  if (!note && (e.to === "COMPLETED" || e.to === "COLLECTED")) return null;
  const actions = e.from == null ? ORDER_CREATED
    : note ? undefined
    : e.to === "CANCELLED" ? ORDER_CANCELLED
    // Served, accepted…; "back to the kitchen" is items added; the cook's first tick moves ACCEPTED to PREPARING.
    : e.to === "PENDING" ? ["restaurant_order.items_added"]
    : [...ORDER_MOVED, "restaurant_order.item_prepared"];
  return stepDoneBy(marks, t, orderId, e.at, { actions, by: e.byLabel });
}
