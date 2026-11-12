import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Logger } from 'pino';
import type { Pool, PoolClient } from 'pg';

import type { AuthContext } from '../auth/types.js';
import { createLogger } from '../util/logger.js';
import { chunkText } from './chunking-service.js';
import {
  createEmbeddingService,
  type EmbeddingService
} from './embedding-service.js';
import {
  extractAndLinkRelationships,
  SemanticMatchUnavailableError
} from './extraction-service.js';
import { getMemoryRole } from './memory-role-service.js';
import type { AttachmentStore } from './loaders/attachment-store.js';
import { lockIngestSha } from './document-ingest-service.js';
import { MAX_LOADING_ATTEMPTS } from './document-loading-fields.js';
import { renderLoaderResult } from './loaders/render.js';
import type { LoaderRegistry } from './loaders/registry.js';
import {
  parseLoaderResult,
  type LoaderContext,
  type LoaderLogger,
  type LoaderResult
} from '../types/loader.js';

type PendingEntityRow = {
  id: string;
  type: string;
  content: string;
  metadata: Record<string, unknown>;
  extraction_status: string | null;
};

type PendingExtractionRow = PendingEntityRow & {
  type: string;
  visibility: string;
  owner: string | null;
  extraction_model_override: string | null;
  extraction_provider_override: string | null;
};

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

type CallLlm = (prompt: string, schema?: object) => Promise<string>;

/**
 * Factory used when an entity has an `extraction_model_override` or
 * `extraction_provider_override` set — typically by `pgm-admin
 * improve-graph --model X --provider Y`. Returning a function that builds a
 * `callLlm` lets the worker swap models per-entity without rebuilding
 * provider state on every call (the worker caches the result by
 * `provider:model`). When neither override is set the worker falls back to
 * `options.callLlm` (the env-configured default), so existing tests and
 * deployments don't need to provide a factory.
 */
type CallLlmFactory = (
  provider: string | null,
  model: string | null
) => CallLlm;

export type ExtractionMemoryMode =
  | 'embed_only'
  | 'extract_durable'
  | 'extract_all';

type EnrichmentWorkerOptions = {
  pool: Pool;
  embeddingService?: EmbeddingService;
  extractionEnabled?: boolean;
  extractionMemoryMode?: ExtractionMemoryMode | undefined;
  callLlm?: CallLlm | undefined;
  callLlmFactory?: CallLlmFactory | undefined;
  logger?: Logger;
  autoCreate?: {
    enabled: boolean;
    types: readonly string[];
    minConfidence: number;
    minConfidenceByType?: Readonly<Record<string, number>> | undefined;
  };
  extractionMatchMinSimilarity?: number;
  extractionMinContentChars?: number;
  /**
   * When true, the worker passes a debug callback to extraction that logs
   * raw LLM responses and per-target decisions at info level. Used to
   * diagnose "no person entities" / "edges look wrong" without redeploying
   * with LOG_LEVEL=debug (which is much noisier).
   */
  extractionDebugLog?: boolean;
  semanticNeighbors?: {
    enabled: boolean;
    maxNeighbors?: number;
    minSimilarity?: number;
  };
  /** Document loading stage; it does nothing unless registry and store are both set. */
  loaderRegistry?: LoaderRegistry | undefined;
  attachmentStore?: AttachmentStore | undefined;
  /** Per-call loader timeout in ms. Default 600000. */
  loaderTimeoutMs?: number | undefined;
};

type LoadingEntityRow = {
  id: string;
  mime_type: string | null;
  /** Attempt number set at claim time; doubles as the claim token. */
  loading_attempts: number;
};

type OriginalAttachmentRow = {
  filename: string | null;
  byte_size: string;
  storage_uri: string;
};

const DEFAULT_LOADER_TIMEOUT_MS = 600_000;
const RESERVED_ATTACHMENT_REF = 'original';

class LoadingFailure extends Error {
  constructor(
    message: string,
    readonly loaderName: string | null = null
  ) {
    super(message);
    this.name = 'LoadingFailure';
  }
}

/** PostgreSQL rejects NUL in text and jsonb; strip it from strings and keys. */
function stripNul<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replaceAll('\u0000', '') as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => stripNul(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[stripNul(key)] = stripNul(item);
    }
    return out as T;
  }
  return value;
}

