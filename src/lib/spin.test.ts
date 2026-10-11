import { describe, expect, it } from "vitest";
import {
  GIFTS_PER_STAY, afterSpin, bonusLeft, budgetLeft, dayPartOf, fitting, giftOutlook, greetingName, oddsFor, pickKind, pickPrize, spinEnd, spinRunsOn, spinStop,
  spinTierOf, spinsLeft, standardLeft, wheelFor, type Prize, type Slot, type SpinState,
} from "./spin";

const P = (id: string, value: number, weight = 1): Prize => ({ id, name: id, value, weight });
const MENU = [P("water", 1500), P("soda", 2500), P("tea", 3000), P("juice", 4000), P("soup", 5000), P("pizza", 9000)];

const START = (budget = 10000, over: Partial<SpinState> = {}): SpinState =>
  ({ spinsAllowed: 5, spinsUsed: 0, bonusAwarded: false, bonusUsed: false, prizesAllowed: GIFTS_PER_STAY, prizesWon: 0, budget, valueUsed: 0, ...over });
const CHANCES = { gift: 45, freeSpin: 10 };
/** A dice that gives the same numbers every time. */
const dice = (seed: number) => { let n = seed; return (k: number) => { n = (n * 1103515245 + 12345) & 0x7fffffff; return (n >> 8) % k; }; };

/** One turn of a told story: a gift worth so much, the bonus spin, or nothing. */
type Turn = number | "free" | "again";
/** Plays the turns for as long as the game is on; says how many were really played and why it ended. */
function play(start: SpinState, turns: Turn[], catalog: Prize[] = MENU) {
  let s = start, played = 0;
  for (const t of turns) {
    if (spinEnd(s, catalog)) break;
    s = afterSpin(s, { kind: t === "free" ? "FREE_SPIN" : t === "again" ? "TRY_AGAIN" : "GIFT", value: typeof t === "number" ? t : 0 });
    played++;
  }
  return { s, played, end: spinEnd(s, catalog) };
}

describe("when a stay's game is over", () => {
  it("1 · two gifts on the first two spins end it, with spins still unused", () => {
    const g = play(START(), [3000, 4000, "again", "again", "again"]);
    expect(g.played).toBe(2);
    expect(g.end).toBe("PRIZES");
    expect(standardLeft(g.s)).toBe(3);
  });
  it("2 · one gift and nothing on the other spins ends it when no spin is left", () => {
    const g = play(START(), [3000, "again", "again", "again", "again", "again"]);
    expect(g.played).toBe(5);
    expect(g.end).toBe("SPINS");
    expect(g.s.prizesWon).toBe(1);
  });
  it("no gift at all is a full game too", () => {
    const g = play(START(), ["again", "again", "again", "again", "again"]);
    expect([g.played, g.end, g.s.prizesWon, g.s.valueUsed]).toEqual([5, "SPINS", 0, 0]);
  });
  it("3 · C · a gift worth the whole budget of a standard room leaves no second gift", () => {
    const g = play(START(10000), [10000, 1500], [...MENU, P("feast", 10000)]);
    expect([g.played, g.end, g.s.prizesWon, budgetLeft(g.s)]).toEqual([1, "BUDGET", 1, 0]);
  });
  it("4 · A · two gifts worth the whole standard budget together", () => {
    const g = play(START(10000), [4000, 6000, "again"]);
    expect([g.played, g.end, g.s.valueUsed]).toEqual([2, "PRIZES", 10000]);
  });
  it("5 · B · two gifts worth the whole premium budget together", () => {
    const g = play(START(15000), [7000, 8000, "again"]);
    expect([g.played, g.end, g.s.valueUsed]).toEqual([2, "PRIZES", 15000]);
  });
  it("D · two gifts end a premium stay even with budget unused", () => {
    const g = play(START(15000), [5000, 7000, "again"]);
    expect([g.end, budgetLeft(g.s)]).toEqual(["PRIZES", 3000]);
  });
  it("E · after a first gift of 3,000 only gifts inside the other 7,000 can be the second", () => {
    const g = play(START(10000), [3000]);
    expect(g.end).toBeNull();
    expect(fitting(MENU, g.s).map((p) => p.id)).toEqual(["water", "soda", "tea", "juice", "soup"]);
    expect(wheelFor(MENU, g.s, oddsFor(CHANCES, g.s), new Set(["tea"]), "x").some((w) => w.kind === "GIFT" && w.prize.value > 7000)).toBe(false);
  });
  it("a gift that is only out of stock is a wait, not the end", () => {
    const s = play(START(10000), [9000]).s;
    // 1,000 left: nothing on the menu fits → over. With a 1,000 gift on the menu (even if not ready now) → not over.
    expect(spinEnd(s, MENU)).toBe("BUDGET");
    expect(spinEnd(s, [...MENU, P("mint", 1000)])).toBeNull();
    expect(wheelFor([], s, oddsFor(CHANCES, s), new Set(), "x")).toEqual([]);
  });
  it("a stay with no gift yet is never ended by the budget", () => {
    expect(spinEnd(START(1000), MENU)).toBeNull();
    expect(wheelFor(MENU, START(1000), oddsFor(CHANCES, START(1000)), new Set(), "x")).toEqual([]);
  });
});

