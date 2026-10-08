/* ==========================================================================
   transportation.js — deliveries.

   Money model:
     amount           = load_kg × rate
     balance_after_adv= max(0, amount − advance)
     trip_cost        = balance_after_adv + labor_charge + road_expense + tax_gbse
     paid_to_driver   = advance + sum(additional payments)
     balance_due      = max(0, trip_cost − additional_payments)

   Aliases kept so the current client keeps rendering:
     total_cost            = trip_cost
     total_balance_due     = balance_due
     driver_balance        = balance_due
     balance_after_advance = amount − advance

   Installment numbering:
     The advance is installment #1. Each additional payment auto-labels as
     "Second installment", "Third installment", … unless the caller supplies
     an explicit note.

   Driver advance and additional payments NEVER write into the transactions
   ledger. They live only inside transportation.
   ========================================================================== */
import { z } from "zod";
import { Router } from "express";
import { query } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";
import { notFound } from "../../utils/errors.js";

const router = Router();
router.use(requireAuth);

/* -------------------------------------------------------------------------- */
/* Ordinals — 1 = advance, 2 = Second installment, 3 = Third installment …    */
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
  link_type:     z.enum(["purchase","customer"]).nullable().optional(),
  trip_id:       z.string().uuid().nullable().optional(),
  customer_name: z.string().max(120).nullable().optional(),
  vehicle:       z.string().max(60).optional(),
  driver:        z.string().max(120).optional(),
  driver_phone:  z.string().max(40).optional(),
  loader:        z.string().max(120).optional(),
  from_location: z.string().max(200).optional(),
  to_location:   z.string().max(200).optional(),
  load_kg:       z.number().min(0).optional(),
  rate:          z.number().min(0).optional(),
  advance:       z.number().min(0).optional(),
  labor_charge:  z.number().min(0).optional(),
  road_expense:  z.number().min(0).optional(),
  tax_gbse:      z.number().min(0).optional(),
  date_bs_year:  z.number().int().min(2000).max(2200),
  date_bs_month: z.number().int().min(1).max(12),
  date_bs_day:   z.number().int().min(1).max(32),
  date_ad:       z.string(),
  status:        z.enum(["Delivered","In Transit"]).optional(),
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
function decorate(r) {
  const load  = Number(r.load_kg)      || 0;
  const rate  = Number(r.rate)         || 0;
  const adv   = Number(r.advance)      || 0;
  const labor = Number(r.labor_charge) || 0;
  const road  = Number(r.road_expense) || 0;
  const tax   = Number(r.tax_gbse)     || 0;
  const paidAdditional = Number(r.payments_total) || 0;

  const amount          = load * rate;
  const tripCost    = amount + labor + road + tax;      // true total cost
  const paidToDriver = adv + paidAdditional;            // advance + everything else
  const balanceDue   = Math.max(0, tripCost - paidToDriver);

  return {
    ...r,
    payments_total: paidAdditional,

    // New names
    amount,
    trip_cost:       tripCost,
    paid_to_driver:  paidToDriver,
    balance_due:     balanceDue,

    // Old names — kept so the current client + print keep rendering
    total_cost:            tripCost,
    total_balance_due:     balanceDue,
    driver_balance:        balanceDue,
    balance_after_advance: Math.max(0, amount - adv),
  };
}

