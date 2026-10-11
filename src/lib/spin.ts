/**
 * Spin to Win — the rules, as plain functions (no database, no clock, no dice of their own): what a stay has left,
 * when its game is over, what the wheel shows, and where it stops. The server calls these inside the spin's
 * transaction; the wheel on the phone only ever plays back what the server already decided.
 *
 * One stay: five spins, at most two gifts, at most one bonus spin, and all its gifts together inside the stay's
 * budget. A spin ends on a gift, on "try again" (nothing won), or on the bonus spin (one more spin, once a stay).
 * The game is over at two gifts, when no spin is left, or when no gift fits what is left of the budget.
 */

export type SpinTier = "STANDARD" | "PREMIUM";
export type SpinTierChoice = SpinTier | "NONE";
export type SpinWhere = "ROOM" | "RESTAURANT";

/** The words every screen and every order shows for a gift. */
export const GIFT_LABEL = "SPIN TO WIN — COMPLIMENTARY GIFT";
/** The source of a gift order (next to ROOM_QR, WAITER_MANUAL…). */
export const GIFT_SOURCE = "SPIN";
/** A gift the guest said "no, thank you" to (kept where ROOM / RESTAURANT is kept): nothing is prepared or ordered. */
export const GIFT_DECLINED = "DECLINED";

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
/** The most gifts one stay can win. */
export const GIFTS_PER_STAY = 2;

/** How a spin ends: a gift, one more spin (once a stay), or nothing this time. */
export type SpinKind = "GIFT" | "FREE_SPIN" | "TRY_AGAIN";
/** Why a stay's game is over: both gifts won, no spin left, nothing fits the budget, or the guest finished early. */
export type SpinEnd = "PRIZES" | "SPINS" | "BUDGET" | "GUEST";

/** Where a stay's game stands. `spinsUsed` counts the stay's own spins; the bonus spin is counted apart. */
export type SpinState = {
  spinsAllowed: number; spinsUsed: number; bonusAwarded: boolean; bonusUsed: boolean;
  prizesAllowed: number; prizesWon: number; budget: number; valueUsed: number;
};

export const standardLeft = (s: SpinState) => Math.max(0, s.spinsAllowed - s.spinsUsed);
export const bonusLeft = (s: SpinState) => (s.bonusAwarded && !s.bonusUsed ? 1 : 0);
export const spinsLeft = (s: SpinState) => standardLeft(s) + bonusLeft(s);
export const budgetLeft = (s: SpinState) => Math.max(0, s.budget - s.valueUsed);

/** The gifts that fit what is left of the stay's budget. */
export function fitting<P extends Prize>(prizes: P[], s: SpinState): P[] {
  const left = budgetLeft(s);
  return prizes.filter((p) => p.weight > 0 && p.value >= 0 && p.value <= left);
}

/**
 * Is the game over, and why. `catalog` is every gift the hotel offers (also the ones out of stock just now): the
 * budget has run out only when none of them fits — a gift that is merely not ready is a wait, not an end.
 * Before the first gift the budget is untouched, so a budget too small for any gift is never an "end".
 */
export function spinEnd(s: SpinState, catalog: Prize[]): SpinEnd | null {
  if (s.prizesWon >= s.prizesAllowed) return "PRIZES";
  if (spinsLeft(s) <= 0) return "SPINS";
  if (s.prizesWon > 0 && catalog.length > 0 && !fitting(catalog, s).length) return "BUDGET";
  return null;
}

/** The Admin's chances for one spin, in percent: a gift, and the bonus spin. The rest is "try again". */
export type SpinChances = { gift: number; freeSpin: number };
export type SpinOdds = Record<SpinKind, number>;

/** The chances of this very spin (whole percents, 100 together). The bonus spin comes up once a stay — never twice. */
export function oddsFor(c: SpinChances, s: Pick<SpinState, "bonusAwarded">): SpinOdds {
  const pct = (n: number) => Math.min(100, Math.max(0, Math.round(n)));
  const GIFT = pct(c.gift);
  const FREE_SPIN = s.bonusAwarded ? 0 : Math.min(pct(c.freeSpin), 100 - GIFT);
  return { GIFT, FREE_SPIN, TRY_AGAIN: 100 - GIFT - FREE_SPIN };
}

