"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/server/auth";
import { runAction } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { businessToday } from "@/server/settings";
import { deliverStaffReport, generateTeamPeriodReport, lastCompleted } from "@/server/services/staff-report";
import { getT } from "@/i18n/server";

/** Send the weekly / monthly report's message to the boss (again, or retry a failed one). */
export async function sendStaffReportAction(input: { reportId: string; force?: boolean }) {
  return runAction(async () => {
    await authorize("shifts.manage", "reports.daily.manage");
    const d = parseInput(z.object({ reportId: z.string().min(1).max(40), force: z.boolean().optional() }), input);
    const r = await deliverStaffReport(d.reportId, { force: d.force, manual: true });
    revalidatePath("/staff/reports/staff", "layout");
    const sent = r.results.filter((x) => x.status === "SENT").length;
    const busy = r.results.some((x) => x.status === "BUSY");
    const t = await getT();
    return { message: !r.recipients ? t("No report recipient is set — add one under Settings → Report recipients.") : busy && !sent ? t("Being sent right now — refresh in a moment.") : `${t("Sent to {sent} of {total}.", { sent, total: r.recipients })}${r.results.some((x) => x.status === "FAILED") ? ` ${t("Some failed — see Delivery.")}` : ""}` };
  });
}

/** The last full week's or month's report, made now (it is made automatically on Monday / the 1st; still only once). */
export async function makePeriodReportAction(input: { kind: "WEEK" | "MONTH" }) {
  return runAction(async () => {
    await authorize("shifts.manage", "reports.view");
    const { kind } = parseInput(z.object({ kind: z.enum(["WEEK", "MONTH"]) }), input);
    const { from, to } = lastCompleted(kind, await businessToday());
    const r = await generateTeamPeriodReport(kind, from, to, { deadline: Date.now() + 45_000 });
    const t = await getT();
    if (!r) return { id: null, message: t("A shift of that time is still open, or it is taking long — try again in a moment.") };
    revalidatePath("/staff/reports/staff", "layout");
    return { id: r.id, message: t("Report ready.") };
  });
}
