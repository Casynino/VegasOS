"use server";

import { z } from "zod";
import { requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { askFromRoomQr, placeRoomQrOrder } from "@/server/services/room-qr";

const Order = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{8,24}$/),
  items: z.array(z.object({ menuItemId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(20) })).min(1, "Add something from the menu.").max(30),
  notes: z.string().trim().max(300).optional(),
  clientKey: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  paidFirst: z.object({ proofId: z.string().min(1).max(40), accountId: z.string().min(1).max(40), reference: z.string().trim().max(60).optional(), expectedTotal: z.number().int().nonnegative().max(100_000_000).optional() }).optional(),
});

/** An order from the room's QR: for whoever is checked in to that room now (found on the server). */
export async function placeRoomQrOrderAction(input: z.input<typeof Order>): Promise<ActionResult<{ number: string; total: number; track: string | null }>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    // Guests on the hotel Wi-Fi share one address: a loose limit per address, the real one per room card.
    await rateLimit(`room-qr-order-ip:${ipAddress ?? "unknown"}`, 60, 600);
    const d = parseInput(Order, input);
    await rateLimit(`room-qr-order:${d.token}`, 10, 600);
    const order = await placeRoomQrOrder(d.token, { items: d.items, notes: d.notes, clientKey: d.clientKey, paidFirst: d.paidFirst });
    return { number: order.number, total: order.total, track: order.trackToken };
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
