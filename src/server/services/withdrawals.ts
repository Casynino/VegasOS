import "server-only";
import { db, type Tx } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { rateLimit } from "../rate-limit";
import { getSettings, businessDayConfig } from "../settings";
import { businessDateOf, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { accountBalances, postMovementTx, reverseMovementTx } from "./finance";
import { createProviderFeeExpenseTx, voidProviderFeeExpenseTx } from "./expenses";
import {
  createNtzsWithdrawal, getNtzsWithdrawal, ntzsEnabled, ntzsLive, ntzsPhone, quoteNtzsWithdrawal, readWithdrawal, withdrawalRefused, withdrawalStateOf,
  type NtzsDestination, type NtzsResult, type NtzsWithdrawal,
} from "./ntzs";
import type { Prisma, Withdrawal } from "@/generated/prisma/client";
import { msg, msgf } from "@/i18n/msg";
import {
  WITHDRAW_BANKS, WITHDRAW_MAX_TZS, WITHDRAW_MIN_TZS, WITHDRAWAL_FILTERS, WITHDRAWAL_IN_FLIGHT, WITHDRAWAL_LISTED, WITHDRAWAL_NOTES as N, WITHDRAWAL_SETUP_CODES,
  WITHDRAWAL_UNSETTLED, bankName, canSettleByHand, maskedDestination, withdrawalProblem, type WithdrawalStatusCode,
} from "@/lib/withdrawals";

/**
 * Withdraw funds — the Boss takes money out of the hotel's nTZS balance, from inside the portal.
 *
 * The path of one withdrawal: PRICE (nTZS's own quote: fee, registered name, balance — nothing moves) → the person
 * CONFIRMS → it is SENT to nTZS once (our record's id is the Idempotency-Key: sent twice, it is still one payout) →
 * the record follows what nTZS really says — its answer, its signed webhook, its status when asked. A request is never
 * a success by itself.
 *
 * The hotel's books are written exactly once, and only when nTZS confirms the money arrived: a movement out of the nTZS
 * account for what arrived (a transfer to a hotel account, or taken out by the owner — never revenue, never an
 * expense) and nTZS's fee as its own expense. If nTZS later takes the payout back, both are taken back.
 *
 * When nTZS gives no clear answer the record is "Not confirmed": nothing is sent again by itself, no new withdrawal
 * can be sent until it is settled, and only nTZS's own word — or, when nTZS cannot say, a person with the right to
 * reconcile — settles it.
 */

export type WithdrawalActor = AuditActor & { userId: string; permissions: ReadonlySet<string> };
type Via = "answer" | "webhook" | "check" | "sweep";

/** nTZS itself (its answer, its webhook, the scheduled check) — never a person. */
const SYSTEM: AuditActor = { label: "nTZS" };
const TX = { timeout: 20_000, maxWait: 10_000 };
const MIN = 60_000;
/** A send with no answer after this long is "Not confirmed". */
const SUBMIT_GRACE_MS = 2 * MIN;
/** The same amount to the same destination is not sent twice within this long. */
const TWIN_WINDOW_MS = 10 * MIN;
/** Notes that only say "we are waiting / nobody knows yet" — dropped as soon as nTZS says more. */
const SOFT: string[] = [N.noAnswer, N.notFound, N.slow, N.reviewAgain, N.handButPending];

const fmt = (n: number) => `TZS ${n.toLocaleString("en-US")}`;
const cut = (s: string | null | undefined, max: number) => (s ? s.slice(0, max) : null);
/** nTZS's own code for a refusal (a 401 has none: "unauthorized"); never free text. */
const codeOf = (res: { status?: number; code?: string }) => (res.status === 401 ? "unauthorized" : res.code && /^[a-z0-9_]{2,60}$/.test(res.code) ? res.code : `http_${res.status ?? 0}`);
const destinationOf = (w: Pick<Withdrawal, "destinationKind" | "phone" | "bankCode" | "accountNumber">): NtzsDestination =>
  w.destinationKind === "BANK" ? { kind: "BANK", bankCode: w.bankCode ?? "", accountNumber: w.accountNumber ?? "" } : { kind: "PHONE", phone: w.phone ?? "" };
/** The whole number — only for the person confirming their own request (every other screen shows it masked). */
const fullDestination = (w: Pick<Withdrawal, "destinationKind" | "phone" | "bankCode" | "accountNumber">) =>
  w.destinationKind === "BANK" ? `${bankName(w.bankCode)} · ${w.accountNumber ?? ""}` : w.phone ? `0${w.phone.slice(3, 6)} ${w.phone.slice(6, 9)} ${w.phone.slice(9)}` : "";

function mustManage(actor: WithdrawalActor) {
  if (!actor.permissions.has("withdrawals.manage")) throw new AppError(msg("Only the Boss or the Admin can withdraw funds."), "FORBIDDEN");
}
function mustBeOn() {
  if (!ntzsEnabled()) throw new AppError(msg("Withdrawals are not switched on yet — the administrator has to connect the hotel's nTZS account."), "UNAVAILABLE");
}

async function lockRow(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "withdrawals" WHERE "id" = ${id} FOR UPDATE`;
  return tx.withdrawal.findUnique({ where: { id } });
}

/** WD-000001 — given when a withdrawal is sent (so the numbers have no gaps for prices nobody confirmed). */
async function nextWithdrawalNumber(tx: Tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('withdrawal_number'))::text`;
  const last = await tx.withdrawal.findFirst({ where: { number: { not: null } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last?.number ? Number(last.number.replace(/\D/g, "")) || 0 : 0;
  return `WD-${String(n + 1).padStart(6, "0")}`;
}

/** The record's notes for a person (one per line): some added, some dropped. */
function notes(row: Pick<Withdrawal, "attentionAt" | "attentionNote">, change: { add?: string[]; drop?: string[] }, now: Date) {
  const lines = (row.attentionNote ?? "").split("\n").filter((l) => l && !(change.drop ?? []).includes(l));
  for (const a of change.add ?? []) if (!lines.includes(a)) lines.push(a);
  return { attentionNote: lines.length ? lines.join("\n") : null, attentionAt: lines.length ? row.attentionAt ?? now : null };
}

// ───────────────────────── The books (once, only when nTZS confirmed) ─────────────────────────

/**
 * Write a confirmed withdrawal into the hotel's books: what arrived leaves the nTZS account (to the chosen hotel
 * account, or out to the owner), and nTZS's fee is an expense of its own. `w` = nTZS's figures (none when a person
 * settled it by hand: the fee is then the priced one, marked "not confirmed"). The caller holds the row's lock and
 * checked that nothing is booked yet.
 */
async function bookTx(tx: Tx, row: Withdrawal, number: string, w: NtzsWithdrawal | null, actor: AuditActor) {
  const ntzs = await tx.moneyAccount.findUnique({ where: { code: "NTZS" }, select: { id: true } });
  const net = w?.receiveTzs ?? row.amount;
  if (!ntzs || !Number.isInteger(net) || net <= 0) return { data: {} as Prisma.WithdrawalUncheckedUpdateInput, add: [N.noBooks] };
  const fee = w?.feeTzs ?? row.feeTzs ?? 0;
  const to = row.toAccountId && row.toAccountId !== ntzs.id ? row.toAccountId : null;
  const entry = await postMovementTx(tx, {
    kind: to ? "TRANSFER" : "OWNER_WITHDRAWAL", amount: net, accountId: ntzs.id, toAccountId: to,
    description: `Withdrawal ${number} from nTZS to ${maskedDestination(row)}`,
    reference: w?.payoutReference ?? row.payoutReference ?? number, notes: row.note, createdById: row.requestedById,
  }, actor);
  const expense = await createProviderFeeExpenseTx(tx, { amount: fee, accountId: ntzs.id, description: `nTZS fee — withdrawal ${number}`, payee: "nTZS", reference: number, createdById: row.requestedById }, actor);
  const data: Prisma.WithdrawalUncheckedUpdateInput = {
    ledgerEntryId: entry.id, feeExpenseId: expense?.id ?? null, feeTzs: fee, feeConfirmed: w?.feeTzs != null,
    debitedTzs: w?.debitTzs ?? net + fee, receivedTzs: net,
  };
  return { data, add: net !== row.amount ? [N.otherAmount] : [] };
}

/** Take a withdrawal back out of the books (nTZS returned it): the movement is reversed and the fee cancelled — both stay visible. */
async function unbookTx(tx: Tx, row: Pick<Withdrawal, "ledgerEntryId" | "feeExpenseId">, reason: string, actor: AuditActor) {
  if (row.ledgerEntryId) await reverseMovementTx(tx, row.ledgerEntryId, reason, actor);
  if (row.feeExpenseId) await voidProviderFeeExpenseTx(tx, row.feeExpenseId, reason, actor);
  return { ledgerEntryId: null, feeExpenseId: null } satisfies Prisma.WithdrawalUncheckedUpdateInput;
}

// ───────────────────────── What nTZS says → the record ─────────────────────────

/**
 * Bring a record to what nTZS says about it — the one place a withdrawal completes, fails or changes state on nTZS's
 * word. Safe to call any number of times with the same news (its answer, its webhook and a status check may all carry
 * it): the state changes once and the books are written once.
 */
export async function applyProviderState(id: string, w: NtzsWithdrawal, via: Via, actor: AuditActor = SYSTEM, now = new Date()): Promise<Withdrawal | null> {
  return db.$transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (!row) return null;
    const flag = async (line: string, extra: Record<string, unknown> = {}) => {
      const n = notes(row, { add: [line] }, now);
      if (n.attentionNote === row.attentionNote) return row;
      await audit(tx, actor, { action: "withdrawal.flagged", entityType: "Withdrawal", entityId: id, after: { note: line, via, ...extra } });
      return tx.withdrawal.update({ where: { id }, data: n });
    };
    // Another withdrawal at nTZS under our one request: never applied to this record — a person is told at once.
    if (w.id && row.providerId && w.id !== row.providerId) return flag(N.second, { ntzs: w.id });
    if (w.id && !row.providerId && (await tx.withdrawal.findFirst({ where: { providerId: w.id, id: { not: id } }, select: { id: true } }))) return flag(N.second, { ntzs: w.id });

    const from = row.status as WithdrawalStatusCode;
    const to = withdrawalStateOf(w);
    const number = row.number ?? (await nextWithdrawalNumber(tx));
    const data: Prisma.WithdrawalUncheckedUpdateInput = {
      providerId: row.providerId ?? (w.id || null), providerStatus: w.status || row.providerStatus, payoutStatus: w.payoutStatus || row.payoutStatus,
      payoutReference: w.payoutReference ?? row.payoutReference, payoutReceipt: w.payoutReceipt ?? row.payoutReceipt,
      providerMessage: cut(w.message ?? row.providerMessage, 500), payoutRail: w.payoutRail ?? row.payoutRail,
      recipientName: row.recipientName ?? w.recipientName, lastCheckedAt: now, number, submittedAt: row.submittedAt ?? now,
    };
    const add: string[] = [], drop: string[] = [];
    const events: { action: string; after: Record<string, unknown> }[] = [];
    const reference = w.payoutReference ?? row.payoutReference;

    if (to === "COMPLETED") {
      drop.push(...SOFT);
      if (["FAILED", "REJECTED", "CANCELLED", "QUOTED"].includes(from)) add.push(N.confirmedLate);
      Object.assign(data, { status: "COMPLETED", completedAt: row.completedAt ?? now, failedAt: null, failureCode: null, failureReason: null });
      let booked = false;
      if (!row.ledgerEntryId) {
        // Not in the books yet (also: completed earlier while the books could not be written) — write them now.
        const b = await bookTx(tx, row, number, w, actor);
        Object.assign(data, b.data); add.push(...b.add); booked = !!b.data.ledgerEntryId;
        if (booked) drop.push(N.noBooks);
      } else if (w.receiveTzs !== null && w.receiveTzs !== row.receivedTzs) {
        // Booked from a person's word and nTZS now gives the real figures: the books follow nTZS. Otherwise nTZS contradicts itself — a person looks.
        if (row.reconciledAt) {
          Object.assign(data, await unbookTx(tx, row, `nTZS confirmed other figures for withdrawal ${number}`, actor));
          const b = await bookTx(tx, row, number, w, actor);
          Object.assign(data, b.data); add.push(...b.add); booked = true;
        } else add.push(N.otherFigures);
      } else if (w.feeTzs !== null && w.feeTzs !== (row.feeTzs ?? 0)) {
        // The fee in the books was the price (an estimate) and nTZS confirmed another: the fee expense is replaced by the confirmed one.
        if (!row.feeConfirmed) {
          const ntzs = await tx.moneyAccount.findUnique({ where: { code: "NTZS" }, select: { id: true } });
          if (row.feeExpenseId) await voidProviderFeeExpenseTx(tx, row.feeExpenseId, `nTZS confirmed another fee for withdrawal ${number}`, actor);
          const expense = ntzs ? await createProviderFeeExpenseTx(tx, { amount: w.feeTzs, accountId: ntzs.id, description: `nTZS fee — withdrawal ${number}`, payee: "nTZS", reference: number, createdById: row.requestedById }, actor) : null;
          Object.assign(data, { feeExpenseId: expense?.id ?? null, feeTzs: w.feeTzs, feeConfirmed: true, debitedTzs: w.debitTzs ?? (row.receivedTzs ?? row.amount) + w.feeTzs });
          events.push({ action: "withdrawal.fee_corrected", after: { from: row.feeTzs, to: w.feeTzs, via } });
        } else add.push(N.otherFigures);
      } else if (w.feeTzs !== null && !row.feeConfirmed) {
        Object.assign(data, { feeConfirmed: true, debitedTzs: w.debitTzs ?? row.debitedTzs });
      }
      if (from !== "COMPLETED" || booked) events.push({ action: "withdrawal.completed", after: { from, via, number, received: data.receivedTzs ?? row.receivedTzs, fee: data.feeTzs ?? row.feeTzs, reference } });
    } else if (to === "FAILED") {
      if (!(from === "FAILED" && row.failureCode === "payout_failed")) {
        drop.push(...SOFT, N.noBooks, N.otherAmount);
        Object.assign(data, { status: "FAILED", failedAt: now, completedAt: null, failureCode: "payout_failed", failureReason: cut(w.payoutError ?? w.message, 300), debitedTzs: null, receivedTzs: null, feeConfirmed: false });
        if (row.ledgerEntryId) {
          Object.assign(data, await unbookTx(tx, row, `nTZS returned withdrawal ${number}`, actor));
          add.push(N.takenBack);
        }
        events.push({ action: "withdrawal.returned", after: { from, via, number, reason: cut(w.payoutError ?? w.message, 300), unbooked: !!row.ledgerEntryId } });
      }
    } else if (from === "COMPLETED") {
      // Completed stays completed on a "not finished" word: nTZS's own confirmation is never undone by an older message.
      if (row.reconciledAt && !row.providerId) add.push(N.handButPending);
      else if (to === "IN_REVIEW") add.push(N.reviewAgain);
    } else if (from === "FAILED" && row.failureCode === "payout_failed") {
      // nTZS said it failed; an older "on its way" message changes nothing.
    } else if (["FAILED", "REJECTED", "CANCELLED", "QUOTED"].includes(from)) {
      // Our record said nothing was sent, and nTZS has it: the record follows nTZS, and a person is told.
      add.push(N.confirmedLate);
      Object.assign(data, { status: to, failedAt: null, failureCode: null, failureReason: null });
      events.push({ action: "withdrawal.status_changed", after: { from, to, via } });
    } else {
      if (from === "SUBMITTING" || from === "UNKNOWN") { drop.push(N.noAnswer, N.notFound); Object.assign(data, { failureCode: null, failureReason: null }); }
      if (to !== "IN_REVIEW") drop.push(N.reviewAgain);
      if (from !== to) { data.status = to; events.push({ action: "withdrawal.status_changed", after: { from, to, via } }); }
    }

    const n = notes(row, { add, drop }, now);
    for (const line of add) if (!(row.attentionNote ?? "").split("\n").includes(line)) events.push({ action: "withdrawal.flagged", after: { note: line, via } });
    for (const e of events) await audit(tx, actor, { action: e.action, entityType: "Withdrawal", entityId: id, after: e.after });
    return tx.withdrawal.update({ where: { id }, data: { ...data, ...n } });
  }, TX);
}

/** "nTZS already has this request" with nothing more: it is on its way — the rest comes from nTZS's webhook or a check. */
const acceptedOnly = (providerId: string | null): NtzsWithdrawal => ({
  id: providerId ?? "", status: "pending", payoutStatus: "", receiveTzs: null, feeTzs: null, debitTzs: null, recipientName: null, payoutRail: null,
  payoutReference: null, payoutReceipt: null, payoutError: null, message: null, externalId: null, livemode: null,
});

/** A send with no clear answer: nobody knows whether nTZS took it. Never sent again by itself. */
async function markUnknown(id: string, why: { status?: number; code?: string; error?: string } | null, actor: AuditActor, now: Date) {
  return db.$transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (!row || row.status !== "SUBMITTING") return row;
    await audit(tx, actor, { action: "withdrawal.unconfirmed", entityType: "Withdrawal", entityId: id, after: { number: row.number, http: why?.status ?? null, code: why?.code ?? null } });
    return tx.withdrawal.update({ where: { id }, data: { status: "UNKNOWN", failureCode: "no_answer", failureReason: cut(why?.error, 300), ...notes(row, { add: [N.noAnswer] }, now) } });
  }, TX);
}

