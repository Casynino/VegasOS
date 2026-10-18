import { addDays, zonedInstant, type BusinessDate } from "@/lib/time/business-date";

/**
 * What is wrong with a report meant for the Boss (the daily report, the room report), if anything — worked out from facts only.
 * "failed": a send was tried and failed; "unsent": the report exists but nothing reached the Boss yet and its time has passed;
 * "missing": no report was made at all and its time has passed. Nothing is flagged before the report's own time, or when the
 * reports are switched off or nobody is set to receive them.
 */
export type ReportTrouble = "failed" | "unsent" | "missing";

export interface ReportFacts {
  enabled: boolean;
  hasRecipients: boolean;
  /** The report's time has passed: it should have reached the Boss by now (see reportIsLate — worked out from the due INSTANT, never from the clock hour alone). */
  late: boolean;
  report: { generatedAt: Date; deliveries: { status: string; sentAt: Date | null }[] } | null;
}

export function reportTrouble(f: ReportFacts): ReportTrouble | null {
  if (!f.enabled || !f.hasRecipients) return null;
  if (!f.report) return f.late ? "missing" : null;
  // A send counts only if it was of THIS version of the report (a report made again must be sent again).
  const reached = f.report.deliveries.some((d) => d.status === "SENT" && d.sentAt && d.sentAt >= f.report!.generatedAt);
  if (reached) return null;
  if (f.report.deliveries.some((d) => d.status === "FAILED")) return "failed";
  return f.late ? "unsent" : null;
}

/**
 * When the report of business day `date` is due to have reached the Boss: on the NEXT calendar day, from `dueByHour` (its scheduled time
 * and its first retries are over), in the hotel's time zone. A hotel day ends at 04:00, so between 00:00 and 03:59 the business date is
 * still the previous calendar day: the clock hour alone would call a report that was due 17 hours earlier "not due yet".
 */
export function reportDueAt(date: BusinessDate, dueByHour: number, timezone: string): Date {
  return zonedInstant(addDays(date, 1), dueByHour * 60, timezone);
}

/** The report of business day `date` is past its due instant. */
export const reportIsLate = (date: BusinessDate, now: Date, dueByHour: number, timezone: string): boolean => now.getTime() >= reportDueAt(date, dueByHour, timezone).getTime();
