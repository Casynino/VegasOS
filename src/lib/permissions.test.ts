import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, DEFAULT_ROLES, DEVELOPER_ACCOUNT_RIGHTS, DEVELOPER_ALLOWED, DEVELOPER_DENIED, DEVELOPER_LOCKED_SETTINGS, DEVELOPER_ONLY, DEVELOPER_ROLE_CODE, isDeveloperOnly, PERMISSIONS } from "./permissions";

/** Manager = hotel operations authority; Admin (MD) = everything the Manager has, plus set-up and control. */
describe("manager and admin roles", () => {
  const manager = new Set(DEFAULT_ROLES.MANAGER.permissions);
  const admin = new Set(DEFAULT_ROLES.ADMIN.permissions);

  it("the manager has real operational authority", () => {
    for (const p of [
      "dashboard.manager", "reservations.edit", "reservations.cancel", "reservations.checkout_override", "reservations.checkin_override",
      "rooms.block", "rooms.status.update", "revenue.void", "requests.manage", "expenses.approve", "finance.view", "staff.activity.view",
      "inventory.view", "inventory.request", "inventory.use", "inventory.receive", "inventory.approve", "assets.view", "reports.view",
    ] as const) expect(manager.has(p), p).toBe(true);
  });

  it("set-up and control stay with the Admin", () => {
    for (const p of ["users.manage", "settings.manage", "pricing.manage", "finance.manage", "rooms.manage", "restaurant.menu", "inventory.manage", "assets.manage", "website.manage", "dashboard.admin"] as const) {
      expect(manager.has(p), p).toBe(false);
      expect(admin.has(p), p).toBe(true);
    }
  });

  it("reception takes the guests' payments and sees its Collections — Income & Expenses are managers'; waiters have no money at all; the ledger is for managers and the MD", () => {
    const reception = new Set(DEFAULT_ROLES.RECEPTIONIST.permissions);
    const waiter = new Set(DEFAULT_ROLES.RESTAURANT.permissions);
    for (const p of ["payments.record", "revenue.record"] as const) expect(reception.has(p), p).toBe(true);
    for (const p of ["expenses.record", "expenses.view_all", "expenses.approve"] as const) expect(reception.has(p), p).toBe(false);
    for (const p of ["revenue.record", "expenses.record", "expenses.view_all", "expenses.approve"] as const) expect(waiter.has(p), p).toBe(false);
    for (const staff of [reception, waiter]) {
      for (const p of ["ledger.view", "finance.view", "finance.manage", "reports.view", "pricing.manage", "settings.manage"] as const) expect(staff.has(p), p).toBe(false);
    }
    for (const p of ["ledger.view", "finance.view", "expenses.record", "expenses.view_all"] as const) expect(manager.has(p), p).toBe(true);
  });

  it("the Admin has everything the Manager has", () => {
    expect([...manager].filter((p) => !admin.has(p))).toEqual([]);
    expect(admin.size).toBe(ALL_PERMISSIONS.length);
  });
});

