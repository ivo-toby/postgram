import type { Hono } from 'hono';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Pool } from 'pg';

import { validateKey } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { EmbeddingService } from '../services/embedding-service.js';
import { createEdge, deleteEdge, expandGraph } from '../services/edge-service.js';
import { recallEntity, softDeleteEntity, storeEntity, updateEntity } from '../services/entity-service.js';
import { getQueueStatus } from '../services/queue-service.js';
import { searchEntities } from '../services/search-service.js';
import { syncManifest, getSyncStatus } from '../services/sync-service.js';
import { completeTask, createTask, listTasks, updateTask } from '../services/task-service.js';
import type { ServiceResult } from '../types/common.js';
import type { Entity } from '../types/entities.js';
import { AppError, ErrorCode, normalizeError, toErrorResponse, toHttpStatus } from '../util/errors.js';

type McpApp = Hono<{ Variables: { auth: AuthContext } }>;

type ToolPayload = Record<string, unknown>;

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

function toToolSuccess(payload: ToolPayload) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload)
      }
    ],
    structuredContent: payload
  };
}

function toToolError(error: AppError) {
  const payload = toErrorResponse(error);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload)
      }
    ],
    structuredContent: payload,
    isError: true
  };
}

async function toolFromService<T>(
  result: ServiceResult<T>,
  map: (value: T) => ToolPayload
) {
  return result.match(
    (value) => toToolSuccess(map(value)),
    (error) => toToolError(error)
  );
}

function getBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  return header.slice(7);
}

async function authenticateSession(pool: Pool, token: string | null): Promise<AuthContext> {
  if (!token) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'Missing Bearer token');
  }

  const result = await validateKey(pool, token);
  return result.match(
    (value) => value,
    (error) => {
      throw error;
    }
  );
}


