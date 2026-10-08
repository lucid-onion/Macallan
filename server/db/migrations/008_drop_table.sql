-- ============================================================================
-- 008 — Transportation: link type + customer name.
--       Transportation no longer FKs to purchases/sales via a picker; it links
--       by either a purchase trip (trip_id) or a free-text customer name.
-- ============================================================================

ALTER TABLE transportation
  ADD COLUMN IF NOT EXISTS link_type     TEXT CHECK (link_type IN ('purchase','customer')),
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- Backfill: any existing row that linked to a purchase/sale keeps that meaning.
UPDATE transportation SET link_type = 'purchase'
 WHERE purchase_id IS NOT NULL AND link_type IS NULL;
UPDATE transportation SET link_type = 'customer'
 WHERE sale_id IS NOT NULL AND link_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_transportation_link_type
  ON transportation(link_type) WHERE deleted_at IS NULL;