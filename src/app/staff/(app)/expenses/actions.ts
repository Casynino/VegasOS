"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { parseInput } from "@/server/validation";
import { businessToday } from "@/server/settings";
import { msg, msgf } from "@/i18n/msg";
import { correctExpense, recordExpense, reinstateExpense, repostCorrectedExpense, reviewExpense, voidExpense } from "@/server/services/expenses";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions, roleCode: user.roleCode };
}

const ExpenseSchema = z.object({
  expenseId: z.string().optional(),
  categoryId: z.string().default(""),
  /** Expense type picked from the list, or a new one to save for next time. */
  itemId: z.string().optional(),
  newItemName: z.string().trim().max(80).optional(),
  newItemCategoryId: z.string().optional(),
  newItemFrequency: z.enum(["DAILY", "MONTHLY", "OCCASIONAL"]).optional(),
  amount: z.coerce.number().int(msg("Whole shillings only.")).positive(msg("Enter an amount.")),
  paymentMethodId: z.string().optional(),
  description: z.string().trim().max(200).default(""),
  payee: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
  spentAt: z.string().optional(),
  accountId: z.string().optional(),
  /** "What was wrong with the record?" — required when correcting. */
  reason: z.string().trim().max(300).optional(),
});

export async function saveExpenseAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("expenses.record");
    const data = parseInput(ExpenseSchema, formData);
    const receipt = formData.get("receipt");
    // Date only (from the correction form) = that hotel day at noon; datetime = exactly then.
    const spentAt = data.spentAt ? new Date(data.spentAt.length === 10 ? `${data.spentAt}T12:00:00+03:00` : `${data.spentAt}:00+03:00`) : null;
    const input = {
      ...data,
      itemId: data.itemId || null,
      newItem: data.newItemName ? { name: data.newItemName, categoryId: data.newItemCategoryId ?? "", frequency: data.newItemFrequency ?? null } : null,
      spentAt: spentAt && !Number.isNaN(spentAt.getTime()) ? spentAt : null,
      receipt: receipt instanceof File && receipt.size > 0 ? receipt : null,
    };
    if (data.expenseId) {
      // A manager's correction keeps the old line (cancelled) and posts a corrected one; staff fix their own same-day entries in place.
      // Your own entry from today (not yet counted by a manager) is fixed in place; anything else is
      // corrected by cancelling the old line and posting a new one — both stay on the register.
      const e = await db.expense.findUniqueOrThrow({ where: { id: data.expenseId } });
      const inPlace = !user.permissions.has("expenses.void") && e.createdById === user.id
        && (e.status === "CORRECTION_REQUESTED" || ((e.status === "RECORDED" || e.status === "PENDING_APPROVAL") && e.businessDate.toISOString().slice(0, 10) === (await businessToday())));
      if (inPlace) await correctExpense(data.expenseId, input, await actor(user), data.reason ?? "");
      else await repostCorrectedExpense(data.expenseId, input, data.reason ?? "", await actor(user));
    } else await recordExpense(input, await actor(user));
    revalidatePath("/staff/finance", "layout");
    revalidatePath("/staff/expenses");
    revalidatePath("/staff");
    return null;
  }, msg("Expense saved."));
}

export async function reviewExpenseAction(input: { expenseId: string; decision: "APPROVED" | "REJECTED" | "CORRECTION_REQUESTED"; note: string }) {
  return runAction(async () => {
    const user = await authorize("expenses.approve");
    await reviewExpense(input.expenseId, input.decision, input.note ?? "", await actor(user));
    revalidatePath("/staff/expenses");
    revalidatePath("/staff");
    return null;
  }, input.decision === "APPROVED" ? msg("Expense approved.") : input.decision === "REJECTED" ? msg("Expense rejected.") : msg("Correction requested."));
}

export async function voidExpenseAction(input: { expenseId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("expenses.record");
    await voidExpense(input.expenseId, input.reason ?? "", await actor(user));
    revalidatePath("/staff/expenses");
    revalidatePath("/staff/finance", "layout");
    return null;
  }, msg("Expense voided."));
}

export async function reinstateExpenseAction(input: { expenseId: string }) {
  return runAction(async () => {
    const user = await authorize("expenses.void");
    await reinstateExpense(input.expenseId, await actor(user));
    revalidatePath("/staff/expenses");
    revalidatePath("/staff/finance", "layout");
    return null;
  }, msg("Expense reinstated."));
}

// ───────────────────────── Expense types (Settings) ─────────────────────────

const ItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, msg("Give the expense type a name.")).max(80),
  categoryId: z.string().min(1, msg("Choose a group.")),
  frequency: z.enum(["DAILY", "MONTHLY", "OCCASIONAL"]),
  defaultPayee: z.string().trim().max(120).optional(),
  defaultAmount: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional(),
  isActive: z.boolean().default(true),
});

/** Add or edit an expense type (the Admin — financial set-up). Old expenses keep their records. */
export async function saveExpenseItemAction(input: z.input<typeof ItemSchema>) {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const d = parseInput(ItemSchema, input);
    const a = await actor(user);
    await db.$transaction(async (tx) => {
      const clash = await tx.expenseItem.findFirst({ where: { categoryId: d.categoryId, name: { equals: d.name, mode: "insensitive" }, ...(d.id ? { id: { not: d.id } } : {}) } });
      if (clash) throw new AppError(msgf("“{name}” already exists in this group.", { name: clash.name }), "VALIDATION", { name: msg("Exists") });
      const data = {
        name: d.name, categoryId: d.categoryId, frequency: d.frequency, defaultPayee: d.defaultPayee || null,
        defaultAmount: d.defaultAmount === "" || d.defaultAmount === undefined ? null : d.defaultAmount, isActive: d.isActive,
      };
      if (d.id) {
        const before = await tx.expenseItem.findUniqueOrThrow({ where: { id: d.id } });
        await tx.expenseItem.update({ where: { id: d.id }, data });
        await audit(tx, a, { action: "expense_type.updated", entityType: "ExpenseItem", entityId: d.id, before: { name: before.name, frequency: before.frequency, active: before.isActive }, after: { name: d.name, frequency: d.frequency, active: d.isActive } });
      } else {
        const created = await tx.expenseItem.create({ data: { ...data, createdById: user.id } });
        await audit(tx, a, { action: "expense_type.created", entityType: "ExpenseItem", entityId: created.id, after: { name: d.name, frequency: d.frequency } });
      }
    });
    revalidatePath("/staff/settings/expenses");
    revalidatePath("/staff/expenses");
    return null;
  }, msg("Expense type saved."));
}
