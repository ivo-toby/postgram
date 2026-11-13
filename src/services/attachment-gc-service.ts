import { stat } from 'node:fs/promises';

import type { Pool } from 'pg';

import { AppError, ErrorCode } from '../util/errors.js';

import { lockIngestSha } from './document-ingest-service.js';
import type { AttachmentStore } from './loaders/attachment-store.js';

export type AttachmentGcOptions = {
  /** Only files whose last modification is older than this are considered. */
  minAgeMs: number;
  dryRun: boolean;
  /**
   * Delete even when the `attachments` table has no rows while the store has
   * files. Without it, that state counts as a wrong-database mistake.
   */
  force?: boolean;
  /** Root of the store, only used to warn when it does not exist. */
  attachmentsDir?: string;
};

export type AttachmentGcReport = {
  dryRun: boolean;
  minAgeMs: number;
  scanned: number;
  orphans: number;
  orphanBytes: number;
  /** Unreferenced files that stayed because they are younger than `minAgeMs`. */
  skippedYoung: number;
  removed: number;
  bytesFreed: number;
  tempFilesRemoved: number;
  /** Files that could not be handled. The run continues past them. */
  errors: number;
  /** The first few error messages. */
  errorMessages: string[];
  /** True when the wrong-database guard stopped a real deletion run. */
  refused: boolean;
  warnings: string[];
};

const MAX_ERROR_MESSAGES = 5;

export function createGcReport(
  options: Pick<AttachmentGcOptions, 'dryRun' | 'minAgeMs'>
): AttachmentGcReport {
  return {
    dryRun: options.dryRun,
    minAgeMs: options.minAgeMs,
    scanned: 0,
    orphans: 0,
    orphanBytes: 0,
    skippedYoung: 0,
    removed: 0,
    bytesFreed: 0,
    tempFilesRemoved: 0,
    errors: 0,
    errorMessages: [],
    refused: false,
    warnings: []
  };
}

function recordError(report: AttachmentGcReport, error: unknown): void {
  report.errors += 1;
  if (report.errorMessages.length < MAX_ERROR_MESSAGES) {
    report.errorMessages.push(
      error instanceof Error ? error.message : String(error)
    );
  }
}

function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ENOENT';
}

async function isReferenced(
  db: Pick<Pool, 'query'>,
  sha256: string
): Promise<boolean> {
  const result = await db.query(
    'SELECT 1 FROM attachments WHERE sha256 = $1 LIMIT 1',
    [sha256]
  );
  return (result.rowCount ?? 0) > 0;
}

async function storeHasFiles(store: AttachmentStore): Promise<boolean> {
  for await (const file of store.listFiles()) {
    void file;
    return true;
  }
  return false;
}

/**
 * Delete stored files that no `attachments` row references.
 *
 * An ingest and the worker's final transaction take `lockIngestSha` before they
 * rely on a file, and hold it until they commit. A delete therefore takes the
 * same lock in its own transaction and checks again for a row inside the lock.
 * Without this, a row could appear right after a first check and lose its file.
 * The minimum age is a second guard for clock and mtime oddities.
 *
 * The caller passes the report so that a run that throws still leaves its
 * partial counts behind.
 */
export async function collectAttachmentGarbage(
  pool: Pool,
  store: AttachmentStore,
  options: AttachmentGcOptions,
  report: AttachmentGcReport = createGcReport(options)
): Promise<AttachmentGcReport> {
  if (options.attachmentsDir !== undefined) {
    try {
      const info = await stat(options.attachmentsDir);
      if (!info.isDirectory()) {
        report.warnings.push(
          `Attachments path is not a directory: ${options.attachmentsDir}`
        );
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      report.warnings.push(
        `Attachments directory does not exist: ${options.attachmentsDir}. Check ATTACHMENTS_DIR.`
      );
    }
  }

  let dryRun = options.dryRun;
  let hasRows: boolean;
  try {
    const tableResult = await pool.query<{ has_rows: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM attachments) AS has_rows'
    );
    hasRows = tableResult.rows[0]!.has_rows;
  } catch (error) {
    // 42P01: undefined_table
    if ((error as { code?: string } | null)?.code === '42P01') {
      throw new AppError(
        ErrorCode.VALIDATION,
        'The attachments table does not exist. Run the database migrations first (start the server once), and check DATABASE_URL.'
      );
    }
    throw error;
  }
  if (!hasRows && (await storeHasFiles(store))) {
    if (!options.force) {
      report.warnings.push(
        'The attachments table has no rows, but the store holds files. This looks like the wrong database or directory. Nothing is deleted. Use --force to delete anyway.'
      );
      if (!options.dryRun) {
        report.refused = true;
        dryRun = true;
      }
    }
  }

  const cutoff = Date.now() - options.minAgeMs;

  for await (const file of store.listFiles()) {
    try {
      const info = await stat(file.path);
      if (!info.isFile()) continue;
      report.scanned += 1;
      const referenced = await isReferenced(pool, file.sha256);
      if (info.mtimeMs > cutoff) {
        if (!referenced) report.skippedYoung += 1;
        continue;
      }
      if (referenced) continue;

      if (dryRun) {
        report.orphans += 1;
        report.orphanBytes += info.size;
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await lockIngestSha(client, file.sha256);
        // A competing ingest may have committed a row while this waited.
        if (await isReferenced(client, file.sha256)) {
          await client.query('COMMIT');
          continue;
        }
        report.orphans += 1;
        report.orphanBytes += info.size;
        if (await store.remove(file.sha256)) {
          report.removed += 1;
          report.bytesFreed += info.size;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (isMissing(error)) continue;
      recordError(report, error);
    }
  }

  if (!dryRun) {
    try {
      report.tempFilesRemoved = await store.removeStaleTempFiles(
        options.minAgeMs
      );
    } catch (error) {
      recordError(report, error);
    }
  }

  return report;
}
