-- A whole-bill discount takes its food / drinks / room-service share off as a credit line on the bill
-- (category BILL_DISCOUNT, negative). Every other charge stays positive.
ALTER TABLE "reservation_charges" DROP CONSTRAINT "charges_amount_positive";
ALTER TABLE "reservation_charges" ADD CONSTRAINT "charges_amount_positive" CHECK ("amount" > 0 OR ("category" = 'BILL_DISCOUNT' AND "amount" < 0));
