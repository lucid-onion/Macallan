import { Router } from "express";
import { z } from "zod";
import { query } from "../../config/db.js";
import { requireAuth, requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";
import { conflict, notFound } from "../../utils/errors.js";

const router = Router();
router.use(requireAuth);

router.get("/", requirePermission("teams", "view"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.id, t.name, t.description, t.parent_team_id, t.is_active,
              COALESCE(json_agg(json_build_object('module', p.module, 'action', p.action))
                       FILTER (WHERE p.id IS NOT NULL), '[]') AS permissions,
              (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id AND u.is_active) AS member_count
         FROM teams t
         LEFT JOIN team_permissions tp ON tp.team_id = t.id
         LEFT JOIN permissions p ON p.id = tp.permission_id
        GROUP BY t.id
        ORDER BY t.name`
    );
    res.json({ teams: rows });
  } catch (e) { next(e); }
});

const upsertSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  parentTeamId: z.number().int().positive().nullable().optional(),
  permissions: z.array(z.object({
    module: z.string().min(1),
    action: z.string().min(1),
  })).optional(),
});

router.post("/", requirePermission("teams", "create"), async (req, res, next) => {
  try {
    const input = upsertSchema.parse(req.body);
    const dup = await query(`SELECT 1 FROM teams WHERE name = $1`, [input.name]);
    if (dup.rowCount) throw conflict("Team name already exists");

    const inserted = await query(
      `INSERT INTO teams (name, description, parent_team_id) VALUES ($1,$2,$3) RETURNING id`,
      [input.name, input.description || null, input.parentTeamId || null]
    );
    const teamId = inserted.rows[0].id;
    if (input.permissions?.length) await replacePermissions(teamId, input.permissions);
    await audit(req, "team.create", "team", teamId, input);
    res.status(201).json({ id: teamId });
  } catch (e) { next(e); }
});

router.patch("/:id", requirePermission("teams", "update"), async (req, res, next) => {
  try {
    const input = upsertSchema.partial().parse(req.body);
    const exists = await query(`SELECT 1 FROM teams WHERE id = $1`, [req.params.id]);
    if (!exists.rowCount) throw notFound("Team not found");

    const sets = []; const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (input.name !== undefined) add("name", input.name);
    if (input.description !== undefined) add("description", input.description);
    if (input.parentTeamId !== undefined) add("parent_team_id", input.parentTeamId);
    sets.push(`updated_at = now()`);
    params.push(req.params.id);
    if (sets.length > 1) await query(`UPDATE teams SET ${sets.join(", ")} WHERE id = $${params.length}`, params);

    if (input.permissions) await replacePermissions(req.params.id, input.permissions);
    await audit(req, "team.update", "team", req.params.id, input);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:id", requirePermission("teams", "delete"), async (req, res, next) => {
  try {
    const hasMembers = await query(`SELECT 1 FROM users WHERE team_id = $1 AND is_active LIMIT 1`, [req.params.id]);
    if (hasMembers.rowCount) return res.status(409).json({ error: "Team has active members" });
    await query(`UPDATE teams SET is_active = FALSE WHERE id = $1`, [req.params.id]);
    await audit(req, "team.deactivate", "team", req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

async function replacePermissions(teamId, permissions) {
  await query(`DELETE FROM team_permissions WHERE team_id = $1`, [teamId]);
  for (const p of permissions) {
    await query(
      `INSERT INTO team_permissions (team_id, permission_id)
       SELECT $1, id FROM permissions WHERE module = $2 AND action = $3
       ON CONFLICT DO NOTHING`,
      [teamId, p.module, p.action]
    );
  }
}

export default router;