/** Finance holds the money and the purchase approvals; the Accountant buys — and never approves or pays. */
describe("finance, the accountant and cash handover", () => {
  const finance = new Set(DEFAULT_ROLES.FINANCE.permissions);
  const accountant = new Set(DEFAULT_ROLES.ACCOUNTANT.permissions);
  const reception = new Set(DEFAULT_ROLES.RECEPTIONIST.permissions);
  const counter = new Set(DEFAULT_ROLES.RESTAURANT_SCREEN.permissions);
  const waiter = new Set(DEFAULT_ROLES.RESTAURANT.permissions);
  const kitchen = new Set(DEFAULT_ROLES.KITCHEN.permissions);
  const manager = new Set(DEFAULT_ROLES.MANAGER.permissions);

  it("Finance receives cash, keeps the accounts, expenses and prices, reads every payment and report, and records and pays", () => {
    for (const p of [
      "dashboard.finance", "cash.handover.view", "cash.handover.review", "cash.handover.discrepancy", "finance.view", "finance.manage", "ledger.view",
      "payments.reverse", "expenses.record", "expenses.view_all", "expenses.approve", "pricing.manage", "reports.view",
      "payments.record", "revenue.record", "withdrawals.manage", "reports.daily.manage", "restaurant.prices", "shifts.view", "inventory.view", "assets.view",
    ] as const) expect(finance.has(p), p).toBe(true);
  });

  it("Finance organizes the purchasing too (owner, 2026-10-13): quotations, orders, deliveries, invoices, what was bought and received", () => {
    for (const p of ["procurement.manage", "inventory.receive", "purchases.authorize", "purchases.pay"] as const) expect(finance.has(p), p).toBe(true);
  });

  it("Finance also authorizes purchases and pays suppliers — and still never runs the hotel, sets the system up or settles a withdrawal by hand", () => {
    for (const p of ["purchases.authorize", "purchases.pay"] as const) expect(finance.has(p), p).toBe(true);
    for (const p of [
      "reservations.create", "reservations.check_in", "reservations.check_out", "restaurant.orders", "restaurant.serve", "kitchen.orders", "inventory.manage", "inventory.approve",
      "users.manage", "settings.manage", "restaurant.menu", "rooms.manage", "website.manage", "withdrawals.reconcile", "shifts.manage", "shifts.work", "cash.handover.submit",
    ] as const) expect(finance.has(p), p).toBe(false);
  });

  it("the Accountant does the purchasing only: quotations, orders, deliveries, documents — and has no money, approval or payment right at all", () => {
    for (const p of ["dashboard.procurement", "procurement.manage", "inventory.view", "inventory.request"] as const) expect(accountant.has(p), p).toBe(true);
    for (const p of [
      "expenses.approve", "expenses.record", "expenses.void", "purchases.authorize", "purchases.pay", "finance.view", "finance.manage", "ledger.view", "payments.record", "payments.reverse",
      "revenue.record", "revenue.void", "withdrawals.manage", "pricing.manage", "restaurant.prices", "reports.view", "reports.daily.manage", "cash.handover.review", "cash.handover.submit",
      "inventory.receive", "inventory.approve", "inventory.manage", "dashboard.finance",
    ] as const) expect(accountant.has(p), p).toBe(false);
  });

  it("only Finance, the Boss and the MD authorize a quotation or pay a supplier — the Manager, the Accountant and the departments cannot", () => {
    for (const [name, set] of [["accountant", accountant], ["manager", manager], ["reception", reception], ["counter", counter], ["waiter", waiter], ["kitchen", kitchen]] as const) {
      for (const p of ["purchases.authorize", "purchases.pay"] as const) expect(set.has(p), `${name} ${p}`).toBe(false);
    }
    for (const role of ["OWNER", "ADMIN"] as const) for (const p of ["purchases.authorize", "purchases.pay", "procurement.manage"] as const) expect(new Set(DEFAULT_ROLES[role].permissions).has(p), `${role} ${p}`).toBe(true);
  });

  it("Reception, the Restaurant Counter and the kitchen can ask for what they need; waiters still do not (owner, 2026-10-04)", () => {
    for (const [name, set] of [["reception", reception], ["counter", counter], ["kitchen", kitchen]] as const) expect(set.has("inventory.request"), name).toBe(true);
    expect(waiter.has("inventory.request")).toBe(false);
    // asking is all they do: they cannot review, buy, authorize or pay
    for (const set of [reception, counter, kitchen]) for (const p of ["expenses.approve", "inventory.receive", "purchases.authorize", "purchases.pay", "procurement.manage"] as const) expect(set.has(p), p).toBe(false);
  });

  it("the Manager keeps what the Manager has (owner, 2026-10-13: nothing changes for the Manager) and gains no purchase authority", () => {
    for (const p of ["expenses.approve", "expenses.void", "payments.reverse", "inventory.receive", "inventory.approve", "finance.view", "ledger.view", "cash.handover.view"] as const) expect(manager.has(p), p).toBe(true);
    for (const p of ["cash.handover.review", "cash.handover.discrepancy", "cash.handover.submit", "withdrawals.manage", "procurement.manage"] as const) expect(manager.has(p), p).toBe(false);
  });

  it("Finance, the departments and the Boss and MD hold the cash handover rights they should", () => {
    for (const side of [reception, counter]) {
      expect(side.has("cash.handover.submit")).toBe(true);
      for (const p of ["cash.handover.review", "cash.handover.discrepancy", "cash.handover.view", "dashboard.finance"] as const) expect(side.has(p), p).toBe(false);
    }
    for (const p of ["cash.handover.submit", "cash.handover.review", "cash.handover.view"] as const) expect(waiter.has(p), p).toBe(false);
    for (const role of ["OWNER", "ADMIN"] as const) {
      const all = new Set(DEFAULT_ROLES[role].permissions);
      for (const p of ["cash.handover.submit", "cash.handover.view", "cash.handover.review", "cash.handover.discrepancy", "dashboard.finance", "dashboard.procurement"] as const) expect(all.has(p), `${role} ${p}`).toBe(true);
    }
  });

  it("the restaurant-prices right is narrow: Finance, the Boss and the MD only", () => {
    for (const [name, set] of [["reception", reception], ["counter", counter], ["waiter", waiter], ["manager", manager], ["accountant", accountant]] as const) expect(set.has("restaurant.prices"), name).toBe(false);
  });

  it("a receptionist can hand cash over after their shift has ended (the right works without a shift)", async () => {
    const { SHIFT_FREE_CODES } = await import("./permissions");
    expect(SHIFT_FREE_CODES.has("cash.handover.submit")).toBe(true);
  });
});

