import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { POST as ntzsWebhook } from "@/app/api/webhooks/ntzs/route";
import { accountBalances } from "@/server/services/finance";
import {
  acknowledgeWithdrawal, applyProviderState, cancelWithdrawalPrice, checkNtzsBalance, checkWithdrawal, confirmWithdrawal, handleWithdrawalWebhook, priceWithdrawal,
  settleWithdrawalByHand, sweepWithdrawals, withdrawalDetail, withdrawalsOverview, withdrawalView, withdrawFromAccount, type PriceInput, type WithdrawalActor,
} from "@/server/services/withdrawals";
import { WITHDRAWAL_NOTES as N } from "@/lib/withdrawals";
import { addDays, businessDateOf } from "@/lib/time/business-date";
import { resetBusinessData } from "../support/helpers";

/**
 * Withdraw funds (owner, 2026-10-12): the Boss takes money out of the hotel's nTZS balance from the portal. nTZS itself
 * is faked here — a small in-memory copy of its quote → withdraw → status calls with its Idempotency-Key rule — so no
 * real money moves. What is proven: who may withdraw, that a withdrawal is sent once, that only nTZS's own word makes
 * it a success, that the books are written once, and what happens when nTZS gives no clear answer.
 */
const ENV = { key: process.env.NTZS_API_KEY, secret: process.env.NTZS_WEBHOOK_SECRET, user: process.env.NTZS_USER_ID };
const FEE = 1_500;
const PHONE = "0712 345 678";
const MIN = 60_000;

interface FakeWithdrawal { id: string; status: string; payoutStatus: string; receiveAmountTzs: number; totalFeeTzs: number; burnAmountTzs: number; recipientName: string; payoutReference: string | null; externalId: string; payoutError?: string }
let balance = 0;
let quotes: Record<string, { amountTzs: number; expiresAt: number }> = {};
let byKey: Record<string, FakeWithdrawal> = {};
let byId: Record<string, FakeWithdrawal> = {};
/** Every POST /withdrawals the hotel made (its body and its Idempotency-Key). */
let sends: { key: string | null; body: Record<string, unknown> }[] = [];
let quoteCalls = 0;
/** What nTZS does with the next send: answer normally, take it and lose the answer, not take it and not answer, or a fixed answer. */
let nextSend: "ok" | "taken-no-answer" | "lost" | { status: number; body: unknown } = "ok";
let nextQuote: { status: number; body: unknown } | null = null;
let getFails = false;
/** The state nTZS gives a new withdrawal. */
let newState: { status: string; payoutStatus: string } = { status: "burned", payoutStatus: "pending" };
let clock = Date.now();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(async () => {
  await resetBusinessData();
  await db.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: "wd-" } }, { key: "ntzs-wd-sweep" }] } });
  process.env.NTZS_API_KEY = "ntzs_test_unit";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
  delete process.env.NTZS_USER_ID;
  balance = 2_000_000; quotes = {}; byKey = {}; byId = {}; sends = []; quoteCalls = 0; nextSend = "ok"; nextQuote = null; getFails = false;
  newState = { status: "burned", payoutStatus: "pending" };
  clock = Date.now();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.endsWith("/withdrawals/quote") && init?.method === "POST") {
      quoteCalls++;
      if (nextQuote) { const q = nextQuote; nextQuote = null; return json(q.body, q.status); }
      const amountTzs = Number(body.amountTzs);
      const sufficient = balance >= amountTzs + FEE;
      const quoteId = sufficient ? `q_${quoteCalls}` : null;
      if (quoteId) quotes[quoteId] = { amountTzs, expiresAt: clock + 5 * MIN };
      return json({
        quoteId, expiresAt: new Date(clock + 5 * MIN).toISOString(), receiveAmountTzs: amountTzs, totalFeeTzs: FEE, burnAmountTzs: amountTzs + FEE, recipientName: "JOHN M DOE", payoutRail: "mobile_money",
        fees: { totalFeeTzs: FEE }, balance: { availableTzs: balance, sufficient }, approval: { requiresApproval: amountTzs >= 1_000_000, secondApprovalThresholdTzs: 1_000_000 },
      });
    }
    if (url.endsWith("/withdrawals") && init?.method === "POST") {
      const key = new Headers(init.headers).get("Idempotency-Key");
      sends.push({ key, body });
      const mode = nextSend; nextSend = "ok";
      if (mode === "lost") throw new TypeError("fetch failed");
      if (typeof mode === "object") return json(mode.body, mode.status);
      // nTZS's rule: the same key gives the same withdrawal back — never a second payout.
      if (key && byKey[key]) return json(byKey[key], 200);
      const quote = quotes[String(body.quoteId)];
      if (!quote || quote.expiresAt < clock) return json({ error: "quote_stale", message: "The quote has expired" }, 409);
      const amountTzs = Number(body.amountTzs);
      const w: FakeWithdrawal = {
        id: `wd_${Object.keys(byId).length + 1}`, ...newState, receiveAmountTzs: amountTzs, totalFeeTzs: FEE, burnAmountTzs: amountTzs + FEE, recipientName: "JOHN M DOE",
        payoutReference: null, externalId: String((body.endUser as { reference?: string } | undefined)?.reference ?? ""),
      };
      byId[w.id] = w; if (key) byKey[key] = w;
      balance -= amountTzs + FEE;
      if (mode === "taken-no-answer") throw new TypeError("fetch failed");
      return json(w, 201);
    }
    const m = url.match(/\/withdrawals\/([^/?]+)$/);
    if (m && (!init?.method || init.method === "GET")) {
      if (getFails) return json({ error: "relayer_unavailable", message: "Try later" }, 503);
      return byId[m[1]] ? json(byId[m[1]]) : json({ error: "not_found", message: "Not found" }, 404);
    }
    return json({ error: "not_found", message: "Not found" }, 404);
  });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  for (const [name, value] of [["NTZS_API_KEY", ENV.key], ["NTZS_WEBHOOK_SECRET", ENV.secret], ["NTZS_USER_ID", ENV.user]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await resetBusinessData();
});

/** A real staff member with exactly their role's permissions, as the app builds them. */
async function actorOf(email: string): Promise<WithdrawalActor> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) };
}
const boss = () => actorOf("admin@vegas.test");
const toPhone = (amount: number, more: Partial<PriceInput> = {}): PriceInput => ({ amount, destination: { kind: "PHONE", phone: PHONE }, toAccountId: null, ...more });
const at = (ms: number) => new Date(clock + ms);

