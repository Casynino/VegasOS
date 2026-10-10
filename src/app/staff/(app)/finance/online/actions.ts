"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { testNtzsConnection } from "@/server/services/ntzs";
import { checkMobilePaymentWithAnswer, sweepMobilePayments } from "@/server/services/mobile-payments";
import { ONLINE_SERVICES } from "@/server/services/online-pay";
import { onlinePayFlag } from "@/server/services/online-payments-admin";
import { msg, msgf } from "@/i18n/msg";
import { getT } from "@/i18n/server";

const Save = z.object({
  enabled: z.boolean(),
  services: z.record(z.enum(ONLINE_SERVICES.map((s) => s.key) as [string, ...string[]]), z.boolean()),
});

/** Admin turns online payment on or off — for everything, or service by service. Nothing else changes; past payments stay. */
export async function saveOnlinePaySettingsAction(input: z.input<typeof Save>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const d = parseInput(Save, input);
    const before = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
    const data: Record<string, boolean> = { onlinePayEnabled: d.enabled };
    for (const s of ONLINE_SERVICES) if (s.key in d.services) data[onlinePayFlag(s.key)] = d.services[s.key];
    await db.hotelSettings.update({ where: { id: 1 }, data });
    const { ipAddress } = await requestMeta();
    await audit(db, { userId: user.id, label: user.fullName, ipAddress }, {
      action: "settings.online_payments", entityType: "HotelSettings", entityId: "1",
      before: Object.fromEntries(Object.keys(data).map((k) => [k, before[k as keyof typeof before]])), after: data,
    });
    revalidatePath("/", "layout");
    return null;
  });
}

/** "Test connection": nTZS answers and accepts the hotel's key (no money moves). */
export async function testNtzsConnectionAction(): Promise<ActionResult<{ live: boolean }>> {
  return runAction(async () => {
    await authorize("finance.view");
    const r = await testNtzsConnection();
    if (!r.ok) throw new AppError(r.error, "CONFLICT");
    return { live: r.live };
  });
}

const STATUS_WORD: Record<string, string> = { COMPLETED: msg("Paid — recorded"), PENDING: msg("Still waiting"), FAILED: msg("Not paid"), EXPIRED: msg("Not paid (timed out)"), CANCELLED: msg("Not paid (stopped)") };

/** "Check with nTZS": ask nTZS about one payment now — money it has is recorded (once), whatever our side said. */
export async function checkOnlinePaymentAction(input: { id: string }): Promise<ActionResult<{ status: string; text: string }>> {
  return runAction(async () => {
    await authorize("finance.view", "payments.record", "revenue.record");
    const id = z.string().min(10).max(40).parse(input.id);
    const r = await checkMobilePaymentWithAnswer(id, "check");
    revalidatePath("/staff", "layout");
    // The words go straight to the person's screen (a toast) — in their language.
    const t = await getT();
    if (r.mp.status === "COMPLETED") return { status: r.mp.status, text: t(STATUS_WORD.COMPLETED) };
    if (!r.answered) throw new AppError(msgf("nTZS did not answer ({error}) — nothing has changed. Try again in a minute.", { error: r.error ?? "no reply" }), "CONFLICT");
    return { status: r.mp.status, text: `${STATUS_WORD[r.mp.status] ? t(STATUS_WORD[r.mp.status]) : r.mp.status}${r.ntzsStatus ? ` (nTZS: ${r.ntzsStatus})` : ""}` };
  });
}

/** "Check all with nTZS": every payment of the last two days not recorded yet. */
export async function checkAllOnlinePaymentsAction(): Promise<ActionResult<{ checked: number }>> {
  return runAction(async () => {
    await authorize("finance.view", "payments.record", "revenue.record");
    const r = await sweepMobilePayments(new Date(), Date.now() + 20_000);
    revalidatePath("/staff", "layout");
    return { checked: r.checked };
  });
}
