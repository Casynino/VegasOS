import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, DEVELOPER_DENIED, DEVELOPER_ONLY } from "./permissions";
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

  it("the Developer lands on its own console — before the Boss-level dashboard rights it also holds", () => {
    expect(DEFAULT_ROLES.DEVELOPER.permissions).toContain("dashboard.admin");
    expect(home("DEVELOPER")).toBe("/staff/developer");
  });

  it("only the Developer-only right opens the console: nobody else's role goes there", () => {
    for (const code of Object.keys(DEFAULT_ROLES) as (keyof typeof DEFAULT_ROLES)[]) {
      if (code === "DEVELOPER") continue;
      expect(home(code), code).not.toBe("/staff/developer");
    }
    expect(staffHome(new Set(["developer.access"]))).toBe("/staff/developer");
  });

  it("a Developer working as someone holds that person's rights minus the money rights and the Developer-only right: home is the person's own", () => {
    const asPerson = (code: keyof typeof DEFAULT_ROLES) => new Set<string>(DEFAULT_ROLES[code].permissions.filter((p) => !(DEVELOPER_DENIED as readonly string[]).includes(p) && !(DEVELOPER_ONLY as readonly string[]).includes(p)));
    expect(staffHome(asPerson("RECEPTIONIST"))).toBe("/reception/dashboard");
    expect(staffHome(asPerson("MANAGER"))).toBe("/manager/dashboard");
    expect(staffHome(asPerson("RESTAURANT"))).toBe("/staff/restaurant");
  });
});
