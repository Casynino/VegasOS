/**
 * Spin to Win — the rules, as plain functions (no database, no clock, no dice of their own): which gifts a stay may
 * still win, what the wheel shows, and which segment it stops on. The server calls these inside the spin's
 * transaction; the wheel on the phone only ever plays back what the server already decided.
 *
 * The promise to the guest: every spin wins a gift. The promise to the hotel: all the gifts of one stay together
 * never cost more than the stay's budget. Both are kept by never offering a gift that would leave too little for the
 * spins still to come.
 */

export type SpinTier = "STANDARD" | "PREMIUM";
export type SpinTierChoice = SpinTier | "NONE";
export type SpinWhere = "ROOM" | "RESTAURANT";

/** The words every screen and every order shows for a gift. */
export const GIFT_LABEL = "SPIN TO WIN — COMPLIMENTARY GIFT";
/** The source of a gift order (next to ROOM_QR, WAITER_MANUAL…). */
export const GIFT_SOURCE = "SPIN";

/** Room types that are Premium until the Admin says otherwise (the hotel's larger rooms). */
const PREMIUM_TYPES = new Set(["EXECUTIVE", "EXECUTIVE_SUITE", "TWIN"]);

/**
 * A room's tier: the room's own choice, else its room type's, else by the kind of room. The meeting room has none.
 * "NONE" on the room or its type switches Spin to Win off for it.
 */
export function spinTierOf(room: { spinTier: string | null; roomType: { spinTier: string | null; code: string; category: string } }): SpinTier | null {
  const chosen = room.spinTier ?? room.roomType.spinTier;
  if (chosen === "NONE") return null;
  if (chosen === "STANDARD" || chosen === "PREMIUM") return chosen;
  if (room.roomType.category !== "GUEST_ROOM") return null;
  return PREMIUM_TYPES.has(room.roomType.code) ? "PREMIUM" : "STANDARD";
}

export const spinBudgetOf = (tier: SpinTier, s: { spinBudgetStandard: number; spinBudgetPremium: number }) => (tier === "PREMIUM" ? s.spinBudgetPremium : s.spinBudgetStandard);

/** A menu item that can be a gift, with what it is worth (TZS) and how often it comes up next to the others. */
export type Prize = { id: string; name: string; value: number; weight: number };
/** What a stay has left. */
export type SpinLeft = { budget: number; spins: number };

/**
 * The gifts this spin may win. A gift fits when, after it, every spin still to come can win at least the cheapest
 * gift. If even that cannot be kept (the budget is too small for the spins), whatever still fits the budget.
 */
export function awardable(prizes: Prize[], left: SpinLeft): Prize[] {
  const ok = prizes.filter((p) => p.value >= 0 && p.weight > 0);
  if (left.spins <= 0 || !ok.length) return [];
  const cheapest = Math.min(...ok.map((p) => p.value));
  const most = left.budget - (left.spins - 1) * cheapest;
  const fits = ok.filter((p) => p.value <= most);
  return fits.length ? fits : ok.filter((p) => p.value <= left.budget);
}

/** A small, stable number from a text (the same wheel for the same spin, on every phone and every reload). */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const WHEEL_SIZE = 8;

/**
 * What the wheel shows for this spin: up to eight gifts that can really be won now — the ones the guest has not won
 * yet first. `seed` (the stay's spin) keeps it the same however often the page is opened.
 */
export function wheelFor(prizes: Prize[], left: SpinLeft, won: ReadonlySet<string>, seed: string, size = WHEEL_SIZE): Prize[] {
  const ok = awardable(prizes, left);
  const order = (list: Prize[]) => [...list].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`) || a.id.localeCompare(b.id));
  const fresh = order(ok.filter((p) => !won.has(p.id)));
  const again = order(ok.filter((p) => won.has(p.id)));
  // Enough new gifts: only new ones. Too few for a wheel: the ones already won come back.
  const wheel = fresh.length >= Math.min(size, 4) ? fresh.slice(0, size) : [...fresh, ...again].slice(0, size);
  return order(wheel);
}

/** Where the wheel stops: one of its own segments, by weight. `rand(n)` gives a whole number from 0 to n − 1. */
export function pickPrize(wheel: Prize[], rand: (n: number) => number): Prize | null {
  const total = wheel.reduce((t, p) => t + p.weight, 0);
  if (!wheel.length || total <= 0) return null;
  let r = rand(total);
  for (const p of wheel) { if (r < p.weight) return p; r -= p.weight; }
  return wheel[wheel.length - 1];
}

/** The promotion runs today (business dates, "YYYY-MM-DD"; an empty end = no end). */
export function spinRunsOn(today: string, s: { spinEnabled: boolean; spinStartsOn: string | null; spinEndsOn: string | null }) {
  if (!s.spinEnabled) return false;
  if (s.spinStartsOn && today < s.spinStartsOn) return false;
  if (s.spinEndsOn && today > s.spinEndsOn) return false;
  return true;
}
