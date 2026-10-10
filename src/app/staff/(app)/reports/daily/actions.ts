"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, can } from "@/server/auth";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { toDbDate } from "@/lib/time/business-date";
import { runAction } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { deliverDailyReport, generateDailyReport } from "@/server/services/daily-report";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";

/**
 * Make a day's report by hand. The system makes it every day at 21:00, so this is for exceptions:
 * a missing report (managers may make it), or regenerating one that exists — only the MD or the
 * owner, with a reason; the earlier version is kept.
 */
export async function generateReportAction(input: { date: string; reason?: string }) {
  return runAction(async () => {
    const user = await authorize("reports.daily.manage");
    const { date, reason } = parseInput(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().max(300).optional() }), input);
    const exists = await db.dailyReport.findUnique({ where: { businessDate: toDbDate(date) }, select: { id: true } });
    if (exists) {
      if (!can(user, "dashboard.admin") && !can(user, "dashboard.owner")) throw new AppError("Only the MD or the owner can regenerate a report — it is kept as a record.", "FORBIDDEN");
      if (!reason || reason.length < 5) throw new AppError("Say why the report is being regenerated (at least a few words).", "VALIDATION");
    }
    const r = await generateDailyReport(date, { by: `${user.fullName} (${user.roleName})`, automatic: false, reason: reason || null });
    revalidatePath("/staff/reports/daily", "layout");
    return { id: r.id };
  }, msg("Report made."));
}

export async function sendReportAction(input: { reportId: string; force?: boolean }) {
  return runAction(async () => {
    await authorize("reports.daily.manage");
    const res = await deliverDailyReport(input.reportId, { force: !!input.force, manual: true });
    revalidatePath("/staff/reports/daily", "layout");
    const t = await getT();
    if (res.recipients === 0) return { message: t("No report recipients configured in Settings.") };
    const busy = res.results.filter((r) => r.status === "BUSY");
    const failed = res.results.filter((r) => r.status === "FAILED" || r.status === "SKIPPED");
    return { message: failed.length ? t("{failed} of {total} failed: {error}", { failed: failed.length, total: res.recipients, error: failed[0].error ?? t("unknown error") }) : busy.length ? t("Being sent right now — refresh in a moment.") : t("Sent to {n} recipient(s).", { n: res.recipients }) };
  });
}
