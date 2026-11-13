import { Readable } from 'node:stream';

import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { AuthContext } from '../auth/types.js';
import { checkTypeAccess, requireScope } from '../auth/key-service.js';
import type { EmbeddingService } from '../services/embedding-service.js';
import { createEdge, deleteEdge, listEdges, expandGraph } from '../services/edge-service.js';
import {
  getAttachmentForDownload,
  ingestDocument,
  listAttachments,
  type Attachment
} from '../services/document-ingest-service.js';
import { toLoadingResponseFields } from '../services/document-loading-fields.js';
import { getEntityEmbeddings } from '../services/embedding-query-service.js';
import type { AttachmentStore } from '../services/loaders/attachment-store.js';
import type { LoaderRegistry } from '../services/loaders/registry.js';
import {
  bulkArchiveEntities,
  listEntities,
  recallEntity,
  softDeleteEntity,
  storeEntity,
  storeSessionContextMemory,
  updateEntity
} from '../services/entity-service.js';
import {
  groomSessionContext,
  previewSessionContextGrooming
} from '../services/memory-grooming-service.js';
import { getQueueStatus } from '../services/queue-service.js';
import { searchEntities } from '../services/search-service.js';
import {
  syncManifest,
  getSyncStatus,
  diffSyncManifest,
  uploadSyncFiles,
  finalizeSyncManifest
} from '../services/sync-service.js';
import {
  completeTask,
  createTask,
  listTasks,
  TASK_KIND_FILTERS,
  updateTask
} from '../services/task-service.js';
import type { TaskKindFilter } from '../services/task-service.js';
import type { Entity, EntityStatus, EntityType, Visibility } from '../types/entities.js';
import { AppError, ErrorCode, toErrorResponse } from '../util/errors.js';

const entityTypeSchema = z.enum([
  'memory',
  'person',
  'project',
  'task',
  'interaction',
  'document'
]);

const visibilitySchema = z.enum(['personal', 'work', 'shared']);
const ownerSchema = z.string().trim().min(1);
const memoryRoleSchema = z.enum(['durable_memory', 'session_context']);

const taskKindSchema = z.enum(TASK_KIND_FILTERS);

const statusSchema = z.enum([
  'active',
  'done',
  'archived',
  'inbox',
  'next',
  'waiting',
  'scheduled',
  'someday'
]);

const storeEntitySchema = z.object({
  type: entityTypeSchema,
  content: z.string().optional(),
  visibility: visibilitySchema.optional(),
  owner: ownerSchema.optional(),
  status: statusSchema.optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  skip_extraction: z.boolean().optional()
});

const storeSessionContextSchema = z.object({
  content: z.string().min(1),
  visibility: visibilitySchema.optional(),
  owner: ownerSchema.optional(),
  session_id: z.string().optional(),
  agent_id: z.string().optional(),
  topic: z.string().optional(),
  tags: z.array(z.string()).optional(),
  promotable: z.boolean().optional(),
  groom_after: z.string().optional(),
  expires_at: z.string().optional()
});

const selfGroomSessionContextSchema = z
  .object({
    dry_run: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    older_than_ms: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
    topic: z.string().optional(),
    session_id: z.string().optional(),
    tags: z.array(z.string()).optional()
  })
  .strict();

const updateEntitySchema = z.object({
  version: z.number().int().positive(),
  content: z.string().nullable().optional(),
  visibility: visibilitySchema.optional(),
  status: statusSchema.nullable().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional()
});

const searchEntitiesSchema = z.object({
  query: z.string().min(1),
  type: entityTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  visibility: visibilitySchema.optional(),
  owner: ownerSchema.optional(),
  limit: z.number().int().positive().max(50).optional(),
  threshold: z.number().min(0).max(1).optional(),
  recency_weight: z.number().min(0).optional(),
  expand_graph: z.boolean().optional(),
  include_archived: z.boolean().optional(),
  memory_role: memoryRoleSchema.optional(),
  include_content: z.boolean().optional()
});

