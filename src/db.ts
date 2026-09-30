import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { config } from "./config.js";
import { logError } from "./log.js";
import { sslFor } from "./pg-ssl.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  application_name: "brain-up-bot",
  ssl: sslFor(config.databaseUrl),
});

pool.on("error", (err) => {
  logError("pg pool", err);
});

export function query<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(sql, params);
}

const MIGRATION_LOCK = 814231;

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await applyMigrations(client);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    } catch (err) {
      logError("migration unlock", err);
    }
    client.release();
  }
}

async function applyMigrations(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(here, "../migrations");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  let applied = 0;

  for (const file of files) {
    const existing = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (existing.rowCount) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied += 1;
      console.log(`Applied migration ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  if (applied === 0) {
    console.log("Migrations already up to date");
  }
}
