import { timingSafeEqual } from "node:crypto";
import { runDailyReportJob } from "@/server/services/daily-report";
import { retryShiftReports } from "@/server/services/shift-report";
import { runStaffPeriodJob } from "@/server/services/staff-report";
import { sweepMobilePayments } from "@/server/services/mobile-payments";
import { sweepWithdrawals } from "@/server/services/withdrawals";
import { refreshOverdueInvoices } from "@/server/services/invoices";
import { refreshBookingStates } from "@/server/services/booking-holds";
import { db } from "@/server/db";
import { removeExpiredSessions } from "@/server/services/session-cleanup";
import { sendArrivalReminders } from "@/server/services/front-desk";
import { businessToday } from "@/server/settings";
import { purgeSystemEvents, recordCronRun, recordError } from "@/server/services/system-events";

const JOB = "/api/cron/daily-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Vercel Cron (see vercel.json): after the 04:00 rollover and in the morning (housekeeping, and
 * retrying any failed report message), and at 21:00 / 21:20 Tanzania time (18:00 / 18:20 UTC) when
 * the day's report is made automatically and sent to the Boss. The weekly report goes on Monday
 * morning (07:35, or 10:00 while a night shift is still open) and the monthly one on the 1st. Idempotent: re-running never makes a
 * second report or a duplicate message.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const t0 = Date.now();
  // Every run is written down for the Developer console (system_events): when, how long, how it ended. A step that failed on its own is
  // listed, so a run that "worked" but could not do part of its job is not shown as healthy.
  const failed: string[] = [];
  const noteFailed = async (what: string, e: unknown) => { failed.push(what); await recordError({ source: `cron:daily-report:${what}`, error: e }); };
  try {
    // Housekeeping first — but a step that fails must never stop the day's report (the Boss's report comes before everything).
    const safely = (what: string, step: Promise<unknown>) => step.catch(async (e) => { console.error(`[cron] ${what} failed`, e); await noteFailed(what, e); });
    await safely("overdue invoices", refreshOverdueInvoices());
    // Payments nTZS confirmed but we have not recorded yet are found first — before unpaid bookings are released.
    await safely("mobile payments", sweepMobilePayments(new Date(), Date.now() + 8_000));
    await safely("booking states", refreshBookingStates());
    // Housekeeping: expired sessions (a Developer's "work as" that was still on one is written down as ended first) and stale rate-limit windows.
    await safely("expired sessions", removeExpiredSessions());
    await safely("rate-limit windows", db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } }));
    // One time limit for the whole run (Vercel stops it at 60 s): every WhatsApp send starts only with time to finish.
    const until = t0 + 44_000;
    const left = () => Math.max(0, until - Date.now());
    // The day's report first (it must never wait behind anything)…
    const result = await runDailyReportJob(new Date(), until);
    // …then the weekly and monthly reports (the business and the team): made once a period has ended, sent to the
    // Boss from the morning run on…
    const periods = await runStaffPeriodJob(new Date(), left(), until).catch(async (e) => { console.error("[cron] weekly/monthly reports failed", e); await noteFailed("weekly/monthly reports", e); return null; });
    // …then shift reports: any closed shift still without its report gets it, and an unsent message to the Boss is
    // tried again — the rest waits for the next run.
    const shifts = await retryShiftReports(new Date(), Math.min(20_000, left()), until).catch(async (e) => { console.error("[cron] shift reports failed", e); await noteFailed("shift reports", e); return null; });
    // Mobile-money prompts (nTZS) still waiting — a confirmation that never arrived is asked for again.
    const mobile = left() > 5_000 ? await sweepMobilePayments(new Date(), until - 3_000).catch(async (e) => { console.error("[cron] mobile payments failed", e); await noteFailed("mobile payments (second check)", e); return null; }) : null;
    // Withdrawals nTZS has not finished: its state is asked for (never a new send).
    if (left() > 5_000) await sweepWithdrawals(new Date(), until - 3_000).catch(async (e) => { console.error("[cron] withdrawals failed", e); await noteFailed("withdrawals", e); });
    // Guests' arrival reminders last (a slow provider must never take the reports' time), within what is left.
    if (left() > 16_000) await sendArrivalReminders(await businessToday(), until).catch(async (e) => { console.error("[cron] arrival reminders failed", e); await noteFailed("arrival reminders", e); });
    // The system's own records are kept short too (errors 30 days, job and webhook records 14) — last, so it can never delay a report.
    if (left() > 3_000) await safely("system events", purgeSystemEvents());
    await recordCronRun(JOB, {
      ok: failed.length === 0, startedAt: new Date(t0), durationMs: Date.now() - t0,
      summary: { ...result, shifts, periods, mobile, stepsFailed: failed.length },
      error: failed.length ? new Error(`Steps that failed: ${failed.join(", ")}`) : undefined,
    });
    return Response.json({ ok: true, ...result, shifts, periods, mobile });
  } catch (e) {
    console.error("[cron] daily report failed", e);
    await recordError({ source: `route:${JOB}`, error: e });
    await recordCronRun(JOB, { ok: false, startedAt: new Date(t0), durationMs: Date.now() - t0, error: e });
    return Response.json({ ok: false, error: "Daily report job failed" }, { status: 500 });
  }
}
