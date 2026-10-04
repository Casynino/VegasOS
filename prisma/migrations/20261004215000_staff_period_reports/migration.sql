-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "staffReportId" TEXT;

-- CreateTable
CREATE TABLE "staff_reports" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "userId" TEXT,
    "department" "ShiftDepartment",
    "data" JSONB NOT NULL,
    "summaryText" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL DEFAULT 'system',
    "shareToken" TEXT NOT NULL,
    "shareExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_reports_key_key" ON "staff_reports"("key");

-- CreateIndex
CREATE UNIQUE INDEX "staff_reports_shareToken_key" ON "staff_reports"("shareToken");

-- CreateIndex
CREATE INDEX "staff_reports_userId_kind_fromDate_idx" ON "staff_reports"("userId", "kind", "fromDate");

-- CreateIndex
CREATE INDEX "staff_reports_kind_fromDate_idx" ON "staff_reports"("kind", "fromDate");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_staffReportId_recipient_channel_key" ON "notification_deliveries"("staffReportId", "recipient", "channel");

-- AddForeignKey
ALTER TABLE "staff_reports" ADD CONSTRAINT "staff_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_staffReportId_fkey" FOREIGN KEY ("staffReportId") REFERENCES "staff_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

