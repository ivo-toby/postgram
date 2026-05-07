import type { Pool, PoolClient } from 'pg';

import type { AttachmentDraft, LoaderResult } from '../../types/loader.js';

import type { AttachmentStore } from './attachment-store.js';
import { flattenLoaderResult, loaderResultToContent } from './flatten.js';
import type { LoaderChunkDraft } from './flatten.js';

export type PersistLoaderResultOptions = {
  pool: Pool;
  attachmentStore: AttachmentStore;
  /**
   * If a transactional client is supplied the writes happen inside the caller's
   * transaction. Otherwise we open one ourselves.
   */
  client?: PoolClient;
};

export type PersistedLoaderResult = {
  chunkDrafts: LoaderChunkDraft[];
  attachmentCount: number;
  contentText: string;
};

/**
 * Apply a LoaderResult to the database for `entityId`:
 * - Writes attachment bytes to the configured store, then upserts an
 *   `attachments` row per draft (deduped by sha256 within the entity).
 * - Updates the entity's content (a flat-text rendering of the blocks),
 *   merges loader metadata, and stamps loader_name + loading_status.
 * - Returns chunk drafts for the embedding pipeline to consume; we do NOT
 *   write to `chunks` here because that table requires the embedding vector,
 *   which is computed downstream.
 */
export async function persistLoaderResult(
  entityId: string,
  loaderName: string,
  result: LoaderResult,
  options: PersistLoaderResultOptions,
): Promise<PersistedLoaderResult> {
  const persisted = await persistAttachments(
    entityId,
    result.attachments ?? [],
    options,
  );

  const contentText = loaderResultToContent(result);
  const drafts = flattenLoaderResult(result);

  const ownClient = !options.client;
  const client = options.client ?? (await options.pool.connect());
  try {
    if (ownClient) await client.query('BEGIN');

    await client.query(
      `
        UPDATE entities
        SET
          content = COALESCE($2, content),
          metadata = metadata || $3::jsonb,
          loader_name = $4,
          loading_status = 'completed',
          loading_error = NULL
        WHERE id = $1
      `,
      [
        entityId,
        contentText.length > 0 ? contentText : null,
        JSON.stringify(result.metadata ?? {}),
        loaderName,
      ],
    );

    if (ownClient) await client.query('COMMIT');
  } catch (err) {
    if (ownClient) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
    }
    throw err;
  } finally {
    if (ownClient) client.release();
  }

  return {
    chunkDrafts: drafts,
    attachmentCount: persisted,
    contentText,
  };
}

async function persistAttachments(
  entityId: string,
  drafts: AttachmentDraft[],
  options: PersistLoaderResultOptions,
): Promise<number> {
  if (drafts.length === 0) return 0;
  let count = 0;
  for (const draft of drafts) {
    const persisted = await options.attachmentStore.put(draft);
    await options.pool.query(
      `
        INSERT INTO attachments
          (entity_id, ref, kind, mime_type, byte_size, sha256, storage_uri, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (entity_id, sha256) DO NOTHING
      `,
      [
        entityId,
        persisted.ref,
        persisted.kind,
        persisted.mimeType,
        persisted.byteSize,
        persisted.sha256,
        persisted.storageUri,
        JSON.stringify(persisted.metadata),
      ],
    );
    count += 1;
  }
  return count;
}
