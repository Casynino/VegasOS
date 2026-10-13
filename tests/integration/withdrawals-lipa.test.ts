import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { POST as ntzsWebhook } from "@/app/api/webhooks/ntzs/route";
import { accountBalances } from "@/server/services/finance";
import { checkWithdrawal, confirmWithdrawal, priceWithdrawal, sweepWithdrawals, withdrawalView, type PriceInput, type WithdrawalActor } from "@/server/services/withdrawals";
import { resetBusinessData } from "../support/helpers";

/**
 * Withdraw funds to a LIPA NUMBER (owner, 2026-10-13). nTZS pays a Lipa number through its "spend" calls
 * (/spend/quote, /spend, /spend/{id}, the signed `spend.updated` webhook) — not through /withdrawals. nTZS is faked
 * here (no real money). What is proven: the right calls are made with the right bodies, the same safety rules as a phone or a
 * bank (priced first, sent once, only nTZS's own word makes it a success, the books written once), a Lipa number's own
 * limits (least TZS 500, under TZS 1,000,000 with the fee), and that "the till's network is not known" is a refusal,
 * never "not confirmed".
 */
const ENV = { key: process.env.NTZS_API_KEY, secret: process.env.NTZS_WEBHOOK_SECRET, user: process.env.NTZS_USER_ID };
const FEE = 1_100;
const MIN = 60_000;
const LIPA = "61115582";

interface FakeSpend { id: string; status: string; payoutStatus: string; principalTzs: number; burnAmountTzs: number; fees: { totalFeeTzs: number }; recipientName: string; reference: string; externalId: string }
let balance = 0;
let quotes: Record<string, { amountTzs: number; expiresAt: number }> = {};
let byId: Record<string, FakeSpend> = {};
let calls: { path: string; method: string; key: string | null; body: Record<string, unknown> }[] = [];
let nextQuote: { status: number; body: unknown } | null = null;
let nextSend: { status: number; body: unknown } | null = null;
let clock = Date.now();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const callsTo = (path: string) => calls.filter((c) => c.path.endsWith(path));

beforeEach(async () => {
  await resetBusinessData();
  await db.rateLimitBucket.deleteMany({ where: { OR: [{ key: { startsWith: "wd-" } }, { key: "ntzs-wd-sweep" }] } });
  process.env.NTZS_API_KEY = "ntzs_test_unit";
  process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
  delete process.env.NTZS_USER_ID;
  balance = 2_000_000; quotes = {}; byId = {}; calls = []; nextQuote = null; nextSend = null; clock = Date.now();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, "");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const method = init?.method ?? "GET";
    calls.push({ path, method, key: new Headers(init?.headers).get("Idempotency-Key"), body });
    if (path === "/spend/quote" && method === "POST") {
      if (nextQuote) { const q = nextQuote; nextQuote = null; return json(q.body, q.status); }
      const amountTzs = Number(body.amountTzs);
      const sufficient = balance >= amountTzs + FEE;
      const quoteId = sufficient ? `sq_${calls.length}` : null;
      if (quoteId) quotes[quoteId] = { amountTzs, expiresAt: clock + 5 * MIN };
      return json({
        quoteId, expiresAt: new Date(clock + 5 * MIN).toISOString(), target: { payNumber: body.payNumber, network: "mpesa" }, recipientName: "MAMA NTILIE SHOP",
        principalTzs: amountTzs, burnAmountTzs: amountTzs + FEE, fees: { selcomFeeTzs: 600, platformFeeTzs: 500, totalFeeTzs: FEE }, balance: { availableTzs: balance, sufficient },
      });
    }
    if (path === "/spend" && method === "POST") {
      if (nextSend) { const s = nextSend; nextSend = null; return json(s.body, s.status); }
      const quote = quotes[String(body.quoteId)];
      if (!quote || quote.expiresAt < clock) return json({ error: "invalid_quote", message: "expired" }, 400);
      const amountTzs = Number(body.amountTzs);
      const sp: FakeSpend = {
        id: `sp_${Object.keys(byId).length + 1}`, status: "burned", payoutStatus: "pending", principalTzs: amountTzs, burnAmountTzs: amountTzs + FEE, fees: { totalFeeTzs: FEE },
        recipientName: "MAMA NTILIE SHOP", reference: "NTZS-REF-1", externalId: String((body.endUser as { reference?: string } | undefined)?.reference ?? ""),
      };
      byId[sp.id] = sp; balance -= amountTzs + FEE;
      return json(sp, 201);
    }
    const m = path.match(/^\/spend\/([^/?]+)$/);
    if (m && method === "GET") return byId[m[1]] ? json(byId[m[1]]) : json({ error: "not_found", message: "Not found" }, 404);
    return json({ error: "not_found", message: `Not found: ${path}` }, 404);
  });
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  for (const [name, value] of [["NTZS_API_KEY", ENV.key], ["NTZS_WEBHOOK_SECRET", ENV.secret], ["NTZS_USER_ID", ENV.user]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await resetBusinessData();
});

