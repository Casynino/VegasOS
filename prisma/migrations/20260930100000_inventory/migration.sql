-- AlterTable
ALTER TABLE "restaurant_order_items" ADD COLUMN     "stockUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "inventory_departments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "categoryId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minStock" DOUBLE PRECISION,
    "reorderLevel" DOUBLE PRECISION,
    "maxStock" DOUBLE PRECISION,
    "costPerUnit" INTEGER NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "location" TEXT,
    "tracksExpiry" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "change" DOUBLE PRECISION NOT NULL,
    "before" DOUBLE PRECISION,
    "after" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "unitCost" INTEGER,
    "totalCost" INTEGER,
    "supplierId" TEXT,
    "reference" TEXT,
    "expiresOn" DATE,
    "expiryCleared" BOOLEAN NOT NULL DEFAULT false,
    "departmentId" TEXT,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_lines" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "departmentId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "purchaseDate" DATE,
    "purchaseCost" INTEGER,
    "condition" TEXT NOT NULL DEFAULT 'GOOD',
    "status" TEXT NOT NULL DEFAULT 'IN_USE',
    "supplierId" TEXT,
    "serialNumber" TEXT,
    "assignedTo" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_departments_code_key" ON "inventory_departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_departments_name_key" ON "inventory_departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_categories_name_key" ON "inventory_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_sku_key" ON "inventory_items"("sku");

-- CreateIndex
CREATE INDEX "inventory_items_categoryId_idx" ON "inventory_items"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_departmentId_name_key" ON "inventory_items"("departmentId", "name");

-- CreateIndex
CREATE INDEX "inventory_movements_itemId_recordedAt_idx" ON "inventory_movements"("itemId", "recordedAt");

-- CreateIndex
CREATE INDEX "inventory_movements_recordedAt_idx" ON "inventory_movements"("recordedAt");

-- CreateIndex
CREATE INDEX "inventory_movements_status_kind_idx" ON "inventory_movements"("status", "kind");

-- CreateIndex
CREATE INDEX "inventory_movements_orderId_idx" ON "inventory_movements"("orderId");

-- CreateIndex
CREATE INDEX "recipe_lines_itemId_idx" ON "recipe_lines"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_lines_menuItemId_itemId_key" ON "recipe_lines"("menuItemId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");

-- CreateIndex
CREATE INDEX "assets_category_idx" ON "assets"("category");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- AddForeignKey
ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "inventory_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "inventory_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "inventory_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "inventory_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "inventory_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hotel-wide inventory: permissions.
INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('perm_inventory_view', 'inventory.view', 'See hotel stock (all departments), alerts and movements'),
  ('perm_inventory_use', 'inventory.use', 'Record stock used and report waste (waste waits for a manager)'),
  ('perm_inventory_receive', 'inventory.receive', 'Record stock received from suppliers'),
  ('perm_inventory_approve', 'inventory.approve', 'Approve waste, count stock and correct quantities (with a reason)'),
  ('perm_inventory_manage', 'inventory.manage', 'Set up inventory: items, categories, departments, suppliers, units and recipes'),
  ('perm_assets_view', 'assets.view', 'See the hotel''s assets (furniture, equipment, electronics)'),
  ('perm_assets_manage', 'assets.manage', 'Add and update hotel assets')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('inventory.view', 'inventory.use', 'inventory.receive', 'inventory.approve', 'inventory.manage', 'assets.view', 'assets.manage')
WHERE r."code" IN ('ADMIN', 'OWNER')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('inventory.view', 'inventory.use', 'inventory.receive', 'inventory.approve', 'assets.view')
WHERE r."code" = 'MANAGER'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" IN ('inventory.view', 'inventory.use')
WHERE r."code" IN ('KITCHEN', 'RESTAURANT')
ON CONFLICT DO NOTHING;

-- Departments and categories to start with (the MD can rename, add and switch them off).
INSERT INTO "inventory_departments" ("id", "code", "name", "sortOrder") VALUES
  ('invdep_kitchen', 'KITCHEN', 'Kitchen', 1),
  ('invdep_restaurant', 'RESTAURANT', 'Restaurant', 2),
  ('invdep_bar', 'BAR', 'Bar', 3),
  ('invdep_housekeeping', 'HOUSEKEEPING', 'Housekeeping', 4),
  ('invdep_maintenance', 'MAINTENANCE', 'Maintenance', 5),
  ('invdep_reception', 'RECEPTION', 'Reception', 6),
  ('invdep_office', 'OFFICE', 'Office', 7),
  ('invdep_general', 'GENERAL', 'General hotel', 8)
ON CONFLICT DO NOTHING;

INSERT INTO "inventory_categories" ("id", "name", "departmentId", "sortOrder") VALUES
  ('invcat_food', 'Kitchen food', 'invdep_kitchen', 1),
  ('invcat_beverages', 'Beverages', 'invdep_bar', 2),
  ('invcat_housekeeping', 'Housekeeping', 'invdep_housekeeping', 3),
  ('invcat_maintenance', 'Maintenance', 'invdep_maintenance', 4),
  ('invcat_restaurant', 'Restaurant supplies', 'invdep_restaurant', 5),
  ('invcat_office', 'Office', 'invdep_office', 6)
ON CONFLICT DO NOTHING;
