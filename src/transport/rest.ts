import type { Hono } from 'hono';
import { z } from 'zod';
import type { Pool } from 'pg';

import type { AuthContext } from '../auth/types.js';
import { listEntities, recallEntity, softDeleteEntity, storeEntity, updateEntity } from '../services/entity-service.js';
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
  status: statusSchema.optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional()
});

const updateEntitySchema = z.object({
  version: z.number().int().positive(),
  content: z.string().nullable().optional(),
  visibility: visibilitySchema.optional(),
  status: statusSchema.nullable().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional()
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

export function registerRestRoutes(app: RestApp, pool: Pool): void {
  app.post('/api/entities', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(storeEntitySchema, await c.req.json());
    const result = await storeEntity(pool, auth, body);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) }, 201);
  });

  app.get('/api/entities/:id', async (c) => {
    const auth = c.get('auth');
    const result = await recallEntity(pool, auth, c.req.param('id'));

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

    if (type && !entityTypeSchema.safeParse(type).success) {
      throw toValidationError('Invalid entity type');
    }

    if (status && !statusSchema.safeParse(status).success) {
      throw toValidationError('Invalid entity status');
    }

    if (visibility && !visibilitySchema.safeParse(visibility).success) {
      throw toValidationError('Invalid visibility');
    }

    const result = await listEntities(pool, auth, {
      type: type as EntityType | undefined,
      status: status as EntityStatus | undefined,
      visibility: visibility as Visibility | undefined,
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
}
