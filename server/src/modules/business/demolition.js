import { z } from "zod";
import { Router } from "express";
import { query, withTx } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";
import { notFound } from "../../utils/errors.js";

const router = Router();
router.use(requireAuth);

const lineSchema = z.object({
  description: z.string().min(1).max(200),
  quantity:    z.number().min(0),
  rate:        z.number().min(0),
  amount:      z.number().min(0),
});

const schema = z.object({
  date_bs_year:  z.number().int().min(2000).max(2200),
  date_bs_month: z.number().int().min(1).max(12),
  date_bs_day:   z.number().int().min(1).max(32),
  date_ad:       z.string(),
  company:       z.string().max(120).optional(),
  site:          z.string().max(200).optional(),
  transport_fee: z.number().min(0).optional(),
  note:          z.string().max(500).optional(),
  items:         z.array(lineSchema).default([]),
});

router.get("/", requirePermission("demolition", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT d.*,
              COALESCE(json_agg(json_build_object(
                'description', i.description,
                'quantity', i.quantity,
                'rate', i.rate,
                'amount', i.amount))
                FILTER (WHERE i.id IS NOT NULL), '[]') AS items
         FROM demolitions d
         LEFT JOIN demolition_items i ON i.demolition_id = d.id
        WHERE d.deleted_at IS NULL
        GROUP BY d.id
        ORDER BY d.date_ad DESC, d.id DESC`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/", requirePermission("demolition", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);
    const expenseTotal = input.items.reduce((s, i) => s + i.amount, 0);
    const transportFee = input.transport_fee || 0;
    const total = expenseTotal + transportFee;

    const created = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO demolitions
           (date_bs_year, date_bs_month, date_bs_day, date_ad, company, site,
            transport_fee, expense_total, total, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [input.date_bs_year, input.date_bs_month, input.date_bs_day, input.date_ad,
         input.company || null, input.site || null, transportFee, expenseTotal, total,
         input.note || null, req.user.id]
      );
      const d = rows[0];
      for (const item of input.items) {
        await client.query(
          `INSERT INTO demolition_items (demolition_id, description, quantity, rate, amount)
           VALUES ($1,$2,$3,$4,$5)`,
          [d.id, item.description, item.quantity, item.rate, item.amount]
        );
      }
      return d;
    });

    await audit(req, "demolition.create", "demolition", created.id, { total });
    res.status(201).json({ item: created });
  } catch (e) { next(e); }
});

router.delete("/:id", requirePermission("demolition", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE demolitions SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();
    await audit(req, "demolition.delete", "demolition", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;