/** nTZS's answer to a send (the first one, or the same request asked again): accepted, refused, or unknown. */
async function afterSend(row: Withdrawal, res: NtzsResult<NtzsWithdrawal>, replay: boolean, actor: AuditActor, now: Date) {
  const id = row.id;
  if (res.ok) return applyProviderState(id, res.data, replay ? "check" : "answer", actor, now);
  if (res.code === "duplicate_withdrawal") {
    // nTZS already has this request (our key): read it back when nTZS names it, else it is simply on its way.
    const named = typeof res.details?.withdrawalId === "string" ? res.details.withdrawalId : null;
    const got = named ? await getNtzsWithdrawal(named) : null;
    const same = got?.ok && (!got.data.externalId || got.data.externalId === id) ? got.data : null;
    return applyProviderState(id, same ?? acceptedOnly(null), replay ? "check" : "answer", actor, now);
  }
  if (!replay && withdrawalRefused(res)) {
    // Refused on the first send: nTZS said no to the request itself — nothing moved.
    return db.$transaction(async (tx) => {
      const cur = await lockRow(tx, id);
      if (!cur || cur.status !== "SUBMITTING") return cur;
      await audit(tx, actor, { action: "withdrawal.refused", entityType: "Withdrawal", entityId: id, after: { number: cur.number, code: codeOf(res), http: res.status ?? null } });
      return tx.withdrawal.update({ where: { id }, data: { status: "REJECTED", failedAt: now, failureCode: codeOf(res), failureReason: cut(res.error, 300), debitedTzs: null, lastCheckedAt: now, ...notes(cur, { drop: SOFT }, now) } });
    }, TX);
  }
  if (!replay) return markUnknown(id, res, actor, now);
  // Asked again and nTZS said no, or did not answer. A "no" to the second asking does not prove the first was refused
  // (nTZS does not say in which order it checks), so the record stays "Not confirmed" — only now nTZS has been asked.
  return db.$transaction(async (tx) => {
    const cur = await lockRow(tx, id);
    if (!cur || cur.providerId) return cur;
    const answered = !!res.status;
    await audit(tx, actor, { action: "withdrawal.checked", entityType: "Withdrawal", entityId: id, after: { number: cur.number, answer: answered ? codeOf(res) : "no_answer" } });
    if (cur.status !== "UNKNOWN" || !answered) return tx.withdrawal.update({ where: { id }, data: { lastCheckedAt: now } });
    return tx.withdrawal.update({ where: { id }, data: { failureCode: "not_confirmed", lastCheckedAt: now, ...notes(cur, { add: [N.notFound], drop: [N.noAnswer] }, now) } });
  }, TX);
}