const taskCreateSchema = z.object({
  content: z.string().min(1),
  context: z.string().optional(),
  status: statusSchema.optional(),
  due_date: z.string().optional(),
  tags: z.array(z.string()).optional(),
  visibility: visibilitySchema.optional(),
  metadata: z.record(z.unknown()).optional()
});

const taskUpdateSchema = z.object({
  version: z.number().int().positive(),
  content: z.string().min(1).optional(),
  context: z.string().optional(),
  status: statusSchema.nullable().optional(),
  due_date: z.string().optional(),
  tags: z.array(z.string()).optional(),
  visibility: visibilitySchema.optional(),
  metadata: z.record(z.unknown()).optional()
});

const taskCompleteSchema = z.object({
  version: z.number().int().positive()
});

const createEdgeSchema = z.object({
  source_id: z.string().min(1),
  target_id: z.string().min(1),
  relation: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional()
});

const MAX_EMBEDDING_IDS = 500;
const MAX_BULK_ARCHIVE_IDS = 500;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const embeddingsRequestSchema = z.object({
  ids: z
    .array(z.string().regex(UUID_REGEX, 'Invalid entity ID'))
    .min(1, 'ids must contain at least one entity ID')
    .max(MAX_EMBEDDING_IDS, `ids must contain at most ${MAX_EMBEDDING_IDS} entries`),
  owner: ownerSchema.optional()
});

const bulkArchiveEntitiesSchema = z.object({
  ids: z
    .array(z.string().regex(UUID_REGEX, 'Invalid entity ID'))
    .min(1, 'ids must contain at least one entity ID')
    .max(
      MAX_BULK_ARCHIVE_IDS,
      `ids must contain at most ${MAX_BULK_ARCHIVE_IDS} entries`
    )
});

const syncManifestSchema = z.object({
  repo: z.string().min(1),
  files: z.array(
    z.object({
      path: z.string().min(1),
      sha: z.string().min(1),
      content: z.string()
    })
  )
});

const syncDiffSchema = z.object({
  repo: z.string().min(1),
  files: z.array(
    z.object({
      path: z.string().min(1),
      sha: z.string().min(1)
    })
  )
});

const syncUploadSchema = z.object({
  repo: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        sha: z.string().min(1),
        content: z.string()
      })
    )
    .min(1)
});

const syncFinalizeSchema = z.object({
  repo: z.string().min(1),
  files: z.array(
    z.object({
      path: z.string().min(1),
      sha: z.string().min(1)
    })
  )
});

function toValidationError(message: string): AppError {
  return new AppError(ErrorCode.VALIDATION, message);
}

function parseJsonBody<T>(schema: z.ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw toValidationError(parsed.error.issues[0]?.message ?? 'Invalid request');
  }

  return parsed.data;
}

function parseQueryNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw toValidationError('Query parameter must be a non-negative integer');
  }

  return parsed;
}

export function toStoredEntity(entity: Entity) {
  return {
    id: entity.id,
    type: entity.type,
    content: entity.content,
    visibility: entity.visibility,
    owner: entity.owner,
    status: entity.status,
    enrichment_status: entity.enrichmentStatus,
    version: entity.version,
    tags: entity.tags,
    source: entity.source,
    metadata: entity.metadata,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    ...toLoadingResponseFields(entity)
  };
}

function toSearchStoredEntity(entity: Entity, includeContent: boolean) {
  const storedEntity = toStoredEntity(entity);
  if (includeContent) {
    return storedEntity;
  }

  return {
    id: storedEntity.id,
    type: storedEntity.type,
    visibility: storedEntity.visibility,
    owner: storedEntity.owner,
    status: storedEntity.status,
    enrichment_status: storedEntity.enrichment_status,
    version: storedEntity.version,
    tags: storedEntity.tags,
    source: storedEntity.source,
    metadata: storedEntity.metadata,
    created_at: storedEntity.created_at,
    updated_at: storedEntity.updated_at,
    ...toLoadingResponseFields(entity)
  };
}

