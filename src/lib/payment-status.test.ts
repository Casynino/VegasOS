import { describe, expect, it } from "vitest";
import { BILL_STATE_LABEL, billState } from "./payment-status";

/** A bill's state comes from its real balance — never from an invoice existing or a room having been used. */
describe("billState", () => {
  const bill = (total: number, paid: number, company = 0) => ({ total, paid, company, owed: total - paid - company });

  it("is unpaid, part paid or paid by what is really owed", () => {
    expect(billState(bill(80_000, 0))).toBe("UNPAID");
    expect(billState(bill(80_000, 30_000))).toBe("PART_PAID");
    expect(billState(bill(80_000, 80_000))).toBe("PAID");
  });

  it("is overpaid when more came in than the bill, and nothing due when there is no bill", () => {
    expect(billState(bill(80_000, 90_000))).toBe("CREDIT");
    expect(billState(bill(0, 0))).toBe("NOTHING_DUE");
  });

  it("never calls a bill paid because it was moved onto a company invoice", () => {
    expect(billState(bill(80_000, 0, 80_000))).toBe("COMPANY_INVOICE");
    expect(billState(bill(80_000, 20_000, 60_000))).toBe("COMPANY_INVOICE");
    // Part on the company, the rest still owed by the guest: no money has come in, so it is not "part paid".
    expect(billState(bill(80_000, 0, 50_000))).toBe("UNPAID");
    expect(billState(bill(80_000, 10_000, 50_000))).toBe("PART_PAID");
  });

  it("says the group pays when a member's bill is carried by the group", () => {
    expect(billState({ ...bill(80_000, 0), billTo: "GROUP" })).toBe("GROUP_PAYS");
    expect(billState({ ...bill(80_000, 80_000), billTo: "GROUP" })).toBe("PAID");
  });

  it("has a plain word for every state", () => {
    for (const s of ["NOTHING_DUE", "UNPAID", "PART_PAID", "PAID", "CREDIT", "GROUP_PAYS", "COMPANY_INVOICE"] as const) expect(BILL_STATE_LABEL[s]).toBeTruthy();
  });
});