// ───────────────────────── Price → confirm → send ─────────────────────────

export interface PriceInput {
  /** What the recipient gets, whole TZS. */
  amount: number;
  destination: { kind: "PHONE"; phone: string } | { kind: "BANK"; bankCode: string; accountNumber: string } | { kind: "AGAIN"; withdrawalId: string };
  /** In the hotel's books: the hotel account the money goes to; none = the owner takes it out. */
  toAccountId: string | null;
  note?: string | null;
  /** The browser's key for this press (pressed twice, it is one request). */
  clientKey?: string | null;
}

export interface WithdrawalPrice {
  view: WithdrawalView;
  /** The whole number, for the confirmation only — so the person sees exactly who is paid. */
  destination: string;
  /** What nTZS says the recipient gets (to compare with what was asked). */
  receiveTzs: number | null;
}

async function resolveDestination(input: PriceInput["destination"]): Promise<NtzsDestination> {
  if (input.kind === "AGAIN") {
    const earlier = await db.withdrawal.findFirst({ where: { id: input.withdrawalId, OR: [{ failureCode: null }, { failureCode: { not: "balance_check" } }] }, select: { destinationKind: true, phone: true, bankCode: true, accountNumber: true } });
    if (!earlier) throw new AppError(msg("Choose where to send the money."), "VALIDATION", { destination: msg("Required") });
    return destinationOf(earlier);
  }
  if (input.kind === "PHONE") {
    const phone = ntzsPhone(input.phone);
    if (!phone) throw new AppError(msg("That phone number is not a Tanzanian mobile-money number."), "VALIDATION", { phone: msg("Check the number") });
    return { kind: "PHONE", phone };
  }
  const bankCode = WITHDRAW_BANKS.find((b) => b.code === input.bankCode)?.code;
  if (!bankCode) throw new AppError(msg("Choose the bank."), "VALIDATION", { bankCode: msg("Required") });
  const accountNumber = (input.accountNumber ?? "").replace(/[\s-]/g, "");
  if (!/^\d{6,20}$/.test(accountNumber)) throw new AppError(msg("Enter the bank account number (digits only)."), "VALIDATION", { accountNumber: msg("Check the number") });
  return { kind: "BANK", bankCode, accountNumber };
}

/**
 * Step 1 — ask nTZS for the price of a withdrawal: its fee, the registered name of the recipient and the balance.
 * Nothing moves. The price is kept (valid a few minutes) for the person to confirm.
 */
