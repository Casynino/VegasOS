"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, authorizeDecision, requestMeta } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { postMovement, recordCashCount, reverseMovement, reviewCashCount } from "@/server/services/finance";
import { savePaymentAccount, setOpeningBalance } from "@/server/services/payment-accounts";
import { msg } from "@/i18n/msg";

/**
 * The acting person for a money action. `decision`: it is a decision about money (counting the cash is one), so the Developer is always refused —
 * also while it works as someone — and the refusal is written down (authorizeDecision). For everyone else it is the same as authorize().
 */
async function actorWith(permission: "finance.manage" | "finance.view", decision = false) {
  const user = decision ? await authorizeDecision(permission) : await authorize(permission);
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}
const refresh = () => { revalidatePath("/staff/finance", "layout"); };

const MovementSchema = z.object({
  kind: z.enum(["TRANSFER", "OWNER_CONTRIBUTION", "OWNER_WITHDRAWAL", "OTHER_INCOME", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
  amount: z.coerce.number().int(msg("Whole shillings only.")).positive(msg("Enter the amount.")),
  accountId: z.string().min(1, msg("Choose the account.")),
  toAccountId: z.string().optional().transform((v) => v || null),
  description: z.string().trim().min(2, msg("Say what this is for.")).max(200),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function postMovementAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actorWith("finance.manage");
    const input = parseInput(MovementSchema, Object.fromEntries([...formData.entries()].filter(([k]) => k !== "attachment")));
    const file = formData.get("attachment");
    await postMovement({ ...input, attachment: file instanceof File && file.size > 0 ? file : null }, actor);
    refresh();
    return null;
  }, msg("Saved to the ledger."));
}

export async function reverseMovementAction(input: { id: string; reason: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actorWith("finance.manage");
    await reverseMovement(input.id, input.reason, actor);
    refresh();
    return null;
  }, msg("Reversed. The original stays on the ledger."));
}

const CountSchema = z.object({
  accountId: z.string().min(1),
  counted: z.coerce.number().int(msg("Whole shillings only.")).min(0, msg("Enter the amount counted.")),
  note: z.string().trim().max(500).optional(),
});

export async function recordCashCountAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ difference: number }>> {
  return runAction(async () => {
    const actor = await actorWith("finance.view", true);
    const c = await recordCashCount(parseInput(CountSchema, Object.fromEntries(formData)), actor);
    refresh();
    return { difference: c.difference };
  }, msg("Count saved."));
}

export async function reviewCashCountAction(input: { id: string; postCorrection: boolean; note?: string }): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actorWith("finance.manage");
    await reviewCashCount(input.id, { postCorrection: input.postCorrection, note: input.note ?? null }, actor);
    refresh();
    return null;
  }, input.postCorrection ? msg("Accepted — a correction was posted so the books match the count.") : msg("Accepted."));
}

const AccountSchema = z.object({
  id: z.string().optional().transform((v) => v || null),
  name: z.string().trim().min(2, msg("Give the account a name.")).max(60),
  kind: z.enum(["CASH", "BANK", "MOBILE_MONEY", "CARD", "PETTY_CASH", "OTHER"]),
  accountNumber: z.string().trim().max(40).optional(),
  holderName: z.string().trim().max(80).optional(),
  acceptsPayments: z.string().optional().transform((v) => v === "on"),
  acceptsExpenses: z.string().optional().transform((v) => v === "on"),
  isActive: z.string().optional().transform((v) => v === "on"),
});

/**
 * Admin: add or edit a payment account (never deleted — deactivate instead).
 * Where guests pay and where money is kept is money: the Developer (also working as the MD) is refused here and again in the service.
 */
export async function savePaymentAccountAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorizeDecision("settings.manage");
    const { ipAddress } = await requestMeta();
    await savePaymentAccount(parseInput(AccountSchema, Object.fromEntries(formData)), { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions });
    refresh();
    return null;
  }, msg("Account saved."));
}

const OpeningSchema = z.object({
  accountId: z.string().min(1),
  amount: z.coerce.number().int(msg("Whole shillings only.")).min(0, msg("Enter 0 or more.")),
  reason: z.string().trim().min(5, msg("Say what this opening balance is — at least 5 letters.")).max(300),
});
/**
 * The Boss and the MD: where an account's books begin (not income, not a payment).
 * An opening balance is money: the Developer (also working as the MD) is refused here and again in the service.
 */
export async function setOpeningBalanceAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorizeDecision("settings.manage");
    const { ipAddress } = await requestMeta();
    await setOpeningBalance(parseInput(OpeningSchema, Object.fromEntries(formData)), { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions });
    refresh();
    return null;
  }, msg("Opening balance saved."));
}
