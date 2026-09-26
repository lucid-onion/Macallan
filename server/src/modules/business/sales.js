import { z } from "zod";
import { Router } from "express";
import { query, withTx } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";
import { notFound, conflict } from "../../utils/errors.js";
import { createLinkedTransport } from "./_transport-link.js";

const router = Router();
router.use(requireAuth);

const schema = z.object({
  invoice:             z.string().min(1).max(60),
  customer_id:         z.number().int().positive(),
  product:             z.string().min(1).max(120),
  date_bs_year:        z.number().int().min(2000).max(2200),
  date_bs_month:       z.number().int().min(1).max(12),
  date_bs_day:         z.number().int().min(1).max(32),
  date_ad:             z.string(),
  gross_qty:           z.number().min(0),
  dust_qty:            z.number().min(0).optional(),
  net_qty:             z.number().min(0),
  rate:                z.number().min(0),
  total:               z.number().min(0),
  transport_fee:       z.number().min(0).optional(),
  labor_charge:        z.number().min(0).optional(),
  road_expense:        z.number().min(0).optional(),
  tax_gbse:            z.number().min(0).optional(),
  truck_no:            z.string().max(60).optional(),
  truck_driver:        z.string().max(120).optional(),
  truck_driver_phone:  z.string().max(40).optional(),
  from_location:       z.string().max(200).optional(),
  to_location:         z.string().max(200).optional(),
  status:              z.enum(["Delivered", "Pending"]).optional(),
  company:             z.string().max(120).optional(),
});

router.get("/", requirePermission("sales", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM sales WHERE deleted_at IS NULL ORDER BY date_ad DESC, id DESC`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.get("/:id", requirePermission("sales", "view"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM sales WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) throw notFound();
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.post("/", requirePermission("sales", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);

    const dup = await query(
      `SELECT 1 FROM sales WHERE invoice = $1 AND deleted_at IS NULL`,
      [input.invoice]
    );
    if (dup.rowCount) throw conflict("A sale with that invoice already exists");

    const created = await withTx(async (client) => {
      const cols = Object.keys(input);
      const vals = Object.values(input);
      cols.push("created_by");
      vals.push(req.user.id);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const { rows } = await client.query(
        `INSERT INTO sales (${cols.join(",")}) VALUES (${placeholders.join(",")}) RETURNING *`,
        vals
      );
      return rows[0];
    });

    let transport = null;
    try {
      transport = await createLinkedTransport({ kind: "sale", source: created });
    } catch (err) {
      console.error("transport link failed for sale", created.id, err.message);
    }

    await audit(req, "sale.create", "sale", created.id, {
      invoice: created.invoice,
      linkedTransport: transport?.id || null,
    });
    res.status(201).json({ item: created, transport });
  } catch (e) { next(e); }
});

router.patch("/:id", requirePermission("sales", "update"), async (req, res, next) => {
  try {
    const input = schema.partial().parse(req.body);
    const entries = Object.entries(input);
    if (!entries.length) return res.json({ ok: true });
    const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
    const vals = entries.map(([, v]) => v);
    sets.push("updated_at = now()");
    vals.push(req.params.id);
    const { rowCount } = await query(
      `UPDATE sales SET ${sets.join(", ")} WHERE id = $${vals.length} AND deleted_at IS NULL`,
      vals
    );
    if (!rowCount) throw notFound();
    await audit(req, "sale.update", "sale", req.params.id, input);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:id", requirePermission("sales", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE sales SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();
    await query(
      `UPDATE transportation SET deleted_at = now()
        WHERE sale_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    await audit(req, "sale.delete", "sale", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
