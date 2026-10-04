"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { testNtzsConnection } from "@/server/services/ntzs";
import { ONLINE_SERVICES } from "@/server/services/online-pay";
import { onlinePayFlag } from "@/server/services/online-payments-admin";

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
