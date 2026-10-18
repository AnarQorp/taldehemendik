import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rawPool as pool } from "./pool.js";

const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
const migrationLock = await pool.connect();
await migrationLock.query("SELECT pg_advisory_lock(hashtext('talde-schema-migrations'))");
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);

// VS01 predates the ledger. Adopt an existing VS01 schema without replaying it.
const legacy = await pool.query(`SELECT to_regclass('public.users') existing`);
if (legacy.rows[0].existing) {
  await pool.query(`INSERT INTO schema_migrations(name) VALUES('001_vertical_slice_01.sql') ON CONFLICT DO NOTHING`);
}

const files = (await readdir(migrationsDir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
for (const name of files) {
  const applied = await pool.query(`SELECT 1 FROM schema_migrations WHERE name=$1`, [name]);
  if (applied.rowCount) continue;
  const sql = await readFile(`${migrationsDir}/${name}`, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations(name) VALUES($1)`, [name]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ event: "database.migration_applied", migration: name }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
await migrationLock.query("SELECT pg_advisory_unlock(hashtext('talde-schema-migrations'))");
migrationLock.release();
await pool.end();
console.log(JSON.stringify({ event: "database.migrated", migrations: files.length }));
