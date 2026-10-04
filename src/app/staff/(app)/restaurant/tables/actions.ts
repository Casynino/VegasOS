"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { validPhone } from "@/lib/guest-messages";
import { inHouseGuests } from "@/server/services/restaurant";
import { deskOnlyHotelTable, deskOnlyStayingGuest, isDeskUser } from "@/server/desk";
import { customerByPhone } from "@/server/services/guests";
import { db } from "@/server/db";
import { actingWaiter, WaiterPin } from "@/server/waiter-pin";
import {
  addSessionMember, chargeSessionToRoom, closeSession, moveSession, requestSessionBill, seatCustomer, seatReservation, sessionById, setSessionGuests, tableHistory, takeSessionPayment,
  withoutMoney, type SessionView,
} from "@/server/services/dining-sessions";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions };
}
function refresh() {
  revalidatePath("/staff/restaurant", "layout");
  revalidatePath("/staff/payments");
}
const Id = z.string().min(1).max(40);
const Phone = z.string().trim().max(30).refine(validPhone, "Enter a phone number like 0712 345 678.");
const Guests = z.coerce.number().int().min(1, "At least 1 person.").max(60);

const Seat = z.object({
  locationId: Id, name: z.string().trim().min(2, "Enter the customer's name.").max(80), phone: Phone, guestCount: Guests,
  notes: z.string().trim().max(300).optional(), override: z.boolean().optional(),
  /** On the shared restaurant screen: the waiter seating them (the table is theirs). */
  pin: WaiterPin.nullable().optional(),
  /** The customer picked in the search (that person, even if someone else shares the number). */
  guestId: z.string().max(40).nullable().optional(),
});
/** Seat a walk-in customer at a free table (the table is theirs until they pay). */
export async function seatCustomerAction(input: z.input<typeof Seat>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    const { pin, ...d } = parseInput(Seat, input);
    if (isDeskUser(user)) await deskOnlyStayingGuest(user, d.guestId ?? (await customerByPhone(d.phone))?.id);
    const s = await seatCustomer(d, await actingWaiter(user, pin, "seating a customer"));
    refresh();
    return { id: s.id };
  }, "Seated — the table is theirs.");
}

/** The reserved customer came: seat them (at their table or the one chosen). */
export async function seatReservationAction(input: { id: string; locationId?: string | null; guestCount?: number; override?: boolean; pin?: z.input<typeof WaiterPin> | null }): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    const by = await actingWaiter(user, input.pin, "seating a customer");
    if (isDeskUser(user)) await deskOnlyStayingGuest(user, (await db.tableReservation.findUnique({ where: { id: Id.parse(input.id) }, select: { guestId: true } }))?.guestId);
    const s = await seatReservation(Id.parse(input.id), { locationId: input.locationId ? Id.parse(input.locationId) : null, guestCount: input.guestCount ? Guests.parse(input.guestCount) : null, override: !!input.override }, by);
    refresh();
    return { id: s.id };
  }, "Seated — their reservation is now their table.");
}

const Member = z.object({ sessionId: Id, name: z.string().trim().min(2, "Enter their name.").max(80), phone: Phone, guestId: z.string().max(40).nullable().optional() });
/** Add someone at the table (they can order from the table's QR too). */
export async function addMemberAction(input: z.input<typeof Member>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    const d = parseInput(Member, input);
    await deskOnlyHotelTable(user, d.sessionId);
    await addSessionMember(d.sessionId, d, await actor(user));
    refresh();
    return null;
  }, "Added to the table.");
}

export async function setGuestsAction(input: { sessionId: string; guestCount: number }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    await deskOnlyHotelTable(user, Id.parse(input.sessionId));
    await setSessionGuests(Id.parse(input.sessionId), Guests.parse(input.guestCount), await actor(user));
    refresh();
    return null;
  }, "Saved.");
}

/** The customer is finished: waiting for the payment. */
export async function requestBillAction(input: { sessionId: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    await deskOnlyHotelTable(user, Id.parse(input.sessionId));
    await requestSessionBill(Id.parse(input.sessionId), await actor(user));
    refresh();
    return null;
  }, "Marked — waiting for the payment.");
}

/** Move the customer (their whole session) to another table. */
export async function moveSessionAction(input: { sessionId: string; locationId: string; reason?: string; override?: boolean }): Promise<ActionResult<{ from: string; to: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    await deskOnlyHotelTable(user, Id.parse(input.sessionId));
    const r = await moveSession(Id.parse(input.sessionId), Id.parse(input.locationId), { reason: z.string().trim().max(200).optional().parse(input.reason), override: !!input.override }, await actor(user));
    refresh();
    return r;
  });
}

const Pay = z.object({ sessionId: Id, accountId: z.string().min(1, "Choose where the money was received.").max(40), reference: z.string().trim().max(80).optional(), handedOverById: Id.nullable().optional() });
/** The whole table's bill paid into one account — the table is freed once everything is served. */
export async function takeSessionPaymentAction(input: z.input<typeof Pay>): Promise<ActionResult<{ amount: number; status: string }>> {
  return runAction(async () => {
    const user = await authorize("revenue.record");
    const d = parseInput(Pay, input);
    await deskOnlyHotelTable(user, d.sessionId);
    // The official payment: recorded by whoever is signed in (the Restaurant Counter) — the waiter who brought the money noted.
    const r = await takeSessionPayment(d.sessionId, { accountId: d.accountId, reference: d.reference || null, handedOverById: d.handedOverById ?? null }, await actor(user));
    refresh();
    revalidatePath("/staff/finance", "layout");
    return { amount: r.amount, status: r.status };
  });
}

