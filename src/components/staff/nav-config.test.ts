import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { NAV, visibleNav } from "./nav-config";

describe("the Finance menu", () => {
  it("starts with Overview, then Income, Expenses and Accounts, then goes from the shortest name to the longest", () => {
    const section = visibleNav(new Set<string>(DEFAULT_ROLES.FINANCE.permissions), { home: "/finance/dashboard" }).find((s) => s.title === "Finance")!;
    const labels = section.items.map((i) => i.label);
    expect(labels.slice(0, 4)).toEqual(["Overview", "Income", "Expenses", "Accounts"]);
    const rest = labels.slice(4);
    expect(rest).toEqual([...rest].sort((a, b) => a.length - b.length || a.localeCompare(b)));
    // Finance's Home is the Home pill — not listed again; and the old "Finance desk" is gone
    expect(labels).not.toContain("Finance dashboard");
    expect(labels).not.toContain("Finance desk");
  });

  it("the Boss, the MD and the Manager do not get Finance's Home in their menu — they have their own dashboard", () => {
    for (const role of ["OWNER", "ADMIN", "MANAGER"] as const) {
      const labels = visibleNav(new Set<string>(DEFAULT_ROLES[role].permissions)).flatMap((s) => s.items.map((i) => i.label));
      expect(labels, role).not.toContain("Finance dashboard");
      expect(labels, role).not.toContain("Finance desk");
    }
  });
});

describe("the Stores menu", () => {
  it("goes from the shortest name to the longest", () => {
    for (const role of ["OWNER", "ADMIN", "MANAGER", "FINANCE"] as const) {
      const labels = visibleNav(new Set<string>(DEFAULT_ROLES[role].permissions)).find((s) => s.title === "Stores")!.items.map((i) => i.label);
      expect(labels, role).toEqual([...labels].sort((a, b) => a.length - b.length || a.localeCompare(b)));
    }
    const all = visibleNav(new Set<string>(DEFAULT_ROLES.OWNER.permissions)).find((s) => s.title === "Stores")!.items.map((i) => i.label);
    expect(all).toEqual(["Assets", "Inventory", "Procurement", "Purchase requests"]);
  });
});

describe("Reception's menu", () => {
  it("the guests' requests and the purchase requests sit together at the bottom of Hotel services", () => {
    const section = visibleNav(new Set<string>(DEFAULT_ROLES.RECEPTIONIST.permissions)).find((x) => x.title === "Hotel services")!;
    const labels = section.items.map((i) => i.label);
    expect(labels.slice(-2)).toEqual(["Guest requests", "Purchase requests"]);
    expect(visibleNav(new Set<string>(DEFAULT_ROLES.RECEPTIONIST.permissions)).find((x) => x.title === "Front office")!.items.map((i) => i.label)).not.toContain("Purchase requests");
    expect(labels).not.toContain("Requests");
  });
});

describe("the Audit trail and the Developer console", () => {
  const labelsOf = (role: keyof typeof DEFAULT_ROLES) => visibleNav(new Set<string>(DEFAULT_ROLES[role].permissions)).flatMap((s) => s.items.map((i) => i.label));
  const itemOf = (label: string) => NAV.flatMap((s) => s.items).filter((i) => i.label === label);

  it("a Developer sees both", () => {
    const labels = labelsOf("DEVELOPER");
    expect(labels).toContain("Audit trail");
    expect(labels).toContain("Developer console");
  });

  it("the Boss and the MD read the Audit trail (Developer actions are theirs to see) but never get the Developer console", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const labels = labelsOf(role);
      expect(labels, role).toContain("Audit trail");
      expect(labels, role).not.toContain("Developer console");
    }
  });

  it("every other role — Manager, Finance, Accountant, Reception, the restaurant, the kitchen, the driver — sees neither", () => {
    for (const role of ["MANAGER", "FINANCE", "ACCOUNTANT", "RECEPTIONIST", "RESTAURANT", "RESTAURANT_SCREEN", "KITCHEN", "DRIVER"] as const) {
      const labels = labelsOf(role);
      expect(labels, role).not.toContain("Audit trail");
      expect(labels, role).not.toContain("Developer console");
    }
  });

  it("the items point at their pages and need exactly one right each: audit.view, developer.access", () => {
    expect(itemOf("Audit trail")).toEqual([expect.objectContaining({ href: "/staff/audit", anyOf: ["audit.view"] })]);
    expect(itemOf("Developer console")).toEqual([expect.objectContaining({ href: "/staff/developer", anyOf: ["developer.access"] })]);
    expect(itemOf("Audit trail")[0].allOf).toBeUndefined();
    expect(itemOf("Developer console")[0].hideIf).toBeUndefined();
  });

  it("the Audit trail is in People and the Developer console in Settings", () => {
    const all = new Set<string>(DEFAULT_ROLES.DEVELOPER.permissions);
    const sections = visibleNav(all);
    expect(sections.find((s) => s.title === "People")!.items.map((i) => i.label)).toContain("Audit trail");
    expect(sections.find((s) => s.title === "Settings")!.items.map((i) => i.label)).toContain("Developer console");
  });

  it("a right alone decides: a role with only audit.view gets the Audit trail, and the Developer-only right gives nothing else", () => {
    expect(visibleNav(new Set(["audit.view"])).flatMap((s) => s.items.map((i) => i.label))).toEqual(["Audit trail"]);
    expect(visibleNav(new Set(["developer.access"])).flatMap((s) => s.items.map((i) => i.label))).toEqual(["Developer console"]);
  });
});