/** How this spin ends, by the chances. `rand(n)` gives a whole number from 0 to n − 1. */
export function pickKind(odds: SpinOdds, rand: (n: number) => number): SpinKind {
  const r = rand(100);
  return r < odds.GIFT ? "GIFT" : r < odds.GIFT + odds.FREE_SPIN ? "FREE_SPIN" : "TRY_AGAIN";
}

/** One segment of the wheel. */
export type Slot = { kind: "GIFT"; prize: Prize } | { kind: "FREE_SPIN" } | { kind: "TRY_AGAIN" };

/** The stay after one spin. The stay's own spins are used first; the bonus spin is the last one. */
export function afterSpin(s: SpinState, spin: { kind: SpinKind; value: number }): SpinState & { usedBonus: boolean } {
  const usedBonus = standardLeft(s) <= 0;
  return {
    ...s,
    spinsUsed: usedBonus ? s.spinsUsed : s.spinsUsed + 1,
    bonusUsed: s.bonusUsed || usedBonus,
    bonusAwarded: s.bonusAwarded || spin.kind === "FREE_SPIN",
    prizesWon: s.prizesWon + (spin.kind === "GIFT" ? 1 : 0),
    valueUsed: s.valueUsed + (spin.kind === "GIFT" ? Math.max(0, spin.value) : 0),
    usedBonus,
  };
}

/**
 * Out of 100 stays, about how many end with no gift, with one, with two — by the chances alone, every stay played to
 * the end. (A small budget can only make it fewer.) For the Admin, so the numbers mean something.
 */
export function giftOutlook(c: SpinChances, spins: number, prizes = GIFTS_PER_STAY): number[] {
  const share = Array.from({ length: prizes + 1 }, () => 0);
  const walk = (s: SpinState, p: number) => {
    if (s.prizesWon >= s.prizesAllowed || spinsLeft(s) <= 0) { share[s.prizesWon] += p; return; }
    const odds = oddsFor(c, s);
    for (const kind of ["GIFT", "FREE_SPIN", "TRY_AGAIN"] as const) if (odds[kind] > 0) walk(afterSpin(s, { kind, value: 0 }), (p * odds[kind]) / 100);
  };
  walk({ spinsAllowed: Math.min(10, Math.max(1, Math.round(spins) || 1)), spinsUsed: 0, bonusAwarded: false, bonusUsed: false, prizesAllowed: prizes, prizesWon: 0, budget: 0, valueUsed: 0 }, 1);
  return share.map((x) => Math.round(x * 100));
}

/** A small, stable number from a text (the same wheel for the same spin, on every phone and every reload). */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const WHEEL_SIZE = 8;

/** How many of the wheel's segments each ending gets — in step with its real chance (never none for one that can come up). */
function slotCounts(odds: SpinOdds, size: number): Record<SpinKind, number> {
  const kinds: SpinKind[] = ["GIFT", "TRY_AGAIN", "FREE_SPIN"];
  const exact = (k: SpinKind) => (size * odds[k]) / 100;
  const n = { GIFT: 0, FREE_SPIN: 0, TRY_AGAIN: 0 };
  for (const k of kinds) n[k] = odds[k] > 0 ? Math.max(1, Math.floor(exact(k))) : 0;
  const total = () => n.GIFT + n.FREE_SPIN + n.TRY_AGAIN;
  while (total() < size) {
    const live = kinds.filter((k) => odds[k] > 0);
    if (!live.length) break;
    const k = live.reduce((best, x) => (exact(x) - n[x] > exact(best) - n[best] ? x : best));
    n[k] += 1;
  }
  while (total() > size) {
    const big = kinds.filter((k) => n[k] > 1);
    if (!big.length) break;
    const k = big.reduce((best, x) => (n[x] - exact(x) > n[best] - exact(best) ? x : best));
    n[k] -= 1;
  }
  return n;
}

/**
 * What the wheel shows for this spin — only what can really happen now: gifts that are ready and fit what is left
 * of the budget (the ones not won yet first), "try again", and the bonus spin while it has not come up. Each gets
 * its share of the segments by its real chance. No wheel when no gift can be given. `seed` (the stay's spin) keeps
 * it the same however often the page is opened.
 */
