import { describe, expect, it } from "vitest";
import { englishT } from "@/i18n/translate";
import { ALL_DAYS, breakfastChangesIn, breakfastDays, breakfastHours, breakfastNow, breakfastSchedule, clock12, stayHasBreakfast } from "./breakfast";

const TZ = "Africa/Dar_es_Salaam";
const settings = { breakfastStartMinutes: 360, breakfastEndMinutes: 630, breakfastDays: ALL_DAYS, breakfastLocation: null, breakfastNote: null };
const daily = breakfastSchedule(settings);
/** A moment given in hotel time (EAT is UTC+3, no daylight saving). */
const eat = (iso: string) => new Date(`${iso}+03:00`);

describe("breakfast schedule", () => {
  it("is 6:00 AM – 10:30 AM, every day, by default", () => {
    expect(breakfastHours(daily)).toBe("6:00 AM – 10:30 AM");
    expect(breakfastHours(daily, "zh-CN")).toBe("06:00 – 10:30");
    expect(breakfastDays(daily, englishT)).toBe("Every day");
  });

  it("writes the clock the 12-hour way", () => {
    expect(clock12(0)).toBe("12:00 AM");
    expect(clock12(720)).toBe("12:00 PM");
    expect(clock12(785)).toBe("1:05 PM");
  });

  it("names the days when it is not every day, and never ends up with no day at all", () => {
    expect(breakfastDays(breakfastSchedule({ ...settings, breakfastDays: [6, 1, 1, 9] }), englishT)).toBe("Mon, Sat");
    expect(breakfastSchedule({ ...settings, breakfastDays: [] }).days).toEqual(ALL_DAYS);
  });

  it("invents no place and no note", () => {
    expect(daily.location).toBeNull();
    expect(breakfastSchedule({ ...settings, breakfastLocation: "  ", breakfastNote: " Ground floor " })).toMatchObject({ location: null, note: "Ground floor" });
  });
});

describe("breakfast right now, in hotel time", () => {
  it("follows the serving window to the minute", () => {
    expect(breakfastNow(daily, eat("2026-10-12T05:59:00"), TZ)).toBe("LATER");
    expect(breakfastNow(daily, eat("2026-10-12T06:00:00"), TZ)).toBe("NOW");
    expect(breakfastNow(daily, eat("2026-10-12T10:29:00"), TZ)).toBe("NOW");
    expect(breakfastNow(daily, eat("2026-10-12T10:30:00"), TZ)).toBe("FINISHED");
  });

  it("uses the hotel's clock, not the reader's", () => {
    // 04:00 UTC is 07:00 in Dar es Salaam.
    expect(breakfastNow(daily, new Date("2026-10-12T04:00:00Z"), TZ)).toBe("NOW");
    expect(breakfastNow(daily, new Date("2026-10-12T04:00:00Z"), "America/New_York")).toBe("LATER");
  });

  it("says when an open page should ask again", () => {
    expect(breakfastChangesIn(daily, eat("2026-10-12T05:30:00"), TZ)).toBe(30);
    expect(breakfastChangesIn(daily, eat("2026-10-12T10:00:00"), TZ)).toBe(30);
    expect(breakfastChangesIn(daily, eat("2026-10-12T23:00:00"), TZ)).toBe(60);
  });

  it("knows a day without breakfast", () => {
    // 12 October 2026 is a Monday.
    const weekend = breakfastSchedule({ ...settings, breakfastDays: [0, 6] });
    expect(breakfastNow(weekend, eat("2026-10-12T07:00:00"), TZ)).toBe("NOT_TODAY");
    expect(breakfastNow(weekend, eat("2026-10-11T07:00:00"), TZ)).toBe("NOW");
  });
});

describe("who gets breakfast", () => {
  it("is a night stay in a guest room, when the hotel includes breakfast", () => {
    expect(stayHasBreakfast({ shortTime: false }, true)).toBe(true);
    expect(stayHasBreakfast({ shortTime: true }, true)).toBe(false);
    expect(stayHasBreakfast({ shortTime: false, meeting: true }, true)).toBe(false);
  });

  it("promises nothing when the hotel has not said breakfast is included", () => {
    expect(stayHasBreakfast({ shortTime: false }, false)).toBe(false);
  });
});
