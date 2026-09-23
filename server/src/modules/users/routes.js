import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query, withTx } from "../../config/db.js";
import { requireAuth, requirePermission, canManageUser } from "../../middleware/rbac.js";
import { revokeAllUserSessions } from "../../middleware/auth.js";
import { audit } from "../../utils/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/errors.js";

const router = Router();
router.use(requireAuth);

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

const createSchema = z.object({
  username: z.string().regex(USERNAME_RE, "3-32 chars: a-z, 0-9, . _ -"),
  fullName: z.string().min(1).max(120),
  email:    z.string().email().optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role:     z.enum(["USER", "ACCOUNTANT", "ADMIN", "SUPER_ADMIN"]),
  teamId:   z.number().int().positive().nullable().optional(),
});

/**
 * List users. SUPER_ADMIN sees all. ADMIN sees users in their own team only.
 * USER/ACCOUNTANT get 403.
 */
router.get("/", requirePermission("users", "view"), async (req, res, next) => {
  try {
    const params = [];
    let where = "WHERE u.deleted_at IS NULL";
    if (req.user.role === "ADMIN") {
      where += " AND u.team_id = $1";
      params.push(req.user.teamId);
    }
    const { rows } = await query(
      `SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.deactivated_at,
              u.last_login_at, u.created_at,
              r.code AS role, t.id AS team_id, t.name AS team_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN teams t ON t.id = u.team_id
         ${where}
        ORDER BY u.created_at DESC`,
      params
    );
    res.json({ users: rows });
  } catch (e) { next(e); }
});

router.post("/", requirePermission("users", "create"), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);

    // Hierarchy: ADMIN can create only USER / ACCOUNTANT.
    if (!canManageUser(req.user, input.role, input.teamId)) {
      throw forbidden("You cannot create that role or in that team");
    }
    // SUPER_ADMIN is only creatable by SUPER_ADMIN.
    if (input.role === "SUPER_ADMIN" && req.user.role !== "SUPER_ADMIN") {
      throw forbidden("Only a Super Admin can create Super Admins");
    }

    // Uniqueness
    const dup = await query(
      `SELECT 1 FROM users WHERE username = $1 UNION SELECT 1 FROM users WHERE email = $2`,
      [input.username, input.email || null]
    );
    if (dup.rowCount) throw conflict("Username or email already taken");

    const hash = await bcrypt.hash(input.password, 12);

    const created = await withTx(async (client) => {
      const roleRow = await client.query(`SELECT id FROM roles WHERE code = $1`, [input.role]);
      const roleId = roleRow.rows[0].id;
      const { rows } = await client.query(
        `INSERT INTO users (username, full_name, email, password_hash, role_id, team_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, username, full_name, email, is_active, created_at`,
        [input.username, input.fullName, input.email || null, hash, roleId, input.teamId || null, req.user.id]
      );
      return rows[0];
    });

    await audit(req, "user.create", "user", created.id, { role: input.role, teamId: input.teamId });
    res.status(201).json({ user: created });
  } catch (e) { next(e); }
});

const updateSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  email:    z.string().email().optional().or(z.literal("")),
  role:     z.enum(["USER", "ACCOUNTANT", "ADMIN", "SUPER_ADMIN"]).optional(),
  teamId:   z.number().int().positive().nullable().optional(),
  password: z.string().min(8).optional(),
});

router.patch("/:id", requirePermission("users", "update"), async (req, res, next) => {
  try {
    const patch = updateSchema.parse(req.body);
    const { rows } = await query(
      `SELECT u.id, u.team_id, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [req.params.id]
    );
    if (!rows.length) throw notFound("User not found");
    const target = rows[0];

    if (!canManageUser(req.user, target.role, target.team_id)) throw forbidden();
    if (patch.role && !canManageUser(req.user, patch.role, patch.teamId ?? target.team_id)) throw forbidden();
    if (target.id === req.user.id && patch.role && patch.role !== req.user.role) {
      throw badRequest("You cannot change your own role");
    }

    const sets = []; const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (patch.fullName !== undefined) add("full_name", patch.fullName);
    if (patch.email !== undefined)    add("email", patch.email || null);
    if (patch.teamId !== undefined)   add("team_id", patch.teamId);
    if (patch.role) {
      const roleRow = await query(`SELECT id FROM roles WHERE code = $1`, [patch.role]);
      add("role_id", roleRow.rows[0].id);
    }
    if (patch.password) {
      const hash = await bcrypt.hash(patch.password, 12);
      add("password_hash", hash);
    }
    if (!sets.length) return res.json({ ok: true });
    sets.push(`updated_at = now()`);
    params.push(req.params.id);

    await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    // If role, password, or team changed, revoke sessions so new permissions apply immediately.
    if (patch.role || patch.password || patch.teamId !== undefined) {
      await revokeAllUserSessions(req.params.id);
    }
    await audit(req, "user.update", "user", req.params.id, patch);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Deactivate (soft): keeps all data, revokes all sessions. */
router.post("/:id/deactivate", requirePermission("users", "deactivate"), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw badRequest("You cannot deactivate yourself");
    const { rows } = await query(
      `SELECT u.id, u.team_id, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [req.params.id]
    );
    if (!rows.length) throw notFound("User not found");
    const target = rows[0];
    if (!canManageUser(req.user, target.role, target.team_id)) throw forbidden();

    await query(
      `UPDATE users SET is_active = FALSE, deactivated_at = now(), deactivated_by = $1, updated_at = now()
        WHERE id = $2`,
      [req.user.id, target.id]
    );
    await revokeAllUserSessions(target.id);
    await audit(req, "user.deactivate", "user", target.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** Reactivate (SUPER_ADMIN and ADMIN within team). */
router.post("/:id/reactivate", requirePermission("users", "update"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.team_id, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [req.params.id]
    );
    if (!rows.length) throw notFound("User not found");
    const target = rows[0];
    if (!canManageUser(req.user, target.role, target.team_id)) throw forbidden();

    await query(
      `UPDATE users SET is_active = TRUE, deactivated_at = NULL, deactivated_by = NULL, updated_at = now()
        WHERE id = $1`,
      [target.id]
    );
    await audit(req, "user.reactivate", "user", target.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;