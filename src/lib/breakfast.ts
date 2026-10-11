import type { T } from "@/i18n/translate";

/**
 * Complimentary breakfast — the one place that knows when it is served and who gets it. Every guest page, message,
 * printed list and staff screen reads the schedule from here (it lives in the hotel's settings), so a change in
 * Settings shows everywhere at once.
 */
export type BreakfastSchedule = {
  /** Minutes after midnight, hotel time. */
  start: number;
  end: number;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  location: string | null;
  note: string | null;
};

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

type ScheduleSettings = {
  breakfastStartMinutes: number;
  breakfastEndMinutes: number;
  breakfastDays: number[];
  breakfastLocation: string | null;
  breakfastNote: string | null;
};

export function breakfastSchedule(s: ScheduleSettings): BreakfastSchedule {
  const days = [...new Set(s.breakfastDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  return {
    start: s.breakfastStartMinutes,
    end: s.breakfastEndMinutes,
    days: days.length ? days : ALL_DAYS,
    location: s.breakfastLocation?.trim() || null,
    note: s.breakfastNote?.trim() || null,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 360 → "6:00 AM" · 630 → "10:30 AM" · 0 → "12:00 AM" · 780 → "1:00 PM". */
export function clock12(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(minutes % 60)} ${h < 12 ? "AM" : "PM"}`;
}

/** The time of day the way the reader's language writes it: "6:00 AM" in English, "06:00" in Chinese. */
export const breakfastClock = (minutes: number, locale: string = "en") =>
  locale === "zh-CN" ? `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}` : clock12(minutes);

/** "6:00 AM – 10:30 AM" (English) · "06:00 – 10:30" (Chinese). */
export const breakfastHours = (b: Pick<BreakfastSchedule, "start" | "end">, locale: string = "en") =>
  `${breakfastClock(b.start, locale)} – ${breakfastClock(b.end, locale)}`;

export const everyDay = (b: Pick<BreakfastSchedule, "days">) => ALL_DAYS.every((d) => b.days.includes(d));

/** "Every day", or the serving days by name ("Mon, Tue, Wed"). */
export function breakfastDays(b: Pick<BreakfastSchedule, "days">, t: T) {
  if (everyDay(b)) return t("Every day");
  const fmt = new Intl.DateTimeFormat(t.intl, { weekday: "short", timeZone: "UTC" });
  // 4 January 1970 was a Sunday.
  return b.days.map((d) => fmt.format(new Date(Date.UTC(1970, 0, 4 + d)))).join(", ");
}

/**
 * Where today's breakfast stands at this moment in the hotel's own time (never the reader's phone clock):
 *  • NOW       — being served.
 *  • LATER     — served today, not started yet.
 *  • FINISHED  — today's breakfast is over.
 *  • NOT_TODAY — not a serving day.
 */
export type BreakfastNow = "NOW" | "LATER" | "FINISHED" | "NOT_TODAY";

function hotelClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).formatToParts(now);
  const of = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(of("weekday")), minutes: Number(of("hour")) * 60 + Number(of("minute")) };
}

export function breakfastNow(b: Pick<BreakfastSchedule, "start" | "end" | "days">, now: Date, timezone: string): BreakfastNow {
  const { day, minutes } = hotelClock(now, timezone);
  if (!b.days.includes(day)) return "NOT_TODAY";
  return minutes < b.start ? "LATER" : minutes < b.end ? "NOW" : "FINISHED";
}

/** Minutes until the answer of `breakfastNow` can change (it starts, it ends, or the day turns) — when an open page should ask again. */
export function breakfastChangesIn(b: Pick<BreakfastSchedule, "start" | "end" | "days">, now: Date, timezone: string) {
  const { minutes } = hotelClock(now, timezone);
  const state = breakfastNow(b, now, timezone);
  return Math.max(1, (state === "LATER" ? b.start : state === "NOW" ? b.end : 1440) - minutes);
}

/**
 * Does this stay come with breakfast? Only when the hotel includes breakfast with room stays AND it is a night stay in
 * a guest room — a short-time (day) stay and a meeting-room booking have none. When the hotel has not said breakfast
 * is included, nothing is promised.
 */
export const stayHasBreakfast = (stay: { shortTime: boolean; meeting?: boolean }, hotelIncludesBreakfast: boolean) =>
  hotelIncludesBreakfast && !stay.shortTime && !stay.meeting;
