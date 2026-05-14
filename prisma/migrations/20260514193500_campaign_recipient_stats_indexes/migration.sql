CREATE INDEX IF NOT EXISTS "CampaignRecipient_smtpAccountId_sendStatus_updatedAt_idx"
ON "CampaignRecipient"("smtpAccountId", "sendStatus", "updatedAt");

CREATE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_sendStatus_updatedAt_idx"
ON "CampaignRecipient"("campaignId", "sendStatus", "updatedAt");
