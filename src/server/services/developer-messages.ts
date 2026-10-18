import "server-only";
import { db } from "../db";
import { liveSinceDate } from "../settings";
import { addDays, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { formatTime } from "@/lib/format";
import { msg } from "@/i18n/msg";
import { deliveryErrorKind, maskPhone } from "@/lib/console-scrub";
import { reportIsLate, reportTrouble, type ReportTrouble } from "@/lib/report-trouble";
import vercelConfig from "../../../vercel.json";
import { assertConsoleAccess, safe, type ConsoleUser } from "./developer-console";
import { consoleFrame, countPerDay, DAY_MS, TABLE_DAYS } from "./developer-frame";
import { DAILY_DUE_HOUR, reportTroubles, ROOM_DUE_HOUR } from "./report-health";
import { MAX_ATTEMPTS } from "./report-delivery";

/**
 * THE MESSAGES & REPORTS TAB (owner, 2026-10-18): is the Boss getting what he should. Read-only. Whether the last closed day's reports
 * were made and reached him comes from report-health.ts (the same function the Boss's home uses); the table of closed days uses its
 * pure rule (lib/report-trouble.ts) so a day's state can never differ from the card's. The text of a message is NEVER read: only
 * its purpose, its state, its time and the KIND of trouble in plain words (deliveryErrorKind) — the provider's own reply is never
 * returned, because CallMeBot echoes the message it was given ("Message to: … Text to send: …") — and a phone number as its last
 * three digits only.
 *
 * Days are hotel days (04:00 → 04:00); a delivery is on the day it was made. Short notices to the Boss ("Work as started"…) are sent
 * but not written down anywhere, so they cannot be counted.
 */

export const MESSAGE_ROWS = { problems: 15 } as const;
/** How many arrival-reminder rows are read to be collapsed to one line per reservation. */
export const REMINDER_WINDOW = 300;

/** A report of a closed day, as the table states it. */
export type ReportState = "ok" | "failed" | "unsent" | "missing" | "waiting" | "off" | "before-live";

export const PURPOSE_WORDS: Record<string, string> = {
  DAILY_REPORT: msg("Daily report"), ROOM_REPORT: msg("Room report"), SHIFT_REPORT: msg("Shift reports"), STAFF_REPORT: msg("Weekly and monthly reports"),
  GUEST: msg("Guest messages"), OTHER: msg("Other messages"),
};
/** Which group a delivery's purpose belongs to (a reminder to a guest is a guest message). */
export const purposeGroup = (purpose: string): string =>
  purpose === "ARRIVAL_REMINDER" ? "GUEST" : Object.hasOwn(PURPOSE_WORDS, purpose) && purpose !== "OTHER" && purpose !== "GUEST" ? purpose : "OTHER";

export interface ReportKindRow { state: ReportState; madeAt: Date | null; version: number | null; automatic: boolean | null; sentAt: Date | null }
export interface ReportDayRow { date: BusinessDate; daily: ReportKindRow; room: ReportKindRow }
export interface ProblemRow {
  id: string; at: Date; purpose: string; recipient: string; status: "FAILED" | "PENDING";
  /** Tries so far. For an arrival reminder (one line per reservation) it is the number of runs that failed. */
  attempts: number;
  /** A failed delivery that has had all MAX_ATTEMPTS tries: nothing tries it again by itself (only a person's "send again"). Never true for a reminder. */
  atMax: boolean;
  /** An arrival reminder: each run of the daily job makes a NEW row and none is ever tried again, so the rows of one reservation are one line. */
  reminder: boolean;
  /** The kind of trouble, in plain words. The provider's own reply is never returned. */
  kind: string;
}
export interface CronJob {
  path: string; label: string; times: string[]; /** Schedules this page could not read as a daily time, as written. */ other: string[];
  /** The newest report the job ITSELF made (automatic) — the proof it ran. */
  lastMadeAt: Date | null; lastDate: BusinessDate | null;
  /** The newest report a person made by hand, shown apart (it is not proof of the job). */
  lastByPerson: { at: Date; date: BusinessDate } | null;
}

/** The Boss's other reports: the shift-end reports, and the weekly and monthly reports. When the newest was sent, and how the last 7 days went. */
export interface OtherReportRow { key: "SHIFT_REPORT" | "STAFF_REPORT"; lastSentAt: Date | null; sent7d: number; failed7d: number; waiting7d: number }

export interface MessagesData {
  today: BusinessDate;
  dayStart: string;
  days: BusinessDate[];
  reportsOn: boolean;
  recipients: number;
  /** Deliveries of the last 24 hours: sent (by the time it went), failed (by the time of its last try), waiting (made in the last 7 days and not sent yet). */
  deliveries24h: { sent: number; failed: number; waiting: number } | null;
  /** The last closed day's two reports: the state, and the trouble the Boss's home would show (null = none). */
  lastClosed: { date: BusinessDate; daily: ReportKindRow & { trouble: ReportTrouble | null }; room: ReportKindRow & { trouble: ReportTrouble | null } } | null;
  /** Failed deliveries of the last 7 days: fewer than MAX_ATTEMPTS tries so far, and all MAX_ATTEMPTS used (no more automatic tries). */
  retry: { underMax: number; atMax: number } | null;
  guestMessages24h: { sent: number; failed: number } | null;
  perDay: { date: BusinessDate; sent: number; failed: number; pending: number }[] | null;
  byPurpose: { key: string; count: number; failed: number }[] | null;
  reportDays: ReportDayRow[] | null;
  /** Shift-end reports and weekly / monthly reports (the daily and room reports are in `reportDays`). */
  otherReports: OtherReportRow[] | null;
  problems: ProblemRow[] | null;
  jobs: CronJob[] | null;
  maxAttempts: number;
}

const CRON_LABEL: Record<string, string> = { "/api/cron/daily-report": msg("Daily report"), "/api/cron/room-report": msg("Room report") };

/** "5 1 * * *" (UTC) → "04:05" in the hotel's time zone; null when it is not a plain daily time. */
export function cronHotelTime(schedule: string, timezone: string): string | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (!m || +m[1] > 59 || +m[2] > 23) return null;
  // A mid-January day: the hotel's zone has no change of clock then, so the time is the one it keeps all year.
  return formatTime(new Date(Date.UTC(2026, 0, 15, +m[2], +m[1])), timezone);
}

