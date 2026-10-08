"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { acceptServiceRequest, createServiceRequest, updateServiceRequest } from "@/server/services/requests";
import { msg } from "@/i18n/msg";

function refresh(reservationId?: string | null) {
  revalidatePath("/staff/requests");
  revalidatePath("/staff");
  if (reservationId) revalidatePath(`/staff/reservations/${reservationId}`);
}

export async function createRequestAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("requests.manage");
    const d = parseInput(z.object({
      reservationId: z.string().optional(),
      roomId: z.string().optional(),
      type: z.enum(["TOWELS", "CLEANING", "MAINTENANCE", "RESTAURANT", "TRANSPORT", "GENERAL", "OTHER", "COMPLAINT"]),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
      description: z.string().trim().min(2, msg("Describe the request.")).max(500),
      assignedToId: z.string().optional(),
    }), formData);
    const { ipAddress } = await requestMeta();
    await createServiceRequest({ ...d, reservationId: d.reservationId || null, roomId: d.roomId || null, assignedToId: d.assignedToId || null }, { userId: user.id, label: user.fullName, ipAddress });
    refresh(d.reservationId);
    return null;
  }, msg("Request logged."));
}

export async function updateRequestAction(input: { id: string; status?: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"; assignedToId?: string | null; reservationId?: string | null; resolution?: string | null }) {
  return runAction(async () => {
    const user = await authorize("requests.manage");
    const { ipAddress } = await requestMeta();
    await updateServiceRequest(input.id, { status: input.status, assignedToId: input.assignedToId, resolution: input.resolution?.slice(0, 500) ?? null }, { userId: user.id, label: user.fullName, ipAddress });
    refresh(input.reservationId);
    return null;
  }, msg("Request updated."));
}

/** "I'm on it": the request becomes the person's own, in progress. */
export async function acceptRequestAction(input: { id: string; reservationId?: string | null }) {
  return runAction(async () => {
    const user = await authorize("requests.manage");
    const { ipAddress } = await requestMeta();
    await acceptServiceRequest(input.id, { userId: user.id, label: user.fullName, ipAddress });
    refresh(input.reservationId);
    return null;
  }, msg("Accepted — it's yours."));
}
