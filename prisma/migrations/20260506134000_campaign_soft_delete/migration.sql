ALTER TABLE "Campaign"
ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Campaign_isDeleted_createdAt_idx" ON "Campaign"("isDeleted", "createdAt");
