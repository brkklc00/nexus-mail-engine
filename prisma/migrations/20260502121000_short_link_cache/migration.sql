-- Optional cache for external short links (idempotent)
CREATE TABLE IF NOT EXISTS "ShortLinkCache" (
  "id" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "shortUrl" TEXT NOT NULL,
  "alias" TEXT,
  "destinationUrl" TEXT NOT NULL,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "campaignId" TEXT,
  "templateId" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShortLinkCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShortLinkCache_externalId_key" ON "ShortLinkCache"("externalId");
CREATE UNIQUE INDEX IF NOT EXISTS "ShortLinkCache_shortUrl_key" ON "ShortLinkCache"("shortUrl");
CREATE INDEX IF NOT EXISTS "ShortLinkCache_campaignId_idx" ON "ShortLinkCache"("campaignId");
CREATE INDEX IF NOT EXISTS "ShortLinkCache_templateId_idx" ON "ShortLinkCache"("templateId");
CREATE INDEX IF NOT EXISTS "ShortLinkCache_clicks_idx" ON "ShortLinkCache"("clicks");
