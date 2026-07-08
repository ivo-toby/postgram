import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createAdminUser
} from '../../src/auth/admin-service.js';
import { loadConfig } from '../../src/config.js';
import { createApp } from '../../src/index.js';
import type {
  AdminBackupCommandRunner,
  AdminBackupCommandRunnerResult,
  AdminBackupCommandRunnerInput
} from '../../src/services/admin-backup-service.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';

async function createActiveAdminSession(database: TestDatabase): Promise<{
  cookie: string;
  csrfToken: string;
}> {
  const user = (
    await createAdminUser(database.pool, {
      email: 'backup-admin@example.com',
      password: STRONG_PASSWORD
    })
  )._unsafeUnwrap();

  await database.pool.query(
    "UPDATE admin_users SET status = 'active' WHERE id = $1",
    [user.id]
  );

  const session = (
    await createAdminSession(database.pool, {
      adminUserId: user.id,
      ttlMs: 60 * 60 * 1000,
      mfaVerified: true
    })
  )._unsafeUnwrap();

  const app = createApp({ pool: database.pool });
  const csrfResponse = await app.request('/admin/api/session/csrf', {
    headers: {
      Cookie: `pgm_admin_session=${session.plaintextToken}`
    }
  });
  const csrfBody = (await csrfResponse.json()) as { csrfToken: string };
  expect(csrfResponse.status).toBe(200);

  return {
    cookie: `pgm_admin_session=${session.plaintextToken}`,
    csrfToken: csrfBody.csrfToken
  };
}

