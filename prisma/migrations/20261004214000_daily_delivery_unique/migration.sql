-- Keep one delivery per (daily report, recipient, channel): the one that was sent, else the newest.
DELETE FROM "notification_deliveries" d USING "notification_deliveries" k
WHERE d."dailyReportId" IS NOT NULL AND d."dailyReportId" = k."dailyReportId" AND d."recipient" = k."recipient" AND d."channel" = k."channel" AND d."id" <> k."id"
  AND ((k."status" = 'SENT' AND d."status" <> 'SENT')
    OR ((k."status" = 'SENT') = (d."status" = 'SENT') AND (k."updatedAt", k."id") > (d."updatedAt", d."id")));

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_dailyReportId_recipient_channel_key" ON "notification_deliveries"("dailyReportId", "recipient", "channel");

