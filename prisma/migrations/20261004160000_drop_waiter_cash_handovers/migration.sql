-- The owner chose to keep payments simple (2026-10-04): no waiter cash hand-over records. The Counter records
-- payments as before; waiters only see what they handled.

-- DropForeignKey
ALTER TABLE "waiter_cash_handovers" DROP CONSTRAINT "waiter_cash_handovers_confirmedById_fkey";

-- DropForeignKey
ALTER TABLE "waiter_cash_handovers" DROP CONSTRAINT "waiter_cash_handovers_orderId_fkey";

-- DropForeignKey
ALTER TABLE "waiter_cash_handovers" DROP CONSTRAINT "waiter_cash_handovers_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "waiter_cash_handovers" DROP CONSTRAINT "waiter_cash_handovers_shiftId_fkey";

-- DropForeignKey
ALTER TABLE "waiter_cash_handovers" DROP CONSTRAINT "waiter_cash_handovers_waiterId_fkey";

-- DropTable
DROP TABLE "waiter_cash_handovers";

