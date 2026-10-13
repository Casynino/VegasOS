import { describe, expect, it } from "vitest";
import { BILL_LOOK, billState } from "./payment-status";

/** What a room's tile says about the guest's bill: paid or not paid, never guessed. */
describe("a room's bill on its tile", () => {
  const look = (b: { total: number; paid: number; company: number; owed: number; billTo?: string }) => BILL_LOOK[billState(b)];
  it("paid only when something was due and nothing is owed", () => {
    expect(look({ total: 160_000, paid: 160_000, company: 0, owed: 0 })).toMatchObject({ label: "Paid", owes: false });
    // a bill of nothing is not "paid"
    expect(look({ total: 0, paid: 0, company: 0, owed: 0 }).label).toBe("Nothing due");
  });
  it("not paid and part paid say they owe", () => {
    expect(look({ total: 160_000, paid: 0, company: 0, owed: 160_000 })).toMatchObject({ label: "Not paid", owes: true });
    expect(look({ total: 160_000, paid: 100_000, company: 0, owed: 60_000 })).toMatchObject({ label: "Part paid", owes: true });
  });
  it("a bill put on a company's invoice is never called paid; a group room is the group's", () => {
    expect(look({ total: 160_000, paid: 0, company: 160_000, owed: 0 }).label).toBe("On company invoice");
    expect(look({ total: 160_000, paid: 0, company: 0, owed: 160_000, billTo: "GROUP" })).toMatchObject({ label: "Group pays", owes: false });
  });
  it("more paid than due is overpaid", () => {
    expect(look({ total: 100_000, paid: 120_000, company: 0, owed: -20_000 }).label).toBe("Overpaid");
  });
});