export async function priceWithdrawal(input: PriceInput, actor: WithdrawalActor, now = new Date()): Promise<WithdrawalPrice> {
  mustManage(actor);
  mustBeOn();
  if (!Number.isInteger(input.amount) || input.amount < WITHDRAW_MIN_TZS) throw new AppError(msgf("The least nTZS pays out is {amount}.", { amount: fmt(WITHDRAW_MIN_TZS) }), "VALIDATION", { amount: msg("Too small") });
  if (input.amount > WITHDRAW_MAX_TZS) throw new AppError(msg("This is more than nTZS pays out in one withdrawal — use a smaller amount."), "VALIDATION", { amount: msg("Too large") });
  const destination = await resolveDestination(input.destination);
  let toAccountId: string | null = null;
  if (input.toAccountId) {
    const account = await db.moneyAccount.findUnique({ where: { id: input.toAccountId }, select: { id: true, code: true, isActive: true } });
    if (!account || !account.isActive || account.code === "NTZS") throw new AppError(msg("Choose a hotel account for the books, or that the owner takes the money out."), "VALIDATION", { toAccountId: msg("Choose another") });
    toAccountId = account.id;
  }
  const clientKey = input.clientKey && /^[A-Za-z0-9_-]{8,64}$/.test(input.clientKey) ? input.clientKey : null;
  const again = async () => {
    const twin = clientKey ? await db.withdrawal.findUnique({ where: { clientKey }, include }) : null;
    if (twin && twin.requestedById !== actor.userId) throw new AppError(msg("Start the withdrawal again."), "CONFLICT");
    return twin ? { view: toView(twin, now, actor), destination: fullDestination(twin), receiveTzs: twin.amount } : null;
  };
  const before = await again();
  if (before) return before;
  await mustBeSettled();
  await rateLimit(`wd-quote:${actor.userId}`, 20, 600);

  const res = await quoteNtzsWithdrawal({ amountTzs: input.amount, destination });
  const base = {
    amount: input.amount, destinationKind: destination.kind, phone: destination.kind === "PHONE" ? destination.phone : null,
    bankCode: destination.kind === "BANK" ? destination.bankCode : null, accountNumber: destination.kind === "BANK" ? destination.accountNumber : null,
    toAccountId, note: cut(input.note?.trim(), 300), requestedById: actor.userId, livemode: ntzsLive(),
    businessDate: toDbDate(businessDateOf(now, businessDayConfig(await getSettings()))),
  } satisfies Prisma.WithdrawalUncheckedCreateInput;
  const notEnough = (available: number | null) =>
    new AppError(available === null ? withdrawalProblem("insufficient_balance")! : msgf("There is not enough money at nTZS: {available} is there, and {amount} plus nTZS's fee is needed.", { available: fmt(available), amount: fmt(input.amount) }), "VALIDATION", { amount: msg("More than the balance") });

  if (!res.ok) {
    // No answer at all: nothing was asked of nTZS that could move money — and nothing is kept.
    if (!res.status) throw new AppError(msg("nTZS did not answer — nothing was sent. Try again in a moment."), "UNAVAILABLE");
    const code = codeOf(res);
    const said = typeof res.details?.available === "number" && res.details.available >= 0 ? Math.round(res.details.available) : null;
    // Kept (never sent): what stands in the way of withdrawals, or the balance nTZS just told us.
    if (code === "insufficient_balance" || WITHDRAWAL_SETUP_CODES.includes(code)) {
      await db.withdrawal.create({ data: { ...base, status: "CANCELLED", failureCode: code, failureReason: cut(res.error, 300), availableTzs: code === "insufficient_balance" ? said : null } });
    }
    if (code === "insufficient_balance") throw notEnough(said);
    throw new AppError(withdrawalProblem(code) ?? msgf("nTZS refused this request ({code}).", { code }), WITHDRAWAL_SETUP_CODES.includes(code) ? "UNAVAILABLE" : "VALIDATION");
  }
  const q = res.data;
  if (!q.quoteId || q.sufficient === false) {
    await db.withdrawal.create({ data: { ...base, status: "CANCELLED", failureCode: "insufficient_balance", availableTzs: q.availableTzs } });
    throw notEnough(q.availableTzs);
  }
  try {
    const row = await db.$transaction(async (tx) => {
      const created = await tx.withdrawal.create({
        data: {
          ...base, clientKey, status: "QUOTED", quoteId: q.quoteId, quoteExpiresAt: q.expiresAt ?? new Date(now.getTime() + 5 * MIN),
          feeTzs: q.feeTzs, feeConfirmed: false, debitedTzs: q.debitTzs, recipientName: cut(q.recipientName, 200), payoutRail: q.payoutRail,
          availableTzs: q.availableTzs, needsApproval: q.requiresApproval,
        },
        include,
      });
      await audit(tx, actor, { action: "withdrawal.quoted", entityType: "Withdrawal", entityId: created.id, after: { amount: created.amount, fee: created.feeTzs, destination: maskedDestination(created), name: created.recipientName, books: toAccountId ?? "owner" } });
      return created;
    }, TX);
    return { view: toView(row, now, actor), destination: fullDestination(row), receiveTzs: q.receiveTzs };
  } catch (e) {
    const twin = isUniqueViolation(e) ? await again() : null;
    if (twin) return twin;
    throw e;
  }
}

