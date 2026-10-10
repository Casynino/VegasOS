"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { db } from "@/server/db";
import { activeStaysFor } from "@/server/services/guests";
import { isDeskUser as isDesk } from "@/server/desk";
import { parseInput } from "@/server/validation";
import { validPhone } from "@/lib/guest-messages";
import { msg } from "@/i18n/msg";
import { createTableReservation, moveTableReservation, setTableReservationStatus, updateTableReservation } from "@/server/services/table-reservations";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions };
}
const refresh = () => revalidatePath("/staff/restaurant", "layout");
const Id = z.string().min(1).max(40);

const Fields = z.object({
  name: z.string().trim().min(2, msg("Enter the customer's name.")).max(80),
  phone: z.string().trim().max(30).refine(validPhone, msg("Enter a phone number like 0712 345 678.")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Choose the date.")),
  time: z.string().regex(/^\d{1,2}:\d{2}$/, msg("Choose the time.")),
  guestCount: z.coerce.number().int().min(1, msg("At least 1 person.")).max(60),
  notes: z.string().trim().max(300).optional(),
});
const Create = Fields.extend({ locationId: Id, locationIds: z.array(Id).max(8, msg("Up to 8 tables in one reservation.")).optional(), guestId: z.string().max(40).nullable().optional() });

/** Reception (not management) books tables for the hotel's guests only — anyone else books with the restaurant (owner, 2026-10-04). */
async function assertHotelGuest(guestId: string | null | undefined) {
  if (!guestId || !(await activeStaysFor(db, [guestId])).length) throw new AppError("Reception reserves tables for guests staying in the hotel — pick the guest. Anyone else books with the restaurant.", "VALIDATION", { guestId: msg("Required") });
}
/** Reception touches only its staying guests' table bookings. */
async function deskBooking(user: CurrentUser, id: string) {
  if (!isDesk(user)) return null;
  const r = await db.tableReservation.findUnique({ where: { id }, select: { guestId: true, guest: { select: { fullName: true, phone: true } } } });
  await assertHotelGuest(r?.guestId);
  return r;
}

/** Book a table — or several, for one party — ahead for a customer. */
export async function createReservationAction(input: z.input<typeof Create>): Promise<ActionResult<{ id: string; reference: string; tables: number }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    const d = parseInput(Create, input);
    if (isDesk(user)) await assertHotelGuest(d.guestId);
    const r = await createTableReservation(d, await actor(user));
    refresh();
    return { id: r.id, reference: r.reference, tables: r.tables };
  });
}

/** Change a reservation's customer, date, time, people or notes. */
export async function updateReservationAction(input: z.input<typeof Fields> & { id: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    const mine = await deskBooking(user, Id.parse(input.id));
    // Reception changes the when / how many / note — the booking stays the same staying guest's.
    const fields = parseInput(Fields, mine ? { ...input, name: mine.guest.fullName, phone: mine.guest.phone ?? input.phone } : input);
    await updateTableReservation(Id.parse(input.id), fields, await actor(user));
    refresh();
    return null;
  }, msg("Reservation saved."));
}

/** Confirmed · cancelled (with the reason) · no-show. */
export async function setReservationStatusAction(input: { id: string; to: "CONFIRMED" | "CANCELLED" | "NO_SHOW"; reason?: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    const to = z.enum(["CONFIRMED", "CANCELLED", "NO_SHOW"]).parse(input.to);
    await deskBooking(user, Id.parse(input.id));
    await setTableReservationStatus(Id.parse(input.id), to, { reason: z.string().trim().max(200).optional().parse(input.reason) }, await actor(user));
    refresh();
    return null;
  }, input.to === "CONFIRMED" ? msg("Confirmed.") : input.to === "CANCELLED" ? msg("Reservation cancelled.") : msg("Marked as no-show."));
}

/** Give the reservation another table (the move is kept). */
export async function moveReservationAction(input: { id: string; locationId: string; reason?: string }): Promise<ActionResult<{ from: string; to: string }>> {
  return runAction(async () => {
    const user = await authorize("restaurant.orders", "restaurant.serve");
    await deskBooking(user, Id.parse(input.id));
    const r = await moveTableReservation(Id.parse(input.id), Id.parse(input.locationId), { reason: z.string().trim().max(200).optional().parse(input.reason) }, await actor(user));
    refresh();
    return r;
  });
}
