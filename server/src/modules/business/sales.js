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

  // Truck & transport (optional — a linked delivery is auto-created if set)
  transport_fee:       z.number().min(0).optional(),
  labor_charge:        z.number().min(0).optional(),
  road_expense:        z.number().min(0).optional(),
  tax_gbse:            z.number().min(0).optional(),
  truck_no:            z.string().max(60).optional(),
  truck_driver:        z.string().max(120).optional(),
  truck_driver_phone:  z.string().max(40).optional(),
  from_location:       z.string().max(200).optional(),
  to_location:         z.string().max(200).optional(),

  // Payment (optional) — logged as a transaction when amount_received > 0
  amount_received:     z.number().min(0).optional(),
  payment_method:      z.enum(["Cash", "Online"]).optional(),
  cash_source:         z.string().max(120).optional(),
  received_by:         z.string().max(120).optional(),
  signature:           z.string().max(120).optional(),

  status:              z.enum(["Delivered", "Pending"]).optional(),
  company:             z.string().max(120).optional(),
});

/**
 * List — every sale, with received + due rolled up from the transactions
 * ledger so the client can show Received / Balance columns.
 */
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

    // Resolve the customer's display name so the ledger shows the real name.
    const customerRow = await query(
      `SELECT name FROM customers WHERE id = $1 AND deleted_at IS NULL`,
      [input.customer_id]
    );
    const customerName =
      customerRow.rows[0]?.name || String(input.customer_id);

    // Pull out the payment-only fields — they don't go on the sales row.
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

    // Auto-create the linked transportation row if transport data was sent.
    let transport = null;
    try {
      transport = await createLinkedTransport({ kind: "sale", source: created });
    } catch (err) {
      console.error("transport link failed for sale", created.id, err.message);
    }

    // If the customer paid something at create time, log it as a transaction.
    let payment = null;
    if (amount_received !== undefined && amount_received !== null && Number(amount_received) >= 0) {
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
          customerName,
          customerName,
          "in", amount_received, paidMethod,
          "sale", created.id,
          created.date_bs_year, created.date_bs_month, created.date_bs_day, created.date_ad,
          created.company || null,
          "Received with sale",
          req.user.id,
        ]
      );
      payment = rows[0];
    }

    await audit(req, "sale.create", "sale", created.id, {
      invoice: created.invoice,
      linkedTransport: transport?.id || null,
      linkedPayment:   payment?.id   || null,
    });

    res.status(201).json({ item: created, transport, payment });
  } catch (e) { next(e); }
});

router.patch("/:id", requirePermission("sales", "update"), async (req, res, next) => {
  try {
    const input = schema.partial().parse(req.body);
    // Don't try to update payment-only fields on the sales row.
    delete input.amount_received;
    delete input.payment_method;

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

    // Cascade soft-delete to linked transport + sale payments.
    await query(
      `UPDATE transportation SET deleted_at = now()
        WHERE sale_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    await query(
      `UPDATE transactions SET deleted_at = now()
        WHERE ref_type = 'sale' AND ref_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );

    await audit(req, "sale.delete", "sale", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;