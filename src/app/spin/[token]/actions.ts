"use server";

import { z } from "zod";
import { getCurrentUser, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { beginSpin, sendGifts, spinOnce, type SpinOutcome } from "@/server/services/spin";

const token = z.string().regex(/^[A-Za-z0-9_-]{8,24}$/);
const Spin = z.object({ token, clientKey: z.string().regex(/^[a-f0-9]{32}$/) });
const ids = z.array(z.string().min(1).max(40)).max(10);
const Send = z.object({ token, where: z.enum(["ROOM", "RESTAURANT"]), skip: ids, seen: ids });

/** The wheel is the guest's: a member of staff signed in on this phone looks, and does not spin. */
async function guestOnly() {
  if (await getCurrentUser()) throw new AppError("Spins are for the guest staying in the room — staff cannot spin.", "FORBIDDEN");
}

/** One spin of the room's wheel — for whoever is checked in to that room now (found on the server, never sent by the phone). */
export async function spinAction(input: z.input<typeof Spin>): Promise<ActionResult<SpinOutcome>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    // Guests on the hotel Wi-Fi share one address: a loose limit per address, the real one per room card.
    await rateLimit(`spin-ip:${ipAddress ?? "unknown"}`, 120, 600);
    const d = parseInput(Spin, input);
    await rateLimit(`spin:${d.token}`, 30, 600);
    await guestOnly();
    return spinOnce(d.token, d.clientKey, new Date(), ipAddress);
  });
}

/**
 * The guest has finished: all the gifts they won go to the restaurant together, as one order — to the room or to
 * enjoy at the restaurant. `skip` = the gifts they said "no, thank you" to; `seen` = every waiting gift the page showed.
 */
export async function sendGiftsAction(input: z.input<typeof Send>): Promise<ActionResult<{ sent: number; skipped: number; orderNumber: string | null }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`spin-ip:${ipAddress ?? "unknown"}`, 120, 600);
    const d = parseInput(Send, input);
    await rateLimit(`spin-claim:${d.token}`, 30, 600);
    await guestOnly();
    return sendGifts(d.token, d.where, d.skip, new Date(), ipAddress, d.seen);
  });
}

/** The guest has read the welcome — it is not shown again. */
export async function beginSpinAction(input: { token: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`spin-ip:${ipAddress ?? "unknown"}`, 120, 600);
    const d = parseInput(z.object({ token }), input);
    if (!(await getCurrentUser())) await beginSpin(d.token);
    return null;
  });
}
