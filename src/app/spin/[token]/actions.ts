"use server";

import { z } from "zod";
import { getCurrentUser, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { beginSpin, claimGift, declineGift, spinOnce, type SpinOutcome } from "@/server/services/spin";
import type { SpinWhere } from "@/lib/spin";

const token = z.string().regex(/^[A-Za-z0-9_-]{8,24}$/);
const Spin = z.object({ token, clientKey: z.string().regex(/^[a-f0-9]{32}$/) });
const Claim = z.object({ token, resultId: z.string().min(1).max(40), where: z.enum(["ROOM", "RESTAURANT"]), sameForAll: z.boolean() });
const Decline = z.object({ token, resultId: z.string().min(1).max(40) });

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

/** Where the guest would like the gift they just won. */
export async function claimGiftAction(input: z.input<typeof Claim>): Promise<ActionResult<{ where: SpinWhere; orderNumber: string | null }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`spin-ip:${ipAddress ?? "unknown"}`, 120, 600);
    const d = parseInput(Claim, input);
    await rateLimit(`spin-claim:${d.token}`, 30, 600);
    await guestOnly();
    return claimGift(d.token, d.resultId, d.where, d.sameForAll, new Date(), ipAddress);
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

/** "No, thank you" — the guest does not want this gift. Nothing is ordered; the spin stays used. */
export async function declineGiftAction(input: z.input<typeof Decline>): Promise<ActionResult<{ declined: boolean }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`spin-ip:${ipAddress ?? "unknown"}`, 120, 600);
    const d = parseInput(Decline, input);
    await rateLimit(`spin-claim:${d.token}`, 30, 600);
    await guestOnly();
    return declineGift(d.token, d.resultId, new Date(), ipAddress);
  });
}
