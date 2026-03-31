import path from 'node:path';

import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { checkTypeAccess, checkVisibilityAccess, requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';

const H1_PATTERN = /^#\s+(.+)$/m;

export function extractTitle(content: string, filePath: string): string {
  const match = H1_PATTERN.exec(content);
  if (match?.[1]) {
    return match[1].trim();
  }

  const basename = path.basename(filePath, path.extname(filePath));
  return basename;
}

type SyncManifestInput = {
  repo: string;
  files: Array<{ path: string; sha: string; content: string }>;
};

type SyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
};

type DocumentSourceRow = {
  id: string;
  entity_id: string;
  path: string;
  sha: string;
  sync_status: string;
};

export type SyncStatusEntry = {
  path: string;
  sha: string;
  syncStatus: string;
  lastSynced: string;
  entityId: string;
};

type SyncStatusRow = {
  path: string;
  sha: string;
  sync_status: string;
  last_synced: Date;
  entity_id: string;
};

function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, {
      cause: error.message
    });
  }

  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

export function syncManifest(
  pool: Pool,
  auth: AuthContext,
  input: SyncManifestInput
): ServiceResult<SyncResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');
      requireScope(auth, 'delete');
      checkTypeAccess(auth, 'document');
      checkVisibilityAccess(auth, 'shared');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const existingRows = await client.query<DocumentSourceRow>(
          'SELECT id, entity_id, path, sha, sync_status FROM document_sources WHERE repo = $1',
          [input.repo]
        );

        const existingByPath = new Map<string, DocumentSourceRow>();
        for (const row of existingRows.rows) {
          existingByPath.set(row.path, row);
        }

        let created = 0;
        let updated = 0;
        let unchanged = 0;

        const incomingPaths = new Set<string>();

        for (const file of input.files) {
          incomingPaths.add(file.path);
          const existing = existingByPath.get(file.path);

          if (!existing) {
            const title = extractTitle(file.content, file.path);
            const entityResult = await client.query<{ id: string }>(
              `
                INSERT INTO entities (type, content, visibility, enrichment_status, metadata)
                VALUES ('document', $1, 'shared', 'pending', $2)
                RETURNING id
              `,
              [
                file.content,
                JSON.stringify({ repo: input.repo, path: file.path, title })
              ]
            );
            const entityId = entityResult.rows[0]?.id;
            if (!entityId) {
              throw new AppError(ErrorCode.INTERNAL, 'Failed to create entity');
            }

            await client.query(
              `
                INSERT INTO document_sources (entity_id, repo, path, sha)
                VALUES ($1, $2, $3, $4)
              `,
              [entityId, input.repo, file.path, file.sha]
            );

            created += 1;
          } else if (existing.sha !== file.sha) {
            const title = extractTitle(file.content, file.path);

            const versionRow = await client.query<{ version: number }>(
              'SELECT version FROM entities WHERE id = $1',
              [existing.entity_id]
            );
            const currentVersion = versionRow.rows[0]?.version ?? 1;

            const updateResult = await client.query(
              `
                UPDATE entities
                SET content = $1,
                    status = NULL,
                    enrichment_status = 'pending',
                    enrichment_attempts = 0,
                    metadata = jsonb_set(
                      jsonb_set(metadata, '{title}', to_jsonb($3::text)),
                      '{path}', to_jsonb($4::text)
                    ),
                    version = version + 1
                WHERE id = $2 AND version = $5
              `,
              [file.content, existing.entity_id, title, file.path, currentVersion]
            );

            if (updateResult.rowCount === 0) {
              throw new AppError(
                ErrorCode.CONFLICT,
                `Version conflict updating synced entity for ${file.path}`
              );
            }

            await client.query('DELETE FROM chunks WHERE entity_id = $1', [
              existing.entity_id
            ]);

            await client.query(
              `
                UPDATE document_sources
                SET sha = $1, last_synced = now(), sync_status = 'current'
                WHERE id = $2
              `,
              [file.sha, existing.id]
            );

            updated += 1;
          } else {
            // Unchanged SHA — restore if previously stale
            if (existing.sync_status === 'stale') {
              await client.query(
                "UPDATE entities SET status = NULL WHERE id = $1",
                [existing.entity_id]
              );
              await client.query(
                "UPDATE document_sources SET last_synced = now(), sync_status = 'current' WHERE id = $1",
                [existing.id]
              );
            } else {
              await client.query(
                'UPDATE document_sources SET last_synced = now() WHERE id = $1',
                [existing.id]
              );
            }
            unchanged += 1;
          }
        }

        let deleted = 0;
        for (const [existingPath, existing] of existingByPath) {
          if (!incomingPaths.has(existingPath) && existing.sync_status !== 'stale') {
            await client.query(
              "UPDATE entities SET status = 'archived' WHERE id = $1",
              [existing.entity_id]
            );
            await client.query(
              "UPDATE document_sources SET sync_status = 'stale', last_synced = now() WHERE id = $1",
              [existing.id]
            );
            deleted += 1;
          }
        }

        await client.query('COMMIT');

        await appendAuditEntry(pool, {
          apiKeyId: auth.apiKeyId,
          operation: 'sync.complete',
          details: { repo: input.repo, created, updated, unchanged, deleted }
        });

        return { created, updated, unchanged, deleted };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to sync manifest')
  );
}

export function getSyncStatus(
  pool: Pool,
  auth: AuthContext,
  repo: string
): ServiceResult<SyncStatusEntry[]> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');
      checkVisibilityAccess(auth, 'shared');

      const rows = await pool.query<SyncStatusRow>(
        `
          SELECT path, sha, sync_status, last_synced, entity_id
          FROM document_sources
          WHERE repo = $1
          ORDER BY path
        `,
        [repo]
      );

      return rows.rows.map((row) => ({
        path: row.path,
        sha: row.sha,
        syncStatus: row.sync_status,
        lastSynced: row.last_synced.toISOString(),
        entityId: row.entity_id
      }));
    })(),
    (error) => toAppError(error, 'Failed to get sync status')
  );
}