const ingestFieldsSchema = z.object({
  title: z.string().trim().min(1).optional(),
  mime_type: z.string().trim().min(1).optional(),
  visibility: visibilitySchema.optional(),
  owner: ownerSchema.optional()
});

/**
 * Allowance for multipart framing and the text fields on top of `maxBytes`.
 * `bodyLimit` counts the whole body; the exact file size check decides.
 */
export const INGEST_FORM_OVERHEAD_BYTES = 64 * 1024;

export type DocumentLoadersOption = {
  registry: LoaderRegistry;
  attachmentStore: AttachmentStore;
  maxBytes: number;
};

/** An empty form field counts as absent. */
function formString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw toValidationError('Form fields other than file must be text');
  }
  return value.trim() === '' ? undefined : value;
}

function parseMetadataField(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw toValidationError('metadata must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw toValidationError('metadata must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function toStoredAttachment(attachment: Attachment) {
  return {
    id: attachment.id,
    entity_id: attachment.entityId,
    role: attachment.role,
    ref: attachment.ref,
    kind: attachment.kind,
    mime_type: attachment.mimeType,
    filename: attachment.filename,
    byte_size: attachment.byteSize,
    sha256: attachment.sha256,
    created_at: attachment.createdAt
  };
}

const SAFE_CONTENT_TYPE_RE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

function safeContentType(mimeType: string): string {
  return SAFE_CONTENT_TYPE_RE.test(mimeType)
    ? mimeType
    : 'application/octet-stream';
}

/** `attachment` disposition with an ASCII fallback and an RFC 5987 name. */
export function contentDisposition(filename: string | null, fallback: string): string {
  const name = filename ?? fallback;
  const ascii = name.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Resolves once the stream is readable; rejects if it cannot be opened. */
function whenReadable(stream: Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      stream.removeListener('readable', onReadable);
      reject(error);
    };
    const onReadable = () => {
      stream.removeListener('error', onError);
      resolve();
    };
    stream.once('error', onError);
    stream.once('readable', onReadable);
  });
}

type RestApp = Hono<{ Variables: { auth: AuthContext } }>;

