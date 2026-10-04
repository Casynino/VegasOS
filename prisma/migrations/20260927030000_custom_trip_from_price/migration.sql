-- Custom trips: a starting price ("from TZS 100,000"); the final price is agreed with the guest.
UPDATE "transport_services"
SET "price" = 100000, "description" = 'Anywhere you need to go — tell us where and when. The final price is agreed with you.'
WHERE "code" = 'CUSTOM';
