"use server";

import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { payInvoiceOnline } from "@/server/services/online-pay";

const Pay = z.object({ phone: z.string().trim().min(9, "Enter your mobile-money number.").max(30), clientKey: z.string().regex(/^[a-f0-9]{32}$/) });

/** "Pay online" for an invoice (bound to its "scan to verify" link): what is still owed, worked out on the server. Returns the payment page. */
export async function payInvoiceOnlineAction(token: string, input: z.input<typeof Pay>): Promise<ActionResult<{ pay: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    const d = parseInput(Pay, input);
    const r = await payInvoiceOnline(z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).parse(token), { phone: d.phone, clientKey: d.clientKey, ip: ipAddress });
    return { pay: r.token };
  });
}
