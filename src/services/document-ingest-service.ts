import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import type { AuthContext } from '../auth/types.js';
import type { Visibility } from '../types/entities.js';
import type { ServiceResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';

import { requireScope, checkVisibilityAccess } from '../auth/key-service.js';

export type IngestDocumentInput =
  | {
      kind: 'bytes';
      bytes: Uint8Array;
      mimeType: string;
      filename?: string;
      visibility?: Visibility;
      owner?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }
  | {
      kind: 'url';
      url: string;
      mimeType?: string;
      visibility?: Visibility;
      owner?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    };

export type IngestDocumentResult = {
  id: string;
  loadingStatus: 'pending';
  status: 'created' | 'exists';
};

export type IngestDocumentOptions = {
  pool: Pool;
  uploadsDir: string;
};

/**
 * Create a `document` entity in `loading_status='pending'`. The enrichment
 * worker picks it up and routes it through the matching loader. Bytes are
 * stashed under `uploadsDir/<entityId>.bin`; URL inputs are stored as
 * `source_uri` only.
 *
 * Idempotent on `source_uri`: re-ingesting the same URL returns the
 * existing entity ID with `status: 'exists'`.
 */
export function ingestDocument(
  auth: AuthContext,
  input: IngestDocumentInput,
  options: IngestDocumentOptions,
): ServiceResult<IngestDocumentResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');
      const visibility = input.visibility ?? 'shared';
      checkVisibilityAccess(auth, visibility);

      const sourceUri =
        input.kind === 'url'
          ? input.url
          : await stashBytesAndBuildUri(input, options);

      const existing = await options.pool.query<{ id: string }>(
        `SELECT id FROM entities WHERE source_uri = $1 LIMIT 1`,
        [sourceUri],
      );
      if (existing.rows[0]) {
        return {
          id: existing.rows[0].id,
          loadingStatus: 'pending' as const,
          status: 'exists' as const,
        };
      }

      const insert = await options.pool.query<{ id: string }>(
        `
          INSERT INTO entities (
            type, content, mime_type, source_uri, visibility, owner, tags,
            metadata, loading_status, enrichment_status
          )
          VALUES ('document', NULL, $1, $2, $3, $4, $5, $6, 'pending', NULL)
          RETURNING id
        `,
        [
          input.kind === 'url'
            ? (input.mimeType ?? null)
            : input.mimeType,
          sourceUri,
          visibility,
          input.owner ?? null,
          input.tags ?? [],
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      const id = insert.rows[0]?.id;
      if (!id) {
        throw new AppError(ErrorCode.INTERNAL, 'failed to create document entity');
      }
      return {
        id,
        loadingStatus: 'pending' as const,
        status: 'created' as const,
      };
    })(),
    (err) => {
      if (err instanceof AppError) return err;
      return new AppError(
        ErrorCode.INTERNAL,
        (err as Error).message ?? 'document ingest failed',
      );
    },
  );
}

async function stashBytesAndBuildUri(
  input: Extract<IngestDocumentInput, { kind: 'bytes' }>,
  options: IngestDocumentOptions,
): Promise<string> {
  await mkdir(options.uploadsDir, { recursive: true });
  // Filename is `<random>.bin` until we know the entity id; we rename to the
  // entity id post-insert in a future iteration. For v1 we use a content-
  // independent random name and rely on source_uri for idempotency.
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const target = path.join(options.uploadsDir, `${random}.bin`);
  await writeFile(target, input.bytes);
  return `file://${target}`;
}