function registerDocumentRoutes(
  app: RestApp,
  pool: Pool,
  options: {
    logger?: Pick<Logger, 'debug' | 'warn'> | undefined;
    documentLoaders?: DocumentLoadersOption | undefined;
  }
): void {
  const loaders = options.documentLoaders;

  if (!loaders) {
    app.post('/api/documents/ingest', () => {
      throw new AppError(
        ErrorCode.UNAVAILABLE,
        'Document loaders are not enabled'
      );
    });
    return;
  }

  app.post(
    '/api/documents/ingest',
    bodyLimit({
      maxSize: loaders.maxBytes + INGEST_FORM_OVERHEAD_BYTES,
      onError: (c) =>
        c.json(
          toErrorResponse(
            new AppError(
              ErrorCode.PAYLOAD_TOO_LARGE,
              `Upload exceeds the limit of ${loaders.maxBytes} bytes`,
              { max_bytes: loaders.maxBytes }
            )
          ),
          413
        )
    }),
    async (c) => {
      const auth = c.get('auth');
      // Read from the raw request (bodyLimit swaps it for a counting stream)
      // to avoid Hono's cached body copy of the whole upload.
      let form: FormData;
      try {
        form = await c.req.raw.formData();
      } catch (error) {
        if (error instanceof HTTPException) {
          return error.getResponse();
        }
        throw toValidationError('Request must be valid multipart/form-data');
      }

      const file = form.get('file');
      if (!(file instanceof File)) {
        throw toValidationError('file is required (multipart file part)');
      }
      if (file.size > loaders.maxBytes) {
        throw new AppError(
          ErrorCode.PAYLOAD_TOO_LARGE,
          `Upload exceeds the limit of ${loaders.maxBytes} bytes`,
          { max_bytes: loaders.maxBytes }
        );
      }

      const fields = parseJsonBody(ingestFieldsSchema, {
        title: formString(form.get('title') ?? undefined),
        mime_type: formString(form.get('mime_type') ?? undefined),
        visibility: formString(form.get('visibility') ?? undefined),
        owner: formString(form.get('owner') ?? undefined)
      });
      const tagsRaw = formString(form.get('tags') ?? undefined);
      const tags = tagsRaw
        ?.split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      const metadata = parseMetadataField(formString(form.get('metadata') ?? undefined));

      const result = await ingestDocument(
        auth,
        {
          bytes: new Uint8Array(await file.arrayBuffer()),
          filename: file.name,
          mimeType: fields.mime_type ?? (file.type || undefined),
          title: fields.title,
          visibility: fields.visibility,
          owner: fields.owner,
          tags,
          metadata
        },
        {
          pool,
          registry: loaders.registry,
          attachmentStore: loaders.attachmentStore
        }
      );

      if (result.isErr()) {
        throw result.error;
      }

      const { id, status, loadingStatus } = result.value;
      return c.json(
        { id, status, loading_status: loadingStatus },
        status === 'created' ? 202 : 200
      );
    }
  );

  app.get('/api/entities/:id/attachments', async (c) => {
    const result = await listAttachments(c.get('auth'), c.req.param('id'), {
      pool
    });
    if (result.isErr()) {
      throw result.error;
    }
    return c.json({ attachments: result.value.map(toStoredAttachment) });
  });

  app.get('/api/attachments/:id/content', async (c) => {
    const result = await getAttachmentForDownload(
      c.get('auth'),
      c.req.param('id'),
      { pool, attachmentStore: loaders.attachmentStore }
    );
    if (result.isErr()) {
      throw result.error;
    }

    const { attachment, openStream } = result.value;
    let stream: Readable;
    try {
      stream = openStream();
      await whenReadable(stream);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      options.logger?.warn(
        {
          attachmentId: attachment.id,
          entityId: attachment.entityId,
          code,
          error: error instanceof Error ? error.message : String(error)
        },
        'attachment file could not be opened'
      );
      if (code === 'ENOENT') {
        throw new AppError(ErrorCode.NOT_FOUND, 'Attachment content not found');
      }
      throw new AppError(ErrorCode.INTERNAL, 'Failed to read attachment content');
    }

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': safeContentType(attachment.mimeType),
        'Content-Length': String(attachment.byteSize),
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': contentDisposition(
          attachment.filename,
          `attachment-${attachment.ref}`
        )
      }
    });
  });
}