describe("the bonus spin", () => {
  it("6 · gives exactly one more spin, and does not touch the stay's own five", () => {
    const g = play(START(), ["again", "free"]);
    expect([standardLeft(g.s), bonusLeft(g.s), spinsLeft(g.s)]).toEqual([3, 1, 4]);
    const all = play(START(), ["again", "free", "again", "again", "again", "again", "again", "again"]);
    expect([all.played, all.end]).toEqual([6, "SPINS"]);
    expect(all.s.bonusUsed).toBe(true);
  });
  it("7 · never comes up a second time", () => {
    const s = play(START(), ["free"]).s;
    const odds = oddsFor(CHANCES, s);
    expect(odds).toEqual({ GIFT: 45, FREE_SPIN: 0, TRY_AGAIN: 55 });
    const wheel = wheelFor(MENU, s, odds, new Set(), "x");
    expect(wheel.some((w) => w.kind === "FREE_SPIN")).toBe(false);
    const rand = dice(7);
    for (let i = 0; i < 2000; i++) expect(spinStop(wheel, odds, rand)!.slot.kind).not.toBe("FREE_SPIN");
  });
  it("8 · won on the fifth spin, it can still be used", () => {
    const g = play(START(), ["again", "again", "again", "again", "free"]);
    expect([g.end, standardLeft(g.s), bonusLeft(g.s)]).toEqual([null, 0, 1]);
    const last = afterSpin(g.s, { kind: "GIFT", value: 3000 });
    expect([last.usedBonus, last.spinsUsed, last.bonusUsed, last.prizesWon]).toEqual([true, 5, true, 1]);
    expect(spinEnd(last, MENU)).toBe("SPINS");
  });
  it("9 · two gifts before it is used end the game — it is not kept", () => {
    const g = play(START(), ["free", 3000, 4000, "again"]);
    expect([g.played, g.end, bonusLeft(g.s)]).toEqual([3, "PRIZES", 1]);
    expect(wheelFor(MENU, g.s, oddsFor(CHANCES, g.s), new Set(), "x")).toEqual([]);
  });
  it("a gift from the bonus spin counts as one of the two, inside the budget", () => {
    const g = play(START(10000), [4000, "again", "again", "again", "free", 6000]);
    expect([g.played, g.end, g.s.prizesWon, g.s.valueUsed, g.s.bonusUsed]).toEqual([6, "PRIZES", 2, 10000, true]);
  });
  it("is used last: the stay's own spins go first", () => {
    const s = play(START(), ["free"]).s;
    expect(afterSpin(s, { kind: "TRY_AGAIN", value: 0 }).usedBonus).toBe(false);
  });
});

