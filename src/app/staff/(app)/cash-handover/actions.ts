"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { receiveHandover, rejectHandover, resubmitHandover, returnHandover, submitHandover, type HandoverActor } from "@/server/services/cash-handover";
import type { PermissionCode } from "@/lib/permissions";
import { msg } from "@/i18n/msg";

/**
 * Cash handover — every step runs here on the server as the signed-in person. Who may do it is checked here and again
 * in the service, whatever the screen shows: reception and the Restaurant Counter hand cash over; only the Accountant
 * (and the Boss and the MD) receive, return or refuse it.
 */
async function actor(code: PermissionCode): Promise<HandoverActor> {
  const user = await authorize(code);
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}
const refresh = () => {
  revalidatePath("/staff/accountant", "layout");
  revalidatePath("/staff/collections");
  revalidatePath("/staff/finance", "layout");
};

const Amount = z.coerce.number().int(msg("Whole shillings only.")).min(0, msg("Enter the amount."));
const Note = z.string().trim().max(500).optional().transform((v) => v || null);
const Id = z.string().min(10).max(40);

export async function submitHandoverAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const who = await actor("cash.handover.submit");
    const input = parseInput(z.object({ declared: Amount, note: Note }), Object.fromEntries(formData.entries()));
    await submitHandover(input, who);
    refresh();
    return null;
  }, msg("Handover sent to the Accountant."));
}

export async function resubmitHandoverAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const who = await actor("cash.handover.submit");
    const input = parseInput(z.object({ id: Id, declared: Amount, note: Note }), Object.fromEntries(formData.entries()));
    await resubmitHandover(input.id, { declared: input.declared, note: input.note }, who);
    refresh();
    return null;
  }, msg("Handover sent again."));
}

export async function receiveHandoverAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const who = await actor("cash.handover.review");
    const input = parseInput(z.object({ id: Id, received: Amount, toAccountId: z.string().max(40).optional().transform((v) => v || null), note: Note }), Object.fromEntries(formData.entries()));
    await receiveHandover(input.id, { received: input.received, toAccountId: input.toAccountId, note: input.note }, who);
    refresh();
    return null;
  }, msg("Cash received."));
}

const Reason = z.string().trim().min(5, msg("Say why — at least 5 letters.")).max(500);

export async function returnHandoverAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const who = await actor("cash.handover.review");
    const input = parseInput(z.object({ id: Id, reason: Reason }), Object.fromEntries(formData.entries()));
    await returnHandover(input.id, input.reason, who);
    refresh();
    return null;
  }, msg("Sent back to be corrected."));
}

export async function rejectHandoverAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const who = await actor("cash.handover.review");
    const input = parseInput(z.object({ id: Id, reason: Reason }), Object.fromEntries(formData.entries()));
    await rejectHandover(input.id, input.reason, who);
    refresh();
    return null;
  }, msg("Handover refused."));
}