describe('admin backup API', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('downloads a CSRF and step-up protected tarball without passing DATABASE_URL in command args', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const commands: AdminBackupCommandRunnerInput[] = [];
    const commandRunner: AdminBackupCommandRunner = async (input) => {
      commands.push(input);
      if (input.command === 'pg_dump') {
        const fileIndex = input.args.indexOf('--file');
        const outputPath = input.args[fileIndex + 1];
        if (!outputPath) {
          throw new Error('pg_dump output path missing');
        }
        await writeFile(outputPath, 'fake custom pg dump');
        return;
      }

      if (input.command === 'tar') {
        const outputPath = input.args[input.args.indexOf('-czf') + 1];
        if (!outputPath) {
          throw new Error('tar output path missing');
        }
        await writeFile(outputPath, 'fake gzipped backup archive');
        return;
      }

      throw new Error(`Unexpected command ${input.command}`);
    };
    const runtimeConfig = loadConfig({
      DATABASE_URL:
        'postgresql://postgram:s3cret@db.example.test:5544/postgram?sslmode=require',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_DIMENSIONS: '1024',
      OLLAMA_BASE_URL: 'http://localhost:11434'
    });
    const admin = await createActiveAdminSession(database);
    const app = createApp({
      pool: database.pool,
      runtimeConfig,
      adminBackupCommandRunner: commandRunner
    });

    const response = await app.request('/admin/api/backups/download', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/gzip');
    expect(response.headers.get('Content-Disposition')).toMatch(
      /postgram-backup-.*\.tar\.gz/u
    );
    expect(await response.text()).toBe('fake gzipped backup archive');
    expect(commands).toHaveLength(2);
    expect(commands[0]?.command).toBe('pg_dump');
    expect(commands[0]?.args.join(' ')).not.toContain('s3cret');
    expect(commands[0]?.env).toMatchObject({
      PGDATABASE: 'postgram',
      PGHOST: 'db.example.test',
      PGPASSWORD: 's3cret',
      PGPORT: '5544',
      PGSSLMODE: 'require',
      PGUSER: 'postgram'
    });
    expect(commands[1]?.command).toBe('tar');

    const audit = await database.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM audit_log WHERE operation = 'admin.backup.download'"
    );
    expect(audit.rows[0]?.count).toBe('1');
  }, 120_000);

  it('validates a backup archive before any restore command is allowed', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const commands: AdminBackupCommandRunnerInput[] = [];
    const commandRunner: AdminBackupCommandRunner = async (
      input
    ): Promise<AdminBackupCommandRunnerResult | void> => {
      commands.push(input);
      if (input.command === 'tar') {
        const outputDir = input.args[input.args.indexOf('-C') + 1];
        if (!outputDir) {
          throw new Error('tar extraction directory missing');
        }
        await mkdir(outputDir, { recursive: true });
        await writeFile(
          join(outputDir, 'manifest.json'),
          JSON.stringify({
            formatVersion: 1,
            id: 'backup-id-1',
            product: 'postgram',
            generatedAt: '2026-07-08T08:00:00.000Z',
            contents: [
              { path: 'database.dump', type: 'postgres_custom_dump' },
              {
                path: 'configuration.json',
                type: 'redacted_runtime_configuration'
              }
            ]
          })
        );
        await writeFile(
          join(outputDir, 'configuration.json'),
          JSON.stringify({ runtime: { EMBEDDING_PROVIDER: 'ollama' } })
        );
        await writeFile(join(outputDir, 'database.dump'), 'fake dump');
        return;
      }
      if (input.command === 'pg_restore') {
        expect(input.args).toContain('--list');
        return { stdout: '1; 2615 2200 SCHEMA - public postgram\n' };
      }

      throw new Error(`Unexpected command ${input.command}`);
    };
    const runtimeConfig = loadConfig({
      DATABASE_URL: 'postgresql://postgram:s3cret@postgres:5432/postgram',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_DIMENSIONS: '1024',
      OLLAMA_BASE_URL: 'http://localhost:11434'
    });
    const admin = await createActiveAdminSession(database);
    const app = createApp({
      pool: database.pool,
      runtimeConfig,
      adminBackupCommandRunner: commandRunner
    });
    const formData = new FormData();
    formData.set(
      'backup',
      new File(['fake archive'], 'postgram-backup.tar.gz', {
        type: 'application/gzip'
      })
    );

    const response = await app.request('/admin/api/backups/restore/validate', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'X-CSRF-Token': admin.csrfToken
      },
      body: formData
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      restore: {
        token: string;
        stagingDatabaseName: string;
        sourceDatabase: { name: string; redactedUrl: string };
        switchOver: { emergencyRollback: string[] };
      };
    };
    expect(body.restore.token).toMatch(/^[a-f0-9-]+$/u);
    expect(body.restore.stagingDatabaseName).toMatch(
      /^postgram_restore_\d{8}_\d{6}_[a-f0-9]{8}$/u
    );
    expect(body.restore.sourceDatabase).toMatchObject({
      name: 'postgram',
      redactedUrl: 'postgresql://postgram:***@postgres:5432/postgram'
    });
    expect(body.restore.switchOver.emergencyRollback.join('\n')).toContain(
      'POSTGRES_DB=postgram'
    );
    expect(commands.map((command) => command.command)).toEqual([
      'tar',
      'pg_restore'
    ]);

    const audit = await database.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM audit_log WHERE operation = 'admin.backup.restore.validate'"
    );
    expect(audit.rows[0]?.count).toBe('1');
  }, 120_000);

  it('restores a validated archive into a staging database and returns deliberate switch-over instructions', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const commands: AdminBackupCommandRunnerInput[] = [];
    const commandRunner: AdminBackupCommandRunner = async (
      input
    ): Promise<AdminBackupCommandRunnerResult | void> => {
      commands.push(input);
      if (input.command === 'tar') {
        const outputDir = input.args[input.args.indexOf('-C') + 1];
        if (!outputDir) {
          throw new Error('tar extraction directory missing');
        }
        await mkdir(outputDir, { recursive: true });
        await writeFile(
          join(outputDir, 'manifest.json'),
          JSON.stringify({
            formatVersion: 1,
            id: 'backup-id-2',
            product: 'postgram',
            generatedAt: '2026-07-08T08:05:00.000Z',
            contents: [
              { path: 'database.dump', type: 'postgres_custom_dump' },
              {
                path: 'configuration.json',
                type: 'redacted_runtime_configuration'
              }
            ]
          })
        );
        await writeFile(join(outputDir, 'configuration.json'), '{}');
        await writeFile(join(outputDir, 'database.dump'), 'fake dump');
        return;
      }
      if (input.command === 'pg_restore' && input.args.includes('--list')) {
        return { stdout: '1; 2615 2200 SCHEMA - public postgram\n' };
      }
      return;
    };
    const runtimeConfig = loadConfig({
      DATABASE_URL: 'postgresql://postgram:s3cret@postgres:5432/postgram',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_DIMENSIONS: '1024',
      OLLAMA_BASE_URL: 'http://localhost:11434'
    });
    const admin = await createActiveAdminSession(database);
    const app = createApp({
      pool: database.pool,
      runtimeConfig,
      adminBackupCommandRunner: commandRunner,
      adminBackupRestoreVerifier: async () => ({
        migrations: 'passed',
        health: 'connected'
      })
    });
    const formData = new FormData();
    formData.set(
      'backup',
      new File(['fake archive'], 'postgram-backup.tar.gz', {
        type: 'application/gzip'
      })
    );
    const validateResponse = await app.request(
      '/admin/api/backups/restore/validate',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'X-CSRF-Token': admin.csrfToken
        },
        body: formData
      }
    );
    const validateBody = (await validateResponse.json()) as {
      restore: { token: string; stagingDatabaseName: string };
    };

    const response = await app.request('/admin/api/backups/restore/stage', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({
        restoreToken: validateBody.restore.token,
        confirmation: 'RESTORE TO STAGING'
      })
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      restore: {
        status: string;
        stagingDatabaseName: string;
        switchOver: {
          dockerCompose: string[];
          emergencyRollback: string[];
        };
      };
    };
    expect(body.restore).toMatchObject({
      status: 'staged',
      stagingDatabaseName: validateBody.restore.stagingDatabaseName
    });
    expect(body.restore.switchOver.dockerCompose.join('\n')).toContain(
      `POSTGRES_DB=${validateBody.restore.stagingDatabaseName}`
    );
    expect(body.restore.switchOver.emergencyRollback.join('\n')).toContain(
      'restore the previous POSTGRES_DB=postgram'
    );
    expect(commands.some((command) => command.command === 'createdb')).toBe(
      true
    );
    expect(
      commands.some(
        (command) =>
          command.command === 'pg_restore' &&
          command.args.includes('--dbname') &&
          command.args.includes(validateBody.restore.stagingDatabaseName)
      )
    ).toBe(true);

    const audit = await database.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM audit_log WHERE operation = 'admin.backup.restore.stage'"
    );
    expect(audit.rows[0]?.count).toBe('1');
  }, 120_000);
});
