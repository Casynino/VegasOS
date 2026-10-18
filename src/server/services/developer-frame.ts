import "server-only";
import { businessDayConfig, getSettings } from "../settings";
import { addDays, businessDateOf, businessRangeBounds, eachDate, type BusinessDate, type BusinessDayConfig } from "@/lib/time/business-date";
import { formatMinutesLabel } from "@/lib/format";

/**
 * The window every Developer-console chart and table is drawn over (owner, 2026-10-18): the last 14 HOTEL days for a chart, the
 * last 7 for a table — a hotel day runs from the hotel's start time (04:00) to the same time next morning, in the hotel's own time
 * zone, never from UTC midnight. Shared by the Hotel, Money and Messages tabs and the "New records per day" chart.
 */
export const CHART_DAYS = 14;
export const TABLE_DAYS = 7;
export const HOUR_MS = 3600_000;
export const DAY_MS = 24 * HOUR_MS;

export interface ConsoleFrame {
  cfg: BusinessDayConfig;
  settings: Awaited<ReturnType<typeof getSettings>>;
  today: BusinessDate;
  /** The last 14 hotel days, oldest first, ending today. */
  days: BusinessDate[];
  /** Start of the first of those days and end of today. */
  start: Date;
  end: Date;
  /** The last 7 hotel days (a table's window): the first of them, and where it starts. */
  weekFrom: BusinessDate;
  weekStart: Date;
  /** When a hotel day starts, as "04:00". */
  dayStart: string;
}

export async function consoleFrame(now: Date): Promise<ConsoleFrame> {
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  const days = eachDate(addDays(today, -(CHART_DAYS - 1)), addDays(today, 1));
  const { start, end } = businessRangeBounds(days[0], today, cfg);
  const weekFrom = addDays(today, -(TABLE_DAYS - 1));
  return { cfg, settings, today, days, start, end, weekFrom, weekStart: businessRangeBounds(weekFrom, today, cfg).start, dayStart: formatMinutesLabel(cfg.businessDayStartMinutes) };
}

/** How many of these instants fall on each hotel day (a day not listed in `days` is left out). */
export function countPerDay(instants: Date[], days: BusinessDate[], cfg: BusinessDayConfig): Record<BusinessDate, number> {
  const out: Record<BusinessDate, number> = Object.fromEntries(days.map((d) => [d, 0]));
  for (const at of instants) {
    const d = businessDateOf(at, cfg);
    if (d in out) out[d] += 1;
  }
  return out;
}

/** "Joe Smith (Reception)" → "Joe Smith": the name without the role tag some accounts carry. */
export const plainName = (fullName: string): string => fullName.replace(/\s*\(.*?\)/g, "").trim() || fullName.trim();
