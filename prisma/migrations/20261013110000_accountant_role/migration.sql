-- The Accountant (finance controller) and the cash handover rights. Additive only: new permission rows, one new role,
-- and grants — nothing existing is removed or changed.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_dashboard_accountant', 'dashboard.accountant', 'Accountant portal: the financial dashboard and the cash handovers waiting to be received'),
  ('perm_cash_handover_submit', 'cash.handover.submit', 'Hand over the cash you collected: count it and send it to the Accountant (reception and the Restaurant Counter)'),
  ('perm_cash_handover_view', 'cash.handover.view', 'See the cash handovers, who still holds cash and the differences (read-only)'),
  ('perm_cash_handover_review', 'cash.handover.review', 'Receive cash handovers (Accountant): confirm what was received, return one for correction, reject one, choose the cash account'),
  ('perm_cash_handover_discrepancy', 'cash.handover.discrepancy', 'Accept a cash handover that is short or over, with the reason (Accountant)')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "roles" ("id", "code", "name", "description", "isSystem", "createdAt", "updatedAt")
VALUES ('role_accountant', 'ACCOUNTANT', 'Accountant',
  'Finance controller: reviews every payment, receives the cash handed over by reception and the Restaurant Counter, keeps the accounts, expenses, prices and discounts in order and reports on them.', true, now(), now())
ON CONFLICT ("code") DO NOTHING;

-- The Accountant. No withdrawals, no settings, no staff accounts, no regenerating the Boss's reports.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN (
  'dashboard.accountant', 'reports.view', 'finance.view', 'finance.manage', 'ledger.view',
  'cash.handover.view', 'cash.handover.review', 'cash.handover.discrepancy',
  'payments.reverse', 'revenue.void', 'invoices.view', 'invoices.manage', 'corporate.view', 'corporate.manage',
  'expenses.record', 'expenses.view_all', 'expenses.approve', 'expenses.void', 'pricing.manage',
  'reservations.view', 'guests.view')
WHERE r."code" = 'ACCOUNTANT'
ON CONFLICT DO NOTHING;

-- The Boss and the MD hold every right.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN
  ('dashboard.accountant', 'cash.handover.submit', 'cash.handover.view', 'cash.handover.review', 'cash.handover.discrepancy')
WHERE r."code" IN ('OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;

-- Reception and the shared Restaurant Counter hand their cash over; the Manager watches. Waiters get nothing.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'cash.handover.submit'
WHERE r."code" IN ('RECEPTIONIST', 'RESTAURANT_SCREEN')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'cash.handover.view'
WHERE r."code" = 'MANAGER'
ON CONFLICT DO NOTHING;
