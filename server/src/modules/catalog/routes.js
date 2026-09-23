import { Router } from "express";
import { query } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireAny } from "../../middleware/rbac.js";

const router = Router();
router.use(requireAuth);

router.get("/permissions", requireAny(["users:view", "teams:view", "settings:view"]), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT id, module, action FROM permissions ORDER BY module, action`);
    res.json({ permissions: rows });
  } catch (e) { next(e); }
});

router.get("/roles", requireAny(["users:view", "settings:view"]), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT id, code, name, rank FROM roles ORDER BY rank`);
    res.json({ roles: rows });
  } catch (e) { next(e); }
});

export default router;