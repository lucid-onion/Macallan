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

/* --------------------------------------------------------------------------
   Rounding helpers — used both for validation and for the multi-line batch.
   -------------------------------------------------------------------------- */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/* --------------------------------------------------------------------------
   Schema for a single purchase row.
   `net_qty` and `total` are still accepted from the client (so the shape
   doesn't change) but they are ALWAYS overwritten server-side from
   gross_qty / dust_qty / rate. The client's values are ignored.
   -------------------------------------------------------------------------- */
const lineSchema = z.object({
  invoice:             z.string().min(1).max(60),
  supplier_id:         z.number().int().positive(),
  material:            z.string().min(1).max(120),

  date_bs_year:        z.number().int().min(2000).max(2200),
  date_bs_month:       z.number().int().min(1).max(12),
  date_bs_day:         z.number().int().min(1).max(32),
  date_ad:             z.string(),

  gross_qty:           z.number().min(0),
  dust_qty:            z.number().min(0).optional(),
  net_qty:             z.number().min(0).optional(),   // ignored — recomputed
  rate:                z.number().min(0),
  total:               z.number().min(0).optional(),   // ignored — recomputed

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

const batchSchema = z.object({
  lines: z.array(lineSchema).min(1).max(50),
});

/* --------------------------------------------------------------------------
   Recompute net_qty and total from the raw inputs.
   Called on every create and on every update that touches the numbers.
   -------------------------------------------------------------------------- */
function recompute(input) {
  const gross = Number(input.gross_qty) || 0;
  const dust  = Number(input.dust_qty)  || 0;
  const rate  = Number(input.rate)      || 0;
  const net   = Math.max(0, gross - dust);
  input.net_qty = round3(net);
  input.total   = round2(input.net_qty * rate);
}

/* --------------------------------------------------------------------------
   Shared INSERT logic — used by both the single-row POST and the batch POST.
   Runs inside a transaction provided by the caller.
   -------------------------------------------------------------------------- */
async function insertPurchase(client, input, userId) {
  // Pull out payment-only fields.
  const {
    amount_paid, payment_method, cash_source, paid_by, signature,
    ...purchaseFields
  } = input;

  const cols = Object.keys(purchaseFields);
  const vals = Object.values(purchaseFields);
  cols.push("created_by");
  vals.push(userId);

  // Payment slip meta that lives on the purchases row.
  if (cash_source) { cols.push("cash_source"); vals.push(cash_source); }
  if (paid_by)     { cols.push("paid_by");     vals.push(paid_by); }
  if (signature)   { cols.push("signature");   vals.push(signature); }

  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await client.query(
    `INSERT INTO purchases (${cols.join(",")}) VALUES (${placeholders.join(",")}) RETURNING *`,
    vals
  );
  return { row: rows[0], amount_paid, payment_method };
}

/* ==========================================================================
   LIST — every purchase with paid / due rolled up from the ledger.
   ========================================================================== */
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

/* ==========================================================================
   GET ONE
   ========================================================================== */
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

/* ==========================================================================
   BATCH CREATE — one truck trip with N lines, all-or-nothing.
   Must be declared BEFORE /:id-style routes to avoid the string "batch"
   being captured as an :id param on the single-row route.
   ========================================================================== */
router.post("/batch", requirePermission("purchases", "create"), async (req, res, next) => {
  try {
    const { lines } = batchSchema.parse(req.body);

    // Recompute every line's derived numbers.
    lines.forEach(recompute);

    // Pre-validate: every invoice must be unique in the DB AND within the batch.
    const invoices = lines.map((l) => l.invoice);
    const seen = new Set();
    for (const inv of invoices) {
      if (seen.has(inv)) throw conflict(`Duplicate invoice in batch: ${inv}`);
      seen.add(inv);
    }
    const dup = await query(
      `SELECT invoice FROM purchases WHERE invoice = ANY($1) AND deleted_at IS NULL`,
      [invoices]
    );
    if (dup.rowCount) {
      throw conflict(`Invoice(s) already exist: ${dup.rows.map((r) => r.invoice).join(", ")}`);
    }

    // Resolve supplier names in one shot for the payment ledger.
    const supplierIds = [...new Set(lines.map((l) => l.supplier_id))];
    const supRows = await query(
      `SELECT id, name FROM suppliers WHERE id = ANY($1) AND deleted_at IS NULL`,
      [supplierIds]
    );
    const supplierNameById = new Map(supRows.rows.map((r) => [r.id, r.name]));

    // Everything happens in one transaction: all N rows + all their linked
    // transports + all their linked payments. If anything throws, nothing
    // is committed.
    const created = await withTx(async (client) => {
      const createdRows = [];

      for (const line of lines) {
        const { row, amount_paid, payment_method } = await insertPurchase(
          client,
          line,
          req.user.id
        );
        createdRows.push({ row, amount_paid, payment_method });
      }

      // Link transports + payments inside the same tx so the whole batch is
      // atomic. We pass the tx client down through createLinkedTransport via
      // a small inline copy so we don't have to change its signature.
      for (const { row, amount_paid, payment_method } of createdRows) {
        // Transportation link (mirrors createLinkedTransport but with client)
        const transport = await insertLinkedTransportTx(client, row);

        // Payment transaction
        if (amount_paid !== undefined && amount_paid !== null && Number(amount_paid) >= 0) {
          const supplierName =
            supplierNameById.get(row.supplier_id) || String(row.supplier_id);
          const paidMethod = payment_method || "Cash";
          await client.query(
            `INSERT INTO transactions
               (type, party_type, party_key, party_label, direction, amount, method,
                ref_type, ref_id,
                date_bs_year, date_bs_month, date_bs_day, date_ad,
                company, note, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
              "purchase_payment", "supplier",
              supplierName, supplierName,
              "out", Number(amount_paid), paidMethod,
              "purchase", row.id,
              row.date_bs_year, row.date_bs_month, row.date_bs_day, row.date_ad,
              row.company || null,
              "Paid with purchase",
              req.user.id,
            ]
          );
        }
      }

      return createdRows.map((r) => r.row);
    });

    await audit(req, "purchase.create_batch", "purchase_batch", null, {
      count: created.length,
      invoices: created.map((r) => r.invoice),
    });

    res.status(201).json({ items: created });
  } catch (e) { next(e); }
});

/* ==========================================================================
   SINGLE CREATE — kept for the "New Purchase" path and any other caller.
   ========================================================================== */
router.post("/", requirePermission("purchases", "create"), async (req, res, next) => {
  try {
    const input = lineSchema.parse(req.body);
    recompute(input);

    const dup = await query(
      `SELECT 1 FROM purchases WHERE invoice = $1 AND deleted_at IS NULL`,
      [input.invoice]
    );
    if (dup.rowCount) throw conflict("A purchase with that invoice already exists");

    const supplierRow = await query(
      `SELECT name FROM suppliers WHERE id = $1 AND deleted_at IS NULL`,
      [input.supplier_id]
    );
    const supplierName = supplierRow.rows[0]?.name || String(input.supplier_id);

    const { amount_paid, payment_method } = input;

    const created = await withTx(async (client) => {
      const { row } = await insertPurchase(client, input, req.user.id);
      return row;
    });

    // Auto-create the linked transportation row (outside the tx — matches
    // the existing single-row behaviour; if it fails we log and continue).
    let transport = null;
    try {
      transport = await createLinkedTransport({ kind: "purchase", source: created });
    } catch (err) {
      console.error("transport link failed for purchase", created.id, err.message);
    }

    let payment = null;
    if (amount_paid !== undefined && amount_paid !== null && Number(amount_paid) >= 0) {
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
          supplierName, supplierName,
          "out", Number(amount_paid), paidMethod,
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

/* ==========================================================================
   PATCH — partial update. Recomputes totals if any input that affects them
   changes.
   ========================================================================== */
router.patch("/:id", requirePermission("purchases", "update"), async (req, res, next) => {
  try {
    const input = lineSchema.partial().parse(req.body);
    delete input.amount_paid;
    delete input.payment_method;
    delete input.net_qty;   // never accept these from the client
    delete input.total;

    // If the caller touched gross/dust/rate, recompute against the merged view.
    if (
      input.gross_qty !== undefined ||
      input.dust_qty  !== undefined ||
      input.rate      !== undefined
    ) {
      const cur = await query(
        `SELECT gross_qty, dust_qty, rate
           FROM purchases WHERE id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (!cur.rowCount) throw notFound();

      const gross = Number(input.gross_qty ?? cur.rows[0].gross_qty) || 0;
      const dust  = Number(input.dust_qty  ?? cur.rows[0].dust_qty)  || 0;
      const rate  = Number(input.rate      ?? cur.rows[0].rate)      || 0;

      input.net_qty = round3(Math.max(0, gross - dust));
      input.total   = round2(input.net_qty * rate);
    }

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

/* ==========================================================================
   DELETE — soft delete the purchase + linked transport + linked payments.
   ========================================================================== */
router.delete("/:id", requirePermission("purchases", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE purchases SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();

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

/* ==========================================================================
   Local helper — same as createLinkedTransport but takes a tx client so the
   batch insert can keep everything atomic.
   ========================================================================== */
async function insertLinkedTransportTx(client, source) {
  const {
    id,
    date_bs_year, date_bs_month, date_bs_day, date_ad,
    transport_fee, labor_charge, road_expense, tax_gbse,
    truck_no, truck_driver, truck_driver_phone,
    from_location, to_location,
    loader_name,
    customer_id,
    net_qty,
    status,
  } = source;

  const fee   = Number(transport_fee) || 0;
  const labor = Number(labor_charge)  || 0;
  const road  = Number(road_expense)  || 0;
  const tax   = Number(tax_gbse)      || 0;
  const totalCost = fee + labor + road + tax;

  const hasData =
    totalCost > 0 ||
    truck_no || truck_driver || truck_driver_phone ||
    from_location || to_location || loader_name;
  if (!hasData) return null;

  const { rows } = await client.query(
    `INSERT INTO transportation
       (sale_id, purchase_id, customer_id,
        vehicle, driver, driver_phone, loader,
        from_location, to_location, load_kg,
        fee, labor_charge, road_expense, tax_gbse,
        date_bs_year, date_bs_month, date_bs_day, date_ad,
        status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      null, id, customer_id || null,
      truck_no || null,
      truck_driver || null,
      truck_driver_phone || null,
      loader_name || null,
      from_location || null,
      to_location || null,
      Number(net_qty) || 0,
      fee, labor, road, tax,
      date_bs_year, date_bs_month, date_bs_day, date_ad,
      status === "Pending" ? "In Transit" : "Delivered",
    ]
  );
  return rows[0];
}

export default router;