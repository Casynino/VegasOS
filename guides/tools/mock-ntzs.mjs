// A pretend nTZS for the guide pictures — nothing real: it answers the price, the send and the state of a withdrawal to a
// phone, a bank account or a Lipa number with practice names and practice fees, so the "Withdraw funds" screens can be shown
// without the hotel's real nTZS key. It listens only on this computer.
//
//   node guides/tools/mock-ntzs.mjs        (port 3199; the practice app is started against it by guides/tools/local.mjs dev)
import http from "node:http";

const PORT = 3199;
const BALANCE = 2_450_000;
const quotes = new Map();
const payouts = new Map();
let n = 0;
const fee = (amount) => Math.max(65, Math.round(amount * 0.0065));
const NAMES = { phone: "JOHN M. MWAKASEGE", bank: "VEGAS LUXURY HOTEL LTD", lipa: "MAMA NTILIE SHOP" };
const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const kindOf = (b) => (b.payNumber ? "lipa" : b.bankCode ? "bank" : "phone");

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const path = (req.url ?? "").replace(/^\/api\/v1/, "").split("?")[0];
    const body = raw ? JSON.parse(raw) : {};
    const spendish = path.startsWith("/spend");
    if (req.method === "POST" && (path === "/withdrawals/quote" || path === "/spend/quote")) {
      const amount = Number(body.amountTzs), f = fee(amount), kind = kindOf(body);
      const quoteId = `mq_${++n}`;
      quotes.set(quoteId, { amount, kind, at: Date.now() });
      const base = { quoteId, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), recipientName: NAMES[kind], balance: { availableTzs: BALANCE, sufficient: BALANCE >= amount + f }, fees: { totalFeeTzs: f }, burnAmountTzs: amount + f };
      return send(res, 200, spendish
        ? { ...base, target: { payNumber: body.payNumber, network: "mpesa" }, principalTzs: amount }
        : { ...base, receiveAmountTzs: amount, totalFeeTzs: f, payoutRail: kind === "bank" ? "bank" : "mobile_money", approval: { requiresApproval: false } });
    }
    if (req.method === "POST" && (path === "/withdrawals" || path === "/spend")) {
      const q = quotes.get(body.quoteId);
      if (!q) return send(res, 400, { error: "invalid_quote", message: "The price ran out" });
      const f = fee(q.amount), id = `${spendish ? "sp" : "wd"}_${++n}`;
      const row = { id, at: Date.now(), amount: q.amount, fee: f, kind: q.kind, ref: body.endUser?.reference ?? "", spend: spendish };
      payouts.set(id, row);
      return send(res, 201, view(row, false));
    }
    const m = path.match(/^\/(withdrawals|spend)\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const row = payouts.get(m[2]);
      return row ? send(res, 200, view(row, Date.now() - row.at > 15_000)) : send(res, 404, { error: "not_found", message: "Not found" });
    }
    return send(res, 404, { error: "not_found", message: `Not found: ${path}` });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`pretend nTZS on http://127.0.0.1:${PORT}`));

/** A payout as nTZS says it: on its way, and — a few seconds later — finished. */
function view(r, done) {
  const status = done ? (r.spend ? "completed" : "paid") : "burned";
  const common = { id: r.id, status, payoutStatus: done ? "completed" : "pending", recipientName: NAMES[r.kind], externalId: r.ref, burnAmountTzs: r.amount + r.fee, fees: { totalFeeTzs: r.fee }, livemode: true };
  return r.spend ? { ...common, principalTzs: r.amount, reference: `SP-${r.id}` } : { ...common, receiveAmountTzs: r.amount, totalFeeTzs: r.fee, payoutReference: `PR-${r.id}`, payoutRail: r.kind === "bank" ? "bank" : "mobile_money" };
}
