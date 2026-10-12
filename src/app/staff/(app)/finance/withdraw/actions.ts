"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { msg } from "@/i18n/msg";
import { parseInput } from "@/server/validation";
import {
  acknowledgeWithdrawal, cancelWithdrawalPrice, checkNtzsBalance, checkWithdrawal, confirmWithdrawal, priceWithdrawal, settleWithdrawalByHand, withdrawalDetail,
  type WithdrawalActor, type WithdrawalHistoryLine, type WithdrawalPrice, type WithdrawalView,
} from "@/server/services/withdrawals";
import type { PermissionCode } from "@/lib/permissions";

/**
 * Withdraw funds — every step runs here on the server, as the signed-in person: the browser never holds nTZS's key and
 * never talks to nTZS. Who may do it is checked here (and again in the service), whatever the screen shows.
 */
async function actor(permission: PermissionCode = "withdrawals.manage"): Promise<WithdrawalActor> {
  const user = await authorize(permission);
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}

const Id = z.object({ id: z.string().min(10).max(40) });
const refresh = () => revalidatePath("/staff/finance", "layout");

const Price = z.object({
  amount: z.number().int().positive().max(2_000_000_000),
  destination: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("PHONE"), phone: z.string().trim().min(1).max(30) }),
    z.object({ kind: z.literal("BANK"), bankCode: z.string().trim().min(1).max(20), accountNumber: z.string().trim().min(1).max(40) }),
    z.object({ kind: z.literal("AGAIN"), withdrawalId: z.string().min(10).max(40) }),
  ]),
  toAccountId: z.string().min(1).max(40).nullable(),
  note: z.string().trim().max(300).nullish(),
  clientKey: z.string().max(64).nullish(),
});

/** Step 1 — nTZS's price for a withdrawal (its fee, the recipient's registered name, the balance). Nothing moves. */
export async function priceWithdrawalAction(input: z.input<typeof Price>): Promise<ActionResult<WithdrawalPrice>> {
  return runAction(async () => {
    const who = await actor();
    const price = await priceWithdrawal(parseInput(Price, input), who);
    refresh();
    return price;
  });
}

/** Back from the confirmation: the price is dropped. */
export async function cancelWithdrawalPriceAction(input: z.input<typeof Id>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const who = await actor();
    await cancelWithdrawalPrice(parseInput(Id, input).id, who);
    return null;
  });
}

/** Step 2 — the person confirmed: the priced withdrawal is sent to nTZS, once. What comes back is nTZS's word, not a promise. */
export async function confirmWithdrawalAction(input: z.input<typeof Id>): Promise<ActionResult<WithdrawalView>> {
  return runAction(async () => {
    const who = await actor();
    try {
      return await confirmWithdrawal(parseInput(Id, input).id, who);
    } catch (e) {
      if (e instanceof AppError) throw e;
      // Something broke part-way: it may already be with nTZS, so "nothing was saved — try again" would be untrue here.
      console.error("[withdrawals] confirm failed", e);
      throw new AppError(msg("Something went wrong while this was being sent. Do not send it again — look at the withdrawals on this page first: they show what happened."), "CONFLICT");
    } finally {
      refresh();
    }
  });
}

/** "Check with nTZS": ask nTZS about one withdrawal now. */
export async function checkWithdrawalAction(input: z.input<typeof Id>): Promise<ActionResult<WithdrawalView>> {
  return runAction(async () => {
    const who = await actor();
    try {
      return await checkWithdrawal(parseInput(Id, input).id, who);
    } finally {
      refresh();
    }
  });
}

const Settle = Id.extend({ outcome: z.enum(["ARRIVED", "NOT_SENT"]), reference: z.string().trim().max(80).nullish(), note: z.string().trim().max(500) });

/** A withdrawal nTZS cannot settle by itself is settled by a person — with what nTZS showed them, and their name. */
export async function settleWithdrawalAction(input: z.input<typeof Settle>): Promise<ActionResult<WithdrawalView>> {
  return runAction(async () => {
    const who = await actor("withdrawals.reconcile");
    const d = parseInput(Settle, input);
    const view = await settleWithdrawalByHand(d.id, { outcome: d.outcome, reference: d.reference ?? null, note: d.note }, who);
    refresh();
    return view;
  });
}

/** "I have seen this": clears the note on a finished withdrawal. */
export async function acknowledgeWithdrawalAction(input: z.input<typeof Id>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const who = await actor();
    await acknowledgeWithdrawal(parseInput(Id, input).id, who);
    refresh();
    return null;
  });
}

/** "Check balance": the balance as nTZS reports it now (it comes with a price — nothing moves). */
export async function checkNtzsBalanceAction(): Promise<ActionResult<{ availableTzs: number; at: Date }>> {
  return runAction(async () => {
    const who = await actor();
    const balance = await checkNtzsBalance(who);
    refresh();
    return balance;
  });
}

/** One withdrawal with every step of its history. */
export async function withdrawalDetailAction(input: z.input<typeof Id>): Promise<ActionResult<{ view: WithdrawalView; history: WithdrawalHistoryLine[] }>> {
  return runAction(async () => {
    const who = await actor();
    return withdrawalDetail(parseInput(Id, input).id, who);
  });
}