/** No new withdrawal while one is still unclear: its money may already be on its way. */
async function mustBeSettled(exceptId?: string, client: Tx | typeof db = db) {
  const open = await client.withdrawal.findFirst({ where: { status: { in: WITHDRAWAL_UNSETTLED }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { number: true, status: true } });
  if (!open) return;
  // Still on its way to nTZS (seconds): simply wait. No clear answer: it has to be settled first.
  if (open.status === "SUBMITTING") throw new AppError(msgf("Withdrawal {number} is being sent to nTZS right now. Wait a moment, then try again.", { number: open.number ?? "" }), "CONFLICT");
  throw new AppError(msgf("Withdrawal {number} has not been confirmed by nTZS yet. It has to be settled before another one is sent.", { number: open.number ?? "" }), "CONFLICT");
}

/** The person goes back from the confirmation: the price is dropped (nothing was sent). */
export async function cancelWithdrawalPrice(id: string, actor: WithdrawalActor) {
  mustManage(actor);
  await db.withdrawal.updateMany({ where: { id, status: "QUOTED", requestedById: actor.userId }, data: { status: "CANCELLED", failureCode: "cancelled" } });
}

/**
 * Step 2 — the person confirms: the withdrawal is sent to nTZS, once. Pressed twice (or from two tabs) it is still one
 * send: the record is locked, and only a priced record can be sent. What comes back is the record as nTZS's answer
 * left it — on its way, completed, refused, or not confirmed. Never "successful" before nTZS says so.
 */
export async function confirmWithdrawal(id: string, actor: WithdrawalActor, now = new Date()): Promise<WithdrawalView> {
  mustManage(actor);
  mustBeOn();
  await rateLimit(`wd-send:${actor.userId}`, 6, 600);
  const step = await db.$transaction(async (tx) => {
    // One withdrawal is sent at a time, hotel-wide: two people (or two tabs) confirming at once go one after the other.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ntzs_withdrawal'))::text`;
    const row = await lockRow(tx, id);
    if (!row) throw new AppError(msg("That withdrawal was not found."), "NOT_FOUND");
    if (row.requestedById !== actor.userId) throw new AppError(msg("Only the person who priced this withdrawal can send it."), "FORBIDDEN");
    if (row.status !== "QUOTED") return { send: null, stale: false };
    if (!row.quoteId || !row.quoteExpiresAt || row.quoteExpiresAt.getTime() - now.getTime() < 15_000) {
      await tx.withdrawal.update({ where: { id }, data: { status: "CANCELLED", failureCode: "quote_stale" } });
      return { send: null, stale: true };
    }
    await mustBeSettled(id, tx);
    const twin = await tx.withdrawal.findFirst({
      where: {
        id: { not: id }, amount: row.amount, destinationKind: row.destinationKind, phone: row.phone, bankCode: row.bankCode, accountNumber: row.accountNumber,
        submittedAt: { gte: new Date(now.getTime() - TWIN_WINDOW_MS) }, status: { in: [...WITHDRAWAL_IN_FLIGHT, "COMPLETED"] },
      },
      select: { number: true },
    });
    if (twin) throw new AppError(msgf("The same amount was sent to this destination a few minutes ago ({number}). Wait ten minutes before sending it again.", { number: twin.number ?? "" }), "CONFLICT");
    const number = await nextWithdrawalNumber(tx);
    const sent = await tx.withdrawal.update({ where: { id }, data: { status: "SUBMITTING", submittedAt: now, number } });
    await audit(tx, actor, { action: "withdrawal.submitted", entityType: "Withdrawal", entityId: id, after: { number, amount: row.amount, fee: row.feeTzs, destination: maskedDestination(row), name: row.recipientName } });
    return { send: sent, stale: false };
  }, TX);
  if (step.stale) throw new AppError(withdrawalProblem("quote_stale")!, "CONFLICT");
  if (step.send) {
    // Outside the transaction: the record already says "Sending", so a crash here leaves a trace that is never sent twice.
    const row = step.send;
    const res = await createNtzsWithdrawal({ amountTzs: row.amount, destination: destinationOf(row), quoteId: row.quoteId!, reference: row.id, name: row.recipientName });
    try {
      await afterSend(row, res, false, actor, now);
    } catch (e) {
      // nTZS answered but the record could not be updated: it stays "Sending" and becomes "Not confirmed" — nTZS's webhook or a check settles it.
      console.error("[withdrawals] could not record nTZS's answer", row.id, e);
    }
  }
  return withdrawalView(id, actor, now);
}

// ───────────────────────── Asking nTZS again ─────────────────────────

/** When a withdrawal with no nTZS id may be asked about again: once its price has surely run out, so asking can never start a payout. */
const checkAfterOf = (row: Pick<Withdrawal, "providerId" | "submittedAt" | "quoteExpiresAt">) =>
  row.providerId || !row.submittedAt ? null : new Date(Math.max(row.quoteExpiresAt?.getTime() ?? 0, row.submittedAt.getTime() + 5 * MIN) + MIN);

/**
 * "Check with nTZS" — a person asks for the state now. With nTZS's id: its status. Without one (nTZS never answered
 * the send): the very same request is asked again with the same key, which nTZS answers with the original outcome if
 * it has it — and which cannot start a payout, because the price has run out by then.
 */
export async function checkWithdrawal(id: string, actor: WithdrawalActor, now = new Date()): Promise<WithdrawalView> {
  mustManage(actor);
  mustBeOn();
  await rateLimit(`wd-check:${actor.userId}`, 30, 600);
  let row = await db.withdrawal.findUnique({ where: { id } });
  if (!row) throw new AppError(msg("That withdrawal was not found."), "NOT_FOUND");
  const busy = new AppError(msg("nTZS could not be asked just now. Try again in a moment."), "UNAVAILABLE");
  if (row.providerId) {
    const res = await getNtzsWithdrawal(row.providerId);
    if (!res.ok) { await db.withdrawal.update({ where: { id }, data: { lastCheckedAt: now } }); throw busy; }
    await applyProviderState(id, res.data, "check", actor, now);
    await audit(db, actor, { action: "withdrawal.checked", entityType: "Withdrawal", entityId: id, after: { number: row.number, answer: withdrawalStateOf(res.data) } });
    return withdrawalView(id, actor, now);
  }
  if (!WITHDRAWAL_IN_FLIGHT.includes(row.status as WithdrawalStatusCode) || !row.submittedAt || !row.quoteId) throw new AppError(msg("There is nothing to ask nTZS about this one."), "CONFLICT");
  if (row.status === "SUBMITTING") {
    if (now.getTime() - row.submittedAt.getTime() < SUBMIT_GRACE_MS) throw new AppError(msg("It is still being sent — wait a moment."), "CONFLICT");
    row = (await markUnknown(id, null, SYSTEM, now)) ?? row;
  }
  const after = checkAfterOf(row);
  if (after && now < after) throw new AppError(msg("nTZS can be asked again in a few minutes — its own report may arrive before that."), "CONFLICT");
  const res = await createNtzsWithdrawal({ amountTzs: row.amount, destination: destinationOf(row), quoteId: row.quoteId!, reference: row.id, name: row.recipientName });
  await afterSend(row, res, true, actor, now);
  if (!res.ok && !res.status) throw busy;
  return withdrawalView(id, actor, now);
}

/**
 * When nTZS cannot say: a person with the right to reconcile settles the record from what nTZS itself shows them —
 * "it arrived" (with nTZS's own reference) or "it was never sent". Only for a record nTZS left unclear for long enough
 * (see canSettleByHand), always with a reason, always in the audit trail — and nTZS's own word still wins afterwards.
 */
export async function settleWithdrawalByHand(id: string, input: { outcome: "ARRIVED" | "NOT_SENT"; reference?: string | null; note: string }, actor: WithdrawalActor, now = new Date()): Promise<WithdrawalView> {
  if (!actor.permissions.has("withdrawals.reconcile")) throw new AppError(msg("Only the Boss or the Admin can settle a withdrawal by hand."), "FORBIDDEN");
  const note = input.note.trim(), reference = (input.reference ?? "").trim();
  if (note.length < 5) throw new AppError(msg("Say how you know — what nTZS shows or told you."), "VALIDATION", { note: msg("Required") });
  if (input.outcome === "ARRIVED" && reference.length < 4) throw new AppError(msg("Enter nTZS's own reference for this payout."), "VALIDATION", { reference: msg("Required") });
  await db.$transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (!row) throw new AppError(msg("That withdrawal was not found."), "NOT_FOUND");
    if (!canSettleByHand(row, now)) throw new AppError(msg("This withdrawal cannot be settled by hand yet. Ask nTZS again first, and give its own report time to arrive."), "CONFLICT");
    const number = row.number ?? (await nextWithdrawalNumber(tx));
    const data: Prisma.WithdrawalUncheckedUpdateInput = { number, reconciledAt: now, reconciledById: actor.userId, reconciledNote: cut(note, 500), attentionAt: null, attentionNote: null };
    if (input.outcome === "ARRIVED") {
      Object.assign(data, { status: "COMPLETED", completedAt: now, failedAt: null, failureCode: null, failureReason: null, payoutReference: row.payoutReference ?? cut(reference, 120) });
      if (!row.ledgerEntryId) {
        const b = await bookTx(tx, { ...row, payoutReference: row.payoutReference ?? cut(reference, 120) }, number, null, actor);
        Object.assign(data, b.data, notes({ attentionAt: null, attentionNote: null }, { add: b.add }, now));
      }
    } else {
      Object.assign(data, { status: row.status === "UNKNOWN" ? "REJECTED" : "FAILED", failedAt: now, completedAt: null, failureCode: "settled_by_hand", failureReason: null, debitedTzs: null, receivedTzs: null });
    }
    await audit(tx, actor, { action: "withdrawal.reconciled_by_hand", entityType: "Withdrawal", entityId: id, before: { status: row.status }, after: { number, outcome: input.outcome, reference: reference || null, note } });
    await tx.withdrawal.update({ where: { id }, data });
  }, TX);
  return withdrawalView(id, actor, now);
}

/** A finished withdrawal's notes were read by a person: it no longer asks for attention (the notes stay in its history). */
export async function acknowledgeWithdrawal(id: string, actor: WithdrawalActor): Promise<void> {
  mustManage(actor);
  await db.$transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (!row?.attentionNote) return;
    if (!["COMPLETED", "FAILED", "REJECTED"].includes(row.status)) throw new AppError(msg("This withdrawal is not finished yet."), "CONFLICT");
    await audit(tx, actor, { action: "withdrawal.acknowledged", entityType: "Withdrawal", entityId: id, after: { notes: row.attentionNote.split("\n") } });
    await tx.withdrawal.update({ where: { id }, data: { attentionAt: null, attentionNote: null } });
  }, TX);
}

// ───────────────────────── nTZS's webhook and the scheduled check ─────────────────────────

/** nTZS's status when asked wins when it is final; else a final word in its signed webhook; else its status. */
function newest(asked: NtzsWithdrawal, hook: NtzsWithdrawal): NtzsWithdrawal {
  const a = withdrawalStateOf(asked), h = withdrawalStateOf(hook);
  const [first, second] = a !== "PROCESSING" && a !== "AWAITING_APPROVAL" ? [asked, hook] : h === "COMPLETED" || h === "FAILED" ? [hook, asked] : [asked, hook];
  const merged = { ...first } as Record<string, unknown>;
  for (const [k, v] of Object.entries(second)) if ((merged[k] === null || merged[k] === "") && k !== "status" && k !== "payoutStatus") merged[k] = v;
  return merged as unknown as NtzsWithdrawal;
}

