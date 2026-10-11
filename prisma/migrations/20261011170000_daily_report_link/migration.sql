-- The Boss's WhatsApp link to the daily business report opens without signing in (a random token, like the
-- Daily Room Report). Empty for reports made before this — the token is made the first time the link is needed.
ALTER TABLE "daily_reports" ADD COLUMN "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_shareToken_key" ON "daily_reports"("shareToken");
