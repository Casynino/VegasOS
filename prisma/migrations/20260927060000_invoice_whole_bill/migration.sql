-- An invoice is always for the whole bill (hotel, 2026-09-27): no more "split" between company and guest.
UPDATE "corporate_customers" SET "defaultBillTo" = 'COMPANY', "defaultCovers" = '{}' WHERE "defaultBillTo" = 'SPLIT';
-- Bookings not started yet move to "company pays everything"; stays already in progress or finished keep what was agreed.
UPDATE "reservations" SET "billTo" = 'COMPANY', "companyCovers" = '{}', "updatedAt" = now()
WHERE "billTo" = 'SPLIT' AND "status" IN ('INQUIRY', 'RESERVED', 'CONFIRMED');
