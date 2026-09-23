/* ==========================================================================
   Transactions module — the unified cash ledger.
   Every money-in / money-out event lives here: customer payments, supplier
   payments, advances, owner deposits/withdrawals and manual adjustments.
   Purchases/sales/office expenses never post here automatically — only real
   cash movements do.
   ========================================================================== */
import { Router } from "express";
import { z } from "zod";
import { query } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";
import { notFound } from "../../utils/errors.js";

const router = Router();
router.use(requireAuth);

const schema = z.object({
  type:        z.string().min(1).max(40),
  party_type:  z.enum(["customer", "supplier", "owner", "other"]),
  party_key:   z.string().max(120).optional(),
  party_label: z.string().max(200).optional(),
  direction:   z.enum(["in", "out"]),
  amount:      z.number().positive(),
  method:      z.enum(["Cash", "Online"]).optional(),
  ref_type:    z.string().max(20).optional(),
  ref_id:      z.number().int().positive().nullable().optional(),
  date_bs_year:  z.number().int().min(2000).max(2200),
  date_bs_month: z.number().int().min(1).max(12),
  date_bs_day:   z.number().int().min(1).max(32),
  date_ad:       z.string(),
  company:       z.string().max(120).optional(),
  note:          z.string().max(500).optional(),
});

router.get("/", requirePermission("transactions", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY date_ad DESC, id DESC`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.get("/:id", requirePermission("transactions", "view"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM transactions WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) throw notFound();
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.post("/", requirePermission("transactions", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);
    const cols = Object.keys(input);
    const vals = Object.values(input);
    cols.push("created_by");
    vals.push(req.user.id);
    const placeholders = cols.map((_, i) => `$${i + 1}`);

    const { rows } = await query(
      `INSERT INTO transactions (${cols.join(",")})
       VALUES (${placeholders.join(",")}) RETURNING *`,
      vals
    );
    await audit(req, "transaction.create", "transaction", rows[0].id, {
      amount: input.amount, direction: input.direction, type: input.type,
    });
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.patch("/:id", requirePermission("transactions", "update"), async (req, res, next) => {
  try {
    const input = schema.partial().parse(req.body);
    const entries = Object.entries(input);
    if (!entries.length) return res.json({ ok: true });

    const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
    const vals = entries.map(([, v]) => v);
    vals.push(req.params.id);
    const { rowCount } = await query(
      `UPDATE transactions SET ${sets.join(", ")}
        WHERE id = $${vals.length} AND deleted_at IS NULL`,
      vals
    );
    if (!rowCount) throw notFound();
    await audit(req, "transaction.update", "transaction", req.params.id, input);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:id", requirePermission("transactions", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE transactions SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();
    await audit(req, "transaction.delete", "transaction", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;