/** nTZS finishes a payout (as its network reports it). */
function finish(id: string, change: Partial<FakeWithdrawal>) {
  const before = byId[id];
  Object.assign(before, change);
  if ((change.status === "reverted" || change.payoutStatus === "reverted") && before) balance += before.burnAmountTzs;
}
/** nTZS's `withdrawal.updated` for one of its withdrawals. */
const hookOf = (w: FakeWithdrawal, more: Record<string, unknown> = {}) => ({
  withdrawalId: w.id, externalId: w.externalId, status: w.status, payoutStatus: w.payoutStatus, receiveAmountTzs: w.receiveAmountTzs, burnAmountTzs: w.burnAmountTzs,
  payoutReference: w.payoutReference, payoutProvider: "mobile_money", payoutError: w.payoutError ?? null, livemode: false, endUser: { reference: w.externalId }, ...more,
});
function signedWebhook(body: unknown, secret = "whsec_unit") {
  const raw = JSON.stringify(body), ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  return ntzsWebhook(new Request("http://hotel.test/api/webhooks/ntzs", { method: "POST", body: raw, headers: { "x-webhook-signature": sig, "x-webhook-timestamp": ts } }));
}
const ntzsBook = async () => (await accountBalances(undefined, true)).find((a) => a.code === "NTZS")!.balance;
const bookOf = async (code: string) => (await accountBalances(undefined, true)).find((a) => a.code === code)!.balance;
const rowOf = (id: string) => db.withdrawal.findUniqueOrThrow({ where: { id } });
const code = (p: Promise<unknown>) => p.then(() => "no error", (e: { code?: string }) => e.code ?? "error");

/** Price and confirm one withdrawal; returns the record's id. */
async function send(amount: number, more: Partial<PriceInput> = {}, now = at(0)) {
  const a = await boss();
  const priced = await priceWithdrawal(toPhone(amount, more), a, now);
  const view = await confirmWithdrawal(priced.view.id, a, now);
  return { id: view.id, view, actor: a };
}

describe("who may withdraw", () => {
  it("the Boss and the Admin hold both withdrawal permissions; the Accountant (owner, 2026-10-13) withdraws but cannot settle by hand", async () => {
    const holders = await db.rolePermission.findMany({ where: { permission: { code: { in: ["withdrawals.manage", "withdrawals.reconcile"] } } }, select: { role: { select: { code: true } }, permission: { select: { code: true } } } });
    const by = (code: string) => holders.filter((h) => h.permission.code === code).map((h) => h.role.code).sort();
    expect(by("withdrawals.manage")).toEqual(["ACCOUNTANT", "ADMIN", "OWNER"]);
    expect(by("withdrawals.reconcile")).toEqual(["ADMIN", "OWNER"]);
    expect(holders).toHaveLength(5);
  });

  it("reception, waiters and managers are refused on the server — for pricing, sending, checking, settling and even looking", async () => {
    const { id } = await send(50_000);
    const today = businessDateOf(new Date());
    for (const email of ["asha@vegas.test", "waiter@vegas.test", "manager@vegas.test", "chef@vegas.test"]) {
      const a = await actorOf(email);
      expect(await code(priceWithdrawal(toPhone(20_000), a)), email).toBe("FORBIDDEN");
      expect(await code(confirmWithdrawal(id, a)), email).toBe("FORBIDDEN");
      expect(await code(checkWithdrawal(id, a)), email).toBe("FORBIDDEN");
      expect(await code(checkNtzsBalance(a)), email).toBe("FORBIDDEN");
      expect(await code(settleWithdrawalByHand(id, { outcome: "NOT_SENT", note: "nTZS shows nothing" }, a)), email).toBe("FORBIDDEN");
      expect(await code(acknowledgeWithdrawal(id, a)), email).toBe("FORBIDDEN");
      expect(await code(cancelWithdrawalPrice(id, a)), email).toBe("FORBIDDEN");
      expect(await code(withdrawalView(id, a)), email).toBe("FORBIDDEN");
      expect(await code(withdrawalDetail(id, a)), email).toBe("FORBIDDEN");
      expect(await code(withdrawalsOverview(a, { from: today, to: today })), email).toBe("FORBIDDEN");
      // The nTZS account's page is open to managers — what it holds about withdrawals is not.
      expect(await code(withdrawFromAccount(a)), email).toBe("FORBIDDEN");
    }
    // Nothing more reached nTZS than the Boss's own one price and one send.
    expect(quoteCalls).toBe(1);
    expect(sends).toHaveLength(1);
  });

  it("another person cannot send a withdrawal somebody else priced", async () => {
    const a = await boss();
    const priced = await priceWithdrawal(toPhone(30_000), a);
    const manager = await actorOf("manager@vegas.test");
    const other: WithdrawalActor = { ...manager, permissions: new Set([...manager.permissions, "withdrawals.manage"]) };
    expect(await code(confirmWithdrawal(priced.view.id, other))).toBe("FORBIDDEN");
    expect(sends).toHaveLength(0);
  });

  it("without the hotel's nTZS key nothing can be priced or sent", async () => {
    delete process.env.NTZS_API_KEY;
    expect(await code(priceWithdrawal(toPhone(30_000), await boss()))).toBe("UNAVAILABLE");
    expect(quoteCalls).toBe(0);
  });
});

