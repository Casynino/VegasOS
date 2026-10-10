"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { getSettings } from "@/server/settings";
import { TRANSLATABLE, saveTranslation, translationsOf, type TranslatableKind } from "@/server/services/translations";
import { msg } from "@/i18n/msg";

/**
 * Offer Chinese to guests or not (the website and guest-page switchers). English is always offered — it is the
 * fallback. Staff keep choosing their own language either way. Audited.
 */
export async function setChineseOfferedAction(input: { on: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const on = parseInput(z.object({ on: z.boolean() }), input).on;
    const before = (await getSettings()).enabledLanguages;
    const after = on ? ["en", "zh-CN"] : ["en"];
    await db.hotelSettings.update({ where: { id: 1 }, data: { enabledLanguages: after } });
    const { ipAddress } = await requestMeta();
    await audit(db, { userId: user.id, label: user.fullName, ipAddress }, {
      action: "settings.languages_changed", entityType: "HotelSettings", entityId: "1", before: { enabledLanguages: before }, after: { enabledLanguages: after },
    });
    revalidatePath("/", "layout");
    return null;
  }, input.on ? msg("Chinese is offered to guests.") : msg("Chinese is no longer offered to guests."));
}

const KINDS = Object.keys(TRANSLATABLE) as [TranslatableKind, ...TranslatableKind[]];
const Input = z.object({
  kind: z.enum(KINDS),
  id: z.string().min(1).max(40),
  name: z.string().trim().max(300),
  description: z.string().trim().max(2000).optional(),
});

/** Add one item's Chinese name (and description) from the coverage list. Other saved fields are kept. Audited. */
export async function saveContentTranslationAction(input: z.input<typeof Input>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const d = parseInput(Input, input);
    if (!d.name) throw new AppError("Enter the Chinese name.", "VALIDATION", { name: msg("Required") });
    const fields = TRANSLATABLE[d.kind].fields as readonly string[];
    const kept = (await translationsOf(d.kind, d.id))["zh-CN"] ?? {};
    const values: Record<string, string | null | undefined> = { ...kept, name: d.name };
    if (fields.includes("description") && d.description !== undefined) values.description = d.description;
    const { ipAddress } = await requestMeta();
    try {
      await saveTranslation(d.kind, d.id, "zh-CN", values, { userId: user.id, label: user.fullName, ipAddress });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2003") throw new AppError("This item no longer exists.", "NOT_FOUND");
      throw e;
    }
    revalidatePath("/staff/settings/languages");
    revalidatePath("/", "layout");
    return null;
  }, msg("Chinese saved."));
}
