import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
import { Pool } from 'pg';

import {
  collectAttachmentGarbage,
  type AttachmentGcOptions,
  type AttachmentGcReport
} from '../../src/services/attachment-gc-service.js';
import { lockIngestSha } from '../../src/services/document-ingest-service.js';
import { FilesystemAttachmentStore } from '../../src/services/loaders/attachment-store.js';
import { ErrorCode } from '../../src/util/errors.js';
import { waitForBlockedIngestLock } from '../helpers/document-loaders.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const execFileAsync = promisify(execFile);
const TSX_BIN = path.resolve('node_modules/.bin/tsx');
const PGM_ADMIN_ENTRYPOINT = path.resolve('src/cli/admin/pgm-admin.ts');
const HOUR_MS = 3_600_000;
const IS_ROOT = process.getuid?.() === 0;

// The subprocess cases start tsx, which is slow on a cold cache.
vi.setConfig({ testTimeout: 120_000 });

function getDatabaseUrl(database: TestDatabase): string {
  const options = database.pool.options as {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
  };
  return `postgresql://${encodeURIComponent(options.user ?? '')}:${encodeURIComponent(options.password ?? '')}@${options.host}:${options.port}/${options.database}`;
}

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('attachments gc', () => {
  let database: TestDatabase;
  let dbUrl = '';
  let dir: string;
  let store: FilesystemAttachmentStore;
  let counter = 0;

  beforeAll(async () => {
    database = await createTestDatabase();
    dbUrl = getDatabaseUrl(database);
  }, 240_000);

  beforeEach(async () => {
    await resetTestDatabase(database.pool);
    dir = await mkdtemp(path.join(tmpdir(), 'pgm-gc-'));
    store = new FilesystemAttachmentStore(dir);
  });

  afterEach(async () => {
    // A test may leave a read-only directory behind.
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      await chmod(path.join(dir, name), 0o755).catch(() => undefined);
    }
    await rm(dir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await database.close();
  });

  function gc(
    options: Partial<AttachmentGcOptions> = {}
  ): Promise<AttachmentGcReport> {
    return collectAttachmentGarbage(database.pool, store, {
      minAgeMs: HOUR_MS,
      dryRun: false,
      ...options
    });
  }

  /** Write a stored file with the given age. */
  async function writeStored(
    ageMs: number,
    content = `file-${++counter}-${Math.random()}`
  ): Promise<{ sha256: string; file: string; size: number }> {
    const bytes = Buffer.from(content);
    const sha256 = sha(bytes);
    const fanout = path.join(dir, sha256.slice(0, 2));
    await mkdir(fanout, { recursive: true });
    const file = path.join(fanout, sha256);
    await writeFile(file, bytes);
    const when = new Date(Date.now() - ageMs);
    await utimes(file, when, when);
    return { sha256, file, size: bytes.byteLength };
  }

  async function exists(file: string): Promise<boolean> {
    try {
      await stat(file);
      return true;
    } catch {
      return false;
    }
  }

  async function insertEntityWithRow(sha256: string): Promise<string> {
    const entity = await database.pool.query<{ id: string }>(
      `INSERT INTO entities (type, content, metadata, mime_type, loading_status)
       VALUES ('document', NULL, '{}'::jsonb, 'application/pdf', 'pending')
       RETURNING id`
    );
    const id = entity.rows[0]!.id;
    await database.pool.query(
      `INSERT INTO attachments (entity_id, role, ref, kind, mime_type, filename, byte_size, sha256, storage_uri)
       VALUES ($1, 'original', 'original', 'document', 'application/pdf', 'a.pdf', 1, $2, $3)`,
      [id, sha256, `${sha256.slice(0, 2)}/${sha256}`]
    );
    return id;
  }

  /**
   * Gives the table one row for a hash that has no file, so the
   * wrong-database guard sees a database that is in use.
   */
  async function seedKeeperRow(): Promise<void> {
    await insertEntityWithRow(sha(Buffer.from(`keeper-${Math.random()}`)));
  }

  describe('collectAttachmentGarbage', () => {
    beforeEach(seedKeeperRow);

    it('removes an old orphan and reports the counts', async () => {
      const orphan = await writeStored(2 * HOUR_MS);

      const report = await gc();

      expect(report).toMatchObject({
        dryRun: false,
        scanned: 1,
        orphans: 1,
        removed: 1,
        bytesFreed: orphan.size,
        tempFilesRemoved: 0,
        errors: 0,
        refused: false,
        warnings: []
      });
      expect(await exists(orphan.file)).toBe(false);
    });

    it('keeps a file that a row references', async () => {
      const kept = await writeStored(2 * HOUR_MS);
      await insertEntityWithRow(kept.sha256);

      const report = await gc();

      expect(report).toMatchObject({ scanned: 1, orphans: 0, removed: 0 });
      expect(await exists(kept.file)).toBe(true);
    });

    it('keeps a shared file until the last referencing entity is gone', async () => {
      const shared = await writeStored(2 * HOUR_MS);
      const first = await insertEntityWithRow(shared.sha256);
      const second = await insertEntityWithRow(shared.sha256);

      await database.pool.query('DELETE FROM entities WHERE id = $1', [first]);
      expect(await gc()).toMatchObject({ orphans: 0, removed: 0 });
      expect(await exists(shared.file)).toBe(true);

      await database.pool.query('DELETE FROM entities WHERE id = $1', [second]);
      expect(await gc()).toMatchObject({ orphans: 1, removed: 1 });
      expect(await exists(shared.file)).toBe(false);
    });

    it('keeps an orphan that is younger than the minimum age', async () => {
      const young = await writeStored(5 * 60_000);

      expect(await gc()).toMatchObject({ scanned: 1, orphans: 0, removed: 0 });
      expect(await exists(young.file)).toBe(true);

      expect(await gc({ minAgeMs: 60_000 })).toMatchObject({ removed: 1 });
      expect(await exists(young.file)).toBe(false);
    });

    it('removes nothing in a dry run but reports the orphans', async () => {
      const orphan = await writeStored(2 * HOUR_MS);

      const report = await gc({ dryRun: true });

      expect(report).toMatchObject({
        dryRun: true,
        scanned: 1,
        orphans: 1,
        orphanBytes: orphan.size,
        removed: 0,
        bytesFreed: 0,
        tempFilesRemoved: 0
      });
      expect(await exists(orphan.file)).toBe(true);
    });

    it('removes stale temp files and keeps young ones', async () => {
      const old = await writeStored(2 * HOUR_MS);
      await insertEntityWithRow(old.sha256);
      const fanout = path.dirname(old.file);
      const oldTmp = path.join(fanout, `${old.sha256}.123.abcdef012345.tmp`);
      const youngTmp = path.join(fanout, `${old.sha256}.124.abcdef012346.tmp`);
      await writeFile(oldTmp, 'x');
      await writeFile(youngTmp, 'y');
      const past = new Date(Date.now() - 2 * HOUR_MS);
      await utimes(oldTmp, past, past);

      const report = await gc();

      expect(report.tempFilesRemoved).toBe(1);
      expect(await exists(oldTmp)).toBe(false);
      expect(await exists(youngTmp)).toBe(true);
      expect(await readdir(fanout)).toContain(old.sha256);
    });

    it('warns about a missing attachments directory and scans nothing', async () => {
      const missing = path.join(dir, 'does-not-exist');

      const report = await collectAttachmentGarbage(
        database.pool,
        new FilesystemAttachmentStore(missing),
        { minAgeMs: HOUR_MS, dryRun: false, attachmentsDir: missing }
      );

      expect(report).toMatchObject({ scanned: 0, orphans: 0, removed: 0 });
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0]).toMatch(/does not exist/);
    });

    it('skips entries that are not regular files', async () => {
      const fake = sha(Buffer.from('a directory named like a hash'));
      await mkdir(path.join(dir, fake.slice(0, 2), fake), { recursive: true });
      const orphan = await writeStored(2 * HOUR_MS);

      const report = await gc();

      expect(report).toMatchObject({ scanned: 1, removed: 1, errors: 0 });
      expect(await exists(orphan.file)).toBe(false);
      expect(await exists(path.join(dir, fake.slice(0, 2), fake))).toBe(true);
    });

    it.skipIf(IS_ROOT)(
      'counts an unlink error and continues with the other files',
      async () => {
        const locked = await writeStored(2 * HOUR_MS);
        // Put the second file in another fan-out directory.
        let other = await writeStored(2 * HOUR_MS);
        while (path.dirname(other.file) === path.dirname(locked.file)) {
          await rm(other.file);
          other = await writeStored(2 * HOUR_MS);
        }
        await chmod(path.dirname(locked.file), 0o555);

        const report = await gc();

        expect(report.errors).toBe(1);
        expect(report.errorMessages).toHaveLength(1);
        expect(report.errorMessages[0]).toMatch(/EACCES/);
        expect(report.removed).toBe(1);
        expect(await exists(locked.file)).toBe(true);
        expect(await exists(other.file)).toBe(false);
      }
    );
  });

  describe('report and cleanup details', () => {
    beforeEach(seedKeeperRow);

    it('counts unreferenced files that are too young as skippedYoung', async () => {
      const young = await writeStored(60_000);
      const old = await writeStored(2 * HOUR_MS);
      const referenced = await writeStored(60_000);
      await insertEntityWithRow(referenced.sha256);

      const report = await gc({ dryRun: true });

      expect(report).toMatchObject({ skippedYoung: 1, orphans: 1 });
      expect(await exists(young.file)).toBe(true);
      expect(await exists(old.file)).toBe(true);
    });

    it('reports a missing attachments table as a validation error', async () => {
      await database.pool.query('CREATE SCHEMA IF NOT EXISTS gc_empty');
      const bare = new Pool({
        connectionString: dbUrl,
        options: '-c search_path=gc_empty'
      });
      try {
        await expect(
          collectAttachmentGarbage(bare, store, {
            minAgeMs: HOUR_MS,
            dryRun: true
          })
        ).rejects.toMatchObject({
          code: ErrorCode.VALIDATION,
          message: expect.stringMatching(
            /attachments table does not exist/
          ) as unknown as string
        });
      } finally {
        await bare.end();
        await database.pool.query('DROP SCHEMA gc_empty');
      }
    });
  });

  describe('wrong-database guard', () => {
    it('refuses to delete when the table is empty but the store has files', async () => {
      const orphan = await writeStored(2 * HOUR_MS);

      const report = await gc();

      expect(report).toMatchObject({
        refused: true,
        removed: 0,
        orphans: 1,
        tempFilesRemoved: 0
      });
      expect(report.warnings[0]).toMatch(/wrong database/);
      expect(await exists(orphan.file)).toBe(true);
    });

    it('only warns in a dry run', async () => {
      await writeStored(2 * HOUR_MS);

      const report = await gc({ dryRun: true });

      expect(report.refused).toBe(false);
      expect(report.warnings).toHaveLength(1);
    });

    it('deletes with force', async () => {
      const orphan = await writeStored(2 * HOUR_MS);

      const report = await gc({ force: true });

      expect(report).toMatchObject({
        refused: false,
        removed: 1,
        warnings: []
      });
      expect(await exists(orphan.file)).toBe(false);
    });

    it('does not refuse an empty store with an empty table', async () => {
      const report = await gc();

      expect(report).toMatchObject({
        refused: false,
        scanned: 0,
        warnings: []
      });
    });
  });

  describe('ingest lock protocol', () => {
    beforeEach(seedKeeperRow);

    it('waits for a concurrent ingest and keeps the file once a row exists', async () => {
      const orphan = await writeStored(2 * HOUR_MS);
      const other = await database.pool.connect();
      try {
        await other.query('BEGIN');
        await lockIngestSha(other, orphan.sha256);

        let finished = false;
        const running = gc().finally(() => {
          finished = true;
        });
        await waitForBlockedIngestLock(database.pool, orphan.sha256);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(finished).toBe(false);
        expect(await exists(orphan.file)).toBe(true);

        // The ingest inserts its row while it holds the lock.
        const entity = await other.query<{ id: string }>(
          `INSERT INTO entities (type, content, metadata, mime_type, loading_status)
           VALUES ('document', NULL, '{}'::jsonb, 'application/pdf', 'pending')
           RETURNING id`
        );
        await other.query(
          `INSERT INTO attachments (entity_id, role, ref, kind, mime_type, filename, byte_size, sha256, storage_uri)
           VALUES ($1, 'original', 'original', 'document', 'application/pdf', 'a.pdf', 1, $2, $3)`,
          [
            entity.rows[0]!.id,
            orphan.sha256,
            `${orphan.sha256.slice(0, 2)}/${orphan.sha256}`
          ]
        );
        await other.query('COMMIT');

        const report = await running;
        expect(report).toMatchObject({ scanned: 1, removed: 0 });
        expect(await exists(orphan.file)).toBe(true);
      } finally {
        other.release();
      }
    });

    it('removes the file after a waiting ingest rolls back', async () => {
      const orphan = await writeStored(2 * HOUR_MS);
      const other = await database.pool.connect();
      try {
        await other.query('BEGIN');
        await lockIngestSha(other, orphan.sha256);

        const running = gc();
        await waitForBlockedIngestLock(database.pool, orphan.sha256);
        expect(await exists(orphan.file)).toBe(true);
        await other.query('ROLLBACK');

        expect(await running).toMatchObject({ removed: 1 });
        expect(await exists(orphan.file)).toBe(false);
      } finally {
        other.release();
      }
    });
  });

  describe('pgm-admin attachments gc (command wiring)', () => {
    type Run = { code: number; stdout: string; stderr: string };

    async function runCommand(
      args: string[],
      extra: NodeJS.ProcessEnv = {}
    ): Promise<Run> {
      try {
        const { stdout, stderr } = await execFileAsync(
          TSX_BIN,
          [PGM_ADMIN_ENTRYPOINT, ...args],
          {
            env: {
              ...process.env,
              DATABASE_URL: dbUrl,
              ATTACHMENTS_DIR: dir,
              ...extra
            },
            cwd: process.cwd(),
            timeout: 120_000
          }
        );
        return { code: 0, stdout, stderr };
      } catch (error) {
        const err = error as {
          code?: number;
          stdout?: string;
          stderr?: string;
        };
        return {
          code: typeof err.code === 'number' ? err.code : 1,
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? ''
        };
      }
    }

    it('removes an orphan, prints the JSON report and writes an audit entry', async () => {
      await seedKeeperRow();
      const orphan = await writeStored(2 * HOUR_MS);

      const run = await runCommand(['--json', 'attachments', 'gc'], {
        LOADERS_ENABLED: 'false'
      });

      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({
        dryRun: false,
        scanned: 1,
        removed: 1,
        bytesFreed: orphan.size,
        errors: 0,
        warnings: []
      });
      expect(await exists(orphan.file)).toBe(false);
      const audit = await database.pool.query<{
        operation: string;
        details: { removed: number };
      }>(
        "SELECT operation, details FROM audit_log WHERE operation LIKE 'attachments.gc%'"
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({
        operation: 'attachments.gc',
        details: { removed: 1 }
      });
    });

    it('rejects a minimum age below 10 minutes and a malformed one', async () => {
      await seedKeeperRow();
      const orphan = await writeStored(2 * HOUR_MS);

      const tooSmall = await runCommand([
        '--json',
        'attachments',
        'gc',
        '--min-age',
        '5m'
      ]);
      expect(tooSmall.code).toBe(1);
      const body = JSON.parse(tooSmall.stdout) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe('VALIDATION');
      expect(body.error.message).toMatch(/at least 10m/);
      expect(await exists(orphan.file)).toBe(true);

      const malformed = await runCommand([
        '--json',
        'attachments',
        'gc',
        '--min-age',
        'soon'
      ]);
      expect(malformed.code).toBe(1);
      expect(malformed.stdout).toMatch(/Invalid duration/);
      expect(
        (JSON.parse(malformed.stdout) as { error: { code: string } }).error.code
      ).toBe('VALIDATION');

      const unit = await runCommand([
        '--json',
        'attachments',
        'gc',
        '--min-age',
        '600s'
      ]);
      expect(unit.code).toBe(1);
      expect(
        (JSON.parse(unit.stdout) as { error: { code: string } }).error.code
      ).toBe('VALIDATION');
    });

    it('prints skippedYoung in JSON and as a text line', async () => {
      await seedKeeperRow();
      await writeStored(15 * 60_000);

      const json = await runCommand([
        '--json',
        'attachments',
        'gc',
        '--dry-run',
        '--min-age',
        '10m'
      ]);
      expect(JSON.parse(json.stdout)).toMatchObject({
        orphans: 1,
        skippedYoung: 0
      });

      const young = await runCommand([
        '--json',
        'attachments',
        'gc',
        '--dry-run',
        '--min-age',
        '2h'
      ]);
      expect(JSON.parse(young.stdout)).toMatchObject({ skippedYoung: 1 });

      const text = await runCommand([
        'attachments',
        'gc',
        '--dry-run',
        '--min-age',
        '2h'
      ]);
      expect(text.stdout).toMatch(
        /Skipped 1 unreferenced file.* younger than the minimum age/
      );
    });

    it('exits non-zero when the guard refuses', async () => {
      const orphan = await writeStored(2 * HOUR_MS);

      const run = await runCommand(['attachments', 'gc']);

      expect(run.code).toBe(1);
      expect(run.stderr).toMatch(/wrong database/);
      expect(await exists(orphan.file)).toBe(true);
    });

    it('prints a missing-directory warning on stderr and exits 0', async () => {
      const run = await runCommand(['attachments', 'gc'], {
        ATTACHMENTS_DIR: path.join(dir, 'nope')
      });

      expect(run.code).toBe(0);
      expect(run.stderr).toMatch(/does not exist/);
      expect(run.stdout).toContain('Scanned 0 files');
    });

    it.skipIf(IS_ROOT)(
      'exits non-zero when a file cannot be deleted',
      async () => {
        await seedKeeperRow();
        const locked = await writeStored(2 * HOUR_MS);
        await chmod(path.dirname(locked.file), 0o555);

        const run = await runCommand(['--json', 'attachments', 'gc']);

        expect(run.code).toBe(1);
        expect(JSON.parse(run.stdout)).toMatchObject({ errors: 1 });
      }
    );
  });
});
