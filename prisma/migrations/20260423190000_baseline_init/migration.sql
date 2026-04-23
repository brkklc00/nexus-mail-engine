-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'operator', 'analyst');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('active', 'unsubscribed', 'bounced', 'complained', 'invalid', 'blocked');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('pending', 'queued', 'running', 'paused', 'completed', 'failed', 'canceled', 'partially_completed');

-- CreateEnum
CREATE TYPE "CampaignLogStatus" AS ENUM ('success', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "CampaignRecipientSendStatus" AS ENUM ('pending', 'queued', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "SegmentOperator" AS ENUM ('eq', 'neq', 'in', 'not_in', 'contains', 'gte', 'lte');

-- CreateEnum
CREATE TYPE "SuppressionScope" AS ENUM ('global', 'list');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'admin',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "htmlBody" TEXT NOT NULL,
    "plainTextBody" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "enableOpenTracking" BOOLEAN NOT NULL DEFAULT true,
    "enableClickTracking" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipientList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT[],
    "notes" TEXT,
    "maxSize" INTEGER NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipientList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "name" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "tags" TEXT[],
    "customFields" JSONB,
    "status" "RecipientStatus" NOT NULL DEFAULT 'active',
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipientListMembership" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecipientListMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "listId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SegmentRule" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" "SegmentOperator" NOT NULL,
    "value" TEXT NOT NULL,
    "isExclude" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SegmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'pending',
    "templateId" TEXT NOT NULL,
    "listId" TEXT,
    "segmentId" TEXT,
    "smtpAccountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "stoppedEarly" BOOLEAN NOT NULL DEFAULT false,
    "effectiveRate" DOUBLE PRECISION,
    "throttled" BOOLEAN NOT NULL DEFAULT false,
    "throttleReason" TEXT,
    "totalTargeted" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "totalSkipped" INTEGER NOT NULL DEFAULT 0,
    "totalOpened" INTEGER NOT NULL DEFAULT 0,
    "totalClicked" INTEGER NOT NULL DEFAULT 0,
    "unsubscribeCount" INTEGER NOT NULL DEFAULT 0,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "complaintCount" INTEGER NOT NULL DEFAULT 0,
    "openRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clickRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clickToOpenRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "sendStatus" "CampaignRecipientSendStatus" NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLog" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT,
    "eventType" TEXT NOT NULL,
    "status" "CampaignLogStatus" NOT NULL DEFAULT 'success',
    "providerCode" TEXT,
    "message" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLink" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "campaignLinkId" TEXT,
    "targetUrl" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "eventKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "eventKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmtpAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "encryption" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEncrypted" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "replyTo" TEXT,
    "providerLabel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSoftDeleted" BOOLEAN NOT NULL DEFAULT false,
    "maxConnections" INTEGER,
    "maxMessages" INTEGER,
    "socketTimeout" INTEGER,
    "connectionTimeout" INTEGER,
    "dailyCap" INTEGER,
    "hourlyCap" INTEGER,
    "targetRatePerSecond" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "alibabaRateCap" DOUBLE PRECISION,
    "maxRatePerSecond" DOUBLE PRECISION,
    "alibabaWarmupMaxRatePerSecond" DOUBLE PRECISION,
    "isThrottled" BOOLEAN NOT NULL DEFAULT false,
    "throttleReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmtpAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmtpWarmupStat" (
    "id" TEXT NOT NULL,
    "smtpAccountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "successfulDeliveries" INTEGER NOT NULL DEFAULT 0,
    "failedDeliveries" INTEGER NOT NULL DEFAULT 0,
    "tierName" TEXT,
    "effectiveRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmtpWarmupStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitConfig" (
    "id" TEXT NOT NULL,
    "globalMaxRatePerSecond" DOUBLE PRECISION,
    "providerMaxRatePerSecond" JSONB,
    "smtpDefaultTargetRatePerSecond" DOUBLE PRECISION DEFAULT 1,
    "safetyModeErrorThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.12,
    "safetyModeBackoffMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "safetyModeRecoveryStep" DOUBLE PRECISION NOT NULL DEFAULT 1.1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "scope" "SuppressionScope" NOT NULL DEFAULT 'global',
    "listId" TEXT,
    "recipientId" TEXT,
    "reason" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "MailTemplate_status_createdAt_idx" ON "MailTemplate"("status", "createdAt");
CREATE INDEX "RecipientList_createdAt_idx" ON "RecipientList"("createdAt");
CREATE UNIQUE INDEX "Recipient_emailNormalized_key" ON "Recipient"("emailNormalized");
CREATE INDEX "Recipient_status_createdAt_idx" ON "Recipient"("status", "createdAt");
CREATE INDEX "RecipientListMembership_recipientId_idx" ON "RecipientListMembership"("recipientId");
CREATE UNIQUE INDEX "RecipientListMembership_listId_recipientId_key" ON "RecipientListMembership"("listId", "recipientId");
CREATE INDEX "Segment_listId_createdAt_idx" ON "Segment"("listId", "createdAt");
CREATE INDEX "SegmentRule_segmentId_idx" ON "SegmentRule"("segmentId");
CREATE INDEX "Campaign_status_createdAt_idx" ON "Campaign"("status", "createdAt");
CREATE INDEX "Campaign_smtpAccountId_status_idx" ON "Campaign"("smtpAccountId", "status");
CREATE INDEX "Campaign_provider_status_idx" ON "Campaign"("provider", "status");
CREATE INDEX "Campaign_startedAt_finishedAt_idx" ON "Campaign"("startedAt", "finishedAt");
CREATE UNIQUE INDEX "CampaignRecipient_idempotencyKey_key" ON "CampaignRecipient"("idempotencyKey");
CREATE INDEX "CampaignRecipient_sendStatus_createdAt_idx" ON "CampaignRecipient"("sendStatus", "createdAt");
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_recipientId_key" ON "CampaignRecipient"("campaignId", "recipientId");
CREATE UNIQUE INDEX "CampaignLog_idempotencyKey_key" ON "CampaignLog"("idempotencyKey");
CREATE INDEX "CampaignLog_campaignId_createdAt_idx" ON "CampaignLog"("campaignId", "createdAt");
CREATE INDEX "CampaignLog_status_createdAt_idx" ON "CampaignLog"("status", "createdAt");
CREATE UNIQUE INDEX "CampaignLink_token_key" ON "CampaignLink"("token");
CREATE INDEX "CampaignLink_campaignId_createdAt_idx" ON "CampaignLink"("campaignId", "createdAt");
CREATE INDEX "ClickEvent_campaignId_createdAt_idx" ON "ClickEvent"("campaignId", "createdAt");
CREATE INDEX "ClickEvent_recipientId_createdAt_idx" ON "ClickEvent"("recipientId", "createdAt");
CREATE INDEX "ClickEvent_campaignLinkId_createdAt_idx" ON "ClickEvent"("campaignLinkId", "createdAt");
CREATE INDEX "OpenEvent_campaignId_createdAt_idx" ON "OpenEvent"("campaignId", "createdAt");
CREATE INDEX "OpenEvent_recipientId_createdAt_idx" ON "OpenEvent"("recipientId", "createdAt");
CREATE INDEX "SmtpAccount_isActive_createdAt_idx" ON "SmtpAccount"("isActive", "createdAt");
CREATE INDEX "SmtpAccount_providerLabel_idx" ON "SmtpAccount"("providerLabel");
CREATE INDEX "SmtpWarmupStat_date_smtpAccountId_idx" ON "SmtpWarmupStat"("date", "smtpAccountId");
CREATE UNIQUE INDEX "SmtpWarmupStat_smtpAccountId_date_key" ON "SmtpWarmupStat"("smtpAccountId", "date");
CREATE INDEX "SuppressionEntry_reason_createdAt_idx" ON "SuppressionEntry"("reason", "createdAt");
CREATE INDEX "SuppressionEntry_listId_createdAt_idx" ON "SuppressionEntry"("listId", "createdAt");
CREATE UNIQUE INDEX "SuppressionEntry_emailNormalized_scope_key" ON "SuppressionEntry"("emailNormalized", "scope");
CREATE INDEX "AuditLog_resource_createdAt_idx" ON "AuditLog"("resource", "createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "RecipientListMembership" ADD CONSTRAINT "RecipientListMembership_listId_fkey" FOREIGN KEY ("listId") REFERENCES "RecipientList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecipientListMembership" ADD CONSTRAINT "RecipientListMembership_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_listId_fkey" FOREIGN KEY ("listId") REFERENCES "RecipientList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SegmentRule" ADD CONSTRAINT "SegmentRule_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MailTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_listId_fkey" FOREIGN KEY ("listId") REFERENCES "RecipientList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_smtpAccountId_fkey" FOREIGN KEY ("smtpAccountId") REFERENCES "SmtpAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignLog" ADD CONSTRAINT "CampaignLog_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignLink" ADD CONSTRAINT "CampaignLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_campaignLinkId_fkey" FOREIGN KEY ("campaignLinkId") REFERENCES "CampaignLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OpenEvent" ADD CONSTRAINT "OpenEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpenEvent" ADD CONSTRAINT "OpenEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SmtpWarmupStat" ADD CONSTRAINT "SmtpWarmupStat_smtpAccountId_fkey" FOREIGN KEY ("smtpAccountId") REFERENCES "SmtpAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
