"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { regenerateSpinQr, saveSpinSettings, setSpinPrize, setSpinQrActive, setSpinTier } from "@/server/services/spin";
import { msg } from "@/i18n/msg";

/**
 * The Spin to Win page's changes — the Admin's only (spin.manage): the switch and the numbers, a room type's tier,
 * which menu items are gifts, a new code for a room's card, a card off / on. The service checks the right again.
 */

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}
function refresh() {
  revalidatePath("/staff/spin-to-win");
  revalidatePath("/staff/settings/control");
}

const Id = z.string().trim().min(1).max(40);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Pick a date.")).nullable();
const Money = (max: number) => z.coerce.number().int(msg("Whole shillings only.")).min(0, msg("Not below zero.")).max(max, msg("That amount is too high."));
const Settings = z.object({
  enabled: z.boolean(),
  spinsPerStay: z.coerce.number().int().min(1, msg("At least one spin.")).max(10, msg("At most ten spins a stay.")),
  budgetStandard: Money(1_000_000), budgetPremium: Money(1_000_000), maxItemPrice: Money(1_000_000),
  allowRoom: z.boolean(), allowRestaurant: z.boolean(), startsOn: Day, endsOn: Day,
});

export async function saveSpinSettingsAction(input: z.input<typeof Settings>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("spin.manage");
    await saveSpinSettings(parseInput(Settings, input), await actor(user));
    refresh();
    return null;
  }, msg("Saved."));
}

const Tier = z.object({ roomTypeId: Id, tier: z.enum(["STANDARD", "PREMIUM", "NONE"]).nullable() });
export async function setSpinTierAction(input: z.input<typeof Tier>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("spin.manage");
    const d = parseInput(Tier, input);
    await setSpinTier({ roomTypeId: d.roomTypeId }, d.tier, await actor(user));
    refresh();
    return null;
  }, msg("Saved."));
}

const Prize = z.object({
  menuItemId: Id, choice: z.enum(["RULE", "ALWAYS", "NEVER"]),
  valueOverride: Money(1_000_000).nullable(), weight: z.coerce.number().int().min(1).max(5),
});
export async function setSpinPrizeAction(input: z.input<typeof Prize>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("spin.manage");
    await setSpinPrize(parseInput(Prize, input), await actor(user));
    refresh();
    return null;
  }, msg("Saved."));
}

/** A new code for a room's card: the card in the room now stops working. */
export async function regenerateSpinQrAction(input: { roomId: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("spin.manage");
    await regenerateSpinQr(parseInput(z.object({ roomId: Id }), input).roomId, await actor(user));
    refresh();
    return null;
  }, msg("New code made — print the new card and replace the old one."));
}

export async function setSpinQrActiveAction(input: { roomId: string; active: boolean }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("spin.manage");
    const d = parseInput(z.object({ roomId: Id, active: z.boolean() }), input);
    await setSpinQrActive(d.roomId, d.active, await actor(user));
    refresh();
    return null;
  }, msg("Saved."));
}