/** The jobs in vercel.json, in the hotel's time (the file is the schedule — nothing is written twice). */
export function cronJobs(timezone: string): Omit<CronJob, "lastMadeAt" | "lastDate" | "lastByPerson">[] {
  const byPath = new Map<string, { times: string[]; other: string[] }>();
  for (const c of vercelConfig.crons ?? []) {
    const slot = byPath.get(c.path) ?? { times: [], other: [] };
    const time = cronHotelTime(c.schedule, timezone);
    if (time) slot.times.push(time); else slot.other.push(c.schedule);
    byPath.set(c.path, slot);
  }
  return [...byPath].map(([path, s]) => ({ path, label: CRON_LABEL[path] ?? path, times: [...new Set(s.times)].sort(), other: s.other }));
}

export async function messagesData(user: ConsoleUser, now = new Date()): Promise<MessagesData> {
  assertConsoleAccess(user);
  const f = await consoleFrame(now);
  const { cfg, today, days, settings } = f;
  const since24 = new Date(now.getTime() - DAY_MS);
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const closed = Array.from({ length: TABLE_DAYS }, (_, i) => addDays(today, -(i + 1)));
  const recipients = Array.isArray(settings.reportRecipients) ? (settings.reportRecipients as unknown[]).length : 0;
  const live = liveSinceDate(settings);
  const sentOrDelivered = ["SENT", "DELIVERED"] as const;
  const failed7d = { status: "FAILED" as const, createdAt: { gte: since7d } };
  const unfinished = { status: { in: ["FAILED", "PENDING"] as ("FAILED" | "PENDING")[] } };
  const problemSelect = { id: true, purpose: true, status: true, recipient: true, attempts: true, lastError: true, updatedAt: true, reservationId: true } as const;
  const newestFirst = [{ updatedAt: "desc" as const }, { id: "desc" as const }];
  // The newest report of each kind the job itself made (automatic) and the newest a person made by hand. `{ row }` keeps "none yet" apart from "could not be read".
  const newestReport = (model: "dailyReport" | "roomReport", automatic: boolean) => safe(async () => {
    const args = { where: { automatic }, orderBy: [{ generatedAt: "desc" as const }, { id: "desc" as const }], select: { businessDate: true, generatedAt: true } };
    return { row: model === "dailyReport" ? await db.dailyReport.findFirst(args) : await db.roomReport.findFirst(args) };
  });

  const [sent24, failed24, waiting, underMax, atMax, guestSent, guestFailed, rows14, guestWeek, dailyRows, roomRows, problemRows, reminderRows, troubles, lastDaily, lastRoom, handDaily, handRoom, lastShift, lastStaff] = await Promise.all([
    safe(() => db.notificationDelivery.count({ where: { status: { in: [...sentOrDelivered] }, sentAt: { gte: since24 } } })),
    safe(() => db.notificationDelivery.count({ where: { status: "FAILED", updatedAt: { gte: since24 } } })),
    safe(() => db.notificationDelivery.count({ where: { status: "PENDING", createdAt: { gte: since7d } } })),
    safe(() => db.notificationDelivery.count({ where: { ...failed7d, attempts: { lt: MAX_ATTEMPTS } } })),
    safe(() => db.notificationDelivery.count({ where: { ...failed7d, attempts: { gte: MAX_ATTEMPTS } } })),
    safe(() => db.guestMessage.count({ where: { status: "SENT", createdAt: { gte: since24 } } })),
    safe(() => db.guestMessage.count({ where: { status: "FAILED", createdAt: { gte: since24 } } })),
    safe(() => db.notificationDelivery.findMany({ where: { createdAt: { gte: f.start } }, select: { purpose: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5000 })),
    safe(() => db.guestMessage.groupBy({ by: ["status"], where: { createdAt: { gte: f.weekStart } }, _count: true })),
    safe(() => db.dailyReport.findMany({
      where: { businessDate: { in: closed.map(toDbDate) } },
      select: { businessDate: true, generatedAt: true, version: true, automatic: true, deliveries: { select: { purpose: true, status: true, sentAt: true } } },
    })),
    safe(() => db.roomReport.findMany({ where: { businessDate: { in: closed.map(toDbDate) } }, select: { businessDate: true, generatedAt: true, version: true, automatic: true } })),
    safe(() => db.notificationDelivery.findMany({ where: { ...unfinished, purpose: { not: "ARRIVAL_REMINDER" } }, orderBy: newestFirst, take: MESSAGE_ROWS.problems, select: problemSelect })),
    // Arrival reminders are collapsed to one line per reservation below, so a bigger window is read.
    safe(() => db.notificationDelivery.findMany({ where: { ...unfinished, purpose: "ARRIVAL_REMINDER" }, orderBy: newestFirst, take: REMINDER_WINDOW, select: problemSelect })),
    safe(() => reportTroubles(now)),
    newestReport("dailyReport", true), newestReport("roomReport", true), newestReport("dailyReport", false), newestReport("roomReport", false),
    // When the newest shift report / weekly or monthly report really went out (`{ at }` keeps "never sent" apart from "could not be read").
    ...(["SHIFT_REPORT", "STAFF_REPORT"] as const).map((purpose) => safe(async () => ({
      at: (await db.notificationDelivery.findFirst({ where: { purpose, status: { in: [...sentOrDelivered] }, sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }))?.sentAt ?? null,
    }))),
  ]);

  // ── the closed days × the two reports ──
  const reportsOn = settings.reportEnabled;
  let reportDays: MessagesData["reportDays"] = null;
  if (dailyRows && roomRows) {
    const kindRow = (
      date: BusinessDate, report: { generatedAt: Date; version: number; automatic: boolean } | undefined, deliveries: { status: string; sentAt: Date | null }[], enabled: boolean, dueByHour: number,
    ): ReportKindRow => {
      const reached = report ? deliveries.filter((d) => d.status === "SENT" && d.sentAt && d.sentAt >= report.generatedAt) : [];
      const sentAt = reached.length ? new Date(Math.max(...reached.map((d) => d.sentAt!.getTime()))) : null;
      const base = { madeAt: report?.generatedAt ?? null, version: report?.version ?? null, automatic: report?.automatic ?? null, sentAt };
      if (live && date < live) return { state: "before-live", ...base };
      if (!enabled || recipients === 0) return { state: "off", ...base };
      // Late = past the report's due INSTANT (the next calendar day from its hour, hotel time) — the same rule as the Boss's home; every older day is past it.
      const trouble = reportTrouble({ enabled, hasRecipients: true, late: reportIsLate(date, now, dueByHour, cfg.timezone), report: report ? { generatedAt: report.generatedAt, deliveries } : null });
      return { state: trouble ?? (sentAt ? "ok" : "waiting"), ...base };
    };
    reportDays = closed.map((date) => {
      const daily = dailyRows.find((r) => fromDbDate(r.businessDate) === date);
      const room = roomRows.find((r) => fromDbDate(r.businessDate) === date);
      const of = (purpose: string) => (daily?.deliveries ?? []).filter((d) => d.purpose === purpose);
      return {
        date,
        daily: kindRow(date, daily, of("DAILY_REPORT"), reportsOn, DAILY_DUE_HOUR),
        // The room report's sends are kept on the daily report's row, told apart by purpose.
        room: kindRow(date, room, of("ROOM_REPORT"), reportsOn && settings.roomReportEnabled, ROOM_DUE_HOUR),
      };
    });
  }
  const lastClosed = reportDays && troubles
    ? { date: closed[0], daily: { ...reportDays[0].daily, trouble: troubles.daily?.kind ?? null }, room: { ...reportDays[0].room, trouble: troubles.room?.kind ?? null } }
    : null;

  // ── deliveries per day and by purpose ──
  let perDay: MessagesData["perDay"] = null;
  let byPurpose: MessagesData["byPurpose"] = null;
  if (rows14) {
    const group = (statuses: string[]) => countPerDay(rows14.filter((r) => statuses.includes(r.status)).map((r) => r.createdAt), days, cfg);
    const sent = group(["SENT", "DELIVERED"]), failed = group(["FAILED"]), pending = group(["PENDING"]);
    perDay = days.map((date) => ({ date, sent: sent[date], failed: failed[date], pending: pending[date] }));
    const tally = new Map<string, { count: number; failed: number }>();
    const put = (key: string, count: number, failedCount: number) => { const t = tally.get(key) ?? { count: 0, failed: 0 }; t.count += count; t.failed += failedCount; tally.set(key, t); };
    for (const r of rows14) if (r.createdAt >= f.weekStart) put(purposeGroup(r.purpose), 1, r.status === "FAILED" ? 1 : 0);
    if (guestWeek) for (const g of guestWeek) put("GUEST", g._count, g.status === "FAILED" ? g._count : 0);
    byPurpose = [...tally].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  // ── the shift-end, weekly and monthly reports: last sent, and the last 7 days ──
  let otherReports: MessagesData["otherReports"] = null;
  if (rows14 && lastShift && lastStaff) {
    otherReports = (["SHIFT_REPORT", "STAFF_REPORT"] as const).map((key) => {
      const week = rows14.filter((r) => r.purpose === key && r.createdAt >= f.weekStart);
      return {
        key, lastSentAt: (key === "SHIFT_REPORT" ? lastShift : lastStaff).at,
        sent7d: week.filter((r) => r.status === "SENT" || r.status === "DELIVERED").length, failed7d: week.filter((r) => r.status === "FAILED").length, waiting7d: week.filter((r) => r.status === "PENDING").length,
      };
    });
  }

  // ── failed or waiting deliveries: the KIND of trouble only, never the provider's words ──
  type Pending = { id: string; purpose: string; status: string; recipient: string; attempts: number; lastError: string | null; updatedAt: Date; reservationId: string | null };
  const line = (r: Pending, reminder: boolean, attempts: number): ProblemRow => ({
    id: r.id, at: r.updatedAt, purpose: PURPOSE_WORDS[purposeGroup(r.purpose)], recipient: maskPhone(r.recipient), status: r.status === "FAILED" ? "FAILED" : "PENDING",
    attempts, reminder, atMax: !reminder && r.status === "FAILED" && r.attempts >= MAX_ATTEMPTS,
    kind: r.lastError ? deliveryErrorKind(r.lastError) : r.status === "PENDING" ? msg("Not sent yet") : deliveryErrorKind(null),
  });
  let problems: ProblemRow[] | null = null;
  if (problemRows && reminderRows) {
    // Newest first: the first row seen of a reservation is its newest, the others only count the runs that failed.
    const reminders = new Map<string, { newest: Pending; runs: number }>();
    for (const r of reminderRows) {
      const key = r.reservationId ?? `to:${r.recipient}`;
      const seen = reminders.get(key);
      if (seen) seen.runs += Math.max(1, r.attempts); else reminders.set(key, { newest: r, runs: Math.max(1, r.attempts) });
    }
    problems = [...problemRows.map((r) => line(r, false, r.attempts)), ...[...reminders.values()].map((x) => line(x.newest, true, x.runs))]
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id))
      .slice(0, MESSAGE_ROWS.problems);
  }

  const mark = (found: { row: { businessDate: Date; generatedAt: Date } | null } | null) => (found?.row ? { date: fromDbDate(found.row.businessDate), at: found.row.generatedAt } : null);
  const readJobs = lastDaily && lastRoom && handDaily && handRoom;
  const proof: Record<string, { auto: ReturnType<typeof mark>; hand: ReturnType<typeof mark> }> = {
    "/api/cron/daily-report": { auto: mark(lastDaily), hand: mark(handDaily) },
    "/api/cron/room-report": { auto: mark(lastRoom), hand: mark(handRoom) },
  };
  const jobs = readJobs
    ? cronJobs(cfg.timezone).map((j): CronJob => ({ ...j, lastMadeAt: proof[j.path]?.auto?.at ?? null, lastDate: proof[j.path]?.auto?.date ?? null, lastByPerson: proof[j.path]?.hand ?? null }))
    : null;

  return {
    today, dayStart: f.dayStart, days, reportsOn, recipients,
    deliveries24h: sent24 !== null && failed24 !== null && waiting !== null ? { sent: sent24, failed: failed24, waiting } : null,
    lastClosed,
    retry: underMax !== null && atMax !== null ? { underMax, atMax } : null,
    guestMessages24h: guestSent !== null && guestFailed !== null ? { sent: guestSent, failed: guestFailed } : null,
    perDay, byPurpose, reportDays, otherReports, problems, jobs,
    maxAttempts: MAX_ATTEMPTS,
  };
}
