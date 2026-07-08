import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import type { Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';
import { z } from 'zod';

import {
  createActiveAdminMiddleware,
  createAdminSessionMiddleware,
  setAdminNoStoreHeaders,
  type AdminRequestContext
} from '../auth/admin-middleware.js';
import type { AppConfig } from '../config.js';
import { checkDatabaseHealth, createPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import {
  createAdminBackupArchive,
  prepareAdminBackupRestore,
  stageAdminBackupRestore,
  type AdminBackupRestoreVerifier,
  type ValidatedAdminBackupRestore,
  type AdminBackupCommandRunner
} from '../services/admin-backup-service.js';
import {
  AppError,
  ErrorCode,
  toErrorResponse,
  toHttpStatus
} from '../util/errors.js';

type AdminBackupApp = Hono<{
  Variables: {
    admin: AdminRequestContext;
  };
}>;

export type AdminBackupRouteOptions = {
  runtimeConfig?: AppConfig | undefined;
  backupCommandRunner?: AdminBackupCommandRunner | undefined;
  backupRestoreVerifier?: AdminBackupRestoreVerifier | undefined;
  pgDumpPath?: string | undefined;
  pgRestorePath?: string | undefined;
  createdbPath?: string | undefined;
  dropdbPath?: string | undefined;
  tarPath?: string | undefined;
};

const emptyBodySchema = z.object({}).strict();
const restoreStageBodySchema = z
  .object({
    restoreToken: z.string().uuid(),
    confirmation: z.literal('RESTORE TO STAGING')
  })
  .strict();
const RESTORE_TOKEN_TTL_MS = 30 * 60 * 1000;
const restoreTokens = new Map<
  string,
  {
    restore: ValidatedAdminBackupRestore;
    adminUserId: string;
    expiresAtMs: number;
  }
>();

function parseJsonBody<T>(schema: z.ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new AppError(
      ErrorCode.VALIDATION,
      parsed.error.issues[0]?.message ?? 'Invalid request'
    );
  }

  return parsed.data;
}

async function readOptionalJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(ErrorCode.VALIDATION, 'Expected JSON request body');
  }
}

function jsonError(c: Context, error: AppError, status?: ContentfulStatusCode) {
  return c.json(
    toErrorResponse(error),
    status ?? (toHttpStatus(error.code) as ContentfulStatusCode)
  );
}

function cleanupOnStreamClose(
  stream: Readable,
  cleanup: () => Promise<void>
): void {
  let cleaned = false;
  const runCleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    void cleanup().catch(() => undefined);
  };

  stream.once('close', runCleanup);
  stream.once('error', runCleanup);
}

async function defaultRestoreVerifier(input: {
  databaseUrl: string;
}): Promise<{
  migrations: 'passed';
  health: 'connected';
}> {
  const stagingPool = createPool(input.databaseUrl);
  try {
    await runMigrations(stagingPool);
    const health = await checkDatabaseHealth(stagingPool);
    if (health !== 'connected') {
      throw new AppError(
        ErrorCode.INTERNAL,
        'Restored staging database health check failed'
      );
    }
    return {
      migrations: 'passed',
      health: 'connected'
    };
  } finally {
    await stagingPool.end();
  }
}

function cleanupExpiredRestoreTokens(nowMs = Date.now()): void {
  for (const [token, pending] of restoreTokens.entries()) {
    if (pending.expiresAtMs <= nowMs) {
      restoreTokens.delete(token);
      void pending.restore.cleanup().catch(() => undefined);
    }
  }
}

function storeRestoreToken(
  restore: ValidatedAdminBackupRestore,
  adminUserId: string
): void {
  cleanupExpiredRestoreTokens();
  restoreTokens.set(restore.token, {
    restore,
    adminUserId,
    expiresAtMs: Date.parse(restore.expiresAt)
  });
}

function takeRestoreToken(
  token: string,
  adminUserId: string
): ValidatedAdminBackupRestore {
  cleanupExpiredRestoreTokens();
  const pending = restoreTokens.get(token);
  if (!pending) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Backup restore validation token is expired or unknown'
    );
  }
  if (pending.adminUserId !== adminUserId) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'Backup restore validation token belongs to a different admin session'
    );
  }
  restoreTokens.delete(token);
  return pending.restore;
}

function isUploadedFile(value: unknown): value is {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as { name?: unknown }).name === 'string' &&
    'arrayBuffer' in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

async function readUploadedBackupFile(c: Context): Promise<{
  filename: string;
  data: Buffer;
}> {
  const form = await c.req.parseBody();
  const backup = form.backup;
  if (!isUploadedFile(backup)) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Backup archive file is required'
    );
  }

  return {
    filename: backup.name,
    data: Buffer.from(await backup.arrayBuffer())
  };
}

