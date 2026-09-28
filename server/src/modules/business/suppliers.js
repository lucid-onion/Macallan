import { z } from "zod";
import { Router } from "express";
import { query } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";
import { notFound, conflict } from "../../utils/errors.js";

const router = Router();
router.use(requireAuth);

const schema = z.object({
  name:    z.string().min(1).max(120),
  contact: z.string().max(120).optional(),
  phone:   z.string().max(40).optional(),
  type:    z.enum(["main", "small"]).optional(),
});

/* List — suppliers with rolled-up purchase + payment totals. */
router.get("/", requirePermission("suppliers", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT s.*,
        COALESCE((SELECT SUM(p.total)
                    FROM purchases p
                   WHERE p.supplier_id = s.id AND p.deleted_at IS NULL), 0) AS total_purchases,
        COALESCE((SELECT SUM(CASE WHEN t.direction='out' THEN t.amount ELSE -t.amount END)
                    FROM transactions t
                   WHERE t.party_type = 'supplier'
                     AND t.party_key  = s.name
                     AND t.deleted_at IS NULL), 0) AS advance_amount
        FROM suppliers s
       WHERE s.deleted_at IS NULL
       ORDER BY s.name
    `);

    const items = rows.map((r) => {
      const billed  = Number(r.total_purchases) || 0;
      const advance = Number(r.advance_amount) || 0;
      return {
        ...r,
        total_purchases: billed,
        advance_amount:  advance,
        due_amount:      Math.max(0, billed - advance),
      };
    });

    res.json({ items });
  } catch (e) { next(e); }
});

router.get("/:id", requirePermission("suppliers", "view"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM suppliers WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) throw notFound();
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.post("/", requirePermission("suppliers", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);
    const dup = await query(
      `SELECT 1 FROM suppliers WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
      [input.name]
    );
    if (dup.rowCount) throw conflict("Supplier already exists");
    const { rows } = await query(
      `INSERT INTO suppliers (name, contact, phone, type, created_by)
       VALUES ($1,$2,$3,COALESCE($4,'main'),$5) RETURNING *`,
      [input.name, input.contact || null, input.phone || null, input.type, req.user.id]
    );
    await audit(req, "supplier.create", "supplier", rows[0].id, input);
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.patch("/:id", requirePermission("suppliers", "update"), async (req, res, next) => {
  try {
    const input = schema.partial().parse(req.body);
    const sets = []; const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (input.name    !== undefined) add("name", input.name);
    if (input.contact !== undefined) add("contact", input.contact);
    if (input.phone   !== undefined) add("phone", input.phone);
    if (input.type    !== undefined) add("type", input.type);
    if (!sets.length) return res.json({ ok: true });
    sets.push("updated_at = now()");
    params.push(req.params.id);
    const { rowCount } = await query(
      `UPDATE suppliers SET ${sets.join(", ")} WHERE id = $${params.length} AND deleted_at IS NULL`,
      params
    );
    if (!rowCount) throw notFound();
    await audit(req, "supplier.update", "supplier", req.params.id, input);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:id", requirePermission("suppliers", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE suppliers SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();
    await audit(req, "supplier.delete", "supplier", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;