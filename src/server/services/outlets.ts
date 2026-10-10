import "server-only";
import { db } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { msg } from "@/i18n/msg";
import { resolveAccountTx } from "./payment-accounts";
import { getSettingsTx, stayConfig } from "../settings";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import type { Actor } from "./reservations";

/**
 * Restaurant / bar / other sales — additional revenue streams, kept separate
 * from room revenue. (The meeting room is room inventory: it is booked as a
 * reservation — see reservations.ts, stay kind "meeting".)
 */

// ───────────────────────── Restaurant & bar sales ─────────────────────────

export async function recordSale(
  input: { categoryId: string; amount: number; accountId?: string | null; paymentMethodId?: string | null; description?: string | null; notes?: string | null; occurredAt?: Date | null },
  actor: Actor,
) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter a positive whole amount.", "VALIDATION", { amount: msg("Invalid") });
  return db.$transaction(async (tx) => {
    const [category, { account, method }, settings] = await Promise.all([
      tx.revenueCategory.findUnique({ where: { id: input.categoryId } }),
      resolveAccountTx(tx, { accountId: input.accountId, methodId: input.paymentMethodId }),
      getSettingsTx(tx),
    ]);
    if (!category || !category.isActive) throw new AppError("Choose a sales category.", "VALIDATION", { categoryId: msg("Required") });
    const occurredAt = input.occurredAt ?? new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new AppError("Sale time cannot be in the future.");
    const sale = await tx.revenueTransaction.create({
      data: {
        categoryId: category.id, kind: category.kind, amount: input.amount, paymentMethodId: method.id, accountId: account.id,
        description: input.description?.trim() || null, notes: input.notes?.trim() || null, occurredAt,
        businessDate: toDbDate(businessDateOf(occurredAt, stayConfig(settings))), recordedById: actor.userId!,
      },
    });
    await audit(tx, actor, { action: "revenue.recorded", entityType: "RevenueTransaction", entityId: sale.id, after: { category: category.name, amount: sale.amount, method: method.code } });
    return sale;
  });
}

/**
 * Correct which account a sale's money went into (e.g. Cash → Lipa M-Pesa).
 * The amount never changes here; the change is kept in the audit log (old → new, who, when).
 */
export async function correctSaleAccount(input: { id: string; accountId: string; reason?: string | null }, actor: Actor) {
  if (!actor.userId || !actor.permissions?.has("revenue.record")) throw new AppError("You cannot correct sales.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const sale = await tx.revenueTransaction.findUnique({ where: { id: input.id }, include: { account: true } });
    if (!sale) throw new AppError("Sale not found.", "NOT_FOUND");
    if (sale.isVoided) throw new AppError("A cancelled sale cannot be corrected.");
    const { account, method } = await resolveAccountTx(tx, { accountId: input.accountId });
    if (account.id === sale.accountId) throw new AppError("Nothing changed.");
    await tx.revenueTransaction.update({ where: { id: sale.id }, data: { accountId: account.id, paymentMethodId: method.id } });
    await audit(tx, actor, {
      action: "revenue.account_corrected", entityType: "RevenueTransaction", entityId: sale.id,
      before: { receivedInto: sale.account.name, amount: sale.amount },
      after: { receivedInto: account.name, amount: sale.amount, ...(input.reason?.trim() && { reason: input.reason.trim() }) },
    });
  });
}

export async function voidSale(id: string, reason: string, actor: Actor) {
  if (!actor.permissions?.has("revenue.void")) throw new AppError("Only a manager can void sales.", "FORBIDDEN");
  if (!reason.trim()) throw new AppError("Give a reason.", "VALIDATION", { reason: msg("Required") });
  return db.$transaction(async (tx) => {
    const s = await tx.revenueTransaction.findUnique({ where: { id } });
    if (!s || s.isVoided) throw new AppError("Sale not found or already voided.");
    await tx.revenueTransaction.update({ where: { id }, data: { isVoided: true, voidReason: reason.trim(), voidedAt: new Date() } });
    await audit(tx, actor, { action: "revenue.voided", entityType: "RevenueTransaction", entityId: id, before: { amount: s.amount }, after: { voided: true, reason } });
  });
}
