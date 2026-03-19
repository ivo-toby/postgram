import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';

const MIGRATION_FILE_PATTERN = /^\d+_.+\.sql$/;

type MigrationRow = {
  version: string;
};

export function getDefaultMigrationsDir(): string {
  return fileURLToPath(new URL('./migrations', import.meta.url));
}

export async function runMigrations(
  pool: Pool,
  migrationsDir = getDefaultMigrationsDir()
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = await pool.query<MigrationRow>(
    'SELECT version FROM schema_migrations'
  );
  const appliedVersions = new Set(applied.rows.map((row) => row.version));

  const filenames = (await readdir(migrationsDir))
    .filter((filename) => MIGRATION_FILE_PATTERN.test(filename))
    .sort();

  for (const filename of filenames) {
    if (appliedVersions.has(filename)) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [filename]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
