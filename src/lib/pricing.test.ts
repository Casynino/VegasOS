import { describe, expect, it } from "vitest";
import { quoteRoom, sumQuotes } from "./pricing";

describe("PricingService", () => {
  it("Double Deluxe, 1 night, standard discount: 80,000 − 20,000 = 60,000", () => {
    expect(quoteRoom({ ratePerNight: 80_000, discountPerNight: 20_000, units: 1 })).toMatchObject({
      grossAmount: 80_000, discountAmount: 20_000, netAmount: 60_000,
    });
  });

  it("two nights: gross 160,000, discount 40,000, net 120,000", () => {
    expect(quoteRoom({ ratePerNight: 80_000, discountPerNight: 20_000, units: 2 })).toMatchObject({
      grossAmount: 160_000, discountAmount: 40_000, netAmount: 120_000,
    });
  });

  it("three rooms get 3 × 20,000, not one discount per booking", () => {
    const q = quoteRoom({ ratePerNight: 80_000, discountPerNight: 20_000, units: 1 });
    expect(sumQuotes([q, q, q])).toEqual({ grossAmount: 240_000, discountAmount: 60_000, netAmount: 180_000 });
  });

  it("never discounts below zero or above the rate", () => {
    expect(quoteRoom({ ratePerNight: 60_000, discountPerNight: 90_000, units: 1 }).netAmount).toBe(0);
    expect(quoteRoom({ ratePerNight: 60_000, discountPerNight: -5, units: 1 }).discountAmount).toBe(0);
  });

  it("rejects zero units", () => {
    expect(() => quoteRoom({ ratePerNight: 60_000, discountPerNight: 0, units: 0 })).toThrow();
  });
});