/**
 * nTZS's signed `withdrawal.updated` (the route verified the signature). The record is found by nTZS's id or by our
 * own reference; nTZS is then asked for the state itself, and the record follows it. Repeated calls change nothing.
 * Throws when the record could not be updated — the route then answers with an error and nTZS calls again.
 */
export async function handleWithdrawalWebhook(data: unknown, now = new Date()): Promise<{ found: boolean; id?: string; status?: string; ignored?: string }> {
  const hook = readWithdrawal(data);
  const row = (hook.id ? await db.withdrawal.findUnique({ where: { providerId: hook.id } }) : null)
    ?? (hook.externalId && /^[a-z0-9]{20,40}$/i.test(hook.externalId) ? await db.withdrawal.findUnique({ where: { id: hook.externalId } }) : null);
  if (!row) return { found: false };
  // A test-mode message can never settle a real withdrawal.
  if (hook.livemode === false && row.livemode) return { found: true, id: row.id, status: row.status, ignored: "test-mode event for a live withdrawal" };
  const providerId = row.providerId ?? (hook.id || null);
  const asked = providerId ? await getNtzsWithdrawal(providerId) : null;
  const same = asked?.ok && (!asked.data.externalId || asked.data.externalId === row.id) ? asked.data : null;
  const after = await applyProviderState(row.id, same ? newest(same, hook) : hook, "webhook", SYSTEM, now);
  return { found: true, id: row.id, status: after?.status ?? row.status };
}

/**
 * The scheduled look at withdrawals that are not finished: a send with no answer becomes "Not confirmed"; a price
 * nobody confirmed is dropped; nTZS is asked for the state of those it accepted (never a new send); one that takes
 * too long is marked for a person. Bounded in time so it can run beside a page.
 */
export async function sweepWithdrawals(now = new Date(), deadline = Date.now() + 8_000) {
  const stale = await db.withdrawal.findMany({ where: { status: "SUBMITTING", submittedAt: { lt: new Date(now.getTime() - SUBMIT_GRACE_MS) } }, select: { id: true } });
  for (const s of stale) await markUnknown(s.id, null, SYSTEM, now).catch((e) => console.error("[withdrawals] sweep", s.id, e));
  await db.withdrawal.updateMany({ where: { status: "QUOTED", quoteExpiresAt: { lt: new Date(now.getTime() - 10 * MIN) } }, data: { status: "CANCELLED", failureCode: "quote_stale" } });

  // On its way for too long (a phone payout takes minutes; a bank's can take a working day).
  const slow = await db.withdrawal.findMany({
    where: {
      status: "PROCESSING",
      OR: [{ destinationKind: "PHONE", submittedAt: { lt: new Date(now.getTime() - 60 * MIN) } }, { submittedAt: { lt: new Date(now.getTime() - 24 * 60 * MIN) } }],
      AND: [{ OR: [{ attentionNote: null }, { NOT: { attentionNote: { contains: N.slow } } }] }],
    },
    select: { id: true },
  });
  for (const s of slow) {
    await db.$transaction(async (tx) => {
      const row = await lockRow(tx, s.id);
      if (!row || row.status !== "PROCESSING") return;
      await audit(tx, SYSTEM, { action: "withdrawal.flagged", entityType: "Withdrawal", entityId: s.id, after: { note: N.slow, via: "sweep" } });
      await tx.withdrawal.update({ where: { id: s.id }, data: notes(row, { add: [N.slow] }, now) });
    }, TX).catch((e) => console.error("[withdrawals] sweep", s.id, e));
  }

  const due = await db.withdrawal.findMany({
    where: { status: { in: WITHDRAWAL_IN_FLIGHT }, providerId: { not: null }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - 2 * MIN) } }] },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } }, take: 10,
  });
  for (const row of due) {
    if (Date.now() > deadline) break;
    // After a day, ask every half hour only.
    if (row.submittedAt && row.lastCheckedAt && now.getTime() - row.submittedAt.getTime() > 24 * 60 * MIN && now.getTime() - row.lastCheckedAt.getTime() < 30 * MIN) continue;
    const res = await getNtzsWithdrawal(row.providerId!);
    if (res.ok && (!res.data.externalId || res.data.externalId === row.id)) await applyProviderState(row.id, res.data, "sweep", SYSTEM, now).catch((e) => console.error("[withdrawals] sweep", row.id, e));
    else await db.withdrawal.update({ where: { id: row.id }, data: { lastCheckedAt: now } }).catch(() => null);
  }
}

/** The sweep, at most every two minutes and only when something is waiting (called where staff pages load). */
export async function sweepWithdrawalsIfDue(now = new Date()) {
  if (!ntzsEnabled()) return;
  const waiting = await db.withdrawal.count({ where: { OR: [{ status: { in: WITHDRAWAL_IN_FLIGHT } }, { status: "QUOTED", quoteExpiresAt: { lt: new Date(now.getTime() - 10 * MIN) } }] } });
  if (!waiting) return;
  try { await rateLimit("ntzs-wd-sweep", 1, 120); } catch { return; }
  await sweepWithdrawals(now, Date.now() + 8_000);
}

// ───────────────────────── The balance at nTZS ─────────────────────────

