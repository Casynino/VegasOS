import { describe, expect, it } from "vitest";
import { canSettleByHand, maskAccount, maskedDestination, maskPhone, withdrawalProblem, WITHDRAWAL_FILTERS, WITHDRAWAL_IN_FLIGHT, WITHDRAWAL_LISTED, WITHDRAWAL_SETUP_CODES, WITHDRAWAL_STATUS, WITHDRAWAL_UNSETTLED } from "./withdrawals";

const MIN = 60_000, HOUR = 60 * MIN;
const sent = new Date("2026-10-12T09:00:00Z");
const after = (ms: number) => new Date(sent.getTime() + ms);

describe("a destination is never shown whole", () => {
  it("masks a phone and a bank account", () => {
    expect(maskPhone("255712345678")).toBe("0712 ••• 678");
    expect(maskAccount("0150 1234 56700")).toBe("•••• 6700");
    expect(maskedDestination({ destinationKind: "PHONE", phone: "255712345678", bankCode: null, accountNumber: null })).toBe("0712 ••• 678");
    expect(maskedDestination({ destinationKind: "BANK", phone: null, bankCode: "CRDB", accountNumber: "0150123456700" })).toBe("CRDB Bank •••• 6700");
    expect(maskedDestination({ destinationKind: "PHONE", phone: null, bankCode: null, accountNumber: null })).toBe("—");
  });
});

describe("settling by hand", () => {
  it("is never offered for a finished, priced or just-sent withdrawal", () => {
    for (const status of ["QUOTED", "CANCELLED", "SUBMITTING", "COMPLETED", "FAILED", "REJECTED"]) {
      expect(canSettleByHand({ status, failureCode: null, submittedAt: sent }, after(48 * HOUR)), status).toBe(false);
    }
  });

  it("one nobody could confirm: only after nTZS was asked again and a quarter of an hour passed — or after a day", () => {
    expect(canSettleByHand({ status: "UNKNOWN", failureCode: "no_answer", submittedAt: sent }, after(20 * MIN))).toBe(false);
    expect(canSettleByHand({ status: "UNKNOWN", failureCode: "not_confirmed", submittedAt: sent }, after(10 * MIN))).toBe(false);
    expect(canSettleByHand({ status: "UNKNOWN", failureCode: "not_confirmed", submittedAt: sent }, after(16 * MIN))).toBe(true);
    expect(canSettleByHand({ status: "UNKNOWN", failureCode: "no_answer", submittedAt: sent }, after(25 * HOUR))).toBe(true);
    expect(canSettleByHand({ status: "UNKNOWN", failureCode: "not_confirmed", submittedAt: null }, after(25 * HOUR))).toBe(false);
  });

  it("one nTZS still has: only after a whole day", () => {
    for (const status of ["PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW"]) {
      expect(canSettleByHand({ status, failureCode: null, submittedAt: sent }, after(23 * HOUR)), status).toBe(false);
      expect(canSettleByHand({ status, failureCode: null, submittedAt: sent }, after(25 * HOUR)), status).toBe(true);
    }
  });
});

describe("the words", () => {
  it("every state has its words, and only 'Completed' reads as done", () => {
    expect(Object.values(WITHDRAWAL_STATUS).filter((s) => s.tone === "ok").map((s) => s.label)).toEqual(["Completed"]);
    for (const s of [...WITHDRAWAL_LISTED, ...WITHDRAWAL_IN_FLIGHT, ...WITHDRAWAL_UNSETTLED]) expect(WITHDRAWAL_STATUS[s].label).toBeTruthy();
    // A price nobody confirmed is not a withdrawal, and every listed state is under exactly one filter (besides All).
    expect(WITHDRAWAL_LISTED).not.toContain("QUOTED");
    const grouped = WITHDRAWAL_FILTERS.filter((f) => f.key !== "all").flatMap((f) => [...f.statuses]).sort();
    expect(grouped).toEqual([...WITHDRAWAL_LISTED].sort());
  });

  it("nTZS's refusals are said plainly — and a problem only the administrator can clear has words too", () => {
    for (const code of WITHDRAWAL_SETUP_CODES) expect(withdrawalProblem(code), code).toBeTruthy();
    expect(withdrawalProblem("insufficient_balance")).toContain("not enough");
    expect(withdrawalProblem("something_new")).toBeNull();
    expect(withdrawalProblem(null)).toBeNull();
  });
});
