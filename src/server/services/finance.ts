import "server-only";
import { timeRange } from "@/lib/meeting";
import { db, type Tx } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { getSettingsTx, businessDayConfig } from "../settings";
import { addDays, businessDateOf, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { CHARGE_LABELS } from "@/lib/charge-types";
import { formatBusinessDate as formatDay } from "@/lib/format";
import { EARNED_NIGHT } from "./reservation-financials";
import { COUNTED_EXPENSE_STATUSES, RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "./expenses";
import type { LedgerEntryKind } from "@/generated/prisma/enums";

/**
 * FinanceService — the hotel's money picture, built from the records that
 * already exist (no second copy of any amount, so nothing can count twice):
 *
 *   INCOME (earned)   room nights · folio charges · direct sales · meeting room · other income
 *   EXPENSES          expenses (recorded / approved)
 *   MONEY IN / OUT    guest payments · refunds · direct sales · expenses · transfers · owner money · corrections
 *
 * Income is counted on the hotel day it is earned (a 3-night stay = 3 nights on 3 days);
 * money is counted on the day it moves. A payment settles what a guest owes — it is
 * never income a second time. Every row keeps who did it; nothing is ever deleted.
 */

export type Actor = AuditActor & { userId: string; permissions: ReadonlySet<string> };

// ───────────────────────── Money accounts ─────────────────────────

const IN_KINDS: LedgerEntryKind[] = ["OWNER_CONTRIBUTION", "OTHER_INCOME", "ADJUSTMENT_IN"];
const OUT_KINDS: LedgerEntryKind[] = ["OWNER_WITHDRAWAL", "ADJUSTMENT_OUT"];

export interface AccountBalance {
  id: string; code: string; name: string; kind: string; openingBalance: number;
  moneyIn: number; moneyOut: number; balance: number;
  /** Movement on the given day (for "today"). */
  dayIn: number; dayOut: number;
}

/** Money into / out of each account, optionally only for business dates in [from, to]. */
async function flows(client: Tx | typeof db, range?: { from: BusinessDate; to: BusinessDate }) {
  const bd = range ? { businessDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) } } : {};
  const rd = range ? { reversalBusinessDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) } } : { reversalBusinessDate: { not: null } };
  const [methods, payments, reversals, sales, expenses, entries, transfersIn] = await Promise.all([
    client.paymentMethod.findMany({ select: { id: true, accountId: true } }),
    // Every payment counts on its own day; a reversal takes it back out on the day it was reversed.
    client.payment.groupBy({ by: ["accountId", "kind"], where: { ...bd, status: { in: ["POSTED", "REVERSED"] } }, _sum: { amount: true } }),
    client.payment.groupBy({ by: ["accountId", "kind"], where: { ...rd, status: "REVERSED" }, _sum: { amount: true } }),
    client.revenueTransaction.groupBy({ by: ["accountId"], where: { ...bd, isVoided: false }, _sum: { amount: true } }),
    client.expense.groupBy({ by: ["accountId", "paymentMethodId"], where: { ...bd, status: { in: COUNTED_EXPENSE_STATUSES } }, _sum: { amount: true } }),
    client.ledgerEntry.groupBy({ by: ["accountId", "kind"], where: { ...bd, status: "POSTED" }, _sum: { amount: true } }),
    client.ledgerEntry.groupBy({ by: ["toAccountId"], where: { ...bd, status: "POSTED", kind: "TRANSFER" }, _sum: { amount: true } }),
  ]);
  const methodAccount = new Map(methods.map((m) => [m.id, m.accountId]));
  const acc = new Map<string, { in: number; out: number }>();
  const add = (id: string | null | undefined, dir: "in" | "out", amount: number | null) => {
    if (!id || !amount) return;
    const a = acc.get(id) ?? { in: 0, out: 0 };
    a[dir] += amount;
    acc.set(id, a);
  };
  for (const p of payments) add(p.accountId, p.kind === "PAYMENT" ? "in" : "out", p._sum.amount);
  for (const p of reversals) add(p.accountId, p.kind === "PAYMENT" ? "out" : "in", p._sum.amount);
  for (const s of sales) add(s.accountId, "in", s._sum.amount);
  for (const e of expenses) add(e.accountId ?? (e.paymentMethodId ? methodAccount.get(e.paymentMethodId) : null), "out", e._sum.amount);
  for (const e of entries) add(e.accountId, IN_KINDS.includes(e.kind) ? "in" : "out", e._sum.amount); // TRANSFER leaves its source account
  for (const t of transfersIn) add(t.toAccountId, "in", t._sum.amount);
  return acc;
}

export async function accountBalances(day?: BusinessDate, includeInactive = false): Promise<AccountBalance[]> {
  const [accounts, all, today] = await Promise.all([
    db.moneyAccount.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { sortOrder: "asc" } }),
    flows(db),
    day ? flows(db, { from: day, to: day }) : Promise.resolve(new Map<string, { in: number; out: number }>()),
  ]);
  return accounts.map((a) => {
    const f = all.get(a.id) ?? { in: 0, out: 0 };
    const t = today.get(a.id) ?? { in: 0, out: 0 };
    return {
      id: a.id, code: a.code, name: a.name, kind: a.kind, openingBalance: a.openingBalance,
      moneyIn: f.in, moneyOut: f.out, balance: a.openingBalance + f.in - f.out, dayIn: t.in, dayOut: t.out,
    };
  });
}