/**
 * The Developer account (owner, 2026-10-14): a separate identity with the operational rights and no right to write or decide about money.
 * "developer.access" is held by the Developer role ONLY — not by the Boss, the MD or any staff role. "audit.view" (read the audit
 * trail) is held by the Boss, the MD and the Developer.
 */
describe("the Developer account's rights", () => {
  const roleSet = (code: string) => new Set<string>(DEFAULT_ROLES[code].permissions);
  const developer = roleSet("DEVELOPER");
  const denied = new Set<string>(DEVELOPER_DENIED);
  const others = Object.keys(DEFAULT_ROLES).filter((c) => c !== "DEVELOPER");

  it("the role is the one the code names, and the Developer-only right exists", () => {
    expect(DEVELOPER_ROLE_CODE).toBe("DEVELOPER");
    expect(DEFAULT_ROLES[DEVELOPER_ROLE_CODE]).toBeDefined();
    expect(DEVELOPER_ONLY).toEqual(["developer.access"]);
    expect(isDeveloperOnly("developer.access")).toBe(true);
    expect(isDeveloperOnly("audit.view")).toBe(false);
    expect("developer.access" in PERMISSIONS).toBe(true);
    expect("audit.view" in PERMISSIONS).toBe(true);
  });

  it("the Boss and the MD read the audit trail — but never hold the Developer's right", () => {
    for (const code of ["OWNER", "ADMIN"]) {
      const set = roleSet(code);
      expect(set.has("audit.view"), `${code} audit.view`).toBe(true);
      expect(set.has("developer.access"), `${code} developer.access`).toBe(false);
    }
  });

  it("the Developer holds the Developer right and can read the audit trail", () => {
    expect(developer.has("developer.access")).toBe(true);
    expect(developer.has("audit.view")).toBe(true);
  });

  it("no other role — Manager, Finance, Accountant, reception, waiters, kitchen, counter, driver — holds the Developer's right", () => {
    expect(others).toEqual(expect.arrayContaining(["MANAGER", "FINANCE", "ACCOUNTANT", "RECEPTIONIST", "RESTAURANT", "KITCHEN", "RESTAURANT_SCREEN", "DRIVER", "OWNER", "ADMIN"]));
    for (const code of others) expect(roleSet(code).has("developer.access"), code).toBe(false);
  });

  it("only the Boss, the MD and the Developer can read the audit trail (it shows everyone's actions)", () => {
    const readers = Object.keys(DEFAULT_ROLES).filter((c) => roleSet(c).has("audit.view")).sort();
    expect(readers).toEqual(["ADMIN", "DEVELOPER", "OWNER"]);
  });

  it("the Developer holds none of the money-writing rights, whatever else it can do", () => {
    expect(DEVELOPER_DENIED.length).toBeGreaterThan(0);
    for (const p of DEVELOPER_DENIED) {
      expect(p in PERMISSIONS, `${p} is a real right`).toBe(true);
      expect(developer.has(p), p).toBe(false);
    }
    // The named cases, so removing one from the list by mistake fails here: record, reverse, approve, pay, withdraw, confirm, waive, edit invoices.
    for (const p of [
      "payments.record", "payments.reverse", "revenue.record", "revenue.void", "expenses.record", "expenses.approve", "expenses.void", "purchases.pay",
      "purchases.authorize", "finance.manage", "withdrawals.manage", "withdrawals.reconcile", "restaurant.payments.confirm", "cash.handover.submit",
      "cash.handover.review", "cash.handover.discrepancy", "reservations.confirm_unpaid", "reservations.checkout_override", "invoices.manage",
    ] as const) expect(denied.has(p), `${p} stays denied`).toBe(true);
  });

  it("the Developer cannot decide about money either: discounts, prices, credit limits, purchasing, stock costs, cancellation settlements, financial reports", () => {
    for (const p of [
      "reservations.discount_override", "reservations.cancel", "pricing.manage", "restaurant.menu", "restaurant.prices", "restaurant.device", "spin.manage",
      "corporate.manage", "procurement.manage", "inventory.receive", "inventory.approve", "inventory.manage", "reports.daily.manage",
    ] as const) {
      expect(denied.has(p), `${p} is denied`).toBe(true);
      expect(developer.has(p), `${p} is not held`).toBe(false);
    }
  });

  it("the Developer cannot create or change accounts, passwords, login emails, roles or rights: it holds no 'users.manage' (owner, 2026-10-18); the Boss and the MD keep it", () => {
    expect(developer.has("users.manage")).toBe(false);
    expect(denied.has("users.manage")).toBe(true);
    expect(DEVELOPER_ALLOWED as readonly string[]).not.toContain("users.manage");
    expect(DEVELOPER_ACCOUNT_RIGHTS).toEqual(["users.manage"]);
    for (const code of DEVELOPER_ACCOUNT_RIGHTS) expect(denied.has(code), `${code} is one of the denied rights`).toBe(true);
    for (const code of ["OWNER", "ADMIN"]) expect(roleSet(code).has("users.manage"), code).toBe(true);
    // It holds 56 rights: the allowed ones and its own (it was 57 while it held 'users.manage').
    expect(developer.size).toBe(56);
    expect(DEVELOPER_ALLOWED.length + DEVELOPER_ONLY.length).toBe(56);
  });

  it("the Developer holds the operational rights: reservations, rooms, settings, reports, ledger, finance view", () => {
    for (const p of [
      "reservations.view", "reservations.create", "reservations.edit", "reservations.check_in", "reservations.check_out",
      "rooms.view", "rooms.status.update", "rooms.manage", "rooms.block", "settings.manage", "reports.view", "ledger.view", "finance.view",
      "shifts.view", "audit.view", "staff.activity.view", "guests.view", "inventory.view", "assets.view",
    ] as const) expect(developer.has(p), p).toBe(true);
    // Every reservations.* and rooms.* right the Developer is not explicitly denied.
    for (const p of Object.keys(PERMISSIONS).filter((c) => /^(reservations|rooms)\./.test(c) && !denied.has(c))) expect(developer.has(p), p).toBe(true);
  });

  it("the Developer holds every right a business role can hold, except the denied ones — nothing is quietly left out (and nothing is added by accident)", () => {
    const missing = ALL_PERMISSIONS.filter((p) => !developer.has(p) && !denied.has(p));
    expect(missing).toEqual([]);
    const extra = [...developer].filter((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p) && !isDeveloperOnly(p));
    expect(extra).toEqual([]);
  });

  it("ALL_PERMISSIONS (what the Boss and the MD hold, and what the Users page can hand out) never holds a Developer-only right", () => {
    for (const p of ALL_PERMISSIONS) expect(isDeveloperOnly(p), p).toBe(false);
    expect(ALL_PERMISSIONS).not.toContain("developer.access");
    expect(ALL_PERMISSIONS).toContain("audit.view");
    for (const code of ["OWNER", "ADMIN"]) expect(roleSet(code).size, code).toBe(ALL_PERMISSIONS.length);
  });

  it("no business role has the same rights as the Developer role (the Developer is its own identity, not a renamed Boss)", () => {
    const sameAsDeveloper = (set: Set<string>) => set.size === developer.size && [...set].every((p) => developer.has(p));
    for (const code of others) expect(sameAsDeveloper(roleSet(code)), code).toBe(false);
    // And the Developer is not the Boss or the MD under another name: it has less (no money) and more (its own right).
    for (const code of ["OWNER", "ADMIN"]) {
      expect([...roleSet(code)].filter((p) => !developer.has(p)).length, `${code} holds rights the Developer lacks`).toBeGreaterThan(0);
      expect([...developer].filter((p) => !roleSet(code).has(p)), `${code} lacks only the Developer's own right`).toEqual(["developer.access"]);
    }
  });
});

