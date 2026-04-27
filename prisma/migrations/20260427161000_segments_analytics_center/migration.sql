ALTER TABLE "Segment"
ADD COLUMN "queryConfig" JSONB,
ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastCalculatedAt" TIMESTAMP(3),
ADD COLUMN "lastMatchedCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Campaign"
ADD COLUMN "segmentQueryConfig" JSONB;

CREATE INDEX "Segment_isArchived_createdAt_idx"
ON "Segment"("isArchived", "createdAt");
