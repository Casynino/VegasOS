-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "preferredLanguage" TEXT;

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "enabledLanguages" TEXT[] DEFAULT ARRAY['en', 'zh-CN']::TEXT[];

-- AlterTable
ALTER TABLE "restaurant_order_items" ADD COLUMN     "nameI18n" JSONB;

-- AlterTable
ALTER TABLE "restaurant_orders" ADD COLUMN     "noteCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "preferredLanguage" TEXT NOT NULL DEFAULT 'en';

-- CreateTable
CREATE TABLE "menu_item_translations" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_category_translations" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_category_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_type_translations" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT,
    "shortDescription" TEXT,
    "description" TEXT,
    "bedType" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_type_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amenity_translations" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "amenity_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_service_translations" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "priceNote" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_service_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_service_translations" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_service_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_service_option_translations" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_service_option_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "menu_item_translations_parentId_locale_key" ON "menu_item_translations"("parentId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "menu_category_translations_parentId_locale_key" ON "menu_category_translations"("parentId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "room_type_translations_parentId_locale_key" ON "room_type_translations"("parentId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "amenity_translations_parentId_locale_key" ON "amenity_translations"("parentId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_service_translations_parentId_locale_key" ON "hotel_service_translations"("parentId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "transport_service_translations_parentId_locale_key" ON "transport_service_translations"("parentId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "transport_service_option_translations_parentId_locale_key" ON "transport_service_option_translations"("parentId", "locale");

-- AddForeignKey
ALTER TABLE "menu_item_translations" ADD CONSTRAINT "menu_item_translations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_category_translations" ADD CONSTRAINT "menu_category_translations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_type_translations" ADD CONSTRAINT "room_type_translations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amenity_translations" ADD CONSTRAINT "amenity_translations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "amenities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_service_translations" ADD CONSTRAINT "hotel_service_translations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "hotel_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_service_translations" ADD CONSTRAINT "transport_service_translations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "transport_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_service_option_translations" ADD CONSTRAINT "transport_service_option_translations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "transport_service_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

