-- The nTZS account says what it is where the books are kept (owner, 2026-10-12, on Finance → Accounts: "is this ntz
-- account if yes the name it properly"). Only the default name changes; a name the hotel changed itself is kept.
-- The payment method keeps its plain staff wording ("Mobile money (phone)"), and a guest's own receipt or bill still
-- reads that way (guestAccountName in src/lib/pay-account.ts).
UPDATE "money_accounts" SET "name" = 'nTZS · Mobile money (phone)' WHERE "code" = 'NTZS' AND "name" = 'Mobile money (phone)';
