-- Alibaba suppression sync: retry / diagnostics columns
ALTER TABLE "AlibabaSuppressionSyncState"
  ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxRetries" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "lastRetryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastFailureAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastFailureCode" TEXT,
  ADD COLUMN IF NOT EXISTS "lastFailureMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "AlibabaSuppressionSyncState_status_nextRetryAt_idx"
  ON "AlibabaSuppressionSyncState" ("status", "nextRetryAt");
