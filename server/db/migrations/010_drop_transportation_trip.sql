-- ============================================================================
-- 010 — Transportation: fully standalone. No more link to purchase trips.
--       Drop trip_id and link_type. Customer name stays as free text.
-- ============================================================================

ALTER TABLE transportation DROP COLUMN IF EXISTS trip_id;
ALTER TABLE transportation DROP COLUMN IF EXISTS link_type;

CREATE INDEX IF NOT EXISTS idx_transportation_date
  ON transportation(date_ad DESC, id DESC) WHERE deleted_at IS NULL;