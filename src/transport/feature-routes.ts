import type { Hono } from 'hono';
import { z } from 'zod';
import type { Pool } from 'pg';

import type { AuthContext } from '../auth/types.js';
import {
  addFeaturePullRequest,
  createFeature,
  setFeatureStage,
  setRepositoryReleaseOnMerge
} from '../services/feature-service.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { toStoredEntity } from './rest.js';

const repositoryReleaseSchema = z.object({
  remote: z.string().min(1),
  release_on_merge: z.boolean()
});

const featureCreateSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['personal', 'work', 'shared']).optional()
});

const featureStageSchema = z.object({
  stage: z.string()
});

const pullRequestSchema = z.object({
  url: z.string(),
  state: z.string().optional()
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

export function registerFeatureRoutes(
  app: Hono<{ Variables: { auth: AuthContext } }>,
  pool: Pool
): void {
  app.put('/api/repositories', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(repositoryReleaseSchema, await c.req.json());
    const result = await setRepositoryReleaseOnMerge(pool, auth, {
      remote: body.remote,
      releaseOnMerge: body.release_on_merge
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ repository: result.value }, 200);
  });

  app.post('/api/features', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(featureCreateSchema, await c.req.json());
    const result = await createFeature(pool, auth, {
      content: body.content,
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.visibility !== undefined ? { visibility: body.visibility } : {})
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({ entity: toStoredEntity(result.value) }, 201);
  });

  app.post('/api/features/:id/stage', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(featureStageSchema, await c.req.json());
    const result = await setFeatureStage(pool, auth, {
      id: c.req.param('id'),
      stage: body.stage
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(
      {
        entity: toStoredEntity(result.value.entity),
        previous_stage: result.value.previous_stage
      },
      200
    );
  });

  app.post('/api/features/:id/pull-requests', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(pullRequestSchema, await c.req.json());
    const result = await addFeaturePullRequest(pool, auth, {
      id: c.req.param('id'),
      url: body.url,
      ...(body.state !== undefined ? { state: body.state } : {})
    });

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(
      {
        entity: toStoredEntity(result.value.entity),
        stage_changed: result.value.stage_changed,
        from: result.value.from,
        to: result.value.to
      },
      200
    );
  });
}