function createLoaderLogger(
  logger: Logger,
  base: Record<string, unknown>
): LoaderLogger {
  const make =
    (level: 'trace' | 'debug' | 'info' | 'warn' | 'error') =>
    (payload: Record<string, unknown> | string, message?: string): void => {
      if (typeof payload === 'string') {
        logger[level](base, payload);
      } else {
        logger[level]({ ...base, ...payload }, message);
      }
    };
  return {
    trace: make('trace'),
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error')
  };
}

async function isInside(dir: string, candidate: string): Promise<boolean> {
  const root = await realpath(dir);
  const real = await realpath(candidate);
  return real === root || real.startsWith(`${root}${path.sep}`);
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure if rollback itself fails.
  }
}

const MAX_ERROR_LENGTH = 2000;

function truncateErrorMessage(error: unknown): string {
  let raw: string;
  if (error instanceof Error) {
    raw = error.message;
  } else if (typeof error === 'string') {
    raw = error;
  } else if (error === null || error === undefined) {
    raw = 'unknown error';
  } else {
    try {
      raw = JSON.stringify(error) ?? 'unknown error';
    } catch {
      raw = 'unknown error';
    }
  }
  return raw.length > MAX_ERROR_LENGTH
    ? `${raw.slice(0, MAX_ERROR_LENGTH)}…`
    : raw;
}

function shouldQueueExtractionForEntity(input: {
  type: string;
  metadata: Record<string, unknown>;
  extractionEnabled?: boolean | undefined;
  extractionMemoryMode?: ExtractionMemoryMode | undefined;
}): boolean {
  if (!input.extractionEnabled) {
    return false;
  }

  if (input.type !== 'memory') {
    return true;
  }

  const mode = input.extractionMemoryMode ?? 'embed_only';
  if (mode === 'extract_all') {
    return true;
  }

  if (mode === 'extract_durable') {
    return getMemoryRole(input.metadata) === 'durable_memory';
  }

  return false;
}

