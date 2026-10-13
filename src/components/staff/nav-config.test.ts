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
});
