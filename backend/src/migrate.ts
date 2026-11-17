import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

export function migrationsDir(): string {
  const nextToSrc = path.resolve(here, "../migrations");
  if (fs.existsSync(nextToSrc)) return nextToSrc;
  return path.resolve(here, "../../migrations");
}

export async function migrate(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(13080, 17)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const dir = migrationsDir();
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      const exists = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
      if (exists.rowCount) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return applied;
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(13080, 17)"); }
    finally { client.release(); }
  }
}
