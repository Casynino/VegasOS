import "server-only";
import { db } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { resolveAccountTx } from "./payment-accounts";
import { getSettingsTx, stayConfig } from "../settings";
import { businessDateOf, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { ExpenseStatus } from "@/generated/prisma/enums";

/**
 * ExpenseService — quick recording at the desk, optional manager approval
 * above a configurable threshold, corrections instead of silent edits, and
 * voiding instead of deletion. Business date follows the 04:00 rule.
 */

type Actor = AuditActor & { userId: string; permissions: ReadonlySet<string>; roleCode?: string };

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

/** Expenses that count as money spent in reports. */
export const COUNTED_EXPENSE_STATUSES: ExpenseStatus[] = ["RECORDED", "APPROVED"];

export interface ExpenseInput {
  categoryId: string;
  amount: number;
  paymentMethodId?: string | null;
  description: string;
  payee?: string | null;
  reference?: string | null;
  notes?: string | null;
  spentAt?: Date | null;
  receipt?: File | null;
  /** Money account it was paid from (e.g. petty cash); empty = the payment method's account. */
  accountId?: string | null;
  /** The expense type picked from the list (sets the category). */
  itemId?: string | null;
  /** A new expense type typed by staff — saved for next time. */
  newItem?: { name: string; categoryId: string; frequency?: string | null } | null;
}

/**
 * The expense type for a new expense: the one picked, or a new one staff typed
 * (saved for next time; an existing type with the same name is reused).
 */
async function resolveItem(tx: Tx, input: ExpenseInput, userId: string) {
  if (input.newItem?.name.trim()) {
    const name = input.newItem.name.trim().replace(/\s+/g, " ").slice(0, 80);
    const cat = await tx.expenseCategory.findUnique({ where: { id: input.newItem.categoryId } });
    if (!cat || !cat.isActive) throw new AppError("Choose the group for the new expense type.", "VALIDATION", { categoryId: "Required" });
    const existing = await tx.expenseItem.findFirst({ where: { categoryId: cat.id, name: { equals: name, mode: "insensitive" } } });
    if (existing) return existing.isActive ? existing : tx.expenseItem.update({ where: { id: existing.id }, data: { isActive: true } });
    const frequency = ["DAILY", "MONTHLY", "OCCASIONAL"].includes(input.newItem.frequency ?? "") ? input.newItem.frequency! : "OCCASIONAL";
    return tx.expenseItem.create({ data: { categoryId: cat.id, name, frequency, createdById: userId, sortOrder: 999 } });
  }
  if (input.itemId) {
    const item = await tx.expenseItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw new AppError("That expense type no longer exists.", "VALIDATION", { itemId: "Invalid" });
    return item;
  }
  return null;
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Next expense number for the year, e.g. EXP-2026-000042 (serialised, never typed by staff). */
async function nextExpenseNumber(tx: Tx, year: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('expense_number'))::text`;
  const last = await tx.expense.findFirst({ where: { number: { startsWith: `EXP-${year}-` } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last?.number ? Number(last.number.slice(-6)) + 1 : 1;
  return `EXP-${year}-${String(n).padStart(6, "0")}`;
}

export async function storeReceipt(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], file: File, userId: string, purpose: "EXPENSE_RECEIPT" | "PURCHASE_RECEIPT" = "EXPENSE_RECEIPT") {
  if (file.size > RECEIPT_MAX_BYTES) throw new AppError("Receipt file is larger than 5 MB.", "VALIDATION", { receipt: "Too large" });
  if (!RECEIPT_TYPES.includes(file.type)) throw new AppError("Receipt must be a photo (JPG/PNG/WebP/HEIC) or PDF.", "VALIDATION", { receipt: "Wrong type" });
  const stored = await tx.storedFile.create({
    data: {
      purpose, fileName: file.name.slice(0, 120) || "receipt", contentType: file.type,
      size: file.size, data: new Uint8Array(await file.arrayBuffer()), uploadedById: userId,
    },
  });
  return stored.id;
}

function validate(input: ExpenseInput) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter a positive whole amount.", "VALIDATION", { amount: "Invalid" });
  if (!input.description.trim() && !input.itemId && !input.newItem?.name.trim()) throw new AppError("Say what the money was for.", "VALIDATION", { description: "Required" });
}

/** An expense made by a stock purchase changes only from the purchase (the stock and the money stay together). */
async function assertNotPurchaseTx(tx: Tx, expenseId: string) {
  const p = await tx.stockRequest.findUnique({ where: { expenseId }, select: { number: true, purchaseNumber: true } });
  if (p) throw new AppError(`This expense comes from purchase ${p.purchaseNumber ?? p.number} (${p.number}) — the stock was received with it, so it changes only from the purchase.`, "CONFLICT");
}

/** The same supplier receipt already on a stock purchase: it becomes an expense by itself — never typed in again. */
async function assertNotPurchasedTx(tx: Tx, reference: string | null | undefined) {
  const ref = reference?.trim();
  if (!ref) return;
  const p = await tx.stockRequest.findFirst({
    where: { receiptNumber: { equals: ref, mode: "insensitive" }, status: { in: ["PURCHASING", "PENDING_APPROVAL", "COMPLETED"] } },
    select: { number: true, purchaseNumber: true, status: true },
  });
  if (p) throw new AppError(`Receipt ${ref} is already on stock purchase ${p.purchaseNumber ?? p.number} — ${p.status === "COMPLETED" ? "its expense is already recorded" : "it becomes an expense when the purchase is approved"}. Don't record it twice.`, "CONFLICT", { reference: "Duplicate" });
}

export async function recordExpense(input: ExpenseInput, actor: Actor) {
  validate(input);
  return db.$transaction(async (tx) => {
    await assertNotPurchasedTx(tx, input.reference);
    const settings = await getSettingsTx(tx);
    const item = await resolveItem(tx, input, actor.userId);
    const category = await tx.expenseCategory.findUnique({ where: { id: item?.categoryId ?? input.categoryId } });
    if (!category || (!category.isActive && !item)) throw new AppError("Choose what the money was for.", "VALIDATION", { categoryId: "Required" });
    const spentAt = input.spentAt ?? new Date();
    if (spentAt.getTime() > Date.now() + 5 * 60_000) throw new AppError("The expense time cannot be in the future.");
    const needsApproval = settings.expenseApprovalThreshold > 0 && input.amount >= settings.expenseApprovalThreshold;
    const receiptFileId = input.receipt && input.receipt.size > 0 ? await storeReceipt(tx, input.receipt, actor.userId) : null;
    const paid = await resolveAccountTx(tx, { accountId: input.accountId, methodId: input.paymentMethodId }, "expenses");

    const expense = await tx.expense.create({
      data: {
        number: await nextExpenseNumber(tx, String(spentAt.getFullYear())),
        accountId: paid.account.id,
        categoryId: category.id,
        itemId: item?.id ?? null,
        amount: input.amount,
        businessDate: toDbDate(businessDateOf(spentAt, stayConfig(settings))),
        spentAt,
        paymentMethodId: paid.method.id,
        description: input.description.trim() || item?.name || "",
        payee: input.payee?.trim() || item?.defaultPayee || null,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        receiptFileId,
        receiptUrl: receiptFileId ? `/api/files/${receiptFileId}` : null,
        status: needsApproval ? "PENDING_APPROVAL" : "RECORDED",
        createdById: actor.userId,
      },
    });
    if (needsApproval) await tx.expenseApproval.create({ data: { expenseId: expense.id, action: "SUBMITTED", actorId: actor.userId } });
    if (item) await tx.expenseItem.update({ where: { id: item.id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
    await audit(tx, actor, {
      action: "expense.created", entityType: "Expense", entityId: expense.id,
      after: { category: category.name, type: item?.name ?? null, amount: expense.amount, description: expense.description, status: expense.status, businessDate: expense.businessDate.toISOString().slice(0, 10) },
    });
    return expense;
  });
}

/** Edit an expense the user created that is awaiting correction (or recorded today and not yet reviewed). */
export async function correctExpense(expenseId: string, input: ExpenseInput, actor: Actor, reason = "") {
  validate(input);
  // Never silently: every edit says why, and the old values stay in the edit history.
  if (!reason.trim()) throw new AppError("Say why you are changing this expense.", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    const settings = await getSettingsTx(tx);
    const before = await tx.expense.findUnique({ where: { id: expenseId }, include: { category: true } });
    if (!before) throw new AppError("Expense not found.", "NOT_FOUND");
    await assertNotPurchaseTx(tx, expenseId);
    const isOwner = before.createdById === actor.userId;
    const today = businessDateOf(new Date(), stayConfig(settings));
    const editableStatus = before.status === "CORRECTION_REQUESTED" || ((before.status === "RECORDED" || before.status === "PENDING_APPROVAL") && before.businessDate.toISOString().slice(0, 10) === today);
    if (!editableStatus) throw new AppError("This expense can no longer be edited. Ask a manager to void it and record a new one.");
    if (!isOwner && !actor.permissions.has("expenses.approve")) throw new AppError("You can only correct your own expenses.", "FORBIDDEN");

    const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new AppError("Choose a category.");
    const needsApproval = settings.expenseApprovalThreshold > 0 && input.amount >= settings.expenseApprovalThreshold;
    const receiptFileId = input.receipt && input.receipt.size > 0 ? await storeReceipt(tx, input.receipt, actor.userId) : before.receiptFileId;
    const status: ExpenseStatus = needsApproval ? "PENDING_APPROVAL" : "RECORDED";
    const paid = await resolveAccountTx(tx, { accountId: input.accountId || before.accountId, methodId: input.paymentMethodId || before.paymentMethodId }, "expenses");

    await tx.expense.update({
      where: { id: expenseId },
      data: {
        categoryId: category.id, amount: input.amount, paymentMethodId: paid.method.id, accountId: paid.account.id,
        description: input.description.trim(), payee: input.payee?.trim() || null, reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null, receiptFileId, receiptUrl: receiptFileId ? `/api/files/${receiptFileId}` : null, status,
      },
    });
    if (before.status === "CORRECTION_REQUESTED" || needsApproval) {
      await tx.expenseApproval.create({ data: { expenseId, action: "RESUBMITTED", actorId: actor.userId } });
    }
    await audit(tx, actor, {
      action: "expense.edited", entityType: "Expense", entityId: expenseId,
      before: { number: before.number, category: before.category.name, amount: before.amount, description: before.description, payee: before.payee, account: before.accountId, status: before.status },
      after: { number: before.number, category: category.name, amount: input.amount, description: input.description.trim(), payee: input.payee?.trim() || null, account: input.accountId || null, status, reason: reason.trim() },
    });
  });
}

export async function reviewExpense(
  expenseId: string,
  decision: "APPROVED" | "REJECTED" | "CORRECTION_REQUESTED",
  note: string,
  actor: Actor,
) {
  if (!actor.permissions.has("expenses.approve")) throw new AppError("Only a manager can review expenses.", "FORBIDDEN");
  if (decision !== "APPROVED" && !note.trim()) throw new AppError("Explain why, so the staff member knows what to fix.", "VALIDATION", { note: "Required" });
  return db.$transaction(async (tx) => {
    const e = await tx.expense.findUnique({ where: { id: expenseId } });
    if (!e) throw new AppError("Expense not found.", "NOT_FOUND");
    if (e.status !== "PENDING_APPROVAL") throw new AppError("This expense is not waiting for approval.");
    await assertNotPurchaseTx(tx, e.id);
    if (e.createdById === actor.userId && actor.roleCode !== "OWNER") throw new AppError("You cannot approve your own expense. Ask another manager or the owner.", "FORBIDDEN");
    await tx.expense.update({ where: { id: e.id }, data: { status: decision } });
    await tx.expenseApproval.create({ data: { expenseId: e.id, action: decision, note: note.trim() || null, actorId: actor.userId } });
    await audit(tx, actor, {
      action: decision === "APPROVED" ? "expense.approved" : decision === "REJECTED" ? "expense.rejected" : "expense.correction_requested",
      entityType: "Expense", entityId: e.id, before: { status: e.status }, after: { status: decision, note },
    });
  });
}

/**
 * Cancel an expense (it stays on the register, struck through, with who and why).
 * A manager may cancel any; staff may cancel their own on the hotel day they recorded it.
 */
export async function voidExpense(expenseId: string, reason: string, actor: Actor) {
  if (!reason.trim()) throw new AppError("Give a reason.", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    const e = await tx.expense.findUnique({ where: { id: expenseId } });
    if (!e || e.status === "VOIDED") throw new AppError("Expense not found or already voided.");
    await assertNotPurchaseTx(tx, e.id);
    if (!actor.permissions.has("expenses.record")) throw new AppError("You cannot cancel expenses.", "FORBIDDEN");
    await tx.expense.update({ where: { id: e.id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason.trim() } });
    await tx.expenseApproval.create({ data: { expenseId: e.id, action: "VOIDED", note: reason.trim(), actorId: actor.userId } });
    await audit(tx, actor, { action: "expense.voided", entityType: "Expense", entityId: e.id, before: { status: e.status, amount: e.amount }, after: { status: "VOIDED", reason } });
  });
}

/**
 * Correct an expense that is already counted (paid): the old line is cancelled
 * and stays on the register, and a corrected line is posted in its place.
 * Both carry the reason, who did it and when — nothing is overwritten.
 */
export async function repostCorrectedExpense(expenseId: string, input: ExpenseInput, reason: string, actor: Actor) {
  validate(input);
  if (!actor.permissions.has("expenses.record")) throw new AppError("You cannot correct expenses.", "FORBIDDEN");
  if (!reason.trim()) throw new AppError("Say what was wrong with the record.", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    const settings = await getSettingsTx(tx);
    const old = await tx.expense.findUnique({ where: { id: expenseId }, include: { category: true, receiptFile: true } });
    if (!old) throw new AppError("Expense not found.", "NOT_FOUND");
    if (old.status === "VOIDED" || old.status === "REJECTED") throw new AppError("This expense is cancelled — reinstate it first.");
    await assertNotPurchaseTx(tx, old.id);
    const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new AppError("Choose a category.", "VALIDATION", { categoryId: "Required" });
    const spentAt = input.spentAt ?? old.spentAt;
    if (spentAt.getTime() > Date.now() + 5 * 60_000) throw new AppError("The expense date cannot be in the future.");

    await tx.expense.update({ where: { id: old.id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: `Corrected: ${reason.trim()}` } });
    await tx.expenseApproval.create({ data: { expenseId: old.id, action: "VOIDED", note: `Corrected: ${reason.trim()}`, actorId: actor.userId } });

    // Keep the receipt: a new upload replaces it, otherwise the old document is copied to the corrected line.
    let receiptFileId: string | null = null;
    if (input.receipt && input.receipt.size > 0) receiptFileId = await storeReceipt(tx, input.receipt, actor.userId);
    else if (old.receiptFile) {
      const f = old.receiptFile;
      receiptFileId = (await tx.storedFile.create({ data: { purpose: f.purpose, fileName: f.fileName, contentType: f.contentType, size: f.size, data: f.data, uploadedById: f.uploadedById } })).id;
    }
    const needsApproval = settings.expenseApprovalThreshold > 0 && input.amount >= settings.expenseApprovalThreshold && !actor.permissions.has("expenses.approve");
    const paid = await resolveAccountTx(tx, { accountId: input.accountId || old.accountId, methodId: input.paymentMethodId || old.paymentMethodId }, "expenses");
    const fresh = await tx.expense.create({
      data: {
        number: await nextExpenseNumber(tx, String(spentAt.getFullYear())), correctsId: old.id, itemId: old.itemId,
        categoryId: category.id, amount: input.amount, businessDate: toDbDate(businessDateOf(spentAt, stayConfig(settings))), spentAt,
        paymentMethodId: paid.method.id, accountId: paid.account.id,
        description: input.description.trim(), payee: input.payee?.trim() || null, reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null, receiptFileId, receiptUrl: receiptFileId ? `/api/files/${receiptFileId}` : null,
        status: needsApproval ? "PENDING_APPROVAL" : old.status === "APPROVED" ? "APPROVED" : "RECORDED",
        createdById: old.createdById,
      },
    });
    await audit(tx, actor, {
      action: "expense.corrected", entityType: "Expense", entityId: fresh.id,
      before: { number: old.number, category: old.category.name, amount: old.amount, description: old.description, account: old.accountId, method: old.paymentMethodId, date: old.businessDate.toISOString().slice(0, 10) },
      after: { number: fresh.number, category: category.name, amount: fresh.amount, description: fresh.description, account: fresh.accountId, method: fresh.paymentMethodId, date: fresh.businessDate.toISOString().slice(0, 10), reason: reason.trim() },
    });
    return fresh;
  });
}

/** Bring back an expense that was cancelled by mistake (not one that was replaced by a correction). */
export async function reinstateExpense(expenseId: string, actor: Actor) {
  if (!actor.permissions.has("expenses.void")) throw new AppError("Only a manager can reinstate expenses.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const e = await tx.expense.findUnique({ where: { id: expenseId }, include: { approvals: true } });
    if (!e || e.status !== "VOIDED") throw new AppError("Only a cancelled expense can be reinstated.");
    await assertNotPurchaseTx(tx, e.id);
    const replacement = await tx.expense.findFirst({ where: { correctsId: e.id, status: { not: "VOIDED" } } });
    if (replacement) throw new AppError(`This expense was corrected by ${replacement.number ?? "a newer line"} — cancel that one first.`);
    const status: ExpenseStatus = e.approvals.some((a) => a.action === "APPROVED") ? "APPROVED" : "RECORDED";
    await tx.expense.update({ where: { id: e.id }, data: { status, voidedAt: null, voidReason: null } });
    await tx.expenseApproval.create({ data: { expenseId: e.id, action: "RESUBMITTED", note: "Reinstated", actorId: actor.userId } });
    await audit(tx, actor, { action: "expense.reinstated", entityType: "Expense", entityId: e.id, before: { status: "VOIDED", reason: e.voidReason }, after: { status } });
  });
}

