-- Guardrail migration for environments that missed earlier schema migrations.
-- Safe to apply multiple times due to IF NOT EXISTS / idempotent ALTERs.

ALTER TABLE "Segment"
ADD COLUMN IF NOT EXISTS "queryConfig" JSONB,
ADD COLUMN IF NOT EXISTS "isArchived" BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS "lastCalculatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastMatchedCount" INTEGER DEFAULT 0;

UPDATE "Segment" SET "isArchived" = false WHERE "isArchived" IS NULL;
UPDATE "Segment" SET "lastMatchedCount" = 0 WHERE "lastMatchedCount" IS NULL;
ALTER TABLE "Segment" ALTER COLUMN "isArchived" SET DEFAULT false;
ALTER TABLE "Segment" ALTER COLUMN "isArchived" SET NOT NULL;
ALTER TABLE "Segment" ALTER COLUMN "lastMatchedCount" SET DEFAULT 0;
ALTER TABLE "Segment" ALTER COLUMN "lastMatchedCount" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Segment_isArchived_createdAt_idx"
ON "Segment"("isArchived", "createdAt");

ALTER TABLE "SmtpAccount"
ADD COLUMN IF NOT EXISTS "minuteCap" INTEGER,
ADD COLUMN IF NOT EXISTS "warmupEnabled" BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS "warmupStartRps" DOUBLE PRECISION DEFAULT 1,
ADD COLUMN IF NOT EXISTS "warmupIncrementStep" DOUBLE PRECISION DEFAULT 1,
ADD COLUMN IF NOT EXISTS "warmupMaxRps" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "healthStatus" TEXT DEFAULT 'healthy',
ADD COLUMN IF NOT EXISTS "lastError" TEXT,
ADD COLUMN IF NOT EXISTS "lastTestAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastSuccessAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "cooldownUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "groupLabel" TEXT;

UPDATE "SmtpAccount" SET "warmupEnabled" = true WHERE "warmupEnabled" IS NULL;
UPDATE "SmtpAccount" SET "warmupStartRps" = 1 WHERE "warmupStartRps" IS NULL;
UPDATE "SmtpAccount" SET "warmupIncrementStep" = 1 WHERE "warmupIncrementStep" IS NULL;
UPDATE "SmtpAccount" SET "healthStatus" = 'healthy' WHERE "healthStatus" IS NULL;
UPDATE "SmtpAccount" SET "tags" = ARRAY[]::TEXT[] WHERE "tags" IS NULL;

ALTER TABLE "SmtpAccount" ALTER COLUMN "warmupEnabled" SET DEFAULT true;
ALTER TABLE "SmtpAccount" ALTER COLUMN "warmupEnabled" SET NOT NULL;
ALTER TABLE "SmtpAccount" ALTER COLUMN "warmupStartRps" SET DEFAULT 1;
ALTER TABLE "SmtpAccount" ALTER COLUMN "warmupStartRps" SET NOT NULL;
ALTER TABLE "SmtpAccount" ALTER COLUMN "warmupIncrementStep" SET DEFAULT 1;
ALTER TABLE "SmtpAccount" ALTER COLUMN "warmupIncrementStep" SET NOT NULL;
ALTER TABLE "SmtpAccount" ALTER COLUMN "healthStatus" SET DEFAULT 'healthy';
ALTER TABLE "SmtpAccount" ALTER COLUMN "healthStatus" SET NOT NULL;
ALTER TABLE "SmtpAccount" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SmtpAccount" ALTER COLUMN "tags" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "SmtpAccount_healthStatus_isActive_idx"
ON "SmtpAccount"("healthStatus", "isActive");
