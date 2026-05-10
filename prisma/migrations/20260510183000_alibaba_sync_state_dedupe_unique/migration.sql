-- Remove duplicate AlibabaSuppressionSyncState rows per syncType (keep newest by updatedAt, then id).
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "syncType"
      ORDER BY "updatedAt" DESC, id DESC
    ) AS rn
  FROM "AlibabaSuppressionSyncState"
)
DELETE FROM "AlibabaSuppressionSyncState" s
USING ranked r
WHERE s.id = r.id
  AND r.rn > 1;

-- Ensure one row per syncType (idempotent if index already exists from earlier migration).
CREATE UNIQUE INDEX IF NOT EXISTS "alibaba_sync_type_unique" ON "AlibabaSuppressionSyncState" ("syncType");
