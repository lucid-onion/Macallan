import crypto from "node:crypto";
import { query } from "../config/db.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 1 day

export function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createSession(userId, req) {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hash, req.headers["user-agent"] || null, req.ip, expires]
  );
  return { raw, expires };
}

export async function revokeSession(raw) {
  await query(
    `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(raw)]
  );
}

export async function revokeAllUserSessions(userId) {
  await query(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

/**
 * Attaches req.user = { id, username, full_name, role, teamId, permissions:Set }
 * or leaves it null. Called on every request.
 */
export async function loadUser(req, _res, next) {
  try {
    const raw = req.cookies?.["asn_session"];
    if (!raw) return next();

    const { rows } = await query(
      `SELECT u.id, u.username, u.full_name, u.is_active, u.team_id,
              r.code AS role, r.rank
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
        LIMIT 1`,
      [hashToken(raw)]
    );
    if (!rows.length) return next();

    const u = rows[0];
    if (!u.is_active) return next();

    // Effective permissions = role baseline ∪ team grants ∪ parent-team grants.
    const permRes = await query(
      `WITH RECURSIVE team_chain AS (
         SELECT id FROM teams WHERE id = $1
         UNION ALL
         SELECT t.parent_team_id FROM teams t
         JOIN team_chain tc ON t.id = tc.id
         WHERE t.parent_team_id IS NOT NULL
       )
       SELECT DISTINCT p.module, p.action
         FROM permissions p
        WHERE p.id IN (
          SELECT permission_id FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = $2)
          UNION
          SELECT tp.permission_id FROM team_permissions tp
            JOIN team_chain tc ON tc.id = tp.team_id
        )`,
      [u.team_id, u.role]
    );

    const permissions = new Set(permRes.rows.map(r => `${r.module}:${r.action}`));
    req.user = {
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      rank: u.rank,
      teamId: u.team_id,
      permissions,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires an authenticated, active user. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}