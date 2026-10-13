-- Finance organizes the hotel's purchasing (owner, 2026-10-13): quotations, orders, deliveries, supplier invoices, and recording what was
-- bought and received. The Accountant (if the hotel has one) assists and still never approves or pays. Only rights are added — nothing is removed.
UPDATE "permissions" SET "description" = 'Procurement: get supplier quotations, propose a purchase, issue the order once its price is authorized, record deliveries and attach supplier invoices (Finance, and the Accountant who assists Finance — the Accountant never approves or pays)'
 WHERE "code" = 'procurement.manage';
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('procurement.manage', 'inventory.receive')
WHERE r."code" = 'FINANCE'
ON CONFLICT DO NOTHING;
