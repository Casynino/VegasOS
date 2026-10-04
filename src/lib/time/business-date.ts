/**
 * HotelBusinessDateService — the single place that knows what a "hotel day" is.
 *
 * The hotel business day runs from `businessDayStartMinutes` (default 04:00)
 * to the same time the following calendar day, in the hotel's timezone.
 * A payment taken at 02:30 on 26 Sept belongs to business date 25 Sept.
 *
 * Business dates are represented as ISO strings ("2026-09-25") everywhere in
 * application code, and as UTC-midnight `Date`s only at the Prisma boundary
 * (`@db.Date` columns) via `toDbDate` / `fromDbDate`.
 *
 * Pure functions only — no database access — so every rule is unit-testable.
 */

export type BusinessDate = string; // YYYY-MM-DD

export interface BusinessDayConfig {
  timezone: string; // IANA, e.g. "Africa/Dar_es_Salaam"
  businessDayStartMinutes: number; // minutes after local midnight, e.g. 240 = 04:00
}

export const DEFAULT_BUSINESS_DAY: BusinessDayConfig = {
  timezone: "Africa/Dar_es_Salaam",
  businessDayStartMinutes: 240,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isBusinessDate(value: unknown): value is BusinessDate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function assertBusinessDate(value: string): void {
  if (!isBusinessDate(value)) throw new Error(`Invalid business date: ${value}`);
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timezone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in the given timezone. */
export function localParts(instant: Date, timezone: string): LocalParts {
  const parts = formatterFor(timezone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) of `timezone` from UTC at the given instant. */
function offsetMs(instant: Date, timezone: string): number {
  const p = localParts(instant, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which local `date` + `minutes` occurs in `timezone`. */
export function zonedInstant(date: BusinessDate, minutes: number, timezone: string): Date {
  assertBusinessDate(date);
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  // Two passes handle zones with DST transitions; Tanzania has none but the
  // service must stay correct if the configured timezone ever changes.
  let result = guess - offsetMs(new Date(guess), timezone);
  result = guess - offsetMs(new Date(result), timezone);
  return new Date(result);
}

/** Local calendar date (not business date) of an instant. */
export function localCalendarDate(instant: Date, timezone: string): BusinessDate {
  const p = localParts(instant, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes since local midnight for an instant. */
export function localMinutesOfDay(instant: Date, timezone: string): number {
  const p = localParts(instant, timezone);
  return p.hour * 60 + p.minute;
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  assertBusinessDate(date);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function diffDays(a: BusinessDate, b: BusinessDate): number {
  assertBusinessDate(a);
  assertBusinessDate(b);
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** Inclusive list of business dates from `from` up to but excluding `to`. */
export function eachDate(from: BusinessDate, to: BusinessDate): BusinessDate[] {
  const out: BusinessDate[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The hotel business date an instant belongs to. */
export function businessDateOf(
  instant: Date,
  config: BusinessDayConfig = DEFAULT_BUSINESS_DAY,
): BusinessDate {
  const calendar = localCalendarDate(instant, config.timezone);
  const minutes = localMinutesOfDay(instant, config.timezone);
  return minutes < config.businessDayStartMinutes ? addDays(calendar, -1) : calendar;
}

/** [start, end) instants of a business date. */
export function businessDayBounds(
  date: BusinessDate,
  config: BusinessDayConfig = DEFAULT_BUSINESS_DAY,
): { start: Date; end: Date } {
  return {
    start: zonedInstant(date, config.businessDayStartMinutes, config.timezone),
    end: zonedInstant(addDays(date, 1), config.businessDayStartMinutes, config.timezone),
  };
}

/** [start, end) instants covering business dates from..to inclusive. */
export function businessRangeBounds(
  from: BusinessDate,
  to: BusinessDate,
  config: BusinessDayConfig = DEFAULT_BUSINESS_DAY,
): { start: Date; end: Date } {
  if (to < from) throw new Error("Range end is before range start");
  return {
    start: businessDayBounds(from, config).start,
    end: businessDayBounds(to, config).end,
  };
}

/** Business date → value for a Prisma `@db.Date` column. */
export function toDbDate(date: BusinessDate): Date {
  assertBusinessDate(date);
  return new Date(`${date}T00:00:00Z`);
}

/** Prisma `@db.Date` value → business date. */
export function fromDbDate(value: Date): BusinessDate {
  return value.toISOString().slice(0, 10);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function parseTimeToMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export type PeriodPreset = "today" | "yesterday" | "week" | "month" | "year";

/** Inclusive business-date range for a reporting preset, anchored on `today`. */
export function presetRange(
  preset: PeriodPreset,
  today: BusinessDate,
): { from: BusinessDate; to: BusinessDate } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "week": {
      // ISO week: Monday start.
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
      return { from: addDays(today, 1 - dow), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}
