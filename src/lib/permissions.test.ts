import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, DEFAULT_ROLES } from "./permissions";

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