/** The destination "Check balance" asks with: the last one the hotel withdrew to — or none yet, and then the person gives a phone number to ask with. */
async function balanceCheckDestination() {
  return (await db.withdrawal.findFirst({ where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" } }))
    ?? (await db.withdrawal.findFirst({ where: { status: { in: ["QUOTED", ...WITHDRAWAL_LISTED] } }, orderBy: { createdAt: "desc" } }));
}
/** True when "Check balance" has nothing to ask with yet (no withdrawal was ever priced): it then asks for a phone number each time, until the first withdrawal is priced. */
export async function ntzsCheckNeedsPhone() {
  return !(await balanceCheckDestination());
}

/**
 * nTZS has no call for the balance alone: it tells it together with a price. "Check balance" therefore asks the price of its smallest
 * withdrawal to a destination the hotel used before (or, when there is none yet, to a phone number the person gives) — a price only,
 * nothing moves — and keeps the balance nTZS reported with it.
 */
export async function checkNtzsBalance(actor: WithdrawalActor, now = new Date(), opts: { phone?: string | null } = {}): Promise<{ availableTzs: number; at: Date }> {
  mustManage(actor);
  mustBeOn();
  const last = await balanceCheckDestination();
  // Nothing was ever priced, so there is no number to ask with: the person gives one (their own is fine). It is used for this question only —
  // nothing is sent to it, and it is never offered later as a place to pay out to.
  const destination = last ? destinationOf(last) : opts.phone?.trim() ? await resolveDestination({ kind: "PHONE", phone: opts.phone }) : null;
  if (!destination) throw new AppError(msg("nTZS tells the balance only together with a price. Give a phone number to ask with — nothing is sent to it."), "VALIDATION", { phone: msg("Required") });
  await rateLimit(`wd-balance:${actor.userId}`, 10, 600);
  const res = await quoteNtzsWithdrawal({ amountTzs: WITHDRAW_MIN_TZS, destination });
  let available: number | null = null;
  if (res.ok) available = res.data.availableTzs;
  else if (!res.status) throw new AppError(msg("nTZS did not answer — try again in a moment."), "UNAVAILABLE");
  else if (codeOf(res) === "insufficient_balance" && typeof res.details?.available === "number" && res.details.available >= 0) available = Math.round(res.details.available);
  else throw new AppError(withdrawalProblem(codeOf(res)) ?? msgf("nTZS refused this request ({code}).", { code: codeOf(res) }), "UNAVAILABLE");
  if (available === null) throw new AppError(msg("nTZS did not say the balance this time."), "UNAVAILABLE");
  await db.withdrawal.create({
    data: {
      status: "CANCELLED", failureCode: "balance_check", amount: WITHDRAW_MIN_TZS, destinationKind: destination.kind, phone: destination.kind === "PHONE" ? destination.phone : null,
      bankCode: destination.kind === "BANK" ? destination.bankCode : null, accountNumber: destination.kind === "BANK" ? destination.accountNumber : null,
      availableTzs: available, requestedById: actor.userId, livemode: ntzsLive(), businessDate: toDbDate(businessDateOf(now, businessDayConfig(await getSettings()))),
    },
  });
  return { availableTzs: available, at: now };
}

// ───────────────────────── What the screens show ─────────────────────────

const include = { requestedBy: { select: { fullName: true } }, toAccount: { select: { name: true } }, reconciledBy: { select: { fullName: true } } } as const;
type Row = Prisma.WithdrawalGetPayload<{ include: typeof include }>;

/** A withdrawal for a screen. The destination is always masked — the whole number never leaves the server here. */
export interface WithdrawalView {
  id: string;
  number: string | null;
  status: WithdrawalStatusCode;
  /** What the recipient was to get. */
  amount: number;
  feeTzs: number | null;
  /** nTZS confirmed the fee (false = its price, an estimate). */
  feeConfirmed: boolean;
  /** What leaves (or left) the nTZS balance: an estimate until nTZS confirms. */
  debitedTzs: number | null;
  /** What nTZS says arrived. */
  receivedTzs: number | null;
  destination: string;
  destinationKind: "PHONE" | "BANK";
  recipientName: string | null;
  needsApproval: boolean;
  quoteExpiresAt: Date | null;
  /** nTZS's own id and the payout network's reference. */
  providerId: string | null;
  payoutReference: string | null;
  requestedBy: string;
  createdAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  lastCheckedAt: Date | null;
  businessDate: BusinessDate;
  failureCode: string | null;
  /** nTZS's own words for a payout that failed (none otherwise). */
  failureReason: string | null;
  /** Notes for a person, in English (said in the reader's language where shown). */
  attention: string[];
  reconciled: { at: Date; by: string; note: string } | null;
  /** The hotel account it goes to in the books; none = taken out by the owner. */
  books: string | null;
  /** Written in the hotel's books. */
  booked: boolean;
  note: string | null;
  /** The balance nTZS reported when it priced this one. */
  availableTzs: number | null;
  /** Made with nTZS's test key — no real money moved. */
  test: boolean;
  canCheck: boolean;
  /** "Check with nTZS" opens at this time (none = now). */
  checkAfter: Date | null;
  canSettle: boolean;
  canAcknowledge: boolean;
}

function toView(row: Row, now: Date, actor: WithdrawalActor): WithdrawalView {
  const status = row.status as WithdrawalStatusCode;
  const inFlight = WITHDRAWAL_IN_FLIGHT.includes(status);
  return {
    id: row.id, number: row.number, status, amount: row.amount, feeTzs: row.feeTzs, feeConfirmed: row.feeConfirmed, debitedTzs: row.debitedTzs, receivedTzs: row.receivedTzs,
    destination: maskedDestination(row), destinationKind: row.destinationKind === "BANK" ? "BANK" : "PHONE", recipientName: row.recipientName,
    needsApproval: row.needsApproval, quoteExpiresAt: row.quoteExpiresAt, providerId: row.providerId, payoutReference: row.payoutReference,
    requestedBy: row.requestedBy.fullName, createdAt: row.createdAt, submittedAt: row.submittedAt, completedAt: row.completedAt, failedAt: row.failedAt, lastCheckedAt: row.lastCheckedAt,
    businessDate: fromDbDate(row.businessDate), failureCode: row.failureCode, failureReason: row.failureCode === "payout_failed" ? row.failureReason : null,
    attention: (row.attentionNote ?? "").split("\n").filter(Boolean),
    reconciled: row.reconciledAt ? { at: row.reconciledAt, by: row.reconciledBy?.fullName ?? "", note: row.reconciledNote ?? "" } : null,
    books: row.toAccount?.name ?? null, booked: !!row.ledgerEntryId, note: row.note, availableTzs: row.availableTzs, test: row.livemode === false,
    canCheck: row.providerId ? WITHDRAWAL_LISTED.includes(status) : inFlight && !!row.submittedAt && !!row.quoteId,
    checkAfter: inFlight ? (row.status === "SUBMITTING" && row.submittedAt ? new Date(Math.max(checkAfterOf(row)?.getTime() ?? 0, row.submittedAt.getTime() + SUBMIT_GRACE_MS)) : checkAfterOf(row)) : null,
    canSettle: actor.permissions.has("withdrawals.reconcile") && canSettleByHand(row, now),
    canAcknowledge: !!row.attentionNote && ["COMPLETED", "FAILED", "REJECTED"].includes(row.status),
  };
}

export async function withdrawalView(id: string, actor: WithdrawalActor, now = new Date()): Promise<WithdrawalView> {
  mustManage(actor);
  const row = await db.withdrawal.findUnique({ where: { id }, include });
  if (!row) throw new AppError(msg("That withdrawal was not found."), "NOT_FOUND");
  return toView(row, now, actor);
}

export interface WithdrawalHistoryLine { at: Date; action: string; by: string; to: string | null; note: string | null }

/** One withdrawal with its history (every step, who or what did it, when). */
export async function withdrawalDetail(id: string, actor: WithdrawalActor, now = new Date()): Promise<{ view: WithdrawalView; history: WithdrawalHistoryLine[] }> {
  const view = await withdrawalView(id, actor, now);
  const logs = await db.auditLog.findMany({ where: { entityType: "Withdrawal", entityId: id }, orderBy: { createdAt: "asc" }, take: 100, select: { createdAt: true, action: true, actorLabel: true, after: true, user: { select: { fullName: true } } } });
  const history = logs.map((l) => {
    const after = (l.after && typeof l.after === "object" && !Array.isArray(l.after) ? l.after : {}) as Record<string, unknown>;
    return { at: l.createdAt, action: l.action, by: l.user?.fullName ?? l.actorLabel ?? "", to: typeof after.to === "string" ? after.to : null, note: typeof after.note === "string" ? after.note : null };
  });
  return { view, history };
}

/** What the Withdraw funds button needs, wherever it stands: may one be sent now, and what the form offers. */
export interface WithdrawForm {
  /** The hotel's nTZS account is connected (its key is set on the server). */
  enabled: boolean;
  live: boolean;
  /** What stands in the way at nTZS, by its code (only the administrator can clear it) — from nTZS's latest answer. */
  setupProblem: string | null;
  /** A withdrawal nobody can confirm yet — no new one until it is settled. */
  unsettled: { id: string; number: string | null } | null;
  destinations: { id: string; label: string; name: string | null; kind: "PHONE" | "BANK" }[];
  accounts: { id: string; name: string }[];
  /** Where this person's last withdrawal went in the books ("owner", or an account id). */
  lastBooks: string | null;
}

export interface WithdrawalsOverview extends WithdrawForm {
  /** The balance nTZS last reported with a price, and when; `sentSince` = withdrawals sent after that. None = never reported. */
  balance: { availableTzs: number; at: Date; sentSince: number } | null;
  /** The nTZS account in the hotel's own books — the hotel's records, not nTZS's figure. */
  bookBalance: number | null;
  bookAccountId: string | null;
  inFlight: { count: number; total: number };
  period: { completed: number; withdrawn: number; fees: number; feesAllConfirmed: boolean; pending: number; failed: number };
  rows: WithdrawalView[];
  people: { id: string; name: string }[];
  canReconcile: boolean;
}

export interface WithdrawalFilters { from: BusinessDate; to: BusinessDate; status?: string | null; person?: string | null; q?: string | null }

async function withdrawForm(actor: WithdrawalActor): Promise<WithdrawForm> {
  const [latest, unsettled, recent, accounts, mine] = await Promise.all([
    db.withdrawal.findFirst({ orderBy: { createdAt: "desc" }, select: { failureCode: true } }),
    db.withdrawal.findFirst({ where: { status: { in: WITHDRAWAL_UNSETTLED } }, orderBy: { createdAt: "asc" }, select: { id: true, number: true } }),
    db.withdrawal.findMany({ where: { status: { in: ["COMPLETED", "PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW"] } }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, destinationKind: true, phone: true, bankCode: true, accountNumber: true, recipientName: true } }),
    db.moneyAccount.findMany({ where: { isActive: true, code: { not: "NTZS" } }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.withdrawal.findFirst({ where: { requestedById: actor.userId, status: { in: WITHDRAWAL_LISTED } }, orderBy: { createdAt: "desc" }, select: { toAccountId: true } }),
  ]);
  const seen = new Set<string>();
  const destinations: WithdrawForm["destinations"] = [];
  for (const d of recent) {
    const key = `${d.destinationKind}:${d.phone ?? ""}:${d.bankCode ?? ""}:${d.accountNumber ?? ""}`;
    if (seen.has(key) || destinations.length >= 5) continue;
    seen.add(key);
    destinations.push({ id: d.id, label: maskedDestination(d), name: d.recipientName, kind: d.destinationKind === "BANK" ? "BANK" : "PHONE" });
  }
  return {
    enabled: ntzsEnabled(), live: ntzsLive(),
    setupProblem: latest?.failureCode && WITHDRAWAL_SETUP_CODES.includes(latest.failureCode) ? latest.failureCode : null,
    unsettled: unsettled ?? null, destinations, accounts,
    lastBooks: mine ? mine.toAccountId ?? "owner" : null,
  };
}

/** What the nTZS account's own page shows about withdrawals: the form, and the latest ones. */
export interface AccountWithdrawals extends WithdrawForm {
  /** Those on their way first (however old), then those that ended in the last 24 hours, the latest ending first — a handful. The one nobody can confirm is not repeated here: it is said by itself. */
  latest: WithdrawalView[];
  /** Something was sent and is not finished: the page keeps asking. */
  following: boolean;
}

const ACCOUNT_PAGE_LATEST = 5;

/**
 * Withdraw funds from where the money is — the nTZS account's own page: the same form as the Withdraw funds page, and
 * what became of the latest withdrawals (one that failed leaves nothing in the account's transactions, so it is said
 * here). Only for those who may withdraw.
 */
export async function withdrawFromAccount(actor: WithdrawalActor, now = new Date()): Promise<AccountWithdrawals> {
  mustManage(actor);
  // "The last 24 hours" is counted from when a withdrawal ENDED: one that waited two days at nTZS and then failed is still said here.
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [form, flying, arrived, turnedBack] = await Promise.all([
    withdrawForm(actor),
    db.withdrawal.findMany({ where: { status: { in: WITHDRAWAL_IN_FLIGHT } }, orderBy: { createdAt: "desc" }, take: ACCOUNT_PAGE_LATEST + 1, include }),
    db.withdrawal.findMany({ where: { status: "COMPLETED", completedAt: { gte: since } }, orderBy: { completedAt: "desc" }, take: ACCOUNT_PAGE_LATEST, include }),
    db.withdrawal.findMany({ where: { status: { in: ["FAILED", "REJECTED"] }, failedAt: { gte: since } }, orderBy: { failedAt: "desc" }, take: ACCOUNT_PAGE_LATEST, include }),
  ]);
  const endedAt = (r: (typeof arrived)[number]) => (r.completedAt ?? r.failedAt ?? r.createdAt).getTime();
  const ended = [...arrived, ...turnedBack].sort((x, y) => endedAt(y) - endedAt(x));
  const latest = [...flying.filter((r) => r.id !== form.unsettled?.id), ...ended].slice(0, ACCOUNT_PAGE_LATEST);
  return { ...form, following: flying.length > 0, latest: latest.map((r) => toView(r, now, actor)) };
}

/** Everything the Withdraw funds page shows. Days are hotel days (04:00 → 04:00), by the day each withdrawal was asked for. */
export async function withdrawalsOverview(actor: WithdrawalActor, filters: WithdrawalFilters, now = new Date()): Promise<WithdrawalsOverview> {
  mustManage(actor);
  const range = { businessDate: { gte: toDbDate(filters.from), lte: toDbDate(filters.to) } };
  const group = WITHDRAWAL_FILTERS.find((f) => f.key === filters.status) ?? WITHDRAWAL_FILTERS[0];
  const q = (filters.q ?? "").trim().slice(0, 80);
  const asAmount = /^[\d,.\s]+$/.test(q) ? Number(q.replace(/[^\d]/g, "")) : NaN;
  const search: Prisma.WithdrawalWhereInput[] = q ? [{
    OR: [
      { number: { contains: q, mode: "insensitive" } }, { providerId: { contains: q, mode: "insensitive" } }, { payoutReference: { contains: q, mode: "insensitive" } },
      { recipientName: { contains: q, mode: "insensitive" } }, ...(Number.isSafeInteger(asAmount) && asAmount > 0 && asAmount <= 2_000_000_000 ? [{ amount: asAmount }] : []),
    ],
  }] : [];
  const [form, reported, balances, flight, byStatus, estimates, rows, people] = await Promise.all([
    withdrawForm(actor),
    db.withdrawal.findFirst({ where: { availableTzs: { not: null } }, orderBy: { createdAt: "desc" }, select: { availableTzs: true, createdAt: true } }),
    accountBalances(undefined, true),
    db.withdrawal.aggregate({ where: { status: { in: WITHDRAWAL_IN_FLIGHT } }, _count: { _all: true }, _sum: { amount: true } }),
    db.withdrawal.groupBy({ by: ["status"], where: { ...range, status: { in: WITHDRAWAL_LISTED } }, _count: { _all: true }, _sum: { amount: true, receivedTzs: true, feeTzs: true } }),
    db.withdrawal.count({ where: { ...range, status: "COMPLETED", feeConfirmed: false, feeTzs: { gt: 0 } } }),
    db.withdrawal.findMany({
      where: { ...range, status: { in: [...group.statuses] }, ...(filters.person ? { requestedById: filters.person } : {}), AND: search },
      orderBy: { createdAt: "desc" }, take: 200, include,
    }),
    db.withdrawal.findMany({ where: { status: { in: WITHDRAWAL_LISTED } }, distinct: ["requestedById"], select: { requestedBy: { select: { id: true, fullName: true } } } }),
  ]);
  const sentSince = reported ? await db.withdrawal.count({ where: { submittedAt: { gte: reported.createdAt }, status: { in: [...WITHDRAWAL_IN_FLIGHT, "COMPLETED"] } } }) : 0;
  const of = (...statuses: string[]) => byStatus.filter((s) => statuses.includes(s.status));
  const done = of("COMPLETED")[0];
  return {
    ...form,
    balance: reported && reported.availableTzs !== null ? { availableTzs: reported.availableTzs, at: reported.createdAt, sentSince } : null,
    bookBalance: balances.find((b) => b.code === "NTZS")?.balance ?? null, bookAccountId: balances.find((b) => b.code === "NTZS")?.id ?? null,
    inFlight: { count: flight._count._all, total: flight._sum.amount ?? 0 },
    period: {
      completed: done?._count._all ?? 0, withdrawn: done ? done._sum.receivedTzs ?? done._sum.amount ?? 0 : 0, fees: done?._sum.feeTzs ?? 0, feesAllConfirmed: estimates === 0,
      pending: of("SUBMITTING", "UNKNOWN", "PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW").reduce((n, s) => n + s._count._all, 0),
      failed: of("FAILED", "REJECTED").reduce((n, s) => n + s._count._all, 0),
    },
    rows: rows.map((r) => toView(r, now, actor)),
    people: people.map((p) => ({ id: p.requestedBy.id, name: p.requestedBy.fullName })).sort((a, b) => a.name.localeCompare(b.name)),
    canReconcile: actor.permissions.has("withdrawals.reconcile"),
  };
}
