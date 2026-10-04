-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false;


-- Start with the dishes and drinks the hotel photographs best; managers change it in Menu & prices.
UPDATE "menu_items" SET "isFeatured" = true WHERE "id" IN (
  'mi_local_favorites_nyama_choma_beef', 'mi_sides_drinks_fresh_assorted_juices', 'mi_starters_soups_bbq_or_spicy_chicken_wings',
  'mi_beers_kilimanjaro', 'mi_local_favorites_samaki_choma_grilled_fish', 'mi_main_courses_beef_steak_veg_pepper_sauce'
);