/**
 * The Developer role is an ALLOW-LIST (owner, 2026-10-14): a right added in future is not given to the Developer until a person
 * decides which list it belongs to. These tests are the guard.
 */
describe("the Developer role is an explicit allow-list", () => {
  const allowed = new Set<string>(DEVELOPER_ALLOWED);
  const denied = new Set<string>(DEVELOPER_DENIED);
  const only = new Set<string>(DEVELOPER_ONLY);
  const developer = DEFAULT_ROLES.DEVELOPER.permissions as readonly string[];

  it("every right is in exactly one of DEVELOPER_ALLOWED, DEVELOPER_DENIED or DEVELOPER_ONLY", () => {
    for (const code of Object.keys(PERMISSIONS)) {
      const lists = [["DEVELOPER_ALLOWED", allowed], ["DEVELOPER_DENIED", denied], ["DEVELOPER_ONLY", only]].filter(([, set]) => (set as Set<string>).has(code)).map(([name]) => name);
      expect(lists.length > 0, `${code}: classify this new right for the Developer role (put it in DEVELOPER_ALLOWED or DEVELOPER_DENIED in src/lib/permissions.ts, and in the migration if allowed)`).toBe(true);
      expect(lists, `${code} is in more than one Developer list`).toHaveLength(1);
    }
  });

  it("the three lists share nothing, hold no repeats and name only real rights", () => {
    for (const [name, list] of [["DEVELOPER_ALLOWED", DEVELOPER_ALLOWED], ["DEVELOPER_DENIED", DEVELOPER_DENIED], ["DEVELOPER_ONLY", DEVELOPER_ONLY]] as const) {
      expect(new Set(list).size, `${name} has a repeated right`).toBe(list.length);
      for (const code of list) expect(code in PERMISSIONS, `${name}: ${code} is not a real right`).toBe(true);
    }
    for (const code of allowed) {
      expect(denied.has(code), `${code} is both allowed and denied`).toBe(false);
      expect(only.has(code), `${code} is both allowed and developer-only`).toBe(false);
    }
    for (const code of denied) expect(only.has(code), `${code} is both denied and developer-only`).toBe(false);
  });

  it("the Developer role holds precisely the allowed rights plus the developer-only ones — nothing else, nothing less", () => {
    expect([...developer].sort()).toEqual([...DEVELOPER_ALLOWED, ...DEVELOPER_ONLY].sort());
    expect(new Set(developer).size).toBe(developer.length);
    for (const code of developer) expect(denied.has(code), `${code} is denied but held`).toBe(false);
  });

  it("every denied right is one a business role can hold, and the Boss and the MD keep all of them", () => {
    for (const code of DEVELOPER_DENIED) {
      expect(ALL_PERMISSIONS as readonly string[], code).toContain(code);
      for (const role of ["OWNER", "ADMIN"]) expect(DEFAULT_ROLES[role].permissions as readonly string[], `${role} ${code}`).toContain(code);
    }
  });

  it("the database migration grants the Developer role exactly the allowed rights and the developer-only right", () => {
    const sql = readFileSync(path.resolve(import.meta.dirname, "../../prisma/migrations/20261014090000_developer_account/migration.sql"), "utf8");
    const block = sql.match(/r\."code" = 'DEVELOPER' AND p\."code" IN \(([\s\S]*?)\)\s*ON CONFLICT/);
    expect(block, "the migration's list of the Developer's rights was not found").not.toBeNull();
    const granted = [...block![1].matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
    expect(new Set(granted).size, "a right is repeated in the migration").toBe(granted.length);
    expect([...granted].sort()).toEqual([...DEVELOPER_ALLOWED, ...DEVELOPER_ONLY].sort());
  });

  it("the settings the Developer cannot change include where guests pay and every money limit, and each is a real settings field", () => {
    const locked = new Set<string>(DEVELOPER_LOCKED_SETTINGS);
    for (const key of [
      "bankAccountNumber", "mobileMoneyNumber", "bankName", "bankAccountName", "mobileMoneyAccountName",
      "expenseApprovalThreshold", "financeAuthorizationLimit", "purchaseApproverMustDiffer", "reportRecipients",
    ]) expect(locked.has(key), key).toBe(true);
    expect(new Set(DEVELOPER_LOCKED_SETTINGS).size).toBe(DEVELOPER_LOCKED_SETTINGS.length);
    const schema = readFileSync(path.resolve(import.meta.dirname, "../../prisma/schema.prisma"), "utf8");
    const model = schema.match(/model HotelSettings \{([\s\S]*?)\n\}/)?.[1] ?? "";
    for (const key of DEVELOPER_LOCKED_SETTINGS) expect(new RegExp(`^\\s+${key}\\s`, "m").test(model), `${key} is not a HotelSettings field`).toBe(true);
  });
});
