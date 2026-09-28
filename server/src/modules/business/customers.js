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

router.get("/", requirePermission("customers", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT c.*,
        COALESCE((SELECT SUM(s.total)
                    FROM sales s
                   WHERE s.customer_id = c.id AND s.deleted_at IS NULL), 0) AS total_sales,
        COALESCE((SELECT SUM(CASE WHEN t.direction='in' THEN t.amount ELSE -t.amount END)
                    FROM transactions t
                   WHERE t.party_type = 'customer'
                     AND t.party_key  = c.id::text
                     AND t.deleted_at IS NULL), 0) AS received_amount
        FROM customers c
       WHERE c.deleted_at IS NULL
       ORDER BY c.name
    `);

    const items = rows.map((r) => {
      const billed   = Number(r.total_sales) || 0;
      const received = Number(r.received_amount) || 0;
      return {
        ...r,
        total_sales:     billed,
        received_amount: received,
        due_amount:      Math.max(0, billed - received),
      };
    });

    res.json({ items });
  } catch (e) { next(e); }
});

router.get("/:id", requirePermission("customers", "view"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) throw notFound();
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.post("/", requirePermission("customers", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);
    const dup = await query(
      `SELECT 1 FROM customers WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
      [input.name]
    );
    if (dup.rowCount) throw conflict("Customer already exists");
    const { rows } = await query(
      `INSERT INTO customers (name, contact, phone, type, created_by)
       VALUES ($1,$2,$3,COALESCE($4,'main'),$5) RETURNING *`,
      [input.name, input.contact || null, input.phone || null, input.type, req.user.id]
    );
    await audit(req, "customer.create", "customer", rows[0].id, input);
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.patch("/:id", requirePermission("customers", "update"), async (req, res, next) => {
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
      `UPDATE customers SET ${sets.join(", ")} WHERE id = $${params.length} AND deleted_at IS NULL`,
      params
    );
    if (!rowCount) throw notFound();
    await audit(req, "customer.update", "customer", req.params.id, input);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:id", requirePermission("customers", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE customers SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();
    await audit(req, "customer.delete", "customer", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;