describe("the chances of one spin", () => {
  it("are whole percents that make 100", () => {
    expect(oddsFor(CHANCES, START())).toEqual({ GIFT: 45, FREE_SPIN: 10, TRY_AGAIN: 45 });
    expect(oddsFor({ gift: 100, freeSpin: 30 }, START())).toEqual({ GIFT: 100, FREE_SPIN: 0, TRY_AGAIN: 0 });
    expect(oddsFor({ gift: 80, freeSpin: 50 }, START())).toEqual({ GIFT: 80, FREE_SPIN: 20, TRY_AGAIN: 0 });
    expect(oddsFor({ gift: -5, freeSpin: 999 }, START())).toEqual({ GIFT: 0, FREE_SPIN: 100, TRY_AGAIN: 0 });
  });
  it("decide how the spin ends", () => {
    const odds = oddsFor(CHANCES, START());
    expect([0, 44, 45, 54, 55, 99].map((r) => pickKind(odds, () => r))).toEqual(["GIFT", "GIFT", "FREE_SPIN", "FREE_SPIN", "TRY_AGAIN", "TRY_AGAIN"]);
  });
});

describe("wheelFor — the wheel shows what can really happen", () => {
  const kinds = (wheel: Slot[]) => ({ gift: wheel.filter((w) => w.kind === "GIFT").length, free: wheel.filter((w) => w.kind === "FREE_SPIN").length, again: wheel.filter((w) => w.kind === "TRY_AGAIN").length });
  it("has eight segments, shared out by the real chances", () => {
    const s = START();
    expect(kinds(wheelFor(MENU, s, oddsFor(CHANCES, s), new Set(), "x"))).toEqual({ gift: 4, free: 1, again: 3 });
    const after = { ...s, bonusAwarded: true };
    expect(kinds(wheelFor(MENU, after, oddsFor(CHANCES, after), new Set(), "x"))).toEqual({ gift: 4, free: 0, again: 4 });
    expect(kinds(wheelFor(MENU, s, oddsFor({ gift: 100, freeSpin: 0 }, s), new Set(), "x"))).toEqual({ gift: 8, free: 0, again: 0 });
    expect(kinds(wheelFor(MENU, s, oddsFor({ gift: 10, freeSpin: 5 }, s), new Set(), "x"))).toEqual({ gift: 1, free: 1, again: 6 });
  });
  it("is the same for the same spin, and never puts two gifts side by side when half of it is not gifts", () => {
    const s = START();
    const odds = oddsFor(CHANCES, s);
    const a = wheelFor(MENU, s, odds, new Set(), "stay:1");
    expect(wheelFor(MENU, s, odds, new Set(), "stay:1")).toEqual(a);
    a.forEach((w, i) => expect(w.kind === "GIFT" && a[(i + 1) % a.length].kind === "GIFT").toBe(false));
  });
  it("only shows gifts that fit what is left of the budget", () => {
    const s = START(10000, { prizesWon: 1, valueUsed: 6000, spinsUsed: 1 });
    const wheel = wheelFor(MENU, s, oddsFor(CHANCES, s), new Set(), "x");
    expect(wheel.length).toBe(8);
    expect(wheel.every((w) => w.kind !== "GIFT" || w.prize.value <= 4000)).toBe(true);
  });
  it("shows gifts not won yet; a won one comes back only when nothing else fits", () => {
    const s = START(10000, { prizesWon: 1, valueUsed: 3000, spinsUsed: 1 });
    expect(wheelFor(MENU, s, oddsFor(CHANCES, s), new Set(["tea"]), "x").some((w) => w.kind === "GIFT" && w.prize.id === "tea")).toBe(false);
    const tight = START(10000, { prizesWon: 1, valueUsed: 8500, spinsUsed: 1 });
    const only = wheelFor(MENU, tight, oddsFor(CHANCES, tight), new Set(["water"]), "x").filter((w) => w.kind === "GIFT");
    expect(only.length).toBe(4);
    expect(only.every((w) => w.kind === "GIFT" && w.prize.id === "water")).toBe(true);
  });
  it("is empty when the game is over or nothing can be given", () => {
    const odds = oddsFor(CHANCES, START());
    expect(wheelFor(MENU, START(10000, { prizesWon: 2 }), odds, new Set(), "x")).toEqual([]);
    expect(wheelFor(MENU, START(10000, { spinsUsed: 5 }), odds, new Set(), "x")).toEqual([]);
    expect(wheelFor([], START(), odds, new Set(), "x")).toEqual([]);
  });
});

