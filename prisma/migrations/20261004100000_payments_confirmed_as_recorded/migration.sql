-- Nobody confirms restaurant payments by hand any more (owner, 2026-10-04): every payment counts as
-- confirmed as it is recorded. The ones still waiting (recorded by waiters before the Restaurant Counter
-- took over the money) are confirmed now, as of when they were recorded.
UPDATE "restaurant_order_payments"
SET "confirmedAt" = "collectedAt", "confirmedByRole" = 'Automatic — no confirmation needed'
WHERE "status" = 'POSTED' AND "confirmedAt" IS NULL;

UPDATE "restaurant_orders" SET "paymentStatus" = 'PAID' WHERE "paymentStatus" = 'PENDING_CONFIRMATION' AND "paidAmount" >= "total";

-- The setting that held them for confirmation is off for good.
UPDATE "hotel_settings" SET "orderPaymentConfirm" = false;
