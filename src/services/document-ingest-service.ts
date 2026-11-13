import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { ResultAsync } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import {
  checkTypeAccess,
  checkVisibilityAccess,
  requireScope
} from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type { LoadingStatus, Visibility } from '../types/entities.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { MAX_LOADING_ATTEMPTS } from './document-loading-fields.js';
import { recallEntity } from './entity-service.js';
import type { AttachmentStore } from './loaders/attachment-store.js';
import type { LoaderRegistry } from './loaders/registry.js';
import { normalizeOwner } from './owner-filter.js';

export const MAX_FILENAME_LENGTH = 255;

export type IngestInput = {
  bytes: Uint8Array;
  filename?: string | undefined;
  mimeType?: string | undefined;
  title?: string | undefined;
  visibility?: Visibility | undefined;
  owner?: string | null | undefined;
  tags?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type IngestDeps = {
  pool: Pool;
  registry: LoaderRegistry;
  attachmentStore: AttachmentStore;
};

export type IngestResult = {
  id: string;
  status: 'created' | 'exists';
  loadingStatus: LoadingStatus;
};

export type Attachment = {
  id: string;
  entityId: string;
  role: 'original' | 'derived';
  ref: string;
  kind: 'document' | 'image' | 'audio' | 'video' | 'binary';
  mimeType: string;
  filename: string | null;
  byteSize: number;
  sha256: string;
  createdAt: string;
};

export type AttachmentDownload = {
  attachment: Attachment;
  /** Opens the stored bytes. Throws (ENOENT on read) when the file is gone. */
  openStream: () => Readable;
};

type AttachmentRow = {
  id: string;
  entity_id: string;
  role: Attachment['role'];
  ref: string;
  kind: Attachment['kind'];
  mime_type: string;
  filename: string | null;
  byte_size: string | number;
  sha256: string;
  storage_uri: string;
  created_at: Date;
};

const ATTACHMENT_COLUMNS = `
  id, entity_id, role, ref, kind, mime_type, filename,
  byte_size, sha256, storage_uri, created_at
`;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * The filename is metadata only. Keep the last path segment (both `/` and
 * `\` separate segments), drop control characters, cap the length. Returns
 * undefined when nothing usable is left.
 */
export function sanitizeFilename(
  filename: string | undefined
): string | undefined {
  if (filename === undefined) {
    return undefined;
  }
  const segments = filename.split(/[\\/]/);
  const base = segments[segments.length - 1] ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  const capped = Array.from(cleaned).slice(0, MAX_FILENAME_LENGTH).join('');
  if (capped === '' || capped === '.' || capped === '..') {
    return undefined;
  }
  return capped;
}

function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    entityId: row.entity_id,
    role: row.role,
    ref: row.ref,
    kind: row.kind,
    mimeType: row.mime_type,
    filename: row.filename,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    createdAt: row.created_at.toISOString()
  };
}

type ExistingRow = {
  id: string;
  loading_status: LoadingStatus | null;
  loading_attempts: number;
};

async function findExisting(
  client: PoolClient,
  sha256: string,
  owner: string | null,
  visibility: Visibility
): Promise<ExistingRow | undefined> {
  const result = await client.query<ExistingRow>(
    `
      SELECT e.id, e.loading_status, e.loading_attempts
      FROM attachments a
      JOIN entities e ON e.id = a.entity_id
      WHERE a.role = 'original'
        AND a.sha256 = $1
        AND e.owner IS NOT DISTINCT FROM $2
        AND e.visibility = $3
        AND e.status IS DISTINCT FROM 'archived'
      ORDER BY e.created_at ASC
      LIMIT 1
    `,
    [sha256, owner, visibility]
  );
  return result.rows[0];
}

/**
 * Transaction-scoped advisory lock for one content hash. Ingest takes it
 * around the lookup, the file write and the insert; garbage collection takes
 * the same lock before it deletes a file.
 */
export async function lockIngestSha(
  client: PoolClient,
  sha256: string
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('ingest:' || $1::text))",
    [sha256]
  );
}

export function ingestDocument(
  auth: AuthContext,
  input: IngestInput,
  deps: IngestDeps
): ServiceResult<IngestResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');
      checkTypeAccess(auth, 'document');
      if (input.bytes.byteLength === 0) {
        throw new AppError(ErrorCode.VALIDATION, 'file is empty');
      }
      const visibility = input.visibility ?? 'shared';
      checkVisibilityAccess(auth, visibility);
      const owner = normalizeOwner(input.owner);

      const filename = sanitizeFilename(input.filename);
      const resolution = deps.registry.resolveByTypeOrName({
        mimeType: input.mimeType,
        filename
      });
      if (!resolution.ok) {
        const accepted = deps.registry.acceptedTypes();
        throw new AppError(
          ErrorCode.UNSUPPORTED_MEDIA_TYPE,
          'No document loader accepts this file type',
          {
            accepted: {
              mime_types: accepted.mimeTypes,
              extensions: accepted.extensions
            }
          }
        );
      }
      const mimeType = resolution.mimeType;
      const sha256 = createHash('sha256').update(input.bytes).digest('hex');

      const client = await deps.pool.connect();
      try {
        await client.query('BEGIN');
        await lockIngestSha(client, sha256);

        const existing = await findExisting(client, sha256, owner, visibility);
        if (existing) {
          // Cheap when the file is intact; restores a lost or truncated one.
          await deps.attachmentStore.put(input.bytes);
          let requeued = false;
          let loadingStatus: LoadingStatus =
            existing.loading_status ?? 'pending';
          if (
            existing.loading_status === 'failed' &&
            existing.loading_attempts >= MAX_LOADING_ATTEMPTS
          ) {
            await client.query(
              `
                UPDATE entities
                SET loading_status = 'pending',
                    loading_attempts = 0,
                    loading_error = NULL
                WHERE id = $1
              `,
              [existing.id]
            );
            loadingStatus = 'pending';
            requeued = true;
          }
          await appendAuditEntry(client, {
            apiKeyId: auth.apiKeyId,
            operation: 'document.ingest',
            entityId: existing.id,
            details: {
              type: 'document',
              status: 'exists',
              sha256,
              ...(requeued ? { requeued: true } : {})
            }
          });
          await client.query('COMMIT');
          return {
            id: existing.id,
            status: 'exists' as const,
            loadingStatus
          };
        }

        const stored = await deps.attachmentStore.put(input.bytes);
        const title =
          input.title !== undefined && input.title.trim() !== ''
            ? input.title
            : (filename ?? 'Untitled document');
        const metadata: Record<string, unknown> = {
          ...(input.metadata ?? {}),
          title,
          ...(filename !== undefined ? { filename } : {})
        };

        const entity = await client.query<{ id: string }>(
          `
            INSERT INTO entities (
              type, content, visibility, owner, enrichment_status,
              tags, source, metadata, mime_type, loading_status
            )
            VALUES ('document', NULL, $1, $2, NULL, $3, 'ingest', $4, $5, 'pending')
            RETURNING id
          `,
          [visibility, owner, input.tags ?? [], metadata, mimeType]
        );
        const entityId = entity.rows[0]?.id;
        if (!entityId) {
          throw new AppError(ErrorCode.INTERNAL, 'Failed to store document');
        }

        await client.query(
          `
            INSERT INTO attachments (
              entity_id, role, ref, kind, mime_type, filename,
              byte_size, sha256, storage_uri
            )
            VALUES ($1, 'original', 'original', 'document', $2, $3, $4, $5, $6)
          `,
          [
            entityId,
            mimeType,
            filename ?? null,
            stored.byteSize,
            stored.sha256,
            stored.storageUri
          ]
        );
        await appendAuditEntry(client, {
          apiKeyId: auth.apiKeyId,
          operation: 'document.ingest',
          entityId,
          details: { type: 'document', status: 'created', sha256 }
        });
        await client.query('COMMIT');
        return {
          id: entityId,
          status: 'created' as const,
          loadingStatus: 'pending' as const
        };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Keep the original failure.
        }
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to ingest document')
  );
}

/** Attachments of an entity, under the same access rules as reading the entity. */
export function listAttachments(
  auth: AuthContext,
  entityId: string,
  deps: { pool: Pool }
): ServiceResult<Attachment[]> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');
      const entity = await recallEntity(deps.pool, auth, entityId);
      if (entity.isErr()) {
        throw entity.error;
      }
      const result = await deps.pool.query<AttachmentRow>(
        `
          SELECT ${ATTACHMENT_COLUMNS}
          FROM attachments
          WHERE entity_id = $1
          ORDER BY (role = 'original') DESC, created_at ASC, ref ASC
        `,
        [entityId]
      );
      return result.rows.map(mapAttachment);
    })(),
    (error) => toAppError(error, 'Failed to list attachments')
  );
}

/** One attachment plus a stream opener, under the entity's read access rules. */
export function getAttachmentForDownload(
  auth: AuthContext,
  attachmentId: string,
  deps: { pool: Pool; attachmentStore: AttachmentStore }
): ServiceResult<AttachmentDownload> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');
      if (!UUID_RE.test(attachmentId)) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Attachment not found');
      }
      const result = await deps.pool.query<AttachmentRow>(
        `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE id = $1`,
        [attachmentId]
      );
      const row = result.rows[0];
      if (!row) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Attachment not found');
      }
      const entity = await recallEntity(deps.pool, auth, row.entity_id);
      if (entity.isErr()) {
        throw entity.error;
      }
      const storageUri = row.storage_uri;
      return {
        attachment: mapAttachment(row),
        openStream: () => deps.attachmentStore.openReadStream(storageUri)
      };
    })(),
    (error) => toAppError(error, 'Failed to read attachment')
  );
}
