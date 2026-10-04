-- CreateEnum
CREATE TYPE "MenuItemType" AS ENUM ('FOOD', 'DRINK');

-- CreateEnum
CREATE TYPE "RestaurantOrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'ROOM_SERVICE');

-- CreateEnum
CREATE TYPE "RestaurantOrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RestaurantSettlement" AS ENUM ('PAY_NOW', 'ROOM');

-- AlterEnum
ALTER TYPE "RevenueKind" ADD VALUE 'ROOM_SERVICE';

-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "roomServiceFee" INTEGER NOT NULL DEFAULT 2000;

-- AlterTable
ALTER TABLE "reservation_charges" ADD COLUMN     "restaurantOrderId" TEXT;

-- AlterTable
ALTER TABLE "revenue_transactions" ADD COLUMN     "restaurantOrderId" TEXT;

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "MenuItemType" NOT NULL,
    "revenueKind" "RevenueKind" NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "type" "MenuItemType" NOT NULL,
    "subcategory" TEXT,
    "imageId" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "RestaurantOrderType" NOT NULL,
    "status" "RestaurantOrderStatus" NOT NULL DEFAULT 'PENDING',
    "settlement" "RestaurantSettlement" NOT NULL,
    "reservationId" TEXT,
    "roomNumber" TEXT,
    "customerName" TEXT,
    "tableLabel" TEXT,
    "notes" TEXT,
    "foodSubtotal" INTEGER NOT NULL,
    "drinksSubtotal" INTEGER NOT NULL,
    "serviceFee" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "accountId" TEXT,
    "paymentReference" TEXT,
    "businessDate" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelReason" TEXT,

    CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "name" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,
    "type" "MenuItemType" NOT NULL,
    "revenueKind" "RevenueKind" NOT NULL,

    CONSTRAINT "restaurant_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_slug_key" ON "menu_categories"("slug");

