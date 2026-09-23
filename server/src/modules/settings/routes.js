import { Router } from "express";
import { z } from "zod";
import { query } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";

const router = Router();
router.use(requireAuth);

router.get("/", requirePermission("settings", "view"), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT key, value FROM settings`);
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ settings });
  } catch (e) { next(e); }
});

const patchSchema = z.object({
  company: z.object({
    name: z.string().min(1).max(120).optional(),
    logo: z.string().optional(),
    openingBalance: z.number().optional(),
    theme: z.enum(["light","dark"]).optional(),
  }).optional(),
});

router.patch("/", requirePermission("settings", "manage"), async (req, res, next) => {
  try {
    const patch = patchSchema.parse(req.body);
    const current = await query(`SELECT value FROM settings WHERE key = 'company'`);
    const merged = { ...(current.rows[0]?.value || {}), ...(patch.company || {}) };
    await query(
      `INSERT INTO settings (key, value) VALUES ('company', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [merged]
    );
    await audit(req, "settings.update", "settings", "company", patch);
    res.json({ settings: { company: merged } });
  } catch (e) { next(e); }
});

export default router;