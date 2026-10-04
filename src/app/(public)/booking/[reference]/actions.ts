"use server";

import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { payBookingOnline } from "@/server/services/online-pay";

const Pay = z.object({
  reference: z.string().regex(/^VLH-[A-Z0-9]{4,12}$/),
  token: z.string().min(16).max(200),
  phone: z.string().trim().min(9, "Enter your mobile-money number.").max(30),
  clientKey: z.string().regex(/^[a-f0-9]{32}$/),
});

/** "Pay online" from the booking's private page: what is owed, worked out on the server. Returns the payment page. */
export async function payBookingOnlineAction(input: z.input<typeof Pay>): Promise<ActionResult<{ pay: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    const d = parseInput(Pay, input);
    const r = await payBookingOnline(d.reference, d.token, { phone: d.phone, clientKey: d.clientKey, ip: ipAddress });
    return { pay: r.token };
  });
}