describe("spinStop — where the wheel stops", () => {
  it("stops on a segment of its own wheel that matches how the spin ended", () => {
    const s = START();
    const odds = oddsFor(CHANCES, s);
    const wheel = wheelFor(MENU, s, odds, new Set(), "x");
    const rand = dice(3);
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const stop = spinStop(wheel, odds, rand)!;
      expect(wheel[stop.index]).toBe(stop.slot);
      seen.add(stop.slot.kind);
    }
    expect([...seen].sort()).toEqual(["FREE_SPIN", "GIFT", "TRY_AGAIN"]);
    expect(spinStop([], odds, rand)).toBeNull();
  });
  it("gives a gift about as often as the Admin set", () => {
    const s = START();
    const odds = oddsFor(CHANCES, s);
    const wheel = wheelFor(MENU, s, odds, new Set(), "x");
    const rand = dice(11);
    let gifts = 0;
    for (let i = 0; i < 20000; i++) if (spinStop(wheel, odds, rand)!.slot.kind === "GIFT") gifts++;
    expect(gifts / 20000).toBeGreaterThan(0.42);
    expect(gifts / 20000).toBeLessThan(0.48);
  });
});

describe("12 · whole games, played by the dice", () => {
  it("never pass the budget, two gifts, one bonus spin or the stay's spins", () => {
    const menu = [...MENU, P("feast", 10000), P("platter", 15000)];
    let two = 0, none = 0;
    const GAMES = 4000;
    for (let seed = 1; seed <= GAMES; seed++) {
      const rand = dice(seed);
      const budget = seed % 2 ? 10000 : 15000;
      let s = START(budget), spins = 0, free = 0;
      const won = new Set<string>();
      while (!spinEnd(s, menu)) {
        const odds = oddsFor(CHANCES, s);
        const stop = spinStop(wheelFor(menu, s, odds, won, `g${seed}:${spins}`), odds, rand);
        expect(stop).not.toBeNull();
        const slot = stop!.slot;
        if (slot.kind === "GIFT") { expect(slot.prize.value).toBeLessThanOrEqual(budgetLeft(s)); won.add(slot.prize.id); }
        if (slot.kind === "FREE_SPIN") free++;
        s = afterSpin(s, { kind: slot.kind, value: slot.kind === "GIFT" ? slot.prize.value : 0 });
        spins++;
        expect(s.valueUsed).toBeLessThanOrEqual(budget);
        expect(s.prizesWon).toBeLessThanOrEqual(2);
      }
      expect(free).toBeLessThanOrEqual(1);
      expect(spins).toBeLessThanOrEqual(5 + free);
      expect(s.spinsUsed).toBeLessThanOrEqual(5);
      if (s.prizesWon === 2) two++;
      if (s.prizesWon === 0) none++;
    }
    // With the hotel's chances most stays win a gift, and a stay with nothing is rare.
    expect(two / GAMES).toBeGreaterThan(0.5);
    expect(none / GAMES).toBeLessThan(0.1);
  });
});

describe("pickPrize", () => {
  it("stops on one of the wheel's own segments, by weight", () => {
    const wheel = [P("a", 1, 1), P("b", 1, 3)];
    expect(pickPrize(wheel, () => 0)!.id).toBe("a");
    expect(pickPrize(wheel, () => 1)!.id).toBe("b");
    expect(pickPrize(wheel, () => 3)!.id).toBe("b");
    expect(pickPrize([], () => 0)).toBeNull();
  });
});

