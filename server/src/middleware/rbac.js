/* ==========================================================================
   Role-based access control + the requireAuth guard re-exported for
   convenience (it lives in auth.js but is used together with the
   permission guards below in nearly every route module).
   ========================================================================== */
export { requireAuth } from "./auth.js";

/** Route guard: user must have this permission (from role baseline or team). */
export function requirePermission(module, action) {
  const needed = `${module}:${action}`;
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (req.user.permissions.has(needed)) return next();
    return res.status(403).json({ error: "Forbidden", required: needed });
  };
}

/** Route guard: user must have at least one of these permissions. */
export function requireAny(perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (perms.some(p => req.user.permissions.has(p))) return next();
    return res.status(403).json({ error: "Forbidden", required: perms });
  };
}

/** Route guard: role must be one of the listed. SUPER_ADMIN always passes. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (req.user.role === "SUPER_ADMIN" || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: "Forbidden", requiredRoles: roles });
  };
}

/**
 * Guard for user management: enforces hierarchy.
 *   SUPER_ADMIN: can do anything to anyone (except delete self).
 *   ADMIN: can only manage USER and ACCOUNTANT, in their own team.
 */
export function canManageUser(actor, targetRoleCode, targetTeamId) {
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role !== "ADMIN") return false;
  if (!["USER", "ACCOUNTANT"].includes(targetRoleCode)) return false;
  if (actor.teamId && targetTeamId && actor.teamId !== targetTeamId) return false;
  return true;
}