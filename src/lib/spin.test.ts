import { describe, expect, it } from "vitest";
import { awardable, pickPrize, spinRunsOn, spinTierOf, wheelFor, type Prize } from "./spin";

const P = (id: string, value: number, weight = 1): Prize => ({ id, name: id, value, weight });
const MENU = [P("water", 1500), P("soda", 2500), P("tea", 3000), P("juice", 4000), P("soup", 5000), P("pizza", 9000)];

describe("awardable — every spin wins, the budget is never passed", () => {
  it("keeps enough for the spins still to come", () => {
    // 10,000 for 5 spins: after this one, four more must still win the cheapest (1,500) → at most 4,000 now.
    expect(awardable(MENU, { budget: 10000, spins: 5 }).map((p) => p.id)).toEqual(["water", "soda", "tea", "juice"]);
  });
  it("the last spin may use all that is left", () => {
    expect(awardable(MENU, { budget: 5000, spins: 1 }).map((p) => p.id)).toEqual(["water", "soda", "tea", "juice", "soup"]);
  });
  it("nothing when there are no spins or nothing fits", () => {
    expect(awardable(MENU, { budget: 10000, spins: 0 })).toEqual([]);
    expect(awardable(MENU, { budget: 1000, spins: 2 })).toEqual([]);
    expect(awardable([], { budget: 10000, spins: 5 })).toEqual([]);
  });
  it("a budget too small for all the spins still gives what fits", () => {
    expect(awardable(MENU, { budget: 2000, spins: 3 }).map((p) => p.id)).toEqual(["water"]);
  });
  it("five spins of any allowed gifts never pass the budget", () => {
    for (let seed = 0; seed < 300; seed++) {
      let budget = 10000, spins = 5, n = seed;
      const rand = (k: number) => { n = (n * 1103515245 + 12345) & 0x7fffffff; return n % k; };
      const won = new Set<string>();
      while (spins > 0) {
        const prize = pickPrize(wheelFor(MENU, { budget, spins }, won, `s:${spins}`), rand);
        expect(prize).not.toBeNull();
        budget -= prize!.value; spins -= 1; won.add(prize!.id);
        expect(budget).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("wheelFor", () => {
  it("is the same for the same spin and only shows gifts that can be won", () => {
    const a = wheelFor(MENU, { budget: 10000, spins: 5 }, new Set(), "stay:1");
    expect(wheelFor(MENU, { budget: 10000, spins: 5 }, new Set(), "stay:1")).toEqual(a);
    expect(a.every((p) => p.value <= 4000)).toBe(true);
  });
  it("shows new gifts first, and brings back won ones only when few are left", () => {
    const many = [...MENU, P("a", 1500), P("b", 2000), P("c", 2500)];
    expect(wheelFor(many, { budget: 10000, spins: 5 }, new Set(["water"]), "x").some((p) => p.id === "water")).toBe(false);
    expect(wheelFor(MENU, { budget: 10000, spins: 5 }, new Set(["water", "soda"]), "x").map((p) => p.id).sort()).toEqual(["juice", "soda", "tea", "water"]);
  });
  it("never more than eight segments", () => {
    const big = Array.from({ length: 30 }, (_, i) => P(`i${i}`, 1500));
    expect(wheelFor(big, { budget: 15000, spins: 5 }, new Set(), "x")).toHaveLength(8);
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