async function actorOf(email: string): Promise<WithdrawalActor> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) };
}
const boss = () => actorOf("admin@vegas.test");
const toLipa = (amount: number, more: Partial<PriceInput> = {}): PriceInput => ({ amount, destination: { kind: "LIPA", payNumber: LIPA }, toAccountId: null, ...more });
const at = (ms: number) => new Date(clock + ms);
const code = (p: Promise<unknown>) => p.then(() => "no error", (e: { code?: string }) => e.code ?? "error");
const rowOf = (id: string) => db.withdrawal.findUniqueOrThrow({ where: { id } });
const bookOf = async (c: string) => (await accountBalances(undefined, true)).find((a) => a.code === c)!.balance;

/** nTZS's signed `spend.updated`, as its documentation shows it. */
function spendHook(sp: FakeSpend, more: Record<string, unknown> = {}) {
  const raw = JSON.stringify({ type: "spend.updated", data: { spendId: sp.id, externalId: sp.externalId, reference: sp.reference, status: "completed", kind: "lipa", recipientName: sp.recipientName, principalTzs: sp.principalTzs, burnAmountTzs: sp.burnAmountTzs, actualChargesTzs: FEE, selcomReceipt: "SEL123", endUser: { reference: sp.externalId }, ...more } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", "whsec_unit").update(`${ts}.${raw}`).digest("hex");
  return ntzsWebhook(new Request("http://hotel.test/api/webhooks/ntzs", { method: "POST", body: raw, headers: { "x-webhook-signature": sig, "x-webhook-timestamp": ts } }));
}
async function send(amount: number, more: Partial<PriceInput> = {}) {
  const a = await boss();
  const priced = await priceWithdrawal(toLipa(amount, more), a, at(0));
  const view = await confirmWithdrawal(priced.view.id, a, at(0));
  return { id: view.id, view, actor: a, priced };
}

describe("pricing a Lipa number", () => {
  it("asks nTZS's spend for the price and keeps the Lipa number as the destination — shown masked, the whole number only to the one confirming", async () => {
    const a = await boss();
    const priced = await priceWithdrawal(toLipa(50_000, { destination: { kind: "LIPA", payNumber: "6111 5582" } }), a, at(0));
    expect(callsTo("/spend/quote")).toHaveLength(1);
    expect(callsTo("/withdrawals/quote")).toHaveLength(0);
    expect(callsTo("/spend/quote")[0].body).toEqual({ kind: "lipa", payNumber: LIPA, amountTzs: 50_000, fromTreasury: true });
    expect(priced.destination).toBe(`Lipa · ${LIPA}`);
    expect(priced.view).toMatchObject({ destination: "Lipa •••• 5582", destinationKind: "LIPA", status: "QUOTED", amount: 50_000, feeTzs: FEE, recipientName: "MAMA NTILIE SHOP" });
    expect(priced.receiveTzs).toBe(50_000);
    expect(await rowOf(priced.view.id)).toMatchObject({ destinationKind: "LIPA", accountNumber: LIPA, phone: null, bankCode: null, debitedTzs: 50_000 + FEE, payoutRail: "mpesa" });
  });

  it("a Lipa number takes TZS 500 and up, and stays under TZS 1,000,000 with the fee — a phone still needs TZS 5,000", async () => {
    const a = await boss();
    expect(await code(priceWithdrawal(toLipa(499), a, at(0)))).toBe("VALIDATION");
    expect((await priceWithdrawal(toLipa(500), a, at(0))).view.amount).toBe(500);
    expect((await priceWithdrawal(toLipa(4_999, { clientKey: "key-lipa-4999" }), a, at(0))).view.amount).toBe(4_999);
    expect(await code(priceWithdrawal({ amount: 4_999, destination: { kind: "PHONE", phone: "0712 345 678" }, toAccountId: null }, a, at(0)))).toBe("VALIDATION");
    // 1,000,000 and more is refused before nTZS is asked
    const asked = callsTo("/spend/quote").length;
    expect(await code(priceWithdrawal(toLipa(1_000_000), a, at(0)))).toBe("VALIDATION");
    expect(callsTo("/spend/quote")).toHaveLength(asked);
    // 999,500 + the fee is over the limit: nTZS prices it, and the hotel stops it there — nothing is kept to confirm
    balance = 5_000_000;
    expect(await code(priceWithdrawal(toLipa(999_500), a, at(0)))).toBe("VALIDATION");
    expect(await db.withdrawal.count({ where: { status: "QUOTED", amount: 999_500 } })).toBe(0);
    expect(await db.withdrawal.findFirstOrThrow({ where: { amount: 999_500 } })).toMatchObject({ status: "CANCELLED", failureCode: "amount_too_large" });
    // and one that fits
    expect((await priceWithdrawal(toLipa(990_000, { clientKey: "key-lipa-990000" }), a, at(0))).view.status).toBe("QUOTED");
  });

  it("the number is checked on the server: digits only (spaces and dashes allowed), four to twelve of them", async () => {
    const a = await boss();
    for (const payNumber of ["", "abc", "123", "1234567890123", "6111-55O2"]) {
      expect(await code(priceWithdrawal(toLipa(5_000, { destination: { kind: "LIPA", payNumber } }), a, at(0))), payNumber).toBe("VALIDATION");
    }
    expect(callsTo("/spend/quote")).toHaveLength(0);
    expect((await priceWithdrawal(toLipa(5_000, { destination: { kind: "LIPA", payNumber: " 6111-5582 " } }), a, at(0))).destination).toBe(`Lipa · ${LIPA}`);
  });

  it("not enough money at nTZS is said as for any withdrawal, and Lipa not being switched on is said in its own words", async () => {
    const a = await boss();
    balance = 1_000;
    expect(await code(priceWithdrawal(toLipa(50_000), a, at(0)))).toBe("VALIDATION");
    nextQuote = { status: 503, body: { error: "spend_kind_disabled", message: "This particular spend destination is not enabled." } };
    const stopped = await priceWithdrawal(toLipa(60_000, { clientKey: "key-lipa-60000" }), a, at(0)).then(() => null, (e: { code?: string; message?: string }) => e);
    expect(stopped?.code).toBe("UNAVAILABLE");
    expect(stopped?.message).toContain("Lipa numbers");
  });

  it("only those who may withdraw can price one", async () => {
    for (const email of ["asha@vegas.test", "manager@vegas.test", "waiter@vegas.test"]) {
      expect(await code(priceWithdrawal(toLipa(5_000), await actorOf(email), at(0))), email).toBe("FORBIDDEN");
    }
    expect(calls).toHaveLength(0);
  });
});

describe("sending, and what nTZS says after", () => {
  it("is sent once through /spend with the priced quote and our own key; on its way until nTZS says completed — then booked once", async () => {
    const bank = await bookOf("BANK"), ntzs = await bookOf("NTZS");
    const { id, view, actor } = await send(300_000, { toAccountId: "acct_bank" });
    const sent = callsTo("/spend").filter((c) => c.method === "POST");
    expect(sent).toHaveLength(1);
    expect(sent[0].key).toBe(id);
    expect(sent[0].body).toEqual({ kind: "lipa", payNumber: LIPA, amountTzs: 300_000, fromTreasury: true, endUser: { reference: id }, quoteId: expect.stringMatching(/^sq_/) });
    expect(callsTo("/withdrawals")).toHaveLength(0);
    expect(view).toMatchObject({ status: "PROCESSING", booked: false, destination: "Lipa •••• 5582" });
    expect(await rowOf(id)).toMatchObject({ providerId: "sp_1", payoutStatus: "pending" });
    expect(await db.ledgerEntry.count()).toBe(0);

    // nTZS's own word: completed
    byId.sp_1.status = "completed"; byId.sp_1.payoutStatus = "completed";
    expect((await spendHook(byId.sp_1)).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: "COMPLETED", payoutReceipt: "SEL123" });
    expect((await withdrawalView(id, actor)).books).toBe("CRDB Bank");
    expect((await db.ledgerEntry.findFirstOrThrow()).kind).toBe("TRANSFER");
    expect(await bookOf("BANK")).toBe(bank + 300_000);
    expect(await bookOf("NTZS")).toBe(ntzs - 300_000 - FEE);
    // the fee is the one expense; the money is neither income nor an expense
    expect(await db.expense.count()).toBe(1);
    expect(await db.revenueTransaction.count()).toBe(0);

    // the same news again, the check, the scheduled look: nothing is written twice and nothing is sent again
    await spendHook(byId.sp_1); await spendHook(byId.sp_1);
    await checkWithdrawal(id, actor);
    await sweepWithdrawals(new Date(Date.now() + 10 * MIN));
    expect(await db.ledgerEntry.count()).toBe(1);
    expect(await db.expense.count()).toBe(1);
    expect(callsTo("/spend").filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("'Check with nTZS' asks the spend, not the withdrawals, and follows what it says", async () => {
    const { id, actor } = await send(40_000);
    byId.sp_1.payoutStatus = "completed";
    const view = await checkWithdrawal(id, actor, at(MIN));
    expect(callsTo("/spend/sp_1").filter((c) => c.method === "GET")).toHaveLength(1);
    expect(callsTo("/withdrawals/sp_1")).toHaveLength(0);
    expect(view.status).toBe("COMPLETED");
  });

  it("a payment nTZS turns back (reverted) is Failed, the money returns, and nothing is booked", async () => {
    const { id } = await send(40_000);
    byId.sp_1.status = "reverted"; balance += 40_000 + FEE;
    await spendHook(byId.sp_1, { status: "reverted" });
    expect(await rowOf(id)).toMatchObject({ status: "FAILED" });
    expect(await db.ledgerEntry.count()).toBe(0);
    expect(await db.expense.count()).toBe(0);
  });

  it("'reconcile_required' means nTZS is checking it — in review, never a success", async () => {
    const { id } = await send(40_000);
    byId.sp_1.status = "reconcile_required";   // nTZS says the same when it is asked
    await spendHook(byId.sp_1, { status: "reconcile_required" });
    expect(await rowOf(id)).toMatchObject({ status: "IN_REVIEW" });
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it("a test-mode message never settles it, and a message about a spend we do not know changes nothing", async () => {
    const { id } = await send(40_000);
    expect((await spendHook({ ...byId.sp_1, id: "sp_unknown", externalId: "" })).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: "PROCESSING" });
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it("'the till's network is not known' (502, nTZS reverted its burn) is a refusal — nothing moved, and the next withdrawal is not blocked", async () => {
    const a = await boss();
    const priced = await priceWithdrawal(toLipa(40_000), a, at(0));
    nextSend = { status: 502, body: { error: "till_network_required", message: "The till's network is unknown" } };
    const view = await confirmWithdrawal(priced.view.id, a, at(0));
    expect(view).toMatchObject({ status: "REJECTED", failureCode: "till_network_required" });
    expect(await db.ledgerEntry.count()).toBe(0);
    // not "Not confirmed": a new withdrawal can be priced straight away
    expect((await priceWithdrawal(toLipa(10_000, { clientKey: "key-after-network" }), a, at(2 * MIN))).view.status).toBe("QUOTED");
  });

  it("an unnamed 502 is still 'not confirmed' — unknown is never a refusal", async () => {
    const a = await boss();
    const priced = await priceWithdrawal(toLipa(40_000), a, at(0));
    nextSend = { status: 502, body: { error: "bad_gateway" } };
    expect((await confirmWithdrawal(priced.view.id, a, at(0))).status).toBe("UNKNOWN");
    expect(await code(priceWithdrawal(toLipa(10_000, { clientKey: "key-after-unknown" }), a, at(MIN)))).toBe("CONFLICT");
  });

  it("the same amount to the same Lipa number is not sent twice within ten minutes", async () => {
    await send(25_000);
    const a = await boss();
    byId.sp_1.payoutStatus = "completed"; byId.sp_1.status = "completed"; await spendHook(byId.sp_1);
    const again = await priceWithdrawal(toLipa(25_000, { clientKey: "key-lipa-twin" }), a, at(MIN));
    expect(await code(confirmWithdrawal(again.view.id, a, at(MIN)))).toBe("CONFLICT");
    expect(callsTo("/spend").filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("it can be chosen again from the history as an earlier destination", async () => {
    const { id } = await send(25_000);
    const a = await boss();
    byId.sp_1.payoutStatus = "completed"; byId.sp_1.status = "completed"; await spendHook(byId.sp_1);
    const next = await priceWithdrawal({ amount: 30_000, destination: { kind: "AGAIN", withdrawalId: id }, toAccountId: null }, a, at(11 * MIN));
    expect(next.destination).toBe(`Lipa · ${LIPA}`);
    expect(callsTo("/spend/quote").pop()?.body).toMatchObject({ kind: "lipa", payNumber: LIPA });
  });
});
