/* ==========================================================================
   Companies — the distinct "company" text values that appear across the
   business records. Used by the Reports page's Company filter/dropdown and
   its "Export by Company" feature. There is no companies table: the field
   is just a free-text column on sales / purchases / office_expenses /
   demolitions, so we UNION the distinct values (excluding nulls/blanks).
   ========================================================================== */
import { Router } from "express";
import { query } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireAny } from "../../middleware/rbac.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  requireAny(["reports:view", "sales:view", "purchases:view"]),
  async (_req, res, next) => {
    try {
      const { rows } = await query(`
        SELECT DISTINCT company
          FROM (
            SELECT company FROM sales           WHERE deleted_at IS NULL AND company IS NOT NULL AND company <> ''
            UNION
            SELECT company FROM purchases       WHERE deleted_at IS NULL AND company IS NOT NULL AND company <> ''
            UNION
            SELECT company FROM office_expenses WHERE deleted_at IS NULL AND company IS NOT NULL AND company <> ''
            UNION
            SELECT company FROM demolitions     WHERE deleted_at IS NULL AND company IS NOT NULL AND company <> ''
            UNION
            SELECT company FROM transactions    WHERE deleted_at IS NULL AND company IS NOT NULL AND company <> ''
          ) c
        ORDER BY company
      `);
      res.json({ items: rows.map((r) => r.company) });
    } catch (e) {
      next(e);
    }
  }
);

export default router;