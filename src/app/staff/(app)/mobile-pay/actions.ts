"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, can, getCurrentUser, requestMeta, type CurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { AppError, runAction } from "@/server/errors";
import { msg } from "@/i18n/msg";
import { parseInput } from "@/server/validation";
import { deskOnlyHotelOrders } from "@/server/desk";
import { ntzsEnabled } from "@/server/services/ntzs";
import { cancelMobilePayment, checkMobilePayment, maskPhone, requestMobilePayment, resolveMobilePaymentAttention } from "@/server/services/mobile-payments";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, role: user.roleName, ipAddress, permissions: user.permissions };
}
function refresh(reservationId?: string | null) {
  revalidatePath("/staff", "layout");
  revalidatePath("/reception/dashboard");
  if (reservationId) revalidatePath(`/staff/reservations/${reservationId}`);
}
const view = (mp: { id: string; status: string; amount: number; phone: string; lastError: string | null }) =>
  ({ id: mp.id, status: mp.status, amount: mp.amount, phone: maskPhone(mp.phone), note: mp.lastError });

/** Whether "Send to phone" is offered here: nTZS is set up and this person takes payments. */
export async function mobilePayAvailableAction(): Promise<boolean> {
  const user = await getCurrentUser();
  return !!user && ntzsEnabled() && (can(user, "payments.record") || can(user, "revenue.record"));
}

/** Reception: a prompt for the guest's bill (their phone on file when none is typed). */
export async function sendStayPromptAction(input: { reservationId: string; amount: number; phone?: string }) {
  return runAction(async () => {
    const user = await authorize("payments.record");
    const d = parseInput(z.object({ reservationId: z.string().min(1).max(40), amount: z.coerce.number().int().positive(msg("Enter the amount.")), phone: z.string().trim().max(30).optional() }), input);
    let phone = d.phone;
    if (!phone) phone = (await db.reservation.findUnique({ where: { id: d.reservationId }, select: { guest: { select: { phone: true } } } }))?.guest.phone ?? "";
    if (!phone) throw new AppError("Enter the guest's phone number.", "VALIDATION", { phone: msg("Required") });
    const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: d.reservationId, amount: d.amount }, phone, await actor(user));
    return { ...view(mp), instructions: mp.instructions };
  });
}

/** The Restaurant Counter / reception: a prompt for an order or a table's bill (the whole amount still due). */
export async function sendOrdersPromptAction(input: { orderIds: string[]; phone: string; handedOverById?: string | null }) {
  return runAction(async () => {
    const user = await authorize("revenue.record");
    const d = parseInput(z.object({ orderIds: z.array(z.string().min(1).max(40)).min(1).max(60), phone: z.string().trim().min(1, msg("Enter the customer's mobile-money number.")).max(30), handedOverById: z.string().max(40).nullable().optional() }), input);
    await deskOnlyHotelOrders(user, d.orderIds);
    const mp = await requestMobilePayment({ purpose: "RESTAURANT", orderIds: d.orderIds, handedOverById: d.handedOverById ?? null }, d.phone, await actor(user));
    return { ...view(mp), instructions: mp.instructions };
  });
}

/** The waiting screen asks every few seconds: paid, refused, or still waiting. */
export async function promptStatusAction(input: { id: string }) {
  return runAction(async () => {
    await authorize("payments.record", "revenue.record");
    const { id } = parseInput(z.object({ id: z.string().min(1).max(40) }), input);
    const before = await db.mobilePayment.findUnique({ where: { id }, select: { status: true } });
    const mp = await checkMobilePayment(id);
    if (mp.status === "COMPLETED" && before?.status !== "COMPLETED") refresh(mp.reservationId);
    return view(mp);
  });
}

/** Stop waiting (the customer pays another way). Money that still comes in is recorded all the same. */
export async function cancelPromptAction(input: { id: string }) {
  return runAction(async () => {
    const user = await authorize("payments.record", "revenue.record");
    const { id } = parseInput(z.object({ id: z.string().min(1).max(40) }), input);
    return view(await cancelMobilePayment(id, await actor(user)));
  }, msg("Stopped waiting for the payment."));
}

/** Mobile money that needed a person was dealt with (refunded, recorded by hand, put on another bill) — with a note. */
export async function resolveMobileAttentionAction(input: { id: string; note: string }) {
  return runAction(async () => {
    const user = await authorize("payments.record", "revenue.record");
    const d = parseInput(z.object({ id: z.string().min(1).max(40), note: z.string().trim().min(3, msg("Say what was done (e.g. refunded to the guest).")).max(300) }), input);
    await resolveMobilePaymentAttention(d.id, d.note, await actor(user));
    refresh();
    return null;
  }, msg("Marked as dealt with."));
}
