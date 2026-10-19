-- A customer the Developer suspended cannot book or order through the public website / QR pages.
ALTER TABLE "guests" ADD COLUMN "suspendedAt" TIMESTAMP(3);
