import "server-only";
import { db, type Tx } from "../db";
import { fromDbDate, toDbDate } from "@/lib/time/business-date";
import { priceNight, type NightPrice, type PriceRuleLite, type PromoChannel, type PromoRule } from "@/lib/pricing";

/**
 * PricingService — the ONE place that decides what a room night costs.
 * Website, reception, check-in, extensions, checkout and reports all go
 * through here: base price (room type) − the one applicable promotion −
 * any manual discount. Prices are always worked out on the server.
 */

type Client = Tx | typeof db;

/** Which promotions a booking channel sees: the guest's own bookings (website, Hotel QR) vs staff bookings. */
export function channelFor(sourceCode: string): PromoChannel {
  return sourceCode === "WEBSITE" || sourceCode === "HOTEL_QR" ? "WEBSITE" : "STAFF";
}

/** Active promotions touching any night in [from, to] (inclusive business dates). */
export async function loadPromotions(client: Client, from: string, to: string): Promise<PromoRule[]> {
  const rows = await client.promotion.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: toDbDate(to) } }] },
        { OR: [{ endDate: null }, { endDate: { gte: toDbDate(from) } }] },
      ],
    },
  });
  return rows.map((p) => ({
    id: p.id, name: p.name, type: p.type, value: p.value, scope: p.scope,
    roomTypeIds: p.roomTypeIds, roomIds: p.roomIds, channel: p.channel,
    startDate: p.startDate ? fromDbDate(p.startDate) : null,
    endDate: p.endDate ? fromDbDate(p.endDate) : null,
    daysOfWeek: p.daysOfWeek, priority: p.priority,
  }));
}

/** Active date prices (weekend, holiday, season) touching any night in [from, to]. */
export async function loadPriceRules(client: Client, from: string, to: string): Promise<PriceRuleLite[]> {
  const rows = await client.priceRule.findMany({ where: { isActive: true, startDate: { lte: toDbDate(to) }, endDate: { gte: toDbDate(from) } } });
  return rows.map((r) => ({
    id: r.id, name: r.name, scope: r.scope, roomTypeIds: r.roomTypeIds, roomIds: r.roomIds, price: r.price,
    startDate: fromDbDate(r.startDate), endDate: fromDbDate(r.endDate), daysOfWeek: r.daysOfWeek, priority: r.priority,
  }));
}

/** Promotions and date prices for a range, in one go. */
export async function loadPricing(client: Client, from: string, to: string) {
  const [promos, rules] = await Promise.all([loadPromotions(client, from, to), loadPriceRules(client, from, to)]);
  return { promos, rules };
}

export interface StayQuote {
  nights: NightPrice[];
  base: number; // per night (first night)
  gross: number;
  promoDiscount: number;
  manualDiscount: number;
  net: number;
  /** The promotion on the first night (for display); null when none. */
  promotion: { id: string; name: string } | null;
  promoPerNight: number;
}

/** Price the given nights of one room. `roomId` null = "any room of this type" (room-only promotions ignored). */
export function quoteFromPromos(input: {
  dates: string[]; base: number; roomTypeId: string; roomId: string | null; channel: PromoChannel; promos: PromoRule[]; rules?: PriceRuleLite[]; manual?: number;
}): StayQuote {
  const nights = input.dates.map((date) => priceNight({ ...input, date }));
  const sum = (k: "base" | "promoDiscount" | "manualDiscount" | "net") => nights.reduce((s, n) => s + n[k], 0);
  return {
    nights,
    base: nights[0]?.base ?? input.base,
    gross: sum("base"),
    promoDiscount: sum("promoDiscount"),
    manualDiscount: sum("manualDiscount"),
    net: sum("net"),
    promotion: nights[0]?.promotion ?? null,
    promoPerNight: nights[0]?.promoDiscount ?? 0,
  };
}

/** Load promotions and date prices, and price the nights in one go. */
export async function quoteStay(client: Client, input: {
  dates: string[]; base: number; roomTypeId: string; roomId: string | null; channel: PromoChannel; manual?: number;
}): Promise<StayQuote> {
  if (!input.dates.length) return quoteFromPromos({ ...input, promos: [] });
  const sorted = [...input.dates].sort();
  const { promos, rules } = await loadPricing(client, sorted[0], sorted[sorted.length - 1]);
  return quoteFromPromos({ ...input, promos, rules });
}
