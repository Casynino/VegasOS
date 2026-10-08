"use server";

import { revalidatePath } from "next/cache";
import { authorize, requestMeta } from "@/server/auth";
import { runAction } from "@/server/errors";
import { generateThankYouNote } from "@/server/services/thank-you";
import { db } from "@/server/db";
import { msg } from "@/i18n/msg";

/**
 * Make the thank-you note: the first one (a stay checked out before notes existed) by reception,
 * or again after an authorized correction — a manager, with a reason; earlier versions are kept.
 */
export async function makeThankYouAction(input: { reservationId: string; reason?: string }) {
  return runAction(async () => {
    const existing = await db.thankYouNote.count({ where: { reservationId: input.reservationId } });
    const user = existing ? await authorize("reservations.checkout_override", "invoices.manage") : await authorize("reservations.check_out", "reservations.view");
    const { ipAddress } = await requestMeta();
    const note = await generateThankYouNote(input.reservationId, { userId: user.id, label: user.fullName, ipAddress }, input.reason ?? null);
    revalidatePath(`/staff/reservations/${input.reservationId}`);
    return { version: note.version };
  }, msg("Thank-you note ready."));
}