/* -------------------------------------------------------------------------- */
/* List                                                                       */
/* -------------------------------------------------------------------------- */
router.get("/", requirePermission("transportation", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT t.*,
             COALESCE((
               SELECT SUM(p.amount) FROM transportation_payments p
                WHERE p.transportation_id = t.id AND p.deleted_at IS NULL
             ), 0) AS payments_total
        FROM transportation t
       WHERE t.deleted_at IS NULL
       ORDER BY t.date_ad DESC, t.id DESC
    `);
    res.json({ items: rows.map(decorate) });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Get one — with payments array                                              */
/* -------------------------------------------------------------------------- */
router.get("/:id", requirePermission("transportation", "view"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.*,
              COALESCE((
                SELECT SUM(p.amount) FROM transportation_payments p
                 WHERE p.transportation_id = t.id AND p.deleted_at IS NULL
              ), 0) AS payments_total
         FROM transportation t
        WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) throw notFound();

    const payments = (await query(
      `SELECT id, amount, method, note, date_bs_year, date_bs_month, date_bs_day, date_ad
         FROM transportation_payments
        WHERE transportation_id = $1 AND deleted_at IS NULL
        ORDER BY date_ad ASC, id ASC`,
      [req.params.id]
    )).rows;

    res.json({ item: { ...decorate(rows[0]), payments } });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */
router.post("/", requirePermission("transportation", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);
    const cols = Object.keys(input);
    const vals = Object.values(input);
    cols.push("created_by");
    vals.push(req.user.id);

    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const { rows } = await query(
      `INSERT INTO transportation (${cols.join(",")}) VALUES (${placeholders.join(",")}) RETURNING *`,
      vals
    );

    await audit(req, "transport.create", "transport", rows[0].id, {
      link_type: input.link_type || null,
      trip_id: input.trip_id || null,
    });
    res.status(201).json({ item: decorate(rows[0]) });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Update                                                                     */
/* -------------------------------------------------------------------------- */
router.patch("/:id", requirePermission("transportation", "update"), async (req, res, next) => {
  try {
    const input = schema.partial().parse(req.body);
    const entries = Object.entries(input);
    if (!entries.length) return res.json({ ok: true });

    const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
    const vals = entries.map(([, v]) => v);
    sets.push("updated_at = now()");
    vals.push(req.params.id);

    const { rowCount } = await query(
      `UPDATE transportation SET ${sets.join(", ")} WHERE id = $${vals.length} AND deleted_at IS NULL`,
      vals
    );
    if (!rowCount) throw notFound();
    await audit(req, "transport.update", "transport", req.params.id, input);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Delete (soft) — cascades to payments                                       */
/* -------------------------------------------------------------------------- */
router.delete("/:id", requirePermission("transportation", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE transportation SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();

    await query(
      `UPDATE transportation_payments SET deleted_at = now()
        WHERE transportation_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );

    await audit(req, "transport.delete", "transport", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Log an additional payment to the driver                                    */
/* -------------------------------------------------------------------------- */
router.post("/:id/payments", requirePermission("transportation", "update"), async (req, res, next) => {
  try {
    const input = paymentSchema.parse(req.body);

    const parent = await query(
      `SELECT id FROM transportation WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!parent.rowCount) throw notFound();

    const countRes = await query(
      `SELECT COUNT(*)::int AS n FROM transportation_payments
        WHERE transportation_id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    const installmentNumber = (countRes.rows[0]?.n ?? 0) + 2;
    const note = (input.note && input.note.trim()) || installmentLabel(installmentNumber);

    const { rows } = await query(
      `INSERT INTO transportation_payments
         (transportation_id, amount, method, note,
          date_bs_year, date_bs_month, date_bs_day, date_ad,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        req.params.id,
        input.amount,
        input.method || null,
        note,
        input.date_bs_year, input.date_bs_month, input.date_bs_day, input.date_ad,
        req.user.id,
      ]
    );

    await audit(req, "transport.payment_create", "transport", req.params.id, {
      amount: input.amount,
      method: input.method || "Cash",
      installment: installmentNumber,
    });
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* List payments for one delivery                                             */
/* -------------------------------------------------------------------------- */
router.get("/:id/payments", requirePermission("transportation", "view"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, amount, method, note,
              date_bs_year, date_bs_month, date_bs_day, date_ad,
              created_at
         FROM transportation_payments
        WHERE transportation_id = $1 AND deleted_at IS NULL
        ORDER BY date_ad ASC, id ASC`,
      [req.params.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* Soft-delete a payment                                                      */
/* -------------------------------------------------------------------------- */
router.delete("/:id/payments/:pid", requirePermission("transportation", "update"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE transportation_payments SET deleted_at = now()
        WHERE id = $1 AND transportation_id = $2 AND deleted_at IS NULL`,
      [req.params.pid, req.params.id]
    );
    if (!rowCount) throw notFound();
    await audit(req, "transport.payment_delete", "transport", req.params.id, { payment_id: req.params.pid });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;