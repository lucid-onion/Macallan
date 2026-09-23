/* ==========================================================================
   Generic CRUD router factory. Every business module (suppliers, customers,
   inventory, purchases, sales, transportation, office_expenses, demolition)
   is a thin config wrapper around this. Transactions and reports have
   custom logic and don't use it.
   ========================================================================== */
import { Router } from "express";
import { z } from "zod";
import { query } from "../../config/db.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { audit } from "../../utils/audit.js";
import { notFound, conflict } from "../../utils/errors.js";

/**
 * @param {object} opts
 * @param {string} opts.moduleName       e.g. "suppliers" — used for requirePermission and audit
 * @param {string} opts.table            SQL table name
 * @param {string} opts.entity           singular noun for audit ("supplier")
 * @param {z.ZodTypeAny} opts.schema     create/update payload validator (all fields optional-safe)
 * @param {string[]} opts.orderBy        SQL ORDER BY clause (no "ORDER BY" keyword)
 * @param {(row:any)=>any} [opts.toApi]  optional shape mapper
 * @param {string} [opts.uniqueField]    field that must be unique when creating (case-insensitive)
 */
export function makeCrudRouter({
  moduleName,
  table,
  entity,
  schema,
  orderBy = "created_at DESC",
  uniqueField,
}) {
  const router = Router();
  router.use(requireAuth);

  // LIST
  router.get("/", requirePermission(moduleName, "view"), async (_req, res, next) => {
    try {
      const { rows } = await query(`SELECT * FROM ${table} WHERE deleted_at IS NULL ORDER BY ${orderBy}`);
      res.json({ items: rows });
    } catch (e) { next(e); }
  });

  // GET ONE
  router.get("/:id", requirePermission(moduleName, "view"), async (req, res, next) => {
    try {
      const { rows } = await query(`SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
      if (!rows.length) throw notFound();
      res.json({ item: rows[0] });
    } catch (e) { next(e); }
  });

  // CREATE
  router.post("/", requirePermission(moduleName, "create"), async (req, res, next) => {
    try {
      const input = schema.parse(req.body);
      if (uniqueField && input[uniqueField]) {
        const dup = await query(
          `SELECT 1 FROM ${table} WHERE LOWER(${uniqueField}) = LOWER($1) AND deleted_at IS NULL`,
          [input[uniqueField]]
        );
        if (dup.rowCount) throw conflict(`${entity} already exists`);
      }
      const cols = Object.keys(input);
      const vals = Object.values(input);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      cols.push("created_by");
      vals.push(req.user.id);
      placeholders.push(`$${vals.length}`);

      const { rows } = await query(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        vals
      );
      await audit(req, `${entity}.create`, entity, rows[0].id, input);
      res.status(201).json({ item: rows[0] });
    } catch (e) { next(e); }
  });

  // UPDATE (partial)
  router.patch("/:id", requirePermission(moduleName, "update"), async (req, res, next) => {
    try {
      const input = schema.partial().parse(req.body);
      const entries = Object.entries(input);
      if (!entries.length) return res.json({ ok: true });

      const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
      const vals = entries.map(([, v]) => v);
      sets.push("updated_at = now()");
      vals.push(req.params.id);
      const { rowCount } = await query(
        `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${vals.length} AND deleted_at IS NULL`,
        vals
      );
      if (!rowCount) throw notFound();
      await audit(req, `${entity}.update`, entity, req.params.id, input);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // SOFT DELETE
  router.delete("/:id", requirePermission(moduleName, "delete"), async (req, res, next) => {
    try {
      const { rowCount } = await query(
        `UPDATE ${table} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (!rowCount) throw notFound();
      await audit(req, `${entity}.delete`, entity, req.params.id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
}