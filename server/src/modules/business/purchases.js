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
  supplier_id:         z.number().int().positive(),
  material:            z.string().min(1).max(120),

  date_bs_year:        z.number().int().min(2000).max(2200),
  date_bs_month:       z.number().int().min(1).max(12),
  date_bs_day:         z.number().int().min(1).max(32),
  date_ad:             z.string(),

  gross_qty:           z.number().min(0),
  dust_qty:            z.number().min(0).optional(),
  net_qty:             z.number().min(0),
  rate:                z.number().min(0),
  total:               z.number().min(0),

  // Truck & transport
  truck_weight_kg:     z.number().min(0).nullable().optional(),
  truck_no:            z.string().max(60).optional(),
  truck_driver:        z.string().max(120).optional(),
  truck_driver_phone:  z.string().max(40).optional(),
  contact_person:      z.string().max(120).optional(),
  contact_phone:       z.string().max(40).optional(),
  from_location:       z.string().max(200).optional(),
  to_location:         z.string().max(200).optional(),
  loader_name:         z.string().max(120).optional(),

  transport_fee:       z.number().min(0).optional(),
  labor_charge:        z.number().min(0).optional(),
  road_expense:        z.number().min(0).optional(),
  tax_gbse:            z.number().min(0).optional(),

  // Payment (optional) — logged as a transaction when amount_paid > 0
  amount_paid:         z.number().min(0).optional(),
  payment_method:      z.enum(["Cash", "Online"]).optional(),
  cash_source:         z.string().max(120).optional(),
  paid_by:             z.string().max(120).optional(),
  signature:           z.string().max(120).optional(),

  status:              z.enum(["Delivered", "Pending"]).optional(),
  company:             z.string().max(120).optional(),
});

router.get("/", requirePermission("purchases", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT p.*,
             COALESCE((
               SELECT SUM(CASE WHEN t.direction='out' THEN t.amount ELSE -t.amount END)
                 FROM transactions t
                WHERE t.ref_type = 'purchase'
                  AND t.ref_id   = p.id
                  AND t.deleted_at IS NULL
             ), 0) AS paid_amount
        FROM purchases p
       WHERE p.deleted_at IS NULL
       ORDER BY p.date_ad DESC, p.id DESC
    `);

    const items = rows.map((r) => ({
      ...r,
      paid_amount: Number(r.paid_amount) || 0,
      due_amount: Math.max(0, Number(r.total) - (Number(r.paid_amount) || 0)),
    }));

    res.json({ items });
  } catch (e) { next(e); }
});

router.get("/:id", requirePermission("purchases", "view"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM purchases WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) throw notFound();
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.post("/", requirePermission("purchases", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);

    const dup = await query(
      `SELECT 1 FROM purchases WHERE invoice = $1 AND deleted_at IS NULL`,
      [input.invoice]
    );
    if (dup.rowCount) throw conflict("A purchase with that invoice already exists");

    // Resolve the supplier's display name so the linked transaction and any
    // downstream UI show "Himal Steel Industries" instead of the numeric id.
    const supplierRow = await query(
      `SELECT name FROM suppliers WHERE id = $1 AND deleted_at IS NULL`,
      [input.supplier_id]
    );
    const supplierName =
      supplierRow.rows[0]?.name || String(input.supplier_id);

    // Pull out the payment-only fields — they don't go on the purchases row.
    const {
      amount_paid, payment_method, cash_source, paid_by, signature,
      ...purchaseFields
    } = input;

    const created = await withTx(async (client) => {
      const cols = Object.keys(purchaseFields);
      const vals = Object.values(purchaseFields);
      cols.push("created_by");
      vals.push(req.user.id);

      // Add the payment slip meta that IS on the purchases row.
      if (cash_source) { cols.push("cash_source"); vals.push(cash_source); }
      if (paid_by)     { cols.push("paid_by");     vals.push(paid_by); }
      if (signature)   { cols.push("signature");   vals.push(signature); }

      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const { rows } = await client.query(
        `INSERT INTO purchases (${cols.join(",")}) VALUES (${placeholders.join(",")}) RETURNING *`,
        vals
      );
      return rows[0];
    });

    // Auto-create the linked transportation row (existing behavior).
    let transport = null;
    try {
      transport = await createLinkedTransport({ kind: "purchase", source: created });
    } catch (err) {
      console.error("transport link failed for purchase", created.id, err.message);
    }

    // If a payment was entered, log it as a transaction tied to this purchase.
    let payment = null;
    if (amount_paid && amount_paid > 0) {
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
          "purchase_payment", "supplier",
          String(created.supplier_id),
          supplierName,
          "out", amount_paid, paidMethod,
          "purchase", created.id,
          created.date_bs_year, created.date_bs_month, created.date_bs_day, created.date_ad,
          created.company || null,
          "Paid with purchase",
          req.user.id,
        ]
      );
      payment = rows[0];
    }

    await audit(req, "purchase.create", "purchase", created.id, {
      invoice: created.invoice,
      linkedTransport: transport?.id || null,
      linkedPayment: payment?.id || null,
    });

    res.status(201).json({ item: created, transport, payment });
  } catch (e) { next(e); }
});

router.patch("/:id", requirePermission("purchases", "update"), async (req, res, next) => {
  try {
    const input = schema.partial().parse(req.body);
    // Don't try to update payment-only fields on the purchases row.
    delete input.amount_paid;
    delete input.payment_method;

    const entries = Object.entries(input);
    if (!entries.length) return res.json({ ok: true });

    const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
    const vals = entries.map(([, v]) => v);
    sets.push("updated_at = now()");
    vals.push(req.params.id);
    const { rowCount } = await query(
      `UPDATE purchases SET ${sets.join(", ")} WHERE id = $${vals.length} AND deleted_at IS NULL`,
      vals
    );
    if (!rowCount) throw notFound();
    await audit(req, "purchase.update", "purchase", req.params.id, input);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:id", requirePermission("purchases", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE purchases SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();

    // Cascade the soft-delete to the linked transport + purchase payment.
    await query(
      `UPDATE transportation SET deleted_at = now()
        WHERE purchase_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    await query(
      `UPDATE transactions SET deleted_at = now()
        WHERE ref_type = 'purchase' AND ref_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );

    await audit(req, "purchase.delete", "purchase", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;