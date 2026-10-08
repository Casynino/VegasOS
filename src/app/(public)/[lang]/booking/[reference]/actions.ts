"use server";

import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { payBookingOnline } from "@/server/services/online-pay";
import { db } from "@/server/db";
import { msg } from "@/i18n/msg";
import { rememberGuestLanguage } from "@/i18n/server";

const Link = z.object({ reference: z.string().regex(/^VLH-[A-Z0-9]{4,12}$/), token: z.string().min(16).max(200) });
const Pay = z.object({ phone: z.string().trim().min(9, msg("Enter your mobile-money number.")).max(30), clientKey: z.string().regex(/^[a-f0-9]{32}$/) });

/** "Pay online" from the booking's private page (bound to its link): what is owed, worked out on the server. Returns the payment page. */
export async function payBookingOnlineAction(link: z.input<typeof Link>, input: z.input<typeof Pay>): Promise<ActionResult<{ pay: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    const l = parseInput(Link, link), d = parseInput(Pay, input);
    const r = await payBookingOnline(l.reference, l.token, { phone: d.phone, clientKey: d.clientKey, ip: ipAddress });
    // Paying from their own link (checked above): their messages follow the language they chose.
    await rememberGuestLanguage((await db.reservation.findUnique({ where: { reference: l.reference }, select: { guestId: true } }))?.guestId);
    return { pay: r.token };
  });
}
