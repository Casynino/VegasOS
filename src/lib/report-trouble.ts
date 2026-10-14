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
  /** The hotel's hour now (0–23). */
  hour: number;
  /** From this hour the report should have reached the Boss (its scheduled time and its first retries are over). */
  dueByHour: number;
  report: { generatedAt: Date; deliveries: { status: string; sentAt: Date | null }[] } | null;
}

export function reportTrouble(f: ReportFacts): ReportTrouble | null {
  if (!f.enabled || !f.hasRecipients) return null;
  const late = f.hour >= f.dueByHour;
  if (!f.report) return late ? "missing" : null;
  // A send counts only if it was of THIS version of the report (a report made again must be sent again).
  const reached = f.report.deliveries.some((d) => d.status === "SENT" && d.sentAt && d.sentAt >= f.report!.generatedAt);
  if (reached) return null;
  if (f.report.deliveries.some((d) => d.status === "FAILED")) return "failed";
  return late ? "unsent" : null;
}
