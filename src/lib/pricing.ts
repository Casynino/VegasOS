/**
 * PricingService (pure core). All room money is derived here from the room
 * type's rate snapshot and the per-room-per-night discount — never from
 * values supplied by a browser.
 */
export interface RoomQuoteInput {
  ratePerNight: number;
  discountPerNight: number;
  units: number; // nights, or 1 for day-use
}

export interface RoomQuote {
  ratePerNight: number;
  discountPerNight: number;
  netPerNight: number;
  units: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

export function quoteRoom({ ratePerNight, discountPerNight, units }: RoomQuoteInput): RoomQuote {
  if (!Number.isInteger(ratePerNight) || ratePerNight < 0) throw new Error("Invalid rate");
  if (!Number.isInteger(units) || units < 1) throw new Error("Invalid number of nights");
  // Discount can never exceed the rate or go negative.
  const discount = Math.min(Math.max(0, Math.trunc(discountPerNight)), ratePerNight);
  const gross = ratePerNight * units;
  const discountAmount = discount * units;
  return {
    ratePerNight,
    discountPerNight: discount,
    netPerNight: ratePerNight - discount,
    units,
    grossAmount: gross,
    discountAmount,
    netAmount: gross - discountAmount,
  };
}

export function sumQuotes(quotes: RoomQuote[]) {
  return quotes.reduce(
    (t, q) => ({
      grossAmount: t.grossAmount + q.grossAmount,
      discountAmount: t.discountAmount + q.discountAmount,
      netAmount: t.netAmount + q.netAmount,
    }),
    { grossAmount: 0, discountAmount: 0, netAmount: 0 },
  );
}

// ───────────────────────── Promotions (pure) ─────────────────────────

export type PromoChannel = "WEBSITE" | "STAFF";

export interface PromoRule {
  id: string;
  name: string;
  type: "PERCENT" | "FIXED";
  value: number;
  scope: "ALL" | "ROOM_TYPES" | "ROOMS";
  roomTypeIds: string[];
  roomIds: string[];
  channel: "ALL" | PromoChannel;
  /** First / last night it applies to (inclusive, YYYY-MM-DD); null = open. */
  startDate: string | null;
  endDate: string | null;
  /** Nights of the week (0 = Sunday … 6 = Saturday); empty = every night. */
  daysOfWeek?: number[];
  /** Higher wins. */
  priority?: number;
}

/** A date price (weekend, holiday, season): replaces the room type's normal price on the nights it covers. */
export interface PriceRuleLite {
  id: string;
  name: string;
  scope: "ALL" | "ROOM_TYPES" | "ROOMS";
  roomTypeIds: string[];
  roomIds: string[];
  price: number;
  startDate: string;
  endDate: string;
  daysOfWeek?: number[];
  priority?: number;
}

/** Day of the week of a hotel date (0 = Sunday … 6 = Saturday). */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function onNight(r: { startDate: string | null; endDate: string | null; daysOfWeek?: number[] }, date: string) {
  if (r.startDate && date < r.startDate) return false;
  if (r.endDate && date > r.endDate) return false;
  return !r.daysOfWeek?.length || r.daysOfWeek.includes(weekday(date));
}
function forRoom(r: { scope: "ALL" | "ROOM_TYPES" | "ROOMS"; roomTypeIds: string[]; roomIds: string[] }, roomTypeId: string, roomId: string | null) {
  if (r.scope === "ROOM_TYPES") return r.roomTypeIds.includes(roomTypeId);
  if (r.scope === "ROOMS") return !!roomId && r.roomIds.includes(roomId);
  return true;
}

/** TZS a promotion takes off one night at `base` (never more than the base). */
export function promoAmount(base: number, promo: Pick<PromoRule, "type" | "value">): number {
  const off = promo.type === "PERCENT" ? Math.round((base * Math.min(100, Math.max(0, promo.value))) / 100) : Math.max(0, Math.trunc(promo.value));
  return Math.min(off, base);
}

const SPECIFICITY = { ROOMS: 3, ROOM_TYPES: 2, ALL: 1 } as const;

/**
 * The one promotion that applies to a night: the highest priority wins, then
 * the most specific (a room's own > its room type's > all rooms). Promotions
 * never stack. Two promotions with the same priority are not allowed to overlap
 * (see findConflicts); as a last safety net the bigger discount wins.
 */
export function pickPromotion(
  promos: PromoRule[],
  at: { date: string; roomTypeId: string; roomId: string | null; channel: PromoChannel; base: number },
): PromoRule | null {
  let best: PromoRule | null = null;
  for (const p of promos) {
    if (p.channel !== "ALL" && p.channel !== at.channel) continue;
    if (!onNight(p, at.date) || !forRoom(p, at.roomTypeId, at.roomId)) continue;
    const pp = p.priority ?? 0, bp = best?.priority ?? 0;
    if (
      !best || pp > bp ||
      (pp === bp && (SPECIFICITY[p.scope] > SPECIFICITY[best.scope] ||
        (SPECIFICITY[p.scope] === SPECIFICITY[best.scope] && promoAmount(at.base, p) > promoAmount(at.base, best))))
    ) best = p;
  }
  return best;
}

/** The date price for a night (highest priority, then most specific), or null = the room type's normal price. */
export function pickPriceRule(rules: PriceRuleLite[], at: { date: string; roomTypeId: string; roomId: string | null }): PriceRuleLite | null {
  let best: PriceRuleLite | null = null;
  for (const r of rules) {
    if (!onNight(r, at.date) || !forRoom(r, at.roomTypeId, at.roomId)) continue;
    const rp = r.priority ?? 0, bp = best?.priority ?? 0;
    if (!best || rp > bp || (rp === bp && SPECIFICITY[r.scope] > SPECIFICITY[best.scope])) best = r;
  }
  return best;
}

export interface NightPrice {
  date: string;
  /** The room's price that night (date price if one applies, else the room type's normal price). */
  base: number;
  priceRule: { id: string; name: string } | null;
  promotion: { id: string; name: string } | null;
  promoDiscount: number;
  manualDiscount: number;
  net: number;
}

/** Price of one night: (date price or normal price) − promotion − manual discount (never below zero). */
export function priceNight(input: {
  date: string; base: number; roomTypeId: string; roomId: string | null; channel: PromoChannel; promos: PromoRule[]; rules?: PriceRuleLite[]; manual?: number;
}): NightPrice {
  const rule = input.rules?.length ? pickPriceRule(input.rules, input) : null;
  const base = rule ? rule.price : input.base;
  const promo = pickPromotion(input.promos, { ...input, base });
  const promoDiscount = promo ? promoAmount(base, promo) : 0;
  const manualDiscount = Math.min(Math.max(0, Math.trunc(input.manual ?? 0)), base - promoDiscount);
  return {
    date: input.date, base, priceRule: rule ? { id: rule.id, name: rule.name } : null, promotion: promo ? { id: promo.id, name: promo.name } : null,
    promoDiscount, manualDiscount, net: base - promoDiscount - manualDiscount,
  };
}

/**
 * Rules that would clash with `c`: same priority, same kind of target overlapping,
 * dates overlapping, days of the week overlapping (and, for promotions, the same
 * booking channel). The system refuses to save a clash instead of guessing.
 */
export function findConflicts<T extends {
  id: string; name: string; scope: "ALL" | "ROOM_TYPES" | "ROOMS"; roomTypeIds: string[]; roomIds: string[];
  startDate: string | null; endDate: string | null; daysOfWeek?: number[]; priority?: number; channel?: "ALL" | PromoChannel;
}>(c: T, others: T[], roomTypeOf: (roomId: string) => string | undefined): T[] {
  const days = (d?: number[]) => (d?.length ? d : [0, 1, 2, 3, 4, 5, 6]);
  const targets = (r: T) => ({
    all: r.scope === "ALL",
    types: new Set(r.scope === "ROOM_TYPES" ? r.roomTypeIds : r.scope === "ROOMS" ? r.roomIds.map(roomTypeOf).filter((x): x is string => !!x) : []),
    rooms: new Set(r.scope === "ROOMS" ? r.roomIds : []),
  });
  const ct = targets(c);
  return others.filter((o) => {
    if (o.id === c.id || (o.priority ?? 0) !== (c.priority ?? 0)) return false;
    if (c.channel && o.channel && c.channel !== "ALL" && o.channel !== "ALL" && c.channel !== o.channel) return false;
    if ((c.startDate && o.endDate && c.startDate > o.endDate) || (o.startDate && c.endDate && o.startDate > c.endDate)) return false;
    if (!days(c.daysOfWeek).some((d) => days(o.daysOfWeek).includes(d))) return false;
    const ot = targets(o);
    if (ct.all || ot.all) return true;
    if (c.scope === "ROOMS" && o.scope === "ROOMS") return [...ct.rooms].some((r) => ot.rooms.has(r));
    if (c.scope === "ROOM_TYPES" && o.scope === "ROOM_TYPES") return [...ct.types].some((t) => ot.types.has(t));
    return [...ct.types].some((t) => ot.types.has(t)); // a room vs its room type
  });
}

/** Label for a promotion, e.g. "10% off" or "TZS 20,000 off". */
export function promoLabel(p: Pick<PromoRule, "type" | "value">): string {
  return p.type === "PERCENT" ? `${p.value}% off` : `TZS ${p.value.toLocaleString("en-US")} off`;
}
