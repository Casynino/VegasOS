-- The hotel's Instagram (owner, 2026-10-05) — shown on the website (footer, contact page) and in guests' check-out
-- message. Only filled in when it is still empty: a link the hotel set itself in Settings is kept.
UPDATE "hotel_settings" SET "instagramUrl" = 'https://www.instagram.com/vegas_luxury_hotel__/' WHERE "instagramUrl" IS NULL OR btrim("instagramUrl") = '';
