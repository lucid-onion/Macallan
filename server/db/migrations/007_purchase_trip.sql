-- ============================================================================
-- 007 — Purchase trips + Transportation money model.
--
-- Purchases:
--   trip_id   UUID — groups all purchases that arrived on one truck
--
-- Transportation:
--   rate      NUMERIC — Rs per kg, drives total amount = rate × load
--   advance   NUMERIC — driver advance paid up front
--   trip_id   UUID    — links a transportation row to a purchase trip
--
-- New table:
--   transportation_payments — additional payments to the driver, N per trip
--
-- All additive. No existing columns touched. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Purchase trips
-- ---------------------------------------------------------------------------
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS trip_id UUID;

CREATE INDEX IF NOT EXISTS idx_purchases_trip
  ON purchases(trip_id) WHERE trip_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Transportation: rate + advance + trip link
--    `fee` stays as-is (existing rows use it); new UI treats it as "driver
--    advance" but the column name is unchanged to avoid breaking reports.
-- ---------------------------------------------------------------------------
ALTER TABLE transportation
  ADD COLUMN IF NOT EXISTS rate    NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS advance NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trip_id UUID;

CREATE INDEX IF NOT EXISTS idx_transportation_trip
  ON transportation(trip_id) WHERE trip_id IS NOT NULL;

-- Backfill: every existing transportation row's "advance" = its current fee,
-- so the money math is unchanged for historical records.
UPDATE transportation
   SET advance = fee
 WHERE advance = 0 AND fee > 0;

-- ---------------------------------------------------------------------------
-- 3. Per-transport payments to the driver
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transportation_payments (
  id                SERIAL PRIMARY KEY,
  transportation_id INT NOT NULL REFERENCES transportation(id) ON DELETE CASCADE,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method            TEXT CHECK (method IN ('Cash','Online')),
  note              TEXT,
  date_bs_year      INT NOT NULL,
  date_bs_month     INT NOT NULL CHECK (date_bs_month BETWEEN 1 AND 12),
  date_bs_day       INT NOT NULL CHECK (date_bs_day BETWEEN 1 AND 32),
  date_ad           DATE NOT NULL,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transport_payments_active
  ON transportation_payments(transportation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transport_payments_date
  ON transportation_payments(date_ad DESC, id DESC);