async function expectedBalance(tx: Tx, accountId: string): Promise<number> {
  const a = await tx.moneyAccount.findUniqueOrThrow({ where: { id: accountId } });
  const f = (await flows(tx)).get(accountId) ?? { in: 0, out: 0 };
  return a.openingBalance + f.in - f.out;
}

// ───────────────────────── Money movements ─────────────────────────

export const MOVEMENT_LABELS: Record<LedgerEntryKind, string> = {
  TRANSFER: "Transfer between accounts",
  OWNER_CONTRIBUTION: "Owner put money in",
  OWNER_WITHDRAWAL: "Owner took money out",
  OTHER_INCOME: "Other income",
  ADJUSTMENT_IN: "Correction (money in)",
  ADJUSTMENT_OUT: "Correction (money out)",
};

async function storeAttachment(tx: Tx, file: File, userId: string) {
  if (file.size > RECEIPT_MAX_BYTES) throw new AppError("The document is larger than 5 MB.", "VALIDATION", { attachment: "Too large" });
  if (!RECEIPT_TYPES.includes(file.type)) throw new AppError("Attach a photo (JPG/PNG/WebP/HEIC) or a PDF.", "VALIDATION", { attachment: "Wrong type" });
  const f = await tx.storedFile.create({
    data: { purpose: "LEDGER_DOCUMENT", fileName: file.name.slice(0, 120) || "document", contentType: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()), uploadedById: userId },
  });
  return f.id;
}

async function nextNumber(tx: Tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ledger_entry_number'))::text`;
  const n = await tx.ledgerEntry.count();
  return `LG-${String(n + 1).padStart(6, "0")}`;
}

export interface MovementInput {
  kind: LedgerEntryKind;
  amount: number;
  accountId: string;
  toAccountId?: string | null;
  description: string;
  reference?: string | null;
  notes?: string | null;
  attachment?: File | null;
}

/** Post a money movement (transfer, owner money, other income, correction). */
export async function postMovement(input: MovementInput, actor: Actor, opts: { cashCountId?: string } = {}) {
  if (!actor.permissions.has("finance.manage")) throw new AppError("Only Admin can record money movements.", "FORBIDDEN");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter a positive whole amount.", "VALIDATION", { amount: "Invalid" });
  if (!input.description.trim()) throw new AppError("Say what this is for.", "VALIDATION", { description: "Required" });
  if (input.kind === "TRANSFER") {
    if (!input.toAccountId) throw new AppError("Choose the account the money went to.", "VALIDATION", { toAccountId: "Required" });
    if (input.toAccountId === input.accountId) throw new AppError("Choose two different accounts.", "VALIDATION", { toAccountId: "Same account" });
  }
  return db.$transaction(async (tx) => {
    const settings = await getSettingsTx(tx);
    const now = new Date();
    const attachmentFileId = input.attachment && input.attachment.size > 0 ? await storeAttachment(tx, input.attachment, actor.userId) : null;
    const entry = await tx.ledgerEntry.create({
      data: {
        number: await nextNumber(tx), kind: input.kind, amount: input.amount, accountId: input.accountId,
        toAccountId: input.kind === "TRANSFER" ? input.toAccountId! : null,
        description: input.description.trim(), reference: input.reference?.trim() || null, notes: input.notes?.trim() || null,
        occurredAt: now, businessDate: toDbDate(businessDateOf(now, businessDayConfig(settings))),
        attachmentFileId, cashCountId: opts.cashCountId ?? null, createdById: actor.userId,
      },
    });
    await audit(tx, actor, {
      action: "finance.movement_posted", entityType: "LedgerEntry", entityId: entry.id,
      after: { number: entry.number, kind: entry.kind, amount: entry.amount, account: input.accountId, to: input.toAccountId ?? null, description: entry.description },
    });
    return entry;
  });
}

/** A posted movement is never deleted: it is reversed (stays on the ledger, struck through). */
export async function reverseMovement(id: string, reason: string, actor: Actor) {
  if (!actor.permissions.has("finance.manage")) throw new AppError("Only Admin can reverse money movements.", "FORBIDDEN");
  if (!reason.trim()) throw new AppError("Say why it is being reversed.", "VALIDATION", { reason: "Required" });
  return db.$transaction(async (tx) => {
    const e = await tx.ledgerEntry.findUnique({ where: { id } });
    if (!e) throw new AppError("Entry not found.", "NOT_FOUND");
    if (e.status === "REVERSED") throw new AppError("This entry is already reversed.");
    await tx.ledgerEntry.update({ where: { id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: actor.userId, reversalReason: reason.trim() } });
    await audit(tx, actor, {
      action: "finance.movement_reversed", entityType: "LedgerEntry", entityId: id,
      before: { number: e.number, status: e.status, amount: e.amount }, after: { status: "REVERSED", reason: reason.trim() },
    });
  });
}

// ───────────────────────── Cash counts (reconciliation) ─────────────────────────

