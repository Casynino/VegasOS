-- Staff read mobile money plainly (owner, 2026-10-05: "don't say online payment or NTZS — just say paid and the amount").
-- Only the default names change; a name the hotel changed itself is kept.
UPDATE "money_accounts" SET "name" = 'Mobile money (phone)' WHERE "code" = 'NTZS' AND "name" IN ('NTZS · online payments', 'nTZS · mobile money');
UPDATE "payment_methods" SET "name" = 'Mobile money (phone)' WHERE "code" = 'NTZS' AND "name" IN ('NTZS online', 'nTZS · mobile money prompt');
UPDATE "users" SET "fullName" = 'Customer (paid by phone)' WHERE "id" = 'usr_online_ntzs' AND "fullName" = 'Online · nTZS';
UPDATE "roles" SET "name" = 'Customer phone payments (system)' WHERE "code" = 'SYSTEM_ONLINE' AND "name" = 'Online payments (system)';
