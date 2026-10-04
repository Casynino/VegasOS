-- AlterTable
ALTER TABLE "daily_reports" ADD COLUMN     "automatic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "document" JSONB,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "daily_report_versions" (
    "id" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "document" JSONB,
    "summaryText" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "replacedBy" TEXT NOT NULL,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_report_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_versions_dailyReportId_version_key" ON "daily_report_versions"("dailyReportId", "version");

-- AddForeignKey
ALTER TABLE "daily_report_versions" ADD CONSTRAINT "daily_report_versions_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

