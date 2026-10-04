import "server-only";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import type { MoneyAccountKind } from "@/generated/prisma/enums";
import { AppError } from "../errors";
import { audit } from "../audit";

/**
 * Payment accounts — the hotel's official places money is received (Cash, Lipa,
 * Lipa M-Pesa, CRDB, NMB …) and paid from. Staff only pick the account; the
 * payment method and the account details come from here. Totals are always
 * computed from recorded transactions — they are activity, not bank balances.
 */

/** The payment method implied by an account's type (Bank → Bank transfer, …). */
export const METHOD_FOR_KIND: Record<MoneyAccountKind, string> = {
  CASH: "CASH", PETTY_CASH: "CASH", BANK: "BANK", MOBILE_MONEY: "MOBILE_MONEY", CARD: "CARD", OTHER: "OTHER",
};
export const KIND_LABEL: Record<MoneyAccountKind, string> = {
  CASH: "Cash", PETTY_CASH: "Cash", BANK: "Bank", MOBILE_MONEY: "Mobile Money", CARD: "Card", OTHER: "Other",
};

type Client = Prisma.TransactionClient | typeof db;

/**
 * Validate where money went (or left from) and return the account + method.
 * `accountId` is what staff pick; `methodId` alone is still accepted for older
 * callers and resolves to that method's account.
 */
export async function resolveAccountTx(
  tx: Client,
  input: { accountId?: string | null; methodId?: string | null },
  use: "payments" | "expenses" = "payments",
  /** The automatic nTZS recording — the only way into the nTZS account (never by hand, never an expense). */
  opts: { internal?: boolean } = {},
) {
  const field = "accountId";
  if (input.accountId) {
    const account = await tx.moneyAccount.findUnique({ where: { id: input.accountId } });
    if (!account || !account.isActive) throw new AppError("That account is not active. Choose where the money went.", "VALIDATION", { [field]: "Inactive" });
    if (use === "payments" && !account.acceptsPayments) throw new AppError(`${account.name} does not receive payments. Choose another account.`, "VALIDATION", { [field]: "Not allowed" });
    if (use === "expenses" && !account.acceptsExpenses) throw new AppError(`${account.name} is not used to pay expenses. Choose another account.`, "VALIDATION", { [field]: "Not allowed" });
    const chosen = input.methodId ? await tx.paymentMethod.findUnique({ where: { id: input.methodId } }) : null;
    const method = chosen?.isActive ? chosen
      : (await tx.paymentMethod.findFirst({ where: { code: METHOD_FOR_KIND[account.kind], isActive: true } }))
        ?? (await tx.paymentMethod.findFirst({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }));
    if (!method) throw new AppError("No payment method is set up.");
    return { account, method };
  }
  if (input.methodId) {
    const method = await tx.paymentMethod.findUnique({ where: { id: input.methodId }, include: { account: true } });
    if (!method || !method.isActive) throw new AppError("Choose where the money went.", "VALIDATION", { [field]: "Required" });
    if (!method.account || !method.account.isActive) throw new AppError("Choose where the money went.", "VALIDATION", { [field]: "Required" });
    if (method.account.code === "NTZS" && !opts.internal) throw new AppError("The nTZS account moves only when nTZS confirms a payment — choose another account.", "VALIDATION", { [field]: "Not allowed" });
    return { account: method.account, method };
  }
  throw new AppError(use === "payments" ? "Choose where the money was received." : "Choose where the money was paid from.", "VALIDATION", { [field]: "Required" });
}

export type AccountOption = { id: string; name: string; kind: MoneyAccountKind; number: string | null; holder: string | null };

