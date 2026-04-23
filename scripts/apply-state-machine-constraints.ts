import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignRecipientSendStatus') THEN
    CREATE TYPE "CampaignRecipientSendStatus" AS ENUM ('pending', 'queued', 'sent', 'failed', 'skipped');
  END IF;
END $$;

ALTER TABLE "CampaignRecipient"
  ALTER COLUMN "sendStatus" TYPE "CampaignRecipientSendStatus"
  USING (
    CASE
      WHEN "sendStatus" IN ('pending', 'queued', 'sent', 'failed', 'skipped')
        THEN "sendStatus"::"CampaignRecipientSendStatus"
      ELSE 'pending'::"CampaignRecipientSendStatus"
    END
  );

ALTER TABLE "CampaignRecipient"
  ALTER COLUMN "sendStatus" SET DEFAULT 'pending';

ALTER TABLE "CampaignRecipient"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION enforce_campaign_recipient_send_status_transition()
RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW."sendStatus" = OLD."sendStatus" THEN
    RETURN NEW;
  END IF;

  IF OLD."sendStatus" = 'pending' AND NEW."sendStatus" IN ('queued', 'skipped') THEN
    RETURN NEW;
  END IF;

  IF OLD."sendStatus" = 'queued' AND NEW."sendStatus" IN ('sent', 'failed', 'skipped', 'pending') THEN
    RETURN NEW;
  END IF;

  IF OLD."sendStatus" = 'failed' AND NEW."sendStatus" IN ('queued', 'skipped') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid CampaignRecipient sendStatus transition: % -> %', OLD."sendStatus", NEW."sendStatus";
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaign_recipient_send_status_transition ON "CampaignRecipient";
CREATE TRIGGER trg_campaign_recipient_send_status_transition
BEFORE UPDATE ON "CampaignRecipient"
FOR EACH ROW EXECUTE FUNCTION enforce_campaign_recipient_send_status_transition();
`;

async function main() {
  await prisma.$executeRawUnsafe(SQL);
  console.log("CampaignRecipient state machine constraints applied.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
