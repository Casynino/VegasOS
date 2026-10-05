"use server";

import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { runAction } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { rateLimit } from "@/server/rate-limit";
import { cancelCustomerPayment, customerPaymentByToken, retryCustomerPayment } from "@/server/services/online-pay";

const Token = z.string().regex(/^[A-Za-z0-9_-]{16,40}$/);

/** The payment page asks every few seconds: paid, not completed, or still waiting. */
export async function payStatusAction(input: { token: string }) {
  return runAction(async () => {
    const { token } = parseInput(z.object({ token: Token }), input);
    const { ipAddress } = await requestMeta();
    // Each payment page asks every few seconds while it waits: counted per payment — and only loosely per address (guests
    // on the hotel Wi-Fi share one), so one guest's page never stops another's from turning "paid".
    await rateLimit(`pay-status:${token}`, 300, 600);
    await rateLimit(`pay-status:ip:${ipAddress ?? "unknown"}`, 2000, 600);
    const view = await customerPaymentByToken(token, { check: true });
    if (!view) throw new Error("Payment not found.");
    return view;
  });
}

/** The customer stops waiting. */
export async function cancelPayAction(input: { token: string }) {
  return runAction(async () => {
    const { token } = parseInput(z.object({ token: Token }), input);
    await cancelCustomerPayment(token);
    return null;
  });
}

/** "Try again": a new payment request for the same bill (optionally to another number). Returns its page. */
export async function retryPayAction(input: { token: string; phone?: string; clientKey: string }) {
  return runAction(async () => {
    const d = parseInput(z.object({ token: Token, phone: z.string().trim().max(30).optional(), clientKey: z.string().min(8).max(80) }), input);
    const { ipAddress } = await requestMeta();
    return retryCustomerPayment(d.token, { phone: d.phone || null, clientKey: d.clientKey, ip: ipAddress });
  });
}
