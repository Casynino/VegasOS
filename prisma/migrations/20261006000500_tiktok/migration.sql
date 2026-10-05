-- The hotel's TikTok (owner, 2026-10-06) — on the website (footer, contact page), the thank-you note and the guest's
-- check-out message. Only filled in when it is still empty: a link the hotel set itself in Settings is kept.
ALTER TABLE "hotel_settings" ADD COLUMN "tiktokUrl" TEXT;
UPDATE "hotel_settings" SET "tiktokUrl" = 'https://www.tiktok.com/@official_vegas_hotel' WHERE "tiktokUrl" IS NULL OR btrim("tiktokUrl") = '';
