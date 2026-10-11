-- Include purpose in the notification delivery unique constraint so ROOM_REPORT and
-- DAILY_REPORT deliveries on the same daily report are tracked separately.

-- DropIndex
DROP INDEX "notification_deliveries_dailyReportId_recipient_channel_key";

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_dailyReportId_recipient_channel_pur_key" ON "notification_deliveries"("dailyReportId", "recipient", "channel", "purpose");
