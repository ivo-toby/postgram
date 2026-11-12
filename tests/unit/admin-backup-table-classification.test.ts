import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { adminBackupTableClassification } from '../../src/services/admin-backup-service.js';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../src/db/migrations', import.meta.url)
);

/**
 * `schema_migrations` is created by the migration runner itself
 * (src/db/migrate.ts), not by a migration file, so it never appears in the
 * scan below.
 */
const RUNNER_OWNED_TABLES = ['schema_migrations'] as const;

async function tablesCreatedByMigrations(): Promise<string[]> {
  const filenames = (await readdir(MIGRATIONS_DIR))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const tables = new Set<string>(RUNNER_OWNED_TABLES);

  for (const filename of filenames) {
    const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
    const statements = sql.matchAll(
      /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gimu
    );
    for (const statement of statements) {
      const table = statement[1];
      if (table) {
        tables.add(table);
      }
    }
    const drops = sql.matchAll(
      /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gimu
    );
    for (const statement of drops) {
      const table = statement[1];
      if (table) {
        tables.delete(table);
      }
    }
  }

  return [...tables].sort();
}

describe('admin backup table classification', () => {
  it('finds the migration-created tables it is meant to check', async () => {
    const tables = await tablesCreatedByMigrations();

    // A guard on the guard: if the scan silently stops matching, the drift
    // assertion below would pass for the wrong reason.
    expect(tables.length).toBeGreaterThan(20);
    expect(tables).toContain('entities');
    expect(tables).toContain('schema_migrations');
  });

  it('classifies every table the migrations create', async () => {
    const tables = await tablesCreatedByMigrations();
    const classified = new Set<string>([
      ...adminBackupTableClassification.required,
      ...adminBackupTableClassification.optional,
      ...adminBackupTableClassification.excluded
    ]);

    const unclassified = tables.filter((table) => !classified.has(table));

    // A new migration must say whether its table is backed up or deliberately
    // excluded. Leaving it unclassified is what produced issue #131: backups
    // were created happily and refused at restore time.
    expect(unclassified).toEqual([]);
  });

  it('does not classify tables that no longer exist in the schema', async () => {
    const tables = new Set(await tablesCreatedByMigrations());
    const classified = [
      ...adminBackupTableClassification.required,
      ...adminBackupTableClassification.optional,
      ...adminBackupTableClassification.excluded
    ];

    const stale = classified.filter((table) => !tables.has(table));

    expect(stale).toEqual([]);
  });

  it('does not let the schema introduce a sequence the TOC validator would reject', async () => {
    // Verified against a real pg_dump: `--data-only` emits a `SEQUENCE SET`
    // TOC entry for every serial/identity column, and the restore validator
    // accepts only `TABLE DATA` entries. The schema uses uuid and text keys
    // throughout, so there are no sequences today. Adding one would break
    // every backup in exactly the way issue #131 describes, so it has to come
    // with a matching change to validatePgRestoreDataList.
    const filenames = (await readdir(MIGRATIONS_DIR))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();

    const offenders: string[] = [];
    for (const filename of filenames) {
      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      if (
        /\b(?:big|small)?serial\b/iu.test(sql) ||
        /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/iu.test(sql) ||
        /\bCREATE\s+SEQUENCE\b/iu.test(sql)
      ) {
        offenders.push(filename);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the three classification lists disjoint', () => {
    const { required, optional, excluded } = adminBackupTableClassification;
    const all = [...required, ...optional, ...excluded];

    expect(all.length).toBe(new Set(all).size);
  });

  it('pins the v2 required baseline so older archives stay restorable', () => {
    // A restore requires every table in this list. Adding one here makes every
    // archive taken by an older Postgram version unrestorable, so new tables
    // belong in `optional` instead. Change this only with a format version bump.
    expect([...adminBackupTableClassification.required]).toEqual([
      'admin_auth_attempts',
      'admin_bootstrap_tokens',
      'admin_job_events',
      'admin_jobs',
      'admin_mfa_factors',
      'admin_onboarding_state',
      'admin_runtime_secrets',
      'admin_runtime_settings',
      'admin_sessions',
      'admin_users',
      'api_keys',
      'audit_log',
      'chunks',
      'document_sources',
      'edges',
      'embedding_models',
      'entities',
      'oauth_authorization_codes',
      'oauth_clients',
      'oauth_tokens'
    ]);
  });
});
