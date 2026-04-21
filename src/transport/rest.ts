import type { Hono } from 'hono';
import { z } from 'zod';
import type { Pool } from 'pg';

import type { AuthContext } from '../auth/types.js';
import type { EmbeddingService } from '../services/embedding-service.js';
import { createEdge, deleteEdge, listEdges, expandGraph } from '../services/edge-service.js';
import { getEntityEmbeddings } from '../services/embedding-query-service.js';
import { listEntities, recallEntity, softDeleteEntity, storeEntity, updateEntity } from '../services/entity-service.js';
import { searchEntities } from '../services/search-service.js';
import { syncManifest, getSyncStatus } from '../services/sync-service.js';
import { completeTask, createTask, listTasks, updateTask } from '../services/task-service.js';
import type { Entity, EntityStatus, EntityType, Visibility } from '../types/entities.js';
import { AppError, ErrorCode } from '../util/errors.js';

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
  metadata: z.record(z.unknown()).optional()
});

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
  expand_graph: z.boolean().optional()
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
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function toStoredEntity(entity: Entity) {
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
    updated_at: entity.updatedAt
  };
}

type RestApp = Hono<{ Variables: { auth: AuthContext } }>;

export function registerRestRoutes(
  app: RestApp,
  pool: Pool,
  options: {
    embeddingService?: EmbeddingService | undefined;
  } = {}
): void {
  app.post('/api/entities', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(storeEntitySchema, await c.req.json());
    const result = await storeEntity(pool, auth, body);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) }, 201);
  });

  app.get('/api/entities/embeddings', async (c) => {
    const auth = c.get('auth');
    const idsRaw = c.req.query('ids');
    const owner = c.req.query('owner');

    if (!idsRaw) {
      throw toValidationError('ids query parameter is required');
    }

    const ids = idsRaw.split(',').map((id) => id.trim()).filter(Boolean);

    if (ids.length === 0) {
      throw toValidationError('ids must contain at least one entity ID');
    }

    if (ids.length > MAX_EMBEDDING_IDS) {
      throw toValidationError(
        `ids must contain at most ${MAX_EMBEDDING_IDS} entries`
      );
    }

    for (const id of ids) {
      if (!UUID_REGEX.test(id)) {
        throw toValidationError(`Invalid entity ID: ${id}`);
      }
    }

    if (owner && !ownerSchema.safeParse(owner).success) {
      throw toValidationError('Invalid owner');
    }

    const result = await getEntityEmbeddings(pool, auth, {
      ids,
      ...(owner !== undefined ? { owner } : {})
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

    const result = await listEntities(pool, auth, {
      type: type as EntityType | undefined,
      status: status as EntityStatus | undefined,
      visibility: visibility as Visibility | undefined,
      owner,
      tags: tags ? tags.split(',').filter(Boolean) : undefined,
      limit: parseQueryNumber(c.req.query('limit'), 50),
      offset: parseQueryNumber(c.req.query('offset'), 0)
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
        expandGraph: body.expand_graph
      },
      {
        embeddingService: options.embeddingService
      }
    );

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      results: result.value.results.map((entry) => ({
        entity: toStoredEntity(entry.entity),
        chunk_content: entry.chunkContent,
        similarity: entry.similarity,
        score: entry.score,
        ...(entry.related ? { related: entry.related } : {})
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

    const result = await listTasks(pool, auth, {
      status: status as EntityStatus | undefined,
      context: c.req.query('context') ?? undefined,
      limit: parseQueryNumber(c.req.query('limit'), 50),
      offset: parseQueryNumber(c.req.query('offset'), 0)
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
    type QueueRow = {
      embedding_pending: string;
      embedding_completed: string;
      embedding_failed: string;
      embedding_retry_eligible: string;
      oldest_pending_secs: string | null;
      extraction_pending: string;
      extraction_completed: string;
      extraction_failed: string;
      extraction_any: string;
    };

    const result = await pool.query<QueueRow>(`
      SELECT
        COUNT(*) FILTER (WHERE enrichment_status = 'pending')::text                                                                         AS embedding_pending,
        COUNT(*) FILTER (WHERE enrichment_status = 'completed')::text                                                                       AS embedding_completed,
        COUNT(*) FILTER (WHERE enrichment_status = 'failed')::text                                                                          AS embedding_failed,
        COUNT(*) FILTER (WHERE enrichment_status = 'failed' AND enrichment_attempts < 3 AND updated_at < now() - interval '5 minutes')::text AS embedding_retry_eligible,
        EXTRACT(EPOCH FROM now() - MIN(updated_at) FILTER (WHERE enrichment_status = 'pending'))::text                                      AS oldest_pending_secs,
        COUNT(*) FILTER (WHERE extraction_status = 'pending')::text                                                                         AS extraction_pending,
        COUNT(*) FILTER (WHERE extraction_status = 'completed')::text                                                                       AS extraction_completed,
        COUNT(*) FILTER (WHERE extraction_status = 'failed')::text                                                                          AS extraction_failed,
        COUNT(*) FILTER (WHERE extraction_status IS NOT NULL)::text                                                                         AS extraction_any
      FROM entities
      WHERE content IS NOT NULL
    `);

    const row = result.rows[0];
    const extractionEnabled = row ? Number(row.extraction_any) > 0 : false;

    return c.json({
      embedding: {
        pending: Number(row?.embedding_pending ?? 0),
        completed: Number(row?.embedding_completed ?? 0),
        failed: Number(row?.embedding_failed ?? 0),
        retry_eligible: Number(row?.embedding_retry_eligible ?? 0),
        oldest_pending_secs: row?.oldest_pending_secs !== null && row?.oldest_pending_secs !== undefined
          ? Math.round(Number(row.oldest_pending_secs))
          : null
      },
      extraction: extractionEnabled
        ? {
            pending: Number(row?.extraction_pending ?? 0),
            completed: Number(row?.extraction_completed ?? 0),
            failed: Number(row?.extraction_failed ?? 0)
          }
        : null
    });
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