describe("tiers and dates", () => {
  const type = (code: string, category = "GUEST_ROOM", spinTier: string | null = null) => ({ code, category, spinTier });
  it("the room's own choice wins, then its type's, then the kind of room", () => {
    expect(spinTierOf({ spinTier: null, roomType: type("STANDARD") })).toBe("STANDARD");
    expect(spinTierOf({ spinTier: null, roomType: type("EXECUTIVE_SUITE") })).toBe("PREMIUM");
    expect(spinTierOf({ spinTier: null, roomType: type("STANDARD", "GUEST_ROOM", "PREMIUM") })).toBe("PREMIUM");
    expect(spinTierOf({ spinTier: "STANDARD", roomType: type("EXECUTIVE") })).toBe("STANDARD");
    expect(spinTierOf({ spinTier: "NONE", roomType: type("EXECUTIVE") })).toBeNull();
    expect(spinTierOf({ spinTier: null, roomType: type("MEETING_ROOM", "MEETING_ROOM") })).toBeNull();
  });
  it("runs only when switched on and inside its dates", () => {
    expect(spinRunsOn("2026-10-11", { spinEnabled: false, spinStartsOn: null, spinEndsOn: null })).toBe(false);
    expect(spinRunsOn("2026-10-11", { spinEnabled: true, spinStartsOn: null, spinEndsOn: null })).toBe(true);
    expect(spinRunsOn("2026-10-11", { spinEnabled: true, spinStartsOn: "2026-10-12", spinEndsOn: null })).toBe(false);
    expect(spinRunsOn("2026-10-11", { spinEnabled: true, spinStartsOn: "2026-10-01", spinEndsOn: "2026-10-10" })).toBe(false);
    expect(spinRunsOn("2026-10-11", { spinEnabled: true, spinStartsOn: "2026-10-11", spinEndsOn: "2026-10-11" })).toBe(true);
  });
});

describe("what the Admin's chances mean", () => {
  it("says how many stays in 100 end with no gift, one, two", () => {
    const [none, one, two] = giftOutlook(CHANCES, 5);
    expect(none + one + two).toBeGreaterThanOrEqual(99);
    expect(none + one + two).toBeLessThanOrEqual(101);
    expect(two).toBeGreaterThan(60);
    expect(none).toBeLessThan(10);
  });
  it("is certain at the two ends", () => {
    expect(giftOutlook({ gift: 100, freeSpin: 0 }, 5)).toEqual([0, 0, 100]);
    expect(giftOutlook({ gift: 0, freeSpin: 0 }, 5)).toEqual([100, 0, 0]);
    // One spin, no bonus spin: never two gifts.
    expect(giftOutlook({ gift: 50, freeSpin: 0 }, 1)).toEqual([50, 50, 0]);
    // One spin: a gift uses it up, and winning the bonus spin gives just one more — never two gifts.
    expect(giftOutlook({ gift: 50, freeSpin: 50 }, 1)[2]).toBe(0);
  });
});

describe("how the guest is greeted", () => {
  it("uses the first name, as a name is written", () => {
    expect(greetingName("Peter Kimaro")).toBe("Peter");
    expect(greetingName("PETER KIMARO")).toBe("Peter");
    expect(greetingName("peter kimaro")).toBe("Peter");
    expect(greetingName("  Asha   Mohamed ")).toBe("Asha");
    expect(greetingName("Peter Kimaro (test)")).toBe("Peter");
    expect(greetingName("McDonald James")).toBe("McDonald");
    expect(greetingName("ANNE-MARIE O'NEIL")).toBe("Anne-Marie");
  });
  it("leaves a title out, but never leaves the guest without a name", () => {
    expect(greetingName("Mr. John Mushi")).toBe("John");
    expect(greetingName("DR JANE DOE")).toBe("Jane");
    expect(greetingName("Mrs Asha")).toBe("Asha");
    expect(greetingName("Dr")).toBe("Dr");
    expect(greetingName("王伟")).toBe("王伟");
    expect(greetingName("Mohamed,")).toBe("Mohamed");
  });
  it("keeps a very long name on one line", () => {
    expect(greetingName("Wolfeschlegelsteinhausenbergerdorff Smith").length).toBeLessThanOrEqual(22);
  });
  it("knows the time of day on the hotel's clock", () => {
    expect([5, 11].map(dayPartOf)).toEqual(["morning", "morning"]);
    expect([12, 16].map(dayPartOf)).toEqual(["afternoon", "afternoon"]);
    expect([17, 23, 0, 4].map(dayPartOf)).toEqual(["evening", "evening", "evening", "evening"]);
  });
});
