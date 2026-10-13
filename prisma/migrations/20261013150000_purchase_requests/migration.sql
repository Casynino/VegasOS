-- AlterTable
ALTER TABLE "stock_requests" ADD COLUMN     "approvedBudget" INTEGER,
ADD COLUMN     "clientKey" TEXT,
ADD COLUMN     "estimatedTotal" INTEGER,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "stock_documents" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "note" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_fileId_key" ON "stock_documents"("fileId");

-- CreateIndex
CREATE INDEX "stock_documents_requestId_kind_idx" ON "stock_documents"("requestId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "stock_requests_clientKey_key" ON "stock_requests"("clientKey");

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "stock_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Purchase requests (hand-written): what a request may say, kept by the database itself.
UPDATE "stock_requests" SET "priority" = 'URGENT' WHERE "urgent" = true;
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_priority_ok" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'));
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_money_ok" CHECK (("estimatedTotal" IS NULL OR "estimatedTotal" >= 0) AND ("approvedBudget" IS NULL OR "approvedBudget" >= 0));
