-- Black Label 750ML: a free, credited photo (the bottle beside its gift box).
INSERT INTO "media_assets" ("id","title","category","altText","url","isIllustrative","creditText","description","width","height","isActive","sortOrder","createdAt","updatedAt")
VALUES ('media_mi_whiskies_black_label_750ml','Black Label 750ML','BAR','Bottle of Johnnie Walker Black Label 12-year-old blended Scotch whisky beside its black gift box','/images/menu/mi_whiskies_black_label_750ml.webp',true,'Photo: Iceman7840 · CC BY-SA 3.0','https://commons.wikimedia.org/wiki/File:Johnnie_Walker_Black_Label.jpg',1200,900,true,0,now(),now())
ON CONFLICT ("id") DO NOTHING;
UPDATE "menu_items" SET "imageId" = 'media_mi_whiskies_black_label_750ml' WHERE "id" = 'mi_whiskies_black_label_750ml' AND "imageId" IS NULL;
