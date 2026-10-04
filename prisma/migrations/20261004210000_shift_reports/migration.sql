-- AlterTable
ALTER TABLE "hotel_settings" ADD COLUMN     "shiftReportEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "shiftReportId" TEXT;

-- CreateTable
CREATE TABLE "shift_reports" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "document" JSONB NOT NULL,
    "summaryText" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL DEFAULT 'system',
    "automatic" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,
    "shareToken" TEXT NOT NULL,
    "shareExpiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_report_versions" (
    "id" TEXT NOT NULL,
    "shiftReportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "document" JSONB NOT NULL,
    "summaryText" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "replacedBy" TEXT NOT NULL,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_reports_shiftId_key" ON "shift_reports"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "shift_reports_shareToken_key" ON "shift_reports"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "shift_report_versions_shiftReportId_version_key" ON "shift_report_versions"("shiftReportId", "version");

-- CreateIndex
CREATE INDEX "notification_deliveries_shiftReportId_idx" ON "notification_deliveries"("shiftReportId");

-- AddForeignKey
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "actual_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_report_versions" ADD CONSTRAINT "shift_report_versions_shiftReportId_fkey" FOREIGN KEY ("shiftReportId") REFERENCES "shift_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_shiftReportId_fkey" FOREIGN KEY ("shiftReportId") REFERENCES "shift_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

