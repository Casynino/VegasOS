-- A phone prompt sent at check-out may cover the nights past the planned check-out, which are not on the bill yet.
-- This is that part of the prompt; the nights go on the bill when the money comes in. Empty on every other prompt.
ALTER TABLE "mobile_payments" ADD COLUMN "overstayAmount" INTEGER;
