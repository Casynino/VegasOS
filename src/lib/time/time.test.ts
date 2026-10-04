import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDateOf,
  businessDayBounds,
  diffDays,
  presetRange,
  toDbDate,
  fromDbDate,
  zonedInstant,
} from "./business-date";
import { dayUseStay, overnightStay, StayError, walkInStay, splitAmount } from "./stay";

// Dar es Salaam is UTC+3 all year: local 04:00 == 01:00Z.
const eat = (iso: string) => new Date(`${iso}+03:00`);

describe("HotelBusinessDateService", () => {
  it("uses 04:00 as the business-day boundary, not midnight", () => {
    expect(businessDateOf(eat("2026-09-25T04:00:00"))).toBe("2026-09-25");
    expect(businessDateOf(eat("2026-09-25T23:59:00"))).toBe("2026-09-25");
    expect(businessDateOf(eat("2026-09-26T00:30:00"))).toBe("2026-09-25");
    expect(businessDateOf(eat("2026-09-26T03:59:59"))).toBe("2026-09-25");
    expect(businessDateOf(eat("2026-09-26T04:00:00"))).toBe("2026-09-26");
  });

  it("returns [04:00, next 04:00) bounds for a business date", () => {
    const { start, end } = businessDayBounds("2026-09-25");
    expect(start.toISOString()).toBe("2026-09-25T01:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-26T01:00:00.000Z");
  });

  it("converts local wall time to UTC instants", () => {
    expect(zonedInstant("2026-09-26", 660, "Africa/Dar_es_Salaam").toISOString()).toBe(
      "2026-09-26T08:00:00.000Z",
    );
  });

  it("handles month/year rollover and date maths", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-02-27", "2026-03-01")).toBe(2);
    expect(businessDateOf(eat("2027-01-01T02:00:00"))).toBe("2026-12-31");
  });

  it("round-trips @db.Date values", () => {
    expect(fromDbDate(toDbDate("2026-09-25"))).toBe("2026-09-25");
  });

  it("builds reporting presets", () => {
    expect(presetRange("yesterday", "2026-09-25")).toEqual({ from: "2026-09-24", to: "2026-09-24" });
    expect(presetRange("week", "2026-09-25")).toEqual({ from: "2026-09-21", to: "2026-09-25" }); // Fri → Mon
    expect(presetRange("month", "2026-09-25")).toEqual({ from: "2026-09-01", to: "2026-09-25" });
  });
});

describe("StayCalculationService", () => {
  it("computes a normal two-night stay with 11:00 checkout", () => {
    const s = overnightStay({ arrivalDate: "2026-09-25", departureDate: "2026-09-27" });
    expect(s.nights).toBe(2);
    expect(s.nightDates).toEqual(["2026-09-25", "2026-09-26"]);
    expect(s.startAt.toISOString()).toBe("2026-09-25T11:00:00.000Z"); // 14:00 local
    expect(s.endAt.toISOString()).toBe("2026-09-27T08:00:00.000Z"); // 11:00 local
    expect(s.isDayUse).toBe(false);
  });

  it("gives a 16:00+ walk-in an 11:00 checkout the next day", () => {
    const s = walkInStay({ now: eat("2026-09-25T18:30:00"), nights: 1 });
    expect(s.arrivalDate).toBe("2026-09-25");
    expect(s.isLateArrival).toBe(true);
    expect(s.endAt.toISOString()).toBe("2026-09-26T08:00:00.000Z");
  });

  it("treats a 02:00 arrival as the previous business night (checkout same morning)", () => {
    const s = walkInStay({ now: eat("2026-09-26T02:00:00"), nights: 1 });
    expect(s.arrivalDate).toBe("2026-09-25");
    expect(s.departureDate).toBe("2026-09-26");
    expect(s.nightDates).toEqual(["2026-09-25"]);
    expect(s.isLateArrival).toBe(true);
    expect(s.endAt.toISOString()).toBe("2026-09-26T08:00:00.000Z");
  });

  it("does not flag an afternoon arrival before 16:00 as late", () => {
    const s = walkInStay({ now: eat("2026-09-25T13:00:00"), nights: 1 });
    expect(s.isLateArrival).toBe(false);
  });

  it("supports day-use within one business day", () => {
    const s = dayUseStay({ startAt: eat("2026-09-25T10:00:00"), endAt: eat("2026-09-25T16:00:00") });
    expect(s.nights).toBe(0);
    expect(s.billableUnits).toBe(1);
    expect(s.isDayUse).toBe(true);
    expect(s.nightDates).toEqual([]);
  });

  it("short time can run through the night but never longer than 7 hours", () => {
    const night = dayUseStay({ startAt: eat("2026-09-25T23:00:00"), endAt: eat("2026-09-26T05:00:00") });
    expect(night.arrivalDate).toBe("2026-09-25");
    expect(night.nights).toBe(0);
    expect(() =>
      dayUseStay({ startAt: eat("2026-09-25T10:00:00"), endAt: eat("2026-09-25T17:30:00") }),
    ).toThrow(StayError);
  });

  it("rejects zero-night and reversed overnight stays", () => {
    expect(() => overnightStay({ arrivalDate: "2026-09-25", departureDate: "2026-09-25" })).toThrow(StayError);
    expect(() => overnightStay({ arrivalDate: "2026-09-25", departureDate: "2026-09-24" })).toThrow(StayError);
  });

  it("lets a same-day turnover not overlap (11:00 out, 14:00 in)", () => {
    const a = overnightStay({ arrivalDate: "2026-09-24", departureDate: "2026-09-25" });
    const b = overnightStay({ arrivalDate: "2026-09-25", departureDate: "2026-09-26" });
    expect(a.endAt < b.startAt).toBe(true);
  });

  it("splits amounts exactly", () => {
    expect(splitAmount(100, 3)).toEqual([34, 33, 33]);
    expect(splitAmount(100, 3).reduce((a, b) => a + b)).toBe(100);
  });
});
