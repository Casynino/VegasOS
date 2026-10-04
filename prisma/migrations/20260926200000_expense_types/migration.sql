-- AlterTable
ALTER TABLE "expense_categories" ADD COLUMN     "icon" TEXT;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "itemId" TEXT;

-- CreateTable
CREATE TABLE "expense_items" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'OCCASIONAL',
    "defaultPayee" TEXT,
    "defaultAmount" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_items_isActive_idx" ON "expense_items"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "expense_items_categoryId_name_key" ON "expense_items"("categoryId", "name");

-- AddForeignKey
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "expense_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Expense groups and types (from the hotel's own monthly sheet + common hotel costs).
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_utilities', 'UTILITIES', 'Utilities', 'Zap', true, 0)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_electricity', c."id", 'Electricity (LUKU / TANESCO)', 'MONTHLY', 'TANESCO', true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'UTILITIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_dawasa', c."id", 'Water bill — DAWASA', 'MONTHLY', 'DAWASA', true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'UTILITIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_water-delivery', c."id", 'Water delivery (bowser)', 'OCCASIONAL', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'UTILITIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_boss-baraka-water', c."id", 'Water delivery — Boss Baraka', 'OCCASIONAL', 'Boss Baraka', true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'UTILITIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_generator-fuel', c."id", 'Generator fuel', 'OCCASIONAL', NULL, true, 4, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'UTILITIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_gas', c."id", 'Cooking gas', 'MONTHLY', NULL, true, 5, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'UTILITIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_waste', c."id", 'Waste collection', 'MONTHLY', NULL, true, 6, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'UTILITIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_waste-water', c."id", 'Waste water (septic emptying)', 'MONTHLY', NULL, true, 7, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'UTILITIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_internet', 'INTERNET', 'TV, internet & subscriptions', 'Wifi', true, 1)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_internet', c."id", 'Internet (monthly)', 'MONTHLY', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'INTERNET'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_decoder', c."id", 'TV decoder subscription (DStv / Azam)', 'MONTHLY', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'INTERNET'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_netflix', c."id", 'Netflix', 'MONTHLY', 'Netflix', true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'INTERNET'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_software', c."id", 'Software & apps subscription', 'MONTHLY', NULL, true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'INTERNET'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_salaries', 'SALARIES', 'Staff & payroll', 'Users', true, 2)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_salaries', c."id", 'Staff salaries', 'MONTHLY', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'SALARIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_statutory', c."id", 'NSSF / SDL / PAYE', 'MONTHLY', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'SALARIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_staff-food', c."id", 'Staff food', 'DAILY', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'SALARIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_staff-expenses', c."id", 'Staff expenses (transport, allowances)', 'OCCASIONAL', NULL, true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'SALARIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_staff-termination', c."id", 'Staff contract termination', 'OCCASIONAL', NULL, true, 4, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'SALARIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_staff-uniforms', c."id", 'Staff uniforms', 'OCCASIONAL', NULL, true, 5, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'SALARIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_food', 'FOOD', 'Food & kitchen', 'UtensilsCrossed', true, 3)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_breakfast', c."id", 'Breakfast supplies', 'DAILY', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'FOOD'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_kitchen', c."id", 'Kitchen shopping (food)', 'DAILY', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'FOOD'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_kitchen-equipment', c."id", 'Kitchen equipment & utensils', 'OCCASIONAL', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'FOOD'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_drinking-water', c."id", 'Drinking water (bottles)', 'DAILY', NULL, true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'FOOD'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_bar_supplies', 'BAR_SUPPLIES', 'Bar & drinks', 'Wine', true, 4)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_drinks-stock', c."id", 'Drinks stock (outside counter capital)', 'DAILY', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'BAR_SUPPLIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_ice', c."id", 'Ice', 'DAILY', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'BAR_SUPPLIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_housekeeping', 'HOUSEKEEPING', 'Housekeeping & laundry', 'SprayCan', true, 5)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_housekeeping', c."id", 'Housekeeping supplies (detergents, toilet paper)', 'DAILY', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'HOUSEKEEPING'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_laundry', c."id", 'Laundry expenses', 'OCCASIONAL', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'HOUSEKEEPING'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_guest-amenities', c."id", 'Guest amenities (soap, shampoo, slippers)', 'OCCASIONAL', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'HOUSEKEEPING'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_linen', c."id", 'Bed linen & towels', 'OCCASIONAL', NULL, true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'HOUSEKEEPING'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_pest-control', c."id", 'Pest control', 'OCCASIONAL', NULL, true, 4, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'HOUSEKEEPING'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_maintenance', 'MAINTENANCE', 'Repairs & maintenance', 'Wrench', true, 6)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_building', c."id", 'Building maintenance', 'OCCASIONAL', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MAINTENANCE'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_generator-maintenance', c."id", 'Generator maintenance', 'OCCASIONAL', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MAINTENANCE'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_ac', c."id", 'AC repair & service', 'OCCASIONAL', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MAINTENANCE'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_plumbing', c."id", 'Plumbing repairs', 'OCCASIONAL', NULL, true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MAINTENANCE'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_electrical', c."id", 'Electrical repairs', 'OCCASIONAL', NULL, true, 4, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MAINTENANCE'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_furniture', c."id", 'Furniture & equipment repair', 'OCCASIONAL', NULL, true, 5, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MAINTENANCE'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_painting', c."id", 'Painting', 'OCCASIONAL', NULL, true, 6, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MAINTENANCE'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_transport', 'TRANSPORT', 'Transport & fuel', 'Car', true, 7)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_car-fuel', c."id", 'Car fuel', 'DAILY', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'TRANSPORT'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_bajaji', c."id", 'Bajaji / bodaboda (errands)', 'DAILY', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'TRANSPORT'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_vehicle-service', c."id", 'Vehicle service & repair', 'OCCASIONAL', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'TRANSPORT'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_parking', c."id", 'Parking & road fees', 'OCCASIONAL', NULL, true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'TRANSPORT'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_marketing', 'MARKETING', 'Sales & marketing', 'Megaphone', true, 8)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_digital-marketing', c."id", 'Digital marketing', 'MONTHLY', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MARKETING'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_booking-com', c."id", 'Booking.com commission', 'MONTHLY', 'Booking.com', true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MARKETING'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_online-ads', c."id", 'Online ads (Instagram / Facebook / Google)', 'OCCASIONAL', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MARKETING'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_printing', c."id", 'Printing & signage', 'OCCASIONAL', NULL, true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'MARKETING'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_bank_fees', 'BANK_FEES', 'Bank & payment fees', 'Landmark', true, 9)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_selcom', c."id", 'Selcom fee', 'MONTHLY', 'Selcom', true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'BANK_FEES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_pesapal', c."id", 'Pesapal / Lipa number fee', 'MONTHLY', 'Pesapal', true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'BANK_FEES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_bank-charges', c."id", 'Bank charges', 'MONTHLY', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'BANK_FEES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_mobile-money-charges', c."id", 'Mobile money charges', 'OCCASIONAL', NULL, true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'BANK_FEES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_security', 'SECURITY', 'Security & insurance', 'ShieldCheck', true, 10)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_security', c."id", 'Security company (Co-operative Defense)', 'MONTHLY', 'Co-operative Defense', true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'SECURITY'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_insurance', c."id", 'Vegas insurance', 'MONTHLY', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'SECURITY'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_fire-safety', c."id", 'Fire extinguisher service', 'OCCASIONAL', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'SECURITY'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_taxes', 'TAXES', 'Government, taxes & licences', 'Scale', true, 11)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_compulsory', c."id", 'Monthly compulsory payment', 'MONTHLY', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'TAXES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_service-levy', c."id", 'Service levy (city council)', 'OCCASIONAL', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'TAXES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_tourism-levy', c."id", 'Tourism / hotel levy', 'OCCASIONAL', NULL, true, 2, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'TAXES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_licences', c."id", 'Business licences & permits', 'OCCASIONAL', NULL, true, 3, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'TAXES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_tra', c."id", 'TRA taxes', 'OCCASIONAL', 'TRA', true, 4, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'TAXES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_office_supplies', 'OFFICE_SUPPLIES', 'Office & admin', 'Briefcase', true, 12)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_stationery', c."id", 'Stationery & printing paper', 'OCCASIONAL', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'OFFICE_SUPPLIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_airtime', c."id", 'Phone airtime & bundles', 'OCCASIONAL', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'OFFICE_SUPPLIES'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_owner', 'OWNER', 'Owner & head office', 'Crown', true, 13)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_boss-baraka', c."id", 'Boss Baraka', 'OCCASIONAL', 'Boss Baraka', true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'OWNER'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_sent-to-china', c."id", 'Sent to China', 'OCCASIONAL', NULL, true, 1, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'OWNER'
ON CONFLICT DO NOTHING;
INSERT INTO "expense_categories" ("id", "code", "name", "icon", "isActive", "sortOrder") VALUES ('expcat_other', 'OTHER', 'Other', 'Package', true, 14)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "icon" = EXCLUDED."icon", "isActive" = true, "sortOrder" = EXCLUDED."sortOrder";
INSERT INTO "expense_items" ("id", "categoryId", "name", "frequency", "defaultPayee", "isActive", "sortOrder", "useCount", "createdAt", "updatedAt")
SELECT 'exi_others', c."id", 'Others', 'OCCASIONAL', NULL, true, 0, 0, now(), now() FROM "expense_categories" c WHERE c."code" = 'OTHER'
ON CONFLICT DO NOTHING;
UPDATE "expense_categories" SET "isActive" = false, "sortOrder" = 100 WHERE "code" IN ('CLEANING', 'GUEST_SUPPLIES', 'ELECTRICITY', 'WATER', 'FUEL', 'RESTAURANT_SUPPLIES');
