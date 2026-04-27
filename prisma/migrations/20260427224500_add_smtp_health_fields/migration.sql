-- Ensure SMTP health and warmup fields exist in environments with drift.

ALTER TABLE "SmtpAccount"
ADD COLUMN IF NOT EXISTS "minuteCap" INTEGER,
ADD COLUMN IF NOT EXISTS "warmupEnabled" BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS "warmupStartRps" DOUBLE PRECISION DEFAULT 1,
ADD COLUMN IF NOT EXISTS "warmupIncrementStep" DOUBLE PRECISION DEFAULT 1,
ADD COLUMN IF NOT EXISTS "warmupMaxRps" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "healthStatus" TEXT DEFAULT 'healthy',
ADD COLUMN IF NOT EXISTS "lastError" TEXT,
ADD COLUMN IF NOT EXISTS "lastTestAt" TIMESTAMP(3),
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