/**
 * The one expense of a stock purchase, made at its final approval (inside that transaction):
 * the ACTUAL amount paid, from the account that paid, with the supplier's receipt — counted at
 * once (APPROVED: the final approval is the approval, whatever the threshold). Who bought it
 * submitted it, who gave the final approval approved it — both stay on its approval trail.
 */
export async function createPurchaseExpenseTx(tx: Tx, input: {
  amount: number; categoryId: string; spentAt: Date; accountId: string; description: string; payee: string | null; reference: string | null;
  notes: string | null; receiptFileId: string | null; purchaserId: string; submittedAt: Date; approverId: string; now: Date;
}, actor: AuditActor) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("The purchase has no amount paid.", "VALIDATION");
  const settings = await getSettingsTx(tx);
  const paid = await resolveAccountTx(tx, { accountId: input.accountId }, "expenses");
  const category = await tx.expenseCategory.findUniqueOrThrow({ where: { id: input.categoryId } });
  const expense = await tx.expense.create({
    data: {
      number: await nextExpenseNumber(tx, String(input.spentAt.getFullYear())), accountId: paid.account.id, paymentMethodId: paid.method.id,
      categoryId: category.id, amount: input.amount, businessDate: toDbDate(businessDateOf(input.spentAt, stayConfig(settings))), spentAt: input.spentAt,
      description: input.description.slice(0, 300), payee: input.payee, reference: input.reference, notes: input.notes,
      receiptFileId: input.receiptFileId, receiptUrl: input.receiptFileId ? `/api/files/${input.receiptFileId}` : null,
      status: "APPROVED", createdById: input.purchaserId,
    },
  });
  await tx.expenseApproval.create({ data: { expenseId: expense.id, action: "SUBMITTED", note: "Stock purchase", actorId: input.purchaserId, createdAt: input.submittedAt } });
  await tx.expenseApproval.create({ data: { expenseId: expense.id, action: "APPROVED", note: "Final approval of the purchase", actorId: input.approverId, createdAt: input.now } });
  await audit(tx, actor, {
    action: "expense.created", entityType: "Expense", entityId: expense.id,
    after: { category: category.name, amount: expense.amount, description: expense.description, status: expense.status, businessDate: expense.businessDate.toISOString().slice(0, 10), source: "stock purchase", account: paid.account.name },
  });
  return expense;
}

