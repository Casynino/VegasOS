import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, DEVELOPER_DENIED, DEVELOPER_ONLY } from "@/lib/permissions";
import { DEVELOPER_CONSOLE, NAV, developerConsoleNav, navFor, visibleNav } from "./nav-config";

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

describe("the Audit trail (Boss, MD) and the Developer's console", () => {
  const permsOf = (role: keyof typeof DEFAULT_ROLES) => new Set<string>(DEFAULT_ROLES[role].permissions);
  const labelsOf = (role: keyof typeof DEFAULT_ROLES) => visibleNav(permsOf(role)).flatMap((s) => s.items.map((i) => i.label));
  const itemOf = (label: string) => NAV.flatMap((s) => s.items).filter((i) => i.label === label);
  /** What a Developer is given while working as someone: that person's rights minus every money right and the Developer-only right. */
  const asPerson = (role: keyof typeof DEFAULT_ROLES) => new Set<string>(DEFAULT_ROLES[role].permissions.filter((p) => !(DEVELOPER_DENIED as readonly string[]).includes(p) && !(DEVELOPER_ONLY as readonly string[]).includes(p)));
  const flat = (sections: ReturnType<typeof navFor>) => sections.flatMap((s) => s.items.map((i) => i.label));
  const developerAsItself = { actorType: "DEVELOPER" as const, workAs: null, permissions: permsOf("DEVELOPER") };

  it("a Developer signed in as itself sees ONLY the Developer console: Home, Audit, Business, Access — in that order, under that heading", () => {
    const sections = navFor(developerAsItself, { home: "/staff/developer" });
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Developer console");
    expect(sections[0].titled).toBe(true);
    expect(sections[0].items.map((i) => [i.label, i.href])).toEqual([
      ["Home", "/staff/developer"],
      ["Audit", "/staff/developer/audit"],
      ["Business", "/staff/developer/business"],
      ["Access", "/staff/developer/access"],
    ]);
    // nothing of the hotel's own menu: no Finance, Front office, Bookings, People…, no "Audit trail" of the Boss
    expect(flat(sections)).not.toContain("Audit trail");
    expect(flat(sections)).not.toContain("Overview");
  });

  it("the console's Home stays in the menu even though it is the person's home (the console has no separate Home pill)", () => {
    expect(navFor(developerAsItself, { home: "/staff/developer" })[0].items[0].href).toBe("/staff/developer");
  });

  it("each console item needs the Developer-only right — a role without it gets no console", () => {
    for (const item of DEVELOPER_CONSOLE.items) expect(item.anyOf).toEqual(["developer.access"]);
    expect(developerConsoleNav(new Set(["audit.view", "dashboard.admin"]))).toEqual([]);
    expect(developerConsoleNav(new Set(["developer.access"]))).toHaveLength(1);
    // staff with the right of a Developer's but a STAFF identity still get the normal menu (the identity decides what shows)
    expect(navFor({ actorType: "STAFF", workAs: null, permissions: permsOf("OWNER") })).toEqual(visibleNav(permsOf("OWNER")));
  });

  it("a Developer WORKING AS Reception sees Reception's own menu, built from Reception's rights — no console", () => {
    const asReception = { actorType: "DEVELOPER" as const, workAs: { developerId: "d1", developerName: "Dev", startedAt: new Date() }, permissions: asPerson("RECEPTIONIST") };
    const sections = navFor(asReception, { home: "/reception/dashboard" });
    expect(sections).toEqual(visibleNav(asPerson("RECEPTIONIST"), { home: "/reception/dashboard" }));
    const labels = flat(sections);
    expect(labels).toContain("Check-in");
    expect(labels).toContain("Check-out");
    expect(labels).toContain("Stays");
    expect(sections.map((s) => s.title)).not.toContain("Developer console");
    expect(labels).not.toContain("Audit");
    expect(labels).not.toContain("Access");
    // and the same as a real receptionist sees (the money rights Reception holds are not in the Developer's copy — nothing extra shows)
    for (const l of labels) expect(flat(visibleNav(permsOf("RECEPTIONIST"), { home: "/reception/dashboard" })), l).toContain(l);
  });

  it("a Developer working as the Boss does not get the Boss's money pages — they come from the rights minus the money rights", () => {
    const asBoss = { actorType: "DEVELOPER" as const, workAs: { developerId: "d1", developerName: "Dev", startedAt: new Date() }, permissions: asPerson("OWNER") };
    const labels = flat(navFor(asBoss, { home: "/admin/dashboard" }));
    expect(labels).not.toContain("Withdraw funds");
    expect(labels).not.toContain("Developer console");
  });

  it("the Boss and the MD read the Audit trail (Developer actions are theirs to see) but never get the Developer console", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const labels = labelsOf(role);
      expect(labels, role).toContain("Audit trail");
      expect(labels, role).not.toContain("Developer console");
      expect(flat(navFor({ actorType: "STAFF", workAs: null, permissions: permsOf(role) })), role).toContain("Audit trail");
      expect(flat(navFor({ actorType: "STAFF", workAs: null, permissions: permsOf(role) })), role).not.toContain("Access");
    }
  });

  it("every other role — Manager, Finance, Accountant, Reception, the restaurant, the kitchen, the driver — sees neither", () => {
    for (const role of ["MANAGER", "FINANCE", "ACCOUNTANT", "RECEPTIONIST", "RESTAURANT", "RESTAURANT_SCREEN", "KITCHEN", "DRIVER"] as const) {
      const labels = labelsOf(role);
      expect(labels, role).not.toContain("Audit trail");
      expect(labels, role).not.toContain("Developer console");
    }
  });

  it("the normal menu holds the Audit trail (audit.view) and no longer the old 'Developer console' item — the console replaced it", () => {
    expect(itemOf("Audit trail")).toEqual([expect.objectContaining({ href: "/staff/audit", anyOf: ["audit.view"] })]);
    expect(itemOf("Audit trail")[0].allOf).toBeUndefined();
    expect(itemOf("Developer console")).toEqual([]);
    expect(visibleNav(permsOf("OWNER")).find((s) => s.title === "People")!.items.map((i) => i.label)).toContain("Audit trail");
  });

  it("staff menus are unchanged by the console: the normal menu of any non-Developer is exactly visibleNav", () => {
    for (const role of ["OWNER", "ADMIN", "MANAGER", "FINANCE", "ACCOUNTANT", "RECEPTIONIST", "RESTAURANT", "KITCHEN", "DRIVER"] as const) {
      expect(navFor({ actorType: "STAFF", workAs: null, permissions: permsOf(role) }, { home: "/x" }), role).toEqual(visibleNav(permsOf(role), { home: "/x" }));
    }
  });

  it("a right alone decides in the normal menu: audit.view gives the Audit trail, the Developer-only right gives nothing there", () => {
    expect(visibleNav(new Set(["audit.view"])).flatMap((s) => s.items.map((i) => i.label))).toEqual(["Audit trail"]);
    expect(visibleNav(new Set(["developer.access"])).flatMap((s) => s.items.map((i) => i.label))).toEqual([]);
  });
});
