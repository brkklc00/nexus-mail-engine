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