const ToRoom = z.object({ sessionId: Id, reservationId: Id, reason: z.string().trim().max(200).optional() });
/** The whole table bill on the customer's room (reception may choose another guest's room, saying why). */
export async function chargeSessionToRoomAction(input: z.input<typeof ToRoom>): Promise<ActionResult<{ orders: number; total: number; room: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders");
    const d = parseInput(ToRoom, input);
    await deskOnlyHotelTable(user, d.sessionId);
    const r = await chargeSessionToRoom(d.sessionId, d.reservationId, { reason: d.reason || null }, await actor(user));
    refresh();
    revalidatePath("/staff/reservations", "layout");
    revalidatePath("/staff/rooms", "layout");
    revalidatePath("/staff/check-out");
    return { orders: r.orders, total: r.total, room: r.room };
  });
}

/** Every room staying now — only for staff who check stays (reception, managers, the MD): to put a bill on another guest's room. */
export async function staysForBillingAction(): Promise<ActionResult<{ id: string; label: string }[]>> {
  return runAction(async () => {
    const user = await authorize("reservations.view");
    if (!user.permissions.has("restaurant.orders")) throw new AppError("Putting a bill on a room is for reception and managers.", "FORBIDDEN");
    return (await inHouseGuests()).map((g) => ({ id: g.id, label: `Room ${g.rooms || "—"} — ${g.name}` }));
  });
}

/** Close the table (nothing to pay, everything served) — or free it when nothing was ordered. */
export async function closeSessionAction(input: { sessionId: string; note?: string; serveRemaining?: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    await deskOnlyHotelTable(user, Id.parse(input.sessionId));
    await closeSession(Id.parse(input.sessionId), { note: z.string().trim().max(200).optional().parse(input.note), serveRemaining: input.serveRemaining === true }, await actor(user));
    refresh();
    return null;
  }, "The table is free.");
}

/** A table's past customers (for its History). */
export async function tableHistoryAction(input: { locationId: string }): Promise<ActionResult<Awaited<ReturnType<typeof tableHistory>>>> {
  return runAction(async () => {
    await authorize("restaurant.orders", "restaurant.serve", "kitchen.orders", "restaurant.menu");
    return tableHistory(Id.parse(input.locationId), 30);
  });
}

/** One past (or open) session in full — orders, money and timeline. Prices only for those who see money. */
export async function sessionDetailAction(input: { id: string }): Promise<ActionResult<SessionView | null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve", "kitchen.orders", "restaurant.menu");
    await deskOnlyHotelTable(user, Id.parse(input.id));
    const s = await sessionById(Id.parse(input.id));
    if (!s) return null;
    const money = user.permissions.has("restaurant.orders") || user.permissions.has("restaurant.menu");
    return money ? s : withoutMoney(s);
  });
}

/** A new table inside or outside — numbered after the last, with its own QR (managers, the MD). */
const FLOOR = ["restaurant.menu", "settings.manage", "dashboard.manager", "dashboard.owner", "dashboard.admin"] as const;

export async function addTableAction(input: { area: "INSIDE" | "OUTSIDE" }): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction(async () => {
    const user = await authorize(...FLOOR);
    const { addTable } = await import("@/server/services/restaurant-locations");
    const r = await addTable(z.object({ area: z.enum(["INSIDE", "OUTSIDE"]) }).parse(input), await actor(user));
    refresh();
    return r;
  });
}

/** Switch a table off (with a reason) or back on. */
export async function setTableInUseAction(input: { id: string; active: boolean; reason?: string }): Promise<ActionResult<{ name: string }>> {
  return runAction(async () => {
    const user = await authorize(...FLOOR);
    const { setTableInUse } = await import("@/server/services/restaurant-locations");
    const d = z.object({ id: Id, active: z.boolean(), reason: z.string().trim().max(200).optional() }).parse(input);
    const r = await setTableInUse(d.id, d.active, d.reason ?? null, await actor(user));
    refresh();
    return r;
  });
}

/** Block a table for now (unavailable / under maintenance, with a reason) or reopen it. */
export async function setTableBlockedAction(input: { id: string; as: "UNAVAILABLE" | "MAINTENANCE" | null; reason?: string }): Promise<ActionResult<{ name: string; reservationsComing: number }>> {
  return runAction(async () => {
    const user = await authorize(...FLOOR);
    const { setTableBlocked } = await import("@/server/services/restaurant-locations");
    const d = z.object({ id: Id, as: z.enum(["UNAVAILABLE", "MAINTENANCE"]).nullable(), reason: z.string().trim().max(200).optional() }).parse(input);
    const r = await setTableBlocked(d.id, d.as, d.reason ?? null, await actor(user));
    refresh();
    return r;
  });
}

/** Put a waiter in charge of a table — the customer there now and the next ones (managers, the MD, the owner). */
export async function assignTableWaiterAction(input: { locationId: string; waiterId: string | null; reason?: string }): Promise<ActionResult<{ table: string; to: string | null; orders: number }>> {
  return runAction(async () => {
    const user = await authorize("dashboard.manager", "dashboard.owner", "dashboard.admin");
    const { assignTableWaiter } = await import("@/server/services/restaurant");
    const d = z.object({ locationId: Id, waiterId: Id.nullable(), reason: z.string().trim().max(200).optional() }).parse(input);
    const r = await assignTableWaiter(d.locationId, d.waiterId, await actor(user), new Date(), d.reason || null);
    refresh();
    return r;
  });
}
