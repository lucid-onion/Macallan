import { z } from "zod";
import { Router } from "express";
import { query, withTx } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";
import { notFound } from "../../utils/errors.js";

const router = Router();
router.use(requireAuth);

// Office expenses have line items, so they can't use the generic factory.

const lineSchema = z.object({
  description: z.string().min(1).max(200),
  amount: z.number().min(0),
});

const schema = z.object({
  date_bs_year:  z.number().int().min(2000).max(2200),
  date_bs_month: z.number().int().min(1).max(12),
  date_bs_day:   z.number().int().min(1).max(32),
  date_ad:       z.string(),
  company:       z.string().max(120).optional(),
  note:          z.string().max(500).optional(),
  items:         z.array(lineSchema).min(1),
});

router.get("/", requirePermission("office_expenses", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.*,
              COALESCE(json_agg(json_build_object('description', i.description, 'amount', i.amount))
                       FILTER (WHERE i.id IS NOT NULL), '[]') AS items
         FROM office_expenses e
         LEFT JOIN office_expense_items i ON i.expense_id = e.id
        WHERE e.deleted_at IS NULL
        GROUP BY e.id
        ORDER BY e.date_ad DESC, e.id DESC`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/", requirePermission("office_expenses", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);
    const total = input.items.reduce((s, i) => s + i.amount, 0);

    const created = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO office_expenses
           (date_bs_year, date_bs_month, date_bs_day, date_ad, company, total, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [input.date_bs_year, input.date_bs_month, input.date_bs_day, input.date_ad,
         input.company || null, total, input.note || null, req.user.id]
      );
      const expense = rows[0];
      for (const item of input.items) {
        await client.query(
          `INSERT INTO office_expense_items (expense_id, description, amount) VALUES ($1,$2,$3)`,
          [expense.id, item.description, item.amount]
        );
      }
      return expense;
    });

    await audit(req, "office_expense.create", "office_expense", created.id, { total });
    res.status(201).json({ item: created });
  } catch (e) { next(e); }
});

router.patch("/:id", requirePermission("office_expenses", "update"), async (req, res, next) => {
  try {
    const input = schema.partial().parse(req.body);
    // For brevity: only support note/company updates on the parent row here.
    // Full item replacement can be added if needed.
    const sets = []; const vals = [];
    if (input.company !== undefined) { vals.push(input.company); sets.push(`company = $${vals.length}`); }
    if (input.note !== undefined)    { vals.push(input.note);    sets.push(`note = $${vals.length}`); }
    if (!sets.length) return res.json({ ok: true });
    sets.push("updated_at = now()");
    vals.push(req.params.id);
    const { rowCount } = await query(
      `UPDATE office_expenses SET ${sets.join(", ")} WHERE id = $${vals.length} AND deleted_at IS NULL`,
      vals
    );
    if (!rowCount) throw notFound();
    await audit(req, "office_expense.update", "office_expense", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:id", requirePermission("office_expenses", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE office_expenses SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();
    await audit(req, "office_expense.delete", "office_expense", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;