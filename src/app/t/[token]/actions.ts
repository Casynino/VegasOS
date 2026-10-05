"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { notifyOrderCustomer } from "@/server/services/online-orders";
import { identifyAtLocation, placeLocationOrder } from "@/server/services/restaurant-locations";
import { assertCanPayOnline, payForNewOrder, payTableBillOnline } from "@/server/services/online-pay";
import type { PlacedOrder } from "@/app/order/actions";
import { customerRequestBill, SEAT_COOKIE, SEAT_HOURS, seatAtTable } from "@/server/services/dining-sessions";

const seatToken = async () => (await cookies()).get(SEAT_COOKIE)?.value ?? null;

const Token = z.string().regex(/^[a-f0-9]{24}$/);

/** The customer says who they are: a returning customer is found by phone; an open order at this table can be continued. */
export async function identifyAtTableAction(input: { token: string; phone: string }): Promise<ActionResult<{ returning: boolean; name: string | null; active: { number: string; total: number; track: string; items: number } | null }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`table-identify:${ipAddress ?? "unknown"}`, 60, 600); // guests on the restaurant Wi-Fi share one address
    return identifyAtLocation(Token.parse(input.token), { phone: z.string().trim().max(30).parse(input.phone) });
  });
}

/**
 * At a table: the customer says who they are once — the table is theirs (or they join their own
 * table again); this phone is remembered for the rest of their meal (a private cookie).
 */
export async function startAtTableAction(input: { token: string; name?: string; phone: string }): Promise<ActionResult<{ state: "seated" | "welcome_back" | "in_use" | "reserved"; name: string | null; table: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`table-start:${ipAddress ?? "unknown"}`, 40, 600);
    const r = await seatAtTable(Token.parse(input.token), { name: z.string().trim().max(80).optional().parse(input.name), phone: z.string().trim().max(30).parse(input.phone) }, await seatToken());
    if (r.token) {
      (await cookies()).set(SEAT_COOKIE, r.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SEAT_HOURS * 3600 });
    }
    if (r.state === "seated" || r.state === "welcome_back") revalidatePath("/staff/restaurant", "layout");
    return { state: r.state, name: r.name, table: r.table };
  });
}

/** "I'm done" — the waiter brings the bill. */
export async function imDoneAction(): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    await rateLimit(`table-done:${ipAddress ?? "unknown"}`, 20, 600);
    const r = await customerRequestBill(await seatToken());
    revalidatePath("/staff/restaurant", "layout");
    return r;
  });
}

const Order = z.object({
  token: Token,
  clientKey: z.string().regex(/^[a-f0-9]{32}$/),
  items: z.array(z.object({ menuItemId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(20) })).min(1, "Add something from the menu.").max(30),
  notes: z.string().trim().max(300).optional(),
  name: z.string().trim().max(80).optional(), // blank: a returning customer, named from their phone
  phone: z.string().trim().max(30).optional(), // not needed at a table: the seated customer's details are used
  email: z.union([z.literal(""), z.email("Enter a valid email.").max(160)]).optional(),
  kind: z.enum(["DINE_IN", "TAKEAWAY", "PICKUP"]).optional(),
  where: z.string().trim().max(40).optional(),
  /** Eating here at a free table they picked. */
  tableId: z.string().min(1).max(40).optional(),
  deliveryAddress: z.string().trim().max(200).optional(),
  /** "Pay online" (nTZS): the mobile-money number the payment request goes to. */
  payOnline: z.object({ phone: z.string().trim().min(9).max(30) }).optional(),
  website: z.string().max(0).optional(), // honeypot
});

/** An order from a table / the counter / the main restaurant QR — straight to the restaurant portal. */
export async function placeTableOrderAction(input: z.input<typeof Order>): Promise<ActionResult<PlacedOrder>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    // Guests on the hotel / restaurant Wi-Fi share one address: a loose limit for it, a tighter one per place and phone
    // (and each phone can send only a few orders in half an hour — see placeLocationOrder).
    await rateLimit(`table-order:${ipAddress ?? "unknown"}`, 120, 600);
    const d = parseInput(Order, input);
    await rateLimit(`table-order:spot:${d.token}:${d.phone?.replace(/\D/g, "").slice(-9) || ipAddress || "unknown"}`, 12, 600);
    if (d.payOnline) await assertCanPayOnline("restaurant", d.payOnline.phone);
    const o = await placeLocationOrder(d.token, { clientKey: d.clientKey, items: d.items, notes: d.notes, name: d.name, phone: d.phone, email: d.email || null, kind: d.kind, where: d.where, tableId: d.tableId, deliveryAddress: d.deliveryAddress, paidFirst: null, payOnline: !!d.payOnline, seatToken: await seatToken() });
    // A table they picked is theirs now: this phone is remembered at it (like sitting down there).
    if (o.seat) (await cookies()).set(SEAT_COOKIE, o.seat, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SEAT_HOURS * 3600 });
    const paying = d.payOnline ? await payForNewOrder(o, { phone: d.payOnline.phone, clientKey: d.clientKey, ip: ipAddress }) : null;
    after(() => notifyOrderCustomer(o.id, "RECEIVED"));
    revalidatePath("/staff/restaurant", "layout");
    return { number: o.number, track: o.trackToken!, pay: paying?.pay ?? null, payError: paying?.payError ?? null };
  });
}

const PayBill = z.object({ phone: z.string().trim().min(9, "Enter your mobile-money number.").max(30), clientKey: z.string().regex(/^[a-f0-9]{32}$/) });

/** "Pay my bill online" at the table (this phone's seat): everything still due, worked out on the server. Returns the payment page. */
export async function payTableBillOnlineAction(input: z.input<typeof PayBill>): Promise<ActionResult<{ pay: string }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    const d = parseInput(PayBill, input);
    const r = await payTableBillOnline(await seatToken(), { phone: d.phone, clientKey: d.clientKey, ip: ipAddress });
    return { pay: r.token };
  });
}
