-- ============================================================================
-- 003 — Purchases: extra columns to match the "All Scrap Nepal" truck slip
--       and its optional payment block. All nullable so existing rows are
--       untouched, all idempotent so re-running is safe.
-- ============================================================================

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS contact_person  TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone   TEXT,
  ADD COLUMN IF NOT EXISTS truck_weight_kg NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS loader_name     TEXT,
  ADD COLUMN IF NOT EXISTS cash_source     TEXT,
  ADD COLUMN IF NOT EXISTS paid_by         TEXT,
  ADD COLUMN IF NOT EXISTS signature       TEXT;

-- Optional: keep the truck_driver_phone column name identical to what the
-- React client already sends (it uses truck_driver_phone).
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS truck_driver_phone TEXT;