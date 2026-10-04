-- Payment accounts: the hotel's official places money is received / paid from.
ALTER TABLE "money_accounts" ADD COLUMN "acceptsExpenses" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "acceptsPayments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "accountNumber" TEXT,
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'TZS',
ADD COLUMN "holderName" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "payment_corrections" ADD COLUMN "fromAccountId" TEXT, ADD COLUMN "toAccountId" TEXT;
ALTER TABLE "payments" ADD COLUMN "accountId" TEXT;
ALTER TABLE "revenue_transactions" ADD COLUMN "accountId" TEXT;

-- Official Vegas Luxury Hotel accounts (existing generic accounts become the real ones).
INSERT INTO "money_accounts" ("id", "code", "name", "kind", "sortOrder") VALUES
  ('acct_cash', 'CASH_DRAWER', 'Cash', 'CASH', 1),
  ('acct_mobile', 'MOBILE_MONEY', 'Lipa', 'MOBILE_MONEY', 2),
  ('acct_mpesa', 'LIPA_MPESA', 'Lipa M-Pesa', 'MOBILE_MONEY', 3),
  ('acct_bank', 'BANK', 'CRDB Bank', 'BANK', 4),
  ('acct_nmb', 'NMB_BANK', 'NMB Bank', 'BANK', 5),
  ('acct_card', 'CARD', 'Card terminal', 'CARD', 6),
  ('acct_petty', 'PETTY_CASH', 'Petty cash', 'PETTY_CASH', 7),
  ('acct_other', 'OTHER', 'Other', 'OTHER', 8)
ON CONFLICT ("id") DO NOTHING;
UPDATE "money_accounts" SET "name" = 'Cash', "accountNumber" = NULL, "sortOrder" = 1 WHERE "id" = 'acct_cash';
UPDATE "money_accounts" SET "name" = 'Lipa', "accountNumber" = '17860396', "sortOrder" = 2 WHERE "id" = 'acct_mobile';
UPDATE "money_accounts" SET "name" = 'Lipa M-Pesa', "accountNumber" = '51112197', "holderName" = 'BMAX LOUNGE', "sortOrder" = 3 WHERE "id" = 'acct_mpesa';
UPDATE "money_accounts" SET "name" = 'CRDB Bank', "accountNumber" = '015C799490700', "holderName" = 'VEGAS LUXURY HOTEL', "sortOrder" = 4 WHERE "id" = 'acct_bank';
UPDATE "money_accounts" SET "name" = 'NMB Bank', "accountNumber" = '20710035155', "holderName" = 'Mohamed Nassor Mbarack', "sortOrder" = 5 WHERE "id" = 'acct_nmb';
UPDATE "money_accounts" SET "acceptsExpenses" = false, "sortOrder" = 6 WHERE "id" = 'acct_card';
UPDATE "money_accounts" SET "acceptsPayments" = false, "sortOrder" = 7 WHERE "id" = 'acct_petty';
UPDATE "money_accounts" SET "sortOrder" = 8 WHERE "id" = 'acct_other';

-- Every existing payment / sale gets the account its method pointed to.
UPDATE "payments" p SET "accountId" = COALESCE(m."accountId", 'acct_other') FROM "payment_methods" m WHERE m."id" = p."methodId";
UPDATE "revenue_transactions" r SET "accountId" = COALESCE(m."accountId", 'acct_other') FROM "payment_methods" m WHERE m."id" = r."paymentMethodId";
UPDATE "payment_corrections" c SET "fromAccountId" = (SELECT "accountId" FROM "payment_methods" WHERE "id" = c."fromMethodId"),
  "toAccountId" = (SELECT "accountId" FROM "payment_methods" WHERE "id" = c."toMethodId");
ALTER TABLE "payments" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "revenue_transactions" ALTER COLUMN "accountId" SET NOT NULL;

CREATE INDEX "payments_accountId_businessDate_idx" ON "payments"("accountId", "businessDate");
ALTER TABLE "payments" ADD CONSTRAINT "payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revenue_transactions" ADD CONSTRAINT "revenue_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