// ───────────────────────── Expense types ─────────────────────────

/** Every active expense type, by group, plus the most used ones (for quick picking). */
export async function expenseTypes() {
  const [groups, top] = await Promise.all([
    db.expenseCategory.findMany({
      where: { isActive: true }, orderBy: { sortOrder: "asc" },
      include: { items: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    }),
    db.expenseItem.findMany({ where: { isActive: true, useCount: { gt: 0 }, category: { isActive: true } }, orderBy: [{ useCount: "desc" }, { lastUsedAt: "desc" }], take: 8 }),
  ]);
  return {
    groups: groups.map((g) => ({ id: g.id, name: g.name, icon: g.icon, items: g.items.map((i) => ({ id: i.id, name: i.name, frequency: i.frequency, payee: i.defaultPayee, amount: i.defaultAmount })) })),
    mostUsed: top.map((i) => i.id),
  };
}
export type ExpenseTypes = Awaited<ReturnType<typeof expenseTypes>>;

/** Fixed monthly bills for a month: paid (and how much) or not paid yet. */
export async function monthlyBills(from: BusinessDate, to: BusinessDate) {
  const [items, paid] = await Promise.all([
    db.expenseItem.findMany({ where: { isActive: true, frequency: "MONTHLY", category: { isActive: true } }, include: { category: true }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }] }),
    db.expense.groupBy({
      by: ["itemId"], where: { itemId: { not: null }, businessDate: { gte: toDbDate(from), lte: toDbDate(to) }, status: { in: [...COUNTED_EXPENSE_STATUSES, "PENDING_APPROVAL"] } },
      _sum: { amount: true }, _count: true, _max: { businessDate: true },
    }),
  ]);
  const byItem = new Map(paid.map((p) => [p.itemId!, p]));
  return items.map((i) => {
    const p = byItem.get(i.id);
    return { id: i.id, name: i.name, group: i.category.name, paid: p?._sum.amount ?? 0, times: p?._count ?? 0, last: p?._max.businessDate ? p._max.businessDate.toISOString().slice(0, 10) : null };
  });
}

