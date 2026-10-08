/* ==========================================================================
   sales.js — sales register.

   Money model:
     Total          = quantity × rate
     Report Amount  = a user-entered deduction (stored in report_amount)
     Final Total    = Total − Report Amount    →  stored in sales.total

   Payments received:
     Advance Received Now  → one transaction on create
     Additional installments → one transaction each via POST /:id/payments
     All payment rows live in the transactions ledger with
       ref_type = 'sale', ref_id = <sale.id>, direction = 'in'.

   Installment numbering:
     The advance is installment #1. Each additional payment auto-labels as
     "Second installment", "Third installment", … unless the caller supplies
     an explicit note.
   ========================================================================== */
import { z } from "zod";
import { Router } from "express";
import { query, withTx } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";
import { notFound, conflict } from "../../utils/errors.js";

const router = Router();
router.use(requireAuth);

/* -------------------------------------------------------------------------- */
/* Ordinals                                                                   */
/* -------------------------------------------------------------------------- */
const ORDINALS = [
  "", "First", "Second", "Third", "Fourth", "Fifth", "Sixth",
  "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth",
];
const ordinal = (n) => ORDINALS[n] || `#${n}`;
const installmentLabel = (n) => `${ordinal(n)} installment`;

/* -------------------------------------------------------------------------- */
/* Schema                                                                     */
/* -------------------------------------------------------------------------- */
const schema = z.object({
  invoice:             z.string().min(1).max(60),
  customer_id:         z.number().int().positive(),
  product:             z.string().min(1).max(120),

  date_bs_year:        z.number().int().min(2000).max(2200),
  date_bs_month:       z.number().int().min(1).max(12),
  date_bs_day:         z.number().int().min(1).max(32),
  date_ad:             z.string(),

  gross_qty:           z.number().min(0),                 // quantity (kg)
  dust_qty:            z.number().min(0).optional(),      // kept for print/labels
  net_qty:             z.number().min(0).optional(),      // ignored — recomputed
  rate:                z.number().min(0),
  total:               z.number().min(0).optional(),      // ignored — recomputed
  report_amount:       z.number().min(0).optional(),      // manual deduction

  // Payment at create time (optional)
  amount_received:     z.number().min(0).optional(),      // the advance
  payment_method:      z.enum(["Cash", "Online"]).optional(),
  cash_source:         z.string().max(120).optional(),
  received_by:         z.string().max(120).optional(),
  signature:           z.string().max(120).optional(),

  status:              z.enum(["Delivered", "Pending"]).optional(),
  company:             z.string().max(120).optional(),
});

const paymentSchema = z.object({
  amount:        z.number().positive(),
  method:        z.enum(["Cash","Online"]).optional(),
  note:          z.string().max(200).optional(),
  date_bs_year:  z.number().int().min(2000).max(2200),
  date_bs_month: z.number().int().min(1).max(12),
  date_bs_day:   z.number().int().min(1).max(32),
  date_ad:       z.string(),
});

/* -------------------------------------------------------------------------- */
/* Shared computation                                                         */
/* -------------------------------------------------------------------------- */
function recompute(input) {
  const qty    = Number(input.gross_qty) || 0;
  const rate   = Number(input.rate)      || 0;
  const report = Number(input.report_amount) || 0;
  const total  = qty * rate;
  const round2 = (n) => Math.round(n * 100) / 100;
  input.gross_qty     = round2(qty);
  input.net_qty       = round2(qty);         // net = qty (kept for schema)
  input.report_amount = round2(report);
  input.total         = round2(Math.max(0, total - report));
}

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */
router.get("/", requirePermission("sales", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT s.*,
             COALESCE((
               SELECT SUM(CASE WHEN t.direction='in' THEN t.amount ELSE -t.amount END)
                 FROM transactions t
                WHERE t.ref_type = 'sale'
                  AND t.ref_id   = s.id
                  AND t.deleted_at IS NULL
             ), 0) AS received_amount
        FROM sales s
       WHERE s.deleted_at IS NULL
       ORDER BY s.date_ad DESC, s.id DESC
    `);

    const items = rows.map((r) => ({
      ...r,
      received_amount: Number(r.received_amount) || 0,
      due_amount: Math.max(0, Number(r.total) - (Number(r.received_amount) || 0)),
    }));

    res.json({ items });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Get one                                                                    */
/* -------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */
router.post("/", requirePermission("sales", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);
    recompute(input);

    const dup = await query(
      `SELECT 1 FROM sales WHERE invoice = $1 AND deleted_at IS NULL`,
      [input.invoice]
    );
    if (dup.rowCount) throw conflict("A sale with that invoice already exists");

    const customerRow = await query(
      `SELECT name FROM customers WHERE id = $1 AND deleted_at IS NULL`,
      [input.customer_id]
    );
    const customerName = customerRow.rows[0]?.name || String(input.customer_id);

    const {
      amount_received, payment_method, cash_source, received_by, signature,
      ...saleFields
    } = input;

    const created = await withTx(async (client) => {
      const cols = Object.keys(saleFields);
      const vals = Object.values(saleFields);
      cols.push("created_by");
      vals.push(req.user.id);

      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const { rows } = await client.query(
        `INSERT INTO sales (${cols.join(",")}) VALUES (${placeholders.join(",")}) RETURNING *`,
        vals
      );
      return rows[0];
    });

    // Advance received at create → one transaction
    let payment = null;
    if (amount_received !== undefined && amount_received !== null && Number(amount_received) > 0) {
      const paidMethod = payment_method || "Cash";
      const { rows } = await query(
        `INSERT INTO transactions
           (type, party_type, party_key, party_label, direction, amount, method,
            ref_type, ref_id,
            date_bs_year, date_bs_month, date_bs_day, date_ad,
            company, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          "sale_payment", "customer",
          customerName, customerName,
          "in", Number(amount_received), paidMethod,
          "sale", created.id,
          created.date_bs_year, created.date_bs_month, created.date_bs_day, created.date_ad,
          created.company || null,
          "First installment (Advance)",
          req.user.id,
        ]
      );
      payment = rows[0];
    }

    await audit(req, "sale.create", "sale", created.id, {
      invoice: created.invoice,
      linkedPayment: payment?.id || null,
    });

    res.status(201).json({ item: created, payment });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Update                                                                     */