/** Record a physical count; the system works out what it expected and the difference. */
export async function recordCashCount(input: { accountId: string; counted: number; note?: string | null }, actor: Actor) {
  if (!actor.permissions.has("payments.record") && !actor.permissions.has("finance.manage")) throw new AppError("You cannot record cash counts.", "FORBIDDEN");
  if (!Number.isInteger(input.counted) || input.counted < 0) throw new AppError("Enter the amount counted.", "VALIDATION", { counted: "Invalid" });
  return db.$transaction(async (tx) => {
    const settings = await getSettingsTx(tx);
    const expected = await expectedBalance(tx, input.accountId);
    const difference = input.counted - expected;
    if (difference !== 0 && !input.note?.trim()) {
      throw new AppError(`The count is ${difference > 0 ? "over" : "short"} by TZS ${Math.abs(difference).toLocaleString("en-US")}. Explain the difference.`, "VALIDATION", { note: "Required" });
    }
    const now = new Date();
    const c = await tx.cashCount.create({
      data: {
        accountId: input.accountId, businessDate: toDbDate(businessDateOf(now, businessDayConfig(settings))), countedAt: now,
        expected, counted: input.counted, difference, note: input.note?.trim() || null, countedById: actor.userId,
        status: difference === 0 ? "ACCEPTED" : "OPEN", reviewedAt: difference === 0 ? now : null,
      },
    });
    await audit(tx, actor, { action: "finance.cash_counted", entityType: "CashCount", entityId: c.id, after: { account: input.accountId, expected, counted: input.counted, difference } });
    return c;
  });
}

/** Admin accepts a count with a difference; optionally posts a correction so the books match the drawer. */
export async function reviewCashCount(id: string, input: { postCorrection: boolean; note?: string | null }, actor: Actor) {
  if (!actor.permissions.has("finance.manage")) throw new AppError("Only Admin can accept cash differences.", "FORBIDDEN");
  const c = await db.cashCount.findUnique({ where: { id }, include: { account: true } });
  if (!c) throw new AppError("Count not found.", "NOT_FOUND");
  if (c.status !== "OPEN") throw new AppError("This count is already settled.");
  if (input.postCorrection && c.difference !== 0) {
    await postMovement({
      kind: c.difference > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", amount: Math.abs(c.difference), accountId: c.accountId,
      description: `Cash count ${c.difference > 0 ? "over" : "short"} — ${c.account.name}`, notes: [c.note, input.note].filter(Boolean).join(" · ") || null,
    }, actor, { cashCountId: c.id });
  }
  await db.$transaction(async (tx) => {
    await tx.cashCount.update({ where: { id }, data: { status: "ACCEPTED", reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: input.note?.trim() || null } });
    await audit(tx, actor, { action: "finance.cash_count_accepted", entityType: "CashCount", entityId: id, after: { difference: c.difference, correctionPosted: input.postCorrection } });
  });
}

// ───────────────────────── General ledger ─────────────────────────

export type LedgerSource = "ROOM" | "CHARGE" | "SALE" | "MEETING" | "PAYMENT" | "REFUND" | "REVERSAL" | "CORRECTION" | "EXPENSE" | "MOVEMENT" | "INVOICE";

export interface LedgerRow {
  id: string;
  source: LedgerSource;
  at: string; // ISO instant (for ordering and time)
  businessDate: BusinessDate;
  type: string; // Income · Payment · Expense · …
  category: string;
  description: string;
  reference: string | null;
  account: string | null;
  /** The payment account the money went into / left from (first one for a transfer). */
  accountId: string | null;
  by: string | null;
  income: number; // earned (negative for refunds)
  expense: number;
  moneyIn: number;
  moneyOut: number;
  /** Not counted in totals (voided, reversed, rejected, waiting for approval). */
  status: "POSTED" | "VOIDED" | "REVERSED" | "PENDING" | "REJECTED";
  note: string | null;
  href: string | null;
  attachment: string | null;
  /** Room income: official price before discounts, and the discounts (promotion + manual). */
  gross: number | null;
  discount: number | null;
  /** How the entry came about, e.g. "Check-in", "Walk-in", "Checkout". */
  via: string | null;
  /** Small label, e.g. "Reversed later". */
  tag: string | null;
}

export interface LedgerFilter {
  from: BusinessDate;
  to: BusinessDate;
  view?: "all" | "income" | "expense" | "money" | "discounts";
  accountId?: string | null;
  userId?: string | null;
  q?: string | null;
}

