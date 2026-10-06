/* ==========================================================================
   notes.js — shared team reminders.

   Access rules:
     - view:   any authenticated user (from the notes:view permission)
     - create: notes:create (ADMIN, SUPER_ADMIN)
     - delete: notes:delete (ADMIN, SUPER_ADMIN)
     - toggle: notes:update (ADMIN, SUPER_ADMIN)
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

const schema = z.object({
  body:          z.string().min(1).max(2000),
  author_name:   z.string().min(1).max(120),
  date_bs_year:  z.number().int().min(2000).max(2200),
  date_bs_month: z.number().int().min(1).max(12),
  date_bs_day:   z.number().int().min(1).max(32),
  date_ad:       z.string(),   // "YYYY-MM-DD"
});

/* -------------------------------------------------------------------------- */
/* LIST                                                                       */
/* -------------------------------------------------------------------------- */
router.get("/", requirePermission("notes", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT *
        FROM notes
       WHERE deleted_at IS NULL
       ORDER BY is_done ASC, date_ad DESC, id DESC
    `);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* CREATE                                                                     */
/* -------------------------------------------------------------------------- */
router.post("/", requirePermission("notes", "create"), async (req, res, next) => {
  try {
    const input = schema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO notes
         (body, author_name,
          date_bs_year, date_bs_month, date_bs_day, date_ad,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.body.trim(),
        input.author_name.trim(),
        input.date_bs_year,
        input.date_bs_month,
        input.date_bs_day,
        input.date_ad,
        req.user.id,
      ]
    );
    await audit(req, "note.create", "note", rows[0].id, { author: input.author_name });
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* TOGGLE DONE / PENDING                                                      */
/* -------------------------------------------------------------------------- */
router.patch("/:id/toggle", requirePermission("notes", "update"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE notes
          SET is_done = NOT is_done,
              done_at = CASE WHEN is_done THEN NULL ELSE now() END,
              updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) throw notFound();
    await audit(req, "note.toggle", "note", rows[0].id, { is_done: rows[0].is_done });
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

/* -------------------------------------------------------------------------- */
/* DELETE (soft)                                                              */
/* -------------------------------------------------------------------------- */
router.delete("/:id", requirePermission("notes", "delete"), async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE notes SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rowCount) throw notFound();
    await audit(req, "note.delete", "note", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;