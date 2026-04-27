ALTER TABLE "SmtpAccount"
ADD COLUMN "minuteCap" INTEGER,
ADD COLUMN "warmupEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "warmupStartRps" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN "warmupIncrementStep" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN "warmupMaxRps" DOUBLE PRECISION,
ADD COLUMN "healthStatus" TEXT NOT NULL DEFAULT 'healthy',
ADD COLUMN "lastError" TEXT,
ADD COLUMN "lastTestAt" TIMESTAMP(3),
ADD COLUMN "lastSuccessAt" TIMESTAMP(3),
ADD COLUMN "cooldownUntil" TIMESTAMP(3),
ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "groupLabel" TEXT;

CREATE INDEX "SmtpAccount_healthStatus_isActive_idx"
ON "SmtpAccount"("healthStatus", "isActive");