-- CreateIndex
CREATE INDEX "menu_items_categoryId_sortOrder_idx" ON "menu_items"("categoryId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_number_key" ON "restaurant_orders"("number");

-- CreateIndex
CREATE INDEX "restaurant_orders_businessDate_status_idx" ON "restaurant_orders"("businessDate", "status");

-- CreateIndex
CREATE INDEX "restaurant_orders_reservationId_idx" ON "restaurant_orders"("reservationId");

-- CreateIndex
CREATE INDEX "restaurant_order_items_orderId_idx" ON "restaurant_order_items"("orderId");

-- AddForeignKey
ALTER TABLE "reservation_charges" ADD CONSTRAINT "reservation_charges_restaurantOrderId_fkey" FOREIGN KEY ("restaurantOrderId") REFERENCES "restaurant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_transactions" ADD CONSTRAINT "revenue_transactions_restaurantOrderId_fkey" FOREIGN KEY ("restaurantOrderId") REFERENCES "restaurant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "money_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_items" ADD CONSTRAINT "restaurant_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_items" ADD CONSTRAINT "restaurant_order_items_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The hotel's menu (editable in Staff → Restaurant & bar → Menu). Prices in TZS.
INSERT INTO "menu_categories" ("id","name","slug","type","revenueKind","description","sortOrder") VALUES ('mcat_breakfast','Breakfast','breakfast','FOOD','RESTAURANT','Served every morning — hearty, fresh and made to order.',1) ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_breakfast_vegas_english_breakfast','mcat_breakfast','Vegas English Breakfast','Eggs your way, sausages, grilled tomato, beans, toast and tea or coffee.',9000,'FOOD',NULL,1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_breakfast_omelette_toast','mcat_breakfast','Omelette & Toast','A fluffy three-egg omelette with buttered toast.',6000,'FOOD',NULL,2) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_breakfast_chapati_eggs','mcat_breakfast','Chapati & Eggs','Soft home-made chapati with fried or scrambled eggs.',4000,'FOOD',NULL,3) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_breakfast_tea_coffee_standard','mcat_breakfast','Tea/Coffee (Standard)','A pot of local tea or freshly brewed coffee.',3000,'FOOD',NULL,4) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_categories" ("id","name","slug","type","revenueKind","description","sortOrder") VALUES ('mcat_starters_soups','Starters & Soups','starters-soups','FOOD','RESTAURANT','Something light to begin.',2) ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_starters_soups_fish_soup','mcat_starters_soups','Fish Soup','Rich coastal fish soup with fresh herbs and lime.',22000,'FOOD',NULL,1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_starters_soups_bbq_or_spicy_chicken_wings','mcat_starters_soups','BBQ or Spicy Chicken Wings','Crispy wings, glazed BBQ or tossed in pili-pili.',7000,'FOOD',NULL,2) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_starters_soups_chicken_soup','mcat_starters_soups','Chicken Soup','Slow-simmered chicken broth with vegetables.',5000,'FOOD',NULL,3) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_starters_soups_creamy_mushroom_soup','mcat_starters_soups','Creamy Mushroom Soup','Velvety mushroom soup, finished with cream.',5000,'FOOD',NULL,4) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_starters_soups_chicken_spring_rolls','mcat_starters_soups','Chicken Spring Rolls','Golden rolls filled with spiced chicken and vegetables.',5000,'FOOD',NULL,5) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_categories" ("id","name","slug","type","revenueKind","description","sortOrder") VALUES ('mcat_local_favorites','Local Favorites','local-favorites','FOOD','RESTAURANT','The taste of Tanzania, cooked the way it should be.',3) ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_local_favorites_nyama_choma_beef','mcat_local_favorites','Nyama Choma (Beef)','Charcoal-grilled beef, served with kachumbari and your choice of side.',22000,'FOOD',NULL,1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_local_favorites_samaki_choma_grilled_fish','mcat_local_favorites','Samaki Choma (Grilled Fish)','Whole fish grilled over charcoal with lemon and spices.',20000,'FOOD',NULL,2) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_local_favorites_wali_fish_curry','mcat_local_favorites','Wali Fish Curry','Coconut fish curry served with steamed rice.',9000,'FOOD',NULL,3) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_local_favorites_wali_chicken_curry','mcat_local_favorites','Wali Chicken Curry','Tender chicken curry served with steamed rice.',9000,'FOOD',NULL,4) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_local_favorites_roasted_banana_meat_ndizi_nyama','mcat_local_favorites','Roasted Banana & Meat (Ndizi Nyama)','Green bananas slow-cooked with beef in a savoury sauce.',8500,'FOOD',NULL,5) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_local_favorites_ugali_beef_stew','mcat_local_favorites','Ugali & Beef Stew','Classic ugali with a rich beef stew.',8500,'FOOD',NULL,6) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_local_favorites_ugali_dagaa_sukuma_wiki','mcat_local_favorites','Ugali, Dagaa & Sukuma Wiki','Ugali with fried dagaa and sautéed greens.',7000,'FOOD',NULL,7) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_local_favorites_wali_na_maharagwe_rice_beans','mcat_local_favorites','Wali na Maharagwe (Rice & Beans)','Coconut rice with slow-cooked beans.',6000,'FOOD',NULL,8) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_categories" ("id","name","slug","type","revenueKind","description","sortOrder") VALUES ('mcat_main_courses','Main Courses','main-courses','FOOD','RESTAURANT','Signature plates from our kitchen.',4) ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_beef_steak_veg_pepper_sauce','mcat_main_courses','Beef Steak (Veg & Pepper Sauce)','Grilled beef steak with seasonal vegetables and pepper sauce.',18000,'FOOD',NULL,1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_grilled_chicken_with_chips_or_veg','mcat_main_courses','Grilled Chicken (with Chips or Veg)','Marinated grilled chicken with chips or vegetables.',12000,'FOOD',NULL,2) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_chicken_biryani','mcat_main_courses','Chicken Biryani','Fragrant spiced rice layered with tender chicken.',12000,'FOOD',NULL,3) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_fish_chips','mcat_main_courses','Fish & Chips','Crispy battered fish with golden chips and tartare sauce.',11000,'FOOD',NULL,4) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_chicken_rice_bowl','mcat_main_courses','Chicken Rice Bowl','Seasoned chicken over rice with fresh vegetables.',11000,'FOOD',NULL,5) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_chicken_pilau_beef_pilau','mcat_main_courses','Chicken Pilau / Beef Pilau','Swahili spiced pilau with chicken or beef.',10000,'FOOD',NULL,6) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_beef_burger','mcat_main_courses','Beef Burger','Juicy beef patty, cheese and fresh salad in a toasted bun.',9000,'FOOD',NULL,7) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_spaghetti_bolognese','mcat_main_courses','Spaghetti Bolognese','Spaghetti with a slow-cooked beef and tomato sauce.',9000,'FOOD',NULL,8) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_french_fries','mcat_main_courses','French Fries','Crisp golden fries.',8000,'FOOD',NULL,9) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_fried_rice','mcat_main_courses','Fried Rice','Wok-fried rice with vegetables and egg.',5000,'FOOD',NULL,10) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_main_courses_ugali_extra_portion','mcat_main_courses','Ugali (Extra Portion)','An extra portion of ugali.',3000,'FOOD',NULL,11) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_categories" ("id","name","slug","type","revenueKind","description","sortOrder") VALUES ('mcat_sides_drinks','Sides & Drinks','sides-drinks','DRINK','RESTAURANT','Fresh, cold and non-alcoholic.',5) ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_sides_drinks_fresh_fruit_smoothies','mcat_sides_drinks','Fresh Fruit Smoothies','Blended seasonal fruit.',5000,'DRINK','Soft drink',1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_sides_drinks_fresh_assorted_juices','mcat_sides_drinks','Fresh Assorted Juices','Pressed daily — mango, passion, pineapple or watermelon.',4000,'DRINK','Soft drink',2) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_sides_drinks_soda_cold_soft_drink','mcat_sides_drinks','Soda (Cold Soft Drink)','Your choice of chilled soft drink.',2500,'DRINK','Soft drink',3) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_sides_drinks_mineral_water','mcat_sides_drinks','Mineral Water','Chilled bottled water.',1500,'DRINK','Soft drink',4) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_categories" ("id","name","slug","type","revenueKind","description","sortOrder") VALUES ('mcat_beers','Beers','beers','DRINK','BAR','Ice-cold local and international beers.',6) ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_safari','mcat_beers','Safari',NULL,4000,'DRINK','Beer',1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_kilimanjaro','mcat_beers','Kilimanjaro',NULL,4000,'DRINK','Beer',2) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_castle_lager','mcat_beers','Castle Lager',NULL,4000,'DRINK','Beer',3) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_castle_lite','mcat_beers','Castle Lite',NULL,4000,'DRINK','Beer',4) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_serengeti_lite','mcat_beers','Serengeti Lite',NULL,4000,'DRINK','Beer',5) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_flying_fish','mcat_beers','Flying Fish',NULL,4000,'DRINK','Beer',6) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_kili_lager','mcat_beers','Kili Lager',NULL,4000,'DRINK','Beer',7) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_brutal','mcat_beers','Brutal',NULL,5000,'DRINK','Beer',8) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_heineken','mcat_beers','Heineken',NULL,5000,'DRINK','Beer',9) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_windhoek','mcat_beers','Windhoek',NULL,5000,'DRINK','Beer',10) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_desperado','mcat_beers','Desperado',NULL,5000,'DRINK','Beer',11) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_beers_savana','mcat_beers','Savana',NULL,5000,'DRINK','Beer',12) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_categories" ("id","name","slug","type","revenueKind","description","sortOrder") VALUES ('mcat_wines','Wines','wines','DRINK','BAR','Red, white, rosé and sparkling.',7) ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_st_anna','mcat_wines','St Anna',NULL,25000,'DRINK','Wine',1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_robertson_white','mcat_wines','Robertson White',NULL,30000,'DRINK','Wine',2) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_robertson_red','mcat_wines','Robertson Red',NULL,30000,'DRINK','Wine',3) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_drostdyhof_red_750ml','mcat_wines','Drostdyhof Red 750ML',NULL,25000,'DRINK','Wine',4) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_drostdyhof_red_375ml','mcat_wines','Drostdyhof Red 375ML',NULL,15000,'DRINK','Wine',5) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_drostdyhof_white_750ml','mcat_wines','Drostdyhof White 750ML',NULL,25000,'DRINK','Wine',6) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_drostdyhof_white_375ml','mcat_wines','Drostdyhof White 375ML',NULL,15000,'DRINK','Wine',7) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_altar_wine','mcat_wines','Altar Wine',NULL,25000,'DRINK','Wine',8) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_pearly_bay_dry_rose','mcat_wines','Pearly Bay Dry Rose',NULL,25000,'DRINK','Wine',9) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_pearly_bay_sweet','mcat_wines','Pearly Bay Sweet',NULL,25000,'DRINK','Wine',10) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_lion_hill','mcat_wines','Lion Hill',NULL,25000,'DRINK','Wine',11) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_four_cousin','mcat_wines','Four Cousin',NULL,30000,'DRINK','Wine',12) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_bonne_esperance','mcat_wines','Bonne Esperance',NULL,25000,'DRINK','Wine',13) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_dodoma_wine','mcat_wines','Dodoma Wine',NULL,25000,'DRINK','Wine',14) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_dompo','mcat_wines','Dompo',NULL,25000,'DRINK','Wine',15) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_champaign_pearly_bay','mcat_wines','Champaign Pearly Bay',NULL,45000,'DRINK','Wine',16) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_wines_mohans','mcat_wines','Mohans',NULL,25000,'DRINK','Wine',17) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_categories" ("id","name","slug","type","revenueKind","description","sortOrder") VALUES ('mcat_whiskies','Whiskies','whiskies','DRINK','BAR','Scotch, Irish and American whiskies by the bottle.',8) ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_jameson_750ml','mcat_whiskies','Jameson 750ML',NULL,85000,'DRINK','Whisky',1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_jameson_500ml','mcat_whiskies','Jameson 500ML',NULL,55000,'DRINK','Whisky',2) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_jameson_250ml','mcat_whiskies','Jameson 250ML',NULL,35000,'DRINK','Whisky',3) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_grants_750ml','mcat_whiskies','Grants 750ML',NULL,55000,'DRINK','Whisky',4) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_grants_500ml','mcat_whiskies','Grants 500ML',NULL,35000,'DRINK','Whisky',5) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_ballantine_750ml','mcat_whiskies','Ballantine 750ML',NULL,60000,'DRINK','Whisky',6) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_ballantine_250ml','mcat_whiskies','Ballantine 250ML',NULL,30000,'DRINK','Whisky',7) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_jack_daniels_750ml','mcat_whiskies','Jack Daniels 750ML',NULL,100000,'DRINK','Whisky',8) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_jack_daniels_500ml','mcat_whiskies','Jack Daniels 500ML',NULL,65000,'DRINK','Whisky',9) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_jack_daniels_250ml','mcat_whiskies','Jack Daniels 250ML',NULL,50000,'DRINK','Whisky',10) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_red_label_750ml','mcat_whiskies','Red Label 750ML',NULL,85000,'DRINK','Whisky',11) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_red_label_250ml','mcat_whiskies','Red Label 250ML',NULL,30000,'DRINK','Whisky',12) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_black_label_750ml','mcat_whiskies','Black Label 750ML',NULL,100000,'DRINK','Whisky',13) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_black_white_750ml','mcat_whiskies','Black & White 750ML',NULL,35000,'DRINK','Whisky',14) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_whiskies_black_white_250ml','mcat_whiskies','Black & White 250ML',NULL,20000,'DRINK','Whisky',15) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_categories" ("id","name","slug","type","revenueKind","description","sortOrder") VALUES ('mcat_spirits','Spirits','spirits','DRINK','BAR','Cognac, vodka, gin, liqueurs and local favourites.',9) ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_jagermeister_1l','mcat_spirits','Jagermeister 1L',NULL,120000,'DRINK','Spirit',1) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_jagermeister_750ml','mcat_spirits','Jagermeister 750ML',NULL,80000,'DRINK','Spirit',2) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_jagermeister_500ml','mcat_spirits','Jagermeister 500ML',NULL,45000,'DRINK','Spirit',3) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_jagermeister_250ml','mcat_spirits','Jagermeister 250ML',NULL,35000,'DRINK','Spirit',4) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_hennessy_750ml','mcat_spirits','Hennessy 750ML',NULL,200000,'DRINK','Spirit',5) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_hennessy_500ml','mcat_spirits','Hennessy 500ML',NULL,120000,'DRINK','Spirit',6) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_hennessy_250ml','mcat_spirits','Hennessy 250ML',NULL,60000,'DRINK','Spirit',7) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_konyagi_750ml','mcat_spirits','Konyagi 750ML',NULL,15000,'DRINK','Spirit',8) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_konyagi_500ml','mcat_spirits','Konyagi 500ML',NULL,10000,'DRINK','Spirit',9) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_konyagi_250ml','mcat_spirits','Konyagi 250ML',NULL,5000,'DRINK','Spirit',10) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_k_vant_750ml','mcat_spirits','K-Vant 750ML',NULL,15000,'DRINK','Spirit',11) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_k_vant_250ml','mcat_spirits','K-Vant 250ML',NULL,5000,'DRINK','Spirit',12) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_smirnoff_750ml','mcat_spirits','Smirnoff 750ML',NULL,55000,'DRINK','Spirit',13) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_smirnoff_250ml','mcat_spirits','Smirnoff 250ML',NULL,20000,'DRINK','Spirit',14) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_gordons_750ml','mcat_spirits','Gordons 750ML',NULL,50000,'DRINK','Spirit',15) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_gordons_250ml','mcat_spirits','Gordons 250ML',NULL,25000,'DRINK','Spirit',16) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_absolute_vodka_750ml','mcat_spirits','Absolute Vodka 750ML',NULL,70000,'DRINK','Spirit',17) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_absolute_vodka_500ml','mcat_spirits','Absolute Vodka 500ML',NULL,45000,'DRINK','Spirit',18) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_absolute_vodka_250ml','mcat_spirits','Absolute Vodka 250ML',NULL,40000,'DRINK','Spirit',19) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_jb_750ml','mcat_spirits','JB 750ML',NULL,60000,'DRINK','Spirit',20) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_jb_250ml','mcat_spirits','JB 250ML',NULL,30000,'DRINK','Spirit',21) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_hanson_choice_750ml','mcat_spirits','Hanson Choice 750ML',NULL,20000,'DRINK','Spirit',22) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_hanson_choice_250ml','mcat_spirits','Hanson Choice 250ML',NULL,7000,'DRINK','Spirit',23) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_camino','mcat_spirits','Camino',NULL,60000,'DRINK','Spirit',24) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_amarula_500ml','mcat_spirits','Amarula 500ML',NULL,35000,'DRINK','Spirit',25) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_amarula_750ml','mcat_spirits','Amarula 750ML',NULL,60000,'DRINK','Spirit',26) ON CONFLICT ("id") DO NOTHING;
INSERT INTO "menu_items" ("id","categoryId","name","description","price","type","subcategory","sortOrder") VALUES ('mi_spirits_amarula_250ml','mcat_spirits','Amarula 250ML',NULL,22000,'DRINK','Spirit',27) ON CONFLICT ("id") DO NOTHING;

-- Who may take orders and who may change the menu.
INSERT INTO "permissions" ("id","code","description") VALUES
  ('perm_restaurant_orders','restaurant.orders','Take restaurant & bar orders and move them through the kitchen'),
  ('perm_restaurant_menu','restaurant.menu','Manage the restaurant & bar menu, prices and photos')
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId","permissionId")
  SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'restaurant.orders' WHERE r."code" IN ('ADMIN','OWNER','MANAGER','RECEPTIONIST') ON CONFLICT DO NOTHING;
INSERT INTO "role_permissions" ("roleId","permissionId")
  SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON p."code" = 'restaurant.menu' WHERE r."code" IN ('ADMIN','OWNER','MANAGER') ON CONFLICT DO NOTHING;

