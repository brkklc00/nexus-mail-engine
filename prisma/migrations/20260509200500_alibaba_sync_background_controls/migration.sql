-- AlterTable
ALTER TABLE "AlibabaSuppressionSyncState"
ADD COLUMN "stopRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "removeFromLists" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "lockOwner" TEXT,
ADD COLUMN "meta" JSONB;