export function wheelFor(available: Prize[], s: SpinState, odds: SpinOdds, won: ReadonlySet<string>, seed: string, size = WHEEL_SIZE): Slot[] {
  if (s.prizesWon >= s.prizesAllowed || spinsLeft(s) <= 0) return [];
  const ok = fitting(available, s);
  if (!ok.length) return [];
  const order = (list: Prize[]) => [...list].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`) || a.id.localeCompare(b.id));
  // A gift already won comes back only when nothing else fits.
  const fresh = order(ok.filter((p) => !won.has(p.id)));
  const pool = fresh.length ? fresh : order(ok);
  const n = slotCounts(odds, size);
  const gifts: Slot[] = Array.from({ length: n.GIFT }, (_, i) => ({ kind: "GIFT", prize: pool[i % pool.length] }));
  // The bonus spin sits in the middle of the "try again" segments; all of them are spread evenly between the gifts.
  const before = Math.ceil(n.TRY_AGAIN / 2);
  const specials: Slot[] = [
    ...Array.from({ length: before }, (): Slot => ({ kind: "TRY_AGAIN" })),
    ...Array.from({ length: n.FREE_SPIN }, (): Slot => ({ kind: "FREE_SPIN" })),
    ...Array.from({ length: n.TRY_AGAIN - before }, (): Slot => ({ kind: "TRY_AGAIN" })),
  ];
  const total = gifts.length + specials.length;
  const at = new Map(specials.map((slot, j) => [Math.floor(((j + 0.5) * total) / specials.length), slot]));
  let g = 0;
  return Array.from({ length: total }, (_, i) => at.get(i) ?? gifts[g++]);
}

/**
 * Where the wheel stops: first how the spin ends (by the chances), then which gift (by weight), then which of the
 * matching segments. Nothing when there is no wheel.
 */
export function spinStop(wheel: Slot[], odds: SpinOdds, rand: (n: number) => number): { index: number; slot: Slot } | null {
  if (!wheel.length) return null;
  let kind = pickKind(odds, rand);
  if (!wheel.some((w) => w.kind === kind)) kind = wheel.some((w) => w.kind === "TRY_AGAIN") ? "TRY_AGAIN" : wheel[0].kind;
  let giftId: string | null = null;
  if (kind === "GIFT") {
    const distinct = new Map<string, Prize>();
    for (const w of wheel) if (w.kind === "GIFT") distinct.set(w.prize.id, w.prize);
    giftId = pickPrize([...distinct.values()], rand)?.id ?? null;
  }
  const spots = wheel.flatMap((w, i) => (w.kind === kind && (w.kind !== "GIFT" || giftId === null || w.prize.id === giftId) ? [i] : []));
  const index = spots[rand(spots.length)] ?? spots[0];
  return { index, slot: wheel[index] };
}

/** One of these gifts, by weight. `rand(n)` gives a whole number from 0 to n − 1. */
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

// ───────────────────────── How the guest is greeted ─────────────────────────

const TITLES = /^(mr|mrs|ms|miss|mx|dr|prof|eng|hon|sir|madam|mme|mlle|bw|bi|bibi|ndugu|mhe|mzee)\.?$/i;
const nameCase = (w: string) => w.toLocaleLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase());

/**
 * The name the wheel greets a guest by — their first name, the way they would write it: no title ("Mr"), no note
 * in brackets, and "PETER" or "peter" (as typed at the desk) shown as "Peter". A name already in mixed case is left
 * exactly as it is.
 */
export function greetingName(fullName: string): string {
  const words = fullName.replace(/\(.*?\)/g, " ").trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && TITLES.test(words[0])) words.shift();
  const first = (words[0] ?? "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!first) return fullName.trim();
  const typed = first === first.toLocaleUpperCase() || first === first.toLocaleLowerCase();
  const name = typed && first.toLocaleUpperCase() !== first.toLocaleLowerCase() ? nameCase(first) : first;
  return name.length > 22 ? `${name.slice(0, 21)}…` : name;
}

export type DayPart = "morning" | "afternoon" | "evening";
/** Morning, afternoon or evening, by the hour on the hotel's clock (0–23). */
export const dayPartOf = (hour: number): DayPart => (hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : "evening");
