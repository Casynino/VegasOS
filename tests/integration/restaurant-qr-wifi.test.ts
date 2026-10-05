import { randomInt } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guests behind the hotel / restaurant Wi-Fi share one public address (owner, 2026-10-05): the restaurant QRs and the
 * payment page never stop working for everyone because a few guests on that address ordered or paid.
 */
const { IP } = vi.hoisted(() => ({ IP: `41.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}` })); // fresh each run: rate buckets survive resets
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": IP, "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import { placeOnlineOrderAction } from "@/app/order/actions";
import { resetBusinessData } from "../support/helpers";

const BEER = "mi_beers_safari";
const key = () => Array.from({ length: 32 }, () => "0123456789abcdef"[randomInt(16)]).join("");
const phone = () => `07${randomInt(10_000_000, 99_999_999)}`;

describe("restaurant ordering on the shared hotel Wi-Fi", () => {
  beforeEach(async () => {
    await resetBusinessData();
    await db.menuItem.updateMany({ where: { id: BEER }, data: { isAvailable: true, isActive: true } });
    await db.hotelSettings.updateMany({ data: { publicOrderingEnabled: true } });
  });

  it("20 different guests on one public address can each order within 10 minutes", async () => {
    for (let i = 0; i < 20; i++) {
      const r = await placeOnlineOrderAction({ clientKey: key(), items: [{ menuItemId: BEER, quantity: 1 }], name: `Guest ${i}`, phone: phone(), kind: "DINE_IN" });
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
    }
  });
});
