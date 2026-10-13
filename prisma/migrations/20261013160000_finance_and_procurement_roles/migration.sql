-- Finance and the Accountant (owner, 2026-10-13): Finance holds the money and the purchase approvals; the Accountant does the
-- purchasing — quotations, orders, deliveries — and never approves or pays. Reception and the Counter can ask for what they need.
-- Nothing is deleted: the Finance desk's right is only renamed, and every other right row stays.

-- 1. The Finance desk's right keeps its meaning under its right name; the new rights.
UPDATE "permissions" SET "code" = 'dashboard.finance', "description" = 'Finance desk: the financial dashboard, the purchases to authorize and the cash handovers waiting to be received'
 WHERE "code" = 'dashboard.accountant' AND NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'dashboard.finance');
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_dashboard_finance', 'dashboard.finance', 'Finance desk: the financial dashboard, the purchases to authorize and the cash handovers waiting to be received'),
  ('perm_dashboard_procurement', 'dashboard.procurement', 'Procurement desk (Accountant): the purchases to quote, order, receive and follow up'),
  ('perm_procurement_manage', 'procurement.manage', 'Procurement (Accountant): get supplier quotations, propose a purchase, issue the order once Finance authorized it, record deliveries and attach supplier invoices — never approve or pay'),
  ('perm_purchases_authorize', 'purchases.authorize', 'Authorize a purchase quotation above the approved budget (Finance; above Finance''s limit, the Boss or the MD)'),
  ('perm_purchases_pay', 'purchases.pay', 'Verify a supplier invoice and record the payment to the supplier (Finance)')
ON CONFLICT ("code") DO NOTHING;
UPDATE "permissions" SET "description" = 'Hand over the cash you collected: count it and send it to Finance (reception and the Restaurant Counter)' WHERE "code" = 'cash.handover.submit';
UPDATE "permissions" SET "description" = 'Receive cash handovers (Finance): confirm what was received, return one for correction, reject one, choose the cash account' WHERE "code" = 'cash.handover.review';
UPDATE "permissions" SET "description" = 'Accept a cash handover that is short or over, with the reason (Finance)' WHERE "code" = 'cash.handover.discrepancy';
UPDATE "permissions" SET "description" = 'Change the selling prices of menu items (Finance) — nothing else on the menu; each order keeps the price it was placed at' WHERE "code" = 'restaurant.prices';

-- 2. The Finance role: everything the Accountant role holds today, plus the purchase authorization and supplier payments.
INSERT INTO "roles" ("id", "code", "name", "description", "isSystem", "createdAt", "updatedAt")
VALUES ('role_finance', 'FINANCE', 'Finance',
  'Financial authority: reviews and authorizes purchases, pays suppliers, receives the cash handed over by reception and the Restaurant Counter, keeps the accounts, expenses, prices and discounts in order and reports on them.', true, now(), now())
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT f."id", rp."permissionId" FROM "role_permissions" rp
  JOIN "roles" a ON a."id" = rp."roleId" AND a."code" = 'ACCOUNTANT'
  JOIN "roles" f ON f."code" = 'FINANCE'
ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('purchases.authorize', 'purchases.pay')
WHERE r."code" = 'FINANCE'
ON CONFLICT DO NOTHING;

-- 3. The Accountant becomes procurement only (the money rights it held are Finance's now).
DELETE FROM "role_permissions" WHERE "roleId" = (SELECT "id" FROM "roles" WHERE "code" = 'ACCOUNTANT');
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('dashboard.procurement', 'procurement.manage', 'inventory.view', 'inventory.request')
WHERE r."code" = 'ACCOUNTANT'
ON CONFLICT DO NOTHING;
UPDATE "roles" SET "description" = 'Procurement and purchasing: gets supplier quotations for approved requests, issues the order once Finance authorized it, records deliveries and documents. Never approves or pays.' WHERE "code" = 'ACCOUNTANT';

-- 4. The Boss and the MD hold every right.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('dashboard.procurement', 'procurement.manage', 'purchases.authorize', 'purchases.pay')
WHERE r."code" IN ('OWNER', 'ADMIN')
ON CONFLICT DO NOTHING;

-- 5. Reception and the shared Restaurant Counter can ask for what they need (the kitchen already can).
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'inventory.request'
WHERE r."code" IN ('RECEPTIONIST', 'RESTAURANT_SCREEN')
ON CONFLICT DO NOTHING;
