import "server-only";
import { CASH_HANDOVER_ON } from "@/lib/cash-handover";
import { db, type Tx } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { getSettings, getSettingsTx, businessDayConfig } from "../settings";
import { businessDateOf, businessRangeBounds, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { postMovementTx } from "./finance";
import { msg, msgf } from "@/i18n/msg";
import type { CashHandoverStatus, ShiftDepartment } from "@/generated/prisma/enums";

/**
 * CASH HANDOVER — the cash a person collected from customers, handed to Finance.
 *
 * It is a custody record, not a payment: every cash receipt was already counted when it was recorded (payment,
 * restaurant payment or sale), so handing it over adds no revenue and no receipt, and never changes a guest's
 * payment. Each handover covers one person's cash records in [periodStart, periodEnd); the next one starts where
 * the last one ended, so the same cash cannot be handed over twice. What the person says they hand over, what the
 * Finance says arrived and the difference are kept apart. A short or over handover is recorded as it is — the
 * books are corrected only by the existing authorised flows (cash count, ledger adjustment), never automatically.
 * Only cash accounts count; mobile money, bank and card are already in their own accounts.
 */

export type HandoverActor = AuditActor & { userId: string; permissions: ReadonlySet<string> };
type Client = Tx | typeof db;

const MIN_REASON = 5;
const MAX_AMOUNT = 2_000_000_000;

function need(actor: HandoverActor, code: string) {
  if (!actor.permissions.has(code)) throw new AppError("You do not have permission to do this.", "FORBIDDEN");
}
function amountOf(n: unknown, field: string): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) throw new AppError("Enter the amount as a whole number of shillings.", "VALIDATION", { [field]: msg("Invalid") });
  return n;
}
function reasonOf(text: string | null | undefined, what: string) {
  const r = (text ?? "").trim();
  if (r.length < MIN_REASON) throw new AppError(msgf("Say why ({what}) — at least {n} letters.", { what, n: MIN_REASON }), "VALIDATION", { note: msg("Required") });
  return r;
}

// ───────────────────────── The cash a person recorded ─────────────────────────

export type CashRecord = {
  id: string;
  source: "ROOM" | "RESTAURANT" | "SALE";
  at: Date;
  amount: number;
  /** Cash given back to a guest. */
  refund: boolean;
  /** False when the record was reversed or voided: shown, never counted. */
  counted: boolean;
  party: string | null;
  reference: string | null;
  href: string | null;
  note: string | null;
};

