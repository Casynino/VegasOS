-- System events (owner, 2026-10-18): what the SYSTEM did or failed to do — unexpected server errors, runs of the automatic jobs
-- and receipts of webhooks — so the Developer console can show whether the system works. Additive: ONE new table, no change to any
-- existing table, no data touched. It holds no hotel data and nothing personal (messages are scrubbed before they are written).

-- CreateTable
CREATE TABLE "system_events" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_events_kind_lastSeenAt_idx" ON "system_events"("kind", "lastSeenAt");

-- CreateIndex
CREATE INDEX "system_events_fingerprint_idx" ON "system_events"("fingerprint");
