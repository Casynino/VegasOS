import { timingSafeEqual } from "node:crypto";
import { runDailyReportJob } from "@/server/services/daily-report";
import { retryShiftReports } from "@/server/services/shift-report";
import { runStaffPeriodJob } from "@/server/services/staff-report";
import { refreshOverdueInvoices } from "@/server/services/invoices";
import { refreshBookingStates } from "@/server/services/booking-holds";
import { db } from "@/server/db";
import { sendArrivalReminders } from "@/server/services/front-desk";
import { businessToday } from "@/server/settings";

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
  try {
    await refreshOverdueInvoices();
    await refreshBookingStates();
    // Housekeeping: expired sessions and stale rate-limit windows.
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } });
    // One time limit for the whole run (Vercel stops it at 60 s): every WhatsApp send starts only with time to finish.
    const until = t0 + 44_000;
    const left = () => Math.max(0, until - Date.now());
    // The day's report first (it must never wait behind anything)…
    const result = await runDailyReportJob(new Date(), until);
    // …then the weekly and monthly reports (the business and the team): made once a period has ended, sent to the
    // Boss from the morning run on…
    const periods = await runStaffPeriodJob(new Date(), left(), until).catch((e) => { console.error("[cron] weekly/monthly reports failed", e); return null; });
    // …then shift reports: any closed shift still without its report gets it, and an unsent message to the Boss is
    // tried again — the rest waits for the next run.
    const shifts = await retryShiftReports(new Date(), Math.min(20_000, left()), until).catch((e) => { console.error("[cron] shift reports failed", e); return null; });
    // Guests' arrival reminders last (a slow provider must never take the reports' time), within what is left.
    if (left() > 16_000) await sendArrivalReminders(await businessToday(), until).catch((e) => console.error("[cron] arrival reminders failed", e));
    return Response.json({ ok: true, ...result, shifts, periods });
  } catch (e) {
    console.error("[cron] daily report failed", e);
    return Response.json({ ok: false, error: "Daily report job failed" }, { status: 500 });
  }
}