function createSessionServer(
  pool: Pool,
  auth: AuthContext,
  options: {
    embeddingService?: EmbeddingService | undefined;
  } = {}
) {
  const server = new McpServer({
    name: 'postgram-mcp',
    version: '0.1.0'
  });

  server.registerTool(
    'store',
    {
      description: 'Store a new knowledge entity',
      inputSchema: {
        type: entityTypeSchema,
        content: z.string().optional(),
        visibility: visibilitySchema.optional(),
        owner: ownerSchema.optional(),
        status: statusSchema.optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
        metadata: z.record(z.unknown()).optional()
      }
    },
    (args) =>
      toolFromService(
        storeEntity(pool, auth, {
          type: args.type,
          content: args.content,
          visibility: args.visibility,
          owner: args.owner,
          status: args.status,
          tags: args.tags,
          source: args.source,
          metadata: args.metadata
        }),
        (entity) => ({ entity: toStoredEntity(entity) })
      )
  );

  server.registerTool(
    'recall',
    {
      description: 'Recall an entity by ID',
      inputSchema: {
        id: z.string(),
        owner: ownerSchema.optional()
      }
    },
    (args) =>
      toolFromService(recallEntity(pool, auth, args.id, {
        ...(args.owner !== undefined ? { owner: args.owner } : {})
      }), (entity) => ({
        entity: toStoredEntity(entity)
      }))
  );

  server.registerTool(
    'search',
    {
      description: 'Search stored knowledge using hybrid BM25 + vector similarity with recency weighting. Set expand_graph=true to also return graph-connected entities (requires extraction to have run on the matching documents — use the queue tool to check status). Use expand_graph when exploring relationships, tracing decisions, or understanding what else is connected to a topic.',
      inputSchema: {
        query: z.string().min(1),
        type: entityTypeSchema.optional(),
        tags: z.array(z.string()).optional(),
        visibility: visibilitySchema.optional(),
        owner: ownerSchema.optional(),
        limit: z.number().int().positive().optional(),
        threshold: z.number().min(0).max(1).optional(),
        recency_weight: z.number().min(0).optional(),
        expand_graph: z.boolean().optional(),
        include_archived: z.boolean().optional()
      }
    },
    (args) =>
      toolFromService(
        searchEntities(
          pool,
          auth,
          {
            query: args.query,
            type: args.type,
            tags: args.tags,
            visibility: args.visibility,
            owner: args.owner,
            limit: args.limit,
            threshold: args.threshold,
            recencyWeight: args.recency_weight,
            expandGraph: args.expand_graph,
            includeArchived: args.include_archived
          },
          {
            embeddingService: options.embeddingService
          }
        ),
        (value) => ({
          results: value.results.map((entry) => ({
            entity: toStoredEntity(entry.entity),
            chunk_content: entry.chunkContent,
            similarity: entry.similarity,
            score: entry.score,
            ...(entry.related ? { related: entry.related } : {})
          }))
        })
      )
  );

  server.registerTool(
    'update',
    {
      description: 'Update an entity',
      inputSchema: {
        id: z.string(),
        version: z.number().int().positive(),
        content: z.string().nullable().optional(),
        visibility: visibilitySchema.optional(),
        status: statusSchema.nullable().optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().nullable().optional(),
        metadata: z.record(z.unknown()).optional()
      }
    },
    (args) =>
      toolFromService(
        updateEntity(pool, auth, {
          id: args.id,
          version: args.version,
          content: args.content,
          visibility: args.visibility,
          status: args.status,
          tags: args.tags,
          source: args.source,
          metadata: args.metadata
        }),
        (entity) => ({ entity: toStoredEntity(entity) })
      )
  );

  server.registerTool(
    'delete',
    {
      description: 'Soft-delete an entity',
      inputSchema: {
        id: z.string()
      }
    },
    (args) => toolFromService(softDeleteEntity(pool, auth, args.id), (value) => value)
  );

  server.registerTool(
    'task_create',
    {
      description: 'Create a task',
      inputSchema: {
        content: z.string().min(1),
        context: z.string().optional(),
        status: statusSchema.optional(),
        due_date: z.string().optional(),
        tags: z.array(z.string()).optional(),
        visibility: visibilitySchema.optional(),
        metadata: z.record(z.unknown()).optional()
      }
    },
    (args) =>
      toolFromService(
        createTask(pool, auth, {
          content: args.content,
          context: args.context,
          status: args.status,
          dueDate: args.due_date,
          tags: args.tags,
          visibility: args.visibility,
          metadata: args.metadata
        }),
        (entity) => ({ entity: toStoredEntity(entity) })
      )
  );

  server.registerTool(
    'task_list',
    {
      description: 'List tasks',
      inputSchema: {
        status: statusSchema.optional(),
        context: z.string().optional(),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        include_archived: z.boolean().optional()
      }
    },
    (args) =>
      toolFromService(
        listTasks(pool, auth, {
          status: args.status,
          context: args.context,
          limit: args.limit,
          offset: args.offset,
          includeArchived: args.include_archived
        }),
        (value) => ({
          items: value.items.map(toStoredEntity),
          total: value.total,
          limit: value.limit,
          offset: value.offset
        })
      )
  );

  server.registerTool(
    'task_update',
    {
      description: 'Update a task',
      inputSchema: {
        id: z.string(),
        version: z.number().int().positive(),
        content: z.string().optional(),
        context: z.string().optional(),
        status: statusSchema.nullable().optional(),
        due_date: z.string().optional(),
        tags: z.array(z.string()).optional(),
        visibility: visibilitySchema.optional(),
        metadata: z.record(z.unknown()).optional()
      }
    },
    (args) =>
      toolFromService(
        updateTask(pool, auth, {
          id: args.id,
          version: args.version,
          content: args.content,
          context: args.context,
          status: args.status,
          dueDate: args.due_date,
          tags: args.tags,
          visibility: args.visibility,
          metadata: args.metadata
        }),
        (entity) => ({ entity: toStoredEntity(entity) })
      )
  );

  server.registerTool(
    'task_complete',
    {
      description: 'Complete a task',
      inputSchema: {
        id: z.string(),
        version: z.number().int().positive()
      }
    },
    (args) =>
      toolFromService(
        completeTask(pool, auth, {
          id: args.id,
          version: args.version
        }),
        (entity) => ({ entity: toStoredEntity(entity) })
      )
  );

  server.registerTool(
    'link',
    {
      description: 'Create a relationship between two entities',
      inputSchema: {
        source_id: z.string().min(1),
        target_id: z.string().min(1),
        relation: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        metadata: z.record(z.unknown()).optional()
      }
    },
    (args) =>
      toolFromService(
        createEdge(pool, auth, {
          sourceId: args.source_id,
          targetId: args.target_id,
          relation: args.relation,
          ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
          ...(args.metadata !== undefined ? { metadata: args.metadata } : {})
        }),
        (edge) => ({
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
        })
      )
  );

  server.registerTool(
    'unlink',
    {
      description: 'Remove a relationship between entities',
      inputSchema: {
        id: z.string().min(1)
      }
    },
    (args) =>
      toolFromService(deleteEdge(pool, auth, args.id), (value) => value)
  );

  server.registerTool(
    'expand',
    {
      description: 'Get the graph neighborhood of an entity — connected entities up to N hops',
      inputSchema: {
        entity_id: z.string().min(1),
        depth: z.number().int().min(1).max(3).optional(),
        relation_types: z.array(z.string()).optional(),
        owner: ownerSchema.optional()
      }
    },
    (args) =>
      toolFromService(
        expandGraph(pool, auth, args.entity_id, {
          ...(args.depth !== undefined ? { depth: args.depth } : {}),
          ...(args.relation_types !== undefined ? { relationTypes: args.relation_types } : {}),
          ...(args.owner !== undefined ? { owner: args.owner } : {})
        }),
        (value) => ({
          entities: value.entities,
          edges: value.edges.map((edge) => ({
            id: edge.id,
            source_id: edge.sourceId,
            target_id: edge.targetId,
            relation: edge.relation,
            confidence: edge.confidence,
            source: edge.source,
            metadata: edge.metadata,
            created_at: edge.createdAt
          }))
        })
      )
  );

  server.registerTool(
    'queue',
    {
      description:
        'Get the enrichment and extraction queue status — useful for checking whether stored entities have been embedded and knowledge graph edges extracted. Set include_failures=true to see the most recent failure messages.',
      inputSchema: {
        include_failures: z
          .boolean()
          .optional()
          .describe(
            'If true, return the most recent failed entities with their error messages'
          ),
        failure_limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of failures to return (default 20, max 100)')
      }
    },
    async ({ include_failures, failure_limit }) => {
      const payload = await getQueueStatus(pool, auth, {
        includeFailures: Boolean(include_failures),
        ...(failure_limit !== undefined ? { failureLimit: failure_limit } : {})
      });

      return toToolSuccess(payload);
    }
  );

  server.registerTool(
    'sync_push',
    {
      description: 'Sync a document repository. Sends a manifest of files with content and SHA-256 hashes.',
      inputSchema: {
        repo: z.string().min(1),
        files: z.array(
          z.object({
            path: z.string().min(1),
            sha: z.string().min(1),
            content: z.string()
          })
        )
      }
    },
    (args) =>
      toolFromService(
        syncManifest(pool, auth, {
          repo: args.repo,
          files: args.files
        }),
        (value) => value
      )
  );

  server.registerTool(
    'sync_status',
    {
      description: 'Get the sync status of a document repository.',
      inputSchema: {
        repo: z.string().min(1)
      }
    },
    (args) =>
      toolFromService(
        getSyncStatus(pool, auth, args.repo),
        (files) => ({ repo: args.repo, files })
      )
  );

  return server;
}

export function registerMcpRoutes(
  app: McpApp,
  pool: Pool,
  options: {
    embeddingService?: EmbeddingService | undefined;
  } = {}
): void {
  app.all('/mcp', async (c) => {
    try {
      const token =
        getBearerToken(c.req.header('Authorization')) ??
        c.req.query('apiKey') ??
        null;
      const auth = await authenticateSession(pool, token);

      const transport = new WebStandardStreamableHTTPServerTransport();
      const server = createSessionServer(pool, auth, options);
      await server.connect(transport);
      return transport.handleRequest(c.req.raw);
    } catch (error) {
      const appError = normalizeError(error);
      return c.json(
        toErrorResponse(appError),
        toHttpStatus(appError.code) as 401 | 403 | 404 | 409 | 500 | 502
      );
    }
  });
}