/** Active accounts staff can pick: "Received through" (payments) or "Paid from" (expenses). */
export async function accountOptions(use: "payments" | "expenses" = "payments"): Promise<AccountOption[]> {
  const rows = await db.moneyAccount.findMany({
    where: { isActive: true, ...(use === "payments" ? { acceptsPayments: true } : { acceptsExpenses: true }) },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((a) => ({ id: a.id, name: a.name, kind: a.kind, number: a.accountNumber, holder: a.holderName }));
}

/** The accounts customers pay into themselves (take out is paid first): mobile money and banks with a number — never cash or the card machine. */
export async function customerPayAccounts() {
  return (await accountOptions("payments")).filter((a) => a.number && !["CASH", "PETTY_CASH", "CARD"].includes(a.kind));
}

// ───────────────────────── Account activity (money in / money out) ─────────────────────────

export type ActivityType = "ROOM" | "COMPANY" | "MEETING" | "RESTAURANT" | "BAR" | "SALE" | "OTHER_PAYMENT" | "REFUND" | "REVERSAL" | "EXPENSE" | "TRANSFER" | "OWNER" | "ADJUSTMENT" | "OTHER_INCOME";
export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  ROOM: "Room payment", COMPANY: "Company invoice", MEETING: "Meeting room", RESTAURANT: "Restaurant", BAR: "Bar", SALE: "Other sale",
  OTHER_PAYMENT: "Payment", REFUND: "Refund", REVERSAL: "Reversal", EXPENSE: "Expense", TRANSFER: "Transfer", OWNER: "Owner money",
  ADJUSTMENT: "Correction", OTHER_INCOME: "Other income",
};

export interface ActivityRow {
  id: string; at: string; businessDate: string; type: ActivityType; description: string;
  /** Guest, company or supplier. */
  party: string | null; reference: string | null; room: string | null;
  /** + money in, − money out. */
  amount: number; by: string; byId: string; href: string | null;
  /** Booking / invoice / expense number it belongs to. */
  related: string | null;
  /** Receipt or document, when one was attached. */
  proof: string | null;
  /** Cancelled / reversed later: shown, not counted. */
  counted: boolean; note: string | null;
  /** Small label, e.g. "Purchase P-2026-0001" on the expense a stock purchase made. */
  tag?: string | null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Everything that moved money into or out of one account, in a hotel-day range, newest first. */
export async function accountActivity(accountId: string, from: string, to: string): Promise<ActivityRow[]> {
  const bd = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
  const [payments, reversals, sales, expenses, entries] = await Promise.all([
    db.payment.findMany({
      where: { accountId, businessDate: bd },
      include: {
        recordedBy: { select: { id: true, fullName: true } },
        reservation: { select: { id: true, reference: true, kind: true, companyName: true, guest: { select: { fullName: true } }, rooms: { select: { room: { select: { number: true } } } } } },
        invoice: { select: { id: true, number: true } }, corporateCustomer: { select: { companyName: true } },
      },
    }),
    db.payment.findMany({
      where: { accountId, status: "REVERSED", reversalBusinessDate: bd },
      include: { reversedBy: { select: { id: true, fullName: true } }, reservation: { select: { id: true, reference: true, guest: { select: { fullName: true } } } }, corporateCustomer: { select: { companyName: true } } },
    }),
    db.revenueTransaction.findMany({ where: { accountId, businessDate: bd }, include: { category: true, recordedBy: { select: { id: true, fullName: true } } } }),
    db.expense.findMany({ where: { accountId, businessDate: bd }, include: { category: true, item: { select: { name: true } }, createdBy: { select: { id: true, fullName: true } }, stockRequest: { select: { id: true, number: true, purchaseNumber: true } } } }),
    db.ledgerEntry.findMany({ where: { OR: [{ accountId }, { toAccountId: accountId }], businessDate: bd }, include: { account: true, toAccount: true, createdBy: { select: { id: true, fullName: true } } } }),
  ]);
  const rows: ActivityRow[] = [];
  for (const p of payments) {
    const refund = p.kind === "REFUND";
    const type: ActivityType = refund ? "REFUND" : p.reservation ? (p.reservation.kind === "MEETING" ? "MEETING" : "ROOM") : p.invoice ? "COMPANY" : "OTHER_PAYMENT";
    const party = p.reservation?.companyName ?? p.reservation?.guest.fullName ?? p.corporateCustomer?.companyName ?? null;
    rows.push({
      id: `p-${p.id}`, at: p.receivedAt.toISOString(), businessDate: day(p.businessDate), type,
      description: refund ? `Refund to ${party ?? "customer"}` : `${ACTIVITY_LABEL[type]}${party ? ` — ${party}` : ""}`,
      party, reference: [p.reservation?.reference, p.invoice?.number, p.reference].filter(Boolean).join(" · ") || null,
      room: p.reservation?.rooms.map((r) => r.room.number).join(", ") || null,
      amount: refund ? -p.amount : p.amount, by: p.recordedBy.fullName, byId: p.recordedBy.id,
      href: p.reservation ? `/staff/reservations/${p.reservation.id}` : p.invoice ? `/staff/invoices/${p.invoice.id}` : null,
      related: p.reservation?.reference ?? p.invoice?.number ?? null, proof: null,
      counted: true, note: p.status === "REVERSED" ? "Reversed later — see the reversal line" : null,
    });
  }
  for (const p of reversals) {
    const party = p.reservation?.guest.fullName ?? p.corporateCustomer?.companyName ?? null;
    rows.push({
      id: `r-${p.id}`, at: (p.reversedAt ?? p.receivedAt).toISOString(), businessDate: day(p.reversalBusinessDate!), type: "REVERSAL",
      description: `Reversal of ${p.kind === "REFUND" ? "refund to" : "payment by"} ${party ?? "customer"}`, party, reference: p.reservation?.reference ?? p.reference, room: null,
      amount: p.kind === "REFUND" ? p.amount : -p.amount, by: p.reversedBy?.fullName ?? "—", byId: p.reversedBy?.id ?? "",
      href: p.reservation ? `/staff/reservations/${p.reservation.id}` : null, related: p.reservation?.reference ?? null, proof: null, counted: true, note: p.reversalReason,
    });
  }
  for (const s of sales) {
    const type: ActivityType = s.kind === "RESTAURANT" ? "RESTAURANT" : s.kind === "BAR" ? "BAR" : "SALE";
    rows.push({
      id: `s-${s.id}`, at: s.occurredAt.toISOString(), businessDate: day(s.businessDate), type,
      description: `${s.category.name}${s.description ? ` — ${s.description}` : ""}`, party: null, reference: null, room: null,
      amount: s.amount, by: s.recordedBy.fullName, byId: s.recordedBy.id, href: "/staff/sales", related: null, proof: null, counted: !s.isVoided, note: s.isVoided ? `Cancelled: ${s.voidReason ?? ""}` : null,
    });
  }
  for (const e of expenses) {
    const counted = e.status === "RECORDED" || e.status === "APPROVED";
    // A stock purchase's one expense: opens the purchase, and its P- / SR- numbers can be searched.
    const sr = e.stockRequest;
    rows.push({
      id: `e-${e.id}`, at: e.spentAt.toISOString(), businessDate: day(e.businessDate), type: "EXPENSE",
      description: e.item?.name ?? e.description, party: e.payee, reference: sr ? [e.number, sr.purchaseNumber, sr.number].filter(Boolean).join(" · ") : e.number, room: null,
      amount: -e.amount, by: e.createdBy.fullName, byId: e.createdBy.id, href: sr ? "/staff/stock-requests" : "/staff/expenses", related: e.number, proof: e.receiptUrl, counted,
      tag: sr ? `Purchase ${sr.purchaseNumber ?? sr.number}` : null,
      note: e.status === "VOIDED" ? `Cancelled: ${e.voidReason ?? ""}` : e.status === "PENDING_APPROVAL" ? "Waiting for approval — not counted yet" : e.status === "REJECTED" ? "Rejected" : e.status === "CORRECTION_REQUESTED" ? "Needs correction" : e.category.name,
    });
  }
  for (const m of entries) {
    const incoming = m.kind === "TRANSFER" ? m.toAccountId === accountId : ["OWNER_CONTRIBUTION", "OTHER_INCOME", "ADJUSTMENT_IN"].includes(m.kind);
    const type: ActivityType = m.kind === "TRANSFER" ? "TRANSFER" : m.kind.startsWith("OWNER") ? "OWNER" : m.kind === "OTHER_INCOME" ? "OTHER_INCOME" : "ADJUSTMENT";
    rows.push({
      id: `m-${m.id}`, at: m.occurredAt.toISOString(), businessDate: day(m.businessDate), type,
      description: m.kind === "TRANSFER" ? `${m.description} (${m.account.name} → ${m.toAccount?.name ?? "?"})` : m.description,
      party: null, reference: m.reference ?? m.number, room: null, amount: incoming ? m.amount : -m.amount, by: m.createdBy.fullName, byId: m.createdBy.id,
      href: null, related: m.number, proof: m.attachmentFileId ? `/api/files/${m.attachmentFileId}` : null, counted: m.status === "POSTED", note: m.status === "REVERSED" ? `Reversed: ${m.reversalReason ?? ""}` : null,
    });
  }
  return rows.sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.at.localeCompare(a.at));
}

export const sumIn = (rows: ActivityRow[]) => rows.filter((r) => r.counted && r.amount > 0).reduce((s, r) => s + r.amount, 0);
export const sumOut = (rows: ActivityRow[]) => rows.filter((r) => r.counted && r.amount < 0).reduce((s, r) => s - r.amount, 0);

/** Recorded money in / out and number of transactions per account for a period (activity — not a bank balance). */
export async function accountSummaries(from: string, to: string) {
  const bd = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
  const [accounts, posted, pays, revs, sales, exps, entries, transfersIn] = await Promise.all([
    db.moneyAccount.findMany({ orderBy: { sortOrder: "asc" } }),
    db.payment.groupBy({ by: ["accountId", "kind"], where: { businessDate: bd, status: "POSTED" }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["accountId", "kind"], where: { businessDate: bd }, _sum: { amount: true }, _count: true }),
    db.payment.groupBy({ by: ["accountId", "kind"], where: { status: "REVERSED", reversalBusinessDate: bd }, _sum: { amount: true }, _count: true }),
    db.revenueTransaction.groupBy({ by: ["accountId"], where: { businessDate: bd, isVoided: false }, _sum: { amount: true }, _count: true }),
    db.expense.groupBy({ by: ["accountId"], where: { businessDate: bd, status: { in: ["RECORDED", "APPROVED"] } }, _sum: { amount: true }, _count: true }),
    db.ledgerEntry.groupBy({ by: ["accountId", "kind"], where: { businessDate: bd, status: "POSTED" }, _sum: { amount: true }, _count: true }),
    db.ledgerEntry.groupBy({ by: ["toAccountId"], where: { businessDate: bd, status: "POSTED", kind: "TRANSFER" }, _sum: { amount: true }, _count: true }),
  ]);
  // received = money from customers that still stands (payments + sales − refunds), like "Money received".
  const map = new Map(accounts.map((a) => [a.id, { moneyIn: 0, moneyOut: 0, count: 0, received: 0 }]));
  for (const p of posted) { const t = map.get(p.accountId); if (t) t.received += (p.kind === "PAYMENT" ? 1 : -1) * (p._sum.amount ?? 0); }
  const add = (id: string | null | undefined, dir: "in" | "out", amount: number | null, count: number) => {
    const t = id ? map.get(id) : undefined;
    if (!t) return;
    if (dir === "in") t.moneyIn += amount ?? 0; else t.moneyOut += amount ?? 0;
    t.count += count;
  };
  for (const p of pays) add(p.accountId, p.kind === "PAYMENT" ? "in" : "out", p._sum.amount, p._count);
  for (const p of revs) add(p.accountId, p.kind === "PAYMENT" ? "out" : "in", p._sum.amount, p._count);
  for (const s of sales) { add(s.accountId, "in", s._sum.amount, s._count); const t = map.get(s.accountId); if (t) t.received += s._sum.amount ?? 0; }
  for (const e of exps) add(e.accountId, "out", e._sum.amount, e._count);
  for (const e of entries) add(e.accountId, ["OWNER_CONTRIBUTION", "OTHER_INCOME", "ADJUSTMENT_IN"].includes(e.kind) ? "in" : "out", e._sum.amount, e._count);
  for (const t of transfersIn) add(t.toAccountId, "in", t._sum.amount, t._count);
  // When each account last moved (all time), for "3 days ago".
  const [lp, ls, le, lm] = await Promise.all([
    db.payment.groupBy({ by: ["accountId"], _max: { receivedAt: true } }),
    db.revenueTransaction.groupBy({ by: ["accountId"], _max: { occurredAt: true } }),
    db.expense.groupBy({ by: ["accountId"], _max: { spentAt: true } }),
    db.ledgerEntry.groupBy({ by: ["accountId"], _max: { occurredAt: true } }),
  ]);
  const last = new Map<string, number>();
  const seen = (id: string | null, d: Date | null) => { if (id && d) last.set(id, Math.max(last.get(id) ?? 0, d.getTime())); };
  lp.forEach((x) => seen(x.accountId, x._max.receivedAt)); ls.forEach((x) => seen(x.accountId, x._max.occurredAt));
  le.forEach((x) => seen(x.accountId, x._max.spentAt)); lm.forEach((x) => seen(x.accountId, x._max.occurredAt));
  return accounts.map((a) => ({ ...a, ...map.get(a.id)!, lastAt: last.has(a.id) ? new Date(last.get(a.id)!) : null }));
}

// ───────────────────────── Admin: add / edit / deactivate ─────────────────────────

export interface AccountInput {
  id?: string | null; name: string; kind: MoneyAccountKind; accountNumber?: string | null; holderName?: string | null;
  acceptsPayments: boolean; acceptsExpenses: boolean; isActive: boolean;
}

/**
 * Add or edit a payment account. Accounts are never deleted — an account with
 * history is deactivated: it disappears from new payments but its past stays linked.
 */
export async function savePaymentAccount(input: AccountInput, actor: { userId: string; label?: string; ipAddress?: string | null }) {
  const name = input.name.trim();
  if (name.length < 2) throw new AppError("Give the account a name.", "VALIDATION", { name: "Required" });
  const data = {
    name, kind: input.kind, accountNumber: input.accountNumber?.trim() || null, holderName: input.holderName?.trim() || null,
    acceptsPayments: input.acceptsPayments, acceptsExpenses: input.acceptsExpenses, isActive: input.isActive,
  };
  return db.$transaction(async (tx) => {
    const clash = await tx.moneyAccount.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(input.id ? { id: { not: input.id } } : {}) } });
    if (clash) throw new AppError(`There is already an account called ${clash.name}.`, "VALIDATION", { name: "Duplicate" });
    if (input.id) {
      const before = await tx.moneyAccount.findUnique({ where: { id: input.id } });
      if (!before) throw new AppError("Account not found.", "NOT_FOUND");
      if (!data.isActive || !data.acceptsPayments) {
        const others = await tx.moneyAccount.count({ where: { id: { not: before.id }, isActive: true, acceptsPayments: true } });
        if (others === 0) throw new AppError("At least one active account must receive payments.");
      }
      const after = await tx.moneyAccount.update({ where: { id: before.id }, data });
      await audit(tx, actor, {
        action: "payment_account.updated", entityType: "MoneyAccount", entityId: before.id,
        before: { name: before.name, kind: before.kind, accountNumber: before.accountNumber, holderName: before.holderName, acceptsPayments: before.acceptsPayments, acceptsExpenses: before.acceptsExpenses, isActive: before.isActive },
        after: data,
      });
      return after;
    }
    const code = `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "ACCOUNT"}_${Date.now().toString(36).toUpperCase()}`;
    const last = await tx.moneyAccount.aggregate({ _max: { sortOrder: true } });
    const created = await tx.moneyAccount.create({ data: { ...data, code, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
    await audit(tx, actor, { action: "payment_account.created", entityType: "MoneyAccount", entityId: created.id, after: data });
    return created;
  });
}
