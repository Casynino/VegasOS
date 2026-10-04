"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { afterShiftClosed } from "@/server/services/shift-report";
import { z } from "zod";
import { authorize, requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { actingWaiter, WaiterPin } from "@/server/waiter-pin";
import {
  closeWaiterShiftAsManager, colleagues, endWaiterShift, startWaiterShift, takeChargeOfOrder, takeChargeOfTable,
  transferAllResponsibilities, transferOrder, transferRoomService, transferTable, type Colleague,
} from "@/server/services/waiter-work";

/**
 * A waiter's own work: take charge of an order or a table (on their phone, or with their PIN on the
 * restaurant screen), hand work to a colleague on shift with the reason, start and close their
 * shift. Managers hand anything to anyone and close a waiter's shift, saying why.
 */

const DECIDERS = ["dashboard.manager", "dashboard.owner", "dashboard.admin"] as const;
const Id = z.string().min(1).max(40);
const Reason = z.string().trim().min(3, "Say why you transfer it.").max(200);
const Pin = WaiterPin.nullable().optional();

function refresh() {
  revalidatePath("/staff/restaurant", "layout");
  revalidatePath("/staff/collections");
  revalidatePath("/staff/account");
}

/** "This one is mine" — an order nobody has yet (and its table, if nobody has that either). */
export async function takeChargeAction(input: { orderId: string; pin?: z.input<typeof WaiterPin> | null }): Promise<ActionResult<{ number: string; table: string | null; waiter: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.serve");
    const d = parseInput(z.object({ orderId: Id, pin: Pin }), input);
    const by = await actingWaiter(user, d.pin, "serving an order");
    const r = await takeChargeOfOrder(d.orderId, by);
    refresh();
    return { number: r.number, table: r.table, waiter: by.label?.split(" · ")[0] ?? "" };
  });
}

/** Take charge of a table nobody has: its customer now and their orders nobody has. */
export async function takeTableAction(input: { locationId: string; pin?: z.input<typeof WaiterPin> | null }): Promise<ActionResult<{ table: string; orders: number; waiter: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.serve");
    const d = parseInput(z.object({ locationId: Id, pin: Pin }), input);
    const by = await actingWaiter(user, d.pin, "serving a table");
    const r = await takeChargeOfTable(d.locationId, by);
    refresh();
    return { table: r.table, orders: r.orders, waiter: by.label?.split(" · ")[0] ?? "" };
  });
}

const Transfer = z.object({ toWaiterId: Id, reason: Reason, pin: Pin });

/** Hand one order to a colleague on shift. */
export async function transferOrderAction(input: z.input<typeof Transfer> & { orderId: string }): Promise<ActionResult<{ number: string; to: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.serve", ...DECIDERS);
    const d = parseInput(Transfer.extend({ orderId: Id }), input);
    const r = await transferOrder(d.orderId, d.toWaiterId, d.reason, await actingWaiter(user, d.pin, "transferring an order", { requireShift: false }));
    refresh();
    return r;
  });
}

/** Hand a table (its customer and their orders) to a colleague on shift. */
export async function transferTableAction(input: z.input<typeof Transfer> & { locationId: string }): Promise<ActionResult<{ table: string; to: string; orders: number }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.serve", ...DECIDERS);
    const d = parseInput(Transfer.extend({ locationId: Id }), input);
    const r = await transferTable(d.locationId, d.toWaiterId, d.reason, await actingWaiter(user, d.pin, "transferring a table", { requireShift: false }));
    refresh();
    return r;
  });
}

/** Hand a room's room service to a colleague on shift (a manager may say whose). */
export async function transferRoomServiceAction(input: z.input<typeof Transfer> & { room: string; fromWaiterId?: string | null }): Promise<ActionResult<{ room: string; to: string; orders: number }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.serve", ...DECIDERS);
    const d = parseInput(Transfer.extend({ room: z.string().trim().min(1).max(10), fromWaiterId: Id.nullable().optional() }), input);
    const r = await transferRoomService(d.room, d.toWaiterId, d.reason, await actingWaiter(user, d.pin, "transferring room service", { requireShift: false }), new Date(), d.fromWaiterId ?? null);
    refresh();
    return r;
  });
}

/** Everything I have (or, for a manager, everything a waiter has) goes to a colleague — in one step. */
export async function transferAllAction(input: z.input<typeof Transfer> & { fromWaiterId?: string | null }): Promise<ActionResult<{ tables: number; rooms: number; orders: number; to: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.serve", ...DECIDERS);
    const d = parseInput(Transfer.extend({ fromWaiterId: Id.nullable().optional() }), input);
    const by = await actingWaiter(user, d.pin, "handing over work", { requireShift: false });
    const r = await transferAllResponsibilities(d.fromWaiterId ?? by.userId!, d.toWaiterId, d.reason, by);
    refresh();
    return r;
  });
}

/** The colleagues work can go to — on shift first. */
export async function colleaguesAction(): Promise<ActionResult<Colleague[]>> {
  return runAction(async () => {
    const user = await authorize("restaurant.serve", ...DECIDERS);
    return colleagues(user.id);
  });
}

async function me() {
  const user = await authorize("restaurant.shift");
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions as ReadonlySet<string> };
}

/** The waiter starts their shift. */
export async function startWaiterShiftAction(): Promise<ActionResult<null>> {
  return runAction(async () => {
    await startWaiterShift(await me());
    refresh();
    return null;
  }, "Your shift has started.");
}

/** The waiter closes their shift — only when nothing is left with them. */
export async function endWaiterShiftAction(input: { note?: string }): Promise<ActionResult<{ collected: number; text: string }>> {
  return runAction(async () => {
    const d = parseInput(z.object({ note: z.string().trim().max(1000).optional() }), input);
    const r = await endWaiterShift(await me(), d.note ?? null);
    // The shift report is made and sent after the close is saved — never holding it up.
    after(() => afterShiftClosed(r.shiftId));
    refresh();
    return { collected: r.collected, text: r.text };
  }, "Your shift is closed — your shift report is on its way.");
}

/** A manager closes a waiter's shift, saying why — handing any work left to a waiter on shift. */
export async function closeWaiterShiftAction(input: { shiftId: string; reason: string; toWaiterId?: string | null }): Promise<ActionResult<{ name: string; handed: { tables: number; rooms: number; orders: number; to: string } | null }>> {
  return runAction(async () => {
    const user = await authorize("shifts.manage");
    const d = parseInput(z.object({ shiftId: Id, reason: z.string().trim().min(5, "Say why you close this shift.").max(300), toWaiterId: Id.nullable().optional() }), input);
    const { ipAddress } = await requestMeta();
    const r = await closeWaiterShiftAsManager({ userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions }, d.shiftId, d.reason, d.toWaiterId ?? null);
    after(() => afterShiftClosed(r.shiftId));
    refresh();
    revalidatePath(`/staff/shifts/${d.shiftId}`);
    return { name: r.name, handed: r.handed };
  });
}
