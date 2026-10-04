"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { identifyCustomer, placeOnlineOrder, storePaymentProof } from "@/server/services/online-orders";
import { addItemsByTrackToken } from "@/server/services/restaurant-locations";

const Order = z.object({
  clientKey: z.string().regex(/^[a-f0-9]{32}$/),
  items: z.array(z.object({ menuItemId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(20) })).min(1, "Add something from the menu.").max(30),
  notes: z.string().trim().max(300).optional(),
  name: z.string().trim().max(80).optional(), // blank: a returning customer, named from their phone
  phone: z.string().trim().min(7, "Please enter your phone number.").max(30),
  email: z.union([z.literal(""), z.email("Enter a valid email.").max(160)]).optional(),
  kind: z.enum(["DINE_IN", "TAKEAWAY", "PICKUP"]),
  tableLabel: z.string().trim().max(40).optional(),
  deliveryAddress: z.string().trim().max(200).optional(),
  paidFirst: z.object({ proofId: z.string().min(1).max(40), accountId: z.string().min(1).max(40), reference: z.string().trim().max(60).optional(), expectedTotal: z.number().int().nonnegative().max(100_000_000).optional() }).optional(),
  fromQr: z.boolean().optional(),
  website: z.string().max(0).optional(), // honeypot
});

/** A public customer orders from the menu (website or public menu QR): one order, straight to reception and the kitchen. */
export async function placeOnlineOrderAction(input: z.input<typeof Order>): Promise<ActionResult<{ number: string; track: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`online-order:${ipAddress ?? "unknown"}`, 12, 600);
    const d = parseInput(Order, input);
    const order = await placeOnlineOrder({
      clientKey: d.clientKey, items: d.items, notes: d.notes, name: d.name, phone: d.phone, email: d.email || null,
      kind: d.kind, tableLabel: d.tableLabel, deliveryAddress: d.deliveryAddress, paidFirst: d.paidFirst, fromQr: d.fromQr,
    });
    return { number: order.number, track: order.trackToken! };
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
