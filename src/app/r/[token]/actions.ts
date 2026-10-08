"use server";

import { z } from "zod";
import { msg } from "@/i18n/msg";
import { requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { assertCanPayOnline, payForNewOrder, payStayBillOnline } from "@/server/services/online-pay";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { rememberGuestLanguage } from "@/i18n/server";
import { askFromRoomQr, placeRoomQrOrder } from "@/server/services/room-qr";

const Order = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{8,24}$/),
  items: z.array(z.object({ menuItemId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(20) })).min(1, msg("Add something from the menu.")).max(30),
  notes: z.string().trim().max(300).optional(),
  /** Common requests ticked (ORDER_REQUESTS codes — unknown ones are dropped on the server). */
  noteCodes: z.array(z.string().max(40)).max(20).optional(),
  clientKey: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  /** "Pay online" (nTZS): the mobile-money number the payment request goes to. */
  payOnline: z.object({ phone: z.string().trim().min(9).max(30) }).optional(),
});

/** An order from the room's QR: for whoever is checked in to that room now (found on the server). */
export async function placeRoomQrOrderAction(input: z.input<typeof Order>): Promise<ActionResult<{ number: string; total: number; track: string | null; pay: string | null; payError: string | null }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    // Guests on the hotel Wi-Fi share one address: a loose limit per address, the real one per room card.
    await rateLimit(`room-qr-order-ip:${ipAddress ?? "unknown"}`, 60, 600);
    const d = parseInput(Order, input);
    await rateLimit(`room-qr-order:${d.token}`, 10, 600);
    if (d.payOnline) {
      if (!d.clientKey) throw new AppError("Please try again.", "VALIDATION");
      await assertCanPayOnline("roomService", d.payOnline.phone);
    }
    const order = await placeRoomQrOrder(d.token, { items: d.items, notes: d.notes, noteCodes: d.noteCodes, clientKey: d.clientKey, paidFirst: null, payOnline: !!d.payOnline });
    await rememberGuestLanguage(order.guestId); // their language for their messages (only a language they chose; never fails)
    const paying = d.payOnline ? await payForNewOrder(order, { phone: d.payOnline.phone, clientKey: d.clientKey!, ip: ipAddress }) : null;
    return { number: order.number, total: order.total, track: order.trackToken, pay: paying?.pay ?? null, payError: paying?.payError ?? null };
  });
}

const TOKEN = /^[A-Za-z0-9_-]{8,24}$/;
const Ask = z.object({
  token: z.string().regex(TOKEN),
  type: z.enum(["TOWELS", "CLEANING", "MAINTENANCE", "GENERAL"]),
  description: z.string().trim().max(300).optional(),
  clientKey: z.string().regex(/^[a-f0-9]{32}$/).optional(),
});

/** The guest asks reception for something (towels, cleaning, a repair…) — it lands on Requests for someone to accept. */
export async function askFromRoomQrAction(input: z.input<typeof Ask>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    // Guests on the hotel Wi-Fi share one address: a loose limit per address, the real one per stay link / room card.
    await rateLimit(`room-qr-ask-ip:${ipAddress ?? "unknown"}`, 60, 600);
    const d = parseInput(Ask, input);
    await rateLimit(`room-qr-ask:${d.token}`, 10, 600);
    const r = await askFromRoomQr(d.token, { type: d.type, description: d.description, clientKey: d.clientKey });
    return { id: r.id };
  });
}

const PayBill = z.object({ phone: z.string().trim().min(9, msg("Enter your mobile-money number.")).max(30), clientKey: z.string().regex(/^[a-f0-9]{32}$/) });

/** "Pay online" for the bill of the guest staying in this room (from the room's QR card): what is owed, worked out on the server. */
export async function payRoomBillOnlineAction(token: string, input: z.input<typeof PayBill>): Promise<ActionResult<{ pay: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    const d = parseInput(PayBill, input);
    const r = await payStayBillOnline({ roomQrToken: z.string().regex(TOKEN).parse(token) }, { phone: d.phone, clientKey: d.clientKey, ip: ipAddress });
    return { pay: r.token };
  });
}
