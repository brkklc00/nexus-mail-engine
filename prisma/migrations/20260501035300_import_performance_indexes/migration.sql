-- Import performance indexes (idempotent)
-- NOTE: Recipient does not contain listId. List-level lookups are handled by RecipientListMembership.

CREATE INDEX IF NOT EXISTS "idx_recipient_email_lower"
  ON "Recipient" (LOWER("email"));

CREATE INDEX IF NOT EXISTS "idx_recipient_list"
  ON "RecipientListMembership" ("listId");
