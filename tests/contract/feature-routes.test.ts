import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/types.js';
import { registerFeatureRoutes } from '../../src/transport/feature-routes.js';
import {
  normalizeError,
  toErrorResponse,
  toHttpStatus
} from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

type Json = Record<string, unknown>;

const API_KEY_ID = '7f3a9c21-0000-4000-8000-0000000000aa';

const writeAuth: AuthContext = {
  apiKeyId: API_KEY_ID,
  keyName: 'feature-routes-test',
  clientId: 'feature-routes-test',
  scopes: ['read', 'write'],
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared']
};

const readOnlyAuth: AuthContext = {
  ...writeAuth,
  scopes: ['read']
};

const STORED_ENTITY_KEYS = [
  'id',
  'type',
  'content',
  'visibility',
  'owner',
  'status',
  'enrichment_status',
  'version',
  'tags',
  'source',
  'metadata',
  'created_at',
  'updated_at'
].sort();

describe('feature routes (slice)', () => {
  let database: TestDatabase | undefined;
  let app: Hono<{ Variables: { auth: AuthContext } }> | undefined;
  let currentAuth: AuthContext = writeAuth;

  function db(): TestDatabase {
    if (!database) {
      throw new Error('test database not initialized');
    }
    return database;
  }

  function honoApp(): Hono<{ Variables: { auth: AuthContext } }> {
    if (!app) {
      throw new Error('app not initialized');
    }
    return app;
  }

  async function call(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; json: Json }> {
    const response = await honoApp().request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, json: (await response.json()) as Json };
  }

  function errorCode(json: Json): unknown {
    const error = json.error as Json | undefined;
    return error?.code;
  }

  function entityOf(json: Json): Json {
    return json.entity as Json;
  }

  function metadataOf(json: Json): Json {
    return entityOf(json).metadata as Json;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    const builtApp = new Hono<{ Variables: { auth: AuthContext } }>();
    builtApp.onError((error, c) => {
      const appError = normalizeError(error);
      return c.json(
        toErrorResponse(appError),
        toHttpStatus(appError.code) as ContentfulStatusCode
      );
    });
    builtApp.use('/api/*', async (c, next) => {
      c.set('auth', currentAuth);
      await next();
    });
    registerFeatureRoutes(builtApp, database.pool);
    app = builtApp;
  }, 120_000);

  beforeEach(async () => {
    currentAuth = writeAuth;
    await resetTestDatabase(db().pool);
    await db().pool.query(
      'TRUNCATE TABLE agent_sessions, workspaces, machines, repositories CASCADE'
    );
    await seedApiKey(db().pool, {
      id: API_KEY_ID,
      name: 'feature-routes-test',
      scopes: ['read', 'write'],
      allowedVisibility: ['personal', 'work', 'shared']
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('PUT /api/repositories normalizes the remote and returns the flag (rest-feature-routes)', async () => {
    const response = await call('PUT', '/api/repositories', {
      remote: 'git@github.com:Ivo-Toby/postgram.git',
      release_on_merge: false
    });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      repository: {
        remote: 'github.com/ivo-toby/postgram',
        release_on_merge: false
      }
    });

    const invalid = await call('PUT', '/api/repositories', {
      remote: '',
      release_on_merge: 'yes'
    });
    expect(invalid.status).toBe(400);
    expect(errorCode(invalid.json)).toBe('VALIDATION');
  }, 120_000);

  it('POST /api/features creates a stored feature entity and rejects empty content (rest-feature-routes, rest-errors)', async () => {
    const created = await call('POST', '/api/features', {
      content: 'Keyword rank fusion\nbody',
      tags: ['search'],
      visibility: 'shared'
    });

    expect(created.status).toBe(201);
    const entity = entityOf(created.json);
    expect(Object.keys(entity).sort()).toEqual(STORED_ENTITY_KEYS);
    expect(entity).toMatchObject({
      type: 'task',
      content: 'Keyword rank fusion\nbody',
      status: 'inbox',
      visibility: 'shared',
      tags: ['search'],
      version: 1,
      metadata: { kind: 'feature', stage: 'building', pull_requests: [] }
    });
    expect(typeof entity.id).toBe('string');
    expect(typeof entity.created_at).toBe('string');
    expect(typeof entity.updated_at).toBe('string');

    const emptyContent = await call('POST', '/api/features', {
      content: ''
    });
    expect(emptyContent.status).toBe(400);
    expect(errorCode(emptyContent.json)).toBe('VALIDATION');
  }, 120_000);

  it('POST /api/features/:id/stage accepts a short id and returns entity and previous_stage (rest-feature-routes)', async () => {
    const created = await call('POST', '/api/features', {
      content: 'Stage via short id'
    });
    expect(created.status).toBe(201);
    const featureId = entityOf(created.json).id as string;

    const stage = await call(
      'POST',
      `/api/features/${featureId.slice(0, 8)}/stage`,
      { stage: 'functional_test' }
    );
    expect(stage.status).toBe(200);
    expect(stage.json.previous_stage).toBe('building');
    expect(metadataOf(stage.json)).toMatchObject({
      stage: 'functional_test',
      stage_source: 'manual'
    });
    expect(Object.keys(entityOf(stage.json)).sort()).toEqual(
      STORED_ENTITY_KEYS
    );

    const back = await call('POST', `/api/features/${featureId}/stage`, {
      stage: 'building'
    });
    expect(back.status).toBe(200);
    expect(back.json.previous_stage).toBe('functional_test');
  }, 120_000);

  it('POST /api/features/:id/stage maps validation, not-found and ambiguity errors (rest-errors)', async () => {
    const created = await call('POST', '/api/features', {
      content: 'Stage error cases'
    });
    const featureId = entityOf(created.json).id as string;

    const badStage = await call('POST', `/api/features/${featureId}/stage`, {
      stage: 'shipped'
    });
    expect(badStage.status).toBe(400);
    expect(errorCode(badStage.json)).toBe('VALIDATION');

    const unknown = await call(
      'POST',
      '/api/features/00000000-0000-4000-8000-000000000999/stage',
      { stage: 'review' }
    );
    expect(unknown.status).toBe(404);
    expect(errorCode(unknown.json)).toBe('NOT_FOUND');

    for (const id of [
      'abcd1234-0000-4000-8000-000000000001',
      'abcd1234-0000-4000-8000-000000000002'
    ]) {
      await db().pool.query(
        `INSERT INTO entities (id, type, content, visibility, status, metadata)
         VALUES ($1, 'task', $2, 'shared', 'inbox', '{}'::jsonb)`,
        [id, `Task ${id.slice(-1)}`]
      );
    }

    const ambiguous = await call('POST', '/api/features/abcd1234/stage', {
      stage: 'review'
    });
    expect(ambiguous.status).toBe(409);
    expect(errorCode(ambiguous.json)).toBe('CONFLICT');
    const error = ambiguous.json.error as Json;
    expect(
      ((error.details as Json).candidates as unknown[]).map((candidate) => {
        const row = candidate as Json;
        return { id: row.id, title: row.title };
      })
    ).toEqual([
      { id: 'abcd1234-0000-4000-8000-000000000001', title: 'Task 1' },
      { id: 'abcd1234-0000-4000-8000-000000000002', title: 'Task 2' }
    ]);
  }, 120_000);

  it('POST /api/features/:id/pull-requests derives stages and rejects non-GitHub urls (rest-feature-routes, rest-errors)', async () => {
    const created = await call('POST', '/api/features', {
      content: 'Pull request flow'
    });
    const featureId = entityOf(created.json).id as string;

    const opened = await call(
      'POST',
      `/api/features/${featureId}/pull-requests`,
      { url: 'https://github.com/Ivo-Toby/postgram/pull/12/files' }
    );
    expect(opened.status).toBe(200);
    expect(opened.json).toMatchObject({
      stage_changed: true,
      from: 'building',
      to: 'review'
    });
    expect(metadataOf(opened.json).pull_requests).toMatchObject([
      { url: 'https://github.com/ivo-toby/postgram/pull/12', state: 'open' }
    ]);
    expect(Object.keys(entityOf(opened.json)).sort()).toEqual(
      STORED_ENTITY_KEYS
    );

    const merged = await call(
      'POST',
      `/api/features/${featureId}/pull-requests`,
      { url: 'https://github.com/ivo-toby/postgram/pull/12', state: 'merged' }
    );
    expect(merged.status).toBe(200);
    expect(merged.json).toMatchObject({
      stage_changed: true,
      from: 'review',
      to: 'awaiting_release'
    });

    const sameState = await call(
      'POST',
      `/api/features/${featureId}/pull-requests`,
      { url: 'https://github.com/ivo-toby/postgram/pull/12', state: 'merged' }
    );
    expect(sameState.status).toBe(200);
    expect(sameState.json).toMatchObject({
      stage_changed: false,
      from: 'awaiting_release',
      to: 'awaiting_release'
    });

    const badUrl = await call(
      'POST',
      `/api/features/${featureId}/pull-requests`,
      { url: 'https://gitlab.com/a/b/-/merge_requests/1' }
    );
    expect(badUrl.status).toBe(400);
    expect(errorCode(badUrl.json)).toBe('VALIDATION');
  }, 120_000);

  it('read-only auth gets 403 FORBIDDEN on mutating feature routes (rest-errors)', async () => {
    currentAuth = readOnlyAuth;
    try {
      const forbiddenCreate = await call('POST', '/api/features', {
        content: 'Should be forbidden'
      });
      expect(forbiddenCreate.status).toBe(403);
      expect(errorCode(forbiddenCreate.json)).toBe('FORBIDDEN');

      const forbiddenRepo = await call('PUT', '/api/repositories', {
        remote: 'github.com/ivo-toby/postgram',
        release_on_merge: true
      });
      expect(forbiddenRepo.status).toBe(403);
      expect(errorCode(forbiddenRepo.json)).toBe('FORBIDDEN');
    } finally {
      currentAuth = writeAuth;
    }
  }, 120_000);
});
