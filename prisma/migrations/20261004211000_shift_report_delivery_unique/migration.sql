-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_shiftReportId_recipient_channel_key" ON "notification_deliveries"("shiftReportId", "recipient", "channel");

