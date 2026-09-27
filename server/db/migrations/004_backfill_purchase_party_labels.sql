-- ============================================================================
-- 004 — One-time data repair.
--
-- Purchase-linked transactions created before the party_label fix have
-- party_label = NULL, which makes the ledger display a numeric id instead of
-- the supplier name. Backfill them from the purchases → suppliers join.
--
-- Safe to re-run: the WHERE party_label IS NULL guard makes it a no-op
-- after the first pass.
-- ============================================================================

UPDATE transactions t
   SET party_label = s.name
  FROM purchases p
  JOIN suppliers s ON s.id = p.supplier_id
 WHERE t.ref_type = 'purchase'
   AND t.ref_id = p.id
   AND t.party_label IS NULL;