-- CreateEnum
CREATE TYPE "MobilePaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "mobile_payments" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'NTZS',
    "depositId" TEXT,
    "status" "MobilePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "reservationId" TEXT,
    "orderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" TEXT NOT NULL,
    "handedOverById" TEXT,
    "pspReference" TEXT,
    "paymentId" TEXT,
    "orderPaymentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_payments_depositId_key" ON "mobile_payments"("depositId");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_payments_paymentId_key" ON "mobile_payments"("paymentId");

-- CreateIndex
CREATE INDEX "mobile_payments_status_createdAt_idx" ON "mobile_payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "mobile_payments_reservationId_idx" ON "mobile_payments"("reservationId");

-- AddForeignKey
ALTER TABLE "mobile_payments" ADD CONSTRAINT "mobile_payments_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mobile_payments" ADD CONSTRAINT "mobile_payments_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The nTZS account: mobile money collected through nTZS prompts (recorded only by nTZS's confirmation — never picked by
-- hand, so it is not offered in the "received through" lists), and its payment method.
INSERT INTO "money_accounts" ("id", "code", "name", "kind", "acceptsPayments", "acceptsExpenses", "sortOrder")
VALUES ('acct_ntzs', 'NTZS', 'nTZS · mobile money', 'MOBILE_MONEY', false, false, 40)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "payment_methods" ("id", "code", "name", "sortOrder", "accountId")
VALUES ('pm_ntzs', 'NTZS', 'nTZS · mobile money prompt', 40, (SELECT "id" FROM "money_accounts" WHERE "code" = 'NTZS'))
ON CONFLICT ("code") DO NOTHING;