describe("what is checked before nTZS is asked", () => {
  it("amount, phone, bank and the books account are validated on the server", async () => {
    const a = await boss();
    const ntzs = await db.moneyAccount.findUniqueOrThrow({ where: { code: "NTZS" } });
    for (const input of [
      toPhone(4_999), toPhone(0), toPhone(-20_000), toPhone(10_000.5), toPhone(600_000_000),
      { ...toPhone(20_000), destination: { kind: "PHONE", phone: "12345" } },
      { ...toPhone(20_000), destination: { kind: "PHONE", phone: "0222 123 456" } },
      { ...toPhone(20_000), destination: { kind: "BANK", bankCode: "EQUITY", accountNumber: "0150123456700" } },
      { ...toPhone(20_000), destination: { kind: "BANK", bankCode: "CRDB", accountNumber: "12AB" } },
      { ...toPhone(20_000), destination: { kind: "AGAIN", withdrawalId: "nope" } },
      toPhone(20_000, { toAccountId: ntzs.id }), toPhone(20_000, { toAccountId: "acct_nope" }),
    ] as PriceInput[]) expect(await code(priceWithdrawal(input, a)), JSON.stringify(input)).toBe("VALIDATION");
    expect(quoteCalls).toBe(0);
    expect(await db.withdrawal.count()).toBe(0);
  });

  it("a bank account is sent to nTZS as bank code and account number, a phone as 255…", async () => {
    const a = await boss();
    const bank = await priceWithdrawal({ amount: 80_000, destination: { kind: "BANK", bankCode: "CRDB", accountNumber: "0150 1234-56700" }, toAccountId: null }, a);
    expect(bank.destination).toBe("CRDB Bank · 0150123456700");
    expect(bank.view.destination).toBe("CRDB Bank •••• 6700");
    await confirmWithdrawal(bank.view.id, a);
    expect(sends[0].body).toMatchObject({ amountTzs: 80_000, fromTreasury: true, bankCode: "CRDB", accountNumber: "0150123456700", quoteId: "q_1", endUser: { reference: bank.view.id } });
    expect(sends[0].body).not.toHaveProperty("allowDuplicate");
    expect(sends[0].key).toBe(bank.view.id);
  });

  it("not enough at nTZS: refused with the real figures, the balance nTZS reported is kept, nothing is sent", async () => {
    balance = 40_000;
    const a = await boss();
    const err = await priceWithdrawal(toPhone(50_000), a).catch((e) => e);
    expect(err.code).toBe("VALIDATION");
    expect(String(err.message)).toContain("40,000");
    // The same when nTZS answers with its error instead of a quote.
    nextQuote = { status: 402, body: { error: "insufficient_balance", message: "Insufficient balance", details: { available: 40_000, requested: 51_500, shortfall: 11_500 } } };
    expect(await code(priceWithdrawal(toPhone(50_000), a))).toBe("VALIDATION");
    const kept = await db.withdrawal.findMany();
    expect(kept.map((k) => [k.status, k.failureCode, k.availableTzs])).toEqual([["CANCELLED", "insufficient_balance", 40_000], ["CANCELLED", "insufficient_balance", 40_000]]);
    expect(sends).toHaveLength(0);
    const o = await withdrawalsOverview(a, { from: businessDateOf(new Date()), to: businessDateOf(new Date()) });
    expect(o.balance?.availableTzs).toBe(40_000);
    expect(o.rows).toHaveLength(0);
  });

  it("nTZS has not switched withdrawals on: said plainly, and the page knows only the administrator can clear it", async () => {
    const a = await boss();
    nextQuote = { status: 403, body: { error: "capability_required", message: "disbursements capability required" } };
    const err = await priceWithdrawal(toPhone(50_000), a).catch((e) => e);
    expect(err.code).toBe("UNAVAILABLE");
    expect(String(err.message)).toContain("not switched on");
    const today = businessDateOf(new Date());
    expect((await withdrawalsOverview(a, { from: today, to: today })).setupProblem).toBe("capability_required");
    // A wrong key (401 has no code) is told as the key — never the raw text.
    nextQuote = { status: 401, body: { error: "Unauthorized" } };
    const key = await priceWithdrawal(toPhone(50_000), a).catch((e) => e);
    expect(String(key.message)).toContain("key");
    expect(String(key.message)).not.toContain("NTZS_API_KEY");
    expect((await withdrawalsOverview(a, { from: today, to: today })).setupProblem).toBe("unauthorized");
    // Once a price works again, the problem is gone.
    await priceWithdrawal(toPhone(50_000), a);
    expect((await withdrawalsOverview(a, { from: today, to: today })).setupProblem).toBeNull();
  });

  it("nTZS does not answer the price: nothing is kept and nothing was sent", async () => {
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => { throw new TypeError("fetch failed"); });
    expect(await code(priceWithdrawal(toPhone(50_000), await boss()))).toBe("UNAVAILABLE");
    expect(await db.withdrawal.count()).toBe(0);
  });
});

