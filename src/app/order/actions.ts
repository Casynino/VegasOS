"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { msg } from "@/i18n/msg";
import { requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { identifyCustomer, placeOnlineOrder } from "@/server/services/online-orders";
import { addItemsByTrackToken } from "@/server/services/restaurant-locations";
import { assertCanPayOnline, payForNewOrder, payOrderOnline } from "@/server/services/online-pay";
import { SEAT_COOKIE, SEAT_HOURS } from "@/server/services/dining-core";
import { rememberGuestLanguage } from "@/i18n/server";

const Order = z.object({
  clientKey: z.string().regex(/^[a-f0-9]{32}$/),
  items: z.array(z.object({ menuItemId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(20) })).min(1, msg("Add something from the menu.")).max(30),
  notes: z.string().trim().max(300).optional(),
  /** Common requests ticked (ORDER_REQUESTS codes — unknown ones are dropped on the server). */
  noteCodes: z.array(z.string().max(40)).max(20).optional(),
  name: z.string().trim().max(80).optional(), // blank: a returning customer, named from their phone
  phone: z.string().trim().min(7, msg("Please enter your phone number.")).max(30),
  email: z.union([z.literal(""), z.email(msg("Enter a valid email.")).max(160)]).optional(),
  kind: z.enum(["DINE_IN", "TAKEAWAY", "PICKUP"]),
  tableLabel: z.string().trim().max(40).optional(),
  /** Eating here at a free table they picked. */
  tableId: z.string().min(1).max(40).optional(),
  deliveryAddress: z.string().trim().max(200).optional(),
  fromQr: z.boolean().optional(),
  /** "Pay online" (nTZS): the mobile-money number the payment request goes to. */
  payOnline: z.object({ phone: z.string().trim().min(9).max(30) }).optional(),
  website: z.string().max(0).optional(), // honeypot
});

/** What placing an order answers: the order, and — paying online — the payment page to go to (or why it did not start). */
export type PlacedOrder = { number: string; track: string; pay: string | null; payError: string | null };

/** A public customer orders from the menu (website or public menu QR): one order, straight to reception and the kitchen. */
export async function placeOnlineOrderAction(input: z.input<typeof Order>): Promise<ActionResult<PlacedOrder>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    // Guests on the hotel / restaurant Wi-Fi share one address: a loose limit for it, a tighter one per phone (and each
    // phone can send only a few orders in half an hour — see placeOnlineOrder).
    await rateLimit(`online-order:${ipAddress ?? "unknown"}`, 120, 600);
    const d = parseInput(Order, input);
    await rateLimit(`online-order:phone:${d.phone.replace(/\D/g, "").slice(-9) || "unknown"}`, 12, 600);
    if (d.payOnline) await assertCanPayOnline("restaurant", d.payOnline.phone);
    const order = await placeOnlineOrder({
      clientKey: d.clientKey, items: d.items, notes: d.notes, noteCodes: d.noteCodes, name: d.name, phone: d.phone, email: d.email || null,
      kind: d.kind, tableLabel: d.tableLabel, tableId: d.tableId, deliveryAddress: d.deliveryAddress, paidFirst: null, fromQr: d.fromQr, payOnline: !!d.payOnline,
    });
    // A table they picked is theirs now: this phone is remembered at it (like sitting down there).
    if (order.seat) (await cookies()).set(SEAT_COOKIE, order.seat, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SEAT_HOURS * 3600 });
    await rememberGuestLanguage(order.guestId); // their language for their messages (only a language they chose; never fails)
    const paying = d.payOnline ? await payForNewOrder(order, { phone: d.payOnline.phone, clientKey: d.clientKey, ip: ipAddress }) : null;
    revalidatePath("/staff/restaurant", "layout");
    return { number: order.number, track: order.trackToken!, pay: paying?.pay ?? null, payError: paying?.payError ?? null };
  });
}

const PayOrder = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,40}$/),
  phone: z.string().trim().min(9, msg("Enter your mobile-money number.")).max(30),
  clientKey: z.string().regex(/^[a-f0-9]{32}$/),
});

/** "Pay online" for an order already placed (its own page): the payment page to go to. */
export async function payOrderOnlineAction(input: z.input<typeof PayOrder>): Promise<ActionResult<{ pay: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    const d = parseInput(PayOrder, input);
    const r = await payOrderOnline(d.token, { phone: d.phone, clientKey: d.clientKey, ip: ipAddress });
    return { pay: r.token };
  });
}

/** Before the first item goes in the order: who is ordering? A returning customer is greeted by name. */
export async function identifyCustomerAction(input: { phone: string }): Promise<ActionResult<{ name: string | null }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`order-identify:${ipAddress ?? "unknown"}`, 60, 600);
    return identifyCustomer(z.string().trim().max(30).parse(input.phone));
  });
}

const More = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,40}$/),
  items: z.array(z.object({ menuItemId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(20) })).min(1, msg("Add something from the menu.")).max(30),
});

/** The customer adds more to their own open order (from their order link): same order, the kitchen gets the new items. */
export async function addItemsByTrackAction(input: z.input<typeof More>): Promise<ActionResult<{ total: number }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`order-more:${ipAddress ?? "unknown"}`, 120, 600); // guests on the Wi-Fi share one address
    const d = parseInput(More, input);
    await rateLimit(`order-more:track:${d.token}`, 12, 600); // each order's own link
    const o = await addItemsByTrackToken(d.token, d.items);
    revalidatePath("/staff/restaurant", "layout");
    return { total: o.total };
  });
}
