import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "./permissions";
import { staffHome } from "./staff-home";

/** Where each built-in role lands after signing in (by right, so custom roles work too). */
describe("staffHome", () => {
  const home = (code: keyof typeof DEFAULT_ROLES) => staffHome(new Set<string>(DEFAULT_ROLES[code].permissions));

  it("Finance has its own portal; the Accountant lands on the procurement desk", () => {
    expect(home("FINANCE")).toBe("/finance/dashboard");
    expect(home("ACCOUNTANT")).toBe("/staff/procurement");
  });

  it("a custom role with the dashboard right but no right to see the finance figures goes to the Finance desk, not to a forbidden page", () => {
    expect(staffHome(new Set(["dashboard.finance", "cash.handover.review"]))).toBe("/staff/accountant");
    expect(staffHome(new Set(["dashboard.finance", "finance.view"]))).toBe("/finance/dashboard");
  });

  it("the Boss, the MD, the Manager and reception keep their own homes", () => {
    expect(home("OWNER")).toBe("/admin/dashboard");
    expect(home("ADMIN")).toBe("/admin/dashboard");
    expect(home("MANAGER")).toBe("/manager/dashboard");
    expect(home("RECEPTIONIST")).toBe("/reception/dashboard");
  });
});
