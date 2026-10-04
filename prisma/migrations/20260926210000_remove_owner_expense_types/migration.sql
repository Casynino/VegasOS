-- Boss Baraka items removed from the expense list (hidden if already used, deleted otherwise).
UPDATE "expense_items" SET "isActive" = false WHERE "id" IN ('exi_boss-baraka', 'exi_boss-baraka-water') AND EXISTS (SELECT 1 FROM "expenses" e WHERE e."itemId" = "expense_items"."id");
DELETE FROM "expense_items" WHERE "id" IN ('exi_boss-baraka', 'exi_boss-baraka-water') AND NOT EXISTS (SELECT 1 FROM "expenses" e WHERE e."itemId" = "expense_items"."id");
-- "Sent to China" moves to Other; the owner group is no longer needed.
UPDATE "expense_items" SET "categoryId" = (SELECT "id" FROM "expense_categories" WHERE "code" = 'OTHER'), "sortOrder" = 1 WHERE "id" = 'exi_sent-to-china';
UPDATE "expense_categories" SET "isActive" = false WHERE "code" = 'OWNER';
DELETE FROM "expense_categories" c WHERE c."code" = 'OWNER' AND NOT EXISTS (SELECT 1 FROM "expenses" e WHERE e."categoryId" = c."id") AND NOT EXISTS (SELECT 1 FROM "expense_items" i WHERE i."categoryId" = c."id");
