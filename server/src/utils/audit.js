import { query } from "../config/db.js";

export async function audit(req, action, entityType, entityId, detail) {
  try {
    await query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, detail, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user?.id || null, action, entityType, String(entityId ?? ""), detail || null, req.ip]
    );
  } catch (e) { console.error("audit failed", e); }
}