/** Money spent per expense type in a period — like the hotel's monthly summary sheet. */
export async function spendByType(from: BusinessDate, to: BusinessDate) {
  const rows = await db.expense.groupBy({
    by: ["categoryId", "itemId"], where: { businessDate: { gte: toDbDate(from), lte: toDbDate(to) }, status: { in: COUNTED_EXPENSE_STATUSES } },
    _sum: { amount: true }, _count: true,
  });
  const [cats, items] = await Promise.all([
    db.expenseCategory.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.categoryId))] } } }),
    db.expenseItem.findMany({ where: { id: { in: rows.map((r) => r.itemId).filter((x): x is string => !!x) } } }),
  ]);
  const groups = cats.sort((a, b) => a.sortOrder - b.sortOrder).map((c) => {
    const lines = rows.filter((r) => r.categoryId === c.id).map((r) => ({
      name: r.itemId ? items.find((i) => i.id === r.itemId)?.name ?? "—" : "Other (no type picked)", amount: r._sum.amount ?? 0, count: r._count,
    })).sort((a, b) => b.amount - a.amount);
    return { id: c.id, name: c.name, total: lines.reduce((s, l) => s + l.amount, 0), lines };
  });
  return { groups, total: groups.reduce((s, g) => s + g.total, 0) };
}
