-- Requests approved before purchases were recorded: what was asked is what was approved.
UPDATE "stock_request_items" i SET "approvedQty" = i."quantity"
FROM "stock_requests" r WHERE r."id" = i."requestId" AND r."status" IN ('APPROVED', 'PURCHASING', 'PENDING_APPROVAL') AND i."approvedQty" IS NULL AND i."removedAt" IS NULL;

-- Open requests' lines linked to their department's stock item of the same name (as new requests are).
UPDATE "stock_request_items" i SET "inventoryItemId" = it."id"
FROM "stock_requests" r, "inventory_items" it
WHERE r."id" = i."requestId" AND r."status" IN ('SUBMITTED', 'SENT_BACK', 'APPROVED', 'PURCHASING') AND i."inventoryItemId" IS NULL
  AND it."departmentId" = r."departmentId" AND it."isActive" AND lower(it."name") = lower(i."name");
