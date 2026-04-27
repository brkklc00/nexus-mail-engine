ALTER TABLE "Campaign"
ADD COLUMN "smtpPoolConfig" JSONB;

ALTER TABLE "CampaignRecipient"
ADD COLUMN "smtpAccountId" TEXT;

CREATE INDEX "CampaignRecipient_smtpAccountId_sendStatus_idx"
ON "CampaignRecipient"("smtpAccountId", "sendStatus");