export function registerRestRoutes(
  app: RestApp,
  pool: Pool,
  options: {
    embeddingService?: EmbeddingService | undefined;
    logger?: Pick<Logger, 'debug' | 'warn'> | undefined;
    extractionEnabled?: boolean | undefined;
    searchDefaultThreshold?: number | undefined;
    documentLoaders?: DocumentLoadersOption | undefined;
  } = {}
): void {
  registerDocumentRoutes(app, pool, options);

  app.post('/api/entities', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(storeEntitySchema, await c.req.json());
    const result = await storeEntity(pool, auth, {
      type: body.type,
      content: body.content,
      visibility: body.visibility,
      owner: body.owner,
      status: body.status,
      tags: body.tags,
      source: body.source,
      metadata: body.metadata,
      skipExtraction: body.skip_extraction
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) }, 201);
  });

  app.post('/api/memory/session-context', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(storeSessionContextSchema, await c.req.json());
    const result = await storeSessionContextMemory(pool, auth, {
      content: body.content,
      visibility: body.visibility,
      owner: body.owner,
      sessionId: body.session_id,
      agentId: body.agent_id,
      topic: body.topic,
      tags: body.tags,
      promotable: body.promotable,
      groomAfter: body.groom_after,
      expiresAt: body.expires_at
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) }, 201);
  });

  app.post('/api/memory/session-context/groom', async (c) => {
    const auth = c.get('auth');
    if (!auth.clientId) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Authenticated client id is required for session-context grooming'
      );
    }

    requireScope(auth, 'read');
    checkTypeAccess(auth, 'memory');

    const body = parseJsonBody(selfGroomSessionContextSchema, await c.req.json());
    const now = new Date();
    const input = {
      clientId: auth.clientId,
      allowedVisibility: auth.allowedVisibility,
      now,
      limit: body.limit,
      olderThanMs: body.older_than_ms,
      topic: body.topic,
      sessionId: body.session_id,
      tags: body.tags
    };

    if (body.dry_run === true) {
      const preview = await previewSessionContextGrooming(pool, input);
      if (preview.isErr()) {
        throw preview.error;
      }

      return c.json({
        dryRun: true,
        archived: 0,
        promoted: 0,
        skipped: 0,
        mode: 'archive',
        eligible: preview.value.eligible
      });
    }

    requireScope(auth, 'delete');

    const result = await groomSessionContext(pool, {
      ...input,
      mode: 'archive',
      dryRun: false,
      confirm: body.confirmed === true
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      ...result.value,
      mode: 'archive'
    });
  });

  app.post('/api/entities/embeddings', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(embeddingsRequestSchema, await c.req.json());

    const result = await getEntityEmbeddings(pool, auth, {
      ids: body.ids,
      ...(body.owner !== undefined ? { owner: body.owner } : {})
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      embeddings: result.value.map((entry) => ({
        id: entry.id,
        embedding: entry.embedding
      }))
    });
  });

  app.post('/api/entities/bulk/archive', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(bulkArchiveEntitiesSchema, await c.req.json());
    const result = await bulkArchiveEntities(pool, auth, {
      ids: body.ids
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value);
  });

  app.get('/api/entities/:id', async (c) => {
    const auth = c.get('auth');
    const owner = c.req.query('owner');

    if (owner && !ownerSchema.safeParse(owner).success) {
      throw toValidationError('Invalid owner');
    }

    const result = await recallEntity(pool, auth, c.req.param('id'), {
      ...(owner !== undefined ? { owner } : {})
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) });
  });

  app.patch('/api/entities/:id', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(updateEntitySchema, await c.req.json());
    const result = await updateEntity(pool, auth, {
      id: c.req.param('id'),
      ...body
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) });
  });

  app.delete('/api/entities/:id', async (c) => {
    const auth = c.get('auth');
    const result = await softDeleteEntity(pool, auth, c.req.param('id'));

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value);
  });

  app.get('/api/entities', async (c) => {
    const auth = c.get('auth');
    const tags = c.req.query('tags');
    const type = c.req.query('type');
    const status = c.req.query('status');
    const visibility = c.req.query('visibility');
    const owner = c.req.query('owner');
    const memoryRole = c.req.query('memory_role');

    if (type && !entityTypeSchema.safeParse(type).success) {
      throw toValidationError('Invalid entity type');
    }

    if (status && !statusSchema.safeParse(status).success) {
      throw toValidationError('Invalid entity status');
    }

    if (visibility && !visibilitySchema.safeParse(visibility).success) {
      throw toValidationError('Invalid visibility');
    }

    if (owner && !ownerSchema.safeParse(owner).success) {
      throw toValidationError('Invalid owner');
    }

    if (memoryRole && !memoryRoleSchema.safeParse(memoryRole).success) {
      throw toValidationError('Invalid memory role');
    }

    const includeArchived = c.req.query('include_archived') === 'true';

    const result = await listEntities(pool, auth, {
      type: type as EntityType | undefined,
      status: status as EntityStatus | undefined,
      visibility: visibility as Visibility | undefined,
      owner,
      memoryRole: memoryRole as
        | 'durable_memory'
        | 'session_context'
        | undefined,
      tags: tags ? tags.split(',').filter(Boolean) : undefined,
      limit: parseQueryNumber(c.req.query('limit'), 50),
      offset: parseQueryNumber(c.req.query('offset'), 0),
      includeArchived
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      items: result.value.items.map(toStoredEntity),
      total: result.value.total,
      limit: result.value.limit,
      offset: result.value.offset
    });
  });

  app.post('/api/search', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(searchEntitiesSchema, await c.req.json());
    const includeContent = body.include_content ?? true;
    const result = await searchEntities(
      pool,
      auth,
      {
        query: body.query,
        type: body.type,
        tags: body.tags,
        visibility: body.visibility,
        owner: body.owner,
        limit: body.limit,
        threshold: body.threshold,
        recencyWeight: body.recency_weight,
        expandGraph: body.expand_graph,
        includeArchived: body.include_archived,
        memoryRole: body.memory_role,
        includeContent
      },
      {
        embeddingService: options.embeddingService,
        logger: options.logger,
        defaultThreshold: options.searchDefaultThreshold
      }
    );

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      results: result.value.results.map((entry) => ({
        entity: toSearchStoredEntity(entry.entity, includeContent),
        chunk_content: entry.chunkContent,
        similarity: entry.similarity,
        score: entry.score,
        ...(entry.edges ? { edges: entry.edges } : {}),
        ...(entry.related
          ? {
              related: entry.related.map((related) => ({
                entity: {
                  id: related.entity.id,
                  type: related.entity.type,
                  ...(includeContent
                    ? { content: related.entity.content }
                    : {}),
                  metadata: related.entity.metadata
                },
                relation: related.relation,
                direction: related.direction
              }))
            }
          : {})
      }))
    });
  });

  app.post('/api/tasks', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(taskCreateSchema, await c.req.json());
    const result = await createTask(pool, auth, {
      content: body.content,
      context: body.context,
      status: body.status,
      dueDate: body.due_date,
      tags: body.tags,
      visibility: body.visibility,
      metadata: body.metadata
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) }, 201);
  });

  app.get('/api/tasks', async (c) => {
    const auth = c.get('auth');
    const status = c.req.query('status');

    if (status && !statusSchema.safeParse(status).success) {
      throw toValidationError('Invalid entity status');
    }

    const includeArchived = c.req.query('include_archived') === 'true';
    const kind = c.req.query('kind');
    if (kind !== undefined && !taskKindSchema.safeParse(kind).success) {
      throw toValidationError('Invalid task kind');
    }

    const result = await listTasks(pool, auth, {
      kind: kind as TaskKindFilter | undefined,
      status: status as EntityStatus | undefined,
      context: c.req.query('context') ?? undefined,
      limit: parseQueryNumber(c.req.query('limit'), 50),
      offset: parseQueryNumber(c.req.query('offset'), 0),
      includeArchived
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      items: result.value.items.map(toStoredEntity),
      total: result.value.total,
      limit: result.value.limit,
      offset: result.value.offset
    });
  });

  app.patch('/api/tasks/:id', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(taskUpdateSchema, await c.req.json());
    const result = await updateTask(pool, auth, {
      id: c.req.param('id'),
      version: body.version,
      content: body.content,
      context: body.context,
      status: body.status,
      dueDate: body.due_date,
      tags: body.tags,
      visibility: body.visibility,
      metadata: body.metadata
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) });
  });

  app.post('/api/tasks/:id/complete', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(taskCompleteSchema, await c.req.json());
    const result = await completeTask(pool, auth, {
      id: c.req.param('id'),
      version: body.version
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) });
  });

  app.get('/api/queue', async (c) => {
    const auth = c.get('auth');
    const includeFailures =
      (c.req.query('include_failures') ?? '').toLowerCase() === 'true';
    const failureLimitParam = c.req.query('failure_limit');
    const failureLimit = Math.max(
      1,
      Math.min(100, Number.parseInt(failureLimitParam ?? '20', 10) || 20)
    );

    const payload = await getQueueStatus(pool, auth, {
      includeFailures,
      failureLimit,
      ...(options.extractionEnabled !== undefined
        ? { extractionEnabled: options.extractionEnabled }
        : {})
    });
    return c.json(payload);
  });

  app.post('/api/sync', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(syncManifestSchema, await c.req.json());
    const result = await syncManifest(pool, auth, body);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value);
  });

  app.post('/api/sync/diff', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(syncDiffSchema, await c.req.json());
    const result = await diffSyncManifest(pool, auth, body);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value);
  });

  app.post('/api/sync/upload', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(syncUploadSchema, await c.req.json());
    const result = await uploadSyncFiles(pool, auth, body);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value);
  });

  app.post('/api/sync/finalize', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(syncFinalizeSchema, await c.req.json());
    const result = await finalizeSyncManifest(pool, auth, body);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value);
  });

  app.get('/api/sync/status/:repo', async (c) => {
    const auth = c.get('auth');
    const repo = c.req.param('repo');
    const result = await getSyncStatus(pool, auth, repo);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      repo,
      files: result.value
    });
  });

  app.post('/api/edges', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(createEdgeSchema, await c.req.json());
    const result = await createEdge(pool, auth, {
      sourceId: body.source_id,
      targetId: body.target_id,
      relation: body.relation,
      ...(body.confidence !== undefined ? { confidence: body.confidence } : {}),
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {})
    });

    if (result.isErr()) {
      throw result.error;
    }

    const edge = result.value;
    return c.json({
      edge: {
        id: edge.id,
        source_id: edge.sourceId,
        target_id: edge.targetId,
        relation: edge.relation,
        confidence: edge.confidence,
        source: edge.source,
        metadata: edge.metadata,
        created_at: edge.createdAt
      }
    }, 201);
  });

  app.delete('/api/edges/:id', async (c) => {
    const auth = c.get('auth');
    const result = await deleteEdge(pool, auth, c.req.param('id'));

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value);
  });

  app.get('/api/entities/:id/edges', async (c) => {
    const auth = c.get('auth');
    const relation = c.req.query('relation');
    const direction = c.req.query('direction');
    const owner = c.req.query('owner');
    if (direction && !['source', 'target', 'both'].includes(direction)) {
      throw toValidationError('Invalid direction — must be source, target, or both');
    }
    if (owner && !ownerSchema.safeParse(owner).success) {
      throw toValidationError('Invalid owner');
    }
    const result = await listEdges(pool, auth, c.req.param('id'), {
      ...(relation !== undefined ? { relation } : {}),
      direction: (direction ?? 'both') as 'source' | 'target' | 'both',
      ...(owner !== undefined ? { owner } : {})
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      edges: result.value.map((edge) => ({
        id: edge.id,
        source_id: edge.sourceId,
        target_id: edge.targetId,
        relation: edge.relation,
        confidence: edge.confidence,
        source: edge.source,
        metadata: edge.metadata,
        created_at: edge.createdAt
      }))
    });
  });

  app.get('/api/entities/:id/graph', async (c) => {
    const auth = c.get('auth');
    const depth = c.req.query('depth') ? parseQueryNumber(c.req.query('depth'), 1) : undefined;
    const relationTypesRaw = c.req.query('relation_types');
    const owner = c.req.query('owner');
    const relationTypes = relationTypesRaw ? relationTypesRaw.split(',').filter(Boolean) : undefined;
    if (owner && !ownerSchema.safeParse(owner).success) {
      throw toValidationError('Invalid owner');
    }
    const result = await expandGraph(pool, auth, c.req.param('id'), {
      ...(depth !== undefined ? { depth } : {}),
      ...(relationTypes !== undefined ? { relationTypes } : {}),
      ...(owner !== undefined ? { owner } : {})
    });

    if (result.isErr()) {
      throw result.error;
    }

    const graph = result.value;
    return c.json({
      entities: graph.entities,
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        source_id: edge.sourceId,
        target_id: edge.targetId,
        relation: edge.relation,
        confidence: edge.confidence,
        source: edge.source,
        metadata: edge.metadata,
        created_at: edge.createdAt
      }))
    });
  });
}
