import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { readWithdrawal, readWithdrawalQuote, verifyNtzsWebhook, withdrawalRefused, withdrawalStateOf } from "./ntzs";

const SECRET = process.env.NTZS_WEBHOOK_SECRET;
afterEach(() => { if (SECRET === undefined) delete process.env.NTZS_WEBHOOK_SECRET; else process.env.NTZS_WEBHOOK_SECRET = SECRET; });

describe("what nTZS's words mean", () => {
  it("only 'payout completed' or 'paid' is a success — an unknown word never is", () => {
    const of = (status: string, payoutStatus = "") => withdrawalStateOf({ status, payoutStatus });
    expect(of("paid")).toBe("COMPLETED");
    expect(of("burned", "completed")).toBe("COMPLETED");
    expect(of("burned", "pending")).toBe("PROCESSING");
    expect(of("pending")).toBe("PROCESSING");
    expect(of("requested")).toBe("AWAITING_APPROVAL");
    expect(of("burned", "reconcile_required")).toBe("IN_REVIEW");
    expect(of("paid", "reconcile_required")).toBe("IN_REVIEW");
    expect(of("reverted")).toBe("FAILED");
    expect(of("failed")).toBe("FAILED");
    expect(of("burned", "reverted")).toBe("FAILED");
    expect(of("paid", "reverted")).toBe("FAILED");
    for (const word of ["", "success", "ok", "done", "sent", "accepted"]) expect(of(word), word).toBe("PROCESSING");
  });

  it("a refusal is only an answer that says nothing moved", () => {
    expect(withdrawalRefused({})).toBe(false); // no answer at all
    expect(withdrawalRefused({ status: 502 })).toBe(false);
    expect(withdrawalRefused({ status: 500, code: "network_error" })).toBe(false);
    expect(withdrawalRefused({ status: 500 })).toBe(false);
    expect(withdrawalRefused({ status: 408 })).toBe(false);
    expect(withdrawalRefused({ status: 409, code: "duplicate_withdrawal" })).toBe(false);
    expect(withdrawalRefused({ status: 409, code: "quote_stale" })).toBe(true);
    expect(withdrawalRefused({ status: 400, code: "invalid_phone" })).toBe(true);
    expect(withdrawalRefused({ status: 403, code: "capability_required" })).toBe(true);
    expect(withdrawalRefused({ status: 503, code: "relayer_unavailable" })).toBe(true);
    expect(withdrawalRefused({ status: 500, code: "database_error" })).toBe(true);
  });
});

describe("reading nTZS's answers", () => {
  it("a price: the fee, what leaves the balance, the balance itself — and 'no price' when there is not enough", () => {
    const q = readWithdrawalQuote({ quoteId: "q_1", expiresAt: "2026-10-12T09:05:00Z", receiveAmountTzs: 100000, totalFeeTzs: 1500, burnAmountTzs: 101500, recipientName: "JOHN M DOE", payoutRail: "mobile_money", balance: { availableTzs: 900000, sufficient: true }, approval: { requiresApproval: false } });
    expect(q).toMatchObject({ quoteId: "q_1", receiveTzs: 100_000, feeTzs: 1_500, debitTzs: 101_500, recipientName: "JOHN M DOE", availableTzs: 900_000, sufficient: true, requiresApproval: false });
    expect(q.expiresAt?.toISOString()).toBe("2026-10-12T09:05:00.000Z");
    const none = readWithdrawalQuote({ data: { quoteId: null, receiveAmountTzs: 100000, fees: { totalFeeTzs: 1500 }, balance: { availableTzs: 20000, sufficient: false } } });
    expect(none).toMatchObject({ quoteId: null, feeTzs: 1_500, debitTzs: 101_500, availableTzs: 20_000, sufficient: false, recipientName: null });
    expect(readWithdrawalQuote("nonsense")).toMatchObject({ quoteId: null, receiveTzs: null, feeTzs: null, availableTzs: null, sufficient: null });
  });

  it("a withdrawal: from the answer, the status call and the webhook's data alike", () => {
    const w = readWithdrawal({ id: "wd_1", status: "PAID", payoutStatus: "completed", receiveAmountTzs: 100000, totalFeeTzs: 1500, burnAmountTzs: 101500, payoutReference: "MPESA-1", confirmationMessage: "Sent" });
    expect(w).toMatchObject({ id: "wd_1", status: "paid", payoutStatus: "completed", receiveTzs: 100_000, feeTzs: 1_500, debitTzs: 101_500, payoutReference: "MPESA-1", message: "Sent", externalId: null, livemode: null });
    const hook = readWithdrawal({ withdrawalId: "wd_2", status: "reverted", payoutStatus: "reverted", receiveAmountTzs: 5000, burnAmountTzs: 6000, payoutProvider: "bank", payoutError: "Account closed", livemode: true, endUser: { reference: "our-id" } });
    expect(hook).toMatchObject({ id: "wd_2", feeTzs: 1_000, payoutRail: "bank", payoutError: "Account closed", externalId: "our-id", livemode: true });
    expect(readWithdrawal({ withdrawal: { status: "burned" } }, "wd_3")).toMatchObject({ id: "wd_3", status: "burned", receiveTzs: null, feeTzs: null, debitTzs: null });
    // A negative or nonsense figure is "not said", never a number.
    expect(readWithdrawal({ id: "wd_4", status: "paid", receiveAmountTzs: -5, totalFeeTzs: "abc" })).toMatchObject({ receiveTzs: null, feeTzs: null });
  });
});

describe("nTZS's webhook signature", () => {
  const body = JSON.stringify({ type: "withdrawal.updated", data: { withdrawalId: "wd_1", status: "paid" } });
  const now = Date.parse("2026-10-12T09:00:00Z");
  const ts = String(Math.floor(now / 1000));
  const sign = (secret: string, t = ts, b = body) => createHmac("sha256", secret).update(`${t}.${b}`).digest("hex");

  it("accepts only the hotel's secret over this very body and time", () => {
    process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
    expect(verifyNtzsWebhook(body, sign("whsec_unit"), ts, now)).toBe(true);
    expect(verifyNtzsWebhook(body, `sha256=${sign("whsec_unit")}`, ts, now)).toBe(true);
    expect(verifyNtzsWebhook(body, sign("whsec_other"), ts, now)).toBe(false);
    expect(verifyNtzsWebhook(body.replace("paid", "paid "), sign("whsec_unit"), ts, now)).toBe(false);
    expect(verifyNtzsWebhook(body, null, ts, now)).toBe(false);
    expect(verifyNtzsWebhook(body, sign("whsec_unit"), null, now)).toBe(false);
    expect(verifyNtzsWebhook(body, "", ts, now)).toBe(false);
  });

  it("refuses an old message sent again, and everything when the hotel has no secret", () => {
    process.env.NTZS_WEBHOOK_SECRET = "whsec_unit";
    const old = String(Math.floor(now / 1000) - 3_600);
    expect(verifyNtzsWebhook(body, sign("whsec_unit", old), old, now)).toBe(false);
    delete process.env.NTZS_WEBHOOK_SECRET;
    expect(verifyNtzsWebhook(body, sign(""), ts, now)).toBe(false);
    expect(verifyNtzsWebhook(body, sign("whsec_unit"), ts, now)).toBe(false);
  });
});