async function writeBackupAudit(
  pool: Pool,
  input: {
    adminUserId: string;
    operation: string;
    details: Record<string, unknown>;
  }
): Promise<void> {
  await pool.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        admin_user_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, $2, NULL, $3)
    `,
    [
      input.adminUserId,
      input.operation,
      input.details
    ]
  );
}

export function registerAdminBackupRoutes(
  app: AdminBackupApp,
  pool: Pool,
  options: AdminBackupRouteOptions = {}
): void {
  app.post(
    '/admin/api/backups/download',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware({ requireStepUp: true }),
    async (c) => {
      setAdminNoStoreHeaders(c);
      parseJsonBody(emptyBodySchema, await readOptionalJson(c));

      if (!options.runtimeConfig?.DATABASE_URL) {
        return jsonError(
          c,
          new AppError(
            ErrorCode.INTERNAL,
            'Runtime DATABASE_URL is required for admin backup'
          )
        );
      }

      const admin = c.get('admin');
      const archive = await createAdminBackupArchive({
        databaseUrl: options.runtimeConfig.DATABASE_URL,
        runtimeConfig: options.runtimeConfig,
        commandRunner: options.backupCommandRunner,
        pgDumpPath: options.pgDumpPath,
        tarPath: options.tarPath
      });

      try {
        await writeBackupAudit(pool, {
          adminUserId: admin.user.id,
          operation: 'admin.backup.download',
          details: {
            filename: archive.filename,
            generatedAt: archive.generatedAt,
            sizeBytes: archive.sizeBytes
          }
        });

        const body = createReadStream(archive.filePath);
        cleanupOnStreamClose(body, archive.cleanup);
        c.header('Content-Type', 'application/gzip');
        c.header(
          'Content-Disposition',
          `attachment; filename="${archive.filename}"`
        );
        c.header('Content-Length', String(archive.sizeBytes));
        return c.body(
          Readable.toWeb(body) as ReadableStream<Uint8Array>,
          200
        );
      } catch (error) {
        await archive.cleanup();
        throw error;
      }
    }
  );

  app.post(
    '/admin/api/backups/restore/validate',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware(),
    async (c) => {
      setAdminNoStoreHeaders(c);

      if (!options.runtimeConfig?.DATABASE_URL) {
        return jsonError(
          c,
          new AppError(
            ErrorCode.INTERNAL,
            'Runtime DATABASE_URL is required for admin backup restore'
          )
        );
      }

      const admin = c.get('admin');
      const upload = await readUploadedBackupFile(c);
      const restore = await prepareAdminBackupRestore({
        filename: upload.filename,
        data: upload.data,
        databaseUrl: options.runtimeConfig.DATABASE_URL,
        commandRunner: options.backupCommandRunner,
        tarPath: options.tarPath,
        pgRestorePath: options.pgRestorePath,
        tokenTtlMs: RESTORE_TOKEN_TTL_MS
      });
      storeRestoreToken(restore, admin.user.id);

      await writeBackupAudit(pool, {
        adminUserId: admin.user.id,
        operation: 'admin.backup.restore.validate',
        details: {
          filename: upload.filename,
          restoreToken: restore.token,
          stagingDatabaseName: restore.stagingDatabaseName,
          sourceDatabase: restore.sourceDatabase.name,
          manifest: restore.manifest,
          validation: restore.validation
        }
      });

      return c.json({
        restore: {
          token: restore.token,
          expiresAt: restore.expiresAt,
          manifest: restore.manifest,
          sourceDatabase: restore.sourceDatabase,
          stagingDatabaseName: restore.stagingDatabaseName,
          validation: restore.validation,
          switchOver: restore.switchOver
        }
      });
    }
  );

  app.post(
    '/admin/api/backups/restore/stage',
    createAdminSessionMiddleware({ pool }),
    createActiveAdminMiddleware({ requireStepUp: true }),
    async (c) => {
      setAdminNoStoreHeaders(c);
      const body = parseJsonBody(restoreStageBodySchema, await readOptionalJson(c));

      if (!options.runtimeConfig?.DATABASE_URL) {
        return jsonError(
          c,
          new AppError(
            ErrorCode.INTERNAL,
            'Runtime DATABASE_URL is required for admin backup restore'
          )
        );
      }

      const admin = c.get('admin');
      const restore = takeRestoreToken(body.restoreToken, admin.user.id);
      const staged = await stageAdminBackupRestore({
        restore,
        databaseUrl: options.runtimeConfig.DATABASE_URL,
        commandRunner: options.backupCommandRunner,
        verifier: options.backupRestoreVerifier ?? defaultRestoreVerifier,
        createdbPath: options.createdbPath,
        dropdbPath: options.dropdbPath,
        pgRestorePath: options.pgRestorePath
      });

      await writeBackupAudit(pool, {
        adminUserId: admin.user.id,
        operation: 'admin.backup.restore.stage',
        details: {
          stagingDatabaseName: staged.stagingDatabaseName,
          sourceDatabase: staged.sourceDatabase.name,
          verification: staged.verification
        }
      });

      return c.json({
        restore: staged
      });
    }
  );
}
