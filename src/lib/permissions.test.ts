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

/** The Accountant controls the money — and nothing else: no front desk, restaurant, stores, staff accounts, settings or withdrawals. */
describe("accountant and cash handover", () => {
  const accountant = new Set(DEFAULT_ROLES.ACCOUNTANT.permissions);
  const reception = new Set(DEFAULT_ROLES.RECEPTIONIST.permissions);
  const counter = new Set(DEFAULT_ROLES.RESTAURANT_SCREEN.permissions);
  const waiter = new Set(DEFAULT_ROLES.RESTAURANT.permissions);
  const manager = new Set(DEFAULT_ROLES.MANAGER.permissions);

  it("the Accountant receives cash, keeps the accounts, expenses and prices, and reads every payment", () => {
    for (const p of [
      "dashboard.accountant", "cash.handover.view", "cash.handover.review", "cash.handover.discrepancy", "finance.view", "finance.manage", "ledger.view",
      "payments.reverse", "expenses.record", "expenses.view_all", "expenses.approve", "pricing.manage", "reports.view",
    ] as const) expect(accountant.has(p), p).toBe(true);
  });

  it("the Accountant never runs the hotel, sets the system up, settles a withdrawal by hand or works a shift", () => {
    for (const p of [
      "reservations.create", "reservations.check_in", "reservations.check_out", "restaurant.orders", "restaurant.serve", "kitchen.orders", "inventory.manage", "inventory.approve",
      "users.manage", "settings.manage", "restaurant.menu", "rooms.manage", "website.manage", "withdrawals.reconcile", "shifts.manage", "shifts.work", "cash.handover.submit",
    ] as const) expect(accountant.has(p), p).toBe(false);
  });

  it("the Accountant has full control of the money: records payments and sales, withdraws from nTZS, makes the reports, changes restaurant prices — and only reads shifts, stock and assets", () => {
    for (const p of ["payments.record", "revenue.record", "withdrawals.manage", "reports.daily.manage", "restaurant.prices", "shifts.view", "inventory.view", "assets.view"] as const) expect(accountant.has(p), p).toBe(true);
    // read-only: no stock, asset or shift changes
    for (const p of ["inventory.use", "inventory.receive", "inventory.manage", "assets.manage", "shifts.manage"] as const) expect(accountant.has(p), p).toBe(false);
    // the restaurant-prices right is narrow: only the Accountant, the Boss and the MD hold it
    for (const [name, set] of [["reception", reception], ["counter", counter], ["waiter", waiter], ["manager", manager]] as const) expect(set.has("restaurant.prices"), name).toBe(false);
  });

  it("reception and the Restaurant Counter hand cash over but never receive it; waiters have no part in it; the Manager only watches", () => {
    for (const side of [reception, counter]) {
      expect(side.has("cash.handover.submit")).toBe(true);
      for (const p of ["cash.handover.review", "cash.handover.discrepancy", "cash.handover.view", "dashboard.accountant"] as const) expect(side.has(p), p).toBe(false);
    }
    for (const p of ["cash.handover.submit", "cash.handover.review", "cash.handover.view"] as const) expect(waiter.has(p), p).toBe(false);
    expect(manager.has("cash.handover.view")).toBe(true);
    for (const p of ["cash.handover.review", "cash.handover.discrepancy", "cash.handover.submit"] as const) expect(manager.has(p), p).toBe(false);
  });

  it("the Boss and the MD hold every cash handover right", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const all = new Set(DEFAULT_ROLES[role].permissions);
      for (const p of ["cash.handover.submit", "cash.handover.view", "cash.handover.review", "cash.handover.discrepancy", "dashboard.accountant"] as const) expect(all.has(p), `${role} ${p}`).toBe(true);
    }
  });

  it("a receptionist can hand cash over after their shift has ended (the right works without a shift)", async () => {
    const { SHIFT_FREE_CODES } = await import("./permissions");
    expect(SHIFT_FREE_CODES.has("cash.handover.submit")).toBe(true);
  });
});
