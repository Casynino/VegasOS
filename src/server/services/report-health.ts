import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings, liveSinceDate } from "../settings";
import { addDays, businessDateOf, toDbDate } from "@/lib/time/business-date";
import { reportIsLate, reportTrouble, type ReportTrouble } from "@/lib/report-trouble";

export interface ReportTroubles {
  /** The last closed day's daily report: what is wrong with it and where to open it (null id = it was never made). */
  daily: { kind: ReportTrouble; id: string | null } | null;
  room: { kind: ReportTrouble } | null;
}

/** The daily report is due to have reached the Boss by this hour of the NEXT calendar day (made 07:00, retried 07:35) and the room report by this one (06:30, 06:50) — see reportDueAt. */
export const DAILY_DUE_HOUR = 8;
export const ROOM_DUE_HOUR = 7;

/** Whether the Boss has what he should have by now: the last closed day's daily report and room report (shown on the Boss's home). */
export async function reportTroubles(now = new Date()): Promise<ReportTroubles> {
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const yesterday = addDays(businessDateOf(now, cfg), -1);
  const live = liveSinceDate(settings);
  if (live && yesterday < live) return { daily: null, room: null };
  const hasRecipients = (((settings.reportRecipients as unknown as unknown[]) ?? []).length) > 0;
  const [daily, room] = await Promise.all([
    db.dailyReport.findUnique({ where: { businessDate: toDbDate(yesterday) }, select: { id: true, generatedAt: true, deliveries: { select: { purpose: true, status: true, sentAt: true } } } }),
    db.roomReport.findUnique({ where: { businessDate: toDbDate(yesterday) }, select: { generatedAt: true } }),
  ]);
  // The daily report's row also carries the room report's deliveries (told apart by purpose).
  const of = (purpose: string) => (daily?.deliveries ?? []).filter((d) => d.purpose === purpose).map((d) => ({ status: d.status, sentAt: d.sentAt }));
  const dailyKind = reportTrouble({ enabled: settings.reportEnabled, hasRecipients, late: reportIsLate(yesterday, now, DAILY_DUE_HOUR, cfg.timezone), report: daily ? { generatedAt: daily.generatedAt, deliveries: of("DAILY_REPORT") } : null });
  const roomKind = reportTrouble({ enabled: settings.reportEnabled && settings.roomReportEnabled, hasRecipients, late: reportIsLate(yesterday, now, ROOM_DUE_HOUR, cfg.timezone), report: room ? { generatedAt: room.generatedAt, deliveries: of("ROOM_REPORT") } : null });
  return { daily: dailyKind ? { kind: dailyKind, id: daily?.id ?? null } : null, room: roomKind ? { kind: roomKind } : null };
}
