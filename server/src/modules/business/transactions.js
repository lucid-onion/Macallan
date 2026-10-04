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
const nullableStr = (max) => z.string().max(max).nullable().optional();
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

/* --------------------------------------------------------------------------
   LIST — the full ledger
   -------------------------------------------------------------------------- */
router.get("/", requirePermission("transactions", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY date_ad DESC, id DESC`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

/* --------------------------------------------------------------------------
   PARTY BALANCES — must come BEFORE /:id so Express matches it first
   --------------------------------------------------------------------------
   Returns one row per customer and per supplier with billed / paid / due,
   plus the underlying bills and payments so the UI can render the breakdown
   modal without extra round-trips.
   -------------------------------------------------------------------------- */
router.get("/party-balances", requirePermission("transactions", "view"), async (_req, res, next) => {
  try {
    const customers = (await query(`
      SELECT c.id, c.name, c.type,
             COALESCE(SUM(s.total), 0) AS billed
        FROM customers c
        LEFT JOIN sales s ON s.customer_id = c.id AND s.deleted_at IS NULL
       WHERE c.deleted_at IS NULL
       GROUP BY c.id, c.name, c.type
       ORDER BY c.name
    `)).rows;

    const suppliers = (await query(`
      SELECT s.id, s.name, s.type,
             COALESCE(SUM(p.total), 0) AS billed
        FROM suppliers s
        LEFT JOIN purchases p ON p.supplier_id = s.id AND p.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
       GROUP BY s.id, s.name, s.type
       ORDER BY s.name
    `)).rows;

    const custPayments = (await query(`
      SELECT party_key, direction, amount, method, note,
             date_bs_year, date_bs_month, date_bs_day
        FROM transactions
       WHERE party_type = 'customer' AND deleted_at IS NULL
       ORDER BY date_ad DESC, id DESC
    `)).rows;

    const supPayments = (await query(`
      SELECT party_key, direction, amount, method, note,
             date_bs_year, date_bs_month, date_bs_day
        FROM transactions
       WHERE party_type = 'supplier' AND deleted_at IS NULL
       ORDER BY date_ad DESC, id DESC
    `)).rows;

    const custBills = (await query(`
      SELECT customer_id, invoice, product AS item, total,
             date_bs_year, date_bs_month, date_bs_day
        FROM sales WHERE deleted_at IS NULL
       ORDER BY date_ad DESC, id DESC
    `)).rows;

    const supBills = (await query(`
      SELECT supplier_id, invoice, material AS item, total,
             date_bs_year, date_bs_month, date_bs_day
        FROM purchases WHERE deleted_at IS NULL
       ORDER BY date_ad DESC, id DESC
    `)).rows;

    const pad = (n) => String(n).padStart(2, "0");
    const bsStr = (r) => `${r.date_bs_year}/${pad(r.date_bs_month)}/${pad(r.date_bs_day)}`;

    const buildRow = (row, isSupplier) => {
      const myPayments = (isSupplier ? supPayments : custPayments).filter(
        (p) => p.party_key === row.name || p.party_key === String(row.id)
      );
      const sign = isSupplier ? "out" : "in";
      const paid = myPayments.reduce(
        (sum, p) => sum + (p.direction === sign ? Number(p.amount) : -Number(p.amount)),
        0
      );
      const myBills = (isSupplier ? supBills : custBills).filter(
        (b) => (isSupplier ? b.supplier_id : b.customer_id) === row.id
      );
      return {
        id: row.id,
        key: row.name,
        name: row.name,
        type: row.type || "main",
        billed: Number(row.billed) || 0,
        paid,
        due: (Number(row.billed) || 0) - paid,
        open_orders: myBills.length,
        bills: myBills.map((b) => ({
          date_bs: bsStr(b),
          invoice: b.invoice,
          item: b.item,
          amount: Number(b.total),
        })),
        payments: myPayments.map((p) => ({
          date_bs: bsStr(p),
          method: p.method,
          note: p.note,
          amount: Number(p.amount),
        })),
      };
    };

    res.json({
      customers: customers.map((r) => buildRow(r, false)),
      suppliers: suppliers.map((r) => buildRow(r, true)),
    });
  } catch (e) { next(e); }
});

/* --------------------------------------------------------------------------
   SINGLE RECORD
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   CREATE
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   UPDATE
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   DELETE (soft)
   -------------------------------------------------------------------------- */
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