-- 011_transportation_invoice.sql
ALTER TABLE transportation
  ADD COLUMN IF NOT EXISTS invoice TEXT;