describe("price → confirm → nTZS's word", () => {
  it("a price moves nothing; the confirmation shows who is paid, the fee as an estimate, and what leaves the balance", async () => {
    const a = await boss();
    const before = await ntzsBook();
    const p = await priceWithdrawal(toPhone(200_000, { note: "Weekly takings" }), a);
    expect(p.view).toMatchObject({ status: "QUOTED", number: null, amount: 200_000, feeTzs: FEE, feeConfirmed: false, debitedTzs: 201_500, recipientName: "JOHN M DOE", destination: "0712 ••• 678", availableTzs: 2_000_000, booked: false });
    expect(p.destination).toBe("0712 345 678");
    expect(p.receiveTzs).toBe(200_000);
    expect(sends).toHaveLength(0);
    expect(await ntzsBook()).toBe(before);
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it("sent once; 'on its way' is not a success and writes nothing in the books; nTZS's signed report completes it — once", async () => {
    const before = await ntzsBook();
    const { id, view, actor } = await send(200_000);
    expect(view).toMatchObject({ status: "PROCESSING", number: "WD-000001", providerId: "wd_1", booked: false, receivedTzs: null });
    expect(sends).toHaveLength(1);
    expect(await db.ledgerEntry.count()).toBe(0);
    expect(await db.expense.count()).toBe(0);
    expect(await ntzsBook()).toBe(before);

    finish("wd_1", { status: "paid", payoutStatus: "completed", payoutReference: "MPESA-7781" });
    const res = await signedWebhook({ type: "withdrawal.updated", data: hookOf(byId.wd_1) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "COMPLETED" });

    const done = await withdrawalView(id, actor);
    expect(done).toMatchObject({ status: "COMPLETED", receivedTzs: 200_000, feeTzs: FEE, feeConfirmed: true, debitedTzs: 201_500, payoutReference: "MPESA-7781", booked: true, books: null, attention: [] });
    const entries = await db.ledgerEntry.findMany();
    expect(entries.map((e) => [e.kind, e.status, e.amount, e.accountId, e.toAccountId])).toEqual([["OWNER_WITHDRAWAL", "POSTED", 200_000, "acct_ntzs", null]]);
    const fees = await db.expense.findMany({ include: { category: true } });
    expect(fees.map((f) => [f.amount, f.status, f.category.code, f.accountId])).toEqual([[FEE, "RECORDED", "BANK_FEES", "acct_ntzs"]]);
    expect(await ntzsBook()).toBe(before - 201_500);

    // The same report again, the status asked again, the scheduled check: nothing is written twice.
    await signedWebhook({ type: "withdrawal.updated", data: hookOf(byId.wd_1) });
    await signedWebhook({ type: "withdrawal.updated", data: hookOf(byId.wd_1) });
    await checkWithdrawal(id, actor);
    await sweepWithdrawals(new Date(Date.now() + 10 * MIN));
    expect(await db.ledgerEntry.count()).toBe(1);
    expect(await db.expense.count()).toBe(1);
    expect(await ntzsBook()).toBe(before - 201_500);
    expect(sends).toHaveLength(1);
    // A withdrawal is not revenue, and the amount is not an expense.
    expect(await db.revenueTransaction.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
  });

  it("moved to one of the hotel's own accounts: a transfer — the money arrives there, the fee stays with nTZS", async () => {
    const [ntzs, bank] = [await ntzsBook(), await bookOf("BANK")];
    const { id, actor } = await send(300_000, { toAccountId: "acct_bank" });
    finish("wd_1", { status: "paid", payoutStatus: "completed" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    expect((await withdrawalView(id, actor)).books).toBe("CRDB Bank");
    expect((await db.ledgerEntry.findFirstOrThrow()).kind).toBe("TRANSFER");
    expect(await bookOf("BANK")).toBe(bank + 300_000);
    expect(await ntzsBook()).toBe(ntzs - 301_500);
  });

  it("nTZS answers the send with 'paid' at once: completed and booked from the answer, and the later webhook adds nothing", async () => {
    newState = { status: "paid", payoutStatus: "completed" };
    const { id, view } = await send(60_000);
    expect(view).toMatchObject({ status: "COMPLETED", booked: true, feeConfirmed: true });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    expect(await db.ledgerEntry.count()).toBe(1);
    expect(await db.expense.count()).toBe(1);
    expect((await rowOf(id)).completedAt).not.toBeNull();
  });

  it("pressed twice, or from two tabs at once: one send, one withdrawal", async () => {
    const a = await boss();
    const p = await priceWithdrawal(toPhone(70_000, { clientKey: "press-0001" }), a);
    const again = await priceWithdrawal(toPhone(70_000, { clientKey: "press-0001" }), a);
    expect(again.view.id).toBe(p.view.id);
    expect(quoteCalls).toBe(1);
    const both = await Promise.all([confirmWithdrawal(p.view.id, a), confirmWithdrawal(p.view.id, a), confirmWithdrawal(p.view.id, a)]);
    expect(sends).toHaveLength(1);
    expect(Object.keys(byId)).toHaveLength(1);
    expect(new Set(both.map((b) => b.number))).toEqual(new Set(["WD-000001"]));
    // And once more later: still the same one.
    expect((await confirmWithdrawal(p.view.id, a)).status).toBe("PROCESSING");
    expect(sends).toHaveLength(1);
  });

  it("two different withdrawals confirmed at the same moment get their own numbers, and the same amount to the same number is stopped", async () => {
    const a = await boss();
    const one = await priceWithdrawal(toPhone(70_000), a), two = await priceWithdrawal(toPhone(90_000), a), twin = await priceWithdrawal(toPhone(70_000), a);
    // At the very same moment only one is sent at a time: the other is told to wait a moment, and then goes through.
    const first = await Promise.allSettled([confirmWithdrawal(one.view.id, a), confirmWithdrawal(two.view.id, a)]);
    const through = first.filter((f) => f.status === "fulfilled").length;
    expect(through).toBeGreaterThanOrEqual(1);
    expect(sends).toHaveLength(through);
    for (const f of first) if (f.status === "rejected") expect((f.reason as { code?: string }).code).toBe("CONFLICT");
    const done = [await confirmWithdrawal(one.view.id, a), await confirmWithdrawal(two.view.id, a)];
    expect(done.map((d) => d.status)).toEqual(["PROCESSING", "PROCESSING"]);
    expect(done.map((d) => d.number).sort()).toEqual(["WD-000001", "WD-000002"]);
    expect(await code(confirmWithdrawal(twin.view.id, a))).toBe("CONFLICT");
    expect(sends).toHaveLength(2);
    // Ten minutes later the same amount may be sent again (priced afresh).
    clock += 11 * MIN;
    const later = await priceWithdrawal(toPhone(70_000), a, at(0));
    expect((await confirmWithdrawal(later.view.id, a, at(0))).number).toBe("WD-000003");
  });

  it("a price that ran out is not sent: priced again instead", async () => {
    const a = await boss();
    const p = await priceWithdrawal(toPhone(70_000), a, at(0));
    expect(await code(confirmWithdrawal(p.view.id, a, at(5 * MIN)))).toBe("CONFLICT");
    expect(sends).toHaveLength(0);
    expect((await rowOf(p.view.id)).status).toBe("CANCELLED");
    // Pressed again: still nothing is sent.
    expect((await confirmWithdrawal(p.view.id, a, at(5 * MIN))).status).toBe("CANCELLED");
    expect(sends).toHaveLength(0);
  });

  it("the person goes back from the confirmation: the price is dropped and can no longer be sent", async () => {
    const a = await boss();
    const p = await priceWithdrawal(toPhone(70_000), a);
    await cancelWithdrawalPrice(p.view.id, a);
    expect((await confirmWithdrawal(p.view.id, a)).status).toBe("CANCELLED");
    expect(sends).toHaveLength(0);
  });

  it("nTZS refuses the send: 'Refused — nothing sent', nothing in the books, and another withdrawal may follow", async () => {
    const a = await boss();
    const p = await priceWithdrawal(toPhone(150_000), a);
    nextSend = { status: 403, body: { error: "kyb_required", message: "KYB approval required", details: { allowanceTzs: 100_000, usedTzs: 0 } } };
    const v = await confirmWithdrawal(p.view.id, a);
    expect(v).toMatchObject({ status: "REJECTED", failureCode: "kyb_required", failureReason: null, booked: false, debitedTzs: null, number: "WD-000001" });
    expect(await db.ledgerEntry.count()).toBe(0);
    const next = await priceWithdrawal(toPhone(60_000), a);
    expect((await confirmWithdrawal(next.view.id, a)).status).toBe("PROCESSING");
  });

  it("large withdrawals wait for nTZS's own approval; one nTZS cannot confirm is 'being checked' — neither is a success", async () => {
    newState = { status: "requested", payoutStatus: "" };
    const { id, view, actor } = await send(1_200_000);
    expect(view).toMatchObject({ status: "AWAITING_APPROVAL", needsApproval: true, booked: false });
    finish("wd_1", { status: "burned", payoutStatus: "reconcile_required" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    expect((await withdrawalView(id, actor)).status).toBe("IN_REVIEW");
    expect(await db.ledgerEntry.count()).toBe(0);
    // nTZS's operator resolves it: its webhook fires again.
    finish("wd_1", { status: "paid", payoutStatus: "completed" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    expect((await withdrawalView(id, actor)).status).toBe("COMPLETED");
    expect(await db.ledgerEntry.count()).toBe(1);
  });

  it("the payout fails: 'Failed — money returned' with nTZS's own reason, and nothing was ever in the books", async () => {
    const before = await ntzsBook();
    const { id, actor } = await send(90_000);
    finish("wd_1", { status: "reverted", payoutStatus: "reverted", payoutError: "Subscriber not registered" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    const v = await withdrawalView(id, actor);
    expect(v).toMatchObject({ status: "FAILED", failureCode: "payout_failed", failureReason: "Subscriber not registered", booked: false, receivedTzs: null });
    expect(await db.ledgerEntry.count()).toBe(0);
    expect(await ntzsBook()).toBe(before);
    // An older "on its way" message arriving late changes nothing.
    await applyProviderState(id, { id: "wd_1", status: "burned", payoutStatus: "pending", receiveTzs: 90_000, feeTzs: FEE, debitTzs: 91_500, recipientName: null, payoutRail: null, payoutReference: null, payoutReceipt: null, payoutError: null, message: null, externalId: id, livemode: false }, "webhook");
    expect((await rowOf(id)).status).toBe("FAILED");
  });

  it("nTZS takes back a payout it had confirmed: the movement is reversed, the fee cancelled, and a person is told", async () => {
    const before = await ntzsBook();
    const { id, actor } = await send(120_000);
    finish("wd_1", { status: "paid", payoutStatus: "completed" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    expect(await ntzsBook()).toBe(before - 121_500);
    finish("wd_1", { status: "reverted", payoutStatus: "reverted", payoutError: "Reversed by the network" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    const v = await withdrawalView(id, actor);
    expect(v).toMatchObject({ status: "FAILED", booked: false, attention: [N.takenBack], canAcknowledge: true });
    expect((await db.ledgerEntry.findMany()).map((e) => e.status)).toEqual(["REVERSED"]);
    expect((await db.expense.findMany()).map((e) => e.status)).toEqual(["VOIDED"]);
    expect(await ntzsBook()).toBe(before);
    await acknowledgeWithdrawal(id, actor);
    expect((await withdrawalView(id, actor)).attention).toEqual([]);
  });

  it("nTZS confirms a different amount or fee than its price: the books follow what nTZS confirmed", async () => {
    const before = await ntzsBook();
    const { id, actor } = await send(100_000);
    finish("wd_1", { status: "paid", payoutStatus: "completed", receiveAmountTzs: 99_000, totalFeeTzs: 2_000, burnAmountTzs: 101_000 });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    const v = await withdrawalView(id, actor);
    expect(v).toMatchObject({ status: "COMPLETED", amount: 100_000, receivedTzs: 99_000, feeTzs: 2_000, debitedTzs: 101_000, attention: [N.otherAmount] });
    expect(await ntzsBook()).toBe(before - 101_000);
  });
});

describe("nTZS's webhook", () => {
  it("only a correctly signed message is believed", async () => {
    const { id } = await send(50_000);
    finish("wd_1", { status: "paid", payoutStatus: "completed" });
    const body = { type: "withdrawal.updated", data: hookOf(byId.wd_1) };
    const unsigned = await ntzsWebhook(new Request("http://hotel.test/api/webhooks/ntzs", { method: "POST", body: JSON.stringify(body) }));
    expect(unsigned.status).toBe(401);
    expect((await signedWebhook(body, "whsec_someone_else")).status).toBe(401);
    const raw = JSON.stringify(body), old = String(Math.floor(Date.now() / 1000) - 3_600);
    const stale = await ntzsWebhook(new Request("http://hotel.test/api/webhooks/ntzs", { method: "POST", body: raw, headers: { "x-webhook-signature": createHmac("sha256", "whsec_unit").update(`${old}.${raw}`).digest("hex"), "x-webhook-timestamp": old } }));
    expect(stale.status).toBe(401);
    expect((await rowOf(id)).status).toBe("PROCESSING");
    expect(await db.ledgerEntry.count()).toBe(0);
    expect((await signedWebhook(body)).status).toBe(200);
    expect((await rowOf(id)).status).toBe("COMPLETED");
  });

  it("a signed message cannot claim more than nTZS itself says when asked", async () => {
    const { id } = await send(50_000);
    // The message says "completed", but nTZS's own status is still "on its way": completed wins only as nTZS's final word…
    await signedWebhook({ type: "withdrawal.updated", data: hookOf(byId.wd_1, { status: "paid", payoutStatus: "completed" }) });
    expect((await rowOf(id)).status).toBe("COMPLETED");
    // …and a message about a withdrawal that is not ours changes nothing.
    const other = await signedWebhook({ type: "withdrawal.updated", data: { withdrawalId: "wd_other", externalId: "someone-else", status: "paid", payoutStatus: "completed", receiveAmountTzs: 999_999 } });
    expect(await other.json()).toMatchObject({ ok: true, ignored: "unknown withdrawal" });
    expect(await db.ledgerEntry.count()).toBe(1);
  });

  it("when nTZS cannot be asked, its signed message is still applied", async () => {
    const { id } = await send(50_000);
    finish("wd_1", { status: "paid", payoutStatus: "completed" });
    getFails = true;
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    expect((await rowOf(id)).status).toBe("COMPLETED");
  });

  it("a test-mode message never settles a live withdrawal", async () => {
    process.env.NTZS_API_KEY = "ntzs_live_unit";
    const { id } = await send(50_000);
    expect((await rowOf(id)).livemode).toBe(true);
    finish("wd_1", { status: "paid", payoutStatus: "completed" });
    const r = await handleWithdrawalWebhook(hookOf(byId.wd_1, { livemode: false }));
    expect(r.ignored).toBeTruthy();
    expect((await rowOf(id)).status).toBe("PROCESSING");
    await handleWithdrawalWebhook(hookOf(byId.wd_1, { livemode: true }));
    expect((await rowOf(id)).status).toBe("COMPLETED");
  });

  it("another nTZS withdrawal under our one request is never applied — a person is told at once", async () => {
    const { id, actor } = await send(50_000);
    await handleWithdrawalWebhook({ withdrawalId: "wd_twin", externalId: id, status: "paid", payoutStatus: "completed", receiveAmountTzs: 50_000, burnAmountTzs: 51_500 });
    const v = await withdrawalView(id, actor);
    expect(v).toMatchObject({ status: "PROCESSING", providerId: "wd_1", booked: false, attention: [N.second] });
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it("a deposit's message still goes the collections way", async () => {
    const res = await signedWebhook({ type: "deposit.completed", data: { depositId: "dep_unknown", status: "minted", amountTzs: 10_000 } });
    expect(await res.json()).toMatchObject({ ok: true, ignored: "unknown payment" });
  });
});

describe("no clear answer from nTZS", () => {
  it("nTZS took the request but its answer was lost: 'Not confirmed', never sent again by itself, and no new withdrawal until it is settled", async () => {
    const a = await boss();
    const spare = await priceWithdrawal(toPhone(40_000), a, at(0));
    const p = await priceWithdrawal(toPhone(250_000), a, at(0));
    nextSend = "taken-no-answer";
    const v = await confirmWithdrawal(p.view.id, a, at(0));
    expect(v).toMatchObject({ status: "UNKNOWN", failureCode: "no_answer", providerId: null, booked: false, attention: [N.noAnswer], canSettle: false });
    expect(v.checkAfter!.getTime()).toBeGreaterThan(at(5 * MIN).getTime());
    expect(await db.ledgerEntry.count()).toBe(0);

    expect(await code(priceWithdrawal(toPhone(30_000), a, at(MIN)))).toBe("CONFLICT");
    expect(await code(confirmWithdrawal(spare.view.id, a, at(MIN)))).toBe("CONFLICT");
    // Too early to ask the same request again (its price could still be valid): refused, and nothing is sent.
    expect(await code(checkWithdrawal(p.view.id, a, at(2 * MIN)))).toBe("CONFLICT");
    await sweepWithdrawals(at(3 * MIN));
    expect(sends).toHaveLength(1);
    const today = businessDateOf(new Date());
    expect((await withdrawalsOverview(a, { from: today, to: today }, at(3 * MIN))).unsettled).toMatchObject({ id: p.view.id, number: "WD-000001" });

    // Once the price has surely run out, the very same request (same key) is asked again: nTZS gives the original back.
    clock += 7 * MIN;
    const checked = await checkWithdrawal(p.view.id, a, at(0));
    expect(sends).toHaveLength(2);
    expect(sends[1].key).toBe(p.view.id);
    expect(sends[1].body).toEqual(sends[0].body);
    expect(Object.keys(byId)).toHaveLength(1);
    expect(checked).toMatchObject({ status: "PROCESSING", providerId: "wd_1", failureCode: null, attention: [] });
    expect((await withdrawalsOverview(a, { from: today, to: today }, at(0))).unsettled).toBeNull();
  });

  it("nTZS's own report settles a 'Not confirmed' withdrawal by our reference, with no asking at all", async () => {
    const a = await boss();
    const p = await priceWithdrawal(toPhone(250_000), a);
    nextSend = "taken-no-answer";
    await confirmWithdrawal(p.view.id, a);
    finish("wd_1", { status: "paid", payoutStatus: "completed", payoutReference: "TIGO-55" });
    const res = await signedWebhook({ type: "withdrawal.updated", data: hookOf(byId.wd_1) });
    expect(await res.json()).toMatchObject({ ok: true, status: "COMPLETED" });
    const v = await withdrawalView(p.view.id, a);
    expect(v).toMatchObject({ status: "COMPLETED", providerId: "wd_1", booked: true, failureCode: null, attention: [], payoutReference: "TIGO-55" });
    expect(sends).toHaveLength(1);
  });

  it("the request never reached nTZS: asked again it cannot say — it stays 'Not confirmed', and only then may a person settle it", async () => {
    const before = await ntzsBook();
    const a = await boss();
    const p = await priceWithdrawal(toPhone(250_000), a, at(0));
    nextSend = "lost";
    await confirmWithdrawal(p.view.id, a, at(0));
    expect(Object.keys(byId)).toHaveLength(0);
    // A day has not passed and nTZS was not asked again: no settling by hand.
    expect(await code(settleWithdrawalByHand(p.view.id, { outcome: "NOT_SENT", note: "nTZS shows no payout" }, a, at(20 * MIN)))).toBe("CONFLICT");

    clock += 7 * MIN;
    const v = await checkWithdrawal(p.view.id, a, at(0));
    expect(v).toMatchObject({ status: "UNKNOWN", failureCode: "not_confirmed", attention: [N.notFound], canSettle: false });
    // No payout was started by asking (the price had run out).
    expect(Object.keys(byId)).toHaveLength(0);
    expect(balance).toBe(2_000_000);

    clock += 10 * MIN;
    expect((await withdrawalView(p.view.id, a, at(0))).canSettle).toBe(true);
    expect(await code(settleWithdrawalByHand(p.view.id, { outcome: "NOT_SENT", note: "" }, a, at(0)))).toBe("VALIDATION");
    expect(await code(settleWithdrawalByHand(p.view.id, { outcome: "ARRIVED", note: "nTZS shows it as paid" }, a, at(0)))).toBe("VALIDATION");
    const settled = await settleWithdrawalByHand(p.view.id, { outcome: "NOT_SENT", note: "nTZS's statement shows no payout and the balance is unchanged" }, a, at(0));
    expect(settled).toMatchObject({ status: "REJECTED", failureCode: "settled_by_hand", booked: false, attention: [] });
    expect(settled.reconciled).toMatchObject({ by: a.label, note: "nTZS's statement shows no payout and the balance is unchanged" });
    expect(await db.ledgerEntry.count()).toBe(0);
    expect(await ntzsBook()).toBe(before);
    // Settled: another withdrawal may be sent.
    expect((await priceWithdrawal(toPhone(30_000), a, at(0))).view.status).toBe("QUOTED");
    const history = (await withdrawalDetail(p.view.id, a, at(0))).history.map((h) => h.action);
    expect(history).toEqual(["withdrawal.quoted", "withdrawal.submitted", "withdrawal.unconfirmed", "withdrawal.checked", "withdrawal.reconciled_by_hand"]);
  });

  it("settled by hand as arrived: booked with the priced fee (not confirmed); nTZS's later report corrects the fee — once", async () => {
    const before = await ntzsBook();
    const a = await boss();
    const p = await priceWithdrawal(toPhone(250_000), a, at(0));
    nextSend = "taken-no-answer";
    await confirmWithdrawal(p.view.id, a, at(0));
    // nTZS's status call and its replay are both down for a day.
    const settled = await settleWithdrawalByHand(p.view.id, { outcome: "ARRIVED", reference: "MPESA-9001", note: "The Boss received the money; nTZS shows the payout" }, a, at(25 * 60 * MIN));
    expect(settled).toMatchObject({ status: "COMPLETED", booked: true, feeTzs: FEE, feeConfirmed: false, receivedTzs: 250_000, payoutReference: "MPESA-9001" });
    expect(await ntzsBook()).toBe(before - 251_500);

    finish("wd_1", { status: "paid", payoutStatus: "completed", totalFeeTzs: 2_500, burnAmountTzs: 252_500 });
    await handleWithdrawalWebhook(hookOf(byId.wd_1), at(26 * 60 * MIN));
    await handleWithdrawalWebhook(hookOf(byId.wd_1), at(26 * 60 * MIN));
    const v = await withdrawalView(p.view.id, a);
    expect(v).toMatchObject({ status: "COMPLETED", feeTzs: 2_500, feeConfirmed: true, debitedTzs: 252_500, providerId: "wd_1" });
    expect((await db.expense.findMany({ orderBy: { createdAt: "asc" } })).map((e) => [e.amount, e.status])).toEqual([[FEE, "VOIDED"], [2_500, "RECORDED"]]);
    expect(await db.ledgerEntry.count()).toBe(1);
    expect(await ntzsBook()).toBe(before - 252_500);
  });

  it("settled by hand as not sent, and nTZS then reports it paid: nTZS's word wins, the books are written, a person is told", async () => {
    const a = await boss();
    const p = await priceWithdrawal(toPhone(250_000), a, at(0));
    nextSend = "taken-no-answer";
    await confirmWithdrawal(p.view.id, a, at(0));
    await settleWithdrawalByHand(p.view.id, { outcome: "NOT_SENT", note: "nTZS shows nothing for this request" }, a, at(25 * 60 * MIN));
    finish("wd_1", { status: "paid", payoutStatus: "completed" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1), at(26 * 60 * MIN));
    const v = await withdrawalView(p.view.id, a);
    expect(v).toMatchObject({ status: "COMPLETED", booked: true, attention: [N.confirmedLate], failureCode: null });
    expect(await db.ledgerEntry.count()).toBe(1);
  });

  it("a 502 or an unnamed server error is an unknown outcome, not a refusal; a named 'nothing moved' answer is a refusal", async () => {
    const a = await boss();
    const p = await priceWithdrawal(toPhone(50_000), a);
    nextSend = { status: 502, body: "Bad gateway" };
    expect((await confirmWithdrawal(p.view.id, a)).status).toBe("UNKNOWN");
    await db.withdrawal.deleteMany();
    const q = await priceWithdrawal(toPhone(50_000), a);
    nextSend = { status: 503, body: { error: "relayer_unavailable", message: "Nothing moved" } };
    expect((await confirmWithdrawal(q.view.id, a)).status).toBe("REJECTED");
  });

  it("nTZS says it already has the request (409): accepted and on its way — never refused, never sent again", async () => {
    const a = await boss();
    const p = await priceWithdrawal(toPhone(50_000), a);
    nextSend = { status: 409, body: { error: "duplicate_withdrawal", message: "A withdrawal with this idempotency key already exists" } };
    const v = await confirmWithdrawal(p.view.id, a);
    expect(v).toMatchObject({ status: "PROCESSING", booked: false });
    expect(sends).toHaveLength(1);
  });

  it("the server stopped between 'Sending' and nTZS's answer: the scheduled check marks it 'Not confirmed' and never sends", async () => {
    const a = await boss();
    const p = await priceWithdrawal(toPhone(50_000), a, at(0));
    await db.withdrawal.update({ where: { id: p.view.id }, data: { status: "SUBMITTING", submittedAt: at(0), number: "WD-000001" } });
    await sweepWithdrawals(at(MIN));
    expect((await rowOf(p.view.id)).status).toBe("SUBMITTING");
    await sweepWithdrawals(at(3 * MIN));
    expect((await rowOf(p.view.id)).status).toBe("UNKNOWN");
    expect(sends).toHaveLength(0);
  });
});

describe("the scheduled check", () => {
  it("asks nTZS for the state of what it accepted and completes it; a price nobody confirmed is dropped; nothing is ever sent", async () => {
    const a = await boss();
    const { id } = await send(50_000, {}, at(0));
    const idle = await priceWithdrawal(toPhone(60_000), a, at(0));
    finish("wd_1", { status: "paid", payoutStatus: "completed" });
    await sweepWithdrawals(at(20 * MIN));
    expect((await rowOf(id)).status).toBe("COMPLETED");
    expect((await rowOf(idle.view.id)).status).toBe("CANCELLED");
    expect(await db.ledgerEntry.count()).toBe(1);
    expect(sends).toHaveLength(1);
  });

  it("a phone payout still on its way after an hour is marked for a person — once", async () => {
    const { id, actor } = await send(50_000, {}, at(0));
    await sweepWithdrawals(at(30 * MIN));
    expect((await withdrawalView(id, actor)).attention).toEqual([]);
    await sweepWithdrawals(at(61 * MIN));
    await sweepWithdrawals(at(70 * MIN));
    expect((await withdrawalView(id, actor)).attention).toEqual([N.slow]);
    expect(await db.auditLog.count({ where: { entityId: id, action: "withdrawal.flagged" } })).toBe(1);
    // After a day a person with the right may settle it from nTZS's own statement.
    expect((await withdrawalView(id, actor, at(23 * 60 * MIN))).canSettle).toBe(false);
    expect((await withdrawalView(id, actor, at(25 * 60 * MIN))).canSettle).toBe(true);
  });
});

describe("the balance and the page", () => {
  it("the balance is only what nTZS reported, with its time; asking for it moves nothing", async () => {
    const a = await boss();
    const today = businessDateOf(new Date());
    expect((await withdrawalsOverview(a, { from: today, to: today })).balance).toBeNull();
    // nTZS tells the balance only with a price: with no destination yet, there is nothing to ask.
    expect(await code(checkNtzsBalance(a))).toBe("CONFLICT");
    await send(100_000, {}, at(0));
    balance = 1_750_000;
    const b = await checkNtzsBalance(a, at(MIN));
    expect(b.availableTzs).toBe(1_750_000);
    expect(sends).toHaveLength(1);
    const o = await withdrawalsOverview(a, { from: today, to: today }, at(2 * MIN));
    expect(o.balance).toMatchObject({ availableTzs: 1_750_000, sentSince: 0 });
    expect(o.inFlight).toEqual({ count: 1, total: 100_000 });
    // The balance question is not a withdrawal: it is not in the history.
    expect(o.rows).toHaveLength(1);
  });

  it("the nTZS account's own page: the same form as the Withdraw funds page, what is on its way, and how the last day's withdrawals ended", async () => {
    const a = await boss();
    const today = businessDateOf(new Date());
    const empty = await withdrawFromAccount(a, at(0));
    expect(empty).toMatchObject({ enabled: true, live: false, setupProblem: null, unsettled: null, destinations: [], lastBooks: null, latest: [], following: false });
    expect(empty.accounts.length).toBeGreaterThan(0);
    expect(empty.accounts.map((x) => x.id)).not.toContain((await db.moneyAccount.findUniqueOrThrow({ where: { code: "NTZS" } })).id);

    const first = await send(100_000, {}, at(0));
    const failed = await send(70_000, {}, at(MIN));
    finish("wd_2", { status: "reverted", payoutStatus: "reverted", payoutError: "Subscriber not registered" });
    await handleWithdrawalWebhook(hookOf(byId.wd_2));
    // A price nobody confirmed is not a withdrawal: it is not shown.
    await priceWithdrawal(toPhone(55_000), a, at(2 * MIN));
    const page = await withdrawFromAccount(a, at(3 * MIN));
    // What is on its way comes first; then how the others ended.
    expect(page.latest.map((w) => [w.id, w.status, w.amount])).toEqual([[first.id, "PROCESSING", 100_000], [failed.id, "FAILED", 70_000]]);
    expect(page.following).toBe(true);
    expect(page.lastBooks).toBe("owner");
    expect(page.destinations).toHaveLength(1);
    // The whole number never leaves the server.
    expect(JSON.stringify(page)).not.toContain("712345678");
    // The form is the very one the Withdraw funds page has.
    const o = await withdrawalsOverview(a, { from: today, to: today }, at(3 * MIN));
    for (const k of ["enabled", "live", "setupProblem", "unsettled", "destinations", "accounts", "lastBooks"] as const) expect(page[k], k).toEqual(o[k]);

    // A day on, the one that failed has left the page; the one still on its way stays, however old.
    const dayOn = await withdrawFromAccount(a, at(25 * 60 * MIN));
    expect(dayOn.latest.map((w) => w.id)).toEqual([first.id]);
    expect(dayOn.following).toBe(true);

    // One nobody can confirm closes the form and is said by itself — not repeated among the latest.
    const p = await priceWithdrawal(toPhone(250_000), a, at(4 * MIN));
    nextSend = "taken-no-answer";
    await confirmWithdrawal(p.view.id, a, at(4 * MIN));
    const stuck = await withdrawFromAccount(a, at(5 * MIN));
    expect(stuck.unsettled).toMatchObject({ id: p.view.id });
    expect(stuck.latest.map((w) => w.id)).toEqual([first.id, failed.id]);
    expect(stuck.following).toBe(true);
    expect(sends).toHaveLength(3);
  });

  it("the nTZS account's page: one that waited more than a day and then failed is still said — the day counts from when it ended", async () => {
    const a = await boss();
    const HOUR = 60 * MIN;
    const slow = await send(900_000, {}, at(0));
    expect((await withdrawFromAccount(a, at(29 * HOUR))).latest.map((w) => [w.id, w.status])).toEqual([[slow.id, "PROCESSING"]]);
    // nTZS turns it back 30 hours after it was asked for.
    finish("wd_1", { status: "reverted", payoutStatus: "reverted", payoutError: "Recipient wallet rejected the payout" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1), at(30 * HOUR));
    const after = await withdrawFromAccount(a, at(31 * HOUR));
    expect(after.latest.map((w) => [w.id, w.status])).toEqual([[slow.id, "FAILED"]]);
    expect(after.following).toBe(false);
    // …and for a day from then; after that the history on the Withdraw funds page keeps it.
    expect((await withdrawFromAccount(a, at(53 * HOUR))).latest).toHaveLength(1);
    expect((await withdrawFromAccount(a, at(55 * HOUR))).latest).toEqual([]);
  });

  it("the nTZS account's page: an older withdrawal still on its way is never pushed out by newer ones that ended", async () => {
    const a = await boss();
    const waiting = await send(500_000, {}, at(0));
    for (let i = 1; i <= 5; i++) {
      await send(20_000 + i * 1_000, {}, at(i * 20_000));
      finish(`wd_${i + 1}`, { status: "paid", payoutStatus: "completed", payoutReference: `MP${i}` });
      await handleWithdrawalWebhook(hookOf(byId[`wd_${i + 1}`]), at(i * 20_000 + 5_000));
    }
    const page = await withdrawFromAccount(a, at(10 * MIN));
    expect(page.following).toBe(true);
    expect(page.latest).toHaveLength(5);
    expect(page.latest[0]).toMatchObject({ id: waiting.id, status: "PROCESSING" });
    // Then the latest to end, first.
    expect(page.latest.slice(1).map((w) => w.amount)).toEqual([25_000, 24_000, 23_000, 22_000]);
  });

  it("the nTZS account's page stops following once nothing is on its way, and keeps to a handful", async () => {
    const a = await boss();
    // Six: as many as one person may send in ten minutes.
    for (let i = 0; i < 6; i++) {
      await send(20_000 + i * 1_000, {}, at(i * 20_000));
      finish(`wd_${i + 1}`, { status: "paid", payoutStatus: "completed", payoutReference: `MP${i}` });
      await handleWithdrawalWebhook(hookOf(byId[`wd_${i + 1}`]));
    }
    const page = await withdrawFromAccount(a, at(10 * MIN));
    expect(page.following).toBe(false);
    expect(page.latest).toHaveLength(5);
    expect(page.latest.every((w) => w.status === "COMPLETED")).toBe(true);
    expect(page.latest.map((w) => w.amount)).toEqual([25_000, 24_000, 23_000, 22_000, 21_000]);
    // Without the hotel's key the page says so and the form stays shut.
    delete process.env.NTZS_API_KEY;
    expect((await withdrawFromAccount(a, at(10 * MIN))).enabled).toBe(false);
  });

  it("the history: totals by day, filters, search — and never a whole phone or account number", async () => {
    const a = await boss();
    const today = businessDateOf(new Date());
    const one = await send(100_000, { note: "Rent" });
    finish("wd_1", { status: "paid", payoutStatus: "completed", payoutReference: "MPESA-ABC1" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    const two = await send(80_000);
    finish("wd_2", { status: "reverted", payoutStatus: "reverted", payoutError: "Line busy" });
    await handleWithdrawalWebhook(hookOf(byId.wd_2));
    const bank = await priceWithdrawal({ amount: 300_000, destination: { kind: "BANK", bankCode: "NMB", accountNumber: "20110098765" }, toAccountId: "acct_nmb" }, a);
    await confirmWithdrawal(bank.view.id, a);
    await priceWithdrawal(toPhone(55_000), a);

    const o = await withdrawalsOverview(a, { from: today, to: today });
    expect(o.rows.map((r) => r.status)).toEqual(["PROCESSING", "FAILED", "COMPLETED"]);
    expect(o.period).toEqual({ completed: 1, withdrawn: 100_000, fees: FEE, feesAllConfirmed: true, pending: 1, failed: 1 });
    expect(o.inFlight).toEqual({ count: 1, total: 300_000 });
    expect(o.destinations.map((d) => d.label)).toEqual(["NMB Bank •••• 8765", "0712 ••• 678"]);
    expect(o.accounts.some((x) => x.name.includes("nTZS"))).toBe(false);
    expect(o.lastBooks).toBe("acct_nmb");
    const text = JSON.stringify(o);
    expect(text).not.toContain("255712345678");
    expect(text).not.toContain("20110098765");
    expect(JSON.stringify(await withdrawalDetail(bank.view.id, a))).not.toContain("20110098765");

    const filter = async (f: object) => (await withdrawalsOverview(a, { from: today, to: today, ...f })).rows.map((r) => r.id);
    expect(await filter({ status: "completed" })).toEqual([one.id]);
    expect(await filter({ status: "failed" })).toEqual([two.id]);
    expect(await filter({ status: "pending" })).toEqual([bank.view.id]);
    expect(await filter({ q: "mpesa-abc" })).toEqual([one.id]);
    expect(await filter({ q: "WD-000002" })).toEqual([two.id]);
    expect(await filter({ q: "300,000" })).toEqual([bank.view.id]);
    expect(await filter({ q: "wd_3" })).toEqual([bank.view.id]);
    expect(await filter({ person: a.userId })).toHaveLength(3);
    expect(await filter({ person: "someone-else" })).toEqual([]);
    expect((await withdrawalsOverview(a, { from: addDays(today, -7), to: addDays(today, -1) })).rows).toEqual([]);

    // The same destination again without typing the number.
    const again = await priceWithdrawal({ amount: 45_000, destination: { kind: "AGAIN", withdrawalId: one.id }, toAccountId: null }, a);
    expect(again.destination).toBe("0712 345 678");
  });

  it("every step is in the audit trail, with who or what did it — and never a whole number or a secret", async () => {
    const { id, actor } = await send(100_000);
    finish("wd_1", { status: "paid", payoutStatus: "completed" });
    await handleWithdrawalWebhook(hookOf(byId.wd_1));
    const { history } = await withdrawalDetail(id, actor);
    expect(history.map((h) => [h.action, h.by])).toEqual([["withdrawal.quoted", actor.label], ["withdrawal.submitted", actor.label], ["withdrawal.status_changed", actor.label], ["withdrawal.completed", "nTZS"]]);
    const logs = JSON.stringify(await db.auditLog.findMany());
    expect(logs).not.toContain("255712345678");
    expect(logs).not.toContain("ntzs_test_unit");
    expect(logs).not.toContain("whsec_unit");
  });
});
