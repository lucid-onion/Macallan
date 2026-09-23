import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { query } from "../../config/db.js";
import { createSession, revokeSession } from "../../middleware/auth.js";
import { audit } from "../../utils/audit.js";
import { badRequest, unauthorized } from "../../utils/errors.js";

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) throw badRequest("Username and password required");

    const { rows } = await query(
      `SELECT u.id, u.username, u.full_name, u.password_hash, u.is_active,
              r.code AS role, u.team_id
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.username = $1`,
      [username]
    );
    // Constant-ish time: always run bcrypt.compare against something.
    const row = rows[0];
    const hash = row?.password_hash || "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";
    const ok = await bcrypt.compare(password, hash);
    if (!row || !ok) throw unauthorized("Invalid username or password");
    if (!row.is_active) throw unauthorized("Account is deactivated");

    const { raw, expires } = await createSession(row.id, req);
    res.cookie("asn_session", raw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      expires,
      path: "/",
    });
    await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [row.id]);
    req.user = { id: row.id };
    await audit(req, "auth.login", "user", row.id);

    res.json({
      user: { id: row.id, username: row.username, fullName: row.full_name, role: row.role, teamId: row.team_id },
    });
  } catch (e) { next(e); }
});

router.post("/logout", async (req, res, next) => {
  try {
    const raw = req.cookies?.["asn_session"];
    if (raw) {
      await revokeSession(raw);
      req.user = req.user || {};
      await audit(req, "auth.logout", "user", req.user.id);
    }
    res.clearCookie("asn_session", { path: "/" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  res.json({
    user: {
      id: req.user.id, username: req.user.username, fullName: req.user.fullName,
      role: req.user.role, teamId: req.user.teamId,
      permissions: [...req.user.permissions],
    },
  });
});

export default router;