/* -------------------------------------------------------------------------- */
router.patch("/:id", requirePermission("sales", "update"), async (req, res, next) => {
  try {
    const input = schema.partial().parse(req.body);
    delete input.amount_received;
    delete input.payment_method;
    delete input.net_qty;
    delete input.total;

    if (
      input.gross_qty     !== undefined ||
      input.rate          !== undefined ||
      input.report_amount !== undefined
    ) {
      const cur = await query(
        `SELECT gross_qty, rate, report_amount FROM sales WHERE id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (!cur.rowCount) throw notFound();

      const qty    = Number(input.gross_qty     ?? cur.rows[0].gross_qty)     || 0;
      const rate   = Number(input.rate          ?? cur.rows[0].rate)          || 0;
      const report = Number(input.report_amount ?? cur.rows[0].report_amount) || 0;
      const round2 = (n) => Math.round(n * 100) / 100;

      input.gross_qty     = round2(qty);
      input.net_qty       = round2(qty);
      input.report_amount = round2(report);
      input.total         = round2(Math.max(0, qty * rate - report));
    }

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

/* -------------------------------------------------------------------------- */
/* Delete (soft) — cascades to payments                                       */
/* -------------------------------------------------------------------------- */
router.delete("/:id", requirePermission("sales", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE sales SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();

    await query(
      `UPDATE transactions SET deleted_at = now()
        WHERE ref_type = 'sale' AND ref_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );

    await audit(req, "sale.delete", "sale", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Log a payment (installment) received from the customer                     */
/* -------------------------------------------------------------------------- */
router.post("/:id/payments", requirePermission("sales", "update"), async (req, res, next) => {
  try {
    const input = paymentSchema.parse(req.body);

    const saleRow = await query(
      `SELECT s.*, c.name AS customer_name
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!saleRow.rowCount) throw notFound();
    const sale = saleRow.rows[0];
    const customerName = sale.customer_name || String(sale.customer_id);

    const countRes = await query(
      `SELECT COUNT(*)::int AS n FROM transactions
        WHERE ref_type = 'sale' AND ref_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    const installmentNumber = (countRes.rows[0]?.n ?? 0) + 1;
    const note = (input.note && input.note.trim()) || installmentLabel(installmentNumber);

    const { rows } = await query(
      `INSERT INTO transactions
         (type, party_type, party_key, party_label, direction, amount, method,
          ref_type, ref_id,
          date_bs_year, date_bs_month, date_bs_day, date_ad,
          company, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        "sale_payment", "customer",
        customerName, customerName,
        "in", input.amount, input.method || "Cash",
        "sale", req.params.id,
        input.date_bs_year, input.date_bs_month, input.date_bs_day, input.date_ad,
        sale.company || null,
        note,
        req.user.id,
      ]
    );

    await audit(req, "sale.payment_create", "sale", req.params.id, {
      amount: input.amount,
      method: input.method || "Cash",
      installment: installmentNumber,
    });
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* List payments for one sale                                                 */
/* -------------------------------------------------------------------------- */
router.get("/:id/payments", requirePermission("sales", "view"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, amount, method, note,
              date_bs_year, date_bs_month, date_bs_day, date_ad,
              created_at
         FROM transactions
        WHERE ref_type = 'sale' AND ref_id = $1 AND deleted_at IS NULL
        ORDER BY date_ad ASC, id ASC`,
      [req.params.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Soft-delete a payment                                                      */
/* -------------------------------------------------------------------------- */
router.delete("/:id/payments/:pid", requirePermission("sales", "update"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE transactions SET deleted_at = now()
        WHERE id = $1 AND ref_type = 'sale' AND ref_id = $2 AND deleted_at IS NULL`,
      [req.params.pid, req.params.id]
    );
    if (!rowCount) throw notFound();
    await audit(req, "sale.payment_delete", "sale", req.params.id, { payment_id: req.params.pid });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;