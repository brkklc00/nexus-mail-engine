-- CreateTable
CREATE TABLE "AlibabaSuppressionSyncState" (
    "id" TEXT NOT NULL,
    "syncType" TEXT NOT NULL DEFAULT 'query_invalid_address',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "nextStart" TEXT,
    "nextStartHash" TEXT,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "rawRecords" INTEGER NOT NULL DEFAULT 0,
    "parsedEmails" INTEGER NOT NULL DEFAULT 0,
    "addedToSuppression" INTEGER NOT NULL DEFAULT 0,
    "alreadySuppressed" INTEGER NOT NULL DEFAULT 0,
    "removedFromLists" INTEGER NOT NULL DEFAULT 0,
    "invalidEmailSkipped" INTEGER NOT NULL DEFAULT 0,
    "ignoredTemporary" INTEGER NOT NULL DEFAULT 0,
    "ignoredUnknown" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "AlibabaSuppressionSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alibaba_sync_type_unique" ON "AlibabaSuppressionSyncState"("syncType");

-- CreateIndex
CREATE INDEX "AlibabaSuppressionSyncState_status_updatedAt_idx" ON "AlibabaSuppressionSyncState"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "SuppressionEntry_emailNormalized_createdAt_idx" ON "SuppressionEntry"("emailNormalized", "createdAt");

-- CreateIndex
CREATE INDEX "SuppressionEntry_source_createdAt_idx" ON "SuppressionEntry"("source", "createdAt");
