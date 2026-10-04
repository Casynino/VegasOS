-- DropForeignKey
ALTER TABLE "service_requests" DROP CONSTRAINT "service_requests_createdById_fkey";

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "clientKey" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'STAFF',
ALTER COLUMN "createdById" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_clientKey_key" ON "service_requests"("clientKey");

-- CreateIndex
CREATE INDEX "service_requests_assignedToId_status_idx" ON "service_requests"("assignedToId", "status");

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Requests already being handled count as accepted when they were last changed.
UPDATE "service_requests" SET "acceptedAt" = "updatedAt" WHERE "status" IN ('IN_PROGRESS', 'COMPLETED') AND "acceptedAt" IS NULL;
