-- The hotel's clean start: set once, when the practice data is cleared before official use.
-- The automatic reports never go back before it (a cleared day is not reported again as an empty one).
ALTER TABLE "hotel_settings" ADD COLUMN "liveSince" TIMESTAMP(3);
