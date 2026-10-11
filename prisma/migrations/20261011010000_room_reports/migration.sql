-- CreateTable
CREATE TABLE "room_reports" (
    "id" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL DEFAULT 'system',
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "shareToken" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "history" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "room_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_reports_businessDate_key" ON "room_reports"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "room_reports_shareToken_key" ON "room_reports"("shareToken");
