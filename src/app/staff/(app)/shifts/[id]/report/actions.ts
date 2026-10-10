"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, can, type CurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { AppError, runAction } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { afterShiftClosed, deliverShiftReport, generateShiftReport } from "@/server/services/shift-report";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";

const Id = z.string().min(1).max(40);
const manager = (u: CurrentUser) => can(u, "shifts.manage") || can(u, "reports.view");

/** Their own report, or anyone's for a manager. */
async function viewer(shiftId: string) {
  const user = await authorize("shifts.view", "restaurant.shift", "shifts.manage", "reports.view");
  const shift = await db.actualShift.findUnique({ where: { id: shiftId }, select: { userId: true, endedAt: true } });
  if (!shift) throw new AppError("Shift not found.", "NOT_FOUND");
  if (!manager(user) && shift.userId !== user.id) throw new AppError("You can open only your own shift report.", "FORBIDDEN");
  if (!shift.endedAt) throw new AppError("The shift is still running — its report is made when it ends.", "CONFLICT");
  return user;
}

/** The report was not made yet (it is made automatically at the close) — make it now; it is still made only once. */
export async function makeShiftReportAction(input: { shiftId: string }) {
  return runAction(async () => {
    const { shiftId } = parseInput(z.object({ shiftId: Id }), input);
    await viewer(shiftId);
    // Sent to the boss only when it is made now for a shift that ended in the last day — exactly as at the close. An
    // older shift (or one already reported) is only made here; a manager decides whether to send it.
    const [before, shift] = await Promise.all([
      db.shiftReport.findUnique({ where: { shiftId }, select: { id: true } }),
      db.actualShift.findUniqueOrThrow({ where: { id: shiftId }, select: { endedAt: true } }),
    ]);
    const fresh = !before && !!shift.endedAt && shift.endedAt.getTime() >= Date.now() - 86_400_000;
    const report = await afterShiftClosed(shiftId, { send: fresh });
    if (!report) throw new AppError("The report could not be made just now — try again in a moment.", "CONFLICT");
    if (!fresh && !report.sendSkipped && !(await db.notificationDelivery.count({ where: { shiftReportId: report.id } }))) {
      await db.shiftReport.update({ where: { id: report.id }, data: { sendSkipped: true } });
    }
    revalidatePath(`/staff/shifts/${shiftId}`, "layout");
    return { id: report.id };
  }, msg("Shift report ready."));
}

/** Send the report's message to the boss again (or retry a failed one). */
export async function sendShiftReportAction(input: { reportId: string; force?: boolean }) {
  return runAction(async () => {
    await authorize("shifts.manage", "reports.daily.manage");
    const d = parseInput(z.object({ reportId: Id, force: z.boolean().optional() }), input);
    const r = await deliverShiftReport(d.reportId, { force: d.force, manual: true });
    const report = await db.shiftReport.findUnique({ where: { id: d.reportId }, select: { shiftId: true } });
    if (report) revalidatePath(`/staff/shifts/${report.shiftId}/report`);
    const sent = r.results.filter((x) => x.status === "SENT").length;
    const busy = r.results.some((x) => x.status === "BUSY");
    const t = await getT();
    return { message: !r.recipients ? t("No report recipient is set — add one under Settings → Report recipients.") : busy && !sent ? t("Being sent right now — refresh in a moment.") : `${t("Sent to {sent} of {total}.", { sent, total: r.recipients })}${r.results.some((x) => x.status === "FAILED") ? ` ${t("Some failed — see Delivery.")}` : ""}` };
  });
}

/** MD / owner only: rebuild a shift report from the records, saying why — the earlier version is kept. */
export async function regenerateShiftReportAction(input: { shiftId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("shifts.manage", "reports.view");
    if (!(can(user, "dashboard.admin") || can(user, "dashboard.owner"))) throw new AppError("Only the MD or the owner can regenerate a shift report.", "FORBIDDEN");
    const d = parseInput(z.object({ shiftId: Id, reason: z.string().trim().min(5, msg("Say why (at least a few words).")).max(300) }), input);
    const report = await generateShiftReport(d.shiftId, { regenerate: { by: `${user.fullName} (${user.roleName})`, reason: d.reason } });
    revalidatePath(`/staff/shifts/${d.shiftId}`, "layout");
    return { id: report.id, version: report.version };
  }, msg("New version made — the earlier one is kept."));
}
