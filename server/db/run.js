/* ==========================================================================
   Minimal migration/seed runner.
   Usage:
     npm run migrate    — applies every db/migrations/*.sql in filename order
     npm run seed       — applies every db/migrations/*seed*.sql
   Uses a schema_migrations table to track applied files so re-running is
   safe (idempotent).
   ========================================================================== */
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import "dotenv/config";
import pg from "pg";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function ensureLedger() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function listFiles(kind) {
  const all = await fs.readdir(MIGRATIONS_DIR);
  const filtered = all
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (kind === "seeds" ? /seed/i.test(f) : !/seed/i.test(f)))
    .sort();
  return filtered;
}

async function alreadyApplied(filename) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM schema_migrations WHERE filename = $1`,
    [filename]
  );
  return rowCount > 0;
}

async function applyFile(filename) {
  const full = path.join(MIGRATIONS_DIR, filename);
  const sql = await fs.readFile(full, "utf8");
  console.log(`→ applying ${filename}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [filename]);
    await client.query("COMMIT");
    console.log(`  ✓ ${filename}`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`  ✗ ${filename} — ${e.message}`);
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const kind = process.argv[2] || "migrations";
  await ensureLedger();
  const files = await listFiles(kind);
  if (!files.length) {
    console.log(`No ${kind} found in ${MIGRATIONS_DIR}`);
    return;
  }
  for (const f of files) {
    if (await alreadyApplied(f)) {
      console.log(`= skipping ${f} (already applied)`);
      continue;
    }
    await applyFile(f);
  }
  console.log(`\nDone (${kind}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());