/** Every financial event in a period, from the real records, newest first. */
export async function getLedger(f: LedgerFilter): Promise<{ rows: LedgerRow[]; totals: { income: number; expense: number; net: number; moneyIn: number; moneyOut: number } }> {
  const bd = { gte: toDbDate(f.from), lte: toDbDate(f.to) };
  const [nights, charges, sales, payments, expenses, entries, methods, accounts] = await Promise.all([
    // Room income is earned once the guest has checked in (a booked night is only a price until then).
    db.roomNight.findMany({
      where: { businessDate: bd, ...EARNED_NIGHT },
      include: {
        reservationRoom: {
          select: {
            room: { select: { number: true } }, roomType: { select: { name: true, category: true } }, isDayUse: true, arrivalDate: true, startAt: true, endAt: true, checkedInAt: true, discountSetById: true, discountSetAt: true,
            checkedInBy: { select: { id: true, fullName: true } },
            reservation: { select: { id: true, reference: true, companyName: true, createdAt: true, source: { select: { code: true } }, guest: { select: { fullName: true } }, createdBy: { select: { id: true, fullName: true } }, group: { select: { reference: true } } } },
          },
        },
      },
    }),
    db.reservationCharge.findMany({ where: { businessDate: bd }, include: { reservation: { select: { id: true, reference: true, guest: { select: { fullName: true } }, group: { select: { reference: true } }, rooms: { select: { room: { select: { number: true } } }, take: 1 } } } } }),
    db.revenueTransaction.findMany({ where: { businessDate: bd }, include: { category: true, recordedBy: { select: { id: true, fullName: true } } } }),
    // Payments made in the period, and payments reversed in the period (the reversal is its own line).
    db.payment.findMany({
      where: { OR: [{ businessDate: bd }, { reversalBusinessDate: bd }, { corrections: { some: { businessDate: bd } } }] },
      include: {
        method: true, recordedBy: { select: { id: true, fullName: true } }, reversedBy: { select: { id: true, fullName: true } },
        corrections: { orderBy: { changedAt: "asc" } },
        reservation: { select: { id: true, reference: true, guest: { select: { fullName: true } } } }, invoice: { select: { id: true, number: true, group: { select: { name: true } }, guest: { select: { fullName: true } } } }, corporateCustomer: { select: { companyName: true } },
      },
    }),
    db.expense.findMany({ where: { businessDate: bd }, include: { category: true, paymentMethod: true, createdBy: { select: { id: true, fullName: true } }, stockRequest: { select: { id: true, number: true, purchaseNumber: true } } } }),
    db.ledgerEntry.findMany({ where: { businessDate: bd }, include: { account: true, toAccount: true, createdBy: { select: { id: true, fullName: true } } } }),
    db.paymentMethod.findMany({ include: { account: true } }),
    db.moneyAccount.findMany(),
  ]);
  const staffIds = [...charges.map((c) => c.createdById), ...nights.map((n) => n.reservationRoom.discountSetById)].filter((x): x is string => !!x);
  const staff = new Map((await db.user.findMany({ where: { id: { in: [...new Set(staffIds)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const inRange = (d: BusinessDate) => d >= f.from && d <= f.to;
  // Each night shows the room it was actually slept in (a guest may have moved mid-stay).
  const nightRooms = new Map((await db.room.findMany({ where: { id: { in: [...new Set(nights.map((n) => n.roomId))] } }, select: { id: true, number: true, roomType: { select: { name: true } } } })).map((r) => [r.id, r]));
  const correctorIds = [...new Set(payments.flatMap((p) => p.corrections.map((c) => c.changedById)))];
  const staffCorrectors = new Map((await db.user.findMany({ where: { id: { in: correctorIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const accountOfMethod = new Map(methods.map((m) => [m.id, m.account]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const rows: (Omit<LedgerRow, "accountId"> & { userId: string | null; accountIds: string[] })[] = [];
  const base = {
    reference: null, account: null, by: null, income: 0, expense: 0, moneyIn: 0, moneyOut: 0, status: "POSTED" as const, note: null, href: null, attachment: null,
    gross: null, discount: null, via: null, tag: null, userId: null, accountIds: [] as string[],
  };

  for (const n of nights) {
    const rr = n.reservationRoom;
    const d = fromDbDate(n.businessDate);
    const fmt = (x: number) => x.toLocaleString("en-US");
    const setBy = rr.discountSetById ? staff.get(rr.discountSetById) : null;
    // Official price → discounts → what was charged, and who gave the discount.
    const discounts = [
      n.promoDiscount && `${n.promotionName ?? "Promotion"} −${fmt(n.promoDiscount)}`,
      n.manualDiscount && `Discount −${fmt(n.manualDiscount)}${setBy ? ` by ${setBy}${rr.discountSetAt ? ` on ${rr.discountSetAt.toISOString().slice(0, 10)}` : ""}` : ""}`,
    ].filter(Boolean).join(" · ");
    const firstNight = fromDbDate(rr.arrivalDate) === d;
    const walkIn = rr.reservation.source.code === "WALK_IN";
    if (rr.roomType.category === "MEETING_ROOM") {
      // Meeting Room revenue: its own line, never room (bedroom) revenue. Earned when the meeting starts.
      rows.push({
        ...base, id: `n-${n.id}`, source: "MEETING", businessDate: d, type: "Income", category: "Meeting room",
        at: rr.checkedInAt ? rr.checkedInAt.toISOString() : `${d}T08:00:00.000Z`,
        description: `Room ${rr.room.number} — ${rr.roomType.name} · ${timeRange(rr.startAt, rr.endAt)} · ${rr.reservation.companyName ?? rr.reservation.guest.fullName}`, reference: rr.reservation.reference,
        by: rr.checkedInBy?.fullName ?? rr.reservation.createdBy?.fullName ?? "Website", userId: rr.checkedInBy?.id ?? rr.reservation.createdBy?.id ?? null,
        via: "Meeting started", income: n.netAmount, gross: n.grossAmount, discount: n.discountAmount,
        note: `${fmt(n.grossAmount)}${discounts ? ` − ${discounts}` : ""} = ${fmt(n.netAmount)}`, href: `/staff/reservations/${rr.reservation.id}`,
      });
      continue;
    }
    rows.push({
      ...base, id: `n-${n.id}`, source: "ROOM", businessDate: d, type: "Income", category: n.isDayUse ? "Rooms · short time" : "Rooms",
      at: firstNight && rr.checkedInAt ? rr.checkedInAt.toISOString() : `${d}T08:00:00.000Z`,
      description: `Room ${nightRooms.get(n.roomId)?.number ?? rr.room.number} · ${nightRooms.get(n.roomId)?.roomType.name ?? rr.roomType.name} · ${rr.reservation.guest.fullName}`, reference: [rr.reservation.reference, rr.reservation.group?.reference].filter(Boolean).join(" · "),
      by: rr.checkedInBy?.fullName ?? rr.reservation.createdBy?.fullName ?? "Website", userId: rr.checkedInBy?.id ?? rr.reservation.createdBy?.id ?? null,
      via: firstNight ? (walkIn ? "Walk-in check-in" : "Check-in") : n.isDayUse ? "Short time" : "Night of the stay",
      income: n.netAmount, gross: n.grossAmount, discount: n.discountAmount,
      note: `${fmt(n.grossAmount)}${n.priceRuleName ? ` (${n.priceRuleName} price)` : ""}${discounts ? ` − ${discounts}` : ""} = ${fmt(n.netAmount)}`, href: `/staff/reservations/${rr.reservation.id}`,
    });
  }
  for (const c of charges) {
    rows.push({
      ...base, id: `c-${c.id}`, source: "CHARGE", at: c.createdAt.toISOString(), businessDate: fromDbDate(c.businessDate), type: "Income",
      category: CHARGE_LABELS[c.category ?? ""] ?? (c.kind === "BAR" ? "Bar" : c.kind === "RESTAURANT" ? "Restaurant" : "Other services"),
      description: `${c.description} · ${c.reservation.rooms[0] ? `Room ${c.reservation.rooms[0].room.number} · ` : ""}${c.reservation.guest.fullName}`, reference: [c.reservation.reference, c.reservation.group?.reference].filter(Boolean).join(" · "), by: c.createdById ? staff.get(c.createdById) ?? null : null, userId: c.createdById,
      income: c.isVoided ? 0 : c.amount, status: c.isVoided ? "VOIDED" : "POSTED", note: c.isVoided ? `Voided${c.voidReason ? `: ${c.voidReason}` : ""}` : "On the guest's room bill",
      href: `/staff/reservations/${c.reservation.id}#extras`,
    });
  }
  for (const s of sales) {
    const acct = accountById.get(s.accountId);
    rows.push({
      ...base, id: `s-${s.id}`, source: "SALE", at: s.occurredAt.toISOString(), businessDate: fromDbDate(s.businessDate), type: "Income",
      category: s.category.name, description: s.description ?? s.category.name, account: acct?.name ?? null, accountIds: acct ? [acct.id] : [],
      by: s.recordedBy.fullName, userId: s.recordedBy.id, income: s.isVoided ? 0 : s.amount, moneyIn: s.isVoided ? 0 : s.amount,
      status: s.isVoided ? "VOIDED" : "POSTED", note: s.isVoided ? `Voided${s.voidReason ? `: ${s.voidReason}` : ""}` : "Paid on the spot", href: "/staff/sales",
    });
  }
  for (const p of payments) {
    // A payment is never hidden: it stays on its own day as it was recorded, and a reversal
    // is a separate line (minus the same amount) on the day it was reversed, with who and why.
    const acct = accountById.get(p.accountId);
    const who = p.reservation?.guest.fullName ?? p.corporateCustomer?.companyName ?? p.invoice?.group?.name ?? p.invoice?.guest?.fullName ?? "Customer";
    const refund = p.kind === "REFUND";
    const reversed = p.status === "REVERSED";
    const common = {
      ...base, category: p.method.name, reference: [p.reservation?.reference, p.invoice?.number, p.reference].filter(Boolean).join(" · ") || null,
      account: acct?.name ?? null, accountIds: acct ? [acct.id] : [],
      href: p.reservation ? `/staff/reservations/${p.reservation.id}` : p.invoice ? `/staff/invoices/${p.invoice.id}` : "/staff/payments",
    };
    const day = fromDbDate(p.businessDate);
    const methodName = (id: string) => methods.find((m) => m.id === id)?.name ?? "?";
    // Where the money went, before / after a correction (the account; older corrections only knew the method).
    const place = (acctId: string | null, methodId: string) => (acctId ? accountName.get(acctId) : null) ?? methodName(methodId);
    const moved = (c: (typeof p.corrections)[number]) => place(c.fromAccountId, c.fromMethodId) !== place(c.toAccountId, c.toMethodId);
    const corrected = p.corrections.filter(moved);
    if (inRange(day)) {
      rows.push({
        ...common, id: `p-${p.id}`, source: refund ? "REFUND" : "PAYMENT", at: p.receivedAt.toISOString(), businessDate: day,
        type: refund ? "Refund" : "Payment received",
        description: p.invoice && !refund ? `Payment for invoice ${p.invoice.number} — ${who}` : `${refund ? "Refund to" : "Paid by"} ${who}`,
        by: p.recordedBy.fullName, userId: p.recordedBy.id, via: p.invoice ? (p.invoice.group ? "Group invoice" : "Company invoice") : p.reservation ? "Guest account" : null,
        income: refund ? -p.amount : 0, moneyIn: refund ? 0 : p.amount, moneyOut: refund ? p.amount : 0,
        tag: reversed ? "Reversed later" : corrected.length ? `Account corrected: ${place(corrected[0].fromAccountId, corrected[0].fromMethodId)} → ${place(corrected.at(-1)!.toAccountId, corrected.at(-1)!.toMethodId)}` : null,
        note: refund ? "Money given back — reduces income" : "Settles what is owed — not income again",
      });
    }
    // Payment method / reference corrections: a visible line, same amount, never a new payment.
    for (const c of p.corrections) {
      const cd = fromDbDate(c.businessDate);
      if (!inRange(cd)) continue;
      const staffName = staffCorrectors.get(c.changedById) ?? null;
      rows.push({
        ...common, id: `x-${c.id}`, source: "CORRECTION", at: c.changedAt.toISOString(), businessDate: cd,
        type: "Payment account change", category: !moved(c) ? "Reference" : `${place(c.fromAccountId, c.fromMethodId)} → ${place(c.toAccountId, c.toMethodId)}`,
        description: `Payment by ${who} (TZS ${c.amount.toLocaleString("en-US")}, ${formatDay(day)}) — ${!moved(c) ? "reference corrected" : `was ${place(c.fromAccountId, c.fromMethodId)}, now ${place(c.toAccountId, c.toMethodId)}`}`,
        by: staffName, userId: c.changedById, via: "Correction",
        note: `Amount unchanged.${c.reason ? ` Why: ${c.reason}` : ""}${c.fromReference !== c.toReference ? ` · reference ${c.fromReference ?? "—"} → ${c.toReference ?? "—"}` : ""}`,
      });
    }
    if (reversed && p.reversalBusinessDate && inRange(fromDbDate(p.reversalBusinessDate))) {
      rows.push({
        ...common, id: `r-${p.id}`, source: "REVERSAL", at: (p.reversedAt ?? p.receivedAt).toISOString(), businessDate: fromDbDate(p.reversalBusinessDate),
        type: refund ? "Refund reversed" : "Payment reversed", description: `Reversal of ${refund ? "refund to" : "payment by"} ${who} (TZS ${p.amount.toLocaleString("en-US")}, ${formatDay(day)})`,
        by: p.reversedBy?.fullName ?? null, userId: p.reversedBy?.id ?? null, via: "Reversal",
        income: refund ? p.amount : 0, moneyIn: refund ? p.amount : 0, moneyOut: refund ? 0 : p.amount,
        note: `Why: ${p.reversalReason ?? "—"}. The original stays on ${formatDay(day)}.`,
      });
    }
  }
  for (const e of expenses) {
    const counted = COUNTED_EXPENSE_STATUSES.includes(e.status);
    const acct = e.accountId ? { id: e.accountId, name: accountName.get(e.accountId) ?? "" } : e.paymentMethodId ? accountOfMethod.get(e.paymentMethodId) : null;
    // Made by a stock purchase's final approval: still this one line — it opens the purchase, not the expense.
    const sr = e.stockRequest;
    rows.push({
      ...base, id: `e-${e.id}`, source: "EXPENSE", at: e.spentAt.toISOString(), businessDate: fromDbDate(e.businessDate), type: "Expense",
      category: e.category.name, description: e.description + (e.payee ? ` · paid to ${e.payee}` : ""), reference: e.reference,
      account: acct?.name ?? e.paymentMethod?.name ?? null, accountIds: acct ? [acct.id] : [], by: e.createdBy.fullName, userId: e.createdBy.id,
      expense: counted ? e.amount : 0, moneyOut: counted ? e.amount : 0,
      status: counted ? "POSTED" : e.status === "VOIDED" ? "VOIDED" : e.status === "REJECTED" ? "REJECTED" : "PENDING",
      note: e.status === "PENDING_APPROVAL" ? `TZS ${e.amount.toLocaleString("en-US")} waiting for approval` : e.status === "VOIDED" ? `Voided${e.voidReason ? `: ${e.voidReason}` : ""}` : e.notes,
      href: sr ? "/staff/stock-requests" : "/staff/expenses", attachment: e.receiptFileId ? `/api/files/${e.receiptFileId}` : e.receiptUrl,
      ...(sr ? { tag: `Purchase ${sr.purchaseNumber ?? sr.number}`, via: `Stock request ${sr.number}` } : {}),
    });
  }
  for (const m of entries) {
    const posted = m.status === "POSTED";
    const isIn = IN_KINDS.includes(m.kind);
    const transfer = m.kind === "TRANSFER";
    rows.push({
      ...base, id: `l-${m.id}`, source: "MOVEMENT", at: m.occurredAt.toISOString(), businessDate: fromDbDate(m.businessDate), type: MOVEMENT_LABELS[m.kind],
      category: transfer ? "Transfer" : m.kind.startsWith("OWNER") ? "Owner" : m.kind === "OTHER_INCOME" ? "Other income" : "Correction",
      description: transfer ? `${m.description} · ${m.account.name} → ${m.toAccount?.name ?? "?"}` : m.description, reference: m.number,
      account: transfer ? `${m.account.name} → ${m.toAccount?.name}` : m.account.name, accountIds: [m.accountId, ...(m.toAccountId ? [m.toAccountId] : [])],
      by: m.createdBy.fullName, userId: m.createdBy.id,
      income: posted && m.kind === "OTHER_INCOME" ? m.amount : 0,
      moneyIn: posted && isIn ? m.amount : 0, moneyOut: posted && (OUT_KINDS.includes(m.kind)) ? m.amount : 0,
      status: posted ? "POSTED" : "REVERSED", note: posted ? m.notes : `Reversed: ${m.reversalReason ?? ""}`, href: "/staff/finance/accounts",
      attachment: m.attachmentFileId ? `/api/files/${m.attachmentFileId}` : null,
    });
    // A transfer is money out of one account and into another: with an account filter it shows as in or out.
    if (transfer && posted && f.accountId) {
      const last = rows[rows.length - 1];
      if (f.accountId === m.accountId) last.moneyOut = m.amount;
      else if (f.accountId === m.toAccountId) last.moneyIn = m.amount;
    }
  }

  // Company invoices issued in the period: what a company now owes (a receivable). The income was
  // already counted when the nights / charges were earned, so this is neither income again nor money in.
  const issued = await db.invoice.findMany({
    where: { issueDate: bd, reservationId: null, status: { not: "DRAFT" } },
    include: { corporateCustomer: { select: { companyName: true } }, guest: { select: { fullName: true } }, group: { select: { name: true } }, createdBy: { select: { id: true, fullName: true } } },
  });
  for (const i of issued) {
    const who = i.corporateCustomer?.companyName ?? i.group?.name ?? i.guest?.fullName ?? "Customer";
    const off = i.status === "CANCELLED" || i.status === "VOID";
    rows.push({
      ...base, id: `i-${i.id}`, source: "INVOICE", at: i.createdAt.toISOString(), businessDate: fromDbDate(i.issueDate!),
      type: "Invoice issued", category: "Receivable", description: `${i.number} — ${who} owes TZS ${i.netAmount.toLocaleString("en-US")}`,
      reference: i.number, by: i.createdBy.fullName, userId: i.createdBy.id, via: "Company invoice", href: `/staff/invoices/${i.id}`,
      status: off ? "VOIDED" : "POSTED", tag: off ? null : i.balanceAmount > 0 ? `Owed ${i.balanceAmount.toLocaleString("en-US")}` : null,
      note: off ? `${i.status === "VOID" ? "Void" : "Cancelled"}: ${i.cancelReason ?? ""}`
        : `Receivable — already earned, not income again · paid ${i.paidAmount.toLocaleString("en-US")}${i.dueDate ? ` · due ${fromDbDate(i.dueDate)}` : ""}`,
    });
  }

  const q = f.q?.trim().toLowerCase();
  const filtered = rows
    .filter((r) => !f.userId || r.userId === f.userId)
    .filter((r) => !f.accountId || r.accountIds.includes(f.accountId))
    .filter((r) => f.view === "income" ? r.source === "ROOM" || r.source === "CHARGE" || r.source === "SALE" || r.source === "MEETING" || (r.source === "MOVEMENT" && r.category === "Other income") || r.source === "REFUND"
      : f.view === "expense" ? r.source === "EXPENSE"
        : f.view === "money" ? r.moneyIn > 0 || r.moneyOut > 0 || r.source === "PAYMENT" || r.source === "REFUND" || r.source === "REVERSAL" || r.source === "CORRECTION" || r.source === "MOVEMENT" || r.status !== "POSTED" && r.source !== "ROOM"
          : f.view === "discounts" ? (r.discount ?? 0) > 0
            : true)
    .filter((r) => !q || [r.description, r.reference, r.category, r.by, r.account, r.note, r.via, r.tag].some((x) => x?.toLowerCase().includes(q)))
    .sort((a, b) => (a.businessDate === b.businessDate ? b.at.localeCompare(a.at) : b.businessDate.localeCompare(a.businessDate)));
  const sum = (k: "income" | "expense" | "moneyIn" | "moneyOut") => filtered.reduce((s, r) => s + r[k], 0);
  const totals = { income: sum("income"), expense: sum("expense"), net: sum("income") - sum("expense"), moneyIn: sum("moneyIn"), moneyOut: sum("moneyOut") };
  // Drop the internal filter keys before handing rows to pages / CSV.
  return { rows: filtered.map((r) => { const { userId, accountIds, ...row } = r; void userId; return { ...row, accountId: accountIds[0] ?? null }; }), totals };
}

// ───────────────────────── Who owes the hotel ─────────────────────────

export async function receivables(today: BusinessDate) {
  const [guests, invoices] = await Promise.all([
    db.reservation.findMany({
      where: { balanceAmount: { gt: 0 }, status: { in: ["CHECKED_IN", "CHECKED_OUT"] } },
      include: { guest: { select: { fullName: true, phone: true } }, corporateCustomer: { select: { companyName: true } }, rooms: { select: { room: { select: { number: true } } } } },
      orderBy: { balanceAmount: "desc" },
    }),
    db.invoice.findMany({
      // Invoices that only mirror a guest's folio are already counted in that guest's balance.
      where: { reservationId: null, balanceAmount: { gt: 0 }, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } },
      include: { corporateCustomer: { select: { id: true, companyName: true } }, guest: { select: { fullName: true } }, group: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
    }),
  ]);
  const age = (d: Date | null) => (d ? Math.max(0, Math.round((Date.parse(today) - Date.parse(fromDbDate(d))) / 86_400_000)) : 0);
  return {
    guests: guests.map((r) => ({
      id: r.id, reference: r.reference, name: r.guest.fullName, phone: r.guest.phone, company: r.corporateCustomer?.companyName ?? r.companyName ?? null, meeting: r.kind === "MEETING",
      rooms: r.rooms.map((x) => x.room.number), status: r.status, balance: r.balanceAmount, total: r.netAmount, paid: r.paidAmount,
      since: fromDbDate(r.arrivalDate),
    })),
    invoices: invoices.map((i) => ({
      id: i.id, number: i.number, companyId: i.corporateCustomer?.id ?? null, customer: i.corporateCustomer?.companyName ?? i.group?.name ?? i.guest?.fullName ?? "—", balance: i.balanceAmount, total: i.netAmount,
      dueDate: i.dueDate ? fromDbDate(i.dueDate) : null, daysOverdue: i.dueDate && fromDbDate(i.dueDate) < today ? age(i.dueDate) : 0, status: i.status,
    })),
  };
}

// ───────────────────────── Staff activity ─────────────────────────

/** What each staff member did in a period: check-ins, check-outs, bookings, money taken, expenses. */
export async function staffActivity(from: BusinessDate, to: BusinessDate) {
  const bd = { gte: toDbDate(from), lte: toDbDate(to) };
  const [ins, outs, bookings, pays, exps, sales, users] = await Promise.all([
    db.auditLog.groupBy({ by: ["userId"], where: { businessDate: bd, action: { in: ["reservation.checked_in", "reservation.walk_in"] }, userId: { not: null } }, _count: true }),
    db.auditLog.groupBy({ by: ["userId"], where: { businessDate: bd, action: "reservation.checked_out", userId: { not: null } }, _count: true }),
    db.reservation.groupBy({ by: ["createdById"], where: { businessDate: bd, createdById: { not: null } }, _count: true }),
    db.payment.groupBy({ by: ["recordedById", "kind"], where: { businessDate: bd, status: "POSTED" }, _sum: { amount: true }, _count: true }),
    db.expense.groupBy({ by: ["createdById"], where: { businessDate: bd, status: { in: COUNTED_EXPENSE_STATUSES } }, _sum: { amount: true }, _count: true }),
    db.revenueTransaction.groupBy({ by: ["recordedById"], where: { businessDate: bd, isVoided: false }, _sum: { amount: true } }),
    db.user.findMany({ select: { id: true, fullName: true, role: { select: { name: true } } } }),
  ]);
  const map = new Map<string, { id: string; name: string; role: string; checkIns: number; checkOuts: number; bookings: number; payments: number; refunds: number; paymentCount: number; sales: number; expenses: number; expenseCount: number }>();
  const get = (id: string) => {
    if (!map.has(id)) {
      const u = users.find((x) => x.id === id);
      map.set(id, { id, name: u?.fullName ?? "Staff", role: u?.role.name ?? "", checkIns: 0, checkOuts: 0, bookings: 0, payments: 0, refunds: 0, paymentCount: 0, sales: 0, expenses: 0, expenseCount: 0 });
    }
    return map.get(id)!;
  };
  for (const r of ins) get(r.userId!).checkIns += r._count;
  for (const r of outs) get(r.userId!).checkOuts += r._count;
  for (const r of bookings) get(r.createdById!).bookings += r._count;
  for (const r of pays) {
    const s = get(r.recordedById);
    if (r.kind === "PAYMENT") { s.payments += r._sum.amount ?? 0; s.paymentCount += r._count; } else s.refunds += r._sum.amount ?? 0;
  }
  for (const r of exps) { const s = get(r.createdById); s.expenses += r._sum.amount ?? 0; s.expenseCount += r._count; }
  for (const r of sales) get(r.recordedById).sales += r._sum.amount ?? 0;
  return [...map.values()].sort((a, b) => b.payments + b.sales - (a.payments + a.sales) || b.checkIns - a.checkIns);
}

/** Payments received per method (money actually taken), for a period. */
export async function paymentsByMethod(from: BusinessDate, to: BusinessDate) {
  const bd = { gte: toDbDate(from), lte: toDbDate(to) };
  const [methods, pays, sales] = await Promise.all([
    db.paymentMethod.findMany({ orderBy: { sortOrder: "asc" } }),
    db.payment.groupBy({ by: ["methodId", "kind"], where: { businessDate: bd, status: "POSTED" }, _sum: { amount: true } }),
    db.revenueTransaction.groupBy({ by: ["paymentMethodId"], where: { businessDate: bd, isVoided: false }, _sum: { amount: true } }),
  ]);
  const rows = methods.map((m) => {
    const paid = pays.filter((p) => p.methodId === m.id && p.kind === "PAYMENT").reduce((s, p) => s + (p._sum.amount ?? 0), 0);
    const refunded = pays.filter((p) => p.methodId === m.id && p.kind === "REFUND").reduce((s, p) => s + (p._sum.amount ?? 0), 0);
    const sold = sales.filter((x) => x.paymentMethodId === m.id).reduce((s, x) => s + (x._sum.amount ?? 0), 0);
    return { method: m.name, code: m.code, amount: paid + sold - refunded };
  });
  return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
}

export const yesterdayOf = (d: BusinessDate) => addDays(d, -1);

/** An account's balance at the start of a hotel day (for running balances in the ledger). */
export async function balanceBefore(accountId: string, day: BusinessDate): Promise<number> {
  const a = await db.moneyAccount.findUniqueOrThrow({ where: { id: accountId } });
  const f = (await flows(db, { from: "2000-01-01", to: addDays(day, -1) })).get(accountId) ?? { in: 0, out: 0 };
  return a.openingBalance + f.in - f.out;
}
