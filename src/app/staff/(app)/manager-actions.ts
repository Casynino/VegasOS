"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { approveLateCheckout, approveLeaveOwing, changeDiscount, discountStayBill, extendStayFree, withdrawLeaveOwing } from "@/server/services/reservations";
import { discountOrders } from "@/server/services/restaurant";
import { cancelRoomClosure, planRoomClosure } from "@/server/services/room-decisions";
import { addDays, fromDbDate } from "@/lib/time/business-date";

/**
 * The decisions managers, the MD and the owner make (reception and waiters do the routine work):
 * free extra nights, a free late checkout, a discount on a room or a table's bill. Every one is
 * recorded with who, how much and why.
 */
const DECIDERS = ["dashboard.manager", "dashboard.owner", "dashboard.admin"] as const;
async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions };
}
function refresh() {
  for (const p of ["/manager/dashboard", "/admin/dashboard", "/staff/rooms", "/staff/reservations", "/staff/restaurant"]) revalidatePath(p, "layout");
}
const Id = z.string().min(1).max(40);
const Reason = z.string().trim().min(3, "Say why.").max(200);

/** Extra nights on the house — the guest stays, the bill does not change. */
export async function freeNightsAction(input: { reservationRoomId: string; nights: number; reason: string }): Promise<ActionResult<{ until: string }>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS);
    const d = z.object({ reservationRoomId: Id, nights: z.coerce.number().int().min(1).max(14), reason: Reason }).parse(input);
    const rr = await db.reservationRoom.findUnique({ where: { id: d.reservationRoomId }, select: { departureDate: true } });
    if (!rr) throw new AppError("Booking room not found.", "NOT_FOUND");
    const until = addDays(fromDbDate(rr.departureDate), d.nights);
    await extendStayFree(d.reservationRoomId, until, d.reason, await actor(user));
    refresh();
    return { until };
  }, "Free nights given — the room stays theirs.");
}

/** A later checkout today, free. */
export async function freeLateCheckoutAction(input: { reservationRoomId: string; until: string; reason: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS);
    const d = z.object({ reservationRoomId: Id, until: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time."), reason: Reason }).parse(input);
    await approveLateCheckout(d.reservationRoomId, { until: d.until, fee: 0, note: `Free — ${d.reason}` }, await actor(user));
    refresh();
    return null;
  }, "Late checkout given, free.");
}

/** A discount on the room price, per night (within the hotel's limit). */
export async function roomDiscountAction(input: { reservationRoomId: string; perNight: number; reason: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS);
    const d = z.object({ reservationRoomId: Id, perNight: z.coerce.number().int().min(0).max(10_000_000), reason: Reason }).parse(input);
    await changeDiscount(d.reservationRoomId, d.perNight, d.reason, await actor(user));
    refresh();
    return null;
  }, "Discount saved.");
}

/** A discount on a table's bill (all its orders still to pay) or on one order. */
export async function billDiscountAction(input: { sessionId?: string | null; orderIds?: string[]; amount?: number | null; percent?: number | null; reason: string }): Promise<ActionResult<{ amount: number }>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS);
    const d = z.object({
      sessionId: Id.nullish(), orderIds: z.array(Id).max(50).optional(), reason: Reason,
      amount: z.coerce.number().int().min(1).max(100_000_000).nullish(), percent: z.coerce.number().min(1).max(100).nullish(),
    }).parse(input);
    const ids = d.sessionId
      ? (await db.restaurantOrder.findMany({ where: { sessionId: d.sessionId, status: { not: "CANCELLED" } }, select: { id: true } })).map((o) => o.id)
      : d.orderIds ?? [];
    const r = await discountOrders(ids, { amount: d.amount ?? null, percent: d.percent ?? null, reason: d.reason }, await actor(user));
    refresh();
    return { amount: r.amount };
  }, "Discount given.");
}

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

/** Close a room for dates ahead (painting, a big repair) — nobody can book it then. */
export async function planClosureAction(input: { roomId: string; from: string; to: string; type: "MAINTENANCE" | "OUT_OF_SERVICE"; reason: string }): Promise<ActionResult<{ number: string }>> {
  return runAction(async () => {
    const user = await authorize("rooms.block");
    const d = z.object({ roomId: Id, from: Day, to: Day, type: z.enum(["MAINTENANCE", "OUT_OF_SERVICE"]), reason: Reason }).parse(input);
    const r = await planRoomClosure(d, await actor(user));
    refresh();
    return { number: r.number };
  }, "Closure saved — the room can't be booked in those dates.");
}

