ALTER TABLE "Campaign"
ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Campaign"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Campaign_isDeleted_createdAt_idx" ON "Campaign"("isDeleted", "createdAt");
