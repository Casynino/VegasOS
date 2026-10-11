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
import { deliverRoomReport, deliverRoomReportByDate, ensureRoomReport } from "@/server/services/room-report";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";

/** What to tell staff after a send: honest when nothing new went out because it was already delivered. */
function sentNote(res: { recipients: number; results: { response?: string; already?: boolean; at?: Date | null }[] }, what: string) {
  const r = res.results[0];
  const reply = r?.response ? ` CallMeBot said: ${r.response}` : " CallMeBot gave no reply text.";
  if (r?.already) return `${what} was already delivered${r.at ? ` at ${r.at.toISOString().slice(11, 16)} UTC` : ""} — nothing new was sent. Press the "again" button to send it once more.${reply}`;
  return `${what} sent to ${res.recipients} recipient(s) just now.${reply}`;
}

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

export async function sendRoomReportByDateAction(input: { date: string; force?: boolean }) {
  return runAction(async () => {
    await authorize("reports.daily.manage");
    const res = await deliverRoomReportByDate(input.date, { force: !!input.force, manual: true });
    revalidatePath("/staff/reports", "layout");
    const t = await getT();
    if (res.recipients === 0) return { message: t("No report recipients configured in Settings.") };
    const busy = res.results.filter((r) => r.status === "BUSY");
    const failed = res.results.filter((r) => r.status === "FAILED" || r.status === "SKIPPED");
    return { message: failed.length ? t("{failed} of {total} failed: {error}", { failed: failed.length, total: res.recipients, error: failed[0].error ?? t("unknown error") }) : busy.length ? t("Being sent right now — refresh in a moment.") : sentNote(res, "Room report") };
  });
}

export async function sendRoomReportAction(input: { reportId: string; force?: boolean }) {
  return runAction(async () => {
    await authorize("reports.daily.manage");
    const res = await deliverRoomReport(input.reportId, { force: !!input.force, manual: true });
    revalidatePath("/staff/reports/daily", "layout");
    const t = await getT();
    if (res.recipients === 0) return { message: t("No report recipients configured in Settings.") };
    const busy = res.results.filter((r) => r.status === "BUSY");
    const failed = res.results.filter((r) => r.status === "FAILED" || r.status === "SKIPPED");
    return { message: failed.length ? t("{failed} of {total} failed: {error}", { failed: failed.length, total: res.recipients, error: failed[0].error ?? t("unknown error") }) : busy.length ? t("Being sent right now — refresh in a moment.") : sentNote(res, "Room report") };
  });
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
    return { message: failed.length ? t("{failed} of {total} failed: {error}", { failed: failed.length, total: res.recipients, error: failed[0].error ?? t("unknown error") }) : busy.length ? t("Being sent right now — refresh in a moment.") : sentNote(res, "Report") };
  });
}

/** Rebuild a day's room report from today's records (the earlier version is kept; the link stays the same). */
export async function regenerateRoomReportAction(input: { date: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("reports.daily.manage");
    const { date, reason } = parseInput(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(5).max(300) }), input);
    await ensureRoomReport(date, { regenerate: true, by: `${user.fullName} (${user.roleName})`, reason });
    revalidatePath("/staff/reports", "layout");
    return { ok: true };
  }, msg("New version made — the earlier one is kept."));
}

/** Switch a room report's link off (the report itself is kept; sending it again switches it back on). */
export async function revokeRoomReportAction(input: { date: string }) {
  return runAction(async () => {
    await authorize("reports.daily.manage");
    const { date } = parseInput(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), input);
    await db.roomReport.update({ where: { businessDate: toDbDate(date) }, data: { revokedAt: new Date() } });
    revalidatePath("/staff/reports", "layout");
    return { ok: true };
  }, msg("Link switched off."));
}

/** Turn the automatic 06:30 room report on or off (MD / owner). */
export async function setRoomReportEnabledAction(input: { enabled: boolean }) {
  return runAction(async () => {
    const user = await authorize("reports.daily.manage");
    if (!can(user, "dashboard.admin") && !can(user, "dashboard.owner")) throw new AppError("Only the MD or the owner can switch the automatic room report.", "FORBIDDEN");
    const { enabled } = parseInput(z.object({ enabled: z.boolean() }), input);
    await db.hotelSettings.update({ where: { id: 1 }, data: { roomReportEnabled: enabled } });
    revalidatePath("/staff/reports", "layout");
    return { ok: true };
  }, msg("Saved."));
}
