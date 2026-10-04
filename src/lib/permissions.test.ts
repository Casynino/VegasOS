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
