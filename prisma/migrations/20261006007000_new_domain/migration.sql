-- The hotel's own domain (owner, 2026-10-08): www.vegashoteltz.com — shown on invoices, thank-you notes and the
-- website. Only the old defaults are replaced; a website the hotel typed itself in Settings is kept.
ALTER TABLE "hotel_settings" ALTER COLUMN "website" SET DEFAULT 'www.vegashoteltz.com';
UPDATE "hotel_settings" SET "website" = 'www.vegashoteltz.com'
WHERE "website" IS NULL OR btrim("website") = '' OR lower("website") IN ('www.vegasluxuryhotel.co.tz', 'vegasluxuryhotel.co.tz', 'vegas-os.vercel.app', 'https://vegas-os.vercel.app');
