import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { visibleNav } from "./nav-config";

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
