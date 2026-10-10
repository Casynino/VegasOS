"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { correctSaleAccount, recordSale, voidSale } from "@/server/services/outlets";
import { postRoomCharges } from "@/server/services/payments";
import { db } from "@/server/db";
import { msg } from "@/i18n/msg";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}

export async function recordSaleAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("revenue.record");
    const d = parseInput(z.object({
      categoryId: z.string().min(1, msg("Choose where the sale was made.")),
      amount: z.coerce.number().int(msg("Whole shillings only.")).positive(msg("Enter an amount.")),
      accountId: z.string().min(1, msg("Choose where the money was received.")),
      description: z.string().trim().max(200).optional(),
      notes: z.string().trim().max(500).optional(),
    }), formData);
    if (d.accountId.startsWith("room:")) {
      // Charged to a guest's room: it goes on their bill (and counts as restaurant/bar income), paid at checkout.
      const category = await db.revenueCategory.findUniqueOrThrow({ where: { id: d.categoryId } });
      const reservationId = d.accountId.slice(5);
      await postRoomCharges({
        reservationId,
        lines: [{ type: category.kind === "BAR" ? "BAR" : category.kind === "RESTAURANT" ? "RESTAURANT" : "OTHER", item: d.description || category.name, qty: 1, unitPrice: d.amount }],
      }, await actor(user));
      revalidatePath("/staff/sales");
      revalidatePath(`/staff/reservations/${reservationId}`);
      return null;
    }
    await recordSale(d, await actor(user));
    revalidatePath("/staff/sales");
    return null;
  }, msg("Sale recorded."));
}

export async function correctSaleAccountAction(input: { id: string; accountId: string }) {
  return runAction(async () => {
    const user = await authorize("revenue.record");
    await correctSaleAccount(input, await actor(user));
    revalidatePath("/staff/sales");
    revalidatePath("/staff/payments");
    revalidatePath("/staff/finance", "layout");
    return null;
  }, msg("Sale corrected — the amount is unchanged."));
}

export async function voidSaleAction(input: { id: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("revenue.void");
    await voidSale(input.id, input.reason ?? "", await actor(user));
    revalidatePath("/staff/sales");
    return null;
  }, msg("Sale voided."));
}
