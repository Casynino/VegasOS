"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { identifyCustomer, placeOnlineOrder, storePaymentProof } from "@/server/services/online-orders";
import { addItemsByTrackToken } from "@/server/services/restaurant-locations";
import { assertCanPayOnline, payForNewOrder, payOrderOnline } from "@/server/services/online-pay";

const Order = z.object({
  clientKey: z.string().regex(/^[a-f0-9]{32}$/),
  items: z.array(z.object({ menuItemId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(20) })).min(1, "Add something from the menu.").max(30),
  notes: z.string().trim().max(300).optional(),
  name: z.string().trim().max(80).optional(), // blank: a returning customer, named from their phone
  phone: z.string().trim().min(7, "Please enter your phone number.").max(30),
  email: z.union([z.literal(""), z.email("Enter a valid email.").max(160)]).optional(),
  kind: z.enum(["DINE_IN", "TAKEAWAY", "PICKUP"]),
  tableLabel: z.string().trim().max(40).optional(),
  /** Eating here at a free table they picked. */
  tableId: z.string().min(1).max(40).optional(),
  deliveryAddress: z.string().trim().max(200).optional(),
  paidFirst: z.object({ proofId: z.string().min(1).max(40), accountId: z.string().min(1).max(40), reference: z.string().trim().max(60).optional(), expectedTotal: z.number().int().nonnegative().max(100_000_000).optional() }).optional(),
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
    await rateLimit(`online-order:${ipAddress ?? "unknown"}`, 12, 600);
    const d = parseInput(Order, input);
    if (d.payOnline) await assertCanPayOnline("restaurant", d.payOnline.phone);
    const order = await placeOnlineOrder({
      clientKey: d.clientKey, items: d.items, notes: d.notes, name: d.name, phone: d.phone, email: d.email || null,
      kind: d.kind, tableLabel: d.tableLabel, tableId: d.tableId, deliveryAddress: d.deliveryAddress, paidFirst: d.payOnline ? null : d.paidFirst, fromQr: d.fromQr, payOnline: !!d.payOnline,
    });
    const paying = d.payOnline ? await payForNewOrder(order, { phone: d.payOnline.phone, clientKey: d.clientKey, ip: ipAddress }) : null;
    revalidatePath("/staff/restaurant", "layout");
    return { number: order.number, track: order.trackToken!, pay: paying?.pay ?? null, payError: paying?.payError ?? null };
  });
}

const PayOrder = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,40}$/),
  phone: z.string().trim().min(9, "Enter your mobile-money number.").max(30),
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

/** Take out is paid first: the customer adds the screenshot of their payment (a photo, kept for staff only). */
export async function uploadPaymentProofAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`pay-proof:${ipAddress ?? "unknown"}`, 15, 600);
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("Add a screenshot of your payment.", "VALIDATION", { proof: "Required" });
    return storePaymentProof(file);
  });
}

const More = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{12,40}$/),
  items: z.array(z.object({ menuItemId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(20) })).min(1, "Add something from the menu.").max(30),
});

/** The customer adds more to their own open order (from their order link): same order, the kitchen gets the new items. */
export async function addItemsByTrackAction(input: z.input<typeof More>): Promise<ActionResult<{ total: number }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`order-more:${ipAddress ?? "unknown"}`, 12, 600);
    const d = parseInput(More, input);
    const o = await addItemsByTrackToken(d.token, d.items);
    revalidatePath("/staff/restaurant", "layout");
    return { total: o.total };
  });
}