/** Cancel a planned closure: the room can be booked again. */
export async function cancelClosureAction(input: { blockId: string; reason?: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("rooms.block");
    const d = z.object({ blockId: Id, reason: z.string().trim().max(200).optional() }).parse(input);
    await cancelRoomClosure(d.blockId, d.reason ?? "", await actor(user));
    refresh();
    return null;
  }, "Closure cancelled — the room can be booked again.");
}

/** Let a guest check out still owing (reception can then check them out). */
export async function leaveOwingAction(input: { reservationId: string; reason: string }): Promise<ActionResult<{ upTo: number }>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS);
    const d = z.object({ reservationId: Id, reason: Reason }).parse(input);
    const r = await approveLeaveOwing(d.reservationId, d.reason, await actor(user));
    refresh();
    return r;
  }, "Approved — reception can check the guest out owing.");
}

export async function withdrawLeaveOwingAction(input: { reservationId: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS);
    await withdrawLeaveOwing(z.object({ reservationId: Id }).parse(input).reservationId, await actor(user));
    refresh();
    return null;
  }, "Approval withdrawn — the guest pays before checking out.");
}

/** Waiters an order can be handed to. */
export async function waitersAction(): Promise<ActionResult<{ id: string; name: string; role: string }[]>> {
  return runAction(async () => {
    await authorize(...DECIDERS);
    const { waitersToAssign } = await import("@/server/services/restaurant");
    return waitersToAssign();
  });
}

/** Hand an order to a waiter (or free it again) — kept in the order's history. */
export async function assignOrderAction(input: { orderId: string; waiterId: string | null; reason?: string }): Promise<ActionResult<{ number: string; to: string | null }>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS);
    const { assignOrder } = await import("@/server/services/restaurant");
    const d = z.object({ orderId: Id, waiterId: Id.nullable(), reason: z.string().trim().max(200).optional() }).parse(input);
    const r = await assignOrder(d.orderId, d.waiterId, await actor(user), new Date(), d.reason || null);
    refresh();
    return r;
  });
}

/** A customer complaint (about an order, a stay…) — the manager handles it on the Requests page. */
export async function logComplaintAction(input: { orderId?: string | null; reservationId?: string | null; description: string; priority: "NORMAL" | "HIGH" | "URGENT" }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS, "requests.manage");
    const { createServiceRequest } = await import("@/server/services/requests");
    const d = z.object({ orderId: Id.nullish(), reservationId: Id.nullish(), description: z.string().trim().min(5, "Say what the complaint is.").max(500), priority: z.enum(["NORMAL", "HIGH", "URGENT"]) }).parse(input);
    const r = await createServiceRequest({ type: "COMPLAINT", priority: d.priority, description: d.description, orderId: d.orderId ?? null, reservationId: d.reservationId ?? null }, await actor(user));
    refresh();
    revalidatePath("/staff/requests");
    return { id: r.id };
  }, "Complaint logged — follow it on the Requests page.");
}

/** Put a waiter in charge of a room's room service (its food & drink orders go to them). */
export async function roomServiceWaiterAction(input: { roomId: string; waiterId: string | null; reason?: string }): Promise<ActionResult<{ room: string; to: string | null }>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS);
    const { assignRoomServiceWaiter } = await import("@/server/services/restaurant");
    const d = z.object({ roomId: Id, waiterId: Id.nullable(), reason: z.string().trim().max(200).optional() }).parse(input);
    const r = await assignRoomServiceWaiter(d.roomId, d.waiterId, await actor(user), new Date(), d.reason || null);
    refresh();
    return r;
  });
}

/** A discount on the guest's whole bill — room nights and everything charged to the room. */
export async function stayBillDiscountAction(input: { reservationId: string; amount?: number | null; percent?: number | null; reason: string }): Promise<ActionResult<{ amount: number; toPay: number }>> {
  return runAction(async () => {
    const user = await authorize(...DECIDERS);
    const d = z.object({
      reservationId: Id, reason: Reason,
      amount: z.coerce.number().int().min(1).max(100_000_000).nullish(), percent: z.coerce.number().min(1).max(100).nullish(),
    }).parse(input);
    const r = await discountStayBill(d.reservationId, { amount: d.amount ?? null, percent: d.percent ?? null, reason: d.reason }, await actor(user));
    refresh();
    return { amount: r.amount, toPay: r.toPay };
  });
}
