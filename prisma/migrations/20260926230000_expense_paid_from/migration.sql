-- Every expense names the account it was paid from (older ones used the method's account).
UPDATE "expenses" e SET "accountId" = m."accountId" FROM "payment_methods" m WHERE e."accountId" IS NULL AND m."id" = e."paymentMethodId" AND m."accountId" IS NOT NULL;