export function createEnrichmentWorker(options: EnrichmentWorkerOptions) {
  if (options.extractionEnabled && !options.callLlm && !options.callLlmFactory) {
    throw new Error(
      'callLlm or callLlmFactory is required when extractionEnabled is true'
    );
  }

  const embeddingService = options.embeddingService ?? createEmbeddingService();
  const logger = options.logger ?? createLogger('info');

  async function hasPendingEnrichment(): Promise<boolean> {
    const result = await options.pool.query(
      `
        SELECT 1
        FROM entities
        WHERE content IS NOT NULL
          AND (
            enrichment_status = 'pending'
            OR (
              enrichment_status = 'failed'
              AND enrichment_attempts < 3
              AND updated_at < now() - interval '5 minutes'
            )
          )
        LIMIT 1
      `
    );

    return Boolean(result.rowCount);
  }

  async function processNextEnrichmentEntity(
    activeModel: Awaited<ReturnType<EmbeddingService['getActiveModel']>>
  ): Promise<boolean> {
    const client = await options.pool.connect();
    let entity: PendingEntityRow | undefined;

    try {
      await client.query('BEGIN');

      const pending = await client.query<PendingEntityRow>(
        `
          SELECT id, type, content, metadata, extraction_status
          FROM entities
          WHERE content IS NOT NULL
            AND (
              enrichment_status = 'pending'
              OR (
                enrichment_status = 'failed'
                AND enrichment_attempts < 3
                AND updated_at < now() - interval '5 minutes'
              )
            )
          ORDER BY
            CASE WHEN enrichment_status = 'pending' THEN 0 ELSE 1 END,
            created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `
      );

      entity = pending.rows[0];
      if (!entity) {
        await rollbackQuietly(client);
        return false;
      }

      const chunks = chunkText(entity.content);
      const embeddings = await embeddingService.embedBatch(
        chunks.map((chunk) => chunk.content),
        activeModel
      );

      await client.query('DELETE FROM chunks WHERE entity_id = $1', [entity.id]);

      for (const chunk of chunks) {
        const embedding = embeddings[chunk.chunkIndex];
        if (!embedding) {
          throw new Error('missing embedding for chunk');
        }

        await client.query(
          `
            INSERT INTO chunks (
              entity_id,
              chunk_index,
              content,
              embedding,
              model_id,
              token_count
            )
            VALUES ($1, $2, $3, $4::vector, $5, $6)
          `,
          [
            entity.id,
            chunk.chunkIndex,
            chunk.content,
            `[${embedding.join(',')}]`,
            activeModel.id,
            chunk.tokenCount
          ]
        );
      }

      const shouldQueueExtraction =
        shouldQueueExtractionForEntity({
          type: entity.type,
          metadata: entity.metadata,
          extractionEnabled: options.extractionEnabled,
          extractionMemoryMode: options.extractionMemoryMode
        });

      if (options.extractionEnabled) {
        await client.query(
          `
            UPDATE entities
            SET enrichment_status = 'completed',
                enrichment_attempts = 0,
                enrichment_error = NULL,
                -- Auto-created stubs only have a name as content. Running
                -- extraction on them prompts the LLM with "what does Alice
                -- relate to?" with no context, which free-associates new
                -- stubs and loops. Skip them.
                -- Re-embedding (model switch, reembed, maintenance job) must not
                -- re-queue extraction for content that was already extracted;
                -- that stays an explicit reextract.
                extraction_status = CASE
                  WHEN extraction_status = 'skipped' THEN 'skipped'
                  WHEN extraction_status IN ('completed', 'failed')
                    AND extraction_content_hash = $3 THEN extraction_status
                  WHEN $2::boolean = false THEN NULL
                  WHEN 'auto-created' = ANY(tags) THEN NULL
                  ELSE 'pending'
                END,
                extraction_error = CASE
                  WHEN extraction_status = 'skipped' THEN extraction_error
                  WHEN extraction_status IN ('completed', 'failed')
                    AND extraction_content_hash = $3 THEN extraction_error
                  ELSE NULL
                END
            WHERE id = $1
          `,
          [entity.id, shouldQueueExtraction, contentHash(entity.content)]
        );
      } else {
        await client.query(
          `
            UPDATE entities
            SET enrichment_status = 'completed',
                enrichment_attempts = 0,
                enrichment_error = NULL
            WHERE id = $1
          `,
          [entity.id]
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await rollbackQuietly(client);

      if (!entity) {
        throw error;
      }

      logger.warn({ err: error, entityId: entity.id }, 'enrichment failed');

      await options.pool.query(
        `
          UPDATE entities
          SET enrichment_status = 'failed',
              enrichment_attempts = enrichment_attempts + 1,
              enrichment_error = $2
          WHERE id = $1
        `,
        [entity.id, truncateErrorMessage(error)]
      );

      return true;
    } finally {
      client.release();
    }
  }

  // Cache of pre-built provider functions, keyed by `provider:model`. This
  // matters when `improve-graph --model X --provider Y --limit 500` queues
  // 500 entities all pointing at the same override — building 500 provider
  // closures (each with its own captured config) is wasteful, and some
  // providers do non-trivial work in their factory (e.g. validating creds).
  const llmCache = new Map<string, CallLlm>();
  const resolveCallLlm = (
    providerOverride: string | null,
    modelOverride: string | null
  ): CallLlm | undefined => {
    if (!providerOverride && !modelOverride) {
      return options.callLlm;
    }
    if (!options.callLlmFactory) {
      // Override columns set but no factory configured. Log once per unique
      // (provider, model) pair so a misconfigured deployment shows up in
      // logs rather than silently degrading to the default model.
      const key = `MISSING_FACTORY:${providerOverride ?? ''}:${modelOverride ?? ''}`;
      if (!llmCache.has(key)) {
        logger.warn(
          { providerOverride, modelOverride },
          'extraction model override set on entity but worker has no callLlmFactory configured — falling back to default'
        );
        // Sentinel so we don't log again.
        llmCache.set(key, options.callLlm ?? (() => Promise.resolve('[]')));
      }
      return options.callLlm;
    }
    const cacheKey = `${providerOverride ?? ''}:${modelOverride ?? ''}`;
    let entry = llmCache.get(cacheKey);
    if (!entry) {
      entry = options.callLlmFactory(providerOverride, modelOverride);
      llmCache.set(cacheKey, entry);
    }
    return entry;
  };

  async function processNextExtractionEntity(
    extractionAuth: AuthContext
  ): Promise<boolean> {
    // Do NOT hold a long row-level `FOR UPDATE` across the LLM call.
    // createEdge (called inside extractAndLinkRelationships) runs on a
    // different pool connection, and its INSERT INTO edges needs a FK
    // share lock on the source entity — which would block forever behind
    // our own transaction's FOR UPDATE lock (no cycle = no deadlock
    // detection = stuck forever). Instead, use a short connection just
    // for a per-entity advisory lock.
    const candidates = await options.pool.query<PendingExtractionRow>(
      `
        SELECT id, content, type, metadata, visibility, owner,
               extraction_model_override, extraction_provider_override
        FROM entities
        WHERE extraction_status = 'pending'
          AND content IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 5
      `
    );

    if (candidates.rows.length === 0) {
      return false;
    }

    const lockClient = await options.pool.connect();
    try {
      for (const entity of candidates.rows) {
        const lockRes = await lockClient.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
          [entity.id]
        );
        if (!lockRes.rows[0]?.locked) {
          continue;
        }

        if (
          !shouldQueueExtractionForEntity({
            type: entity.type,
            metadata: entity.metadata,
            extractionEnabled: options.extractionEnabled,
            extractionMemoryMode: options.extractionMemoryMode
          })
        ) {
          try {
            await options.pool.query(
              `UPDATE entities
               SET extraction_status = NULL,
                   extraction_error = NULL,
                   extraction_model_override = NULL,
                   extraction_provider_override = NULL
               WHERE id = $1
                 AND extraction_status = 'pending'`,
              [entity.id]
            );
          } finally {
            await lockClient
              .query('SELECT pg_advisory_unlock(hashtext($1))', [entity.id])
              .catch(() => undefined);
          }
          return true;
        }

        const entityCallLlm = resolveCallLlm(
          entity.extraction_provider_override,
          entity.extraction_model_override
        );

        try {
          await extractAndLinkRelationships(
            options.pool,
            extractionAuth,
            {
              id: entity.id,
              type: entity.type,
              content: entity.content,
              visibility: entity.visibility,
              owner: entity.owner
            },
            {
              ...(entityCallLlm ? { callLlm: entityCallLlm } : {}),
              ...(options.autoCreate ? { autoCreate: options.autoCreate } : {}),
              embeddingService,
              ...(options.extractionMatchMinSimilarity !== undefined
                ? { matchMinSimilarity: options.extractionMatchMinSimilarity }
                : {}),
              ...(options.extractionMinContentChars !== undefined
                ? { minContentChars: options.extractionMinContentChars }
                : {}),
              ...(options.extractionDebugLog
                ? {
                    debugLog: (event, payload) =>
                      logger.info({ event, ...payload }, event)
                  }
                : {}),
              ...(options.semanticNeighbors
                ? { semanticNeighbors: options.semanticNeighbors }
                : {})
            }
          );
          // Clear the override columns on success so the next time this
          // entity is re-queued (e.g. via plain `reextract`), it falls back
          // to the env-configured default model rather than silently
          // continuing with the per-run override forever.
          await options.pool.query(
            `UPDATE entities
             SET extraction_status = 'completed',
                 extraction_error = NULL,
                 extraction_content_hash = $2,
                 extraction_model_override = NULL,
                 extraction_provider_override = NULL
             WHERE id = $1`,
            [entity.id, contentHash(entity.content)]
          );
        } catch (error) {
          if (error instanceof SemanticMatchUnavailableError) {
            // Leave extraction_status = 'pending' AND the override columns
            // so the next poll retries with the same model. Any edges
            // already linked in this pass are committed (createEdge upserts
            // on conflict, so the retry is idempotent).
            logger.warn(
              { entityId: entity.id, linkedSoFar: error.linkedSoFar },
              'extraction deferred — embeddings unavailable, will retry'
            );
          } else {
            logger.warn(
              { err: error, entityId: entity.id },
              'extraction failed'
            );
            // Don't clear override columns here either — operator may want
            // the failure mode investigated against the same model.
            await options.pool.query(
              "UPDATE entities SET extraction_status = 'failed', extraction_error = $2, extraction_content_hash = $3 WHERE id = $1",
              [entity.id, truncateErrorMessage(error), contentHash(entity.content)]
            );
          }
        } finally {
          await lockClient
            .query('SELECT pg_advisory_unlock(hashtext($1))', [entity.id])
            .catch(() => undefined);
        }
        return true;
      }
      return false;
    } finally {
      lockClient.release();
    }
  }

  /** Running rows older than this are treated as abandoned. */
  function staleRunningMs(): number {
    const timeoutMs = options.loaderTimeoutMs ?? DEFAULT_LOADER_TIMEOUT_MS;
    return Math.max(15 * 60 * 1000, timeoutMs + 5 * 60 * 1000);
  }

  async function sweepInterruptedLoads(): Promise<void> {
    await options.pool.query(
      `
        UPDATE entities
        SET loading_status = 'failed',
            loading_error = 'interrupted: worker stopped during load'
        WHERE loading_status = 'running'
          AND loading_attempts >= $2
          AND updated_at < now() - ($1::bigint * interval '1 millisecond')
      `,
      [staleRunningMs(), MAX_LOADING_ATTEMPTS]
    );
  }

  async function claimLoadingEntity(): Promise<LoadingEntityRow | undefined> {
    const client = await options.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query<LoadingEntityRow>(
        `
          SELECT id, mime_type, loading_attempts
          FROM entities
          WHERE loading_status = 'pending'
            OR (loading_status = 'failed' AND loading_attempts < $2
                AND updated_at < now() - interval '5 minutes')
            OR (loading_status = 'running' AND loading_attempts < $2
                AND updated_at < now() - ($1::bigint * interval '1 millisecond'))
          ORDER BY
            CASE WHEN loading_status = 'pending' THEN 0 ELSE 1 END,
            created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
        [staleRunningMs(), MAX_LOADING_ATTEMPTS]
      );
      const row = claimed.rows[0];
      if (!row) {
        await rollbackQuietly(client);
        return undefined;
      }
      const updated = await client.query<{ loading_attempts: number }>(
        `
          UPDATE entities
          SET loading_status = 'running',
              loading_attempts = loading_attempts + 1
          WHERE id = $1
          RETURNING loading_attempts
        `,
        [row.id]
      );
      await client.query('COMMIT');
      return { ...row, loading_attempts: updated.rows[0]!.loading_attempts };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async function markLoadingFailed(
    entityId: string,
    token: number,
    loaderName: string | null,
    error: unknown
  ): Promise<void> {
    const message = truncateErrorMessage(error);
    const text = loaderName ? `${loaderName}: ${message}` : message;
    // The attempt was counted at claim time; only the current claim may fail it.
    const result = await options.pool.query(
      `
        UPDATE entities
        SET loading_status = 'failed',
            loading_error = $2
        WHERE id = $1
          AND loading_status = 'running'
          AND loading_attempts = $3
      `,
      [entityId, stripNul(truncateErrorMessage(text)), token]
    );
    if (result.rowCount === 0) {
      logger.warn({ entityId }, 'lost claim; failure not recorded');
    }
  }

  async function readDraftBytes(
    source: NonNullable<LoaderResult['attachments']>[number]['source'],
    tmpDir: string
  ): Promise<Uint8Array> {
    if (source.kind === 'bytes') {
      return source.bytes;
    }
    let resolved: string | undefined;
    try {
      resolved = await realpath(source.path);
      if (!(await isInside(tmpDir, resolved))) resolved = undefined;
    } catch {
      resolved = undefined;
    }
    if (!resolved) {
      throw new Error(
        'attachment path is outside the loader temp directory or unreadable'
      );
    }
    return readFile(resolved);
  }

  async function runLoaderWithTimeout(
    run: (signal: AbortSignal) => Promise<unknown>,
    timeoutMs: number
  ): Promise<unknown> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`loader timed out after ${timeoutMs} ms`);
        controller.abort(err);
        reject(err);
      }, timeoutMs);
    });
    try {
      const call = Promise.resolve().then(() => run(controller.signal));
      // If the timeout wins, the loader promise may still reject later.
      call.catch(() => undefined);
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function processNextLoadingEntity(): Promise<boolean> {
    const registry = options.loaderRegistry;
    const store = options.attachmentStore;
    if (!registry || !store) {
      return false;
    }

    await sweepInterruptedLoads();
    const entity = await claimLoadingEntity();
    if (!entity) {
      return false;
    }

    const startedAt = Date.now();
    let loaderName: string | null = null;
    let mimeType = entity.mime_type;
    let bytesIn = 0;
    let tmpDir: string | undefined;

    try {
      const originalResult = await options.pool.query<OriginalAttachmentRow>(
        `
          SELECT filename, byte_size::text AS byte_size, storage_uri
          FROM attachments
          WHERE entity_id = $1 AND role = 'original'
        `,
        [entity.id]
      );
      const original = originalResult.rows[0];
      if (!original) {
        throw new LoadingFailure('original attachment row is missing');
      }
      bytesIn = Number(original.byte_size);

      let localPath: string;
      try {
        localPath = store.resolvePath(original.storage_uri);
        await stat(localPath);
      } catch {
        throw new LoadingFailure(
          `original attachment file is missing on disk (${original.storage_uri})`
        );
      }

      const resolution = registry.resolveByTypeOrName({
        mimeType: entity.mime_type ?? undefined,
        filename: original.filename ?? undefined
      });
      if (!resolution.ok) {
        throw new LoadingFailure(
          `${resolution.error.code}: ${resolution.error.reason}`
        );
      }
      const { entry } = resolution;
      loaderName = entry.config.name;
      mimeType = entity.mime_type ?? resolution.mimeType;

      tmpDir = await mkdtemp(path.join(tmpdir(), 'pgm-loader-'));
      const callTmpDir = tmpDir;
      const loaderLogger = createLoaderLogger(logger, {
        loader: loaderName,
        entityId: entity.id
      });
      const timeoutMs = options.loaderTimeoutMs ?? DEFAULT_LOADER_TIMEOUT_MS;

      const raw = await runLoaderWithTimeout((signal) => {
        const ctx: LoaderContext = {
          tmpDir: callTmpDir,
          logger: loaderLogger,
          fetch: (url, init) =>
            fetch(url, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, signal])
                : signal
            }),
          options: entry.config.options,
          signal
        };
        return entry.loader.load(
          {
            kind: 'localPath',
            path: localPath,
            mimeType: mimeType ?? 'application/octet-stream',
            ...(original.filename ? { filename: original.filename } : {})
          },
          ctx
        );
      }, timeoutMs);

      const result = parseLoaderResult(raw);

      const drafts = result.attachments ?? [];
      const seenRefs = new Set<string>();
      const storedDerived: {
        ref: string;
        kind: string;
        mimeType: string;
        metadata: Record<string, unknown>;
        sha256: string;
        byteSize: number;
        storageUri: string;
      }[] = [];
      for (const draft of drafts) {
        if (draft.ref === RESERVED_ATTACHMENT_REF) {
          throw new Error(
            `attachment ref "${RESERVED_ATTACHMENT_REF}" is reserved`
          );
        }
        if (seenRefs.has(draft.ref)) {
          throw new Error(`duplicate attachment ref "${draft.ref}"`);
        }
        seenRefs.add(draft.ref);
        const bytes = await readDraftBytes(draft.source, callTmpDir);
        const put = await store.put(bytes);
        storedDerived.push({
          ref: draft.ref,
          kind: draft.kind,
          mimeType: draft.mimeType,
          metadata: stripNul(draft.metadata ?? {}),
          sha256: put.sha256,
          byteSize: put.byteSize,
          storageUri: put.storageUri
        });
      }

      const rendered = stripNul(renderLoaderResult(result));
      const hasText = rendered.trim() !== '';
      const loaderMetadata = stripNul({
        documentType: result.documentType,
        ...(result.metadata ?? {})
      });

      const client = await options.pool.connect();
      try {
        await client.query('BEGIN');
        // `attachments gc` takes the same per-hash lock before it deletes a
        // file. Holding it here, and checking the file inside the lock, means
        // gc cannot remove a derived file between the put above and this
        // commit. A missing file fails the load so that the retry writes it again.
        const derivedShas = [...new Set(storedDerived.map((d) => d.sha256))];
        derivedShas.sort();
        for (const sha of derivedShas) {
          await lockIngestSha(client, sha);
        }
        for (const d of storedDerived) {
          try {
            await stat(store.resolvePath(d.storageUri));
          } catch {
            throw new LoadingFailure(
              `derived attachment file is missing on disk (${d.storageUri})`,
              loaderName
            );
          }
        }
        const finalized = await client.query(
          `
            UPDATE entities
            SET content = $2,
                metadata = jsonb_set(metadata, '{loader}', $3::jsonb, true),
                loader_name = $4,
                loading_status = 'completed',
                loading_error = NULL,
                enrichment_status = CASE WHEN $5::boolean THEN 'pending' ELSE 'completed' END,
                enrichment_attempts = CASE WHEN $5::boolean THEN 0 ELSE enrichment_attempts END,
                enrichment_error = CASE WHEN $5::boolean THEN NULL ELSE enrichment_error END
            WHERE id = $1
              AND loading_status = 'running'
              AND loading_attempts = $6
          `,
          [
            entity.id,
            hasText ? rendered : null,
            JSON.stringify(loaderMetadata),
            loaderName,
            hasText,
            entity.loading_attempts
          ]
        );
        if (finalized.rowCount === 0) {
          await rollbackQuietly(client);
          logger.warn(
            { loader: loaderName, entityId: entity.id },
            'lost claim; loader result discarded'
          );
          return true;
        }
        if (!hasText) {
          await client.query('DELETE FROM chunks WHERE entity_id = $1', [
            entity.id
          ]);
        }
        await client.query(
          "DELETE FROM attachments WHERE entity_id = $1 AND role = 'derived'",
          [entity.id]
        );
        for (const d of storedDerived) {
          await client.query(
            `
              INSERT INTO attachments (
                entity_id, role, ref, kind, mime_type,
                byte_size, sha256, storage_uri, metadata
              )
              VALUES ($1, 'derived', $2, $3, $4, $5, $6, $7, $8::jsonb)
            `,
            [
              entity.id,
              d.ref,
              d.kind,
              d.mimeType,
              d.byteSize,
              d.sha256,
              d.storageUri,
              JSON.stringify(d.metadata)
            ]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }

      logger.info(
        {
          loader: loaderName,
          entityId: entity.id,
          mimeType,
          bytesIn,
          textChars: rendered.length,
          attachmentsOut: storedDerived.length,
          durationMs: Date.now() - startedAt,
          status: 'completed'
        },
        'loader call finished'
      );
    } catch (error) {
      const failureLoader =
        error instanceof LoadingFailure ? error.loaderName : loaderName;
      logger.warn(
        {
          err: error,
          loader: failureLoader,
          entityId: entity.id,
          mimeType,
          bytesIn,
          textChars: 0,
          attachmentsOut: 0,
          durationMs: Date.now() - startedAt,
          status: 'failed'
        },
        'loader call finished'
      );
      await markLoadingFailed(
        entity.id,
        entity.loading_attempts,
        failureLoader,
        error
      );
    } finally {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true }).catch(
          () => undefined
        );
      }
    }
    return true;
  }

  return {
    async runOnce(): Promise<number> {
      let processed = 0;

      // At most one loading row per pass, so ordinary entities keep flowing.
      if (await processNextLoadingEntity()) {
        processed += 1;
      }

      if (await hasPendingEnrichment()) {
        const activeModel = await embeddingService.getActiveModel(options.pool);

        while (await processNextEnrichmentEntity(activeModel)) {
          processed += 1;
        }
      }

      if (options.extractionEnabled) {
        const extractionAuth: AuthContext = {
          apiKeyId: null,
          keyName: 'system-extraction',
          clientId: null,
          scopes: ['read', 'write', 'delete'] as const,
          allowedTypes: null,
          allowedVisibility: ['personal', 'work', 'shared'] as const
        };

        while (await processNextExtractionEntity(extractionAuth)) {
          processed += 1;
        }
      }

      return processed;
    }
  };
}