/** Every cash record one person made in [start, end): room payments, restaurant payments and other sales, on cash accounts. */
export async function cashRecords(userId: string, start: Date, end: Date, c: Client = db): Promise<CashRecord[]> {
  const cash = { account: { kind: "CASH" as const } };
  const payInclude = { reservation: { select: { id: true, reference: true, guest: { select: { fullName: true } } } } };
  const [own, credited, restaurant, sales] = await Promise.all([
    c.payment.findMany({ where: { recordedById: userId, creditedToId: null, createdAt: { gte: start, lt: end }, ...cash }, include: payInclude }),
    // Paid online before arriving, credited to the receptionist who checked the guest in: not cash by nature, but kept in step with Collections.
    c.payment.findMany({ where: { creditedToId: userId, creditedAt: { gte: start, lt: end }, ...cash }, include: payInclude }),
    c.restaurantOrderPayment.findMany({
      where: { collectedById: userId, collectedAt: { gte: start, lt: end }, ...cash },
      include: { order: { select: { number: true, customerName: true, roomNumber: true, tableLabel: true } } },
    }),
    c.revenueTransaction.findMany({ where: { recordedById: userId, orderPaymentId: null, createdAt: { gte: start, lt: end }, ...cash } }),
  ]);
  const rows: CashRecord[] = [];
  for (const p of [...own, ...credited]) {
    rows.push({
      id: p.id, source: "ROOM", at: p.createdAt, amount: p.amount, refund: p.kind === "REFUND", counted: p.status === "POSTED",
      party: p.reservation?.guest.fullName ?? null, reference: p.reference ?? p.reservation?.reference ?? null,
      href: p.reservation ? `/staff/reservations/${p.reservation.id}` : null, note: p.status === "REVERSED" ? (p.reversalReason ?? null) : null,
    });
  }
  for (const p of restaurant) {
    const place = p.order.roomNumber ? `Room ${p.order.roomNumber}` : p.order.tableLabel;
    rows.push({
      id: p.id, source: "RESTAURANT", at: p.collectedAt, amount: p.amount, refund: false, counted: p.status === "POSTED",
      party: p.order.customerName ?? place ?? null, reference: p.order.number, href: null, note: p.status === "POSTED" ? null : (p.reverseReason ?? null),
    });
  }
  for (const s of sales) {
    rows.push({ id: s.id, source: "SALE", at: s.createdAt, amount: s.amount, refund: false, counted: !s.isVoided, party: null, reference: null, href: null, note: s.description ?? null });
  }
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** What the counted records add up to: cash collected, cash refunded, and the cash that should be handed over. */
export function totalsOf(rows: CashRecord[]) {
  const counted = rows.filter((r) => r.counted);
  const collected = counted.filter((r) => !r.refund).reduce((s, r) => s + r.amount, 0);
  const refunds = counted.filter((r) => r.refund).reduce((s, r) => s + r.amount, 0);
  return { collected, refunds, expected: collected - refunds, count: counted.filter((r) => !r.refund).length };
}

/** The cash a person has not handed over yet runs from the end of their last live handover (or the day the control began) to now. */
async function windowFor(c: Client, userId: string, now: Date) {
  const last = await c.cashHandover.aggregate({ where: { submittedById: userId, status: { not: "REJECTED" } }, _max: { periodEnd: true } });
  const settings = c === db ? await getSettings() : await getSettingsTx(c as Tx);
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  const dayStart = businessRangeBounds(today, today, cfg).start;
  const start = last._max.periodEnd ?? settings.cashHandoverFrom ?? settings.liveSince ?? dayStart;
  return { start, end: now };
}

/** The drawer account handovers are anchored to: the first active cash account. */
async function cashAccount(c: Client) {
  const a = await c.moneyAccount.findFirst({ where: { kind: "CASH", isActive: true }, orderBy: { sortOrder: "asc" } });
  if (!a) throw new AppError("There is no active cash account. Ask the administrator to set one up.");
  return a;
}

// ───────────────────────── What the person sees before handing over ─────────────────────────

export const handoverInclude = {
  submittedBy: { select: { id: true, fullName: true } },
  reviewedBy: { select: { id: true, fullName: true } },
  account: { select: { id: true, name: true } },
  toAccount: { select: { id: true, name: true } },
} as const;

/** The reconciliation summary shown before "Submit cash handover": what was collected, refunded and expected since the last one. */
export async function previewHandover(userId: string) {
  const now = new Date();
  const w = await windowFor(db, userId, now);
  const rows = await cashRecords(userId, w.start, w.end);
  const [open, recent] = await Promise.all([
    db.cashHandover.findMany({ where: { submittedById: userId, status: { in: ["SUBMITTED", "RETURNED"] } }, orderBy: { submittedAt: "desc" }, include: handoverInclude }),
    db.cashHandover.findMany({ where: { submittedById: userId, status: { in: ["ACCEPTED", "REJECTED"] } }, orderBy: { submittedAt: "desc" }, take: 5, include: handoverInclude }),
  ]);
  return { start: w.start, end: w.end, rows, ...totalsOf(rows), open, recent };
}
export type HandoverPreview = Awaited<ReturnType<typeof previewHandover>>;

// ───────────────────────── Submitting ─────────────────────────

async function nextNumber(tx: Tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('cash_handover_number'))::text`;
  const n = await tx.cashHandover.count();
  return `CH-${String(n + 1).padStart(6, "0")}`;
}

const event = (tx: Tx, handoverId: string, kind: string, byId: string, note?: string | null, amount?: number | null) =>
  tx.cashHandoverEvent.create({ data: { handoverId, kind, byId, note: note?.trim() || null, amount: amount ?? null } });

/** A difference between what should be handed over and what is handed over must be explained. */
function explainDifference(expected: number, declared: number, note: string | null | undefined) {
  if (expected === declared) return (note ?? "").trim() || null;
  const amount = Math.abs(declared - expected).toLocaleString("en-US");
  const text = (note ?? "").trim();
  if (text.length < MIN_REASON) {
    throw new AppError(
      declared < expected ? msgf("You are handing over TZS {amount} less than the cash recorded. Explain the difference.", { amount }) : msgf("You are handing over TZS {amount} more than the cash recorded. Explain the difference.", { amount }),
      "VALIDATION", { note: msg("Required") },
    );
  }
  return text;
}

/** Hand over the cash recorded since the last handover. Counted by the person, received later by Finance. */
export async function submitHandover(input: { declared: number; note?: string | null }, actor: HandoverActor) {
  if (!CASH_HANDOVER_ON) throw new AppError("Cash handover is switched off for now.", "CONFLICT");
  need(actor, "cash.handover.submit");
  const declared = amountOf(input.declared, "declared");
  return db.$transaction(async (tx) => {
    // One handover at a time per person: a double tap finds an empty window and is refused.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-handover:${actor.userId}`}))::text`;
    const now = new Date();
    const w = await windowFor(tx, actor.userId, now);
    if (w.end.getTime() <= w.start.getTime()) throw new AppError("There is nothing to hand over yet.");
    const rows = await cashRecords(actor.userId, w.start, w.end, tx);
    const t = totalsOf(rows);
    if (!rows.some((r) => r.counted)) throw new AppError("You have no cash to hand over — no cash was recorded since your last handover.");
    if (t.expected < 0) throw new AppError("The cash refunded is more than the cash collected in this period. Ask Finance.");
    const note = explainDifference(t.expected, declared, input.note);
    const [account, shift, settings] = await Promise.all([
      cashAccount(tx),
      tx.actualShift.findFirst({ where: { userId: actor.userId, startedAt: { lte: now } }, orderBy: { startedAt: "desc" }, select: { id: true } }),
      getSettingsTx(tx),
    ]);
    // The shared Restaurant Counter hands over as the restaurant; everyone else as the front desk.
    const department: ShiftDepartment = actor.permissions.has("restaurant.device") ? "RESTAURANT" : "RECEPTION";
    const h = await tx.cashHandover.create({
      data: {
        number: await nextNumber(tx), department, submittedById: actor.userId, shiftId: shift?.id ?? null, accountId: account.id,
        periodStart: w.start, periodEnd: w.end, businessDate: toDbDate(businessDateOf(now, businessDayConfig(settings))),
        collected: t.collected, collectedCount: t.count, refunds: t.refunds, expected: t.expected, declared, declaredNote: note, submittedAt: now,
      },
    });
    await event(tx, h.id, "SUBMITTED", actor.userId, note, declared);
    await audit(tx, actor, {
      action: "cash_handover.submitted", entityType: "CashHandover", entityId: h.id,
      after: { number: h.number, department, collected: t.collected, refunds: t.refunds, expected: t.expected, declared, difference: declared - t.expected, from: w.start, to: w.end },
    });
    return h;
  });
}

/** A handover sent back is corrected and sent again: the same period, the cash counted again from the records as they are now. */
export async function resubmitHandover(id: string, input: { declared: number; note?: string | null }, actor: HandoverActor) {
  if (!CASH_HANDOVER_ON) throw new AppError("Cash handover is switched off for now.", "CONFLICT");
  need(actor, "cash.handover.submit");
  const declared = amountOf(input.declared, "declared");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-handover:${actor.userId}`}))::text`;
    const h = await tx.cashHandover.findUnique({ where: { id } });
    if (!h || h.submittedById !== actor.userId) throw new AppError("Handover not found.", "NOT_FOUND");
    if (h.status !== "RETURNED") throw new AppError("Only a handover that was sent back can be sent again.");
    const rows = await cashRecords(actor.userId, h.periodStart, h.periodEnd, tx);
    const t = totalsOf(rows);
    if (t.expected < 0) throw new AppError("The cash refunded is more than the cash collected in this period. Ask Finance.");
    const note = explainDifference(t.expected, declared, input.note);
    const done = await tx.cashHandover.updateMany({
      where: { id, status: "RETURNED" },
      data: {
        status: "SUBMITTED", collected: t.collected, collectedCount: t.count, refunds: t.refunds, expected: t.expected, declared, declaredNote: note, submittedAt: new Date(),
        received: null, difference: null, reviewedById: null, reviewedAt: null, reviewNote: null,
      },
    });
    if (done.count !== 1) throw new AppError("This handover was already sent again.");
    await event(tx, id, "RESUBMITTED", actor.userId, note, declared);
    await audit(tx, actor, {
      action: "cash_handover.resubmitted", entityType: "CashHandover", entityId: id,
      before: { declared: h.declared, expected: h.expected }, after: { declared, expected: t.expected, difference: declared - t.expected },
    });
    return tx.cashHandover.findUniqueOrThrow({ where: { id } });
  });
}

// ───────────────────────── Finance receives it ─────────────────────────

function forReview(actor: HandoverActor) {
  need(actor, "cash.handover.review");
}

/**
 * Confirm what really arrived. The amount received is recorded as it is, with its difference from what was recorded;
 * a short or over handover needs a reason and the permission to accept it. Nobody receives their own handover.
 * When the cash goes into a different cash account than the one it was recorded in, a transfer (never revenue) is posted.
 */
export async function receiveHandover(id: string, input: { received: number; toAccountId?: string | null; note?: string | null }, actor: HandoverActor) {
  if (!CASH_HANDOVER_ON) throw new AppError("Cash handover is switched off for now.", "CONFLICT");
  forReview(actor);
  const received = amountOf(input.received, "received");
  return db.$transaction(async (tx) => {
    const h = await tx.cashHandover.findUnique({ where: { id } });
    if (!h) throw new AppError("Handover not found.", "NOT_FOUND");
    if (h.submittedById === actor.userId) throw new AppError("You cannot receive your own handover.", "FORBIDDEN");
    if (h.status !== "SUBMITTED") throw new AppError("This handover is not waiting to be received.");
    const difference = received - h.expected;
    const note = (input.note ?? "").trim() || null;
    if (difference !== 0) {
      need(actor, "cash.handover.discrepancy");
      const amount = Math.abs(difference).toLocaleString("en-US");
      if ((note ?? "").length < MIN_REASON) {
        throw new AppError(difference < 0 ? msgf("The cash received is short by TZS {amount}. Explain the difference.", { amount }) : msgf("The cash received is over by TZS {amount}. Explain the difference.", { amount }), "VALIDATION", { note: msg("Required") });
      }
    }
    const toAccountId = input.toAccountId || h.accountId;
    if (toAccountId !== h.accountId) {
      const to = await tx.moneyAccount.findUnique({ where: { id: toAccountId } });
      if (!to || !to.isActive || !["CASH", "PETTY_CASH"].includes(to.kind)) throw new AppError("Choose an active cash account for the cash received.", "VALIDATION", { toAccountId: msg("Invalid") });
    }
    // The status check is part of the update: two people pressing at once — only one wins.
    const now = new Date();
    const won = await tx.cashHandover.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { status: "ACCEPTED", received, difference, reviewedById: actor.userId, reviewedAt: now, reviewNote: note, toAccountId },
    });
    if (won.count !== 1) throw new AppError("This handover was already received.");
    let ledgerEntryId: string | null = null;
    if (toAccountId !== h.accountId && received > 0) {
      const entry = await postMovementTx(tx, {
        kind: "TRANSFER", amount: received, accountId: h.accountId, toAccountId, description: `Cash handover ${h.number} received`,
        reference: h.number, notes: note, createdById: actor.userId,
      }, actor);
      ledgerEntryId = entry.id;
      await tx.cashHandover.update({ where: { id }, data: { ledgerEntryId } });
    }
    await event(tx, id, "ACCEPTED", actor.userId, note, received);
    await audit(tx, actor, {
      action: "cash_handover.received", entityType: "CashHandover", entityId: id,
      before: { status: h.status, expected: h.expected, declared: h.declared }, after: { status: "ACCEPTED", received, difference, toAccountId, ledgerEntryId },
    });
    if (difference !== 0) {
      await audit(tx, actor, {
        action: "cash_handover.discrepancy", entityType: "CashHandover", entityId: id,
        after: { number: h.number, submittedById: h.submittedById, expected: h.expected, declared: h.declared, received, difference, reason: note },
      });
    }
    return tx.cashHandover.findUniqueOrThrow({ where: { id } });
  });
}

/** Send a handover back to the person to correct and send again; nothing was received. */
export async function returnHandover(id: string, reason: string, actor: HandoverActor) {
  if (!CASH_HANDOVER_ON) throw new AppError("Cash handover is switched off for now.", "CONFLICT");
  forReview(actor);
  const why = reasonOf(reason, "what to correct");
  return db.$transaction(async (tx) => {
    const h = await tx.cashHandover.findUnique({ where: { id } });
    if (!h) throw new AppError("Handover not found.", "NOT_FOUND");
    if (h.submittedById === actor.userId) throw new AppError("You cannot review your own handover.", "FORBIDDEN");
    const done = await tx.cashHandover.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "RETURNED", reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: why } });
    if (done.count !== 1) throw new AppError("This handover is not waiting to be received.");
    await event(tx, id, "RETURNED", actor.userId, why);
    await audit(tx, actor, { action: "cash_handover.returned", entityType: "CashHandover", entityId: id, before: { status: h.status, declared: h.declared, expected: h.expected }, after: { status: "RETURNED", reason: why } });
    return tx.cashHandover.findUniqueOrThrow({ where: { id } });
  });
}

/**
 * Refuse a handover for good (made by mistake, or a duplicate): its cash is "not handed over yet" again. Only the
 * person's latest handover can be refused, so no cash is ever left between two handovers — otherwise send it back.
 */
export async function rejectHandover(id: string, reason: string, actor: HandoverActor) {
  if (!CASH_HANDOVER_ON) throw new AppError("Cash handover is switched off for now.", "CONFLICT");
  forReview(actor);
  const why = reasonOf(reason, "why it is refused");
  return db.$transaction(async (tx) => {
    const h = await tx.cashHandover.findUnique({ where: { id } });
    if (!h) throw new AppError("Handover not found.", "NOT_FOUND");
    if (h.submittedById === actor.userId) throw new AppError("You cannot review your own handover.", "FORBIDDEN");
    if (h.status !== "SUBMITTED" && h.status !== "RETURNED") throw new AppError("This handover cannot be refused any more.");
    const later = await tx.cashHandover.count({ where: { submittedById: h.submittedById, status: { not: "REJECTED" }, periodStart: { gte: h.periodEnd } } });
    if (later > 0) throw new AppError("A later handover already follows this one. Send this one back instead of refusing it.");
    const done = await tx.cashHandover.updateMany({ where: { id, status: h.status }, data: { status: "REJECTED", reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: why } });
    if (done.count !== 1) throw new AppError("This handover was changed just now. Open it again.");
    await event(tx, id, "REJECTED", actor.userId, why);
    await audit(tx, actor, { action: "cash_handover.rejected", entityType: "CashHandover", entityId: id, before: { status: h.status, declared: h.declared, expected: h.expected }, after: { status: "REJECTED", reason: why } });
    return tx.cashHandover.findUniqueOrThrow({ where: { id } });
  });
}

// ───────────────────────── Reading ─────────────────────────

export type HandoverListFilter = { status?: CashHandoverStatus | null; from?: BusinessDate; to?: BusinessDate; submittedById?: string | null; take?: number };

export async function handoverList(f: HandoverListFilter = {}) {
  return db.cashHandover.findMany({
    where: {
      ...(f.status && { status: f.status }), ...(f.submittedById && { submittedById: f.submittedById }),
      ...(f.from && f.to && { businessDate: { gte: toDbDate(f.from), lte: toDbDate(f.to) } }),
    },
    orderBy: { submittedAt: "desc" }, take: f.take ?? 100, include: handoverInclude,
  });
}

/** One handover with its story and the cash records it covers — the records as they stand now, next to what was said when it was sent. */
export async function handoverDetail(id: string) {
  const h = await db.cashHandover.findUnique({
    where: { id },
    include: { ...handoverInclude, shift: { select: { id: true, startedAt: true, endedAt: true } }, events: { orderBy: { createdAt: "asc" }, include: { by: { select: { fullName: true } } } } },
  });
  if (!h) return null;
  const rows = await cashRecords(h.submittedById, h.periodStart, h.periodEnd);
  return { ...h, rows, now: totalsOf(rows) };
}
export type HandoverDetail = NonNullable<Awaited<ReturnType<typeof handoverDetail>>>;

/** Who still holds cash that was not handed over, and what is waiting to be received. */
export async function whoHoldsCash() {
  const now = new Date();
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  const since = settings.cashHandoverFrom ?? settings.liveSince ?? businessRangeBounds(today, today, cfg).start;
  const cash = { account: { kind: "CASH" as const } };
  const [rooms, credited, restaurant, sales] = await Promise.all([
    db.payment.findMany({ where: { createdAt: { gte: since }, ...cash }, distinct: ["recordedById"], select: { recordedById: true } }),
    db.payment.findMany({ where: { creditedAt: { gte: since }, creditedToId: { not: null }, ...cash }, distinct: ["creditedToId"], select: { creditedToId: true } }),
    db.restaurantOrderPayment.findMany({ where: { collectedAt: { gte: since }, collectedById: { not: null }, ...cash }, distinct: ["collectedById"], select: { collectedById: true } }),
    db.revenueTransaction.findMany({ where: { createdAt: { gte: since }, orderPaymentId: null, ...cash }, distinct: ["recordedById"], select: { recordedById: true } }),
  ]);
  const ids = new Set<string>([
    ...rooms.map((r) => r.recordedById), ...credited.map((r) => r.creditedToId!), ...restaurant.map((r) => r.collectedById!), ...sales.map((r) => r.recordedById),
  ]);
  const [users, waiting] = await Promise.all([
    // Whoever receives handovers (Finance, the Boss, the MD) already holds their own cash: it is not "with staff".
    db.user.findMany({ where: { id: { in: [...ids] }, role: { permissions: { none: { permission: { code: "cash.handover.review" } } } } }, select: { id: true, fullName: true, role: { select: { name: true } } } }),
    db.cashHandover.groupBy({ by: ["submittedById"], where: { status: "SUBMITTED" }, _sum: { declared: true, expected: true }, _count: true }),
  ]);
  const waitingOf = new Map(waiting.map((w) => [w.submittedById, w]));
  const people = await Promise.all(users.map(async (u) => {
    const w = await windowFor(db, u.id, now);
    const t = totalsOf(await cashRecords(u.id, w.start, w.end));
    const wait = waitingOf.get(u.id);
    return { userId: u.id, name: u.fullName, role: u.role.name, since: w.start, expected: t.expected, count: t.count, waitingCount: wait?._count ?? 0, waitingAmount: wait?._sum.expected ?? 0 };
  }));
  return people.filter((p) => p.expected > 0 || p.waitingCount > 0).sort((a, b) => b.expected - a.expected);
}
export type CashHolder = Awaited<ReturnType<typeof whoHoldsCash>>[number];

/** The handovers of a period: what waits, what was received (in the period it was received), and the differences. */
export async function handoverTotals(from: BusinessDate, to: BusinessDate) {
  const cfg = businessDayConfig(await getSettings());
  const { start, end } = businessRangeBounds(from, to, cfg);
  const [waiting, returned, accepted] = await Promise.all([
    db.cashHandover.aggregate({ where: { status: "SUBMITTED" }, _count: true, _sum: { declared: true, expected: true } }),
    db.cashHandover.count({ where: { status: "RETURNED" } }),
    db.cashHandover.findMany({ where: { status: "ACCEPTED", reviewedAt: { gte: start, lt: end } }, select: { received: true, expected: true, difference: true } }),
  ]);
  const diffs = accepted.map((a) => a.difference ?? 0);
  return {
    waitingCount: waiting._count, waitingExpected: waiting._sum.expected ?? 0, waitingDeclared: waiting._sum.declared ?? 0, returned,
    receivedCount: accepted.length, received: accepted.reduce((s, a) => s + (a.received ?? 0), 0), receivedExpected: accepted.reduce((s, a) => s + a.expected, 0),
    short: -diffs.filter((d) => d < 0).reduce((s, d) => s + d, 0), over: diffs.filter((d) => d > 0).reduce((s, d) => s + d, 0), withDifference: diffs.filter((d) => d !== 0).length,
  };
}
export type HandoverTotals = Awaited<ReturnType<typeof handoverTotals>>;
